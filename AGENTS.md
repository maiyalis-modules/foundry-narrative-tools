# Maiyalis: Narrative Tools — Agent guide

> This is the canonical instruction file for all coding agents. Update this
> file when shared guidance changes. `CLAUDE.md` imports it for Claude Code;
> Codex reads `AGENTS.md` directly. Do not duplicate shared instructions in
> agent-specific files.

A FoundryVTT **v14** module — package/module id **`foundry-story-deck`**, title
"Maiyalis: Narrative Tools" (formerly "Campaign Story Decks", still the name of
the GitHub repo, `foundry-narrative-tools`). Written in TypeScript, compiled to
`dist/module.js` (what `module.json` loads). A JSON-driven, collaborative
Session 0 "story card" engine, plus a Daggerheart-specific **Connections round**.
System-agnostic by design, Daggerheart-first in practice.

## Build — read this first

**Node.js is NOT installed on the host, and Python isn't either.** The build runs
in Docker. Do not run `npm` / `node` / `tsc` / `vite` directly on the host — they
won't exist.

```
docker compose run --rm build     # one-off type-check + build (tsc --noEmit && vite build)
docker compose up watch           # rebuild dist/module.js on every save
```

- First run installs deps into a **named Docker volume** (`story-deck-node-modules`),
  not the host — Vite ships platform-specific binaries that a Windows `node_modules`
  can't run in the Linux container. `package-lock.json` still persists to the host.
- The host `node_modules/` folder is an empty mount-point artifact; ignore it.
- **Never add a `restart:` policy** to `docker-compose.yml` (keep `restart: "no"`).
  These are manual, developer-invoked containers. Don't change Docker Desktop settings.
- To validate JSON without Node, use PowerShell: `Get-Content -Raw file.json | ConvertFrom-Json`.

### Hot reload

While a world runs, Foundry live-applies (no refresh): `styles/module.css`,
`templates/*.hbs`, `lang/*.json`. **JavaScript is not hot-swapped** — after `watch`
rebuilds `dist/module.js`, **press F5** in the browser.

## Layout

```
src/
  module.ts            entry point — Hooks.once("init"|"ready"), public API at
                        game.modules.get(MODULE_ID).api
  constants.ts          MODULE_ID, MODULE_TITLE, LOG_PREFIX, SOCKET_EVENT,
                        SETTINGS, MENUS, TEMPLATES, JOURNAL_FOLDER(S)
                        — "Story Decks" and "Story Decisions", both nested
                        under PARENT_JOURNAL_FOLDER ("Narrative Tools")
  engine/               card-execution logic — no Foundry dependencies, doesn't
                        know card contents (deck-engine.ts, card-selector.ts,
                        decision-resolver.ts, token-resolver.ts)
  models/               typed story-card / session / recipe structures
  services/              card loading, socket relay, connections parsing,
                        journal export, portrait bridge, deck-run/play services
  stores/                session persistence (game.settings)
  apps/ ui/              ApplicationV2 windows and dialogs
  cards/                 default-deck loading
  utils/                 escape-html, session-date helpers
  types/foundry.d.ts     minimal ambient Foundry type shim
dist/module.js          build output (git-ignored)
module.json             manifest — esmodules -> dist/module.js
packs/storydeck/        bundled starter deck (JSON), loaded by src/cards/
schemas/story-card.schema.json   the JSON shape every card must conform to
examples/                minimal single-card examples
story-cards.md           design guide for authoring/generating Story Cards
markdown/claude-code-project-brief.md   original design brief — background reading
styles/ templates/ lang/   served from the repo root as-is
```

## Conventions

- **Module id does not match the repo folder name.** `MODULE_ID = "foundry-story-deck"`
  (repo folder is `foundry-narrative-tools`, a later rename that didn't touch the
  id). Use `foundry-story-deck` for the Foundry junction target, socket channel,
  and anywhere else the id is required — see *Dev environment*.
- **Settings**: add a key to `SETTINGS` in `constants.ts`, register it in
  `settings.ts`, which is called during the `init` hook (settings can't be
  registered later). Settings-menu windows (not flat controls) go in `MENUS`.
- **Templates**: add the path to `TEMPLATES` in `constants.ts`; they're preloaded
  via `loadTemplates(Object.values(TEMPLATES))` in `init`.
- **Types**: there's no full Foundry type package — `src/types/foundry.d.ts` is a
  deliberately minimal shim. When you touch a new Foundry global, **add it to the
  shim** rather than reaching for `any` everywhere.
- **Localization**: every user-facing string lives in `lang/en.json` under the
  `FSD.` prefix — `game.i18n.localize("FSD.…")` in TS, `{{localize "FSD.…"}}` in
  templates. Don't hardcode display strings.
- **Cards are pure JSON**, not code. The engine (`src/engine/`) executes cards
  without knowing their contents — grow the deck by adding JSON under
  `packs/storydeck/` and validating against `schemas/story-card.schema.json`, not
  by changing engine logic. See `story-cards.md` for the authoring philosophy
  (prompts, not questionnaires) and `examples/` for a minimal card.
- **Socket handlers**: every handler passed to `registerSocket()` in `module.ts`
  is wrapped in `report(what, promise)` rather than a bare `void`, so a rejection
  surfaces a console error and a UI notification instead of vanishing as an
  unhandled rejection — the failure mode that reads as "the message never
  arrived" at a live table.

## The Connections round (Daggerheart-specific)

A **Connections** tab appears in the Story Deck window only when the active
system is Daggerheart (`DAGGERHEART_SYSTEM_ID`), for the character-creation step
where each player's connection questions get answered by *other* players. The GM
starts/ends the round; while it's on, players can't hand-edit the sheet's
connections field (the GM still can, as an escape hatch).

- Daggerheart stores connections as **one HTML blob** in
  `system.biography.connections` (matched by the `CONNECTIONS_FIELD` suffix,
  since the sheet may or may not prefix it with `system.`) — not a list. Questions
  have no ids and are addressed by **ordinal position**.
- That blob has **two shapes**: freshly system-written prompts are joined by bare
  `<br/>`, but once the field has passed through the sheet's ProseMirror editor
  even once, those become `<p><br></p>`. Only the second shape has a writable
  answer slot — `<br>` is a void element, so inserting into it is silently
  discarded by the DOM.
- `src/services/connections-html.ts` parses this deliberately conservatively: a
  paragraph counts as a question only when *all* of its text is bold, and every
  write edits in place and re-serializes the whole document so unrecognized
  content (headings, pasted quotes, the player's own prose) passes through
  untouched.
- Fairness rule: a player who already answered one of *your* questions drops off
  your candidate list for the next one; if that empties the list, everyone
  becomes eligible again rather than stranding the question.

## Dev environment

- A directory **junction** links this repo into Foundry:
  `%LOCALAPPDATA%\FoundryVTT\Data\modules\foundry-story-deck` → the repo root
  (junction target uses the **module id**, not the repo folder name — see
  *Conventions*). Foundry serves the built `dist/module.js` and the root assets
  directly.
- Sibling modules **Maiyalis: Target Helper** (`../daggerheart-target-helper`),
  **Maiyalis: Spotlight Helper** (`../daggerheart-spotlight-tracker`), and
  **Maiyalis: Utility Suite** (`../foundry-utility-suite`) use the same Docker
  toolchain and are good references for patterns — ApplicationV2 windows,
  delegated-click dispatch, GM-authoritative world-setting sync over sockets. This
  repo is the **original home of the Ginzzzu portrait-bridge integration**
  (`src/services/portrait-bridge.ts`) that the other Daggerheart modules
  replicate — read it first before touching portrait code elsewhere.
