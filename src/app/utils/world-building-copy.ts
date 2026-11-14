/** Keep the copy beside its source, avoiding case-insensitive project path collisions. */
export function worldBuildingCopyPath(source: string, paths: string[]): string {
    const base = source.replace(/\.tbx$/i, '');
    const used = new Set(paths.map(path => path.toLowerCase()));
    for (let index = 1; ; index++) {
        const path = `${base}_copy${index === 1 ? '' : index}.tbx`;
        if (!used.has(path.toLowerCase())) return path;
    }
}
