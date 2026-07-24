import type { TokenContext } from "../engine/token-resolver.js";
import { userNames } from "./foundry-users.js";

/** The minimal state needed to resolve tokens — role assignments, keyed by role. */
interface TokenSource {
  participants: Record<string, string[]>;
}

/**
 * Builds the `{{token}}` substitution context for a card: the role tokens
 * (`{{primary}}`, `{{secondary}}`, `{{group}}`) → assigned users' display names.
 *
 * The engine's `renderSetup`/`renderQuestion` do the actual substitution; this just
 * feeds them Foundry-aware values, keeping the token resolver itself generic.
 */
export function buildTokenContext(source: TokenSource): TokenContext {
  const context: TokenContext = {};

  for (const [role, ids] of Object.entries(source.participants)) {
    if (ids.length > 0) context[role] = userNames(ids);
  }

  return context;
}
