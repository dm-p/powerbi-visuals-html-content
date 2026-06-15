import { describe, it, expect } from 'vitest';
import {
    substitute,
    CONTENT_TOKEN,
    ROW_TOKEN,
    resolveRowTemplate
} from '../src/template-engine';

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
        expect(resolveRowTemplate(settings)).toBe('STATIC');
    });
});
