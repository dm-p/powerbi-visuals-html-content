# Legacy (v1.6) Rendering Compatibility Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the W3.CSS compat layer and the double-div default row template behind a persisted `compatibility.legacyRendering` toggle that auto-stamps ON for migrated 1.6 visuals and OFF for new ones.

**Architecture:** A pure classification module (`src/compatibility.ts`) resolves the mode each update from the raw persisted marker, a per-session cache, the data-bound heuristic, and the view mode; the visual wires it into `update()` and defers the one-time `persistProperties` stamp until after the rendering-event pair closes. The styling gate is a class on `#htmlContent` that the compat CSS scope requires; the row-structure gate switches the default row template by mode (an authored template always wins).

**Tech Stack:** TypeScript (Power BI custom visual), LESS, vitest, powerbi-visuals-api formatting model.

**Spec:** `docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md`

**Conventions for every task:** run tests with `npx vitest run <file>` from the repo root. Commit after each task with the message given. The repo pretest hook regenerates edition artifacts — that is expected noise, do not commit generated files (`src/sanitize/backend.ts`, `config/active-edition.mjs`, `src/visual-config.generated.ts` are git-ignored). Format any file you touch with `npx prettier --config .prettierrc <files> --write` before committing.

---

### Task 1: Pure classification module

**Files:**
- Create: `src/compatibility.ts`
- Test: `test/compatibility.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/compatibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type powerbi from 'powerbi-visuals-api';
import {
    resolveCompatibility,
    readPersistedLegacyRendering,
    dataViewHasContentRole,
    CompatibilityState
} from '../src/compatibility';

/**
 * Spec: docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md
 *
 * The persisted `compatibility.legacyRendering` bool doubles as the version
 * marker. Classification matrix: marker present/absent × data/no-data ×
 * editable/view, plus the per-session cache and once-per-session persist
 * guard. Persistence itself (the deferred persistProperties call) is wired in
 * src/visual.ts; this module only *decides*.
 */

const freshState = (): CompatibilityState => ({
    mode: undefined,
    persistAttempted: false
});

describe('resolveCompatibility', () => {
    it('persisted marker wins: true → legacy ON, no persist', () => {
        const state = freshState();
        const r = resolveCompatibility(true, state, false, true);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(false);
        expect(state.mode).toBe(true);
    });

    it('persisted marker wins: false → legacy OFF, no persist, even with data bound', () => {
        const state = freshState();
        const r = resolveCompatibility(false, state, true, true);
        expect(r.legacyRendering).toBe(false);
        expect(r.shouldPersist).toBe(false);
    });

    it('persisted marker overrides a stale session cache (pane toggle flip)', () => {
        const state: CompatibilityState = {
            mode: true,
            persistAttempted: true
        };
        const r = resolveCompatibility(false, state, true, true);
        expect(r.legacyRendering).toBe(false);
        expect(state.mode).toBe(false);
    });

    it('unclassified + data bound → legacy ON (migrated 1.6 visual)', () => {
        const r = resolveCompatibility(undefined, freshState(), true, true);
        expect(r.legacyRendering).toBe(true);
    });

    it('unclassified + no data → legacy OFF (fresh visual on landing page)', () => {
        const r = resolveCompatibility(undefined, freshState(), false, true);
        expect(r.legacyRendering).toBe(false);
    });

    it('editable + unclassified → shouldPersist true', () => {
        const r = resolveCompatibility(undefined, freshState(), true, true);
        expect(r.shouldPersist).toBe(true);
    });

    it('view mode → never persist', () => {
        const r = resolveCompatibility(undefined, freshState(), true, false);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(false);
    });

    it('session cache is authoritative once set: heuristic does not re-run', () => {
        // Session classified modern (no data at first update); data arrives
        // later the same session — mode must NOT flip to legacy.
        const state = freshState();
        resolveCompatibility(undefined, state, false, false);
        const r = resolveCompatibility(undefined, state, true, false);
        expect(r.legacyRendering).toBe(false);
    });

    it('persist guard: once attempted, never asks again this session', () => {
        const state: CompatibilityState = {
            mode: true,
            persistAttempted: true
        };
        const r = resolveCompatibility(undefined, state, true, true);
        expect(r.shouldPersist).toBe(false);
    });

    it('view-mode session later opened editable (same session) → persists the cached mode', () => {
        const state = freshState();
        resolveCompatibility(undefined, state, true, false);
        const r = resolveCompatibility(undefined, state, true, true);
        expect(r.legacyRendering).toBe(true);
        expect(r.shouldPersist).toBe(true);
    });
});

describe('readPersistedLegacyRendering', () => {
    it('returns undefined when the marker object is absent', () => {
        expect(readPersistedLegacyRendering(undefined)).toBeUndefined();
        expect(
            readPersistedLegacyRendering({
                metadata: {}
            } as unknown as powerbi.DataView)
        ).toBeUndefined();
    });

    it('returns the persisted bool when present', () => {
        const dv = {
            metadata: {
                objects: { compatibility: { legacyRendering: true } }
            }
        } as unknown as powerbi.DataView;
        expect(readPersistedLegacyRendering(dv)).toBe(true);
        const dv2 = {
            metadata: {
                objects: { compatibility: { legacyRendering: false } }
            }
        } as unknown as powerbi.DataView;
        expect(readPersistedLegacyRendering(dv2)).toBe(false);
    });
});

describe('dataViewHasContentRole', () => {
    it('false for undefined / empty dataViews', () => {
        expect(dataViewHasContentRole(undefined)).toBe(false);
        expect(dataViewHasContentRole([])).toBe(false);
    });

    it('false when no column carries the content role', () => {
        const dvs = [
            {
                metadata: { columns: [{ roles: { sampling: true } }] }
            }
        ] as unknown as powerbi.DataView[];
        expect(dataViewHasContentRole(dvs)).toBe(false);
    });

    it('true when a column carries the content role', () => {
        const dvs = [
            {
                metadata: {
                    columns: [
                        { roles: { sampling: true } },
                        { roles: { content: true } }
                    ]
                }
            }
        ] as unknown as powerbi.DataView[];
        expect(dataViewHasContentRole(dvs)).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/compatibility.test.ts`
Expected: FAIL — `Cannot find module '../src/compatibility'`

- [ ] **Step 3: Implement the module**

Create `src/compatibility.ts`:

```typescript
import type powerbi from 'powerbi-visuals-api';

/**
 * Legacy (v1.6) rendering compatibility classification.
 *
 * Spec: docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md
 *
 * The persisted `compatibility.legacyRendering` bool doubles as the version
 * marker: absent ⇒ the instance has never been classified. Classification is
 * resolved in-memory FIRST (rendering never waits on persistence); the caller
 * persists the marker only when the report is editable, deferred until after
 * the current update's rendering-event pair has closed (src/visual.ts).
 */

/** Per-session classification state, held on the visual instance. */
export interface CompatibilityState {
    /** Resolved mode for this session; undefined = not yet classified. */
    mode: boolean | undefined;
    /** True once a persist has been scheduled this session (guard). */
    persistAttempted: boolean;
}

export interface CompatibilityResolution {
    /** The mode this update must render with. */
    legacyRendering: boolean;
    /** True when the caller should schedule a persistProperties stamp. */
    shouldPersist: boolean;
}

/**
 * Resolve the rendering mode for one update. Mutates `state.mode` so the
 * session cache survives across updates. Precedence:
 *   1. persisted marker (also refreshes the session cache — the pane toggle
 *      writes through this path);
 *   2. session cache (heuristic runs at most once per session);
 *   3. data-bound heuristic: content role bound ⇒ migrated ⇒ legacy ON.
 * Persistence is requested only when the marker is absent, the report is
 * editable, and no persist has been attempted this session.
 */
export const resolveCompatibility = (
    persisted: boolean | undefined,
    state: CompatibilityState,
    hasContentRole: boolean,
    editable: boolean
): CompatibilityResolution => {
    if (persisted !== undefined) {
        state.mode = persisted;
        return { legacyRendering: persisted, shouldPersist: false };
    }
    if (state.mode === undefined) {
        state.mode = hasContentRole;
    }
    return {
        legacyRendering: state.mode,
        shouldPersist: editable && !state.persistAttempted
    };
};

/**
 * Raw marker read. Deliberately NOT the formatting-settings model, which
 * cannot distinguish "absent" from "explicitly set to the default".
 */
export const readPersistedLegacyRendering = (
    dataView: powerbi.DataView | undefined
): boolean | undefined => {
    const value =
        dataView?.metadata?.objects?.compatibility?.legacyRendering;
    return typeof value === 'boolean' ? value : undefined;
};

/**
 * "Data bound" per the spec: the update's dataViews carry the `content` role
 * (the same condition that takes the visual off the landing page).
 */
export const dataViewHasContentRole = (
    dataViews: powerbi.DataView[] | undefined
): boolean =>
    dataViews?.[0]?.metadata?.columns?.some((c) => c.roles?.content) ?? false;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/compatibility.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add src/compatibility.ts test/compatibility.test.ts
git commit -m "feat: add legacy-rendering compatibility classification module"
```

---

### Task 2: Capabilities object, settings card, localized strings

**Files:**
- Modify: `capabilities.json` (objects block)
- Modify: `capabilities.webaccess.json` (objects block — keep both variants in lockstep)
- Modify: `src/visual-settings.ts` (new card + model registration)
- Modify: `stringResources/en-US/resources.resjson`
- Test: `test/visual-settings.test.ts` (existing file — add cases)

- [ ] **Step 1: Write the failing test**

Add to `test/visual-settings.test.ts` (top-level, alongside the existing describes; reuse the file's existing imports of the model):

```typescript
describe('CompatibilitySettings', () => {
    it('registers the compatibility card on the model', () => {
        const model = new VisualFormattingSettingsModel();
        expect(model.compatibility).toBeDefined();
        expect(model.cards).toContain(model.compatibility);
    });

    it('legacyRendering toggle defaults to false and binds object/property names', () => {
        const model = new VisualFormattingSettingsModel();
        const toggle =
            model.compatibility.compatibilityCardMain.legacyRendering;
        expect(toggle.name).toBe('legacyRendering');
        expect(toggle.value).toBe(false);
        expect(model.compatibility.name).toBe('compatibility');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/visual-settings.test.ts`
Expected: FAIL — `model.compatibility` is undefined

- [ ] **Step 3: Add the capabilities object (both files)**

In `capabilities.json` AND `capabilities.webaccess.json`, add to the `"objects"` map (alongside `"crossFilter"`; property-type shapes mirror the existing objects):

```json
"compatibility": {
    "properties": {
        "legacyRendering": {
            "type": {
                "bool": true
            }
        }
    }
}
```

- [ ] **Step 4: Add the settings card**

In `src/visual-settings.ts`, add below `CrossFilterSettings`/`CrossFilterCardMain` (mirroring their shape exactly):

```typescript
/**
 * Compatibility card: legacy (v1.6) rendering toggle. The persisted value
 * doubles as the migration version marker — see src/compatibility.ts and
 * docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md.
 */
export class CompatibilitySettings extends FormattingSettingsCompositeCard {
    name = 'compatibility';
    displayNameKey = 'Objects_Compatibility';
    descriptionKey = 'Objects_Compatibility_Description';
    compatibilityCardMain = new CompatibilityCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.compatibilityCardMain];
}

/** Main compatibility group: the single legacy-rendering toggle. */
class CompatibilityCardMain extends FormattingSettingsGroup {
    name = 'compatibility-main';
    // Default false = modern. The default is rarely load-bearing: the visual
    // stamps an explicit value on first classification (src/compatibility.ts).
    legacyRendering = new formattingSettings.ToggleSwitch({
        name: 'legacyRendering',
        displayNameKey: 'Objects_Compatibility_LegacyRendering',
        descriptionKey: 'Objects_Compatibility_LegacyRendering_Description',
        value: false
    });
    slices: Array<FormattingSettingsSlice> = [this.legacyRendering];
}
```

Then register it on the model (`src/visual-settings.ts:17-27`):

```typescript
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    contentFormatting = new ContentFormattingSettings();
    stylesheet = new StylesheetSettings();
    crossFilter = new CrossFilterSettings();
    templates = new TemplatesSettings();
    compatibility = new CompatibilitySettings();
    cards = [
        this.contentFormatting,
        this.stylesheet,
        this.templates,
        this.crossFilter,
        this.compatibility
    ];
```

- [ ] **Step 5: Add localized strings**

In `stringResources/en-US/resources.resjson`, add (alphabetical placement near the other `Objects_` keys):

```json
"Objects_Compatibility": "Compatibility",
"Objects_Compatibility_Description": "Compatibility options for reports built with earlier versions of the visual.",
"Objects_Compatibility_LegacyRendering": "Use legacy (v1.6) rendering",
"Objects_Compatibility_LegacyRendering_Description": "Render content with the v1.6 styling rules and row structure. Turned on automatically for reports migrated from v1.6; off for new visuals.",
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/visual-settings.test.ts && npx vitest run test/capabilities-editions.test.ts`
Expected: PASS. If `capabilities-editions.test.ts` asserts object parity between the two capabilities files, the lockstep edit in Step 3 keeps it green — if it fails, the diff it reports tells you which file is missing the object.

- [ ] **Step 7: Commit**

```bash
git add capabilities.json capabilities.webaccess.json src/visual-settings.ts stringResources/en-US/resources.resjson test/visual-settings.test.ts
git commit -m "feat: add compatibility.legacyRendering capability, settings card, strings"
```

---

### Task 3: Visual wiring — classify each update, persist after the event pair closes

**Files:**
- Modify: `src/visual.ts` (`update()`, `getFormattingModel()`, new private members)
- Test: `test/compatibility.test.ts` (already covers the decision logic; this task is wiring, verified by the full suite + compile)

- [ ] **Step 1: Add imports and instance state**

In `src/visual.ts`, add to the imports:

```typescript
import {
    resolveCompatibility,
    readPersistedLegacyRendering,
    dataViewHasContentRole,
    CompatibilityState
} from './compatibility';
```

Add instance fields alongside the other private members:

```typescript
// Legacy (v1.6) rendering classification — session cache + persist guard.
// See src/compatibility.ts and the brainstorm doc it references.
private compatState: CompatibilityState = {
    mode: undefined,
    persistAttempted: false
};
private pendingCompatPersist = false;
```

- [ ] **Step 2: Classify at the top of update(), flush after the try/catch**

Modify `update()` (currently `src/visual.ts:271-286`) to:

```typescript
public update(options: VisualUpdateOptions) {
    const { viewModel } = this.viewModelHandler;
    this.formattingSettings =
        this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews?.[0]
        );

    this.resolveCompatibilityForUpdate(options);
    const diagActive = this.resolveDiagnosticsActivation(options);

    try {
        this.renderUpdate(options, viewModel, diagActive);
    } catch (e) {
        this.handleUpdateFailure(options, e);
    }
    // Runs strictly after renderingFinished/renderingFailed has been
    // signalled for this update, so the persist echo is a fresh cycle and
    // the 1:1 update→rendering-event contract holds (spec: update-cycle
    // discipline).
    this.flushCompatibilityPersist();
}
```

- [ ] **Step 3: Add the two private methods**

Add near `resolveDiagnosticsActivation`:

```typescript
/**
 * Resolve the legacy-rendering mode for this update (in-memory first —
 * rendering never waits on persistence). Persist is requested only when
 * the marker is absent, the report is editable (ViewMode.Edit = 1 /
 * InFocusEdit = 2 — same convention as resolveDiagnosticsActivation),
 * and none has been attempted this session.
 */
private resolveCompatibilityForUpdate(options: VisualUpdateOptions): void {
    const resolution = resolveCompatibility(
        readPersistedLegacyRendering(options.dataViews?.[0]),
        this.compatState,
        dataViewHasContentRole(options.dataViews),
        options.viewMode === 1 || options.viewMode === 2
    );
    this.compatState.mode = resolution.legacyRendering;
    this.pendingCompatPersist = resolution.shouldPersist;
}

/**
 * Stamp the classification marker. Called after the rendering-event pair
 * for the current update has closed; the setTimeout pushes the host call
 * out of the current task so the persist echo arrives as an ordinary new
 * update with its own event pair. Guarded to once per session.
 */
private flushCompatibilityPersist(): void {
    if (!this.pendingCompatPersist) return;
    this.pendingCompatPersist = false;
    this.compatState.persistAttempted = true;
    const legacyRendering = this.compatState.mode === true;
    setTimeout(() => {
        this.host.persistProperties({
            merge: [
                {
                    objectName: 'compatibility',
                    selector: null,
                    properties: { legacyRendering }
                }
            ]
        });
    }, 0);
}
```

- [ ] **Step 4: Compile and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean compile, all tests PASS (wiring only — no behaviour asserted yet renders differently because nothing consumes `compatState.mode` until Tasks 4–5).

- [ ] **Step 5: Commit**

```bash
git add src/visual.ts
git commit -m "feat: classify legacy-rendering mode per update, persist marker post-render"
```

---

### Task 4: Styling gate — class-scope the W3.CSS compat layer

**Files:**
- Modify: `src/visual-constants.ts` (`dom` block, around line 248)
- Modify: `style/visual.less` (the `:where(#htmlContent)` compat block)
- Modify: `src/visual.ts` (`buildRenderSteps().resolveContainer`)
- Test: `test/w3-compat.test.ts`

- [ ] **Step 1: Update the w3-compat tests to demand the class-gated scope**

In `test/w3-compat.test.ts`, replace every selector string `:where(#htmlContent)` with `:where(#htmlContent.hc-legacy-v1)` (in `ruleBody(...)` calls — e.g. `ruleBody(':where(#htmlContent.hc-legacy-v1) img')` — and in the heading/sub-sup/code compound selectors). Update the header comment's scoping bullet to say the rules additionally require the `hc-legacy-v1` class that `src/visual.ts` toggles from the compatibility mode. Then extend the leak test so ungated compat rules are also offenders:

```typescript
    it('does not leak bare element selectors outside the gated #htmlContent scope', () => {
        // The compat rules must never apply to the landing page or
        // diagnostics surfaces, and must not fire at all without the
        // legacy class: no compiled rule may target a bare element
        // selector, and no :where(#htmlContent ...) scope may omit the
        // .hc-legacy-v1 gate.
        const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
        const offenders: string[] = [];
        for (const [, sel] of rules) {
            for (const part of sel.split(',')) {
                const s = part.replace(/\s+/g, ' ').trim();
                if (/^(img|h[1-6]|a|hr|sub|sup|code|kbd|pre|samp|summary)$/.test(s)) {
                    offenders.push(s);
                }
                if (
                    s.includes(':where(#htmlContent') &&
                    !s.includes('.hc-legacy-v1')
                ) {
                    offenders.push(s);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
```

- [ ] **Step 2: Run to verify the updated tests fail**

Run: `npx vitest run test/w3-compat.test.ts`
Expected: FAIL — every `ruleBody(':where(#htmlContent.hc-legacy-v1) …')` returns null (the LESS still uses the ungated scope, which now also trips the leak test).

- [ ] **Step 3: Add the class constant**

In `src/visual-constants.ts`, add to the `dom` block (alongside `entryClassSelector`):

```typescript
        // Gates the W3.CSS 1.6-compat layer in style/visual.less; toggled on
        // #htmlContent by the resolveContainer render step from the
        // compatibility classification (legacy ON ⇒ class present).
        legacyStylingClass: 'hc-legacy-v1',
```

- [ ] **Step 4: Gate the LESS scope**

In `style/visual.less`, change the compat block's wrapper selector (single line):

```less
:where(#htmlContent.hc-legacy-v1) {
```

and update the block's scoping comment sentence to note the class gate: the rules apply only in legacy (v1.6) rendering mode — `src/visual.ts` toggles `hc-legacy-v1` (VisualConstants.dom.legacyStylingClass) on `#htmlContent`; `:where()` still zeroes the scope's specificity so user stylesheets keep winning ties.

- [ ] **Step 5: Toggle the class in the render path**

In `src/visual.ts` `buildRenderSteps()`, `resolveContainer` runs every update — add the toggle:

```typescript
            resolveContainer: (settings) => {
                this.contentContainer.classed(
                    VisualConstants.dom.legacyStylingClass,
                    this.compatState.mode === true
                );
                resolveStyling(
                    this.styleSheetContainer,
                    this.container,
                    settings
                );
                this.scrollbars = resolveScrollableContent(
                    this.container.node() as HTMLDivElement,
                    this.scrollbars
                );
            },
```

(`VisualConstants` is already imported in `src/visual.ts`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/w3-compat.test.ts && npx tsc --noEmit`
Expected: PASS / clean compile.

- [ ] **Step 7: Commit**

```bash
git add src/visual-constants.ts style/visual.less src/visual.ts test/w3-compat.test.ts
git commit -m "feat: gate W3.CSS 1.6-compat styling behind hc-legacy-v1 class"
```

---

### Task 5: Row-structure gate — per-mode default row template

**Files:**
- Modify: `src/visual-constants.ts` (`templates` block, ~line 237)
- Modify: `src/visual-settings.ts` (rowTemplate TextArea, ~line 316)
- Modify: `src/template-engine.ts` (`resolveRowTemplate`)
- Modify: `src/view-model.ts` (`IViewModel`, `reset()`, `mapDataView` signature + body)
- Modify: `src/render-orchestrator.ts` (`computeRenderFingerprint` + its call in `render()`)
- Modify: `src/visual.ts` (`renderUpdate` mapDataView call, `getFormattingModel` placeholder)
- Test: `test/template-engine.test.ts`, plus updates to existing callers in `test/view-model.test.ts` / `test/render-orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/template-engine.test.ts` (reusing its existing settings-fixture helper for `VisualFormattingSettingsModel` — the file already constructs models for `resolveBodyTemplate` tests):

```typescript
describe('resolveRowTemplate — per-mode defaults', () => {
    it('legacy mode default is the double-div 1.6 structure', () => {
        const settings = new VisualFormattingSettingsModel();
        expect(resolveRowTemplate(settings, true)).toBe(
            '<div><div>{{row}}</div></div>'
        );
    });

    it('modern mode default is the single-div structure', () => {
        const settings = new VisualFormattingSettingsModel();
        expect(resolveRowTemplate(settings, false)).toBe('<div>{{row}}</div>');
    });

    it('an authored row template wins in BOTH modes', () => {
        const settings = new VisualFormattingSettingsModel();
        settings.templates.templatesCardMain.rowTemplate.value =
            '<section>{{row}}</section>';
        expect(resolveRowTemplate(settings, true)).toBe(
            '<section>{{row}}</section>'
        );
        expect(resolveRowTemplate(settings, false)).toBe(
            '<section>{{row}}</section>'
        );
    });

    it('whitespace-only authored value falls back to the mode default', () => {
        const settings = new VisualFormattingSettingsModel();
        settings.templates.templatesCardMain.rowTemplate.value = '   ';
        expect(resolveRowTemplate(settings, true)).toBe(
            '<div><div>{{row}}</div></div>'
        );
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/template-engine.test.ts`
Expected: FAIL — `resolveRowTemplate` takes one argument and returns the legacy default unconditionally.

- [ ] **Step 3: Split the template constants**

In `src/visual-constants.ts` (`templates` block):

```typescript
    templates: {
        body: '{{content}}',
        // Legacy (v1.6) default: preserves 1.6's entry-div > inner-div
        // nesting byte-for-byte. Modern default drops the inner wrapper.
        // Selected per compatibility mode by resolveRowTemplate when the
        // user has not authored a row template.
        row: '<div><div>{{row}}</div></div>',
        rowModern: '<div>{{row}}</div>'
    },
```

- [ ] **Step 4: Make "unauthored" representable**

In `src/visual-settings.ts`, change the rowTemplate TextArea default so an untouched pane persists nothing and the empty value means "use the mode default" (`placeholder` is refreshed per-mode by `getFormattingModel` — Step 7):

```typescript
    rowTemplate = new formattingSettings.TextArea({
        name: 'rowTemplate',
        displayNameKey: 'Objects_Templates_RowTemplate',
        descriptionKey: 'Objects_Templates_RowTemplate_Description',
        placeholder: '<div><div>{{row}}</div></div>',
        // Empty = "not authored": resolveRowTemplate falls back to the
        // compatibility-mode default (VisualConstants.templates.row /
        // rowModern). A non-empty value always wins, in both modes.
        value: ''
    });
```

- [ ] **Step 5: Re-implement resolveRowTemplate**

In `src/template-engine.ts` (add the `VisualConstants` import at the top: `import { VisualConstants } from './visual-constants';`):

```typescript
/**
 * The row template — the authored value when one is set (non-blank), else
 * the compatibility-mode default (legacy double-div / modern single-div).
 */
export function resolveRowTemplate(
    settings: VisualFormattingSettingsModel,
    legacyRendering: boolean
): string {
    const authored = settings.templates.templatesCardMain.rowTemplate.value;
    if (authored && authored.trim().length > 0) {
        return authored;
    }
    return legacyRendering
        ? VisualConstants.templates.row
        : VisualConstants.templates.rowModern;
}
```

- [ ] **Step 6: Thread the mode through the view model**

In `src/view-model.ts`:

1. Add to the `IViewModel` interface (alongside `bodyTemplate: string`): `rowTemplate: string;`
2. In `reset()` (the object literal around line 80), add: `rowTemplate: VisualConstants.templates.row,`
3. Change `mapDataView` to accept the mode and use the resolved value (signature + the `resolveRowTemplate` line + a viewModel assignment):

```typescript
    mapDataView(
        dataViews: DataView[],
        settings: VisualFormattingSettingsModel,
        host: IVisualHost,
        legacyRendering: boolean
    ) {
```

```typescript
            const rowTemplate = resolveRowTemplate(settings, legacyRendering);
```

and alongside the existing `this.viewModel.bodyTemplate = …` assignment:

```typescript
            this.viewModel.rowTemplate = rowTemplate;
```

- [ ] **Step 7: Fingerprint the resolved row template; pass the mode from the visual**

In `src/render-orchestrator.ts`:

1. `computeRenderFingerprint` gains a param and stops reading the static setting (replace the `settings.templates.templatesCardMain.rowTemplate.value` array entry):

```typescript
export function computeRenderFingerprint(
    settings: VisualFormattingSettingsModel,
    resolvedBodyTemplate?: string,
    resolvedRowTemplate?: string
): string {
```

```typescript
        resolvedRowTemplate ??
            settings.templates.templatesCardMain.rowTemplate.value
```

2. In `render()` (line ~110), pass it:

```typescript
        const fingerprint = computeRenderFingerprint(
            settings,
            viewModel.bodyTemplate,
            viewModel.rowTemplate
        );
```

In `src/visual.ts`:

3. `renderUpdate` — pass the mode to `mapDataView`:

```typescript
            viewModel.isValid &&
                this.viewModelHandler.mapDataView(
                    options.dataViews,
                    this.formattingSettings,
                    this.host,
                    this.compatState.mode === true
                );
```

4. `getFormattingModel` — surface the active default as the pane placeholder:

```typescript
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        // The row-template placeholder mirrors the active compatibility-mode
        // default so the pane shows what actually renders when unauthored.
        this.formattingSettings.templates.templatesCardMain.rowTemplate.placeholder =
            this.compatState.mode === true
                ? VisualConstants.templates.row
                : VisualConstants.templates.rowModern;
        return this.formattingSettingsService.buildFormattingModel(
            this.formattingSettings
        );
    }
```

- [ ] **Step 8: Fix existing callers/tests that the signature changes break**

Run: `npx tsc --noEmit && npx vitest run`
Expected failures to fix (compile errors point at each site):
- `test/view-model.test.ts` — every `mapDataView(dataViews, settings, host)` call gains a 4th arg. Pass `true` (these tests assert the 1.6-parity double-div output; legacy mode preserves their expectations). Where a test explicitly builds settings with an authored rowTemplate, the mode value is irrelevant — still pass `true` for uniformity.
- Any `computeRenderFingerprint(settings, body)` test calls keep working (new param optional) — but add one case to `test/render-orchestrator.test.ts`:

```typescript
    it('fingerprint changes when the resolved row template changes (mode flip)', () => {
        const settings = new VisualFormattingSettingsModel();
        const legacy = computeRenderFingerprint(
            settings,
            '{{content}}',
            '<div><div>{{row}}</div></div>'
        );
        const modern = computeRenderFingerprint(
            settings,
            '{{content}}',
            '<div>{{row}}</div>'
        );
        expect(legacy).not.toBe(modern);
    });
```

- Any test asserting the rowTemplate TextArea default equals the double-div string now expects `''`.

Re-run until green: `npx tsc --noEmit && npx vitest run`
Expected: PASS (full suite).

- [ ] **Step 9: Commit**

```bash
git add src/visual-constants.ts src/visual-settings.ts src/template-engine.ts src/view-model.ts src/render-orchestrator.ts src/visual.ts test/template-engine.test.ts test/view-model.test.ts test/render-orchestrator.test.ts
git commit -m "feat: per-compatibility-mode default row template (legacy double-div / modern single-div)"
```

---

### Task 6: Full verification + package

**Files:** none new — verification only.

- [ ] **Step 1: Full suite, lint, formatting**

Run: `npm test && npx eslint . && npx prettier --config .prettierrc "{src,style}/**/{*.ts,*.less}" --check`
Expected: all green. If prettier reports drift, fix with `--write` and commit separately as `chore: formatting`.

- [ ] **Step 2: Package the certified edition and verify the gated CSS shipped**

Run: `npm run package`
Then verify the compat rules in the shipped bundle are class-gated (repeat of this morning's check — beware `dist/` holds stale packages; pick by newest mtime, not name):

```powershell
$p = Get-ChildItem dist\*.pbiviz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($p.FullName)
$entry = $zip.Entries | Where-Object Name -like "*.pbiviz.json"
$json = (New-Object System.IO.StreamReader($entry.Open())).ReadToEnd() | ConvertFrom-Json
$css = $json.content.css
"gated rules: " + ([regex]::Matches($css, ':where\(#htmlContent\.hc-legacy-v1\)')).Count
"ungated rules: " + ([regex]::Matches($css, ':where\(#htmlContent\)[^.]')).Count
$zip.Dispose()
```

Expected: `gated rules:` ≥ 17, `ungated rules: 0`.

- [ ] **Step 3: Commit anything outstanding and stop**

```bash
git status
```

Expected: clean tree apart from pre-existing untracked files. Do NOT open a PR — the feature is held for the user's Power BI Desktop UAT (repo convention), which must cover: (1) the flags 1.6-migration workbook classifies legacy ON and renders 48px flush rows; (2) a freshly added visual classifies modern OFF (single-div rows, no compat CSS); (3) flipping the pane toggle re-renders both gates both ways; (4) view-mode open of an unstamped report triggers no persist (no unsaved-changes dirty flag); (5) certified rendering events still pair 1:1 (no spinner hang) in both view and edit modes.

---

## Self-review notes (kept for the executor)

- Spec coverage: property+marker (Task 2+3), heuristic + session cache + view-mode/no-persist + post-event persist (Tasks 1+3), styling gate + `:where` specificity guarantee (Task 4), row-structure gate + authored-template supremacy + pane placeholder (Task 5), testing section (Tasks 1, 2, 4, 5), UAT items (Task 6).
- The spec's "toggle flip re-renders both gates" is covered by: fingerprint includes the resolved row template (rebuild on flip) and the class toggle runs in `resolveContainer` every update (CSS flips immediately).
- Deliberate deviation from the brainstorm's letter, same spirit: "authored" is detected via the settings value with an `''` default (a persisted value is by definition authored) rather than a raw `metadata.objects.templates.rowTemplate` read — equivalent outcome, one less raw-objects code path. The empty-string edge (author saves a blank template) now falls back to the mode default instead of rendering nothing; noted in Task 5 Step 4's comment.
