// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

// External dependencies
import { select, Selection } from 'd3-selection';
import { marked } from 'marked';
import OverlayScrollbars from 'overlayscrollbars';
import pretty from 'pretty';

// Internal dependencies
import { VisualConstants } from './visual-constants';
import {
    StylesheetSettings,
    VisualFormattingSettingsModel
} from './visual-settings';
import { IHtmlEntry } from './view-model';
import { RenderFormat } from './types';
import {
    getParsedHtmlAsDom,
    getSanitizedCss,
    parseAndSanitizeInContext,
    sanitizeFragmentInPlace,
    SanitizeOptions
} from './sanitize';
import { CONTENT_TOKEN, ROW_TOKEN, substitute } from './template-engine';
import { buildHighlightedFragment } from './diagnostics/highlight-html';
import { recordTooltipEvent } from './diagnostics/event-recorder';
import { tooltipContext, TooltipItem } from './diagnostics/host-events';

// Re-export sanitize pipeline entry points so existing callers that import
// from './domain-utils' continue to work after the Task 7 extraction.
export { getParsedHtmlAsDom } from './sanitize';

// The sanitization functions previously defined inline here (getSanitizedContent,
// getStrippedAttributes, getSanitizedCss, getSanitizedDataUri, and the original
// getParsedHtmlAsDom) have been moved to ./sanitize (the seam and its
// backends) so they can be imported by the Playwright integration harness
// without pulling in d3, overlayscrollbars, or powerbi-visuals-api at test
// load time.
// getParsedHtmlAsDom is re-exported above; getSanitizedCss is imported above
// and used by resolveStyling below.

/**
 * Use to determine if we should include stylesheet logic, based on whether it has been supplied or not.
 */
export const shouldUseStylesheet = (stylesheet: StylesheetSettings) =>
    stylesheet.stylesheetCardMain.stylesheet.value ? true : false;

/**
 * Resolve how styling should be applied, based on supplied properties. Basically, if user has supplied
 * their own stylesheet via properties, we will defer to this rather than the standard content formatting
 * ones.
 */
export const resolveStyling = (
    styleSheetContainer: Selection<any, any, any, any>,
    bodyContainer: Selection<any, any, any, any>,
    settings: VisualFormattingSettingsModel
) => {
    const useSS = shouldUseStylesheet(settings.stylesheet);
    const bodyProps = settings.contentFormatting;
    const {
        crossFilter: {
            crossFilterCardMain: {
                enabled,
                useTransparency,
                transparencyPercent
            }
        }
    } = settings;
    const crossFilterStyles =
        enabled.value && useTransparency.value
            ? `.${VisualConstants.dom.entryClassSelector}.${
                  VisualConstants.dom.unselectedClassSelector
              } { opacity: ${1 - transparencyPercent.value / 100}; }`
            : '';
    // CRITICAL: Sanitize custom stylesheet to prevent CSS-based XSS attacks
    const rawCustomStyles =
        (useSS && settings.stylesheet.stylesheetCardMain.stylesheet.value) ||
        '';
    const customStyles = rawCustomStyles
        ? getSanitizedCss(rawCustomStyles)
        : '';
    styleSheetContainer.text(`${crossFilterStyles} ${customStyles}`);
    resolveUserSelect(
        bodyProps.contentFormattingCardBehavior.userSelect.value,
        bodyContainer
    );
    bodyContainer
        .style('font-family', () =>
            resolveBodyStyle(
                useSS,
                bodyProps.contentFormattingCardDefaultBodyStyling.fontFamily
                    .value
            )
        )
        .style('font-size', () =>
            resolveBodyStyle(
                useSS,
                `${bodyProps.contentFormattingCardDefaultBodyStyling.fontSize.value}pt`
            )
        )
        .style('color', () =>
            resolveBodyStyle(
                useSS,
                bodyProps.contentFormattingCardDefaultBodyStyling.fontColour
                    .value.value
            )
        )
        .style('text-align', () =>
            resolveBodyStyle(
                useSS,
                bodyProps.contentFormattingCardDefaultBodyStyling.align.value
            )
        );
    // Default body styling can win against inline `style` declarations
    // carried in the bound content (typically Outlook/Teams/Word paste
    // residue with embedded color/font-family/font-size). Gated on:
    //   1. NOT in custom-stylesheet mode (the user's CSS is sole truth)
    //   2. The "Override inline styling" toggle is enabled
    // Default OFF preserves author intent — inline color/font/alignment
    // render as written. Issue #144 reporters who hit Office paste
    // residue can opt in via the toggle. The matching cascade rule
    // lives in style/visual.less.
    const applyOverride =
        !useSS &&
        bodyProps.contentFormattingCardDefaultBodyStyling.overrideInlineStyling
            .value;
    bodyContainer.classed(
        VisualConstants.dom.defaultBodyStylingClass,
        applyOverride
    );
};

/**
 * The result of resolving a body template into a live join container.
 *   - `container` — the element that rows are inserted into. For the
 *     default body this is `rootEl` itself (`#htmlContent`); for a custom
 *     body it is the element that contained the `{{content}}` slot.
 *   - `anchor` — a persistent invisible comment node marking the exact slot
 *     position. Unit 6 inserts rows BEFORE this anchor so any static
 *     siblings authored around the slot keep their position. `null` for the
 *     default body, where rows simply append to `rootEl` (today's behavior).
 */
export interface TemplateContainer {
    container: HTMLElement;
    anchor: Comment | null;
}

// Internal sentinel value for the body-template content slot. Substituted
// in for the user's `{{content}}` token as an HTML comment before parsing
// (comments are valid in every content model and are not foster-parented),
// then re-used as the persistent anchor comment after sanitization.
const SLOT_MARKER = VisualConstants.dom.contentSlotMarker;

/**
 * Find the first COMMENT node under `root` whose value matches `marker`.
 * Used to locate the content slot in a freshly parsed body fragment BEFORE
 * sanitization (the sanitizer strips comments, so the marker must be read
 * while it still exists).
 */
const findCommentMarker = (root: Node, marker: string): Comment | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    let node = walker.nextNode();
    while (node) {
        if (node.nodeValue === marker) {
            return node as Comment;
        }
        node = walker.nextNode();
    }
    return null;
};

/**
 * Resolve the BODY template into a live "join container" where rows will
 * later be inserted (Unit 6), and clear `rootEl` in the process.
 *
 * DEFAULT BODY — when `bodyTemplate` is just the `{{content}}` token
 * (ignoring surrounding whitespace), no wrapper is parsed: `rootEl` is
 * cleared and returned as the container with a `null` anchor. This is
 * byte-identical to today's behavior, where rows go straight into
 * `#htmlContent`.
 *
 * CUSTOM BODY — the body is parsed, sanitized, and inserted into `rootEl`;
 * the element that contained `{{content}}` is returned as `container`, plus
 * a persistent invisible `anchor` comment marking the exact slot position.
 *
 * SECURITY (this is a CERTIFIED visual): author/CF body HTML is NEVER
 * appended to the live DOM unsanitized. `createContextualFragment` returns
 * a DETACHED fragment; we sanitize that fragment in place (shared
 * `sanitizeFragmentInPlace` helper) and only THEN append it to the live
 * `rootEl`. An `<img src=x onerror=...>` in the body therefore has its
 * handler stripped (and the whole element dropped) before it is ever
 * connected to the document, so the handler cannot fire.
 *
 * @param rootEl        - The live content root (`#htmlContent`).
 * @param bodyTemplate  - The body template string. The `{{content}}` token
 *                        must NOT yet be substituted — this function
 *                        substitutes it for the internal slot marker.
 * @param options       - Sanitizer options (e.g. `allowHyperlinks`).
 */
export const resolveTemplateContainer = (
    rootEl: HTMLElement,
    bodyTemplate: string,
    options: SanitizeOptions
): TemplateContainer => {
    // Clear the root (replaces today's selectAll('*').remove()).
    rootEl.replaceChildren();

    // Default body: the template is ONLY the content token (+ whitespace),
    // so there is no wrapper to parse. Rows go straight into rootEl.
    if (bodyTemplate.replace(CONTENT_TOKEN, '').trim() === '') {
        return { container: rootEl, anchor: null };
    }

    // Custom body: substitute the slot for a COMMENT marker. Comments are
    // valid in every content model and are NOT foster-parented at parse
    // time (unlike a bare token or a context-invalid element), so the
    // marker reliably survives parsing at the slot's true position.
    const withMarker = substitute(
        bodyTemplate,
        CONTENT_TOKEN,
        `<!--${SLOT_MARKER}-->`
    );
    const range = document.createRange();
    // Parse in rootEl's content model so table/list slots behave correctly.
    range.selectNodeContents(rootEl);
    // DETACHED fragment — createContextualFragment does not auto-insert.
    const frag = range.createContextualFragment(withMarker);

    // Locate the marker BEFORE sanitizing — the sanitizer strips comments,
    // so its position must be recorded now and not relied upon to survive.
    const marker = findCommentMarker(frag, SLOT_MARKER);
    if (!marker) {
        // No slot found (e.g. the token sat in a position the parser
        // dropped, or inside a forbidden element the sanitizer removes):
        // fail safe — sanitize the detached fragment, append it, and use
        // rootEl as the container so rows still render.
        sanitizeFragmentInPlace(frag, options);
        rootEl.appendChild(frag);
        return { container: rootEl, anchor: null };
    }
    const container = marker.parentNode as HTMLElement;
    // Anchor position reference: the node (element OR text) immediately before
    // the slot, if any. previousSibling, NOT previousElementSibling, so the slot
    // keeps its position even when bare text precedes it, e.g.
    // `<div>Caption: {{content}}</div>` (rows render after "Caption: ", not
    // before it). Captured pre-sanitize; a text node always survives, an element
    // survives only if allowed — the guard below handles removal.
    const prevNode = marker.previousSibling;
    marker.remove();

    // Sanitize the DETACHED fragment, THEN append to the live rootEl. This
    // is the security boundary: nothing unsanitized is ever connected.
    sanitizeFragmentInPlace(frag, options);
    rootEl.appendChild(frag);

    // Containment guard: if the sanitizer removed the element that contained
    // the slot (e.g. a `<div onclick="x()">` wrapper — the element hook drops
    // any element carrying an on* handler), `container` is now detached and
    // rows inserted into it would render nowhere (silently blank output). Fall
    // back to the root so rows still render.
    if (!rootEl.contains(container)) {
        return { container: rootEl, anchor: null };
    }

    // Drop a persistent invisible anchor at the slot position. Added AFTER
    // sanitize so it is not stripped. Rows insert before it; static
    // siblings keep their position. If prevNode survived sanitization and is
    // still a child of container, place the anchor right after it;
    // otherwise prepend (covers the common "slot is the sole content of its
    // parent" case AND the case where sanitize removed prevNode).
    //
    // The survival test is `prevNode.parentNode === container`, NOT
    // `isConnected`: `rootEl` (#htmlContent) is not guaranteed to be
    // attached to the live document at this point (and is detached under
    // test), so `isConnected` would spuriously fail for a surviving prevNode
    // and mis-prepend the anchor. parentNode identity is the precise signal
    // — a sanitizer-removed node has a null parentNode, a survivor is
    // still a child of container.
    const anchor = document.createComment(SLOT_MARKER);
    if (prevNode && prevNode.parentNode === container) {
        prevNode.after(anchor);
    } else {
        container.prepend(anchor);
    }
    return { container, anchor };
};

/**
 * HTML5 void elements — emitted without a closing tag by domSerialize.
 */
const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr'
]);

/**
 * Serialize a DOM node into a dev-tools-style HTML string with literal
 * characters in attribute values and text content (no HTML-spec entity
 * encoding). Used by the "Show Raw HTML" affordance as a debug surface,
 * standing in for browser dev tools which are unavailable in Power BI
 * Desktop. The output is not guaranteed to be round-trippable as valid
 * HTML when attribute values contain literal `&`, `"`, etc. - it
 * accurately represents what the live DOM contains.
 *
 * @internal Exported for unit testing — not part of the visual's public API.
 */
export const domSerialize = (node: Node): string => {
    switch (node.nodeType) {
        case Node.ELEMENT_NODE: {
            const el = node as Element;
            // SVG element tag names are case-sensitive (e.g. linearGradient,
            // clipPath, foreignObject). Preserve their source case so the
            // dev-tools view doesn't misrepresent valid SVG as invalid.
            // HTML tag names are lowercased to match dev-tools display
            // regardless of the source-case the parser emitted.
            const tagName =
                el.namespaceURI === 'http://www.w3.org/2000/svg'
                    ? el.tagName
                    : el.tagName.toLowerCase();
            let attrs = '';
            for (const attr of el.attributes) {
                // Targeted escape: only `"` becomes `&quot;` so the always-
                // double-quoted attribute delimiter stays balanced. `&` and
                // `<` deliberately stay literal — that's the dev-tools-style
                // contract that the textarea sink depends on for issue #76
                // fidelity. Using replace(/"/g, …) instead of replaceAll
                // because the project's lib: [es2019] predates ES2021's
                // String.prototype.replaceAll.
                const value = attr.value.replace(/"/g, '&quot;');
                attrs += ` ${attr.name}="${value}"`;
            }
            if (VOID_ELEMENTS.has(tagName)) {
                return `<${tagName}${attrs}>`;
            }
            let children = '';
            for (const child of el.childNodes) {
                children += domSerialize(child);
            }
            return `<${tagName}${attrs}>${children}</${tagName}>`;
        }
        case Node.TEXT_NODE:
            return node.nodeValue ?? '';
        case Node.COMMENT_NODE:
            return `<!--${node.nodeValue ?? ''}-->`;
        case Node.DOCUMENT_FRAGMENT_NODE: {
            let out = '';
            for (const child of node.childNodes) {
                out += domSerialize(child);
            }
            return out;
        }
        default:
            return '';
    }
};

/**
 * For the supplied stylesheet container, settings and body container (could be standard content, or the
 * "no data" message container), ensure that the content is resolved, and the raw-HTML view is added to
 * the DOM, as well as caretaking any existing elements.
 *
 * Rendered into a read-only `<pre>` (not a `<textarea>`) so it reuses the same
 * `buildHighlightedFragment` colorizer as the diagnostics dialog's Raw HTML
 * tab — one shared serialization core (`getRawHtml`) AND one shared colorizer.
 * Built as DOM nodes (never innerHTML), preserving the visual's no-innerHTML
 * certification posture. The block stays read-only, scrollable, and selectable.
 */
export const resolveForRawHtml = (
    styleSheetContainer: Selection<any, any, any, any>,
    contentContainer: Selection<any, any, any, any>,
    settings: VisualFormattingSettingsModel
) => {
    if (
        settings.contentFormatting.contentFormattingCardBehavior.showRawHtml
            .value
    ) {
        const output = getRawHtml(
            styleSheetContainer,
            contentContainer,
            settings.stylesheet
        );
        contentContainer.selectAll('*').remove();
        const pre = contentContainer
            .append('pre')
            .attr('id', VisualConstants.dom.rawOutputIdSelector)
            .attr('tabindex', 0)
            .node() as HTMLElement;
        pre.appendChild(buildHighlightedFragment(output));
    }
};

/**
 * Raw HTML for the diagnostics dialog. When Show Raw HTML is ON, the content
 * container has already been replaced by the raw-view <pre> (from
 * resolveForRawHtml); re-serializing that would recurse — the dialog would show
 * the raw view's OWN markup. The <pre>'s textContent IS the raw HTML (lossless,
 * by buildHighlightedFragment's contract), so read it back in that case.
 * Otherwise serialize the live content. Either way the dialog and the in-canvas
 * view show the identical pretty-printed output.
 */
export const getDiagnosticsRawHtml = (
    styleSheetContainer: Selection<any, any, any, any>,
    contentContainer: Selection<any, any, any, any>,
    stylesheet: StylesheetSettings
): string => {
    const node = contentContainer.node() as HTMLElement | null;
    const rawView =
        node &&
        node.querySelector('#' + VisualConstants.dom.rawOutputIdSelector);
    if (rawView) {
        return rawView.textContent ?? '';
    }
    return getRawHtml(styleSheetContainer, contentContainer, stylesheet);
};

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

/**
 * As we want to display different types of element for each entry/grouping, we will clear down the
 * existing children and rebuild with our desired element for handling raw vs. rendered HTML.
 *
 * @param dataElements  - The elements to analyse and process.
 */
export function resolveHtmlGroupElement(
    dataElements: Selection<any, IHtmlEntry, any, any>,
    format: RenderFormat,
    // Optional with a fail-closed default so the contract matches the
    // effective behavior in getSanitizedContent (`options?.allowHyperlinks
    // ?? false`). The tsconfig does not currently enforce strict mode,
    // so a caller that omits this arg compiles silently — the default
    // here keeps the omission safe rather than relying on `undefined`
    // arriving at the sanitizer.
    allowHyperlinks: boolean = false
) {
    // Remove any applied elements
    dataElements.selectAll('*').remove();
    // Add the correct element.
    dataElements.append('div').each(function (d) {
        this.appendChild(
            getParsedHtmlAsDom(d.content, format, { allowHyperlinks })
        );
    });
}

/**
 * Use OverlayScrollbars to apply nicer scrolling to the supplied element.
 * If an existing instance is supplied, it is updated in-place and returned;
 * otherwise a new instance is constructed and returned.
 *
 * @param element   - HTML element to apply scrolling to.
 * @param existing  - Optional existing OverlayScrollbars instance to reuse.
 */
export function resolveScrollableContent(
    element: HTMLElement,
    existing?: OverlayScrollbars
): OverlayScrollbars {
    if (existing) {
        existing.update();
        return existing;
    }
    return OverlayScrollbars(element, {
        scrollbars: {
            clickScrolling: true
        }
    });
}

/**
 * Handle eventing when a data element is hovred over. This includes showing
 * the tooltip and toggling appropriate class names for style hooks.
 *
 * @param dataElements      - The elements to analyse and process.
 * @param host              - Visual host services.
 * @param hasGranularity    - Whether we have granularity or not.
 */
export function resolveHover(
    dataElements: Selection<any, IHtmlEntry, any, any>,
    host: IVisualHost,
    hasGranularity: boolean
) {
    bindStandardTooltips(dataElements, host, hasGranularity);
    bindManualTooltips(dataElements, host);
}

/**
 * If we don't have any granularity, we will look for elements that have
 * a tooltip attribute and use this to show the tooltip.
 *
 * @param dataElements      - The elements to analyse and process.
 * @param host              - Visual host services.
 */
function bindManualTooltips(
    dataElements: Selection<any, IHtmlEntry, any, any>,
    host: IVisualHost
) {
    const { tooltipService } = host;
    const {
        manualTooltipSelector,
        manualTooltipDataPrefix,
        manualTooltipDataTitle,
        manualTooltipDataValue
    } = VisualConstants.dom;
    const manualTooltipElements = dataElements.selectAll(
        `.${manualTooltipSelector}`
    );
    const titleExp = new RegExp(
        `${manualTooltipDataPrefix}${manualTooltipDataTitle}`,
        'g'
    );
    const valueExp = new RegExp(
        `${manualTooltipDataPrefix}${manualTooltipDataValue}`,
        'g'
    );
    manualTooltipElements.on('mouseover mousemove', (event) => {
        const dataset = event.currentTarget.dataset;
        const keys = Object.keys(dataset).map((key) =>
            key.replace(titleExp, '').replace(valueExp, '')
        );
        const uniqueKeys = [...new Set(keys)];
        const dataItems: VisualTooltipDataItem[] = uniqueKeys.map((key) => ({
            displayName:
                dataset[
                    `${manualTooltipDataPrefix}${manualTooltipDataTitle}${key}`
                ] || '',
            value:
                dataset[
                    `${manualTooltipDataPrefix}${manualTooltipDataValue}${key}`
                ] || ''
        }));
        if (dataItems.length > 0) {
            const options: TooltipShowOptions = {
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: true,
                dataItems,
                identities: []
            };
            tooltipService.show(options);
            recordTooltipEvent(
                'show',
                'manual',
                tooltipContext(dataItems as TooltipItem[])
            );
        }
    });
    manualTooltipElements.on('mouseout', () => {
        tooltipService.hide({ immediately: true, isTouchEvent: true });
        recordTooltipEvent('hide', 'manual', '');
    });
}

/**
 * For standard data elements, working with the data roles and correct
 * rules, we will apply the regular tooltip handling.
 *
 * @param dataElements      - The elements to analyse and process.
 * @param host              - Visual host services.
 * @param hasGranularity    - Whether we have granularity or not.
 */
function bindStandardTooltips(
    dataElements: Selection<any, IHtmlEntry, any, any>,
    host: IVisualHost,
    hasGranularity: boolean
) {
    const { tooltipService } = host;
    dataElements.on('mouseover mousemove', (event, d) => {
        select(event.currentTarget).classed(
            VisualConstants.dom.hoverClassSelector,
            true
        );
        if (hasGranularity || d.tooltips.length > 0) {
            const options: TooltipShowOptions = {
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: true,
                dataItems: d.tooltips,
                identities: [d.identity]
            };
            tooltipService.show(options);
            recordTooltipEvent(
                'show',
                'contextual',
                tooltipContext(d.tooltips as TooltipItem[])
            );
        }
    });
    dataElements.on('mouseout', (event) => {
        select(event.currentTarget).classed(
            VisualConstants.dom.hoverClassSelector,
            false
        );
        tooltipService.hide({ immediately: true, isTouchEvent: true });
        recordTooltipEvent('hide', 'contextual', '');
    });
}

/**
 * Creates the d3 elements and data binding for the specified view model data.
 *
 * @param container - The container to process.
 * @param data      - Array of view model data to bind.
 */
export function bindVisualDataToDom(
    container: Selection<any, any, any, any>,
    data: IHtmlEntry[],
    hasSelection: boolean
) {
    const { entryClassSelector, unselectedClassSelector } = VisualConstants.dom;
    return container
        .selectAll(`.${entryClassSelector}`)
        .data(data)
        .join((enter) =>
            enter
                .append('div')
                .classed(entryClassSelector, true)
                .classed(unselectedClassSelector, (d) =>
                    shouldDimPoint(hasSelection, d.selected)
                )
        );
}

/**
 * For the current selection state of the view model and the data point,
 * determine whether the point should be dimmed or not.
 *
 * @param hasSelection
 * @param isSelected
 */
export function shouldDimPoint(hasSelection: boolean, isSelected: boolean) {
    return hasSelection && !isSelected;
}

// JS property stashed on each entry node recording the content last rendered
// into it, so a reconcile can skip nodes whose content is unchanged.
const RENDERED_CONTENT_PROP = '__renderedContent';

/**
 * Stamp the current content onto each node so a later reconcile can detect
 * whether it changed. The rebuild path calls this after rendering so that a
 * subsequent reconcile has a baseline; reconcile uses it internally too.
 */
export function stampRenderedContent(
    selection: Selection<any, IHtmlEntry, any, any>
): void {
    selection.property(RENDERED_CONTENT_PROP, (d: IHtmlEntry) => d.content);
}

// Base widened from HTMLDivElement to HTMLElement: the legacy reconcile
// (reconcileVisualDataToDom) always builds a `<div>` row root, but the Unit 6
// templated reconcile derives the row root from the row template, so it can be
// any element (e.g. a `<tr>`). The `__renderedContent` content-diff stash is
// shared by both paths.
interface IRenderedEntryNode extends HTMLElement {
    __renderedContent?: string;
}

export interface ReconcileResult {
    merged: Selection<HTMLDivElement, IHtmlEntry, any, any>;
    toRender: Selection<HTMLDivElement, IHtmlEntry, any, any>;
}

/**
 * Identity-keyed d3 join for visual data entries. Unlike `bindVisualDataToDom`,
 * the join is keyed on each entry's stable selection identity (`identity.getKey()`)
 * so that retained entries keep their exact DOM node across updates — which
 * prevents inline iframes from reloading.
 *
 * Returns `{ merged, toRender }`:
 * - `merged`   — the full enter+update selection (for binding handlers).
 * - `toRender` — the subset that needs (re)rendering: newly entered nodes plus
 *                retained nodes whose `content` changed since last render.
 *                Unchanged nodes are in `merged` but NOT `toRender`.
 *
 * The caller renders `toRender` (via resolveHtmlGroupElement) and then calls
 * `stampRenderedContent(toRender)` to record the new baseline. Stamping after
 * render (rather than here) keeps the stash and the DOM in agreement at every
 * observable point: a node is only marked up-to-date once its content is
 * actually in the DOM, so a mid-render throw leaves changed nodes un-stamped
 * and they are simply re-rendered on the next reconcile.
 *
 * @param container     - The container to process.
 * @param data          - Array of view model data to bind.
 * @param hasSelection  - Whether a cross-filter selection is active.
 */
export function reconcileVisualDataToDom(
    container: Selection<any, any, any, any>,
    data: IHtmlEntry[],
    hasSelection: boolean
): ReconcileResult {
    const { entryClassSelector, unselectedClassSelector } = VisualConstants.dom;
    const joined = container
        .selectAll<HTMLDivElement, IHtmlEntry>(`.${entryClassSelector}`)
        .data(data, (d: IHtmlEntry) => (d.identity as ISelectionId).getKey());
    joined.exit().remove();
    const entered = joined
        .enter()
        .append('div')
        .classed(entryClassSelector, true);
    const merged = entered.merge(joined as any);
    merged.classed(unselectedClassSelector, (d) =>
        shouldDimPoint(hasSelection, d.selected)
    );
    merged.order();
    const changed = joined.filter(function (
        this: IRenderedEntryNode,
        d: IHtmlEntry
    ) {
        return this.__renderedContent !== d.content;
    });
    const toRender = entered.merge(changed);
    return { merged, toRender };
}

/**
 * Render-time options for the templated row renderer. `format` is also part of
 * the visual's render fingerprint (a format change forces a full rebuild), so
 * it is deliberately NOT part of `rowRenderKey` — only the row template and the
 * raw (pre-markdown) content participate in the per-row content diff.
 */
export interface TemplatedRenderOptions {
    format: RenderFormat;
    allowHyperlinks: boolean;
    hasSelection: boolean;
}

/**
 * Per-row content-diff key: row template + raw content (pre-markdown). Format
 * is in the render fingerprint, so a format change forces a rebuild and need
 * not enter this key. A change to either the row template (selector-driven
 * per-row CF) or the bound content invalidates the key and forces that row to
 * be rebuilt by the reconcile.
 */
export const rowRenderKey = (d: IHtmlEntry): string =>
    `${d.rowTemplate} ${d.content}`;

// A row template with no {{row}} token leaves substitute() with nothing to
// replace: it returns the template unchanged, so every row renders as an empty
// wrapper and the row content is silently dropped. Warn once per offending
// template so a multi-row visual doesn't flood the console on every update.
const warnedTokenlessRowTemplates = new Set<string>();
function warnIfRowTemplateHasNoToken(rowTemplate: string): void {
    const hasToken = ROW_TOKEN.test(rowTemplate);
    ROW_TOKEN.lastIndex = 0; // ROW_TOKEN is global; .test() advances lastIndex
    if (hasToken || warnedTokenlessRowTemplates.has(rowTemplate)) {
        return;
    }
    warnedTokenlessRowTemplates.add(rowTemplate);
    console.warn(
        'HTML Content: row template has no {{row}} token — row content is ' +
            'dropped and every row renders empty. Template: ' +
            JSON.stringify(rowTemplate)
    );
}

/**
 * Build the single row-grain root element for one entry from its row template.
 *
 * Markdown applies ONLY to the content, never to the template markup
 * (Decision 4): the content is markdown-converted first (when `format` is
 * `markdown`), the converted HTML is substituted in for the `{{row}}` token,
 * and the combined row string is then parsed IN the container's content model
 * and sanitized (so a `<tr>` row template is not foster-parented out of a
 * `<tbody>` container — the parse-in-context path from U4). `parseAndSanitize-
 * InContext` is always called with format `'html'` here because the content was
 * already markdown-converted above and the template itself is always HTML.
 *
 * Single-root enforcement (Decision 5): the row-grain node MUST be exactly one
 * element so it is a single keyed node the reconcile can retain/replace/remove.
 * If the parsed+sanitized fragment yields exactly one element, that element is
 * the root. Otherwise (0 elements — e.g. the row template's root was dropped by
 * the sanitizer — or multiple roots) everything is wrapped in the default entry
 * `<div>` so the row stays a single keyed node.
 *
 * The `.htmlViewerEntry` class is applied to the root (so the default template
 * `<div><div>{{row}}</div></div>` yields a byte-identical
 * `<div class="htmlViewerEntry"><div>content</div></div>` to today's output),
 * the dim class is toggled per selection state, and the content-diff key
 * (`rowRenderKey`) is stamped so the reconcile baseline is set on every freshly
 * built node.
 *
 * @param container - The element rows are inserted into (its content model is
 *                    used as the parse context).
 * @param d         - The entry to render.
 * @param opts      - Render-time options (format, allowHyperlinks, hasSelection).
 */
function buildRowRoot(
    container: Element,
    d: IHtmlEntry,
    opts: TemplatedRenderOptions
): HTMLElement {
    // Markdown applies ONLY to the content, never to the template markup
    // (Decision 4).
    const contentHtml =
        opts.format === 'markdown'
            ? marked.parse(d.content).toString()
            : d.content;
    warnIfRowTemplateHasNoToken(d.rowTemplate);
    const rowHtml = substitute(d.rowTemplate, ROW_TOKEN, contentHtml);
    // Parse the combined row string in the container's content model + sanitize
    // (U4). Pass format 'html' here — content was already markdown-converted
    // above; the template is always HTML.
    const frag = parseAndSanitizeInContext(rowHtml, 'html', container, {
        allowHyperlinks: opts.allowHyperlinks
    });
    // Single-root enforcement (Decision 5): the row-grain node must be exactly
    // one element.
    const els = Array.from(frag.childNodes).filter(
        (n) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement[];
    let root: HTMLElement;
    if (els.length === 1) {
        root = els[0];
    } else {
        // 0 elements (e.g. row template root was dropped by sanitize) or
        // multiple roots → wrap everything in the default entry div so the row
        // stays a single keyed node.
        root = document.createElement('div');
        root.appendChild(frag);
    }
    const { entryClassSelector, unselectedClassSelector } = VisualConstants.dom;
    root.classList.add(entryClassSelector);
    root.classList.toggle(
        unselectedClassSelector,
        shouldDimPoint(opts.hasSelection, d.selected)
    );
    (root as IRenderedEntryNode).__renderedContent = rowRenderKey(d);
    return root;
}

/**
 * Identity key for the templated keyed join — the entry's stable selection
 * identity. Retained keys keep their exact DOM node across updates (the heart
 * of iframe survival).
 */
const templatedRowKey = (d: IHtmlEntry): string =>
    (d.identity as ISelectionId).getKey();

/**
 * Direct-child entry-node selector for the templated join. `:scope >` restricts
 * the join to the container's OWN row roots so that any nested element inside a
 * custom row template that happens to carry the `.htmlViewerEntry` class is not
 * matched as a row. jsdom (the test environment) supports `:scope >`; in a real
 * browser it is universally supported.
 */
const templatedRowSelector = `:scope > .${VisualConstants.dom.entryClassSelector}`;

/**
 * Insert entered row roots at the correct position. When the body template has
 * a content slot (`tc.anchor` non-null) the rows must be inserted BEFORE the
 * anchor so any static siblings authored around the slot keep their position;
 * d3's `insert(creatorFn, beforeFn)` inserts the created node before the node
 * `beforeFn` returns. When there is no anchor (default body) the rows simply
 * append (today's behavior).
 */
const insertEnteredRows = (
    enter: Selection<any, IHtmlEntry, any, any>,
    tc: TemplateContainer,
    opts: TemplatedRenderOptions
): Selection<HTMLElement, IHtmlEntry, any, any> => {
    const create = (d: IHtmlEntry) => buildRowRoot(tc.container, d, opts);
    // d3's insert(creator, before) inserts the created node before the node the
    // `before` function returns; at runtime it accepts any Node (it calls
    // parent.insertBefore), but the @types/d3-selection `before` signature
    // requires a BaseType (Element-like), so the Comment anchor is passed
    // through `any`. When there is no anchor (default body) rows append.
    return tc.anchor
        ? (enter.insert(create as any, (() => tc.anchor) as any) as Selection<
              HTMLElement,
              IHtmlEntry,
              any,
              any
          >)
        : (enter.append(create as any) as Selection<
              HTMLElement,
              IHtmlEntry,
              any,
              any
          >);
};

/**
 * Full (re)build of all rows into `tc.container` from their templates. Unit 7
 * calls `resolveTemplateContainer` (which clears the root and re-parses the
 * body) BEFORE this, so on a rebuild the container has no pre-existing row
 * roots — every entry therefore enters. Implemented via the identity-keyed join
 * so the function is uniform with the reconcile path and so a caller that does
 * NOT pre-clear still produces a correct keyed result.
 *
 * `buildRowRoot` stamps `__renderedContent` on every node it builds, so the
 * reconcile baseline is set for the next update. Returns the merged selection
 * (for binding handlers / hover / hyperlink handling downstream).
 *
 * @param tc    - The resolved template container (+ optional slot anchor).
 * @param data  - Array of view model entries to render.
 * @param opts  - Render-time options (format, allowHyperlinks, hasSelection).
 */
export function renderTemplatedEntries(
    tc: TemplateContainer,
    data: IHtmlEntry[],
    opts: TemplatedRenderOptions
): Selection<HTMLElement, IHtmlEntry, any, any> {
    const sel = select(tc.container)
        .selectAll<HTMLElement, IHtmlEntry>(templatedRowSelector)
        .data(data, templatedRowKey);
    sel.exit().remove();
    const entered = insertEnteredRows(sel.enter(), tc, opts);
    const merged = entered.merge(sel);
    // NOTE (known limitation, inherited from reconcileVisualDataToDom): order() moves
    // displaced nodes via insertBefore, which detaches+reattaches them. A reorder of
    // rows therefore reloads any inline <iframe> in a *moved* row. Updates that do NOT
    // change row order preserve iframes (the primary reconcile use case). Reordering
    // without reload would require not moving iframe-bearing nodes — a separate change
    // that also affects the legacy reconcile path.
    merged.order();
    return merged;
}

/**
 * Identity-keyed reconcile of templated rows. Generalizes the proven
 * `reconcileVisualDataToDom` shape to template-derived row roots:
 *   - retained-key rows whose `rowRenderKey` is unchanged keep their EXACT DOM
 *     node (so an inline iframe inside the row is not reloaded);
 *   - retained-key rows whose `rowRenderKey` changed (content edited, or the
 *     per-row template changed via selector-driven CF) are rebuilt fresh and
 *     the live node is REPLACED in place;
 *   - entered keys are built fresh and inserted (before the slot anchor when
 *     present);
 *   - exited keys are removed;
 *   - final order matches data order (before the anchor).
 *
 * Returns `{ merged, toRender }`:
 *   - `merged`   — every current row root, data-bound in data order.
 *   - `toRender` — only the freshly built nodes (entered + changed). These are
 *     already stamped with the new `rowRenderKey` by `buildRowRoot`; the caller
 *     renders/handles only this subset and unchanged rows are left untouched.
 *
 * @param tc    - The resolved template container (+ optional slot anchor).
 * @param data  - Array of view model entries to render.
 * @param opts  - Render-time options (format, allowHyperlinks, hasSelection).
 */
export function reconcileTemplatedEntries(
    tc: TemplateContainer,
    data: IHtmlEntry[],
    opts: TemplatedRenderOptions
): {
    merged: Selection<HTMLElement, IHtmlEntry, any, any>;
    toRender: Selection<HTMLElement, IHtmlEntry, any, any>;
} {
    const sel = select(tc.container)
        .selectAll<HTMLElement, IHtmlEntry>(templatedRowSelector)
        .data(data, templatedRowKey);
    sel.exit().remove();

    // New keys: build fresh row roots and insert (before the anchor if present).
    const entered = insertEnteredRows(sel.enter(), tc, opts);

    // The set of freshly built DOM nodes (entered + replaced). Used at the end
    // to derive `toRender` as a properly data-bound subset of `merged`,
    // avoiding any reliance on the now-stale `sel`/`entered` node references
    // (replaceWith detaches the old nodes the update selection still points at).
    const freshNodes = new Set<Element>(entered.nodes());

    // Retained keys whose content/template changed: rebuild fresh and replace
    // the live node in place. Unchanged retained rows keep their exact node
    // (iframe survives). `sel` here is the UPDATE selection (retained keys).
    // The replacement's `__data__` is set on the fresh node so the re-select +
    // re-bind below can compute its key from `node.__data__` (a manually built
    // node otherwise has no datum, and d3's keyed `data()` reads the datum off
    // every existing node when matching keys).
    sel.each(function (this: IRenderedEntryNode, d: IHtmlEntry) {
        if (this.__renderedContent === rowRenderKey(d)) return;
        const fresh = buildRowRoot(tc.container, d, opts);
        (fresh as any).__data__ = d;
        this.replaceWith(fresh);
        freshNodes.add(fresh);
    });

    // Re-select the container's current row roots and re-bind by key to obtain
    // a clean merged selection that includes the freshly-replaced nodes (whose
    // references the original update selection no longer holds), then order to
    // data order. All row roots are already before the anchor, so ordering them
    // among themselves keeps them before it. Every current row root now carries
    // a `__data__` (retained: from the prior bind; entered: set by d3 on enter;
    // replaced: set just above), so the keyed re-bind is safe.
    const merged = select(tc.container)
        .selectAll<HTMLElement, IHtmlEntry>(templatedRowSelector)
        .data(data, templatedRowKey);
    // NOTE (known limitation, inherited from reconcileVisualDataToDom): order() moves
    // displaced nodes via insertBefore, which detaches+reattaches them. A reorder of
    // rows therefore reloads any inline <iframe> in a *moved* row. Updates that do NOT
    // change row order preserve iframes (the primary reconcile use case). Reordering
    // without reload would require not moving iframe-bearing nodes — a separate change
    // that also affects the legacy reconcile path.
    merged.order();
    // Refresh the dim class on ALL rows every reconcile. rowRenderKey deliberately
    // excludes `selected`, so a selection-only change leaves rows RETAINED with a
    // stale dim class. Applying classed() to the full merged selection here mirrors
    // what reconcileVisualDataToDom does and corrects the class without moving any node.
    merged.classed(VisualConstants.dom.unselectedClassSelector, (d) =>
        shouldDimPoint(opts.hasSelection, d.selected)
    );

    // toRender = entered + changed (the freshly built nodes). buildRowRoot
    // already stamped each one with the new rowRenderKey.
    const toRender = merged.filter(function (this: Element) {
        return freshNodes.has(this);
    });
    return { merged, toRender };
}

/**
 * For the supplied stylesheet container, settings and body container (could be standard content,
 * or the "no data" message container), produce a dev-tools-style HTML string and run it through
 * `pretty` for readability.
 *
 * Contract: attribute values and text content are emitted with literal characters — no
 * HTML-spec entity encoding (`&`, `<`, `>`, `"`, `'` survive verbatim). See {@link domSerialize}
 * for the full serialization contract. The output is intentionally not round-trippable as
 * strict HTML; it mirrors what a browser dev tools Elements panel would show.
 *
 * Exported for unit testing. Internal call site is `resolveForRawHtml` above.
 *
 * @internal Exported for unit testing — not part of the visual's public API.
 */
export const getRawHtml = (
    styleSheetContainer: Selection<any, any, any, any>,
    container: Selection<any, any, any, any>,
    stylesheet: StylesheetSettings
) => {
    // d3 Selection.node() returns T | null. Guard both reads so the
    // walker never receives null. If the content container hasn't
    // been built yet there's nothing to display.
    const ssNode = styleSheetContainer.node();
    const contentNode = container.node();
    if (!contentNode) {
        return '';
    }
    const includeStylesheet =
        shouldUseStylesheet(stylesheet) &&
        !!stylesheet.stylesheetCardMain.stylesheet.value &&
        ssNode !== null;
    const ssFragment = includeStylesheet ? domSerialize(ssNode as Node) : '';
    // Conditional separator: when no stylesheet is included, ssFragment is
    // '' and an unconditional space would leave a stray leading space at
    // the start of `raw`. pretty() trims it, but the catch fallback returns
    // raw verbatim — surfacing the artefact in the debug textarea.
    const raw = `${ssFragment}${ssFragment ? ' ' : ''}${domSerialize(contentNode)}`;
    // pretty is kept for block-level indentation; verified that it
    // preserves literal `&` / `<` in attribute values rather than
    // re-encoding them. The try/catch is defense-in-depth — if
    // js-beautify ever throws on dev-tools-style HTML (which is not
    // strict valid HTML when attribute values contain literal `&`),
    // we fall back to the unindented walker output so the debug
    // toggle stays functional.
    try {
        return pretty(raw);
    } catch (e) {
        console.warn(
            'getRawHtml: pretty() threw, returning unindented walker output:',
            e
        );
        return raw;
    }
};

/**
 * Ensure that inline CSS is set correctly, based on whether user has assigned their own stylesheet,
 * or fall back to the standard content formatting properties if not.
 */
const resolveBodyStyle = (useSS: boolean, prop: string) =>
    (!useSS && prop) || null;

/**
 * Set the `user-select` CSS property based on user preference.
 */
const resolveUserSelect = (
    enabled: boolean,
    bodyContainer: Selection<any, any, any, any>
) => {
    const value = (enabled && 'text') || 'none';
    bodyContainer
        .style('user-select', value)
        .style('-moz-user-select', value)
        .style('-webkit-user-select', value)
        .style('-ms-user-select', value);
};
