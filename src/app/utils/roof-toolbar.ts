import { ROOF_OPTIONS, RoofOption } from '../services/roof-patterns';

export type RoofToolGroup = 'standard' | 'shallow' | 'roof30' | 'corners' | 'corners30';
export const roofToolGroup = (option: RoofOption): RoofToolGroup => option.roofType.startsWith('Shallow') ? 'shallow'
    : option.roofType.startsWith('Corner') ? option.roofType.includes('30') ? 'corners30' : 'corners'
        : option.roofType.includes('30') ? 'roof30' : 'standard';
const option = (id: string) => ROOF_OPTIONS.find(o => o.id === id)!;
export const ROOF_TOOL_GROUPS: { id: RoofToolGroup; label: string; options: RoofOption[] }[] = [
    { id: 'standard', label: 'Roofs', options: ['slope-w', 'slope-e', 'slope-n', 'slope-s', 'peak-horizontal', 'peak-vertical', 'dormer-w', 'dormer-e', 'dormer-n', 'dormer-s', 'flat-top'].map(option) },
    { id: 'shallow', label: 'Shallow roofs', options: ['shallow-slope-w', 'shallow-slope-e', 'shallow-slope-n', 'shallow-slope-s', 'shallow-peak-horizontal', 'shallow-peak-vertical'].map(option) },
    { id: 'roof30', label: '30-degree roofs', options: ['slope30-w', 'slope30-e', 'slope30-n', 'slope30-s', 'peak30-horizontal', 'peak30-vertical', 'peak30-quad', 'dormer30-w', 'dormer30-e', 'dormer30-n', 'dormer30-s'].map(option) },
    { id: 'corners', label: 'Roof corners', options: ['corner-inner-nw', 'corner-inner-ne', 'corner-inner-se', 'corner-inner-sw', 'corner-outer-nw', 'corner-outer-ne', 'corner-outer-se', 'corner-outer-sw'].map(option) },
    { id: 'corners30', label: '30-degree roof corners', options: ROOF_OPTIONS.filter(o => o.roofType.startsWith('CornerSlope30')) },
];
export function roofOptionIcon(option: RoofOption): string {
    const type = option.roofType.replace(/^Shallow/, '').replace('CornerSlope30', 'Corner').replace('30', '');
    const name = type === 'FlatTop' ? 'roof_flat' : type.startsWith('Corner') ? type.replace(/^Corner(Inner|Outer)/, (_, side: string) => 'corner_' + side.toLowerCase())
        : 'roof_' + type[0].toLowerCase() + type.slice(1);
    return `assets/icons/icon_${name}.png`;
}
