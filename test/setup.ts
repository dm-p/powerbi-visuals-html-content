import { vi } from 'vitest';

// Mock powerbi global object required by visual-settings.ts
(global as any).powerbi = {
    VisualEnumerationInstanceKinds: {
        ConstantOrRule: 0,
        Constant: 1,
        Rule: 2
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
