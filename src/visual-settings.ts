/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

'use strict';

import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel';
import FormattingSettingsCompositeCard = formattingSettings.CompositeCard;
import FormattingSettingsGroup = formattingSettings.Group;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
import { VisualConstants } from './visual-constants';
import { IViewModel } from './view-model';
import { shouldUseStylesheet } from './domain-utils';

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    contentFormatting = new ContentFormattingSettings();
    stylesheet = new StylesheetSettings();
    crossFilter = new CrossFilterSettings();
    cards = [this.contentFormatting, this.stylesheet, this.crossFilter];
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
            this.crossFilter.crossFilterCardMain.useTransparency.visible = this.crossFilter.crossFilterCardMain.enabled.value;
            this.crossFilter.crossFilterCardMain.transparencyPercent.visible =
                this.crossFilter.crossFilterCardMain.enabled.value &&
                this.crossFilter.crossFilterCardMain.useTransparency.value;
        } else {
            this.crossFilter.visible = false;
        }
    }
}

export class ContentFormattingSettings extends FormattingSettingsCompositeCard {
    name = 'contentFormatting';
    displayNameKey = 'Objects_ContentFormatting';
    descriptionKey = 'Objects_ContentFormatting_Description';
    contentFormattingCardBehavior = new ContentFormattingCardBehavior(Object());
    contentFormattingCardNoData = new ContentFormattingCardNoData(Object());
    contentFormattingCardDefaultBodyStyling = new ContentFormattingCardDefaultBodyStyling(
        Object()
    );
    groups: Array<FormattingSettingsGroup> = [
        this.contentFormattingCardBehavior,
        this.contentFormattingCardNoData,
        this.contentFormattingCardDefaultBodyStyling
    ];
}

class ContentFormattingCardBehavior extends FormattingSettingsGroup {
    name = 'contentFormatting-behavior';
    displayNameKey = 'Objects_ContentFormatting_Behavior';
    descriptionKey = 'Objects_ContentFormatting_Behavior_Description';
    // Whether to render as HTML or show raw code
    showRawHtml = new formattingSettings.ToggleSwitch({
        name: 'showRawHtml',
        displayNameKey: 'Objects_ContentFormatting_ShowRawHTML',
        descriptionKey: 'Objects_ContentFormatting_ShowRawHTML_Description',
        value: false
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
        this.showRawHtml,
        this.hyperlinks,
        this.userSelect
    ];
}

class ContentFormattingCardNoData extends FormattingSettingsGroup {
    name = 'contentFormatting-noData';
    displayNameKey = 'Objects_ContentFormatting_NoDataMessage';
    descriptionKey = 'Objects_ContentFormatting_NoDataMessage_Description';
    // No data message
    noDataMessage = new formattingSettings.TextArea({
        name: 'noDataMessage',
        value: VisualConstants.contentFormatting.noDataMessage,
        placeholder: ' ',
        selector: null,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    slices: Array<FormattingSettingsSlice> = [this.noDataMessage];
}

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
            unitSymbol: 'px'
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
    slices: Array<FormattingSettingsSlice> = [
        this.fontFamily,
        this.fontSize,
        this.fontColour,
        this.align
    ];
}

export class StylesheetSettings extends FormattingSettingsCompositeCard {
    name = 'stylesheet';
    displayNameKey = 'Objects_Stylesheet';
    descriptionKey = 'Objects_Stylesheet_Description';
    stylesheetCardMain = new StylesheetCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.stylesheetCardMain];
}

class StylesheetCardMain extends FormattingSettingsGroup {
    name = 'stylesheet-main';
    // Custom stylesheet for the HTML body
    stylesheet = new formattingSettings.TextArea({
        name: 'stylesheet',
        placeholder: ' ',
        value: VisualConstants.stylesheet.stylesheet,
        selector: null,
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
    });
    slices: Array<FormattingSettingsSlice> = [this.stylesheet];
}

export class CrossFilterSettings extends FormattingSettingsCompositeCard {
    name = 'crossFilter';
    displayNameKey = 'Objects_CrossFilter';
    descriptionKey = 'Objects_CrossFilter_Description';
    crossFilterCardMain = new CrossFilterCardMain(Object());
    groups: Array<FormattingSettingsGroup> = [this.crossFilterCardMain];
}

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
