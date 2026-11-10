import { WorldedLot, WorldedWorld } from './worlded-world';

type ResourceKind = 'terrain image' | 'vegetation image' | 'cell map' | 'building lot';

interface ResourceReference {
  key: string;
  path: string;
  kind: ResourceKind;
}

export interface WorldedProjectFiles {
  files: Map<string, File>;
  folderName: string;
  warnings: string[];
}

export function worldedReferenceKey(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.trim() || normalized.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.includes('\0')) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.length ? parts.join('/') : undefined;
}

export function worldedVegetationPath(path: string): string {
  const index = path.lastIndexOf('.');
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index > separator ? `${path.slice(0, index)}_veg${path.slice(index)}` : `${path}_veg`;
}

export function worldedFileFor(files: ReadonlyMap<string, File>, path: string): File | undefined {
  const key = worldedReferenceKey(path);
  return key ? files.get(key) : undefined;
}

function projectPath(base: string[], reference: string): string | undefined {
  const parts = [...base];
  for (const part of reference.split('/')) {
    if (part === '..') {
      if (parts.length <= 1) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function resourceReferences(world: WorldedWorld, warnings: string[]): ResourceReference[] {
  const references = new Map<string, ResourceReference>();
  const add = (path: string, kind: ResourceKind) => {
    const key = worldedReferenceKey(path);
    if (!key) {
      warnings.push(`Cannot resolve ${kind} "${path}": select a world that uses relative project paths.`);
    } else if (!references.has(key)) {
      references.set(key, { key, path, kind });
    }
  };
  for (const bitmap of world.bitmaps) {
    add(bitmap.path, 'terrain image');
    add(worldedVegetationPath(bitmap.path), 'vegetation image');
  }
  for (const cell of world.cells.values()) {
    if (cell.map && /\.tmx$/i.test(cell.map)) add(cell.map, 'cell map');
    for (const lot of cell.lots) if (lot.map) add(lot.map, 'building lot');
  }
  return [...references.values()];
}

/** Resolves only files referenced by the selected PZW; all file reads remain local. */
export async function resolveWorldedProject(
  selected: readonly File[], worldFile: File, world: WorldedWorld,
): Promise<WorldedProjectFiles> {
  const candidates = selected.filter(file => file.webkitRelativePath &&
    file.name.toLowerCase() === worldFile.name.toLowerCase());
  if (!candidates.length) throw new Error(`The selected folder does not contain the open ${worldFile.name} file.`);
  const original = await worldFile.text();
  const matching: File[] = [];
  for (const candidate of candidates) {
    if (candidate.size === worldFile.size && await candidate.text() === original) matching.push(candidate);
  }
  if (!matching.length) throw new Error(`The selected folder contains a different copy of ${worldFile.name}. Open that copy first.`);
  if (matching.length > 1) throw new Error('The selected folder contains multiple matching world files. Choose a more specific folder.');

  const worldPath = matching[0].webkitRelativePath.replace(/\\/g, '/');
  const worldParts = worldPath.split('/').filter(Boolean);
  if (worldParts.length < 2 || worldParts.some(part => part === '.' || part === '..')) {
    throw new Error('The browser did not provide a usable project folder path.');
  }
  const folderName = worldParts[0];
  const base = worldParts.slice(0, -1);
  const byPath = new Map<string, File[]>();
  const byLowerPath = new Map<string, File[]>();
  for (const file of selected) {
    const path = file.webkitRelativePath.replace(/\\/g, '/');
    if (!path) continue;
    const exact = byPath.get(path) ?? [];
    exact.push(file);
    byPath.set(path, exact);
    const lower = path.toLowerCase();
    const folded = byLowerPath.get(lower) ?? [];
    folded.push(file);
    byLowerPath.set(lower, folded);
  }

  const warnings: string[] = [];
  const resolved = new Map<string, File>();
  const missing: string[] = [];
  for (const reference of resourceReferences(world, warnings)) {
    const path = projectPath(base, reference.key);
    if (!path) {
      warnings.push(`The ${reference.kind} "${reference.path}" is outside the selected folder. Select a parent folder.`);
      continue;
    }
    const matches = byPath.get(path) ?? byLowerPath.get(path.toLowerCase()) ?? [];
    if (matches.length === 1) resolved.set(reference.key, matches[0]);
    else if (matches.length > 1) warnings.push(`The ${reference.kind} "${reference.path}" matches multiple files.`);
    else missing.push(`${reference.kind}: ${reference.path}`);
  }
  if (missing.length) {
    warnings.push(`${missing.length} referenced project file${missing.length === 1 ? ' is' : 's are'} missing: ` +
      `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}.`);
  }
  return { files: resolved, folderName, warnings };
}

export async function resolveTilezedProject(
  selected: readonly File[], mapFile: File, lots: WorldedLot[],
): Promise<WorldedProjectFiles> {
  const world: WorldedWorld = {
    width: 1, height: 1, cellSize: 300, bitmaps: [], objectGroups: [], lotCount: lots.length, objectCount: 0, warnings: [],
    cells: new Map([['0,0', { x: 0, y: 0, map: '', lots, zones: [], objectCount: 0, featureCount: 0 }]]),
  };
  const project = await resolveWorldedProject(selected, mapFile, world);
  const mapText = await mapFile.text();
  const source = (await Promise.all(selected.filter(file => file.webkitRelativePath && file.name.toLowerCase() === mapFile.name.toLowerCase() && file.size === mapFile.size)
    .map(async file => await file.text() === mapText ? file : undefined))).find(file => !!file)!;
  const base = source.webkitRelativePath.replace(/\\/g, '/').split('/').slice(0, -1);
  const included = new Set(project.files.values());
  for (const file of selected) {
    if (included.has(file) || !/\.tbx$/i.test(file.name) || !file.webkitRelativePath) continue;
    const parts = file.webkitRelativePath.replace(/\\/g, '/').split('/');
    let common = 0;
    while (common < base.length && common < parts.length && base[common] === parts[common]) common++;
    if (!common) continue;
    const path = worldedReferenceKey([...Array(base.length - common).fill('..'), ...parts.slice(common)].join('/'));
    if (path && !project.files.has(path)) project.files.set(path, file);
  }
  return project;
}
