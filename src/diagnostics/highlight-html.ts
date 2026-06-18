/**
 * Dependency-free HTML source colorizer for the Raw HTML tab. Escapes the
 * source for safe innerHTML, then wraps tag/attr/string tokens in classed
 * <span>s. Above a size threshold it returns plain escaped text (no spans) to
 * avoid a token-span node explosion. Stripping the spans always yields the
 * escaped source — highlighting never changes meaning.
 */
import { VisualConstants } from '../visual-constants';

export const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

// Matches an escaped tag: &lt; optional / tagname …attrs… optional / &gt;
const TAG = /(&lt;\/?)([a-zA-Z][\w-]*)((?:(?!&gt;).)*?)(\/?&gt;)/g;
const ATTR = /([\w-]+)(=)(&quot;(?:(?!&quot;).)*&quot;)/g;

export const highlightHtml = (raw: string): string => {
    const escaped = escapeHtml(raw);
    if (raw.length > VisualConstants.diagnostics.highlightSizeLimit) {
        return escaped;
    }
    return escaped.replace(TAG, (_m, open, name, attrs, close) => {
        const attrsHtml = attrs.replace(
            ATTR,
            (_a: string, n: string, eq: string, val: string) =>
                `<span class="hc-attr">${n}</span>${eq}<span class="hc-str">${val}</span>`
        );
        return (
            `<span class="hc-punc">${open}</span>` +
            `<span class="hc-tag">${name}</span>` +
            attrsHtml +
            `<span class="hc-punc">${close}</span>`
        );
    });
};
