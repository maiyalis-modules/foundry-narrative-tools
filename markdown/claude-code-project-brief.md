# Eryndor Story Deck --- Claude Code Project Brief

## Project Overview

We are building a **FoundryVTT module** called **Eryndor Story Deck**.

The module's purpose is to facilitate a highly collaborative Session 0
for tabletop RPG campaigns, beginning with Daggerheart but designed to
be system-agnostic.

Rather than the GM asking ad-hoc questions, the module presents
structured "story cards" that guide players through collaboratively
creating their hometown, relationships, NPCs, traditions, and shared
history.

The end result is a **campaign seed** that the GM can immediately build
the first adventures around.

------------------------------------------------------------------------

## Design Philosophy

The guiding principle is:

> **The players frame the world before the world reframes the players.**

The players should feel like they genuinely helped create the place they
are leaving behind. Later events in the campaign should constantly refer
back to things they invented.

The module is intended to encourage conversation rather than
questionnaires.

------------------------------------------------------------------------

## Story Card Engine

Story content is stored entirely in JSON.

Each card contains:

-   metadata
-   one or more sequential steps
-   participant selection
-   prompts
-   fields to collect
-   entities the card creates

The module should not contain hard-coded prompts.

It should simply execute cards defined in JSON.

------------------------------------------------------------------------

## Example Card

``` json
{
  "id": "places-forbidden-place",
  "title": "Forbidden Place",
  "category": "places",
  "stages": ["shared_memories", "building_home"],
  "steps": [
    {
      "participant": {
        "role": "primary",
        "selection": "gm"
      },
      "setup": "Every child in town had one place they weren't supposed to play.",
      "fields": [
        {
          "id": "place_name",
          "label": "Where was it?",
          "type": "text"
        }
      ]
    },
    {
      "participant": {
        "role": "secondary",
        "selection": "chosen_by_primary"
      },
      "setup": "Choose another player.",
      "fields": [
        {
          "id": "shared_memory",
          "label": "Why were you there with {{primary}}?",
          "type": "text"
        }
      ]
    }
  ]
}
```

------------------------------------------------------------------------

## Expected Module Features (incremental)

### Phase 1

-   Load deck JSON
-   Display cards
-   Step through prompts
-   Assign participants
-   Collect responses
-   Persist progress

### Phase 2

-   Export campaign seed JSON
-   Random card selection by stage/category
-   Card browser
-   GM controls

### Phase 3

-   Rich field types (NPC, Player, Location, Multiple Choice)
-   Validation
-   Entity graph
-   Future campaign references

------------------------------------------------------------------------

## Technical Goals

-   FoundryVTT v14
-   TypeScript
-   Vite
-   ApplicationV2 UI
-   Modular architecture
-   JSON-driven content
-   Strong typing
-   Minimal business logic in UI

The engine should execute cards, not know their contents.

------------------------------------------------------------------------

## Initial Architecture

Suggested directories:

    src/
        engine/
        models/
        ui/
        services/
        stores/
        cards/

    packs/
        storydeck/

    schemas/
        story-card.schema.json

    examples/

------------------------------------------------------------------------

## Long-Term Vision

This is not just a Session 0 helper.

It should become a reusable storytelling engine capable of generating
collaborative worldbuilding for any campaign.

The Story Deck should eventually support hundreds of cards without
requiring changes to the engine.

The focus should always remain on keeping the engine generic while the
content lives entirely in JSON.
