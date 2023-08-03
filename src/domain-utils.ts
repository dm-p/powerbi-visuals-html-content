// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

// External dependencies
import { select, Selection } from 'd3-selection';
import * as OverlayScrollbars from 'overlayscrollbars';
import * as config from '../config/visual.json';
import * as sanitizeHtml from 'sanitize-html';
const pretty = require('pretty');

// Internal dependencies
import { VisualConstants } from './visual-constants';
import { StylesheetSettings, VisualSettings } from './visual-settings';
import { IHtmlEntry } from './view-model';

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
    const {
        allowedSchemes,
        allowedSchemesByTag,
        allowedTags
    } = VisualConstants;
    const dom = config.sanitize
        ? sanitizeHtml(html, {
              allowedAttributes: { '*': ['*'] },
              allowedTags,
              allowedSchemes,
              allowedSchemesByTag,
              transformTags: {
                  '*': (tagName, attribs) => {
                      return {
                          tagName,
                          attribs: getStrippedAttributes(attribs)
                      };
                  }
              }
          })
        : html;
    return parse(dom);
};

/**
 * It still might be possible to encode 'javascript' into an attribute, so
 * we'll strip out any attributes that contain this, or any other potential
 * scripting patterns.
 */
const getStrippedAttributes = (
    attribs: sanitizeHtml.Attributes
): sanitizeHtml.Attributes => {
    for (const [key, value] of Object.entries(attribs)) {
        if (
            typeof value === 'string' &&
            VisualConstants.scriptingPatterns.some(pattern =>
                value.includes(pattern)
            )
        ) {
            delete attribs[key];
        }
    }
    return attribs;
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
    const useSS = shouldUseStylesheet(settings.stylesheet);
    const bodyProps = settings.contentFormatting;
    const {
        crossFilter: { enabled, useTransparency, transparencyPercent }
    } = settings;
    const crossFilterStyles =
        enabled && useTransparency
            ? `.${VisualConstants.dom.entryClassSelector}.${
                  VisualConstants.dom.unselectedClassSelector
              } { opacity: ${1 - transparencyPercent / 100}; }`
            : '';
    const customStyles = `${(useSS && settings.stylesheet.stylesheet) || ''}`;
    styleSheetContainer.text(`${crossFilterStyles} ${customStyles}`);
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
    dataElements: Selection<any, IHtmlEntry, any, any>
) {
    // Remove any applied elements
    dataElements.selectAll('*').remove();
    // Add the correct element
    dataElements.append('div').append(function(d) {
        return this.appendChild(getParsedHtmlAsDom(d.content));
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
    manualTooltipElements.on('mouseover mousemove', event => {
        const dataset = event.currentTarget.dataset;
        const keys = Object.keys(dataset).map(key =>
            key.replace(titleExp, '').replace(valueExp, '')
        );
        const uniqueKeys = [...new Set(keys)];
        const dataItems: VisualTooltipDataItem[] = uniqueKeys.map(key => ({
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
    dataElements.on('mouseout', event => {
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
        .join(enter =>
            enter
                .append('div')
                .classed(entryClassSelector, true)
                .classed(unselectedClassSelector, d =>
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
