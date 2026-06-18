/**
 * Console tee. Patches console.log/info/warn/error ONCE to push into a bounded
 * ring buffer AND always call through to the originals. Scoped to the visual's
 * own sandboxed iframe (console is per-window), so it never affects the parent
 * Power BI window, other visuals, or the global console.
 */
import { ConsoleEntry, ConsoleLevel } from './types';
import { VisualConstants } from '../visual-constants';

const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error'];
const buffer: ConsoleEntry[] = [];
let installed = false;
type ConsoleFn = (...args: unknown[]) => void;
const originals = new Map<ConsoleLevel, ConsoleFn>();

const stringify = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || a.message;
    try {
        return JSON.stringify(a);
    } catch {
        return String(a);
    }
};

const push = (level: ConsoleLevel, args: unknown[]): void => {
    const text = args
        .map(stringify)
        .join(' ')
        .slice(0, VisualConstants.diagnostics.consoleLineCap);
    buffer.push({ ts: Date.now(), level, text });
    while (buffer.length > VisualConstants.diagnostics.consoleBufferCap) {
        buffer.shift();
    }
};

export const install = (): void => {
    if (installed) return;
    installed = true;
    for (const level of LEVELS) {
        const original = console[level].bind(console);
        originals.set(level, original);
        console[level] = (...args: unknown[]): void => {
            try {
                push(level, args);
            } catch {
                /* never let capture break logging */
            }
            original(...args);
        };
    }
};

export const snapshot = (): ConsoleEntry[] => buffer.slice();

/**
 * Empty the captured buffer. The tee stays installed, so capture continues —
 * this is the "clear the view, keep listening" semantics a clear affordance
 * wants. It does NOT uninstall the patch.
 */
export const clear = (): void => {
    buffer.length = 0;
};

/**
 * Test-only: fully reset module state — empty the buffer, restore the original
 * console methods, and mark uninstalled — so each test starts from a clean
 * slate. Not used in production (the tee is installed once for the visual's
 * lifetime).
 */
export const resetForTests = (): void => {
    buffer.length = 0;
    for (const level of LEVELS) {
        const orig = originals.get(level);
        if (orig) {
            console[level] = orig;
        }
    }
    originals.clear();
    installed = false;
};
