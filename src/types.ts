/**
 * Valid renderer types for content.
 */
export type RenderFormat = 'html' | 'markdown';

/**
 * Render lifecycle: full rebuild each update, or reconcile unchanged
 * entries.
 */
export type RenderMode = 'rebuild' | 'reconcile';
