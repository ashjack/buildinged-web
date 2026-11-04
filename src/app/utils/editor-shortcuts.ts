const nonTextInputs = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);

export function isTextEditing(event: KeyboardEvent): boolean {
    if (event.isComposing) return true;
    const field = event.target instanceof Element
        ? event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') : null;
    if (!field) return false;
    return !(field instanceof HTMLInputElement && nonTextInputs.has(field.type));
}

/** Keeps panel keys away from editor shortcuts, except undo/redo which should work from anywhere. */
export function isolatePanelKey(event: KeyboardEvent): void {
    if (!historyShortcut(event)) event.stopPropagation();
}

export function historyShortcut(event: KeyboardEvent): 'undo' | 'redo' | undefined {
    if (event.defaultPrevented || isTextEditing(event) || event.altKey || !(event.ctrlKey || event.metaKey)) return undefined;
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
    return undefined;
}
