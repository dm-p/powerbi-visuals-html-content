'use strict';

import type powerbi from 'powerbi-visuals-api';
import { dataViewObjects } from 'powerbi-visuals-utils-dataviewutils';
import { VisualFormattingSettingsModel } from './visual-settings';
import { VisualConstants } from './visual-constants';

/**
 * Body-template placeholder matched and replaced with the content slot.
 * Global so every occurrence in a template is substituted.
 */
export const CONTENT_TOKEN = /\{\{\s*content\s*\}\}/g;
/**
 * Row-template placeholder matched and replaced with each row's content.
 * Global so every occurrence in a template is substituted.
 */
export const ROW_TOKEN = /\{\{\s*row\s*\}\}/g;

/** Replace every `token` occurrence with `value`; function replacer prevents
 *  `$` interpretation in the replacement and ensures the inserted value is
 *  never re-scanned. */
export function substitute(
    template: string,
    token: RegExp,
    value: string
): string {
    return template.replace(token, () => value);
}

/**
 * Name of the formatting object holding template properties, used to read
 * the per-visual conditional-formatting body template from the data view.
 */
const TEMPLATES_OBJECT = 'templates';

/** Single body template: per-`metadata.objects` CF value, else static value. */
export function resolveBodyTemplate(
    dataView: powerbi.DataView | undefined,
    settings: VisualFormattingSettingsModel
): string {
    const fallback = settings.templates.templatesCardMain.bodyTemplate.value;
    return dataViewObjects.getValue<string>(
        // getValue tolerates absent objects (returns the fallback); its type
        // wants a non-undefined map, so assert past the optional chain.
        dataView?.metadata?.objects as powerbi.DataViewObjects,
        { objectName: TEMPLATES_OBJECT, propertyName: 'bodyTemplate' },
        fallback
    );
}

/**
 * The row template — the authored value when one is set (non-blank), else
 * the compatibility-mode default (legacy double-div / modern single-div).
 */
export function resolveRowTemplate(
    settings: VisualFormattingSettingsModel,
    legacyRendering: boolean
): string {
    const authored = settings.templates.templatesCardMain.rowTemplate.value;
    if (authored && authored.trim().length > 0) {
        return authored;
    }
    return legacyRendering
        ? VisualConstants.templates.row
        : VisualConstants.templates.rowModern;
}
