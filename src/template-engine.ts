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
        dataView?.metadata?.objects,
        { objectName: TEMPLATES_OBJECT, propertyName: 'bodyTemplate' },
        fallback
    );
}

/** Per-row row template: per-row `objects` bag → metadata.objects → static value. */
export function resolveRowTemplate(
    rowObjects: powerbi.DataViewObjects | undefined,
    metadataObjects: powerbi.DataViewObjects | undefined,
    settings: VisualFormattingSettingsModel
): string {
    const staticValue = settings.templates.templatesCardMain.rowTemplate.value;
    const id = { objectName: TEMPLATES_OBJECT, propertyName: 'rowTemplate' };
    const metaValue = dataViewObjects.getValue<string>(
        metadataObjects,
        id,
        staticValue
    );
    return dataViewObjects.getValue<string>(rowObjects, id, metaValue);
}
