// Power BI API Dependencies
import powerbi from 'powerbi-visuals-api';
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import TooltipShowOptions = powerbi.extensibility.TooltipShowOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

// External dependencies
import { select, Selection } from 'd3-selection';

// Internal dependencies
import { VisualConstants } from '../visual-constants';
import { IHtmlEntry } from '../view-model';
import { recordTooltipEvent } from '../diagnostics/event-recorder';
import { tooltipContext, TooltipItem } from '../diagnostics/host-events';
import { resolveInteractivity } from './policy';

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
        if (!resolveInteractivity(event.target as Element | null, 'tooltip')) {
            tooltipService.hide({ immediately: true, isTouchEvent: true });
            return;
        }
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
        if (!resolveInteractivity(event.target as Element | null, 'tooltip')) {
            tooltipService.hide({ immediately: true, isTouchEvent: true });
            return;
        }
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
