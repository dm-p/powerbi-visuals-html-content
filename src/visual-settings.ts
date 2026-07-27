'use strict';

import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel';
import FormattingSettingsCompositeCard = formattingSettings.CompositeCard;
import FormattingSettingsGroup = formattingSettings.Group;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import { VisualConstants } from './visual-constants';
import { IViewModel } from './view-model';
import { shouldUseStylesheet } from './domain-utils';

/**
 * Root formatting model: aggregates every settings card the properties pane
 * shows, and drives cross-card property visibility (e.g. hiding default body
 * styling when a stylesheet is used) via handlePropertyVisibility.
 */
export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    contentFormatting = new ContentFormattingSettings();
    stylesheet = new StylesheetSettings();
    crossFilter = new CrossFilterSettings();
    templates = new TemplatesSettings();
    compatibility = new CompatibilitySettings();
    cards = [
        this.contentFormatting,
        this.stylesheet,
        this.templates,
        this.crossFilter,
        this.compatibility
    ];
    handlePropertyVisibility(viewModel: IViewModel) {
        // Handle visibility of default body formatting properties if stylesheet is used
        if (
            this.contentFormatting.contentFormattingCardBehavior.showRawHtml
                .value ||
            shouldUseStylesheet(this.stylesheet)
        ) {
            this.contentFormatting.contentFormattingCardDefaultBodyStyling.visible = false;
        } else {
            this.contentFormatting.contentFormattingCardDefaultBodyStyling.visible = true;
        }
        // Cross-filtering properties
        if (viewModel.hasGranularity) {
            this.crossFilter.crossFilterCardMain.useTransparency.visible =
                this.crossFilter.crossFilterCardMain.enabled.value;
            this.crossFilter.crossFilterCardMain.transparencyPercent.visible =
                this.crossFilter.crossFilterCardMain.enabled.value &&
                this.crossFilter.crossFilterCardMain.useTransparency.value;
        } else {
            this.crossFilter.visible = false;
        }
    }
}

/**
 * Content Formatting card: groups behavior, no-data, and default body styling
 * for how bound HTML is rendered.
 */
export class ContentFormattingSettings extends FormattingSettingsCompositeCard {
    name = 'contentFormatting';
    displayNameKey = 'Objects_ContentFormatting';
    descriptionKey = 'Objects_ContentFormatting_Description';
    contentFormattingCardBehavior = new ContentFormattingCardBehavior(Object());
    contentFormattingCardNoData = new ContentFormattingCardNoData(Object());
    contentFormattingCardDefaultBodyStyling =
        new ContentFormattingCardDefaultBodyStyling(Object());
    groups: Array<FormattingSettingsGroup> = [
        this.contentFormattingCardBehavior,
        this.contentFormattingCardNoData,
        this.contentFormattingCardDefaultBodyStyling
    ];
}

/**
 * Behavior group: render format, render lifecycle mode, show-raw-HTML,
 * diagnostics, hyperlinks, and text selection.
 */
class ContentFormattingCardBehavior extends FormattingSettingsGroup {
    name = 'contentFormatting-behavior';
    displayNameKey = 'Objects_ContentFormatting_Behavior';
    descriptionKey = 'Objects_ContentFormatting_Behavior_Description';
    // Render format
    format = new formattingSettings.AutoDropdown({
        name: 'format',
        displayNameKey: 'Objects_ContentFormatting_Format',
        descriptionKey: 'Objects_ContentFormatting_Format_Description',
        value: VisualConstants.contentFormatting.format
    });
    // Render lifecycle mode
    renderMode = new formattingSettings.AutoDropdown({
        name: 'renderMode',
        displayNameKey: 'Objects_ContentFormatting_RenderMode',
        descriptionKey: 'Objects_ContentFormatting_RenderMode_Description',
        value: VisualConstants.contentFormatting.renderMode
    });
    // Whether to render as HTML or show raw code
    showRawHtml = new formattingSettings.ToggleSwitch({
        name: 'showRawHtml',
        displayNameKey: 'Objects_ContentFormatting_ShowRawHTML',
        descriptionKey: 'Objects_ContentFormatting_ShowRawHTML_Description',
        value: false
    });
    // Developer diagnostics: surfaces an icon (Desktop+Service) that opens a
    // modal dialog with sanitizer/console/raw-HTML tabs. Off by default; the
    // only author-facing gate. Does not change rendered output.
    enableDiagnostics = new formattingSettings.ToggleSwitch({
        name: 'enableDiagnostics',
        displayNameKey: 'Objects_ContentFormatting_EnableDiagnostics',
        descriptionKey:
            'Objects_ContentFormatting_EnableDiagnostics_Description',
        value: VisualConstants.contentFormatting.enableDiagnostics
    });
    // Allow hyperlinks to be opened using the visual host
    hyperlinks = new formattingSettings.ToggleSwitch({
        name: 'hyperlinks',
        displayNameKey: 'Objects_ContentFormatting_Hyperlinks',
        descriptionKey: 'Objects_ContentFormatting_Hyperlinks_Description',
        value: VisualConstants.contentFormatting.hyperlinks
    });
    // Allow text select using the mouse rather than standard visual behavior
    userSelect = new formattingSettings.ToggleSwitch({
        name: 'userSelect',
        displayNameKey: 'Objects_ContentFormatting_UserSelect',
        descriptionKey: 'Objects_ContentFormatting_UserSelect_Description',
        value: VisualConstants.contentFormatting.userSelect
    });
    slices: Array<FormattingSettingsSlice> = [
        this.format,
        this.renderMode,
        this.showRawHtml,
        this.enableDiagnostics,
        this.hyperlinks,
        this.userSelect
    ];
}

/** No-data group: the message shown when no rows are bound. */
class ContentFormattingCardNoData extends FormattingSettingsGroup {
    name = 'contentFormatting-noData';
    displayNameKey = 'Objects_ContentFormatting_NoDataMessage';
    descriptionKey = 'Objects_ContentFormatting_NoDataMessage_Description';
    // No data message
    noDataMessage = new formattingSettings.TextArea({
        name: 'noDataMessage',
        value: VisualConstants.contentFormatting.noDataMessage,
        placeholder: ' ',
        selector: undefined,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    slices: Array<FormattingSettingsSlice> = [this.noDataMessage];
}

/**
 * Default body styling group: font family/size/color and alignment applied to
 * the body when the author supplies no inline styling, plus the toggle that
 * forces these to override inline `style` (paste-cleanup, issue #144). Hidden
 * when a custom stylesheet or show-raw-HTML is active.
 */
class ContentFormattingCardDefaultBodyStyling extends FormattingSettingsGroup {
    name = 'contentFormatting-defaultBodyStyling';
    displayNameKey = 'Objects_ContentFormatting_DefaultBodyStyling';
    descriptionKey = 'Objects_ContentFormatting_DefaultBodyStyling_Description';
    // Default font family; used if no explicity styling in HTML body
    fontFamily = new formattingSettings.FontPicker({
        name: 'fontFamily',
        displayNameKey: 'Objects_ContentFormatting_FontFamily',
        descriptionKey: 'Objects_ContentFormatting_FontFamily_Description',
        value: VisualConstants.contentFormatting.font.family
    });
    // Default font size; used if no explicity styling in HTML body
    fontSize = new formattingSettings.Slider({
        name: 'fontSize',
        displayNameKey: 'Objects_ContentFormatting_FontSize',
        descriptionKey: 'Objects_ContentFormatting_FontSize_Description',
        value: VisualConstants.contentFormatting.font.size,
        options: {
            minValue: { value: 8, type: powerbi.visuals.ValidatorType.Min },
            maxValue: { value: 32, type: powerbi.visuals.ValidatorType.Max },
            unitSymbol: 'pt'
        }
    });
    // Default font color; used if no explicity styling in HTML body
    fontColour = new formattingSettings.ColorPicker({
        name: 'fontColour',
        displayNameKey: 'Objects_ContentFormatting_FontColour',
        descriptionKey: 'Objects_ContentFormatting_FontColour_Description',
        value: { value: VisualConstants.contentFormatting.font.colour }
    });
    // Default font size; used if no explicity styling in HTML body
    align = new formattingSettings.AlignmentGroup({
        name: 'align',
        displayNameKey: 'Objects_ContentFormatting_Align',
        descriptionKey: 'Objects_ContentFormatting_Align_Description',
        value: VisualConstants.contentFormatting.align,
        mode: powerbi.visuals.AlignmentGroupMode.Horizonal
    });
    // Whether the four properties above should override inline `style`
    // declarations in the bound content. Default OFF — author intent
    // wins. ON enables the cascade override in style/visual.less for
    // paste-cleanup mode (issue #144). Has no effect in
    // custom-stylesheet mode.
    overrideInlineStyling = new formattingSettings.ToggleSwitch({
        name: 'overrideInlineStyling',
        displayNameKey: 'Objects_ContentFormatting_OverrideInlineStyling',
        descriptionKey:
            'Objects_ContentFormatting_OverrideInlineStyling_Description',
        value: VisualConstants.contentFormatting.overrideInlineStyling
    });
    slices: Array<FormattingSettingsSlice> = [
        this.fontFamily,
        this.fontSize,
        this.fontColour,
        this.align,
        this.overrideInlineStyling
    ];
}

/** Stylesheet card: holds the custom CSS applied to the HTML body. */
export class StylesheetSettings extends FormattingSettingsCompositeCard {
    name = 'stylesheet';
    displayNameKey = 'Objects_Stylesheet';
    descriptionKey = 'Objects_Stylesheet_Description';
    stylesheetCardMain = new StylesheetCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.stylesheetCardMain];
}

/** Main stylesheet group: the custom-CSS text area for the HTML body. */
class StylesheetCardMain extends FormattingSettingsGroup {
    name = 'stylesheet-main';
    // Custom stylesheet for the HTML body
    stylesheet = new formattingSettings.TextArea({
        name: 'stylesheet',
        placeholder: ' ',
        value: VisualConstants.stylesheet.stylesheet,
        selector: undefined,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    slices: Array<FormattingSettingsSlice> = [this.stylesheet];
}

/** Cross-filter card: enables and tunes selection-driven cross-filtering. */
export class CrossFilterSettings extends FormattingSettingsCompositeCard {
    name = 'crossFilter';
    displayNameKey = 'Objects_CrossFilter';
    descriptionKey = 'Objects_CrossFilter_Description';
    crossFilterCardMain = new CrossFilterCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.crossFilterCardMain];
}

/**
 * Main cross-filter group: the enable toggle plus the non-selected
 * transparency toggle and percentage.
 */
class CrossFilterCardMain extends FormattingSettingsGroup {
    name = 'crossFilter-main';
    // Whether to enable cross-filtering
    enabled = new formattingSettings.ToggleSwitch({
        name: 'enabled',
        displayNameKey: 'Objects_CrossFilter_Enabled',
        descriptionKey: 'Objects_CrossFilter_Enabled_Description',
        value: VisualConstants.crossFilter.enabled
    });
    // Whether to use transparency on non-selected items
    useTransparency = new formattingSettings.ToggleSwitch({
        name: 'useTransparency',
        displayNameKey: 'Objects_CrossFilter_UseTransparency',
        descriptionKey: 'Objects_CrossFilter_UseTransparency_Description',
        value: VisualConstants.crossFilter.useTransparency
    });
    // The percentage of transparency to apply to non-selected items (if using transparency)
    transparencyPercent = new formattingSettings.Slider({
        name: 'transparencyPercent',
        displayNameKey: 'Objects_CrossFilter_TransparencyPercent',
        descriptionKey: 'Objects_CrossFilter_TransparencyPercent_Description',
        value: VisualConstants.crossFilter.transparencyPercent,
        options: {
            minValue: { value: 0, type: powerbi.visuals.ValidatorType.Min },
            maxValue: { value: 100, type: powerbi.visuals.ValidatorType.Max },
            unitSymbol: '%'
        }
    });
    slices: Array<FormattingSettingsSlice> = [
        this.enabled,
        this.useTransparency,
        this.transparencyPercent
    ];
}

/** Templates card: the body and per-row templates wrapping rendered content. */
export class TemplatesSettings extends FormattingSettingsCompositeCard {
    name = 'templates';
    displayNameKey = 'Objects_Templates';
    descriptionKey = 'Objects_Templates_Description';
    templatesCardMain = new TemplatesCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.templatesCardMain];
}

/**
 * Main templates group: the single-value body template (static or CF
 * apply-to-all) and the static per-row wrapper template.
 */
class TemplatesCardMain extends FormattingSettingsGroup {
    name = 'templates-main';
    // Body template: single value (applies once) — static or CF "apply to all".
    bodyTemplate = new formattingSettings.TextArea({
        name: 'bodyTemplate',
        displayNameKey: 'Objects_Templates_BodyTemplate',
        descriptionKey: 'Objects_Templates_BodyTemplate_Description',
        placeholder: '{{content}}',
        value: VisualConstants.templates.body,
        selector: undefined,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    // Row template: the static wrapper applied around every row. Per-row
    // variation comes from the content measure (the content is already
    // per-row), so this property has no conditional formatting — keeping the
    // typed value visible/editable in the pane (a CF wildcard selector writes
    // per-instance and the pane only reads back metadata.objects).
    // Empty = "not authored": resolveRowTemplate falls back to the
    // compatibility-mode default (VisualConstants.templates.row /
    // rowModern). A non-empty value always wins, in both modes.
    rowTemplate = new formattingSettings.TextArea({
        name: 'rowTemplate',
        displayNameKey: 'Objects_Templates_RowTemplate',
        descriptionKey: 'Objects_Templates_RowTemplate_Description',
        placeholder: '<div><div>{{row}}</div></div>',
        value: ''
    });
    slices: Array<FormattingSettingsSlice> = [
        this.bodyTemplate,
        this.rowTemplate
    ];
}

/**
 * Compatibility card: legacy (v1.6) rendering toggle. The persisted value
 * doubles as the migration version marker — see src/compatibility.ts and
 * docs/brainstorms/2026-07-27-legacy-rendering-compatibility-mode.md.
 */
export class CompatibilitySettings extends FormattingSettingsCompositeCard {
    name = 'compatibility';
    displayNameKey = 'Objects_Compatibility';
    descriptionKey = 'Objects_Compatibility_Description';
    compatibilityCardMain = new CompatibilityCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.compatibilityCardMain];
}

/** Main compatibility group: the single legacy-rendering toggle. */
class CompatibilityCardMain extends FormattingSettingsGroup {
    name = 'compatibility-main';
    // Default false = modern. The default is rarely load-bearing: the visual
    // stamps an explicit value on first classification (src/compatibility.ts).
    legacyRendering = new formattingSettings.ToggleSwitch({
        name: 'legacyRendering',
        displayNameKey: 'Objects_Compatibility_LegacyRendering',
        descriptionKey: 'Objects_Compatibility_LegacyRendering_Description',
        value: false
    });
    slices: Array<FormattingSettingsSlice> = [this.legacyRendering];
}
