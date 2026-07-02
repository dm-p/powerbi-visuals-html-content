// Cert-safe inline SVG builders for the themeable header link icons. Every node
// is created via createElementNS (no innerHTML). These three need currentColor
// theming (heart pink, coffee brown, GitHub hover) so they are inline rather
// than <img> data URIs. Path data: GitHub Octicons mark, GitHub Sponsors heart,
// a coffee-cup glyph.

/** SVG namespace URI for createElementNS. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * All three icons are 16x16 and set fill/stroke on the root (paths inherit
 * it), so a path is just its `d`.
 */
const svg = (
    doc: Document,
    paths: string[],
    attrs: Record<string, string>
): SVGSVGElement => {
    const root = doc.createElementNS(SVG_NS, 'svg');
    root.setAttribute('viewBox', '0 0 16 16');
    root.setAttribute('width', '16');
    root.setAttribute('height', '16');
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    for (const d of paths) {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        root.appendChild(path);
    }
    return root;
};

/** GitHub Octicons mark, filled with currentColor. */
export const githubIcon = (doc: Document): SVGSVGElement =>
    svg(
        doc,
        [
            'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'
        ],
        { fill: 'currentColor' }
    );

/** GitHub Sponsors heart, filled with currentColor. */
export const heartIcon = (doc: Document): SVGSVGElement =>
    svg(
        doc,
        [
            'M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 008 13.393a20.561 20.561 0 003.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 01-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5z'
        ],
        { fill: 'currentColor' }
    );

/** Coffee-cup glyph, stroked with currentColor. */
export const coffeeIcon = (doc: Document): SVGSVGElement =>
    svg(
        doc,
        [
            'M3 6h8v3.5A2.5 2.5 0 0 1 8.5 12h-3A2.5 2.5 0 0 1 3 9.5V6z',
            'M11 6.8h1.4a1.6 1.6 0 0 1 0 3.2H11',
            'M3 14h8',
            'M5.6 2.6v1.3M8 2.3v1.6'
        ],
        {
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.4',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }
    );
