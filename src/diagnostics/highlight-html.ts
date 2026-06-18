/**
 * Dependency-free HTML source colorizer for the Raw HTML tab. Escapes the
 * source for safe innerHTML, then wraps tag / attribute / string tokens in
 * classed <span>s. Above a size threshold (measured on the ESCAPED string) it
 * returns plain escaped text (no spans) to bound the dialog's DOM node count.
 *
 * Tag detection is a single LINEAR forward scan (indexOf-based, never a
 * backtracking regex), so author content with many literal `<` characters in
 * text — which getRawHtml emits unescaped (code snippets, math, template
 * syntax) — cannot trigger super-linear runtime.
 *
 * Stripping the spans always yields the escaped source — highlighting never
 * changes meaning. NOTE: only the four innerHTML-significant characters are
 * escaped (& < > "); single quotes are intentionally NOT escaped, so the
 * output is safe for innerHTML / text contexts but NOT for placing inside a
 * single-quoted HTML attribute.
 */
import { VisualConstants } from '../visual-constants';

export const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const LT = '&lt;';
const GT = '&gt;';

// Attribute name="value" pairs WITHIN one already-escaped tag body. The body
// is a single tag's worth of text (bounded by the forward scan), so this
// regex can never run away on whole-document input.
const ATTR = /([\w-]+)(=)(&quot;(?:(?!&quot;).)*&quot;)/g;

const wrapAttrs = (body: string): string =>
    body.replace(
        ATTR,
        (_a: string, n: string, eq: string, val: string) =>
            `<span class="hc-attr">${n}</span>${eq}<span class="hc-str">${val}</span>`
    );

/**
 * Colorize one full escaped tag token of the form
 * `LT [/] name [ body ] [/] GT`. Only inserts spans around slices of the input,
 * so stripping the spans returns the original tag text unchanged.
 */
const wrapTag = (tag: string): string => {
    let p = LT.length;
    let open = LT;
    if (tag[p] === '/') {
        open = LT + '/';
        p += 1;
    }
    let name = '';
    while (p < tag.length && /[\w-]/.test(tag[p])) {
        name += tag[p];
        p += 1;
    }
    let bodyEnd = tag.length - GT.length;
    let close = GT;
    if (tag[bodyEnd - 1] === '/') {
        bodyEnd -= 1;
        close = '/' + GT;
    }
    const body = tag.slice(p, bodyEnd);
    return (
        `<span class="hc-punc">${open}</span>` +
        `<span class="hc-tag">${name}</span>` +
        wrapAttrs(body) +
        `<span class="hc-punc">${close}</span>`
    );
};

const isLetter = (c: string | undefined): boolean =>
    c !== undefined && /[a-zA-Z]/.test(c);

export const highlightHtml = (raw: string): string => {
    const escaped = escapeHtml(raw);
    if (escaped.length > VisualConstants.diagnostics.highlightSizeLimit) {
        return escaped;
    }
    let out = '';
    let i = 0;
    while (i < escaped.length) {
        const lt = escaped.indexOf(LT, i);
        if (lt === -1) {
            out += escaped.slice(i);
            break;
        }
        out += escaped.slice(i, lt);
        // Tag name starts after the LT and an optional '/'.
        let nameStart = lt + LT.length;
        if (escaped[nameStart] === '/') {
            nameStart += 1;
        }
        if (!isLetter(escaped[nameStart])) {
            // Not a tag start (a literal `<` in text) — emit the LT and move on.
            out += LT;
            i = lt + LT.length;
            continue;
        }
        const gt = escaped.indexOf(GT, nameStart);
        if (gt === -1) {
            // No closing delimiter — the remainder is plain text.
            out += escaped.slice(lt);
            break;
        }
        out += wrapTag(escaped.slice(lt, gt + GT.length));
        i = gt + GT.length;
    }
    return out;
};
