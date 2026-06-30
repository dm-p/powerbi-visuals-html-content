'use strict';

import type powerbi from 'powerbi-visuals-api';
import { dataViewObjects } from 'powerbi-visuals-utils-dataviewutils';
import { VisualFormattingSettingsModel } from './visual-settings';

export const CONTENT_TOKEN = /\{\{\s*content\s*\}\}/g;
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

/** The row template — a single static wrapper applied to every row. */
export function resolveRowTemplate(
    settings: VisualFormattingSettingsModel
): string {
    return settings.templates.templatesCardMain.rowTemplate.value;
}
