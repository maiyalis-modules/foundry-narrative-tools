# Story Card Design Guide

Reference for authoring and generating Story Cards for this module. Story Cards
are **system-agnostic worldbuilding prompts** used to collaboratively create a
campaign setting. Each card should feel like a prompt from a creative-writing
workshop — not a random table or a quest generator.

**The goal is not to answer questions. It is to create interesting questions,
memorable details, and reusable campaign elements** that still inspire a GM months
into a campaign.

## Scope (exactly one per card)

How large the impact is:

- **personal** — one character or keepsake.
- **community** — a single settlement. *Every prompt must be something known by or
  affecting one town/village.*
- **regional** — a province or nation.
- **epic** — a grand, world-shaping scale.

## Theme (exactly one per card)

Shapes the *type* of question asked, without rigidly limiting creativity:

`relationships` · `identity` · `culture` · `organizations` · `history` ·
`politics` · `economy` · `conflict` · `opportunity` · `religion` · `mystery` ·
`wilderness` · `travel` · `adventure` · `mystical`

> Note: **community is a *scope*, not a theme.** Content about a town's social
> fabric lives under `identity` (how it sees itself), `culture` (how it lives —
> customs, festivals, craft, food), `relationships`, `organizations`, or
> `religion`.

## Philosophy

A good card should:

- Create **reusable campaign content**.
- Reveal something meaningful about the setting.
- Encourage players to **build on each other's ideas**.
- Leave room for future adventures.
- **Avoid fully resolving** mysteries, conflicts, or prophecies.
- Feel equally useful in almost any fantasy setting.

### The 80% rule

Most cards should naturally create **2–4 reusable campaign elements** — NPCs,
organizations, traditions, landmarks, festivals, conflicts, rumors, mysteries,
customs, locations, resources, factions, supernatural phenomena. If a card only
produces a single fact, it's too shallow.

## The three prompts (spotlight passing)

Each card has **three steps**, each answered by a **different** player, each
building on the last. Shift *perspective*, never just ask for "more detail":

```
Player 1 creates something.
    ↓
Player 2 expands or complicates it.
    ↓
Player 3 changes its meaning, consequences, or future.
```

Good follow-up angles: *Who disagrees? What changed? Why does it matter now? Who
remembers it differently? What unexpected consequence occurred? What secret is
connected to it? Why are people worried?*

Collaboration, not debate: Player 2 should rarely **contradict** Player 1 —
**expand, reinterpret, complicate, deepen** instead.

## Writing the questions

- **Keep them open.** Avoid obvious answers.
  - Bad: *"Who owns the bakery?"*
  - Better: *"Which bakery is everyone willing to wait hours to visit, and what
    makes it worth the wait?"*
- **Avoid resolution.** The card should create future stories, not complete them.
- **Stay system-agnostic.** No assumptions about races, classes, gods, or magic
  systems. Prefer *"Who is said to understand the strange power…"* over *"Which
  wizard…"*; *"What ancient power…"* over *"Which dragon…"*.

## Tone

Evocative, inspiring, collaborative, optimistic about creativity. Avoid comedy /
parody, overly grim prompts, and campaign-specific lore.

## JSON structure (this module's schema)

```json
{
  "id": "kebab-case-id",
  "title": "The Card Title",
  "theme": "identity",
  "scope": "community",
  "outputs": ["person", "tradition"],
  "tags": ["community", "culture"],
  "steps": [
    {
      "participant": { "role": "primary", "selection": "gm_selects_player" },
      "setup": "Framing sentence read before the question.",
      "question": "The single open question this player answers."
    },
    {
      "participant": {
        "role": "secondary",
        "selection": "gm_selects_player",
        "prompt": "Choose a player who sees a different side of this."
      },
      "setup": "...",
      "question": "..."
    },
    {
      "participant": {
        "role": "tertiary",
        "selection": "chosen_by_previous",
        "prompt": "Choose a player who has noticed it changing."
      },
      "setup": "...",
      "question": "..."
    }
  ]
}
```

Schema notes (see `schemas/story-card.schema.json` for the authoritative version):

- **`participant.selection`** — who chooses this step's speaker. `gm_selects_player`
  (the GM picks; a GM-only note if a `prompt` is present) or `chosen_by_previous`
  (the player who just answered picks; the `prompt` is shown to them). The opening
  step is always `gm_selects_player` and omits `prompt`.
- **`participant.prompt`** — optional guidance for choosing the next speaker. On
  `chosen_by_previous` steps it's shown to the player; on `gm_selects_player` steps
  it's a GM-only note.
- There is **no `pass` field** and no card-level "end" — a card simply ends when its
  steps run out.
- **`outputs`** — descriptive metadata (what kinds of element the card creates).
  Free-form, but prefer canonical forms: `person` (not npc), `place` (not
  location/landmark), `institution` (not organization), plus `object`, `event`,
  `legend`, `tradition`, `memory`, `reputation`, and distinct concepts like
  `opportunity`, `mystery`, `story_hook`, `phenomenon`.
- **`tags`** — free-form, lowercase; reuse existing values.

## Checklist before a card is done

1. Fits the requested **scope** and **theme**.
2. Generates **2–4 reusable** campaign elements.
3. The three prompts **build naturally** on one another.
4. Each prompt **shifts perspective** instead of asking for more detail.
5. Leaves **future story hooks**.
6. Works in **almost any fantasy** campaign.
7. **Does not resolve** the central mystery/conflict.
8. Would still interest a GM **six months** into the campaign.
