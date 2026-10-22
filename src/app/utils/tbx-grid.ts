/** Native TBX CSV is one comma-separated stream; newlines are only formatting. */
export function writeIndexGrid(rows: number[][]): string {
    return '\n' + rows.map(row => row.join(',')).join(',\n') + '\n';
}

export function emptyIndexGrid(width: number, height: number): number[][] {
    return Array.from({ length: height }, () => Array<number>(width).fill(0));
}

export function readIndexGrid(text: string, width: number, height: number, legacyRoomBorder = false): number[][] {
    if (!text.trim()) return emptyIndexGrid(width, height);

    const parse = (parts: string[]): number[] | undefined => {
        if (!parts.every(part => /^\d+$/.test(part.trim()))) return undefined;
        const values = parts.map(Number);
        return values.every(Number.isSafeInteger) ? values : undefined;
    };
    // Accept both native CSV and older web files missing commas at row boundaries.
    let values = parse(text.trim().split(','));
    if (!values) {
        const rows = text.trim().split(/\r?\n/).filter(row => row.trim());
        const parsed = rows.map(row => parse(row.trim().replace(/,$/, '').split(',')));
        if (parsed.some(row => !row)) throw new Error('Invalid TBX grid: expected non-negative integer indices.');
        const rowWidth = parsed[0]!.length;
        if (!parsed.every(row => row!.length === rowWidth)) throw new Error('Invalid TBX grid: inconsistent row widths.');
        values = parsed.flatMap(row => row!);
    }

    let sourceWidth = width;
    let sourceHeight = height;
    if (legacyRoomBorder && values.length === (width + 1) * (height + 1)) {
        sourceWidth++;
        sourceHeight++;
    }
    if (values.length !== sourceWidth * sourceHeight) {
        throw new Error(`Invalid TBX grid: expected ${width * height} cells, found ${values.length}.`);
    }
    const rows = Array.from({ length: sourceHeight }, (_, y) => values!.slice(y * sourceWidth, (y + 1) * sourceWidth));
    if (sourceWidth !== width) {
        if (rows[height].some(value => value !== 0) || rows.some(row => row[width] !== 0)) {
            throw new Error('The old web room grid contains rooms outside the building bounds.');
        }
        return rows.slice(0, height).map(row => row.slice(0, width));
    }
    return rows;
}

export function gridContains(width: number, height: number, x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}
