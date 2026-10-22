import { ROOF_OPTIONS, RoofOption } from '../services/roof-patterns';

export type RoofToolGroup = 'standard' | 'shallow' | 'corners';
export const roofToolGroup = (option: RoofOption): RoofToolGroup => option.roofType.startsWith('Shallow') ? 'shallow'
    : option.roofType.startsWith('Corner') ? 'corners' : 'standard';
const option = (id: string) => ROOF_OPTIONS.find(o => o.id === id)!;
export const ROOF_TOOL_GROUPS: { id: RoofToolGroup; label: string; options: RoofOption[] }[] = [
    { id: 'standard', label: 'Roofs', options: ['slope-w', 'slope-e', 'slope-n', 'slope-s', 'peak-horizontal', 'peak-vertical', 'dormer-w', 'dormer-e', 'dormer-n', 'dormer-s', 'flat-top'].map(option) },
    { id: 'shallow', label: 'Shallow roofs', options: ['shallow-slope-w', 'shallow-slope-e', 'shallow-slope-n', 'shallow-slope-s', 'shallow-peak-horizontal', 'shallow-peak-vertical'].map(option) },
    { id: 'corners', label: 'Roof corners', options: ['corner-inner-nw', 'corner-inner-ne', 'corner-inner-se', 'corner-inner-sw', 'corner-outer-nw', 'corner-outer-ne', 'corner-outer-se', 'corner-outer-sw'].map(option) },
];
export function roofOptionIcon(option: RoofOption): string {
    const type = option.roofType.replace(/^Shallow/, '');
    const name = type === 'FlatTop' ? 'roof_flat' : type.startsWith('Corner') ? type.replace(/^Corner(Inner|Outer)/, (_, side: string) => 'corner_' + side.toLowerCase())
        : 'roof_' + type[0].toLowerCase() + type.slice(1);
    return `assets/icons/icon_${name}.png`;
}
