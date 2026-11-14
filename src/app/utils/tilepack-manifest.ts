import { Tilepack } from '../models/app.models';

export function isTilepackRequired(pack: Tilepack): boolean {
  return pack.name === 'Vanilla' || pack.required === true;
}

export function isTilepackSelected(pack: Tilepack): boolean {
  return !pack.disabled && (isTilepackRequired(pack) || localStorage.getItem(pack.name) === '1');
}

export function parseTilepackManifest(value: unknown): Tilepack[] {
  if (!Array.isArray(value)) throw new Error('The tilepack manifest is not a list.');

  const packs: Tilepack[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || !('Name' in entry) || !('Url' in entry) ||
        typeof entry.Name !== 'string' || !entry.Name || typeof entry.Url !== 'string' || !entry.Url) continue;
    const version = 'Version' in entry && entry.Version != null ? String(entry.Version) : undefined;
    const sheetIndexUrl = 'SheetIndexUrl' in entry && typeof entry.SheetIndexUrl === 'string' ? entry.SheetIndexUrl : undefined;
    packs.push({ name: entry.Name, url: entry.Url, enabled: false, version,
      ...('Disabled' in entry ? { disabled: entry.Disabled === true } : {}),
      ...('Required' in entry ? { required: entry.Required === true } : {}),
      ...(sheetIndexUrl ? { sheetIndexUrl } : {}) });
  }
  return packs;
}
