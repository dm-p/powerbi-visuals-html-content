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
    return sanitizeHtml(content, {
              allowedAttributes: { '*': ['*'] },
              allowedTags,
              allowedSchemes,
              allowedSchemesByTag,
              transformTags: {
                  '*': (tagName: string, attribs: Record<string, string>) => {
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
                      return {
                          tagName,
                          attribs: getStrippedAttributes(attribs)
                      };
                  }
              },
              exclusiveFilter: (frame: { tag: string; text: string; attribs: Record<string, string> }) => {
                  try {
                      // Test for dangerous CSS patterns in <style> tags
                      let cssContentFail = false;
                      if (frame.tag === 'style' && frame.text) {
                          // Use comprehensive CSS sanitization check
                          for (const pattern of VisualConstants.cssDangerousPatterns) {
                              if (pattern.test(frame.text)) {
                                  console.warn(`Blocked <style> tag containing dangerous pattern: ${pattern}`);
                                  cssContentFail = true;
                                  break;
                              }
                          }
                          // Also check for non-image data URIs in style content
                          if (!cssContentFail) {
                              const dataUriPattern = /url\s*\(\s*['"]?\s*data:([^;,\s)]+)/gi;
                              const matches = frame.text.match(dataUriPattern);
                              if (matches) {
                                  for (const match of matches) {
                                      const mimeMatch = match.match(/data:([^;,\s)]+)/i);
                                      if (mimeMatch && !mimeMatch[1].toLowerCase().startsWith('image/')) {
                                          console.warn(`Blocked <style> tag with non-image data URI: ${mimeMatch[1]}`);
                                          cssContentFail = true;
                                          break;
                                      }
                                  }
                              }
                          }
                      }

                      // Test for event attributes (onload, onclick, etc.) - anchored and case-insensitive
                      const eventAttributeFailure = Object.keys(
                          frame.attribs
                      ).some(attr => {
                          return /^on[a-z]+$/i.test(attr);
                      });

                      const fail = cssContentFail || eventAttributeFailure;
                      return fail;
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

            // Check inline style attributes against CSS dangerous patterns
            if (key.toLowerCase() === 'style') {
                const hasDangerousCss = VisualConstants.cssDangerousPatterns.some(
                    pattern => pattern.test(value)
                );
                if (hasDangerousCss) {
                    delete attribs[key];
                }
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

    // Check for dangerous CSS patterns and block the entire stylesheet if found
    for (const pattern of VisualConstants.cssDangerousPatterns) {
        if (pattern.test(css)) {
            console.warn(`Blocked CSS containing dangerous pattern: ${pattern}`);
            return '/* CSS blocked: contains potentially dangerous content */';
        }
    }

    // Additional checks for data URIs in CSS - only allow safe image types
    const dataUriPattern = /url\s*\(\s*['"]?\s*data:([^;,\s)]+)/gi;
    const matches = css.match(dataUriPattern);

    if (matches) {
        for (const match of matches) {
            const mimeMatch = match.match(/data:([^;,\s)]+)/i);
            if (mimeMatch) {
                const mimeType = mimeMatch[1].toLowerCase();
                // Only allow image MIME types
                if (!mimeType.startsWith('image/')) {
                    console.warn(`Blocked CSS data URI with non-image MIME type: ${mimeType}`);
                    return '/* CSS blocked: data URI contains non-image content */';
                }
            }
        }
    }

    return css;
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
