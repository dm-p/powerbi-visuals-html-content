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
    const settings = {
        templates: { templatesCardMain: { rowTemplate: { value: 'DFLT' } } }
    } as any;
    it('prefers the per-row objects bag, then metadata, then the static value', () => {
        const id = 'templates';
        const row = { [id]: { rowTemplate: 'ROW' } } as any;
        const meta = { [id]: { rowTemplate: 'META' } } as any;
        expect(resolveRowTemplate(row, meta, settings)).toBe('ROW');
        expect(resolveRowTemplate(undefined, meta, settings)).toBe('META');
        expect(resolveRowTemplate(undefined, undefined, settings)).toBe('DFLT');
    });
});
