// External dependencies
import * as config from '../config/visual.json';
// Namespace import shape works for both the main tsconfig (module: es6,
// no strict/esModuleInterop) and the test-integration tsconfig (strict).
// Cast to `any` to call — the exported namespace is callable at runtime
// but TS only surfaces that under esModuleInterop.
import * as sanitizeHtmlNs from 'sanitize-html';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sanitizeHtml: any = (sanitizeHtmlNs as any).default || sanitizeHtmlNs;
import { marked } from 'marked';

// Internal dependencies
import { VisualConstants } from './visual-constants';
import { RenderFormat } from './types';
import { sanitizeCss } from './css-sanitizer';

/**
 * Per-tag attribute allowlist for sanitize-html, replacing the previous
 * { '*': ['*'] } catch-all. Designed to shrink the HTML-layer attack
 * surface without breaking legitimate report-author content.
 *
 * Globals (apply to every allowed tag):
 *   class, id, title, lang, dir, style, role, aria-*, data-*, tabindex
 *
 * Per-tag entries add to the global set rather than replacing it
 * (sanitize-html merges them).
 *
 * Explicitly NOT allowed anywhere — dropped from any tag where they appear:
 *   srcdoc, formaction, action, ping, background, poster, srcset.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALLOWED_ATTRIBUTES: any = {
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

    // SVG. Note sanitize-html lowercases tag names, so keys here must be
    // lowercase to match VisualConstants.allowedTags entries like
    // 'lineargradient', 'radialgradient', 'clippath'.
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
    'use': ['x', 'y', 'width', 'height', 'xlink:href', 'href'],
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
    'animate': ['attributename', 'from', 'to', 'dur', 'begin', 'end', 'repeatcount', 'values', 'keytimes', 'keysplines', 'fill'],
    'animatemotion': ['path', 'dur', 'begin', 'end', 'repeatcount', 'rotate'],
    'animatetransform': ['attributename', 'type', 'from', 'to', 'dur', 'begin', 'end', 'repeatcount', 'values', 'fill'],
    'set': ['attributename', 'to', 'begin', 'dur']
};

/**
 * Pre-process <style> tag bodies through sanitizeCss before handing off
 * to sanitize-html. sanitize-html's transformTags callback does not
 * expose tag text, so we use a regex pass over the raw input to extract
 * <style> bodies, sanitize them, and re-inject. Case-insensitive.
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
 * Parse the supplied HTML string and then return as a DOM fragment that we can
 * use in the visual for our data. If we're specifying in the configuration that
 * we should sanitize, do this also, so that we're not injecting any malicious
 * code into the DOM and keep to certification requirements.
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
 * Sanitize the supplied HTML string, based on the configuration settings. This will remove any
 * potentially dangerous content, such as javascript, and ensure that we are only allowing the tags and
 * attributes that we want to be able to use.
 */
export const getSanitizedContent = (content: string) => {
    const {
        allowedSchemes,
        allowedSchemesByTag,
        allowedTags
    } = VisualConstants;
    const preprocessed = preprocessStyleTags(content);
    return sanitizeHtml(preprocessed, {
              allowedAttributes: ALLOWED_ATTRIBUTES,
              allowedTags,
              allowVulnerableTags: true,
              allowedSchemes,
              allowedSchemesByTag,
              transformTags: {
                  '*': (tagName: string, attribs: Record<string, string>) => {
                      // Detect event-handler attributes (onload, onclick, ...) BEFORE
                      // the per-tag allowlist strips them. The presence of any such
                      // attribute marks the entire tag for removal via a sentinel
                      // data-* attribute that exclusiveFilter checks below. We mark
                      // here (not in exclusiveFilter directly) because the tightened
                      // allowedAttributes runs before exclusiveFilter and would
                      // otherwise hide the on* attributes from it.
                      const hasEventAttribute = Object.keys(attribs).some(
                          (a) => /^on[a-z]+$/i.test(a)
                      );
                      if (hasEventAttribute) {
                          attribs['data-sanitize-drop'] = '1';
                      }
                      // Sanitize data URIs in src attributes
                      if (attribs.src && typeof attribs.src === 'string' && attribs.src.startsWith('data:')) {
                          attribs.src = getSanitizedDataUri(attribs.src);
                      }
                      // Sanitize data URIs in href attributes for SVG/images
                      if (attribs.href && typeof attribs.href === 'string' && attribs.href.startsWith('data:')) {
                          attribs.href = getSanitizedDataUri(attribs.href);
                      }
                      // Sanitize xlink:href (SVG attribute that can carry javascript: or data: URIs)
                      if (attribs['xlink:href'] && typeof attribs['xlink:href'] === 'string') {
                          if (attribs['xlink:href'].startsWith('data:')) {
                              attribs['xlink:href'] = getSanitizedDataUri(attribs['xlink:href']);
                          } else if (/^javascript\s*:/i.test(attribs['xlink:href'])) {
                              delete attribs['xlink:href'];
                          }
                      }
                      // Sanitize inline style attribute via the CSS sanitizer.
                      if (attribs.style && typeof attribs.style === 'string') {
                          const sanitizedStyle = sanitizeCss(attribs.style, 'declaration-list');
                          if (sanitizedStyle === '') {
                              delete attribs.style;
                          } else {
                              attribs.style = sanitizedStyle;
                          }
                      }
                      return {
                          tagName,
                          attribs: getStrippedAttributes(attribs)
                      };
                  }
              },
              exclusiveFilter: (frame: { tag: string; text: string; attribs: Record<string, string> }) => {
                  try {
                      // Drop tags marked by transformTags as containing event handlers
                      // (the marker survives the per-tag allowlist as a data-* attr).
                      if (frame.attribs['data-sanitize-drop'] === '1') {
                          return true;
                      }
                      // Belt-and-braces: also test for any event attributes still on
                      // the frame (in case future allowlist tweaks let one through).
                      const eventAttributeFailure = Object.keys(
                          frame.attribs
                      ).some(attr => {
                          return /^on[a-z]+$/i.test(attr);
                      });

                      return eventAttributeFailure;
                  } catch (e) {
                      return true;
                  }
              }
          });
};

/**
 * It still might be possible to encode 'javascript' into an attribute, so
 * we'll strip out any attributes that contain this, or any other potential
 * scripting patterns.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getStrippedAttributes = (attribs: any): any => {
    for (const [key, value] of Object.entries(attribs)) {
        // Check attribute values for dangerous patterns (case-insensitive)
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            const hasDangerousPattern = VisualConstants.scriptingPatterns.some(pattern =>
                lowerValue.includes(pattern.toLowerCase())
            );

            if (hasDangerousPattern) {
                delete attribs[key];
                continue;
            }
        }
    }
    return attribs;
};

/**
 * Sanitize CSS content to remove dangerous patterns that could lead to XSS or data exfiltration.
 * This is critical for both <style> tag content and custom stylesheets.
 */
export const getSanitizedCss = (css: string): string => {
    if (!css || typeof css !== 'string') {
        return '';
    }
    return sanitizeCss(css, 'stylesheet');
};

/**
 * Sanitize CSS specifically for data URIs in img src attributes.
 * Only allows specific safe image MIME types.
 */
export const getSanitizedDataUri = (dataUri: string): string => {
    if (!dataUri || !dataUri.startsWith('data:')) {
        return dataUri;
    }

    const mimeMatch = dataUri.match(/^data:([^;,]+)/i);
    if (mimeMatch) {
        const mimeType = mimeMatch[1].toLowerCase();
        // Whitelist of safe image MIME types
        const safeMimeTypes = [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/gif',
            'image/webp',
            'image/bmp'
        ];

        if (!safeMimeTypes.includes(mimeType)) {
            console.warn(`Blocked data URI with unsafe MIME type: ${mimeType}`);
            return 'data:,';
        }
    }

    return dataUri;
};

/**
 * Test-only entry point that returns the sanitized HTML *string* (not a
 * DOM fragment) for a given input. Used by the integration harness to feed
 * payloads through the exact production sanitization pipeline.
 *
 * Do not call this from production code — use getParsedHtmlAsDom instead.
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
