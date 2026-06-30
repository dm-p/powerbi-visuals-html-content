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
import { sanitizeCss } from '../css-sanitizer';
import {
    hasDangerousSvgPayload,
    isSafeImageDataUri,
    SAFE_IMAGE_MIME_TYPES
} from './svg-payload-scan';
import { recordRemoval } from '../diagnostics/diagnostics-sink';
import { SanitizeOptions } from './options';

/**
 * Per-tag attribute allowlist enforced by the DOMPurify
 * `uponSanitizeAttribute` hook. DOMPurify's `ALLOWED_ATTR` is global,
 * so per-tag enforcement is a hook responsibility.
 *
 * Globals (apply to every allowed tag):
 *   class, id, title, lang, dir, style, role, aria-*, data-*, tabindex
 *
 * Explicitly NOT allowed anywhere:
 *   srcdoc, formaction, action, ping, background, poster, srcset.
 */
type AttributeAllowlist = {
    [tag: string]: string[];
};

// Derived from VisualConstants.svgTags so adding/removing an SVG tag
// in one place updates both the allowed-tags list and the sanitizer's
// HTML-vs-SVG branch.
const SVG_TAGS = new Set<string>(VisualConstants.svgTags);

const SVG_ATTRIBUTE_DENYLIST = new Set<string>([
    'srcdoc',
    'formaction',
    'action',
    'ping',
    'background',
    'poster',
    'srcset'
]);

// SMIL animation elements (<animate>, <animateMotion>,
// <animateTransform>, <set>) accept an `attributeName="..."` value
// that names the property to animate at runtime. Without this
// denylist, an attacker could declare `attributeName="href"` and
// rewrite a sanitized URL to `javascript:` after the DOM is live —
// the well-known SMIL sanitizer-bypass primitive. We refuse animation
// that targets URL-bearing attributes (href / xlink:href / src and
// the four URL-form-action variants), the bulk `style` attribute
// (animating `style` replaces the entire inline style string,
// re-introducing url() declarations the static sanitizer never saw),
// any of the SVG presentation attributes that resolve via `url(#id)`
// references (cursor, clip-path, mask, filter, marker-*), and the
// meta `attributeName` itself (animating attributeName lets the
// animation target a different attribute later). Animation that
// targets safe presentation / geometry properties (opacity,
// transform, fill, stroke, cx, cy, d, etc.) is unconstrained.
//
// IMPORTANT — gate ordering for SMIL animation *values*:
// Once attributeName passes this denylist, the actual animation
// values carried in `to`, `from`, `values`, `by` are gated SOLELY by
// the `scriptingPatterns` substring scan further down the hook (the
// `dangerousPatterns.some(p => lowerValue.includes(p))` check). That
// gate is what blocks `to="javascript:..."`, `to="vbscript:..."`,
// `from="data:text/html,..."`, etc. on SMIL elements. The funciri
// scheme check fires only when the value contains a literal `url(...)`
// wrapper, so a bare-scheme `to="javascript:..."` does not trip it.
// If `scriptingPatterns` is ever weakened or made opt-out for any
// subset of SVG tags, these four SMIL value attributes need their
// own explicit gate.
const SMIL_TAGS = new Set<string>([
    'animate',
    'animatemotion',
    'animatetransform',
    'set'
]);

const SMIL_ATTRIBUTE_NAME_DENYLIST = new Set<string>([
    'href',
    'xlink:href',
    'src',
    'srcdoc',
    'srcset',
    'formaction',
    'action',
    'ping',
    'background',
    'poster',
    'style',
    'cursor',
    'clip-path',
    'mask',
    'filter',
    'marker-start',
    'marker-mid',
    'marker-end',
    'attributename'
]);

const ALLOWED_ATTRIBUTES: AttributeAllowlist = {
    '*': [
        'class',
        'id',
        'title',
        'lang',
        'dir',
        'style',
        'role',
        'aria-*',
        'data-*',
        'tabindex'
    ],
    a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'type', 'media'],
    table: ['align', 'valign'],
    td: ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign'],
    th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign'],
    col: ['span'],
    colgroup: ['span'],
    time: ['datetime'],
    blockquote: ['cite'],
    q: ['cite'],
    ol: ['start', 'type', 'reversed'],
    li: ['value'],
    details: ['open'],
    meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
    progress: ['value', 'max'],
    // del, ins, output were added to VisualConstants.allowedTags in
    // commit 3e440c9 (PR #139). Each has legitimate tag-specific
    // attributes per the HTML spec; without these entries the attribs
    // are dropped and only the globals survive.
    del: ['cite', 'datetime'],
    ins: ['cite', 'datetime'],
    output: ['for', 'form', 'name']

    // SVG tags are intentionally absent from this map.
    //
    // The uponSanitizeAttribute hook below branches on `isSvgTag =
    // SVG_TAGS.has(tagName)`. SVG tags take the denylist path
    // (SVG_ATTRIBUTE_DENYLIST + on*) and never consult ALLOWED_ATTRIBUTES.
    // Adding an SVG entry here has no effect — the per-tag URL scheme
    // gate (allowedSchemesByTag), the funciri value-scheme check, the
    // SMIL attributeName denylist, and the scriptingPatterns scan are
    // the active gates for SVG attributes.
    //
    // To restrict an SVG attribute, add it to SVG_ATTRIBUTE_DENYLIST
    // above. To restrict a URL scheme on an SVG tag, edit
    // VisualConstants.allowedSchemesByTag in src/visual-constants.ts.
    // Do not add SVG keys to this map.
};

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
        // Hook 1: per-attribute sanitization. Per-tag allowlist enforcement,
        // NFKC normalization on URL attributes, data: URI sanitization,
        // inline style sanitization, dangerous-pattern check.
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
                    const attrName: string = hookEvent.attrName.toLowerCase();
                    const tagName: string = currentNode.tagName
                        ? currentNode.tagName.toLowerCase()
                        : '';
                    let value: string = hookEvent.attrValue;

                    const isSvgTag = SVG_TAGS.has(tagName);

                    const snip = (v: string) =>
                        v.length > 80 ? v.slice(0, 80) + '…' : v;
                    const dropAttr = (rule: string) =>
                        recordRemoval({
                            kind: 'attr',
                            subject: `${attrName} on <${tagName}>`,
                            rule,
                            snippet: snip(value)
                        });

                    // NFKC normalize URL-bearing attribute values to defeat Unicode
                    // obfuscation of dangerous schemes, and strip control characters
                    // (browsers ignore C0 controls when parsing URLs, so e.g.
                    // `java\x00script:` is parsed as `javascript:` and must be
                    // rejected by the same scheme check).
                    //
                    // Scope:
                    //   - HTML and SVG: href / src / xlink:href (URL attributes)
                    //   - SMIL elements: to / from / values / by \u2014 animation
                    //     value attributes that the scriptingPatterns substring
                    //     scan further down checks. Without normalization,
                    //     fullwidth-Unicode `to="\uFF4A\uFF41\uFF56\uFF41\uFF53\uFF43\uFF52\uFF49\uFF50\uFF54:..."` and
                    //     control-char obfuscation (`j\x00avascript:`) would
                    //     evade the substring scan.
                    //   - SVG funciri-bearing presentation attributes:
                    //     fill / stroke / cursor / mask / clip-path / filter /
                    //     marker-start / marker-mid / marker-end. These accept
                    //     `url(scheme:...)` references and are checked by the
                    //     funciri loop below, but the pre-funciri value-text
                    //     `scriptingPatterns` scan also runs against them.
                    const isUrlAttr =
                        attrName === 'href' ||
                        attrName === 'src' ||
                        attrName === 'xlink:href';
                    const isSmilValueAttr =
                        SMIL_TAGS.has(tagName) &&
                        (attrName === 'to' ||
                            attrName === 'from' ||
                            attrName === 'values' ||
                            attrName === 'by');
                    const isSvgFunciriPresentation =
                        isSvgTag &&
                        (attrName === 'fill' ||
                            attrName === 'stroke' ||
                            attrName === 'cursor' ||
                            attrName === 'mask' ||
                            attrName === 'clip-path' ||
                            attrName === 'filter' ||
                            attrName === 'marker-start' ||
                            attrName === 'marker-mid' ||
                            attrName === 'marker-end');
                    if (
                        isUrlAttr ||
                        isSmilValueAttr ||
                        isSvgFunciriPresentation
                    ) {
                        value = value
                            .normalize('NFKC')
                            .replace(/[\x00-\x1F\x7F\uFFFD]/g, '');
                        hookEvent.attrValue = value;
                    }

                    // Hyperlink toggle enforcement. When the format-pane
                    // `hyperlinks` toggle is OFF, the visual must not expose
                    // any clickable URL surface - strip `href` / `xlink:href`
                    // from every `<a>` (HTML and SVG) so the rendered DOM
                    // contains no surviving href attribute. The click handler
                    // already suppresses navigation via preventDefault(); this
                    // closes the residual attribute exposure that the MS
                    // AppSource scanner flags. Other tag-name+href
                    // combinations (SVG paint servers, <image>, SMIL) are
                    // governed by their own scheme allowlists and are not
                    // affected.
                    //
                    // GATE ORDERING: this check intentionally precedes the
                    // per-tag allowlist below so the toggle is authoritative
                    // for href on <a> regardless of what ALLOWED_ATTRIBUTES['a']
                    // permits. Do not reorder without auditing
                    // ALLOWED_ATTRIBUTES['a'] — a future allowlist edit that
                    // adds or removes href must not invert this precedence.
                    if (
                        !allowHyperlinks &&
                        tagName === 'a' &&
                        (attrName === 'href' || attrName === 'xlink:href')
                    ) {
                        dropAttr('hyperlinks-disabled');
                        hookEvent.keepAttr = false;
                        return;
                    }

                    // Keep strict per-tag allowlist behavior for HTML tags. For SVG
                    // tags, use a denylist so legitimate presentation/filter attrs are
                    // not dropped whenever we miss a tag-specific entry.
                    if (!isSvgTag) {
                        const allowedForTag = ALLOWED_ATTRIBUTES[tagName] || [];
                        const allowedGlobal = ALLOWED_ATTRIBUTES['*'] || [];
                        const merged = [...allowedGlobal, ...allowedForTag];
                        const isAllowed = merged.some((pattern) => {
                            if (pattern.endsWith('-*')) {
                                return attrName.startsWith(
                                    pattern.slice(0, -1)
                                );
                            }
                            return pattern === attrName;
                        });
                        if (!isAllowed) {
                            dropAttr('attr-not-allowed');
                            hookEvent.keepAttr = false;
                            return;
                        }
                    } else if (
                        /^on[a-z]+$/i.test(attrName) ||
                        SVG_ATTRIBUTE_DENYLIST.has(attrName)
                    ) {
                        dropAttr('svg-attr-denied');
                        hookEvent.keepAttr = false;
                        return;
                    }
                    // For SVG tags, attrs that survive all the enforcement checks below
                    // get `forceKeepAttr = true` set at the end of the hook — DOMPurify's
                    // built-in attr allowlist would otherwise drop legitimate
                    // presentation/filter attrs (stdDeviation, fill-opacity, etc.).
                    // Setting it early would override later `keepAttr = false` from URL
                    // scheme / scripting-pattern checks, leaking attacker-controlled URLs.

                    // Per-tag URL scheme enforcement. VisualConstants.allowedSchemesByTag
                    // specifies which schemes each tag is allowed to use (e.g. img: only
                    // data:, a: only http/https). For SVG tags carrying URL-bearing
                    // attributes, default-deny when no entry exists — a missing entry
                    // means the tag was added to allowedTags without a matching scheme
                    // policy, which would otherwise leak attacker-controlled URLs (issue
                    // surfaced by code review on this branch for feImage / pattern /
                    // gradients / filter). HTML tags fall through to the data: URI
                    // sanitizer below by design.
                    if (
                        attrName === 'src' ||
                        attrName === 'href' ||
                        attrName === 'xlink:href'
                    ) {
                        const schemesByTag =
                            VisualConstants.allowedSchemesByTag[tagName];
                        if (schemesByTag) {
                            const schemeMatch = value.match(
                                /^([a-z][a-z0-9+.\-]*)\s*:/i
                            );
                            const scheme = schemeMatch
                                ? schemeMatch[1].toLowerCase()
                                : '';
                            if (!schemesByTag.includes(scheme)) {
                                dropAttr('disallowed-url-scheme');
                                hookEvent.keepAttr = false;
                                return;
                            }
                        } else if (isSvgTag) {
                            // Default-deny: SVG tag without an allowedSchemesByTag entry.
                            dropAttr('svg-url-scheme-default-deny');
                            hookEvent.keepAttr = false;
                            return;
                        }
                    }

                    // SVG funciri value-scheme enforcement. Many SVG presentation
                    // attributes (mask, clip-path, filter, marker-*, fill, stroke,
                    // cursor) accept `url(...)` references. Validate the embedded
                    // scheme the same way we validate URL-bearing attribute names —
                    // empty (fragment-only #id) or `data:` are allowed; everything
                    // else (`http:`, `https:`, etc.) is dropped. Applies to every SVG
                    // attribute value EXCEPT `style` — for `style`, the CSS sanitizer
                    // (declaration-list mode) handles per-property url() validation
                    // and we want partial-survival behavior (drop only the offending
                    // declaration, keep the rest).
                    if (isSvgTag && attrName !== 'style') {
                        // Iterate EVERY url() token in the value, not
                        // just the first. SMIL animation values
                        // (`values`, `to`, `from`, `by`) and a few
                        // CSS-shaped SVG attributes can carry multiple
                        // url() tokens separated by `;` or `,` — e.g.
                        // `values="url(data:image/png;base64,AAA);
                        // url(https://attacker.example/track)"` on an
                        // <animate attributeName="fill">. A single
                        // value.match() finds only the first
                        // occurrence, so a smuggled later url() with
                        // an external scheme would slip through (the
                        // scriptingPatterns scan does not include
                        // `https:`). The exec-loop with the global
                        // flag forces every url() token to clear the
                        // gate.
                        const urlTokenRegex =
                            /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi;
                        let urlTokenMatch: RegExpExecArray | null;
                        while (
                            (urlTokenMatch = urlTokenRegex.exec(value)) !== null
                        ) {
                            const fullUrl = (
                                urlTokenMatch[1] ??
                                urlTokenMatch[2] ??
                                urlTokenMatch[3] ??
                                ''
                            ).trim();
                            if (!fullUrl) continue;
                            const schemeMatch = fullUrl.match(
                                /^([a-z][a-z0-9+.\-]*):/i
                            );
                            // No scheme — fragment-only (#id) or
                            // relative ref. Both safe; no fetch.
                            if (!schemeMatch) continue;
                            const scheme = schemeMatch[1].toLowerCase();
                            if (scheme !== 'data') {
                                dropAttr('svg-funciri-scheme');
                                hookEvent.keepAttr = false;
                                return;
                            }
                            // Scheme is `data:` — run the shared
                            // image-data-URI safety check (MIME
                            // allowlist + base64 enforcement +
                            // svg+xml payload scan, recursive on
                            // nested data:image/svg+xml inner
                            // hrefs). Mirrors the gate already
                            // applied to top-level `src`/`href`
                            // (getSanitizedDataUri) and CSS `url()`
                            // values (isSafeImageDataUri via
                            // hasUnsafeFunction).
                            if (!isSafeImageDataUri(fullUrl)) {
                                dropAttr('svg-funciri-unsafe-data');
                                hookEvent.keepAttr = false;
                                return;
                            }
                        }
                    }

                    // SMIL attributeName enforcement. SMIL animation
                    // elements declare which property they animate via
                    // `attributeName="..."`. If the value names a URL-
                    // bearing attribute (href, xlink:href, src, ...) or
                    // the bulk `style` attribute, an attacker can use the
                    // animation to rewrite the property at runtime,
                    // bypassing static URL/scheme sanitization. Drop the
                    // attributeName attribute when the value is denied —
                    // the SMIL element survives but has nothing to
                    // animate, so the bypass is neutralised. Animation
                    // targeting safe presentation/geometry properties
                    // passes through untouched.
                    if (
                        SMIL_TAGS.has(tagName) &&
                        attrName === 'attributename' &&
                        // Trim before lookup — Set.has is exact-match but
                        // browsers (and the SMIL animator) trim and lowercase
                        // attributeName values before resolving them. A
                        // padded value like `attributeName=" href "` would
                        // otherwise survive the gate while still binding
                        // the animation to `href` at runtime.
                        SMIL_ATTRIBUTE_NAME_DENYLIST.has(
                            value.trim().toLowerCase()
                        )
                    ) {
                        dropAttr('smil-attributename');
                        hookEvent.keepAttr = false;
                        return;
                    }

                    // data: URI sanitization for src/href/xlink:href.
                    // For SVG tags, do NOT set forceKeepAttr after mutating attrValue —
                    // DOMPurify short-circuits the setAttribute call when forceKeepAttr
                    // is true (purify.cjs.js:1136), losing the sanitized value.
                    // DOMPurify's built-in SVG attr allowlist already keeps
                    // src / href / xlink:href / style on SVG tags, so the mutation
                    // lands via the normal post-hook setAttribute path.
                    if (
                        (attrName === 'src' ||
                            attrName === 'href' ||
                            attrName === 'xlink:href') &&
                        value.startsWith('data:')
                    ) {
                        const sanitized = getSanitizedDataUri(value);
                        if (sanitized === 'data:,' || sanitized === '') {
                            dropAttr('data-uri');
                            hookEvent.keepAttr = false;
                            return;
                        }
                        hookEvent.attrValue = sanitized;
                        return;
                    }

                    // Inline style sanitization. Same forceKeepAttr/setAttribute caveat
                    // as the data: branch above — leave forceKeepAttr unset so the
                    // sanitized value is written back by DOMPurify's normal flow.
                    if (attrName === 'style') {
                        const sanitizedStyle = sanitizeCss(
                            value,
                            'declaration-list'
                        );
                        if (sanitizedStyle === '') {
                            dropAttr('inline-style');
                            hookEvent.keepAttr = false;
                            return;
                        }
                        // Normalize whitespace around the property/value separator
                        // and trailing semicolons. sanitize-html previously re-serialized
                        // through postcss after our hook ran, which collapsed `color: red`
                        // to `color:red`. Without that second pass we mimic the same
                        // normalization here so the harness fixtures (which encode the
                        // post-postcss-default form) keep matching.
                        hookEvent.attrValue = sanitizedStyle
                            .split(';')
                            .map((d) =>
                                d.trim().replace(/^([^:]+?)\s*:\s*/, '$1:')
                            )
                            .filter((d) => d.length > 0)
                            .join(';');
                        return;
                    }

                    // Defense-in-depth: drop xlink:href if it carries javascript:
                    if (
                        attrName === 'xlink:href' &&
                        /^javascript\s*:/i.test(value)
                    ) {
                        dropAttr('xlink-javascript');
                        hookEvent.keepAttr = false;
                        return;
                    }

                    // Defense-in-depth: scriptingPatterns check on the value
                    const lowerValue = value.toLowerCase();
                    const hasDangerous = VisualConstants.scriptingPatterns.some(
                        (p) => lowerValue.includes(p.toLowerCase())
                    );
                    if (hasDangerous) {
                        dropAttr('dangerous-pattern');
                        hookEvent.keepAttr = false;
                        return;
                    }

                    // SVG tag, all enforcement checks passed: force-keep so DOMPurify's
                    // built-in attr allowlist doesn't drop legitimate SVG attrs.
                    if (isSvgTag) {
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

                // on*-handler container: EMPTY the subtree here — before
                // DOMPurify's disallowed-tag KEEP_CONTENT hoist can lift a
                // child out of the element. Phase 1 of the two-phase
                // event-handler-element drop (phase 2 removes the element in
                // afterSanitizeElements). Without this, a disallowed container
                // like `<marquee onstart="…">x</marquee>` has its `x` hoisted
                // to the parent before phase 2 runs, so the strict
                // "drop the ENTIRE element + content" rule would leak the
                // child content. Emptying (vs detaching the element) keeps
                // `currentNode` parented through the rest of the element walk,
                // so DOMPurify's own namespace/forced-removal checks never hit
                // a parentless node — the 3.4.x "could not be detached" throw
                // that a direct removeChild here would trigger on an SVG child.
                if (currentNode.nodeType === 1 /* ELEMENT_NODE */) {
                    const el = currentNode as Element;
                    if (eventHandlerAttrName(el)) {
                        while (el.firstChild) {
                            el.removeChild(el.firstChild);
                        }
                    }
                }
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
                const element = currentNode as Element;
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
const recordCoreRemovals = (purify: DOMPurifyType): void => {
    // Defense-in-depth on a frozen security boundary: this runs OUTSIDE the
    // sanitizer hooks' try/catch, so any unexpected throw here must never be
    // allowed to abort a render. Diagnostics observation is strictly
    // best-effort — swallow anything that goes wrong reading `removed`.
    try {
        const removed = (purify as unknown as { removed?: unknown[] }).removed;
        if (!Array.isArray(removed)) return;
        for (const r of removed) {
            if (r && typeof r === 'object' && 'element' in r) {
                const el = (r as { element: { nodeName?: string } }).element;
                const name = el?.nodeName
                    ? `<${String(el.nodeName).toLowerCase()}>`
                    : '<node>';
                recordRemoval({
                    kind: 'tag',
                    subject: name,
                    rule: 'forbidden-or-unknown-tag'
                });
            } else if (r && typeof r === 'object' && 'attribute' in r) {
                const a = r as {
                    attribute?: { name?: string };
                    from?: { nodeName?: string };
                };
                const an = a.attribute?.name ?? 'attr';
                const fn = a.from?.nodeName
                    ? `<${String(a.from.nodeName).toLowerCase()}>`
                    : '';
                recordRemoval({
                    kind: 'attr',
                    subject: `${an} on ${fn}`.trim(),
                    rule: 'dompurify-core'
                });
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
 * Sanitize a data: URI for use in img src / href / xlink:href attributes.
 * Only allows specific safe image MIME types AND requires the URI to be
 * base64-encoded.
 */
export const getSanitizedDataUri = (dataUri: string): string => {
    if (!dataUri || !dataUri.startsWith('data:')) {
        return dataUri;
    }

    const mimeMatch = dataUri.match(/^data:([^;,]+)/i);
    if (!mimeMatch) {
        // No extractable MIME type (e.g. 'data:,payload', 'data:;base64,...').
        // RFC 2397 defaults missing MIME to text/plain — not on our allowlist.
        console.warn('Blocked data URI with no extractable MIME type');
        return 'data:,';
    }

    const mimeType = mimeMatch[1].toLowerCase();
    // Reuse the shared SAFE_IMAGE_MIME_TYPES set from svg-payload-scan.ts
    // so this entry point and isSafeImageDataUri stay in lockstep.
    if (!SAFE_IMAGE_MIME_TYPES.has(mimeType)) {
        console.warn(
            `Blocked data URI with unsafe MIME type: ${mimeType.slice(0, 64)}`
        );
        return 'data:,';
    }

    // Real binary images (png/jpeg/gif/webp/bmp) must be base64-encoded —
    // a non-base64 data:image/png is always smuggled non-binary content.
    // SVG is text by spec and DAX measures legitimately emit
    // `data:image/svg+xml;utf8,<svg ...>` (and the bare comma form), so
    // the base64 requirement is bypassed for image/svg+xml. Browsers
    // sandbox SVG loaded via <img>/<svg image>/<feImage> — script and
    // external resource references inside the SVG do not execute in
    // image-loading context (issue #143 follow-up).
    if (mimeType !== 'image/svg+xml' && !/^data:[^,]*;base64,/i.test(dataUri)) {
        console.warn(
            `Blocked data:${mimeType} URI: missing base64 encoding (smuggled non-binary content)`
        );
        return 'data:,';
    }

    // Defense-in-depth content scan for image/svg+xml. Modern Chromium
    // sandboxes SVG loaded via <img>/<image>/<feImage>/CSS url(), so
    // embedded scripts and event handlers do not execute in image
    // contexts. The sandbox guarantee is the load-bearing security
    // boundary — but it isn't uniform across every rendering surface a
    // Power BI report ends up in (older WebView2, mobile renderers,
    // export-to-PDF pipelines, etc.). Block payloads that contain
    // patterns the sandbox would normally neuter, so a future
    // sandbox-weak surface still rejects them at the sanitizer.
    if (mimeType === 'image/svg+xml' && hasDangerousSvgPayload(dataUri)) {
        console.warn(
            'Blocked data:image/svg+xml URI: payload contains script, event handler, foreignObject, or external href'
        );
        return 'data:,';
    }

    return dataUri;
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
