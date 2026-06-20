// External dependencies
import { marked } from 'marked';

// Internal dependencies
import { RenderFormat } from '../types';
import { SanitizeOptions } from './options';
import {
    sanitizeHtmlString,
    preprocessHtmlString,
    sanitizeFragmentInPlace,
    sanitizeCssString,
    enabled
} from './backend';

export { SanitizeOptions } from './options';
export { sanitizeFragmentInPlace } from './backend';

/**
 * Whether this edition runs the sanitizer (the certified backend). Replaces the
 * former `config.sanitize` read (e.g. visual.ts's diagnostics `sanitizeEnabled`).
 */
export const sanitizerEnabled = enabled;

/**
 * Parse the supplied HTML string and return a DOM fragment. The active backend
 * decides whether the string is sanitized first (certified) or passed through
 * unchanged (base editions).
 */
export const getParsedHtmlAsDom = (
    content: string,
    format: RenderFormat,
    options?: SanitizeOptions
) => {
    const parse = Range.prototype.createContextualFragment.bind(
        document.createRange()
    );
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    return parse(sanitizeHtmlString(converted, options));
};

/**
 * Parse `content` in the content model of `contextEl` (so `<tr>` etc. survive
 * instead of being foster-parented), then sanitize the parsed node(s) in place
 * via the active backend. Tokens must already be substituted before this call.
 */
export const parseAndSanitizeInContext = (
    content: string,
    format: RenderFormat,
    contextEl: Element,
    options?: SanitizeOptions
): DocumentFragment => {
    const converted =
        format === 'markdown' ? marked.parse(content).toString() : content;
    const preprocessed = preprocessHtmlString(converted);
    const range = document.createRange();
    range.selectNodeContents(contextEl);
    const fragment = range.createContextualFragment(preprocessed);
    sanitizeFragmentInPlace(fragment, options);
    return fragment;
};

/** Sanitize CSS content (custom stylesheet entry point). */
export const getSanitizedCss = (css: string): string => {
    if (!css || typeof css !== 'string') {
        return '';
    }
    return sanitizeCssString(css);
};
