import { describe, it, expect } from 'vitest';
import certified from '../capabilities.json';
import webaccess from '../capabilities.webaccess.json';

describe('capabilities editions', () => {
    it('certified has no privileges', () => {
        expect(certified.privileges).toEqual([]);
    });

    it('webaccess grants WebAccess', () => {
        expect(webaccess.privileges).toEqual([
            { name: 'WebAccess', parameters: ['*'] }
        ]);
    });

    it('the two files are identical except privileges', () => {
        const strip = (c: Record<string, unknown>) => {
            const { privileges, ...rest } = c;
            void privileges;
            return rest;
        };
        expect(strip(webaccess)).toEqual(strip(certified));
    });
});
