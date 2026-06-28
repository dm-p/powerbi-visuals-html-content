// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

// External dependencies
import { select, Selection } from 'd3-selection';

/**
 * For the specified element, process all hyperlinks so that they are either explicitly denied,
 * or delegated to the Power BI visual host for permission to open.
 *
 * @param host              - The Power BI visual host services object.
 * @param container         - The container to process.
 * @param allowDelegation   - Allow hyperlinks to be delegated to Power BI.
 */
export function resolveHyperlinkHandling(
    host: IVisualHost,
    container: Selection<any, any, any, any>,
    allowDelegation?: boolean
) {
    container.selectAll('a').on('click', (event) => {
        // preventDefault unconditionally - when delegation is off, the
        // click must be a no-op (no navigation, no host.launchUrl call).
        event.preventDefault();
        if (!allowDelegation) return;
        // `select(...).attr('href')` reads only the unprefixed form,
        // so fall back to `xlink:href` for SVG 1.1 authored anchors.
        // In the normal sanitized path this fallback never matches:
        // `<a>` takes the HTML branch in the sanitizer and
        // `xlink:href` is not in `ALLOWED_ATTRIBUTES['a']`, so it is
        // dropped by the per-tag allowlist before the URL scheme check
        // runs (see fixture `hyperlinks-reject-svg-xlink-href-legacy`).
        // Retained as defense-in-depth for any unsanitized content
        // that reaches this handler, and exercised by the bypass test.
        const sel = select(event.currentTarget as Element);
        const url = (sel.attr('href') || sel.attr('xlink:href') || '').trim();
        // Defense-in-depth: even though the sanitizer already restricts
        // <a href> / <a xlink:href> to http/https, re-check at the call
        // boundary before handing the URL to host.launchUrl(). Power BI's
        // launchUrl contract requires http(s); any other scheme reaching
        // here is a sanitizer bypass and must be rejected — silently, so
        // the user sees no action and no error.
        if (!/^https?:\/\//i.test(url)) return;
        // Fail-soft envelope around the host boundary. host.launchUrl is
        // owned by Power BI and may throw in embedded / restricted-host
        // scenarios; an uncaught throw would propagate through d3's
        // event dispatch and break later click handlers. Log and
        // swallow — the user sees no action and no error, consistent
        // with the silent-reject posture for non-http(s) URLs above.
        try {
            host.launchUrl(url);
        } catch (err) {
            console.warn('host.launchUrl failed:', err);
        }
    });
}
