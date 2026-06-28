import { VisualConstants } from '../visual-constants';

/** Interaction categories an author can suppress via `data-hc-suppress`. */
type InteractionToken = 'filter' | 'context-menu' | 'tooltip';

/**
 * Whether a given interaction is allowed for `node`. Walks from `node` up the
 * parent chain; if any ancestor's `data-hc-suppress` attribute names `token`
 * (or the `all` wildcard), the interaction is suppressed.
 *
 * No boundary is tracked — `data-hc-suppress` only ever appears inside author
 * content, so walking to the document root is safe.
 *
 * @param node  - the event target (or any element to test)
 * @param token - the interaction category
 * @returns true when allowed (default), false when suppressed
 */
export function resolveInteractivity(
    node: Element | null,
    token: InteractionToken
): boolean {
    const { suppressAttr, suppressAllToken } = VisualConstants.dom;
    let el: Element | null = node;
    while (el) {
        const raw = el.getAttribute(suppressAttr);
        if (raw) {
            // ponytail: linear parent-chain walk, called per click and per
            // mousemove. Fine at normal DOM depth; memoise only if a profiler on
            // multi-MB content complains.
            const tokens = raw.split(/\s+/);
            if (tokens.includes(token) || tokens.includes(suppressAllToken)) {
                return false;
            }
        }
        el = el.parentElement;
    }
    return true;
}
