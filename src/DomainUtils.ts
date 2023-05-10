// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

// External dependencies
import { select, Selection } from 'd3-selection';
import * as OverlayScrollbars from 'overlayscrollbars';
import * as config from '../config/visual.json';
import * as sanitizeHtml from 'sanitize-html';
const pretty = require('pretty');

// Internal dependencies
import { VisualConstants } from './VisualConstants';
import { StylesheetSettings, VisualSettings } from './VisualSettings';

/**
 * Parse the supplied HTML string and then return as a DOM fragment that we can
 * use in the visual for our data. If we're specifying in the configuration that
 * we should sanitie, do this also, so that we're not injecting any malicious
 * code into the DOM and keep to certification requirements.
 */
export const getParsedHtmlAsDom = (html: string) => {
    const parse = Range.prototype.createContextualFragment.bind(
        document.createRange()
    );
    const dom = config.sanitize
        ? sanitizeHtml(html, {
              allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
              allowedSchemes: ['data']
          })
        : html;
    return parse(dom);
};

/**
 * Use to determine if we should include stylesheet logic, based on whether it has been supplied or not.
 */
export const shouldUseStylesheet = (stylesheet: StylesheetSettings) =>
    stylesheet.stylesheet ? true : false;

/**
 * Resolve how styling should be applied, based on supplied properties. Basically, if user has supplied
 * their own stylesheet via properties, we will defer to this rather than the standard content formatting
 * ones.
 */
export const resolveStyling = (
    styleSheetContainer: Selection<any, any, any, any>,
    bodyContainer: Selection<any, any, any, any>,
    settings: VisualSettings
) => {
    const useSS = shouldUseStylesheet(settings.stylesheet),
        bodyProps = settings.contentFormatting;
    styleSheetContainer.text((useSS && settings.stylesheet.stylesheet) || '');
    resolveUserSelect(bodyProps.userSelect, bodyContainer);
    bodyContainer
        .style('font-family', resolveBodyStyle(useSS, bodyProps.fontFamily))
        .style('font-size', resolveBodyStyle(useSS, `${bodyProps.fontSize}pt`))
        .style('color', resolveBodyStyle(useSS, bodyProps.fontColour))
        .style('text-align', resolveBodyStyle(useSS, bodyProps.align));
};

/**
 * For the supplied stylesheet container, settings and body container (could be standard content, or the
 * "no data" message container), ensure that the content is resolved, and the correct element (readonly
 * textarea) is added to the DOM, as well as caretaking any existing elements.
 */
export const resolveForRawHtml = (
    styleSheetContainer: Selection<any, any, any, any>,
    contentContainer: Selection<any, any, any, any>,
    settings: VisualSettings
) => {
    if (settings.contentFormatting.showRawHtml) {
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
    container.selectAll('a').on('click', event => {
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
    dataElements: Selection<any, any, any, any>
) {
    // Remove any applied elements
    dataElements.selectAll('*').remove();
    // Add the correct element
    dataElements.append('div').append(function(d) {
        return this.appendChild(getParsedHtmlAsDom(d));
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
 * Add Power BI context menu suppor to the selected container
 *
 * @param container         - The container to process.
 * @param selectionManager  - Power BI host services selection manager instance.
 */
export function resolveContextMenu(
    container: Selection<any, any, any, any>,
    selectionManager: ISelectionManager
) {
    container.on('contextmenu', event => {
        selectionManager.showContextMenu(
            {},
            {
                x: event.x,
                y: event.y
            }
        );
        event.preventDefault();
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
    data: string[]
) {
    return container
        .selectAll(`.${VisualConstants.dom.entryClassSelector}`)
        .data(data)
        .join(enter =>
            enter
                .append('div')
                .classed(VisualConstants.dom.entryClassSelector, true)
        );
}

/**
 * For the supplied stylesheet container, settings and body container (could be standard content, or the
 * "no data" message container), get raw HTML and pretty print it.
 */
const getRawHtml = (
    styleSheetContainer: Selection<any, any, any, any>,
    container: Selection<any, any, any, any>,
    stylesheet: StylesheetSettings
) =>
    pretty(
        `${((shouldUseStylesheet(stylesheet) && stylesheet.stylesheet) || '') &&
            styleSheetContainer.node().outerHTML} ${container.node().outerHTML}`
    );

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
