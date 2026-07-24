/**
 * Resolves `{{token}}` placeholders inside card setup/label text.
 *
 * The engine stays generic: it does not know what any given token means, it
 * simply substitutes from a provided context map. Unknown tokens are left
 * untouched so authoring mistakes are visible rather than silently blanked.
 */

const TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

export type TokenContext = Record<string, string | undefined>;

export function resolveTokens(text: string, context: TokenContext): string {
  return text.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = context[key];
    return value ?? match;
  });
}
