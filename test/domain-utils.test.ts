import { describe, it, expect, vi } from 'vitest';
import {
    shouldUseStylesheet,
    shouldDimPoint,
    bindVisualDataToDom
} from '../src/domain-utils';
import { VisualConstants } from '../src/visual-constants';
import { select } from 'd3-selection';
import { JSDOM } from 'jsdom';

describe('Domain Utils - Exported Functions', () => {
    describe('shouldUseStylesheet', () => {
        it('should return true when stylesheet is provided', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: 'body { color: red; }' }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(true);
        });

        it('should return false when stylesheet is empty', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: '' }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return false when stylesheet is null', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: null }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return false when stylesheet is undefined', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: undefined }
                }
            } as any;

            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(false);
        });

        it('should return true for whitespace-only stylesheet', () => {
            const stylesheet = {
                stylesheetCardMain: {
                    stylesheet: { value: '   ' }
                }
            } as any;

            // Whitespace is truthy, so this returns true
            const result = shouldUseStylesheet(stylesheet);
            expect(result).toBe(true);
        });
    });

    describe('shouldDimPoint', () => {
        it('should return true when has selection and point is not selected', () => {
            const result = shouldDimPoint(true, false);
            expect(result).toBe(true);
        });

        it('should return false when has selection and point is selected', () => {
            const result = shouldDimPoint(true, true);
            expect(result).toBe(false);
        });

        it('should return false when no selection', () => {
            const result = shouldDimPoint(false, false);
            expect(result).toBe(false);
        });

        it('should return false when no selection even if point selected', () => {
            const result = shouldDimPoint(false, true);
            expect(result).toBe(false);
        });
    });

    describe('bindVisualDataToDom', () => {
        it('should create elements for each data entry', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test 1</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                },
                {
                    content: '<p>Test 2</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            const result = bindVisualDataToDom(container, data, false);

            // Should create entries for each data item
            expect(result.size()).toBe(2);
        });

        it('should apply entry class to all elements', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, false);

            const entries = container.selectAll(
                `.${VisualConstants.dom.entryClassSelector}`
            );
            expect(entries.size()).toBe(1);
        });

        it('should apply unselected class when hasSelection is true and item is not selected', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, true);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(1);
        });

        it('should not apply unselected class when hasSelection is false', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: false,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, false);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(0);
        });

        it('should not apply unselected class when item is selected', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const data = [
                {
                    content: '<p>Test</p>',
                    identity: {},
                    selected: true,
                    tooltips: []
                }
            ] as any[];

            bindVisualDataToDom(container, data, true);

            const unselected = container.selectAll(
                `.${VisualConstants.dom.unselectedClassSelector}`
            );
            expect(unselected.size()).toBe(0);
        });

        it('should handle empty data array', () => {
            const dom = new JSDOM(
                '<!DOCTYPE html><html><body><div id="container"></div></body></html>'
            );
            const container = select(dom.window.document).select('#container');

            const result = bindVisualDataToDom(container, [], false);

            expect(result.size()).toBe(0);
        });
    });
});
