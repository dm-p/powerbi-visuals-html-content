// Pure attribute-policy "gate" functions extracted verbatim from the
// `uponSanitizeAttribute` hook in `backend.certified.ts`. Each gate is a
// behavior-preserving lift of the corresponding guard clause in that hook —
// same regexes, same string literals, same order of checks, same edge cases.
// The ORDER of the gates is security-load-bearing.
//
// This module also OWNS the per-tag attribute-policy constants (SVG_TAGS,
// SMIL_TAGS, the denylists, and ALLOWED_ATTRIBUTES); `backend.certified.ts`
// imports them back. (Circular runtime-only import — see the note on
// `getSanitizedDataUri` below.)

import { VisualConstants } from '../visual-constants';
import { isSafeImageDataUri } from './svg-payload-scan';
import { sanitizeCss } from './css';
// Runtime-only cyclic import: `getSanitizedDataUri` is referenced solely
// inside `dataUriAttr` (never during module init), and the constants this
// module exports are referenced by `backend.certified.ts` only inside its
// hook body (never during init), so the ES-module cycle resolves cleanly.
import { getSanitizedDataUri } from './backend.certified';

// --- Shared per-tag attribute-policy constants ------------------------------

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
export type AttributeAllowlist = {
    [tag: string]: string[];
};

// Derived from VisualConstants.svgTags so adding/removing an SVG tag
// in one place updates both the allowed-tags list and the sanitizer's
// HTML-vs-SVG branch.
export const SVG_TAGS = new Set<string>(VisualConstants.svgTags);

export const SVG_ATTRIBUTE_DENYLIST = new Set<string>([
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
export const SMIL_TAGS = new Set<string>([
    'animate',
    'animatemotion',
    'animatetransform',
    'set'
]);

export const SMIL_ATTRIBUTE_NAME_DENYLIST = new Set<string>([
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

export const ALLOWED_ATTRIBUTES: AttributeAllowlist = {
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

// --- Gate contract ----------------------------------------------------------

export interface AttrContext {
    attrName: string; // already lower-cased
    tagName: string; // already lower-cased ('' if absent)
    value: string; // current working value
    isSvgTag: boolean;
    allowHyperlinks: boolean;
}

export type Verdict =
    | { action: 'drop'; rule: string } // hook: recordRemoval + keepAttr=false + return
    | { action: 'keep'; value: string } // hook: set attrValue + return (final keep)
    | { action: 'continue'; value?: string }; // hook: run next gate; if value present, update working value AND hookEvent.attrValue

/** The common pass case: run the next gate, no value change. */
export const CONTINUE: Verdict = { action: 'continue' };

// --- Gates (order is security-load-bearing) ---------------------------------

/**
 * NFKC normalize URL-bearing attribute values and strip control characters.
 * Verbatim lift of the hook's `isUrlAttr / isSmilValueAttr /
 * isSvgFunciriPresentation` computation + the `.normalize('NFKC').replace(...)`.
 */
export const normalizeUrlAttr = (ctx: AttrContext): Verdict => {
    const { attrName, tagName, isSvgTag } = ctx;
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
    if (isUrlAttr || isSmilValueAttr || isSvgFunciriPresentation) {
        const value = ctx.value
            .normalize('NFKC')
            .replace(/[\x00-\x1F\x7F�]/g, '');
        return { action: 'continue', value };
    }
    return CONTINUE;
};

/**
 * Hyperlink toggle enforcement. When hyperlinks are disabled, strip
 * `href` / `xlink:href` from every `<a>` (HTML and SVG).
 */
export const hyperlinkToggle = (ctx: AttrContext): Verdict => {
    const { attrName, tagName, allowHyperlinks } = ctx;
    if (
        !allowHyperlinks &&
        tagName === 'a' &&
        (attrName === 'href' || attrName === 'xlink:href')
    ) {
        return { action: 'drop', rule: 'hyperlinks-disabled' };
    }
    return CONTINUE;
};

/**
 * Per-tag allowlist (HTML) / on*+denylist (SVG). HTML tags use the strict
 * per-tag allowlist; SVG tags drop on* handlers and SVG_ATTRIBUTE_DENYLIST
 * members.
 */
export const tagAllowlist = (ctx: AttrContext): Verdict => {
    const { attrName, tagName, isSvgTag } = ctx;
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
            return { action: 'drop', rule: 'attr-not-allowed' };
        }
    } else if (
        /^on[a-z]+$/i.test(attrName) ||
        SVG_ATTRIBUTE_DENYLIST.has(attrName)
    ) {
        return { action: 'drop', rule: 'svg-attr-denied' };
    }
    return CONTINUE;
};

/**
 * Per-tag URL scheme enforcement. VisualConstants.allowedSchemesByTag
 * specifies which schemes each tag may use; SVG tags default-deny when no
 * entry exists.
 */
export const urlScheme = (ctx: AttrContext): Verdict => {
    const { attrName, tagName, value, isSvgTag } = ctx;
    if (
        attrName === 'src' ||
        attrName === 'href' ||
        attrName === 'xlink:href'
    ) {
        const schemesByTag = VisualConstants.allowedSchemesByTag[tagName];
        if (schemesByTag) {
            const schemeMatch = value.match(/^([a-z][a-z0-9+.\-]*)\s*:/i);
            const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
            if (!schemesByTag.includes(scheme)) {
                return { action: 'drop', rule: 'disallowed-url-scheme' };
            }
        } else if (isSvgTag) {
            // Default-deny: SVG tag without an allowedSchemesByTag entry.
            return { action: 'drop', rule: 'svg-url-scheme-default-deny' };
        }
    }
    return CONTINUE;
};

/**
 * SVG funciri value-scheme enforcement. Validates every `url(...)` token in
 * an SVG attribute value (except `style`): empty/fragment-only refs are
 * allowed, `data:` is run through the image-data-URI safety check, every
 * other scheme is dropped.
 */
export const svgFunciri = (ctx: AttrContext): Verdict => {
    const { attrName, value, isSvgTag } = ctx;
    if (isSvgTag && attrName !== 'style') {
        const urlTokenRegex =
            /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi;
        let urlTokenMatch: RegExpExecArray | null;
        while ((urlTokenMatch = urlTokenRegex.exec(value)) !== null) {
            const fullUrl = (
                urlTokenMatch[1] ??
                urlTokenMatch[2] ??
                urlTokenMatch[3] ??
                ''
            ).trim();
            if (!fullUrl) continue;
            const schemeMatch = fullUrl.match(/^([a-z][a-z0-9+.\-]*):/i);
            // No scheme — fragment-only (#id) or relative ref. Both safe.
            if (!schemeMatch) continue;
            const scheme = schemeMatch[1].toLowerCase();
            if (scheme !== 'data') {
                return { action: 'drop', rule: 'svg-funciri-scheme' };
            }
            if (!isSafeImageDataUri(fullUrl)) {
                return { action: 'drop', rule: 'svg-funciri-unsafe-data' };
            }
        }
    }
    return CONTINUE;
};

/**
 * SMIL attributeName enforcement. Drop `attributeName` when its (trimmed,
 * lower-cased) value names a denylisted animation target.
 */
export const smilAttributeName = (ctx: AttrContext): Verdict => {
    const { attrName, tagName, value } = ctx;
    if (
        SMIL_TAGS.has(tagName) &&
        attrName === 'attributename' &&
        SMIL_ATTRIBUTE_NAME_DENYLIST.has(value.trim().toLowerCase())
    ) {
        return { action: 'drop', rule: 'smil-attributename' };
    }
    return CONTINUE;
};

/**
 * data: URI sanitization for src/href/xlink:href. Drops when the URI
 * sanitizes to empty; otherwise keeps the sanitized value.
 */
export const dataUriAttr = (ctx: AttrContext): Verdict => {
    if (
        (ctx.attrName === 'src' ||
            ctx.attrName === 'href' ||
            ctx.attrName === 'xlink:href') &&
        ctx.value.startsWith('data:')
    ) {
        const sanitized = getSanitizedDataUri(ctx.value);
        if (sanitized === 'data:,' || sanitized === '') {
            return { action: 'drop', rule: 'data-uri' };
        }
        return { action: 'keep', value: sanitized };
    }
    return CONTINUE;
};

/**
 * Inline style sanitization. Drops when sanitizeCss empties the value;
 * otherwise keeps the normalized declaration list.
 */
export const styleAttr = (ctx: AttrContext): Verdict => {
    if (ctx.attrName === 'style') {
        const sanitizedStyle = sanitizeCss(ctx.value, 'declaration-list');
        if (sanitizedStyle === '') {
            return { action: 'drop', rule: 'inline-style' };
        }
        const normalized = sanitizedStyle
            .split(';')
            .map((d) => d.trim().replace(/^([^:]+?)\s*:\s*/, '$1:'))
            .filter((d) => d.length > 0)
            .join(';');
        return { action: 'keep', value: normalized };
    }
    return CONTINUE;
};

/** Defense-in-depth: drop xlink:href if it carries javascript:. */
export const xlinkJavascript = (ctx: AttrContext): Verdict => {
    if (ctx.attrName === 'xlink:href' && /^javascript\s*:/i.test(ctx.value)) {
        return { action: 'drop', rule: 'xlink-javascript' };
    }
    return CONTINUE;
};

/** Defense-in-depth: scriptingPatterns substring scan on the value. */
export const scriptingPatterns = (ctx: AttrContext): Verdict => {
    const lowerValue = ctx.value.toLowerCase();
    const hasDangerous = VisualConstants.scriptingPatterns.some((p) =>
        lowerValue.includes(p.toLowerCase())
    );
    if (hasDangerous) {
        return { action: 'drop', rule: 'dangerous-pattern' };
    }
    return CONTINUE;
};
