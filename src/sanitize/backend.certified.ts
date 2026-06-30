// External dependencies
import DOMPurify from 'dompurify';
import type {
    DOMPurify as DOMPurifyType,
    Config,
    UponSanitizeAttributeHookEvent
} from 'dompurify';
import { marked } from 'marked';

// Internal dependencies
import { VisualConstants } from '../visual-constants';
import { RenderFormat } from '../types';
import { sanitizeCss } from './css';
import { recordRemoval } from '../diagnostics/diagnostics-sink';
import { SanitizeOptions } from './options';
// Re-exported for back-compat: `getSanitizedDataUri` now lives in `./data-uri`
// (relocated to break the former runtime-only import cycle with
// attribute-policy.ts). Importers should prefer `./data-uri` directly.
export { getSanitizedDataUri } from './data-uri';
// The per-tag attribute-policy constants and the ten gate functions live in
// attribute-policy.ts. The attribute hook below is now a thin dispatcher over
// those gates; it only needs SVG_TAGS (to build the AttrContext) plus the gate
// functions and the gate contract types. attribute-policy.ts no longer imports
// anything from this module's runtime exports (the former cycle via
// `getSanitizedDataUri` is gone — that function now lives in `./data-uri`).
import {
    SVG_TAGS,
    normalizeUrlAttr,
    hyperlinkToggle,
    tagAllowlist,
    urlScheme,
    svgFunciri,
    smilAttributeName,
    dataUriAttr,
    styleAttr,
    xlinkJavascript,
    scriptingPatterns
} from './attribute-policy';
import type { AttrContext, Verdict } from './attribute-policy';

/**
 * Pre-process <style> tag bodies through sanitizeCss before handing off
 * to DOMPurify. Case-insensitive.
 *
 * NOTE: the [^>]* in the opening-tag pattern stops at the first `>`
 * character, so a `<style data-x=">" ...>` attribute containing `>`
 * would cause a mis-parse. This is NOT the primary defense — the
 * uponSanitizeElement hook below re-sanitizes every <style> element's
 * textContent after DOMPurify has parsed the DOM correctly. That
 * backstop is load-bearing for this edge case.
 */
export function preprocessStyleTags(input: string): string {
    return input.replace(
        /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
        (_match, body) => {
            const sanitized = sanitizeCss(body, 'stylesheet');
            if (sanitized === '') {
                return '';
            }
            return `<style>${sanitized}</style>`;
        }
    );
}

/**
 * Lazily bind DOMPurify to the current window. In a real browser the
 * default import is already pre-bound. Under jsdom we need to call
 * `DOMPurify(window)` once.
 */

/**
 * The shape of the `DOMPurify` namespace export at runtime: it exposes
 * a fully-bound `DOMPurifyType` API (sanitize/addHook/etc.) AND is
 * callable as a factory that binds a fresh instance to a Window. The
 * upstream `dompurify` types describe the bound API only, so we
 * declare the factory shape here and use it in `getPurify` instead of
 * an opaque intersection cast at the call site. Documenting it as a
 * named alias makes the dual nature explicit for future maintainers.
 */
type DOMPurifyFactory = DOMPurifyType & ((win: Window) => DOMPurifyType);

let purifyInstance: DOMPurifyType | null = null;
function getPurify(): DOMPurifyType {
    if (purifyInstance) return purifyInstance;
    const dp = DOMPurify as DOMPurifyFactory;
    if (typeof dp.sanitize === 'function') {
        purifyInstance = dp;
    } else if (typeof window !== 'undefined') {
        purifyInstance = dp(window);
    } else {
        purifyInstance = dp;
    }
    return purifyInstance;
}

// ALLOWED_ATTR is intentionally absent from this config. DOMPurify's
// built-in default attr allowlist would otherwise pre-strip legitimate
// SVG presentation/filter attrs (stdDeviation, fill-opacity, etc.)
// before our uponSanitizeAttribute hook can decide. Per-tag enforcement
// is fully delegated to the hook: HTML tags use the strict per-tag
// allowlist in ALLOWED_ATTRIBUTES; SVG tags use a denylist plus URL
// scheme rules. Removing ALLOWED_ATTR is a deliberate trade — we lose
// one defense-in-depth layer and depend entirely on the hook's
// contract for attribute decisions.
//
// Module-level so both the string entry point (getSanitizedContent)
// and the in-context entry point (parseAndSanitizeInContext) share an
// identical policy. parseAndSanitizeInContext spreads this object and
// overrides only IN_PLACE.
const dpConfig: Config = {
    ALLOWED_TAGS: VisualConstants.allowedTags,
    // Allow data: in URL-bearing attrs (sanitized in the hook).
    ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'link',
        'meta',
        'base'
    ],
    FORBID_ATTR: [
        'srcdoc',
        'formaction',
        'action',
        'ping',
        'background',
        'poster',
        'srcset'
    ],
    ADD_TAGS: ['style'],
    FORCE_BODY: true,
    IN_PLACE: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false
};

// In-place root-node eligibility, derived from dpConfig so there is no
// second tag policy to drift. DOMPurify refuses to sanitize a node in
// place when the *root* node it is handed is not allowed or is forbidden
// (purify.ts: `if (!ALLOWED_TAGS[tag] || FORBID_TAGS[tag]) throw 'root
// node is forbidden and cannot be sanitized in-place'`). Its effective
// allow-set is ALLOWED_TAGS ∪ ADD_TAGS, lower-cased via transformCaseFunc
// (text/html parser). We mirror that exactly: an element child is
// in-place-sanitizable iff its lower-cased tag is in the allow-set and
// not in the forbid-set. A top-level child that is NOT eligible (e.g. a
// <script> that survived createContextualFragment as a direct fragment
// child) is removed outright — the same outcome the string path
// (getSanitizedContent) produces for a forbidden/disallowed element,
// keeping the two entry points at parity and fail-closed.
// dpConfig assigns string[] literals; cast narrows DOMPurify's string[]|fn type.
const IN_PLACE_ALLOWED_ROOT_TAGS = new Set<string>(
    [
        ...((dpConfig.ALLOWED_TAGS as string[]) ?? []),
        ...((dpConfig.ADD_TAGS as string[]) ?? [])
    ].map((t) => t.toLowerCase())
);
const IN_PLACE_FORBIDDEN_ROOT_TAGS = new Set<string>(
    ((dpConfig.FORBID_TAGS as string[]) ?? []).map((t) => t.toLowerCase())
);
const isInPlaceSanitizableRoot = (el: Element): boolean => {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    return (
        IN_PLACE_ALLOWED_ROOT_TAGS.has(tag) &&
        !IN_PLACE_FORBIDDEN_ROOT_TAGS.has(tag)
    );
};

/**
 * Register the two sanitizer hooks (closing over `options.allowHyperlinks`),
 * run `run(purify)`, and always tear the hooks down afterward. Shared by
 * the string entry point (getSanitizedContent) and the in-context entry
 * point (parseAndSanitizeInContext) so both apply byte-identical policy.
 *
 * The hook bodies are the visual's security boundary — they are moved
 * here verbatim from the former getSanitizedContent body. Do not change
 * a rule here without changing the frozen sanitizer policy on purpose.
 */
/**
 * If `element` carries any `on*` event-handler attribute, return that
 * attribute's name; otherwise null. Shared by the two-phase on*-element
 * drop (empty-in-`uponSanitizeElement` + remove-in-`afterSanitizeElements`).
 */
const eventHandlerAttrName = (element: Element): string | null => {
    if (!element.attributes) return null;
    for (let i = 0; i < element.attributes.length; i++) {
        const name = element.attributes[i].name;
        if (/^on[a-z]+$/i.test(name)) return name;
    }
    return null;
};

/**
 * <style>-tag backstop body (verbatim from `uponSanitizeElement`). Re-run
 * sanitizeCss on a <style> element's textContent. preprocessStyleTags already
 * sanitized the body via regex extraction, but if the regex was defeated (e.g.
 * by a '>' inside an attribute value or an unclosed tag), this catches the
 * fallthrough. No-op for non-<style> nodes.
 */
const reSanitizeStyleContent = (currentNode: Node): void => {
    if (
        currentNode.nodeName &&
        currentNode.nodeName.toLowerCase() === 'style'
    ) {
        const raw = currentNode.textContent || '';
        if (raw.trim()) {
            const sanitized = sanitizeCss(raw, 'stylesheet');
            currentNode.textContent = sanitized;
        }
    }
};

/**
 * Phase 1 of the two-phase on*-handler element drop (verbatim from
 * `uponSanitizeElement`). EMPTY an on*-handler element's subtree here — before
 * DOMPurify's disallowed-tag KEEP_CONTENT hoist can lift a child out of the
 * element (phase 2 removes the element in afterSanitizeElements). Without this,
 * a disallowed container like `<marquee onstart="…">x</marquee>` has its `x`
 * hoisted to the parent before phase 2 runs, so the strict "drop the ENTIRE
 * element + content" rule would leak the child content. Emptying (vs detaching
 * the element) keeps `currentNode` parented through the rest of the element
 * walk, so DOMPurify's own namespace/forced-removal checks never hit a
 * parentless node — the 3.4.x "could not be detached" throw that a direct
 * removeChild here would trigger on an SVG child.
 */
const emptyEventHandlerSubtree = (currentNode: Node): void => {
    if (currentNode.nodeType === 1 /* ELEMENT_NODE */) {
        const el = currentNode as Element;
        if (eventHandlerAttrName(el)) {
            while (el.firstChild) {
                el.removeChild(el.firstChild);
            }
        }
    }
};

/**
 * Phase 2 of the two-phase on*-handler element drop (verbatim from
 * `afterSanitizeElements`). If `element` carries an on* event-handler
 * attribute, drop the ENTIRE element (its subtree was already emptied in
 * phase 1) — stricter than DOMPurify's default of merely stripping the
 * attribute, and a backstop for any handler name DOMPurify's own allowlist
 * misses.
 */
const dropEventHandlerElement = (element: Element): void => {
    const handler = eventHandlerAttrName(element);
    if (handler) {
        recordRemoval({
            kind: 'element',
            subject: `<${element.nodeName.toLowerCase()}> (${handler})`,
            rule: 'event-handler'
        });
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }
};

function withSanitizerHooks<T>(
    run: (purify: DOMPurifyType) => T,
    options?: SanitizeOptions
): T {
    const allowHyperlinks = options?.allowHyperlinks ?? false;
    const purify = getPurify();

    // Ensure a clean hook slate before registering. If a prior call
    // crashed between addHook and the try/finally cleanup, orphaned
    // hooks would otherwise accumulate on the cached singleton.
    purify.removeAllHooks();

    try {
        // Hook 1: per-attribute sanitization. The ten ordered gates in
        // attribute-policy.ts are the security boundary — each is a
        // behavior-preserving lift of a former inline guard clause (same
        // regexes, literals, edge cases, and ORDER). This callback is now a
        // thin dispatcher: it builds the AttrContext, runs the gates in order,
        // and applies each Verdict. Do not change a gate's rule here — edit
        // attribute-policy.ts (and its frozen sanitizer policy) on purpose.
        const GATES = [
            normalizeUrlAttr,
            hyperlinkToggle,
            tagAllowlist,
            urlScheme,
            svgFunciri,
            smilAttributeName,
            dataUriAttr,
            styleAttr,
            xlinkJavascript,
            scriptingPatterns
        ];

        purify.addHook(
            'uponSanitizeAttribute',
            (
                currentNode: Element,
                hookEvent: UponSanitizeAttributeHookEvent
            ) => {
                // Fail-closed envelope. ALLOWED_ATTR is intentionally
                // absent from the DOMPurify config below (so that legitimate
                // SVG presentation/filter attrs reach this hook), which
                // means *all* attribute decisions are delegated to this
                // callback. If the body throws (unexpected null,
                // malformed input, type assumption violated), DOMPurify
                // would otherwise fall back to its own default
                // allowlist — different from the project policy. The
                // try/catch sets keepAttr=false so an unexpected throw
                // drops the attribute rather than leaking through to
                // DOMPurify's defaults.
                try {
                    const tagName = currentNode.tagName
                        ? currentNode.tagName.toLowerCase()
                        : '';
                    const ctx: AttrContext = {
                        attrName: hookEvent.attrName.toLowerCase(),
                        tagName,
                        value: hookEvent.attrValue,
                        isSvgTag: SVG_TAGS.has(tagName),
                        allowHyperlinks
                    };
                    const snip = (v: string) =>
                        v.length > 80 ? v.slice(0, 80) + '…' : v;
                    for (const gate of GATES) {
                        const verdict: Verdict = gate(ctx);
                        if (verdict.action === 'continue') {
                            if (verdict.value !== undefined) {
                                ctx.value = verdict.value;
                                hookEvent.attrValue = verdict.value; // preserve mid-hook write-back (NFKC)
                            }
                            continue;
                        }
                        if (verdict.action === 'drop') {
                            recordRemoval({
                                kind: 'attr',
                                subject: `${ctx.attrName} on <${ctx.tagName}>`,
                                rule: verdict.rule,
                                snippet: snip(ctx.value)
                            });
                            hookEvent.keepAttr = false;
                            return;
                        }
                        // verdict.action === 'keep'
                        hookEvent.attrValue = verdict.value;
                        return;
                    }
                    // All gates passed: force-keep so DOMPurify's built-in
                    // allowlist doesn't drop legit SVG attrs.
                    if (ctx.isSvgTag) {
                        hookEvent.forceKeepAttr = true;
                    }
                } catch (err) {
                    recordRemoval({
                        kind: 'attr',
                        subject: 'attribute',
                        rule: 'hook-error',
                        snippet: String(err).slice(0, 80)
                    });
                    // Fail-closed: any unexpected throw inside the
                    // attribute hook drops the attribute rather than
                    // letting DOMPurify fall back to its default
                    // allowlist. The error is logged so the underlying
                    // bug is observable.
                    hookEvent.keepAttr = false;
                    console.warn(
                        'uponSanitizeAttribute hook error, dropping attribute:',
                        err
                    );
                }
            }
        );
        // Hook 2: <style>-tag backstop. Run sanitizeCss on the text content
        // as a defense-in-depth backstop. preprocessStyleTags already
        // sanitized the body via regex extraction, but if the regex was
        // defeated (e.g. by a '>' inside an attribute value or an unclosed
        // tag), this hook catches the fallthrough. DOMPurify's
        // ADD_TAGS:['style'] preserves the element — without this hook, an
        // unsanitized body would reach the DOM.
        purify.addHook('uponSanitizeElement', (currentNode: Node) => {
            // Fail-closed envelope. If the style re-sanitize throws (postcss
            // parse errors on pathological CSS), drop the whole <style> rather
            // than let an unsanitized body through.
            try {
                if (!currentNode) return;
                // <style>-tag backstop: re-sanitize the body via sanitizeCss.
                reSanitizeStyleContent(currentNode);
                // Phase 1 of the two-phase on*-handler element drop: empty the
                // subtree before DOMPurify's KEEP_CONTENT hoist runs (phase 2
                // removes the element in afterSanitizeElements).
                emptyEventHandlerSubtree(currentNode);
            } catch (err) {
                console.warn(
                    'uponSanitizeElement hook error, removing element:',
                    err
                );
                if (currentNode && currentNode.parentNode) {
                    currentNode.parentNode.removeChild(currentNode);
                }
            }
        });

        // Hook 3: on*-handler element drop — phase 2. If any element carries
        // an on* event-handler attribute, drop the ENTIRE element (its subtree
        // was already emptied in phase 1, above) — stricter than DOMPurify's
        // default of merely stripping the attribute, and a backstop for any
        // handler name DOMPurify's own allowlist misses.
        //
        // The actual removeChild runs in afterSanitizeElements, not
        // uponSanitizeElement: afterSanitizeElements fires only once DOMPurify
        // has decided to KEEP the node, so detaching it here can never leave a
        // parentless node for DOMPurify's own `_forceRemove` to hit. Detaching
        // earlier orphans the node mid-walk; DOMPurify 3.4.x then throws
        // "a node selected for removal could not be detached" when its
        // namespace check force-removes the now-rootless SVG child. (A
        // disallowed container is instead removed by DOMPurify itself before
        // this hook fires — harmless, because phase 1 already emptied it.) The
        // on* attribute is still present here (attribute sanitization runs
        // after element sanitization), so the scan still sees it.
        purify.addHook('afterSanitizeElements', (currentNode: Node) => {
            // Fail-closed: any throw drops the element rather than leaking it.
            try {
                // Element-only (`.attributes`); text/comment nodes can never
                // carry event handlers, so early-out is safe.
                if (
                    !currentNode ||
                    currentNode.nodeType !== 1 /* ELEMENT_NODE */
                ) {
                    return;
                }
                dropEventHandlerElement(currentNode as Element);
            } catch (err) {
                console.warn(
                    'afterSanitizeElements hook error, removing element:',
                    err
                );
                if (currentNode && currentNode.parentNode) {
                    currentNode.parentNode.removeChild(currentNode);
                }
            }
        });

        return run(purify);
    } finally {
        // Hooks are global per instance — tear them down so they don't
        // leak across calls (or across tests). Wraps both addHook calls
        // and the sanitize call so a throw from any of them still hits
        // the cleanup path (no leaked hooks on the cached singleton).
        purify.removeAllHooks();
    }
}

/**
 * Read DOMPurify's own `removed` log (forbidden/unknown tags and any
 * attributes its core dropped) and forward each entry to the passive
 * diagnostics sink. No-op when `removed` is absent or empty, and every
 * `recordRemoval` is itself a no-op unless capture is armed — so this
 * never changes sanitizer output. Must be called while still inside
 * `withSanitizerHooks`' `run`, since `purify.removed` is reset on the
 * next `sanitize` call.
 */
/**
 * Map a single entry from DOMPurify's `removed` log to the removal record the
 * diagnostics sink expects, or `null` when the entry is neither an element nor
 * an attribute removal. Verbatim element-vs-attribute branch lifted out of
 * `recordCoreRemovals` so that loop stays flat.
 */
type CoreRemovalRecord = Parameters<typeof recordRemoval>[0];

/** True when `r` is a non-null object carrying property `key`. */
const isObjectWith = (r: unknown, key: string): boolean =>
    !!r && typeof r === 'object' && key in r;

/** Map a DOMPurify `removed` element entry to its tag removal record. */
const mapRemovedElement = (r: unknown): CoreRemovalRecord => {
    const el = (r as { element: { nodeName?: string } }).element;
    const name = el?.nodeName
        ? `<${String(el.nodeName).toLowerCase()}>`
        : '<node>';
    return {
        kind: 'tag',
        subject: name,
        rule: 'forbidden-or-unknown-tag'
    };
};

/** Map a DOMPurify `removed` attribute entry to its attr removal record. */
const mapRemovedAttribute = (r: unknown): CoreRemovalRecord => {
    const a = r as {
        attribute?: { name?: string };
        from?: { nodeName?: string };
    };
    const an = a.attribute?.name ?? 'attr';
    const fn = a.from?.nodeName
        ? `<${String(a.from.nodeName).toLowerCase()}>`
        : '';
    return {
        kind: 'attr',
        subject: `${an} on ${fn}`.trim(),
        rule: 'dompurify-core'
    };
};

const mapRemovedEntry = (r: unknown): CoreRemovalRecord | null => {
    if (isObjectWith(r, 'element')) return mapRemovedElement(r);
    if (isObjectWith(r, 'attribute')) return mapRemovedAttribute(r);
    return null;
};

const recordCoreRemovals = (purify: DOMPurifyType): void => {
    // Defense-in-depth on a frozen security boundary: this runs OUTSIDE the
    // sanitizer hooks' try/catch, so any unexpected throw here must never be
    // allowed to abort a render. Diagnostics observation is strictly
    // best-effort — swallow anything that goes wrong reading `removed`.
    try {
        const removed = (purify as unknown as { removed?: unknown[] }).removed;
        if (!Array.isArray(removed)) return;
        for (const r of removed) {
            const record = mapRemovedEntry(r);
            if (record) {
                recordRemoval(record);
            }
        }
    } catch {
        /* diagnostics must never break a render */
    }
};

/**
 * Sanitize the supplied HTML string using DOMPurify.
 */
export const getSanitizedContent = (
    content: string,
    options?: SanitizeOptions
): string => {
    const preprocessed = preprocessStyleTags(content);
    return withSanitizerHooks((purify) => {
        const result = purify.sanitize(preprocessed, dpConfig);
        recordCoreRemovals(purify);
        return result;
    }, options);
};

/**
 * Sanitize the top-level children of an already-parsed `DocumentFragment`
 * (or `Element`) IN PLACE, applying the frozen sanitizer policy
 * (`dpConfig` + the two hooks in `withSanitizerHooks`). This is the single
 * shared in-place sanitize implementation:
 *   - ELEMENT_NODE children are sanitized in place via DOMPurify
 *     (`IN_PLACE: true`), preserving any table/list content model the
 *     caller established with `createContextualFragment`.
 *   - COMMENT_NODE children are removed, matching the string path
 *     (DOMPurify SAFE_FOR_XML strips comments).
 *   - inert TEXT_NODE children are preserved as authored content.
 *   - a top-level element that is NOT in-place-sanitizable (forbidden or
 *     not on the allow-list — e.g. a `<script>` that parsed as a direct
 *     fragment child) is removed outright rather than passed to DOMPurify,
 *     which would throw "root node is forbidden and cannot be sanitized
 *     in-place". Removal mirrors the string path's outcome and keeps the
 *     boundary fail-closed.
 *
 * SECURITY: callers MUST sanitize the fragment WHILE IT IS DETACHED from
 * the live document, and only append the (now sanitized) fragment to a
 * connected node afterwards. Appending unsanitized content to the live DOM
 * — even briefly — can let an `<img onerror>` / `<svg onload>` handler fire
 * once connected. This helper does not connect anything; it only mutates
 * the nodes it is given.
 *
 * Extracted verbatim from the former `parseAndSanitizeInContext` body so
 * both that entry point and `resolveTemplateContainer` (domain-utils) reuse
 * one security-reviewed sanitize loop. Behavior is unchanged from the
 * inline version — see the U4 sanitizer suite for the parity proof.
 */
export const sanitizeFragmentInPlace = (
    fragment: DocumentFragment | Element,
    options?: SanitizeOptions
): void => {
    withSanitizerHooks((purify) => {
        // IN_PLACE: true sanitizes the existing node's subtree in
        // place (and returns it) instead of re-parsing a string, so
        // the table/list context createContextualFragment established
        // is preserved. Everything else in the policy is spread
        // unchanged from dpConfig.
        //
        // COMMENT_NODE children are removed to match the string path
        // (DOMPurify SAFE_FOR_XML strips comments). TEXT_NODE children
        // are inert and kept as authored content. A top-level element
        // that is not in-place-sanitizable (forbidden or not on the
        // allow-list — e.g. a <script> that parsed as a direct fragment
        // child) is removed outright rather than passed to DOMPurify,
        // which would throw "root node is forbidden and cannot be
        // sanitized in-place". Removal mirrors the string path's
        // outcome for such elements and keeps the boundary fail-closed.
        Array.from(fragment.childNodes).forEach((n) => {
            if (n.nodeType === Node.COMMENT_NODE) {
                // Match the string path: DOMPurify SAFE_FOR_XML strips comments.
                (n as ChildNode).remove();
                return;
            }
            if (n.nodeType !== Node.ELEMENT_NODE) return; // text nodes are inert; keep
            const el = n as Element;
            if (isInPlaceSanitizableRoot(el)) {
                purify.sanitize(el, { ...dpConfig, IN_PLACE: true });
                recordCoreRemovals(purify);
            } else {
                el.remove();
            }
        });
    }, options);
};

/**
 * Test-only entry point that returns the sanitized HTML *string*. Inlines the
 * certified parse path (markdown-convert → DOMPurify → parse → serialize) that
 * formerly lived in `getParsedHtmlAsDom`, so the certified sanitizer's test
 * entry point does not depend on the edition-agnostic seam (`./index`).
 */
export const getSanitizedHtmlForTesting = (
    content: string,
    format: RenderFormat,
    options?: SanitizeOptions
): string => {
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    const parse = Range.prototype.createContextualFragment.bind(
        document.createRange()
    );
    const container = document.createElement('div');
    container.appendChild(parse(getSanitizedContent(converted, options)));
    return container.innerHTML;
};

// --- Sanitizer backend contract (certified) ---------------------------------
// The names the seam (src/sanitize/index.ts) delegates to. The passthrough
// backend (src/sanitize/backend.passthrough.ts) exposes the same names as
// identity/no-ops, so the seam stays edition-agnostic.

/** Certified: full preprocess + DOMPurify (today's `getSanitizedContent`). */
export const sanitizeHtmlString = getSanitizedContent;

/** Certified: the <style>-tag preprocessing applied before context-parsing. */
export const preprocessHtmlString = preprocessStyleTags;

/** Certified: run the CSS sanitizer on a custom stylesheet. */
export const sanitizeCssString = (css: string): string =>
    sanitizeCss(css, 'stylesheet');

/** This edition runs the sanitizer. */
export const enabled = true;
