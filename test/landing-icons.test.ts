import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { githubIcon, heartIcon, coffeeIcon } from '../src/landing/icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('landing-icons', () => {
    let doc: Document;
    beforeEach(() => {
        doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;
    });

    it('builds namespaced SVG with paths and the requested size', () => {
        for (const make of [githubIcon, heartIcon, coffeeIcon]) {
            const svg = make(doc, 16, 16);
            expect(svg.namespaceURI).toBe(SVG_NS);
            expect(svg.getAttribute('width')).toBe('16');
            const p = svg.querySelector('path');
            expect(p?.namespaceURI).toBe(SVG_NS);
        }
    });
});
