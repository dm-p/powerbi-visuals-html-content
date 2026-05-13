# Brainstorm: explicit "disable body-styling override" property

**Status:** parked, resume from here  
**Date:** 2026-05-09  
**Branch context:** `fix/improve-sanitization-permissibility` (just landed multi-agent code review fixes; cascade-override Troubleshooting entry now in `docs/sanitization-rules.md`)

## The conflation we identified

Current `resolveStyling` (src/domain-utils.ts) toggles `.uses-default-body-styling` on the body container based on `!useSS` — i.e. "no custom stylesheet supplied." That class triggers the LESS rule in `style/visual.less`:

```less
#htmlViewer.uses-default-body-styling #htmlContent [style] {
    color: inherit !important;
    font-family: inherit !important;
    font-size: inherit !important;
    text-align: inherit !important;
    background-color: transparent !important;
}
```

The rule conflates two questions the code never separated:

1. **"Has the user supplied custom CSS?"** — answers *where styling comes from*
2. **"Should the visual override embedded inline styles?"** — answers *whether default body styling wins over inline*

Right now the cascade answers #2 by inferring it from #1 ("no custom stylesheet ⇒ override is on"). That's a coincidence of when the issue #144 fix was added, not a real design.

## The proposed model

Make #2 an explicit property in the `contentFormatting` card. Three first-class user paths fall out cleanly:

| Path | Custom stylesheet? | Override property | Behavior |
|---|---|---|---|
| 1 (default) | no | ON | Properties-only mode, embedded inline styles get neutered into Body color/font (current behavior — office-paste user) |
| 2 (new) | no | OFF | Properties-only baseline, inline `<span style='color:red'>` spans win (conditional-formatting user, e.g. the DAX `HTML CoPerf` measure) |
| 3 (existing) | yes | (irrelevant) | Custom CSS is the source of truth, the override is gated off regardless |

## Gating expression

```ts
applyOverride = overrideEnabledProp && !useSS
```

When a custom stylesheet IS supplied, the property has no effect — the user's authored CSS is their intent. The format pane could grey out the toggle when a custom stylesheet is present, signaling "this setting doesn't apply right now."

## Decisions already made

- **All-or-nothing toggle, not per-property.** Five separate switches for color/font-family/font-size/text-align/background-color is over-control — start with one boolean that disables the entire `inherit !important` rule. Per-property is a follow-up if a real report demands selective override.
- **Default ON.** Preserves current #144 behavior. Office-paste users (the original reporters) keep working without changing anything. Inline-color users flip it off.

## Open questions

1. **Naming.** Three candidates discussed:
   - "Override embedded styling" — accurate but jargon
   - "Apply default body styling to all content" — clearer, default ON keeps current behavior
   - **"Honor inline color and font"** — flips the polarity (default OFF preserves current behavior), wording matches what users actually want when they hit the symptom ("I want my inline color honored") — recommended
2. **Card placement.** Goes under `contentFormatting` (alongside font, color, alignment) most naturally — it's a body-styling sibling. Could also live under `Stylesheet` since it's about stylesheet-vs-inline interaction. `contentFormatting` is the better fit since it only matters in default-body mode.
3. **Format-pane grey-out behavior** — when custom stylesheet is non-empty, should the property be disabled in the UI? Probably yes, to avoid "I toggled this and nothing happened" confusion.

## Implementation surface (rough scope, ~60-100 lines across 5-6 files)

- `capabilities.json` — new property in the contentFormatting card
- `src/visual-settings.ts` — formatting model entry (formattingSettings card)
- `src/domain-utils.ts` — `resolveStyling` reads the property and gates the class toggle
- `style/visual.less` — no change (the LESS rule stays as-is)
- `test/body-styling.test.ts` — new tests covering both override-on and override-off branches
- `test-uat/stylesheet.csv` (or a new card-state UAT fixture) — visual confirmation
- `docs/sanitization-rules.md` — update Troubleshooting entry: "supply any custom stylesheet" becomes one of two answers, with "toggle off Honor inline color and font" as the simpler one

## Knock-on changes (downstream of shipping the property)

- The cascade-override Troubleshooting entry just added to `docs/sanitization-rules.md` (under `### "My inline color / font-family / font-size is being ignored"`) needs rewording. The simpler resolution becomes: toggle off "Honor inline color and font" in the format pane. Custom stylesheet stays as the alternative for users who want full control.
- The `clean-color-style` UAT fixture in `test-integration/csp-harness/corpus.ts` documents the cascade-override behavior in its description. After this ships, the documented symptom has a third resolution path; description should mention all three.
- The compound learning at `docs/solutions/2026-05-issue-144-body-styling-cascade.md` deliberately notes the "supply any custom stylesheet" workaround. That doc isn't wrong but should be augmented with a forward pointer to the new property once it lands. (It's also a good candidate for a follow-up compound doc capturing this brainstorm's "we conflated two questions" learning.)

## Where we left off

- User asked: would a property work? → confirmed yes
- User restated the model: property = explicit "off switch" for the override; three first-class paths
- I confirmed the model is cleaner than the implicit gate, flagged the open questions above
- User asked to park this; context running low

## When resuming

1. Pick a name (recommend "Honor inline color and font", default OFF flips polarity to user intent)
2. Decide card placement (recommend contentFormatting)
3. Decide grey-out behavior when custom stylesheet present
4. Then either:
   - `/ce-plan` this for a structured implementation plan, or
   - Skip the plan and implement directly — the surface is small and well-bounded
