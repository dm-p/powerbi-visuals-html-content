// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

// External dependencies
import { select, Selection } from 'd3-selection';
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
import { getParsedHtmlAsDom, getSanitizedCss } from './sanitize-pipeline';

// Re-export sanitize pipeline entry points so existing callers that import
// from './domain-utils' continue to work after the Task 7 extraction.
export { getParsedHtmlAsDom } from './sanitize-pipeline';

// The sanitization functions previously defined inline here (getSanitizedContent,
// getStrippedAttributes, getSanitizedCss, getSanitizedDataUri, and the original
// getParsedHtmlAsDom) have been moved to ./sanitize-pipeline so they can be
// imported by the Playwright integration harness without pulling in d3,
// overlayscrollbars, or powerbi-visuals-api at test load time.
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
 * "no data" message container), ensure that the content is resolved, and the correct element (readonly
 * textarea) is added to the DOM, as well as caretaking any existing elements.
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
        contentContainer
            .append('textarea')
            .attr('id', VisualConstants.dom.rawOutputIdSelector)
            .attr('readonly', true)
            .text(output);
    }
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
        event.preventDefault();
        if (allowDelegation) {
            const url = select(event.currentTarget).attr('href') || '';
            host.launchUrl(url);
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
    format: RenderFormat
) {
    // Remove any applied elements
    dataElements.selectAll('*').remove();
    // Add the correct element.
    dataElements.append('div').each(function (d) {
        this.appendChild(getParsedHtmlAsDom(d.content, format));
    });
}

/**
 * Use OverlayScrollbars to apply nicer scrolling to the supplied element.
 *
 * @param element   - HTML element to apply scrolling to.
 */
export function resolveScrollableContent(element: HTMLElement) {
    OverlayScrollbars(element, {
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
        }
    });
    manualTooltipElements.on('mouseout', () =>
        tooltipService.hide({ immediately: true, isTouchEvent: true })
    );
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
        }
    });
    dataElements.on('mouseout', (event) => {
        select(event.currentTarget).classed(
            VisualConstants.dom.hoverClassSelector,
            false
        );
        tooltipService.hide({ immediately: true, isTouchEvent: true });
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
