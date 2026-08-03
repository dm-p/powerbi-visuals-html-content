# Cross-Filter Requires a Column in Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cross-filtering (both the behavior and the format-pane card) is only enabled when the Context data role contains at least one **column** — measures alone don't count, because selecting by measure identity cross-filters nothing useful.

**Architecture:** The Context role's internal name is `sampling` (renamed to "Context" in the UI, PR #182), and it accepts `GroupingOrMeasure`. Today `hasGranularity = columns.some((c) => c.roles?.sampling)` in `src/view-model.ts` gates three things: the `hasCrossFiltering` flag (which `src/interactivity/behavior.ts` consumes), the cross-filter card visibility in `src/visual-settings.ts`, and tooltip/hover binding in `src/interactivity/tooltips.ts`. Tooltips and hover are still correct for measures in Context, so `hasGranularity` keeps its meaning untouched. We add a new view-model flag `hasContextColumns` (`sampling` role AND `!isMeasure` — measure metadata columns carry `isMeasure: true`, category columns don't) and switch only the two cross-filter consumers to it. `behavior.ts` needs no change; it already reads `hasCrossFiltering`.

**Tech Stack:** TypeScript Power BI custom visual; tests are Vitest (`npm test` runs `vitest run`; a `pretest` hook runs `select-edition.mjs certified` — that's expected noise, not an error).

**Plan location note:** Saved to `docs/plans/` per this repo's convention (not the superpowers default path).

---

### Task 1: `hasContextColumns` flag in the view model

**Files:**
- Modify: `src/view-model.ts` (interface ~line 25, `reset()` ~line 74, `mapDataView()` ~line 137)
- Test: `test/view-model.test.ts`
- Modify: `test/visual-settings.test.ts` (mock object typed as `IViewModel` — needs the new required field to stay type-correct)

- [ ] **Step 1: Write the failing tests**

In `test/view-model.test.ts`, inside the `describe('mapDataView', ...)` block (after the existing test `'should set hasCrossFiltering when enabled in settings'`, ~line 475), add:

```ts
        it('should not enable cross-filtering when Context holds only measures', () => {
            const settingsWithCrossFilter = {
                ...mockSettings,
                crossFilter: {
                    crossFilterCardMain: {
                        enabled: { value: true }
                    }
                }
            } as any;

            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Sales',
                                queryName: 'qm',
                                isMeasure: true
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        values: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Sales',
                                    queryName: 'qm',
                                    isMeasure: true
                                },
                                values: [100]
                            },
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: ['<p>Test</p>']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(
                dataViews,
                settingsWithCrossFilter,
                mockHost,
                true
            );

            // Measures in Context still count as granularity (tooltips/hover)…
            expect(handler.viewModel.hasGranularity).toBe(true);
            // …but must not enable cross-filtering.
            expect(handler.viewModel.hasContextColumns).toBe(false);
            expect(handler.viewModel.hasCrossFiltering).toBe(false);
        });

        it('should set hasContextColumns when Context holds a column, even alongside a measure', () => {
            const settingsWithCrossFilter = {
                ...mockSettings,
                crossFilter: {
                    crossFilterCardMain: {
                        enabled: { value: true }
                    }
                }
            } as any;

            const dataViews: any[] = [
                {
                    metadata: {
                        columns: [
                            {
                                roles: { sampling: true },
                                displayName: 'Category',
                                queryName: 'qs'
                            },
                            {
                                roles: { sampling: true },
                                displayName: 'Sales',
                                queryName: 'qm',
                                isMeasure: true
                            },
                            {
                                roles: { content: true },
                                displayName: 'HTML',
                                queryName: 'q0'
                            }
                        ]
                    },
                    categorical: {
                        categories: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Category',
                                    queryName: 'qs'
                                },
                                values: ['A']
                            }
                        ],
                        values: [
                            {
                                source: {
                                    roles: { sampling: true },
                                    displayName: 'Sales',
                                    queryName: 'qm',
                                    isMeasure: true
                                },
                                values: [100]
                            },
                            {
                                source: {
                                    roles: { content: true },
                                    displayName: 'HTML',
                                    queryName: 'q0'
                                },
                                values: ['<p>Test</p>']
                            }
                        ]
                    }
                }
            ];

            handler.validateDataView(dataViews);
            handler.mapDataView(
                dataViews,
                settingsWithCrossFilter,
                mockHost,
                true
            );

            expect(handler.viewModel.hasContextColumns).toBe(true);
            expect(handler.viewModel.hasCrossFiltering).toBe(true);
        });
```

Also extend the first test in `describe('constructor and reset', ...)` (~line 12, `'should initialize with default view model'`): after the line `expect(handler.viewModel.hasGranularity).toBe(false);` add:

```ts
            expect(handler.viewModel.hasContextColumns).toBe(false);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/view-model.test.ts`
Expected: the two new `mapDataView` tests FAIL — `hasContextColumns` is `undefined`, so `expect(...).toBe(false)` fails in the measure-only test (and `.toBe(true)` fails in the column test). The `hasCrossFiltering` assertion in the measure-only test also fails (currently `true`). The extended init test fails on `undefined !== false`.

- [ ] **Step 3: Implement the flag in `src/view-model.ts`**

Three edits.

(a) In `IViewModel` (~line 28), after `hasCrossFiltering: boolean;`:

```ts
    hasCrossFiltering: boolean;
    hasContextColumns: boolean;
    hasGranularity: boolean;
```

(b) In `reset()` (~line 77), after `hasCrossFiltering: false,`:

```ts
            hasCrossFiltering: false,
            hasContextColumns: false,
            hasGranularity: false,
```

(c) In `mapDataView()` (~lines 137–140), replace:

```ts
            const hasGranularity = columns.some((c) => c.roles?.sampling);
            const hasCrossFiltering =
                hasGranularity &&
                settings.crossFilter.crossFilterCardMain.enabled.value;
```

with:

```ts
            const hasGranularity = columns.some((c) => c.roles?.sampling);
            // Cross-filtering needs a column (grouping) in the Context role;
            // measures produce no useful selection identity to filter by.
            const hasContextColumns = columns.some(
                (c) => c.roles?.sampling && !c.isMeasure
            );
            const hasCrossFiltering =
                hasContextColumns &&
                settings.crossFilter.crossFilterCardMain.enabled.value;
```

and further down (~line 177), alongside the other flag assignments, add:

```ts
            this.viewModel.hasCrossFiltering = hasCrossFiltering;
            this.viewModel.hasContextColumns = hasContextColumns;
            this.viewModel.hasGranularity = hasGranularity;
```

(d) `IViewModel` gained a required field, so the `mockViewModel` literal in `test/visual-settings.test.ts` (typed `IViewModel`, `beforeEach` ~line 13) must include it. After `hasCrossFiltering: false,` add:

```ts
            hasCrossFiltering: false,
            hasContextColumns: false,
            hasGranularity: false,
```

- [ ] **Step 4: Run the full test suite to verify it passes**

Run: `npm test`
Expected: PASS — all suites green, including the two new tests and the existing `'should set hasCrossFiltering when enabled in settings'` (its Context field is a category column, so it still cross-filters).

- [ ] **Step 5: Commit**

```bash
git add src/view-model.ts test/view-model.test.ts test/visual-settings.test.ts
git commit -m "fix: cross-filtering requires a column in the Context role"
```

---

### Task 2: Format-pane card visibility follows the column-only flag

**Files:**
- Modify: `src/visual-settings.ts:42`
- Test: `test/visual-settings.test.ts` (crossFilter visibility block, ~lines 99–170)

- [ ] **Step 1: Write the failing test and retarget existing ones**

In `test/visual-settings.test.ts`, inside `describe('crossFilter visibility', ...)`:

(a) Add a new test after the existing `'should hide crossFilter card when hasGranularity is false'` (~line 106):

```ts
            it('should hide crossFilter card when Context holds only measures', () => {
                mockViewModel.hasGranularity = true;
                mockViewModel.hasContextColumns = false;

                settings.handlePropertyVisibility(mockViewModel);

                expect(settings.crossFilter.visible).toBe(false);
            });
```

(b) The five existing tests in this block that set `mockViewModel.hasGranularity = true;` (~lines 108–169: `'should show useTransparency…'`, `'should hide useTransparency…'`, `'should show transparencyPercent…'`, and the two `'should hide transparencyPercent…'` tests) now exercise the column-only gate. In each, replace:

```ts
                mockViewModel.hasGranularity = true;
```

with:

```ts
                mockViewModel.hasContextColumns = true;
```

and update their names from `hasGranularity` to `hasContextColumns` (e.g. `'should show useTransparency when hasContextColumns and enabled'`).

(c) Rename the first test and its setter to match the new gate:

```ts
            it('should hide crossFilter card when hasContextColumns is false', () => {
                mockViewModel.hasContextColumns = false;

                settings.handlePropertyVisibility(mockViewModel);

                expect(settings.crossFilter.visible).toBe(false);
            });
```

- [ ] **Step 2: Run the tests to verify the right ones fail**

Run: `npm test -- test/visual-settings.test.ts`
Expected: the new measure-only test FAILS (`crossFilter.visible` is `true` because the source still checks `hasGranularity`), and the five retargeted "show/hide useTransparency/transparencyPercent" tests FAIL (card is hidden because `hasGranularity` is now `false` in the mock). The two "hide when … false" tests pass.

- [ ] **Step 3: Implement the visibility change**

In `src/visual-settings.ts`, `handlePropertyVisibility` (~line 42), replace:

```ts
        if (viewModel.hasGranularity) {
```

with:

```ts
        if (viewModel.hasContextColumns) {
```

- [ ] **Step 4: Run the full test suite to verify it passes**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/visual-settings.ts test/visual-settings.test.ts
git commit -m "fix: hide cross-filter card unless Context holds a column"
```

---

## Out of scope (deliberate)

- `hasGranularity` semantics and its consumers (`resolveHover` / tooltip binding in `src/interactivity/tooltips.ts`) are unchanged — measures in Context still produce tooltips on hover, which is correct.
- `src/interactivity/behavior.ts` needs no change: it gates on `viewModel.hasCrossFiltering`, which Task 1 already tightens.
- No capabilities.json, resjson string, or docs changes. If UAT shows authors are confused about why the card disappears with measures-only Context, a follow-up could add a note to the `Roles_Sampling_Description` string — not doing it speculatively.

## Manual UAT (after both tasks)

In Power BI Desktop with the dev visual:
1. Context = one column → cross-filter card visible; enabling it makes row clicks cross-filter. (Existing behavior, unchanged.)
2. Context = one measure only → cross-filter card hidden; row clicks do nothing; tooltips still show the measure value on hover.
3. Context = column + measure → card visible and cross-filtering works.
