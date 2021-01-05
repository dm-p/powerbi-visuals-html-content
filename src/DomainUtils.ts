// Power BI API Dependencies
    import powerbi from 'powerbi-visuals-api';
    import IVisualHost = powerbi.extensibility.visual.IVisualHost;
    import ISelectionManager = powerbi.extensibility.ISelectionManager;

// External dependencies
    import * as d3Select from 'd3-selection';
    import * as OverlayScrollbars from 'overlayscrollbars';

// Internal dependencies
    import { VisualConstants } from './VisualConstants';

    export namespace DomainUtils {

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
                container: d3.Selection<any, any, any, any>,
                allowDelegation?: boolean
            ) {
                container
                    .selectAll('a')
                        .on('click', (d, i, e) => {
                            d3Select.event.preventDefault();
                            allowDelegation && host.launchUrl(
                                    d3Select.select(e[i])
                                        .attr('href')
                                );
                        });
            }

        /**
         * As we want to display different types of element for each entry/grouping, we will clear down the 
         * existing children and rebuild with our desired element for handling raw vs. rendered HTML.
         * 
         * @param dataElements  - The elements to analyse and process.
         * @param useRaw        - Whether we should be displaying raw HTML or not    
         */
            export function resolveHtmlGroupElement(
                dataElements: d3.Selection<any, any, any, any>,
                useRaw?: boolean
            ) {
                // Remove any applied elements
                    dataElements.selectAll('*')
                        .remove();
                // Add the correct element
                    useRaw &&
                    dataElements
                        .append('code')
                            .text((d) => d) ||
                    dataElements
                        .append('div')
                            .html((d) => d);
            }

        /**
         * Apply styling of supplied properties from the visual to the supplied element.
         * 
         * @param element   - Element to apply styling to.
         * @param props     - Supported styling properties.
         */
            export function resolveBodyStyling(
                element: d3.Selection<any, any, any, any>,
                props: IBodyElementStylingProps
            ) {
                element
                    .style('font-family', props.fontFamily)
                    .style('font-size', `${props.fontSize}pt`)
                    .style('color', props.colour)
                    .style('text-align', props.textAlign);
            }

        /**
         * Use OverlayScrollbars to apply nicer scrolling to the supplied element.
         * 
         * @param element   - HTML element to apply scrolling to.
         */
            export function resolveScrollableContent(
                element: HTMLElement
            ) {
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
                container: d3.Selection<any, any, any, any>,
                selectionManager: ISelectionManager
            ) {
                container.on('contextmenu', () => {
                    const mouseEvent: MouseEvent = <MouseEvent>d3Select.event;
                    selectionManager.showContextMenu({}, {
                        x: mouseEvent.x,
                        y: mouseEvent.y
                    });
                    mouseEvent.preventDefault();
                })

            }

        /**
         * Creates the d3 elements and data binding for the specified view model data.
         * 
         * @param container - The container to process.
         * @param data      - Array of view model data to bind.
         */
            export function bindVisualDataToDom(
                container: d3.Selection<any, any, any, any>,
                data: string[]
            ) {
                return container
                    .selectAll(`.${VisualConstants.dom.entryClassSelector}`)
                        .data(data)
                        .join(
                                (enter) => enter
                                            .append('div')
                                                .classed(VisualConstants.dom.entryClassSelector, true)
                            );
            }

        // Used for styling the main visual body, based on properties
            export interface IBodyElementStylingProps {
                fontFamily?: string;
                fontSize?: number;
                colour?: string;
                textAlign?: string;
            }

    }

    export default DomainUtils;