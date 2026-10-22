export function isTextEditing(event: KeyboardEvent): boolean {
    return event.isComposing || !!(event.target instanceof Element
        && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export function historyShortcut(event: KeyboardEvent): 'undo' | 'redo' | undefined {
    if (event.defaultPrevented || isTextEditing(event) || event.altKey || !(event.ctrlKey || event.metaKey)) return undefined;
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
    return undefined;
}
