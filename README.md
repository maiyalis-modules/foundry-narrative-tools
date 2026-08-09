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

## The connections round (Daggerheart)

A **Connections** tab appears in the Story Deck window when the game system is
Daggerheart, for running the character-creation step where each player's
connection questions are answered by the *other* players.

The GM presses **Start Connections** to open the round — like starting a Story
Deck, it announces itself with a banner on every client and puts the shared
session HUD on screen for the whole table, tracking questions answered. It needs
two players online, since a connection is one character answering for another.

Characters are listed **online first**; anyone whose player is disconnected is
folded into a collapsed *Offline* section, because nothing can be handed to them
until they're back.

Once the round is open the GM hands out **one question at a time** — not one
player at a time — so a character's three questions usually end up answered by
three different people. Each question takes two hops:

1. the GM presses **Ask** on a question,
2. its owner is prompted to choose who answers it,
3. that player writes the answer,
4. the GM's client records it and writes it onto the owner's sheet, credited
   inline (`*Kira:* A stubborn old badger.`).

**End Connections** closes the round and drops any question still out; answers
already given stay put. **Clear all answers** is the destructive one.

Two rules keep the round even. A player who has already answered one of *your*
questions drops off your candidate list — and if that empties the list (more
questions than players), everyone becomes eligible again rather than stranding
the question. The chooser also shows how many questions each player has answered
tonight **for anybody**, so the asker can see who is carrying the round.

While the round is switched on, players cannot hand-edit the Connections field on
their sheet; the GM still can, as the escape hatch for fixing a bad answer. Turn
the whole thing off under *Settings → Configure Settings → Eryndor: Story Decks →
Connections round* — the checkbox is disabled on non-Daggerheart systems, which
have no such field to read.

### How the sheet field is read

Daggerheart stores connections as one HTML blob in `system.biography.connections`,
not as a list — character creation copies the class item's prompts in as a flat
run of bolded paragraphs. Questions have no ids and are addressed by ordinal
position.

That blob comes in **two shapes**. As the system first writes it, the prompts are
joined by bare `<br/>` separators; once the field has been through the sheet's
ProseMirror editor even once, those become empty `<p><br></p>` paragraphs. Only
the second has a usable answer slot — a `<br>` is a void element, so writing into
it is silently discarded by the DOM. The parser accepts a slot only if it can
actually hold children, and inserts a paragraph when there isn't one.

[`src/services/connections-html.ts`](src/services/connections-html.ts) does that
parsing, deliberately conservatively: a paragraph counts as a question only when
*all* of its text is bold, and every write edits in place and re-serializes the
whole document so unrecognised content — headings, pasted quotes, the player's own
prose — passes through untouched.

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
