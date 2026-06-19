/**
 * Dependency-free HTML-source colorizer for the Raw HTML tab, built as DOM
 * NODES (never innerHTML) so the certified visual keeps its no-innerHTML
 * posture. A single LINEAR forward scan over the raw source: text goes into
 * text nodes (which the DOM auto-escapes — no manual escaping needed) and tags
 * are wrapped in classed <span>s. Above a size threshold the whole source is
 * emitted as a single text node (no per-token nodes) to bound the dialog's DOM
 * node count.
 *
 * Lossless by construction: the fragment's textContent always equals the raw
 * source, because every character is placed in exactly one text node. The
 * linear scan (indexOf-based, never a backtracking regex) means author content
 * with many literal `<` in text — which getRawHtml emits unescaped — cannot
 * trigger super-linear runtime.
 */
import { VisualConstants } from '../visual-constants';

const span = (cls: string, text: string): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
};

const isLetter = (c: string | undefined): boolean =>
    c !== undefined && /[a-zA-Z]/.test(c);

// name="value" / name='value' attribute pairs within a single tag's body.
// Both quote styles are colorized (authors use both). Operates on one tag's
// worth of text, so it can never run away on whole-doc input.
const ATTR = /([\w-]+)(=)("[^"]*"|'[^']*')/g;

/** Append a tag body (between name and close delimiter), coloring attr pairs. */
const appendBody = (parent: Node, body: string): void => {
    let last = 0;
    let m: RegExpExecArray | null;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(body)) !== null) {
        if (m.index > last) {
            parent.appendChild(
                document.createTextNode(body.slice(last, m.index))
            );
        }
        parent.appendChild(span('hc-attr', m[1]));
        parent.appendChild(document.createTextNode(m[2])); // '='
        parent.appendChild(span('hc-str', m[3]));
        last = m.index + m[0].length;
    }
    if (last < body.length) {
        parent.appendChild(document.createTextNode(body.slice(last)));
    }
};

/**
 * Index of the '>' that closes the tag starting at `from`, skipping any '>'
 * that sits inside a quoted attribute value (e.g. `<div data-cond="x>0">`).
 * Single forward scan — no backtracking, so runtime stays linear. Returns -1
 * if no unquoted '>' appears before end-of-input.
 */
const findTagEnd = (raw: string, from: number): number => {
    let quote: string | undefined;
    for (let j = from; j < raw.length; j += 1) {
        const c = raw[j];
        if (quote !== undefined) {
            if (c === quote) quote = undefined;
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '>') {
            return j;
        }
    }
    return -1;
};

/** Append one full tag token `< [/] name [body] [/] >` as colored nodes. */
const appendTag = (parent: Node, tag: string): void => {
    let p = 1; // after the leading '<'
    let open = '<';
    if (tag[p] === '/') {
        open = '</';
        p += 1;
    }
    let nameEnd = p;
    while (nameEnd < tag.length && /[\w-]/.test(tag[nameEnd])) {
        nameEnd += 1;
    }
    const name = tag.slice(p, nameEnd);
    let bodyEnd = tag.length - 1; // before the trailing '>'
    let close = '>';
    if (tag[bodyEnd - 1] === '/') {
        bodyEnd -= 1;
        close = '/>';
    }
    parent.appendChild(span('hc-punc', open));
    parent.appendChild(span('hc-tag', name));
    appendBody(parent, tag.slice(nameEnd, bodyEnd));
    parent.appendChild(span('hc-punc', close));
};

/**
 * Build a colorized DOM fragment for `raw`. `frag.textContent === raw` always
 * holds. Use this (not innerHTML) to render the Raw HTML tab.
 */
export const buildHighlightedFragment = (raw: string): DocumentFragment => {
    const frag = document.createDocumentFragment();
    if (raw.length > VisualConstants.diagnostics.highlightSizeLimit) {
        frag.appendChild(document.createTextNode(raw));
        return frag;
    }
    let i = 0;
    while (i < raw.length) {
        const lt = raw.indexOf('<', i);
        if (lt === -1) {
            frag.appendChild(document.createTextNode(raw.slice(i)));
            break;
        }
        if (lt > i) {
            frag.appendChild(document.createTextNode(raw.slice(i, lt)));
        }
        let nameStart = lt + 1;
        if (raw[nameStart] === '/') {
            nameStart += 1;
        }
        if (!isLetter(raw[nameStart])) {
            // A literal '<' in text, not a tag — emit it and move on.
            frag.appendChild(document.createTextNode('<'));
            i = lt + 1;
            continue;
        }
        const gt = findTagEnd(raw, nameStart);
        if (gt === -1) {
            // No closing delimiter — the remainder is plain text.
            frag.appendChild(document.createTextNode(raw.slice(lt)));
            break;
        }
        appendTag(frag, raw.slice(lt, gt + 1));
        i = gt + 1;
    }
    return frag;
};
