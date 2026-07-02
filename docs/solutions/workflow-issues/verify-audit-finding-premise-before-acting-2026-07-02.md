---
title: "Verify an audit finding's premise against the actual runtime before acting"
date: 2026-07-02
category: workflow-issues
module: audit workflow
problem_type: workflow_issue
component: development_workflow
severity: low
applies_when:
  - "An audit or review raises a speculative finding without a reproduction"
  - "The premise depends on library defaults (e.g. DOMPurify target-stripping) that may already neutralize it"
  - "The premise depends on host runtime semantics (e.g. Power BI Desktop live-update behavior)"
  - "Deciding whether to patch a finding or close it as a non-issue"
related_components:
  - src/sanitize
tags:
  - audit
  - verify-premise
  - false-positive
  - runtime-verification
  - reverse-tabnabbing
  - dompurify
  - speculative-finding
---

# Verify an audit finding's premise against the actual runtime before acting

## Context

An AI-assisted security/quality audit produced two plausibly-worded, literally-actionable findings. Both were **false** — each rested on a wrong assumption about how a dependency (DOMPurify) or the host (Power BI Desktop) actually behaves. Acting on the words of the finding would, in one case, have broken a passing test; in the other, wasted effort on a non-bug.

- **Finding L2 — anchor reverse-tabnabbing.** Premise: "an author can emit a surviving `target="_blank"`, so we need to force `rel=noopener`." Reality: DOMPurify strips `target` by default as built-in tabnabbing protection — it never reaches the visual's per-tag allowlist hook. This is locked by the fixture `hyperlinks-target-stripped-rel-preserved` in [test/fixtures/hyperlinks.ts](../../../test/fixtures/hyperlinks.ts), whose input is `<a href="…" target="_blank" rel="noopener">` and whose expectation is that `target` is gone and `rel` survives.
- **Finding M2 — template edits coupled to a Data-bit remap don't apply live.** Premise: "a format-pane template edit arrives without `VisualUpdateType.Data`, so the visual won't re-render." Reality: manual repro in Power BI Desktop showed body and row template edits **do** apply live in both render modes — Desktop includes the Data bit on those updates.

## Guidance

Before changing code to satisfy an audit finding, **confirm the finding's premise against ground truth** — a fixture, a test, or a live repro — not against the finding's own wording. Then let what you confirm dictate the action.

- **L2 — actual action (commit `7182672`):** the premise was false, so the literal fix (harden/drop `rel` in the allowlist) was wrong — dropping `rel` would have **broken** the fixture that asserts `rel` survives. Instead, remove only the **dead** `target` entry and document why:

  ```ts
  // before
  a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
  // after — `target` is stripped upstream by DOMPurify, so listing it was dead.
  // See the hyperlinks-target-stripped-rel-preserved fixture. `rel` is kept.
  a: ['href', 'rel', 'download', 'hreflang', 'type'],
  ```

  This closes the item as *already-mitigated* (behavior-neutral cleanup) rather than as a live gap.

- **M2 — actual action:** closed with **no code change** after a live repro disproved the premise.

## Why This Matters

A finding can be fluent, specific, and cite a real vulnerability class (reverse tabnabbing) yet be grounded in a wrong assumption about library or host defaults. Acting on the words can:

- **Introduce a regression** — dropping `rel` to "fix tabnabbing" breaks a fixture documenting the real, safe behavior.
- **Waste effort on a non-bug** — building a Data-bit workaround for a re-render that already happens.
- **Erase institutional knowledge** — deleting the "dead" `target` entry without documenting *why* it's safe invites a future contributor to add it back.

The premise is the load-bearing part of any finding. Verifying it is cheaper than implementing the wrong fix and re-reviewing it.

## When to Apply

Apply whenever a finding comes from an automated/AI audit, an unfamiliar contributor, or your own quick read, **and** it depends on behavior you have not personally confirmed in this codebase — especially:

- "The library allows/permits X" (defaults change between versions; DOMPurify strips `target` by default).
- "The host sends/omits event flag Y" (host update semantics are opaque and version-specific).
- "This attribute/scheme/tag survives sanitization."

Cheapest-first verification ladder: (1) grep for a fixture or test that already pins the behavior; (2) write a one-off test; (3) reproduce live in the real host. Only after the premise holds do you design the fix.

## Examples

- **Fixture as the verifier (L2):** `hyperlinks-target-stripped-rel-preserved` in [test/fixtures/hyperlinks.ts](../../../test/fixtures/hyperlinks.ts) records that DOMPurify *removes* `target` rather than rewriting it to `rel="noopener noreferrer"`, and that this has no functional impact because clicks delegate to `host.launchUrl`. The fixture both disproved the premise and guarded against the literal fix.
- **Differential test as the verifier (M2):** compare a **known-live control property** against the **suspect property** under the same edit. A body/row template edit (suspect) was made alongside a font-color edit (control, known to re-render live). Both re-rendered → the suspect is not special → Desktop delivers the Data bit for these updates → premise false, close without code change. A differential control isolates "does the host deliver the update at all" from "does our handler mishandle this property" — the ambiguity the finding glossed over.

## Related

Sibling learnings that each independently state a "verify the assumption against runtime, don't trust the stated rationale" rule — this doc is the canonical statement; consider consolidating the others toward it:

- [svg-payload-scan-fail-closed-percent-encoded-2026-05-11.md](../security-issues/svg-payload-scan-fail-closed-percent-encoded-2026-05-11.md) — "verify the working caller actually exercises the path before shipping."
- [classify-rename-runtime-vs-persisted-before-applying-2026-06-20.md](../conventions/classify-rename-runtime-vs-persisted-before-applying-2026-06-20.md) — "verify the regression claim structurally, not by inspection alone."
- [refactoring-sanitizer-behavior-preserving-2026-06-30.md](../conventions/refactoring-sanitizer-behavior-preserving-2026-06-30.md) — "verified equivalence by reading the diff, not trusting the green suite."
- [dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md](../security-issues/dompurify-svg-denylist-forceKeepAttr-regressions-2026-05-07.md) — authoritative on DOMPurify's actual attribute behavior; grounds the "DOMPurify already strips target" premise.
