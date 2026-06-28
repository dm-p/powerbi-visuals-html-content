// Power BI API Dependencies
import './../style/visual.less';
import 'overlayscrollbars/css/OverlayScrollbars.css';
import powerbi from 'powerbi-visuals-api';
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import {
    interactivitySelectionService,
    interactivityBaseService
} from 'powerbi-visuals-utils-interactivityutils';
import IInteractivityService = interactivityBaseService.IInteractivityService;
import SelectableDataPoint = interactivitySelectionService.SelectableDataPoint;
import { FormattingSettingsService } from 'powerbi-visuals-utils-formattingmodel';

// External dependencies
import OverlayScrollbars from 'overlayscrollbars';
import { select, Selection } from 'd3-selection';

// Internal Dependencies
import { VisualFormattingSettingsModel } from './visual-settings';
import { VisualConstants } from './visual-constants';
import { ViewModelHandler, IHtmlEntry, IViewModel } from './view-model';
import {
    getParsedHtmlAsDom,
    resolveForRawHtml,
    resolveScrollableContent,
    resolveStyling,
    resolveTemplateContainer,
    renderTemplatedEntries,
    reconcileTemplatedEntries,
    TemplateContainer,
    TemplatedRenderOptions,
    getDiagnosticsRawHtml
} from './domain-utils';
import { LandingPageHandler } from './landing';
import {
    BehaviorManager,
    IHtmlBehaviorOptions,
    resolveHover,
    resolveHyperlinkHandling
} from './interactivity';
import { RenderFormat } from './types';
import { sanitizerEnabled } from './sanitize';
import { RenderOrchestrator, RenderSteps } from './render-orchestrator';
import './diagnostics/diagnostics-dialog'; // registration side-effect — must be imported
import { beginCapture, endCapture } from './diagnostics/diagnostics-sink';
import {
    install as installConsoleCapture,
    snapshot as consoleSnapshot,
    clear as clearConsoleBuffer
} from './diagnostics/console-capture';
import {
    setArmed as setEventsArmed,
    snapshot as eventsSnapshot,
    clear as clearEventsBuffer,
    recordEvent
} from './diagnostics/event-recorder';
import { describeUpdateType } from './diagnostics/host-events';
import {
    buildSnapshot,
    shouldShowDiagnosticsIcon,
    createDiagnosticsIcon,
    setIconVisibility,
    isDiagnosticsHotkey
} from './diagnostics/diagnostics-snapshot';
import { SanitizerCapture, DiagnosticsLabels } from './diagnostics/types';

export class Visual implements IVisual {
    // The root element for the entire visual
    private container: Selection<HTMLDivElement, any, any, any>;
    // Used for displaying landing page
    private landingContainer: Selection<HTMLDivElement, any, any, any>;
    // Used for handling issues in the visual
    private statusContainer: Selection<HTMLDivElement, any, any, any>;
    // Used for HTML content from data model
    private contentContainer: Selection<HTMLDivElement, any, any, any>;
    // Visual host services
    private host: IVisualHost;
    // Parsed visual settings
    private formattingSettings: VisualFormattingSettingsModel;
    // Formatting settings service
    private formattingSettingsService: FormattingSettingsService;
    // Handle rendering events
    private events: IVisualEventService;
    // Handle localisation of visual text
    private localisationManager: ILocalizationManager;
    // Visual view model
    private viewModelHandler: ViewModelHandler;
    // Handles landing page
    private landingPageHandler: LandingPageHandler;
    // Manages custom styling from the user
    private styleSheetContainer: Selection<HTMLStyleElement, any, any, any>;
    // Interactivity for data points
    private interactivity: IInteractivityService<SelectableDataPoint>;
    // Behavior of data points
    private behavior: BehaviorManager<SelectableDataPoint>;
    // Flag whether the user clicked into the visual or not (for focus management)
    private bodyFocusedWithClick = false;
    // Drives rendering decisions (rebuild vs reconcile vs viewport-only)
    private orchestrator: RenderOrchestrator;
    // Cached OverlayScrollbars instance (reused across updates to preserve scroll position)
    private scrollbars: OverlayScrollbars | undefined;
    // The rendered data element selection, carried from rebuild/reconcile to bindInteractivity.
    // Assigned in rebuild/reconcile before bindInteractivity is ever called; the non-null
    // assertion (!) tells the compiler the field is set before use. Typed as HTMLElement
    // (not HTMLDivElement) because a templated row root can be any tag (e.g. <tr>).
    private dataElements!: Selection<HTMLElement, IHtmlEntry, any, any>;
    // Cached template join container (the body-resolved render target + content
    // slot anchor). Established on rebuild and reused on reconcile; invalidated
    // on kind change / error so the next populated render re-resolves it.
    private templateContainer: TemplateContainer | undefined;
    // Diagnostics overlay icon (top-right). Created hidden in the constructor;
    // its visibility is gated each update by the toggle + host modal support.
    private diagnosticsIcon!: HTMLButtonElement;
    // Last armed sanitizer capture, surfaced when the dialog is opened.
    private lastSanitizerCapture: SanitizerCapture = {
        entries: [],
        overflow: 0
    };
    // Whether diagnostics is active (toggle + host support + edit mode), kept in
    // sync each update so the Ctrl/Cmd+D hotkey can honour the same gate.
    private diagActive = false;
    // Remembered diagnostics tab for this visual instance (resets per
    // constructor). Lets the dialog reopen on the last-viewed tab.
    private lastDiagnosticsTab = 'raw';
    // Remembered Console/Events filter picks for this session, so the radio
    // filters are sticky across dialog open/close like the active tab. 'all'
    // shows everything.
    private lastConsoleFilter = 'all';
    private lastEventsFilter = 'all';
    // Detaches the document-level Ctrl/Cmd+D keydown listener on destroy(), so a
    // torn-down instance can't react to the hotkey (the handler captures `this`).
    private removeHotkeyListener?: () => void;
    // Re-entrancy guard: true while a modal dialog open is in flight, so a
    // double Ctrl/Cmd+D (or icon click mid-open) can't fire two openModalDialog
    // calls with the same snapshot.
    private diagOpening = false;

    // Runs when the visual is initialised
    constructor(options: VisualConstructorOptions) {
        this.container = select(options.element)
            .append('div')
            .attr('id', VisualConstants.dom.viewerIdSelector);
        this.host = options.host;
        this.viewModelHandler = new ViewModelHandler();
        this.localisationManager = this.host.createLocalizationManager();
        this.interactivity =
            interactivitySelectionService.createInteractivitySelectionService(
                this.host
            );
        this.behavior = new BehaviorManager();
        this.styleSheetContainer = select('head')
            .append('style')
            .attr('id', VisualConstants.dom.stylesheetIdSelector)
            .attr('name', VisualConstants.dom.stylesheetIdSelector)
            .attr('type', 'text/css');
        this.landingContainer = this.container
            .append('div')
            .attr('id', VisualConstants.dom.landingIdSelector);
        this.statusContainer = this.container
            .append('div')
            .attr('id', VisualConstants.dom.statusIdSelector);
        this.contentContainer = this.container
            .append('div')
            .attr('tabindex', 0)
            .attr('id', VisualConstants.dom.contentIdSelector);
        this.formattingSettingsService = new FormattingSettingsService(
            this.localisationManager
        );
        this.landingPageHandler = new LandingPageHandler(
            this.landingContainer,
            this.localisationManager
        );
        this.diagnosticsIcon = createDiagnosticsIcon(
            () => this.openDiagnostics(),
            this.localisationManager.getDisplayName('Diagnostics_IconTitle'),
            this.localisationManager.getDisplayName('Diagnostics_IconAriaLabel')
        );
        setIconVisibility(this.diagnosticsIcon, false);
        (this.container.node() as HTMLElement).appendChild(
            this.diagnosticsIcon
        );
        this.bindFocusEvents();
        this.bindDiagnosticsHotkey();
        this.events = this.host.eventService;
        this.viewModelHandler.reset();
        this.orchestrator = new RenderOrchestrator(this.buildRenderSteps());
    }

    /**
     * Returns properties pane formatting model content hierarchies, properties and latest formatting values, Then populate properties pane.
     * This method is called once every time we open properties pane or when the user edit any format property.
     */
    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(
            this.formattingSettings
        );
    }

    /**
     * Runs when data roles added or something changes
     */
    public update(options: VisualUpdateOptions) {
        const { viewModel } = this.viewModelHandler;
        this.formattingSettings =
            this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel,
                options.dataViews?.[0]
            );

        // Diagnostics is active only when the toggle is on, the host supports
        // modal dialogs, AND the report is being edited (ViewMode.Edit = 1 /
        // InFocusEdit = 2). View mode never shows the icon or records — keeping
        // diagnostics out of the consumer experience. `diagActive` gates the
        // icon, the console install, and the capture brackets alike.
        const diagActive = shouldShowDiagnosticsIcon(
            this.formattingSettings.contentFormatting
                .contentFormattingCardBehavior.enableDiagnostics.value,
            this.host.hostCapabilities?.allowModalDialog,
            options.viewMode === 1 || options.viewMode === 2
        );
        this.diagActive = diagActive;
        setEventsArmed(diagActive);
        if (diagActive) {
            installConsoleCapture();
            recordEvent(
                'update',
                `type=${describeUpdateType(options.type)}, viewMode=${options.viewMode}`,
                `rows=${options.dataViews?.[0]?.table?.rows?.length ?? options.dataViews?.[0]?.categorical?.categories?.[0]?.values?.length ?? 0}`
            );
        }
        setIconVisibility(this.diagnosticsIcon, diagActive);

        try {
            this.events.renderingStarted(options);
            if (
                powerbi.VisualUpdateType.Data ===
                (options.type & powerbi.VisualUpdateType.Data)
            ) {
                this.updateStatus(
                    this.localisationManager.getDisplayName(
                        'Status_Mapping_DataView'
                    )
                );
                this.viewModelHandler.validateDataView(options.dataViews);
                viewModel.isValid &&
                    this.viewModelHandler.mapDataView(
                        options.dataViews,
                        this.formattingSettings,
                        this.host
                    );
                this.updateStatus();
            }
            this.formattingSettings.handlePropertyVisibility(viewModel);
            this.landingPageHandler.handleLandingPage(
                viewModel.isValid,
                this.host
            );
            if (!viewModel.isValid) {
                throw new Error('View model mapping error');
            }
            if (diagActive) beginCapture();
            try {
                this.orchestrator.render(
                    options,
                    viewModel,
                    this.formattingSettings
                );
            } finally {
                // Always disarm the sink, even if render throws: this keeps the
                // capture up to the failure point (useful for diagnosing the
                // throw) and prevents the sink staying armed into later renders.
                if (diagActive) this.lastSanitizerCapture = endCapture();
            }
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, e);
            // Clear any partially-rendered DOM from the failed update so the
            // next update starts clean. (The reconcile stash can't be left
            // inconsistent here: it is stamped only AFTER a node's content is
            // rendered, so a mid-render throw leaves changed nodes un-stamped
            // and they re-render next reconcile regardless of this wipe.)
            this.contentContainer.selectAll('*').remove();
            this.updateStatus();
            // Drop the cached template container so the next update rebuilds
            // against a clean, freshly-resolved container rather than reusing a
            // stale one whose DOM was just wiped.
            this.templateContainer = undefined;
            // Reset orchestrator state to match the now-empty container, so the
            // next update rebuilds from scratch rather than skipping a
            // viewport-only render against stale cached state.
            this.orchestrator.reset();
        }
    }

    /**
     * Build the RenderSteps closures that the orchestrator dispatches to.
     * All closures capture `this` and faithfully reproduce the behaviour of
     * the old inline update() body, now split by render path.
     */
    private buildRenderSteps(): RenderSteps {
        return {
            // Runs every update: container-level styling and scroll (reusing
            // the cached OverlayScrollbars instance so a reconcile preserves
            // scroll position). Hyperlink binding is content-dependent and
            // runs after each render step instead.
            resolveContainer: (settings) => {
                resolveStyling(
                    this.styleSheetContainer,
                    this.container,
                    settings
                );
                this.scrollbars = resolveScrollableContent(
                    this.container.node() as HTMLDivElement,
                    this.scrollbars
                );
            },
            // No-data message or raw-HTML textarea. Clears content first
            // (state-kind reset) and invalidates the cached template container
            // so the next populated render is a fresh rebuild that re-resolves
            // the body wrapper.
            renderEmptyOrRaw: (viewModel, settings) => {
                this.contentContainer.selectAll('*').remove();
                this.templateContainer = undefined;
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                if (viewModel.isEmpty) {
                    this.updateStatus(
                        settings.contentFormatting.contentFormattingCardNoData
                            .noDataMessage.value,
                        behavior.showRawHtml.value
                    );
                } else {
                    // Populated content but showRawHtml is on: render entries via
                    // the template engine (so the raw view reflects the templated
                    // output) then replace with the raw view (resolveForRawHtml
                    // wipes the content + adds the textarea).
                    this.templateContainer = resolveTemplateContainer(
                        this.contentContainer.node() as HTMLElement,
                        viewModel.bodyTemplate,
                        { allowHyperlinks: behavior.hyperlinks.value }
                    );
                    renderTemplatedEntries(
                        this.templateContainer,
                        viewModel.htmlEntries,
                        {
                            format: behavior.format.value as RenderFormat,
                            allowHyperlinks: behavior.hyperlinks.value,
                            hasSelection: viewModel.hasSelection
                        } as TemplatedRenderOptions
                    );
                    resolveForRawHtml(
                        this.styleSheetContainer,
                        this.contentContainer,
                        settings
                    );
                }
                resolveHyperlinkHandling(
                    this.host,
                    this.container,
                    behavior.hyperlinks.value
                );
            },
            // Full rebuild: re-resolve the template container (this clears
            // #htmlContent and re-parses the body — that IS the rebuild wipe),
            // then render every entry into it.
            rebuild: (viewModel, settings) => {
                this.rebuildPopulated(viewModel, settings);
            },
            // Reconcile: reuse the cached template container and re-render ONLY
            // the changed/entered rows (unchanged rows keep their exact node so
            // inline iframes survive). The body wrapper is NOT re-parsed here; a
            // body change (static OR CF) trips the fingerprint and forces a
            // rebuild, so the cached container is always body-current.
            reconcile: (viewModel, settings) => {
                const behavior =
                    settings.contentFormatting.contentFormattingCardBehavior;
                this.updateStatus();
                if (!this.templateContainer) {
                    // No baseline (shouldn't happen — rebuild always seeds it).
                    // Fall back to a full rebuild against a clean container.
                    this.rebuildPopulated(viewModel, settings);
                    return;
                }
                const { merged } = reconcileTemplatedEntries(
                    this.templateContainer,
                    viewModel.htmlEntries,
                    {
                        format: behavior.format.value as RenderFormat,
                        allowHyperlinks: behavior.hyperlinks.value,
                        hasSelection: viewModel.hasSelection
                    } as TemplatedRenderOptions
                );
                this.finalizePopulatedRender(merged, viewModel, settings);
            },
            bindInteractivity: (viewModel) => {
                if (this.host.hostCapabilities.allowInteractions) {
                    this.interactivity.bind(<
                        IHtmlBehaviorOptions<SelectableDataPoint>
                    >{
                        behavior: this.behavior,
                        dataPoints: viewModel.htmlEntries,
                        clearCatcherSelection: this.container,
                        pointSelection: this.dataElements,
                        viewModel,
                        hideTooltip: () =>
                            this.host.tooltipService.hide({
                                immediately: true,
                                isTouchEvent: false
                            })
                    });
                }
            }
        };
    }

    /**
     * Full populated rebuild: re-resolve the template container against the
     * resolved body (this clears #htmlContent and re-parses the body wrapper —
     * the rebuild wipe), then render every entry into the resulting join
     * container. Shared by the rebuild render step and the reconcile fallback
     * (which runs only if no cached container exists — i.e. defensively).
     */
    private rebuildPopulated(
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel
    ): void {
        const behavior =
            settings.contentFormatting.contentFormattingCardBehavior;
        this.updateStatus();
        this.templateContainer = resolveTemplateContainer(
            this.contentContainer.node() as HTMLElement,
            viewModel.bodyTemplate,
            { allowHyperlinks: behavior.hyperlinks.value }
        );
        const merged = renderTemplatedEntries(
            this.templateContainer,
            viewModel.htmlEntries,
            {
                format: behavior.format.value as RenderFormat,
                allowHyperlinks: behavior.hyperlinks.value,
                hasSelection: viewModel.hasSelection
            } as TemplatedRenderOptions
        );
        this.finalizePopulatedRender(merged, viewModel, settings);
    }

    /**
     * Shared finalisation for the populated render paths (rebuild + reconcile):
     * apply the raw-HTML view if enabled, capture the rendered selection for
     * interactivity binding, wire hover/tooltips, and (re)bind hyperlink click
     * delegation onto the freshly rendered anchors. Hyperlink binding MUST run
     * after content render — resolveHyperlinkHandling selects existing <a>
     * elements, so newly appended anchors only get their click guard here.
     */
    private finalizePopulatedRender(
        merged: Selection<HTMLElement, IHtmlEntry, any, any>,
        viewModel: IViewModel,
        settings: VisualFormattingSettingsModel
    ): void {
        resolveForRawHtml(
            this.styleSheetContainer,
            this.contentContainer,
            settings
        );
        this.dataElements = merged;
        resolveHover(merged, this.host, viewModel.hasGranularity);
        resolveHyperlinkHandling(
            this.host,
            this.container,
            settings.contentFormatting.contentFormattingCardBehavior.hyperlinks
                .value
        );
    }

    /** Resolve all dialog UI strings via the localization manager. */
    private diagnosticsLabels(): DiagnosticsLabels {
        const t = (key: string): string =>
            this.localisationManager.getDisplayName(key);
        return {
            tabSanitizer: t('Diagnostics_TabSanitizer'),
            tabConsole: t('Diagnostics_TabConsole'),
            tabRaw: t('Diagnostics_TabRawHtml'),
            sanitizerEmpty: t('Diagnostics_SanitizerEmpty'),
            consoleEmpty: t('Diagnostics_ConsoleEmpty'),
            colKind: t('Diagnostics_ColKind'),
            colSubject: t('Diagnostics_ColSubject'),
            colRule: t('Diagnostics_ColRule'),
            overflow: t('Diagnostics_Overflow'),
            truncated: t('Diagnostics_Truncated'),
            copy: t('Diagnostics_Copy'),
            consoleClear: t('Diagnostics_ConsoleClear'),
            docsHeading: t('Diagnostics_DocsHeading'),
            docsSanitization: t('Diagnostics_DocsSanitization'),
            docsAcceptedTags: t('Diagnostics_DocsAcceptedTags'),
            rawBanner: t('Diagnostics_RawBanner'),
            rawBannerSanitized: t('Diagnostics_RawBannerSanitized'),
            tabEvents: t('Diagnostics_TabEvents'),
            eventsEmpty: t('Diagnostics_EventsEmpty'),
            colTime: t('Diagnostics_ColTime'),
            colEvent: t('Diagnostics_ColEvent'),
            colContext: t('Diagnostics_ColContext'),
            eventsClear: t('Diagnostics_EventsClear'),
            evtUpdate: t('Diagnostics_EvtUpdate'),
            evtCrossFilter: t('Diagnostics_EvtCrossFilter'),
            evtTooltip: t('Diagnostics_EvtTooltip'),
            evtDrill: t('Diagnostics_EvtDrill'),
            filterAll: t('Diagnostics_FilterAll')
        };
    }

    /**
     * Open diagnostics via Ctrl+D (Windows/Linux) / Cmd+D (Mac) when active.
     * Same gate as the icon (`this.diagActive`). The default Ctrl/Cmd+D
     * (bookmark) is suppressed only when we actually open the dialog.
     */
    private bindDiagnosticsHotkey(): void {
        const handler = (e: KeyboardEvent): void => {
            if (this.diagActive && isDiagnosticsHotkey(e)) {
                e.preventDefault();
                this.openDiagnostics();
            }
        };
        document.addEventListener('keydown', handler);
        this.removeHotkeyListener = () =>
            document.removeEventListener('keydown', handler);
    }

    /**
     * Power BI calls destroy() when the visual instance is torn down. Detach the
     * document-level keydown listener so a disposed instance can't react to
     * Ctrl/Cmd+D (the handler closes over `this`).
     */
    public destroy(): void {
        this.removeHotkeyListener?.();
    }

    /** Assemble a bounded snapshot and open the host modal dialog. */
    private openDiagnostics(): void {
        // Re-entrancy guard: one dialog open at a time. A double Ctrl/Cmd+D or an
        // icon click while the open is in flight would otherwise fire two
        // concurrent openModalDialog calls. Cleared in both .then and .catch.
        if (this.diagOpening) {
            return;
        }
        this.diagOpening = true;
        const rawHtml = getDiagnosticsRawHtml(
            this.styleSheetContainer,
            this.contentContainer,
            this.formattingSettings.stylesheet
        );
        const snapshot = buildSnapshot({
            rawHtml,
            sanitizer: this.lastSanitizerCapture,
            console: consoleSnapshot(),
            events: eventsSnapshot(),
            labels: this.diagnosticsLabels(),
            sanitizeEnabled: sanitizerEnabled,
            initialTab: this.lastDiagnosticsTab,
            consoleFilter: this.lastConsoleFilter,
            eventsFilter: this.lastEventsFilter
        });
        void this.host
            .openModalDialog(
                VisualConstants.diagnostics.dialogId,
                {
                    title: this.localisationManager.getDisplayName(
                        'Diagnostics_DialogTitle'
                    ),
                    size: VisualConstants.diagnostics.dialog.size,
                    // Literals avoid const-enum inlining ambiguity:
                    position: {
                        type: 0 /* VisualDialogPositionType.Center */
                    },
                    actionButtons: [0 /* DialogAction.Close */]
                },
                snapshot
            )
            .then((result) => {
                this.diagOpening = false;
                // The dialog reports its state via setResult / close →
                // resultState: the last tab (so we reopen there), a console
                // clear request, and a doc-link launch (mapped to our own URL).
                const rs = result?.resultState as
                    | {
                          lastTab?: string;
                          clearConsole?: boolean;
                          clearEvents?: boolean;
                          consoleFilter?: string;
                          eventsFilter?: string;
                          launchDoc?: 'sanitization' | 'acceptedTags';
                      }
                    | undefined;
                if (rs?.lastTab) {
                    this.lastDiagnosticsTab = rs.lastTab;
                }
                // Remember the filter picks so they're sticky on the next open.
                if (rs?.consoleFilter) {
                    this.lastConsoleFilter = rs.consoleFilter;
                }
                if (rs?.eventsFilter) {
                    this.lastEventsFilter = rs.eventsFilter;
                }
                if (rs?.clearConsole) {
                    clearConsoleBuffer();
                }
                if (rs?.clearEvents) {
                    clearEventsBuffer();
                }
                if (rs?.launchDoc) {
                    // Map the doc KEY to our own constant URL — launchUrl can
                    // only ever open one of our documented pages.
                    const url = VisualConstants.diagnostics.docs[rs.launchDoc];
                    if (url) {
                        this.host.launchUrl(url);
                    }
                }
            })
            .catch(() => {
                this.diagOpening = false;
                /* dialog dismissed / unsupported; keep the current state */
            });
    }

    /**
     * Ensure that when the user navigates to the visual using Power BI-supported keyboard shortcuts, the visual is focused accordingly. If
     * the user clicks on the body of the page, we should behave as normal.
     */
    private bindFocusEvents() {
        document.body.onmousedown = () => {
            this.bodyFocusedWithClick = true;
        };
        document.body.onfocus = () => {
            if (!this.bodyFocusedWithClick) {
                this.contentContainer.node().focus();
            }
            this.bodyFocusedWithClick = false;
        };
    }

    /**
     * Generic function to manage update of text within status container.
     *
     * @param message       - Simple message to display. Omit to remove current content.
     * @param showRawHtml   - Flag to confirm whether we should show Raw HTML or not
     */
    private updateStatus(message?: string, showRawHtml?: boolean) {
        this.statusContainer.selectAll('*').remove();
        if (message) {
            this.statusContainer.append('div').append(function () {
                return this.appendChild(getParsedHtmlAsDom(message, 'html'));
            });
        }
        if (showRawHtml) {
            resolveForRawHtml(
                this.styleSheetContainer,
                this.statusContainer,
                this.formattingSettings
            );
        }
    }
}
