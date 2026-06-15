import { vi } from 'vitest';

// Provide powerbi as a global so that source files that reference
// powerbi.VisualEnumerationInstanceKinds (etc.) at class-field initialisation
// time find the correct runtime values.  const-enums from powerbi-visuals-api
// are NOT inlined by esbuild/vitest, so explicit numeric literals are required.
(global as any).powerbi = {
    VisualEnumerationInstanceKinds: {
        Constant: 1,
        Rule: 2,
        ConstantOrRule: 3 // Constant(1) | Rule(2)
    },
    visuals: {
        ValidatorType: {
            Min: 0,
            Max: 1
        },
        AlignmentGroupMode: {
            Horizonal: 0,
            Vertical: 1
        }
    }
};

// Mock atob for base64 decoding (used in getSanitizedDataUri)
if (typeof global.atob === 'undefined') {
    global.atob = (str: string) => {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(str, 'base64').toString('binary');
        }
        // Fallback for environments without Buffer
        return atob(str);
    };
}

// Mock btoa for base64 encoding
if (typeof global.btoa === 'undefined') {
    global.btoa = (str: string) => {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(str, 'binary').toString('base64');
        }
        // Fallback for environments without Buffer
        return btoa(str);
    };
}

// Mock OverlayScrollbars library
// The library is imported as: import * as OverlayScrollbars from 'overlayscrollbars'
// When called, it's used as: OverlayScrollbars(element, options)
// For namespace imports used as functions, we need to mock default export
vi.mock('overlayscrollbars', () => {
    const mockInstance = {
        destroy: vi.fn()
    };
    const mockFn = vi.fn(() => mockInstance);
    // Return an object that can be used as both namespace and callable
    return {
        default: mockFn,
        // Also expose as named export in case it's accessed that way
        OverlayScrollbars: mockFn
    };
});

// Mock powerbi-visuals-api to provide const-enum runtime values that
// esbuild/vitest does NOT inline from the package's TypeScript declarations.
// Spreads the real module so version/schemas are preserved.
vi.mock('powerbi-visuals-api', async (importOriginal) => {
    const original = await importOriginal<any>();
    const real = original?.default ?? original ?? {};
    return {
        ...original,
        default: {
            ...real,
            VisualEnumerationInstanceKinds: {
                Constant: 1,
                Rule: 2,
                ConstantOrRule: 3 // Constant(1) | Rule(2)
            },
            visuals: {
                ...(real.visuals ?? {}),
                ValidatorType: { Min: 0, Max: 1 },
                AlignmentGroupMode: { Horizonal: 0, Vertical: 1 }
            }
        }
    };
});

// Mock powerbi-visuals-utils-dataviewutils so the const enum
// DataViewWildcardMatchingOption is available at runtime in vitest
// (const enums from external packages are NOT inlined by esbuild).
vi.mock('powerbi-visuals-utils-dataviewutils', async (importOriginal) => {
    const original =
        await importOriginal<
            typeof import('powerbi-visuals-utils-dataviewutils')
        >();
    return {
        ...original,
        dataViewWildcard: {
            ...original.dataViewWildcard,
            DataViewWildcardMatchingOption: {
                InstancesAndTotals: 0,
                InstancesOnly: 1,
                TotalsOnly: 2
            }
        }
    };
});

// Mock Power BI utils libraries that have ESM/CJS compatibility issues
vi.mock('powerbi-visuals-utils-formattingutils', () => ({
    valueFormatter: {
        create: vi.fn(() => ({
            format: vi.fn((value: any) => String(value))
        })),
        getFormatString: vi.fn(() => ''),
        format: vi.fn((value: any) => String(value))
    }
}));

vi.mock('powerbi-visuals-utils-interactivityutils', () => ({
    interactivitySelectionService: {
        SelectableDataPoint: {}
    },
    interactivityBaseService: {
        IInteractivityService: {},
        ISelectionHandler: {}
    }
}));

vi.mock('powerbi-visuals-utils-tooltiputils', () => ({
    createTooltipServiceWrapper: vi.fn(() => ({
        addTooltip: vi.fn(),
        hide: vi.fn()
    })),
    TooltipEventArgs: {}
}));
