// External dependencies
import * as config from '../config/visual.json';
// Namespace import for compatibility with the project tsconfig
// (no esModuleInterop). The runtime export is callable for jsdom binding.
import * as DOMPurifyNs from 'dompurify';
const DOMPurify: any = (DOMPurifyNs as any).default || DOMPurifyNs;
import { marked } from 'marked';

// Internal dependencies
import { VisualConstants } from './visual-constants';
import { RenderFormat } from './types';
import { sanitizeCss } from './css-sanitizer';

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
const ALLOWED_ATTRIBUTES: AttributeAllowlist = {
    '*': [
        'class', 'id', 'title', 'lang', 'dir', 'style', 'role',
        'aria-*', 'data-*', 'tabindex'
    ],
    'a': ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
    'img': ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    'source': ['src', 'type', 'media'],
    'table': ['align', 'valign'],
    'td': ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign'],
    'th': ['colspan', 'rowspan', 'headers', 'scope', 'abbr', 'align', 'valign'],
    'col': ['span'],
    'colgroup': ['span'],
    'time': ['datetime'],
    'blockquote': ['cite'],
    'q': ['cite'],
    'ol': ['start', 'type', 'reversed'],
    'li': ['value'],
    'details': ['open'],
    'meter': ['value', 'min', 'max', 'low', 'high', 'optimum'],
    'progress': ['value', 'max'],
    // del, ins, output were added to VisualConstants.allowedTags in
    // commit 3e440c9 (PR #139). Each has legitimate tag-specific
    // attributes per the HTML spec; without these entries the attribs
    // are dropped and only the globals survive.
    'del': ['cite', 'datetime'],
    'ins': ['cite', 'datetime'],
    'output': ['for', 'form', 'name'],

    // SVG. Lowercase keys to match DOMPurify's lowercased tagName.
    'svg': [
        'viewbox', 'xmlns', 'xmlns:xlink', 'width', 'height',
        'preserveaspectratio', 'fill', 'stroke', 'stroke-width', 'opacity'
    ],
    'path': [
        'd', 'fill', 'stroke', 'stroke-width', 'fill-opacity',
        'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
        'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
        'clip-path', 'mask', 'filter'
    ],
    'g': [
        'fill', 'stroke', 'stroke-width', 'opacity', 'transform',
        'clip-path', 'mask', 'filter'
    ],
    'circle': ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity'],
    'ellipse': ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity'],
    'rect': [
        'x', 'y', 'width', 'height', 'rx', 'ry',
        'fill', 'stroke', 'stroke-width', 'opacity'
    ],
    'line': ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width', 'opacity'],
    'polyline': ['points', 'fill', 'stroke', 'stroke-width', 'opacity'],
    'polygon': ['points', 'fill', 'stroke', 'stroke-width', 'opacity'],
    'text': [
        'x', 'y', 'dx', 'dy', 'text-anchor', 'font-family', 'font-size',
        'font-weight', 'fill', 'stroke', 'dominant-baseline',
        'alignment-baseline', 'transform'
    ],
    'tspan': [
        'x', 'y', 'dx', 'dy', 'text-anchor', 'font-family', 'font-size',
        'font-weight', 'fill'
    ],
    // Note: <use> is intentionally NOT in VisualConstants.allowedTags, so
    // DOMPurify drops it before any per-tag attribute logic could run. No
    // entry needed here.
    'defs': [],
    'symbol': ['viewbox', 'preserveaspectratio'],
    'lineargradient': ['x1', 'x2', 'y1', 'y2', 'gradientunits', 'gradienttransform'],
    'radialgradient': ['cx', 'cy', 'r', 'fx', 'fy', 'gradientunits', 'gradienttransform'],
    'stop': ['offset', 'stop-color', 'stop-opacity'],
    'clippath': ['clippathunits'],
    'mask': ['x', 'y', 'width', 'height', 'maskunits', 'maskcontentunits'],
    'filter': ['x', 'y', 'width', 'height', 'filterunits'],
    'pattern': [
        'x', 'y', 'width', 'height', 'patternunits', 'patterncontentunits',
        'patterntransform'
    ],
    'image': ['x', 'y', 'width', 'height', 'href', 'xlink:href', 'preserveaspectratio'],
    'marker': [
        'markerunits', 'refx', 'refy', 'markerwidth', 'markerheight',
        'orient', 'viewbox', 'preserveaspectratio'
    ],
    'view': ['viewbox', 'preserveaspectratio'],
    'textpath': ['href', 'xlink:href', 'startoffset', 'method', 'spacing'],
    // SMIL animation elements (animate, animatemotion, animatetransform,
    // set) removed from allowedTags — no attribute entries needed.
};

/**
 * Flat union of every attribute name appearing anywhere in
 * ALLOWED_ATTRIBUTES, used as DOMPurify's global ALLOWED_ATTR. Per-tag
 * enforcement happens in the uponSanitizeAttribute hook.
 */
function getFlatAttributeAllowlist(): string[] {
    const set = new Set<string>();
    for (const attrs of Object.values(ALLOWED_ATTRIBUTES)) {
        for (const attr of attrs) set.add(attr);
    }
    return Array.from(set);
}
const FLAT_ATTR_ALLOWLIST = getFlatAttributeAllowlist();

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
let purifyInstance: any = null;
function getPurify(): any {
    if (purifyInstance) return purifyInstance;
    const dp: any = DOMPurify;
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

    // Hook 1: per-attribute sanitization. Per-tag allowlist enforcement,
    // NFKC normalization on URL attributes, data: URI sanitization,
    // inline style sanitization, dangerous-pattern check.
    purify.addHook('uponSanitizeAttribute', (
        currentNode: Element,
        hookEvent: any
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
        if (attrName === 'href' || attrName === 'src' || attrName === 'xlink:href') {
            value = value.normalize('NFKC').replace(/[\x00-\x1F\x7F\uFFFD]/g, '');
            hookEvent.attrValue = value;
        }

        // Per-tag attribute allowlist enforcement
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

        // Per-tag URL scheme enforcement. VisualConstants.allowedSchemesByTag
        // specifies which schemes each tag is allowed to use (e.g. img: only
        // data:, a: only http/https). If the tag has an entry, enforce it;
        // if it doesn't, fall through to the data: URI sanitizer below.
        if (attrName === 'src' || attrName === 'href' || attrName === 'xlink:href') {
            const schemesByTag = VisualConstants.allowedSchemesByTag[tagName];
            if (schemesByTag) {
                const schemeMatch = value.match(/^([a-z][a-z0-9+.\-]*)\s*:/i);
                const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : '';
                if (!schemesByTag.includes(scheme)) {
                    hookEvent.keepAttr = false;
                    return;
                }
            }
        }

        // data: URI sanitization for src/href/xlink:href
        if ((attrName === 'src' || attrName === 'href' || attrName === 'xlink:href') && value.startsWith('data:')) {
            const sanitized = getSanitizedDataUri(value);
            if (sanitized === 'data:,' || sanitized === '') {
                hookEvent.keepAttr = false;
                return;
            }
            hookEvent.attrValue = sanitized;
            return;
        }

        // Inline style sanitization
        if (attrName === 'style') {
            const sanitizedStyle = sanitizeCss(value, 'declaration-list');
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
                .map(d => d.trim().replace(/^([^:]+?)\s*:\s*/, '$1:'))
                .filter(d => d.length > 0)
                .join(';');
            return;
        }

        // Defense-in-depth: drop xlink:href if it carries javascript:
        if (attrName === 'xlink:href' && /^javascript\s*:/i.test(value)) {
            hookEvent.keepAttr = false;
            return;
        }

        // Defense-in-depth: scriptingPatterns check on the value
        const lowerValue = value.toLowerCase();
        const hasDangerous = VisualConstants.scriptingPatterns.some((p) =>
            lowerValue.includes(p.toLowerCase())
        );
        if (hasDangerous) {
            hookEvent.keepAttr = false;
            return;
        }
    });

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
        if (currentNode.nodeName && currentNode.nodeName.toLowerCase() === 'style') {
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

    const dpConfig: any = {
        ALLOWED_TAGS: VisualConstants.allowedTags,
        ALLOWED_ATTR: FLAT_ATTR_ALLOWLIST,
        // Allow data: in URL-bearing attrs (sanitized in the hook).
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        ALLOW_DATA_ATTR: true,
        ALLOW_ARIA_ATTR: true,
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
        FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'ping', 'background', 'poster', 'srcset'],
        ADD_TAGS: ['style'],
        FORCE_BODY: true,
        IN_PLACE: false,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false
    };

    try {
        return purify.sanitize(preprocessed, dpConfig);
    } finally {
        // Hooks are global per instance — tear them down so they don't
        // leak across calls (or across tests).
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
        'image/bmp'
    ];

    if (!safeMimeTypes.includes(mimeType)) {
        console.warn(`Blocked data URI with unsafe MIME type: ${mimeType.slice(0, 64)}`);
        return 'data:,';
    }

    if (!/^data:[^,]*;base64,/i.test(dataUri)) {
        console.warn(
            `Blocked data:${mimeType} URI: missing base64 encoding (smuggled non-binary content)`
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
