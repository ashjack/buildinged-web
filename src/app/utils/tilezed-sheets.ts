import { TilezedTileset } from './tilezed-map';

export interface TilezedSheetIndex {
  files: Map<string, File>;
  duplicates: string[];
}

export interface TilezedSheetLayout {
  tileWidth: number;
  tileHeight: number;
}

export interface TilezedSheetGeometry extends TilezedSheetLayout {
  rows: number;
  tileCount: number;
}

export function tilezedSheetName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.png$/i, '').toLowerCase();
}

/** Selects the 2x sheet when present, otherwise the 1x sheet, without copying files into the app cache. */
export function indexTilezedSheets(files: ArrayLike<File>): TilezedSheetIndex {
  const selected = new Map<string, { file: File; priority: number }>();
  const duplicates = new Set<string>();
  const entries = Array.from(files).filter(file => /\.png$/i.test(file.name))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  for (const file of entries) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split(/[\\/]/);
    const parent = (parts[parts.length - 2] ?? '').toLowerCase();
    const priority = parent === '2x' ? 2 : (parent === 'tiles' || parts.length <= 2 ? 1 : 0);
    const name = tilezedSheetName(file.name);
    const previous = selected.get(name);
    if (!previous || priority > previous.priority) {
      selected.set(name, { file, priority });
      duplicates.delete(name);
    } else if (priority === previous.priority) {
      duplicates.add(name);
    }
  }
  return { files: new Map([...selected].map(([name, value]) => [name, value.file])), duplicates: [...duplicates] };
}

export function localTilezedSheet(index: TilezedSheetIndex, tileset: TilezedTileset): File | undefined {
  return index.files.get(tilezedSheetName(tileset.source)) ?? index.files.get(tileset.name.toLowerCase());
}

/** Decode image geometry independently of any particular tile reference. */
export function tilezedSheetGeometry(tileset: TilezedTileset, width: number, height: number): TilezedSheetGeometry {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Sheet ${tileset.name} has invalid dimensions.`);
  }
  const scale = [1, 2].find(value => Math.floor(width / (tileset.tileWidth * value)) === tileset.columns);
  if (!scale) {
    throw new Error(`Sheet ${tileset.name} does not match the columns recorded in the TMX (at 1x or 2x).`);
  }
  const rows = Math.min(tileset.rows, Math.floor(height / (tileset.tileHeight * scale)));
  return { tileWidth: tileset.tileWidth * scale, tileHeight: tileset.tileHeight * scale, rows, tileCount: tileset.columns * rows };
}

/** Strict check for callers that need one specific tile. Whole-sheet previews use geometry instead. */
export function tilezedSheetLayout(tileset: TilezedTileset, maxIndex: number, width: number, height: number): TilezedSheetLayout {
  const geometry = tilezedSheetGeometry(tileset, width, height);
  if (!Number.isSafeInteger(maxIndex) || maxIndex < 0 ||
      maxIndex >= geometry.tileCount) {
    throw new Error(`Sheet ${tileset.name} does not contain tile ${maxIndex}.`);
  }
  return { tileWidth: geometry.tileWidth, tileHeight: geometry.tileHeight };
}
