# Campaign Story Decks

A **FoundryVTT v14** module that facilitates a highly collaborative **Session 0**
for tabletop RPG campaigns — beginning with Daggerheart, but designed to be
system-agnostic.

Instead of the GM asking ad-hoc questions, the module presents structured
**story cards** that guide players through collaboratively creating their
hometown, relationships, NPCs, traditions, and shared history. The result is a
**campaign seed** the GM can immediately build the first adventures around.

> The players frame the world before the world reframes the players.

Story content lives entirely in **JSON**. The engine executes cards — it does
not know their contents — so the deck can grow to hundreds of cards without
touching the engine.

## Tech stack

- FoundryVTT **v14** (ApplicationV2 UI)
- **TypeScript** (strict)
- **Vite** build → single ESM bundle at `dist/module.js`

## Project structure

```
module.json                     Foundry manifest
vite.config.ts / tsconfig.json  build config
src/
  module.ts                     entry point (Foundry lifecycle hooks)
  constants.ts                  ids, setting keys, template paths
  engine/                       generic card-execution logic (no Foundry deps)
  models/                       typed story-card + session structures
  services/                     card loading / parsing
  stores/                       session persistence (game.settings)
  ui/                           ApplicationV2 windows
  cards/                        default-deck loading
  types/                        minimal Foundry global shim
packs/storydeck/                bundled starter deck (JSON)
schemas/                        story-card.schema.json
examples/                       sample individual cards
lang/                           localization
styles/                         CSS
templates/                      Handlebars templates
```

## Development

The build toolchain runs in Docker — **no Node.js install required on the host**.
FoundryVTT runs natively on the host; the container only compiles `src/*.ts` into
`dist/module.js`, which lands back in the repo via a bind mount.

```bash
docker compose run --rm build   # one-off: npm install + type-check + build
docker compose up watch         # long-running: rebuild dist/ on every save
```

These containers have **no restart policy** (`restart: "no"`) — they only start when
you run a compose command yourself, and never come back on their own after a reboot
or Docker restart. Start them manually when you sit down to develop.

The first run installs dependencies into a named volume (`story-deck-node-modules`).
`node_modules` is deliberately **not** bind-mounted from the host — Vite/esbuild ship
platform-specific native binaries, so deps must be installed inside the Linux
container. `package-lock.json` still persists to the host. After editing
`package.json`, just re-run the same command (it runs `npm install` again), or run
`docker compose run --rm build npm install` explicitly.

> If you ever install Node natively, the `npm run build` / `npm run watch` /
> `npm run typecheck` scripts work directly too — the container is additive, not
> required by the module itself.

### Install into local Foundry

Modules live in Foundry's **user data** directory
(`%LOCALAPPDATA%\FoundryVTT\Data\modules`), **not** next to the Foundry app in
`C:\Program Files`. Link the whole repo in with a **directory junction** so Foundry
serves the live build. A junction needs **no Administrator/elevation** (only symbolic
links do) and works across drive letters:

```powershell
# Windows — no elevation required. Adjust the target path if your repo lives elsewhere.
New-Item -ItemType Junction `
  -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\foundry-story-deck" `
  -Target "D:\Foundry\foundry-story-deck"
```

```bash
# macOS / Linux:
ln -s "$(pwd)" "<FoundryUserData>/Data/modules/foundry-story-deck"
```

Build at least once (`docker compose run --rm build`) so `dist/module.js` exists, then
enable **Campaign Story Decks** under **Manage Modules** in a world. Open the deck from
the **Story Deck** button in the Journal sidebar, or via the API:
`game.modules.get("foundry-story-deck").api.open()`.

### Hot reload

Foundry has built-in hot reload while a world is running. Because the module is a
junction to this repo, these files update **live, with no page refresh** — and need
**no build step** (they're served from the repo as-is):

- `styles/module.css`
- `templates/*.hbs`
- `lang/*.json`

**JavaScript is not hot-swapped.** After `docker compose up watch` rebuilds
`dist/module.js` from a TypeScript change, **refresh the browser (F5)** to load it.

So the dev loop is: keep `docker compose up watch` running → CSS/template/lang edits
apply instantly; TS edits rebuild, then F5.

## Authoring cards

Cards conform to [`schemas/story-card.schema.json`](schemas/story-card.schema.json).
Add cards to a deck JSON under `packs/storydeck/` — no engine changes required.
See [`examples/`](examples/) for a minimal single-card example.

## Roadmap

- **Phase 1** — load deck, display cards, step through prompts, assign
  participants, collect responses, persist progress.
- **Phase 2** — export campaign seed JSON, random card selection, card browser,
  GM controls.
- **Phase 3** — rich field types (NPC / Player / Location / choice), validation,
  entity graph, future campaign references.
