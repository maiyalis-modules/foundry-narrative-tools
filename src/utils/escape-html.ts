/**
 * Escape a string for safe interpolation into HTML.
 *
 * Everything the module renders into dialogs and journal entries can contain
 * player-authored text, so this is used at every such boundary.
 */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
        string,
        string
      >)[c] ?? c,
  );
}
