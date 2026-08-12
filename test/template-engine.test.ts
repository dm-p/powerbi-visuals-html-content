import { describe, it, expect } from 'vitest';
import {
    substitute,
    CONTENT_TOKEN,
    ROW_TOKEN,
    resolveRowTemplate
} from '../src/template-engine';
import { VisualFormattingSettingsModel } from '../src/visual-settings';

describe('substitute', () => {
    it('replaces all occurrences, tolerant of inner whitespace', () => {
        expect(substitute('<tr>{{row}}</tr>', ROW_TOKEN, '<td>x</td>')).toBe(
            '<tr><td>x</td></tr>'
        );
        expect(substitute('{{ content }}{{content}}', CONTENT_TOKEN, 'A')).toBe(
            'AA'
        );
    });
    it('does not re-scan the inserted value (content containing a token is inert)', () => {
        expect(
            substitute('<i>{{row}}</i>', ROW_TOKEN, 'see {{row}} docs')
        ).toBe('<i>see {{row}} docs</i>');
    });
    it('does not interpret $ in the inserted value', () => {
        expect(substitute('{{row}}', ROW_TOKEN, '$& $1 $$')).toBe('$& $1 $$');
    });
});

describe('resolveRowTemplate', () => {
    it('returns settings.templates.templatesCardMain.rowTemplate.value', () => {
        const settings = {
            templates: {
                templatesCardMain: { rowTemplate: { value: 'STATIC' } }
            }
        } as any;
        expect(resolveRowTemplate(settings, true)).toBe('STATIC');
    });
});

describe('resolveRowTemplate — per-mode defaults', () => {
    it('legacy mode default is the double-div 1.6 structure', () => {
        const settings = new VisualFormattingSettingsModel();
        expect(resolveRowTemplate(settings, true)).toBe(
            '<div><div>{{row}}</div></div>'
        );
    });

    it('modern mode default is the single-div structure', () => {
        const settings = new VisualFormattingSettingsModel();
        expect(resolveRowTemplate(settings, false)).toBe('<div>{{row}}</div>');
    });

    it('an authored row template wins in BOTH modes', () => {
        const settings = new VisualFormattingSettingsModel();
        settings.templates.templatesCardMain.rowTemplate.value =
            '<section>{{row}}</section>';
        expect(resolveRowTemplate(settings, true)).toBe(
            '<section>{{row}}</section>'
        );
        expect(resolveRowTemplate(settings, false)).toBe(
            '<section>{{row}}</section>'
        );
    });

    it('whitespace-only authored value falls back to the mode default', () => {
        const settings = new VisualFormattingSettingsModel();
        settings.templates.templatesCardMain.rowTemplate.value = '   ';
        expect(resolveRowTemplate(settings, true)).toBe(
            '<div><div>{{row}}</div></div>'
        );
    });
});
