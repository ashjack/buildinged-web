import { Point } from '../models/app.models';
import { FurnishingEdge, PhysicalRoom } from '../models/auto-furnishing.models';
import { furnishingCellKey as key } from './furnishing-room-analysis';

export function furnishingEdgeKey(x: number, y: number, axis: 'N' | 'W'): string { return `${x}:${y}:${axis}`; }
export function edgeBetween(a: Point, b: Point): string {
    return a.x === b.x ? furnishingEdgeKey(a.x, Math.max(a.y, b.y), 'N') : furnishingEdgeKey(Math.max(a.x, b.x), a.y, 'W');
}
/** Room-local navigation preserves the room's pre-existing connectivity, including door approaches. */
export class FurnishingNavigation {
    readonly cells: Map<string, Point>;
    readonly neighbours = new Map<string, string[]>();
    readonly baselineBlocked: Set<string>;
    readonly baselineComponents: Map<string, number>;
    readonly entranceCells: string[];
    readonly initiallyReachable: Set<string>;
    readonly missingEdges: string[] = [];
    constructor(room: PhysicalRoom, edges: Map<string, FurnishingEdge>) {
        this.cells = new Map([...room.cells].sort((a, b) => a.y - b.y || a.x - b.x).map(cell => [key(cell), cell]));
        this.baselineBlocked = new Set(room.blockedCells.map(key));
        for (const [id, cell] of this.cells) {
            const neighbours: string[] = [];
            for (const offset of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
                const next = { x: cell.x + offset.x, y: cell.y + offset.y }, target = key(next);
                if (!this.cells.has(target)) continue;
                const edgeId = edgeBetween(cell, next), edge = edges.get(edgeId);
                if (!edge) { this.missingEdges.push(edgeId); continue; }
                if (edge.opening?.kind === 'door' || !edge.wall && !edge.opening) neighbours.push(target);
            }
            this.neighbours.set(id, neighbours);
        }
        this.baselineComponents = this.components(this.baselineBlocked);
        this.entranceCells = [...new Set(room.entrances.map(entrance => key(entrance.inside)))].filter(cell => this.baselineComponents.has(cell)).sort();
        const reachableGroups = new Set(this.entranceCells.map(cell => this.baselineComponents.get(cell)));
        this.initiallyReachable = new Set([...this.baselineComponents].filter(([, group]) => reachableGroups.has(group)).map(([cell]) => cell));
    }
    components(blocked: Set<string>): Map<string, number> {
        const groups = new Map<string, number>(); let group = 0;
        for (const cell of this.cells.keys()) {
            if (blocked.has(cell) || groups.has(cell)) continue;
            const queue = [cell]; groups.set(cell, group);
            for (let i = 0; i < queue.length; i++) for (const next of this.neighbours.get(queue[i]) || []) {
                if (blocked.has(next) || groups.has(next)) continue;
                groups.set(next, group); queue.push(next);
            }
            group++;
        }
        return groups;
    }
    check(blocked: Set<string>, access: Point[]): string[] {
        const groups = this.components(blocked), reasons: string[] = [], preserved = new Map<number, number>();
        // Removing furniture cells may shrink a component, but must not split its remaining walkable cells.
        for (const [cell, group] of groups) {
            const baseline = this.baselineComponents.get(cell)!;
            if (preserved.has(baseline) && preserved.get(baseline) !== group) { reasons.push('connectivity-split'); break; }
            preserved.set(baseline, group);
        }
        const reachable = new Set(this.entranceCells.map(cell => groups.get(cell)).filter(group => group !== undefined));
        if (this.entranceCells.some(cell => !groups.has(cell))) reasons.push('entrance-blocked');
        if (access.some(cell => !groups.has(key(cell)) || !reachable.has(groups.get(key(cell))))) reasons.push('access-unreachable');
        return reasons;
    }
    deadEnds(blocked: Set<string>): number {
        let count = 0;
        for (const cell of this.cells.keys()) if (!blocked.has(cell) && (this.neighbours.get(cell) || []).filter(next => !blocked.has(next)).length <= 1) count++;
        return count;
    }
}
