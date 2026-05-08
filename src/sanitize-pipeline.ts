// External dependencies
import * as config from '../config/visual.json';
// Namespace import for compatibility with the project tsconfig
// (no esModuleInterop). The runtime export is callable for jsdom binding.
import * as DOMPurifyNs from 'dompurify';
import type {
    DOMPurify as DOMPurifyType,
    Config,
    UponSanitizeAttributeHookEvent
} from 'dompurify';
const DOMPurify: DOMPurifyType =
    (DOMPurifyNs as unknown as { default?: DOMPurifyType }).default ||
    (DOMPurifyNs as unknown as DOMPurifyType);
import { marked } from 'marked';

// Internal dependencies
import { VisualConstants } from './visual-constants';
import { RenderFormat } from './types';
import { sanitizeCss } from './css-sanitizer';
import { hasDangerousSvgPayload } from './svg-payload-scan';

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
function preprocessStyleTags(input: string): string {
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
let purifyInstance: DOMPurifyType | null = null;
function getPurify(): DOMPurifyType {
    if (purifyInstance) return purifyInstance;
    const dp = DOMPurify as DOMPurifyType & ((win: Window) => DOMPurifyType);
    if (typeof dp.sanitize === 'function') {
        purifyInstance = dp;
    } else if (typeof window !== 'undefined') {
        purifyInstance = dp(window);
    } else {
        purifyInstance = dp;
    }
    return purifyInstance;
}

/**
 * Parse the supplied HTML string and then return as a DOM fragment that we can
 * use in the visual for our data. If we're specifying in the configuration that
 * we should sanitize, do this also.
 */
export const getParsedHtmlAsDom = (content: string, format: RenderFormat) => {
    const parse = Range.prototype.createContextualFragment.bind(
        document.createRange()
    );
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    const dom = config.sanitize ? getSanitizedContent(converted) : converted;
    return parse(dom);
};

/**
 * Sanitize the supplied HTML string using DOMPurify.
 */
export const getSanitizedContent = (content: string): string => {
    const preprocessed = preprocessStyleTags(content);
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
                const attrName: string = hookEvent.attrName.toLowerCase();
                const tagName: string = currentNode.tagName
                    ? currentNode.tagName.toLowerCase()
                    : '';
                let value: string = hookEvent.attrValue;

                // NFKC normalize URL-bearing attribute values to defeat Unicode
                // obfuscation of dangerous schemes, and strip control characters
                // (browsers ignore C0 controls when parsing URLs, so e.g.
                // `java\x00script:` is parsed as `javascript:` and must be
                // rejected by the same scheme check).
                if (
                    attrName === 'href' ||
                    attrName === 'src' ||
                    attrName === 'xlink:href'
                ) {
                    value = value
                        .normalize('NFKC')
                        .replace(/[\x00-\x1F\x7F\uFFFD]/g, '');
                    hookEvent.attrValue = value;
                }

                const isSvgTag = SVG_TAGS.has(tagName);

                // Keep strict per-tag allowlist behavior for HTML tags. For SVG
                // tags, use a denylist so legitimate presentation/filter attrs are
                // not dropped whenever we miss a tag-specific entry.
                if (!isSvgTag) {
                    const allowedForTag = ALLOWED_ATTRIBUTES[tagName] || [];
                    const allowedGlobal = ALLOWED_ATTRIBUTES['*'] || [];
                    const merged = [...allowedGlobal, ...allowedForTag];
                    const isAllowed = merged.some((pattern) => {
                        if (pattern.endsWith('-*')) {
                            return attrName.startsWith(pattern.slice(0, -1));
                        }
                        return pattern === attrName;
                    });
                    if (!isAllowed) {
                        hookEvent.keepAttr = false;
                        return;
                    }
                } else if (
                    /^on[a-z]+$/i.test(attrName) ||
                    SVG_ATTRIBUTE_DENYLIST.has(attrName)
                ) {
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
                            hookEvent.keepAttr = false;
                            return;
                        }
                    } else if (isSvgTag) {
                        // Default-deny: SVG tag without an allowedSchemesByTag entry.
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
                    const funciriScheme = value.match(
                        /url\(\s*["']?([a-z][a-z0-9+.\-]*)\s*:/i
                    );
                    if (funciriScheme) {
                        const fScheme = funciriScheme[1].toLowerCase();
                        if (fScheme !== 'data') {
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
                    SMIL_ATTRIBUTE_NAME_DENYLIST.has(value.toLowerCase())
                ) {
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
                        .map((d) => d.trim().replace(/^([^:]+?)\s*:\s*/, '$1:'))
                        .filter((d) => d.length > 0)
                        .join(';');
                    return;
                }

                // Defense-in-depth: drop xlink:href if it carries javascript:
                if (
                    attrName === 'xlink:href' &&
                    /^javascript\s*:/i.test(value)
                ) {
                    hookEvent.keepAttr = false;
                    return;
                }

                // Defense-in-depth: scriptingPatterns check on the value
                const lowerValue = value.toLowerCase();
                const hasDangerous = VisualConstants.scriptingPatterns.some(
                    (p) => lowerValue.includes(p.toLowerCase())
                );
                if (hasDangerous) {
                    hookEvent.keepAttr = false;
                    return;
                }

                // SVG tag, all enforcement checks passed: force-keep so DOMPurify's
                // built-in attr allowlist doesn't drop legitimate SVG attrs.
                if (isSvgTag) {
                    hookEvent.forceKeepAttr = true;
                }
            }
        );

        // Hook 2: per-element sanitization.
        //  - If any element has an on* event-handler attribute, drop the
        //    entire element by removing it from its parent.
        //  - For <style> tags: run sanitizeCss on the text content as a
        //    defense-in-depth backstop. preprocessStyleTags already sanitized
        //    the body via regex extraction, but if the regex was defeated
        //    (e.g. by a '>' inside an attribute value or an unclosed tag),
        //    this hook catches the fallthrough. DOMPurify's ADD_TAGS:['style']
        //    preserves the element — without this hook, an unsanitized body
        //    would reach the DOM.
        purify.addHook('uponSanitizeElement', (currentNode: Element) => {
            if (!currentNode) return;

            // Style-tag backstop: sanitize the text content through postcss
            // so preprocessStyleTags bypasses don't reach the DOM.
            if (
                currentNode.nodeName &&
                currentNode.nodeName.toLowerCase() === 'style'
            ) {
                const raw = currentNode.textContent || '';
                if (raw.trim()) {
                    const sanitized = sanitizeCss(raw, 'stylesheet');
                    currentNode.textContent = sanitized;
                }
                return;
            }

            if (!currentNode.attributes) return;
            for (let i = 0; i < currentNode.attributes.length; i++) {
                const attr = currentNode.attributes[i];
                if (/^on[a-z]+$/i.test(attr.name)) {
                    if (currentNode.parentNode) {
                        currentNode.parentNode.removeChild(currentNode);
                    }
                    return;
                }
            }
        });

        // ALLOWED_ATTR is intentionally absent from this config. DOMPurify's
        // built-in default attr allowlist would otherwise pre-strip legitimate
        // SVG presentation/filter attrs (stdDeviation, fill-opacity, etc.)
        // before our uponSanitizeAttribute hook can decide. Per-tag enforcement
        // is fully delegated to the hook: HTML tags use the strict per-tag
        // allowlist in ALLOWED_ATTRIBUTES; SVG tags use a denylist plus URL
        // scheme rules. Removing ALLOWED_ATTR is a deliberate trade — we lose
        // one defense-in-depth layer and depend entirely on the hook's
        // contract for attribute decisions.
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

        return purify.sanitize(preprocessed, dpConfig);
    } finally {
        // Hooks are global per instance — tear them down so they don't
        // leak across calls (or across tests). Wraps both addHook calls
        // and the sanitize call so a throw from any of them still hits
        // the cleanup path (no leaked hooks on the cached singleton).
        purify.removeAllHooks();
    }
};

/**
 * Sanitize CSS content (custom stylesheet entry point).
 */
export const getSanitizedCss = (css: string): string => {
    if (!css || typeof css !== 'string') {
        return '';
    }
    return sanitizeCss(css, 'stylesheet');
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
    const safeMimeTypes = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'image/webp',
        'image/bmp',
        'image/svg+xml'
    ];

    if (!safeMimeTypes.includes(mimeType)) {
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
 * Test-only entry point that returns the sanitized HTML *string*.
 */
export const getSanitizedHtmlForTesting = (
    content: string,
    format: RenderFormat
): string => {
    const fragment = getParsedHtmlAsDom(content, format);
    const container = document.createElement('div');
    container.appendChild(fragment);
    return container.innerHTML;
};
