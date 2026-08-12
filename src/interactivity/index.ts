// Public interactivity surface. Consumers import from './interactivity'
// rather than reaching into individual modules.
export { BehaviorManager, IHtmlBehaviorOptions } from './behavior';
export { resolveHover } from './tooltips';
export { resolveHyperlinkHandling } from './hyperlinks';
export { resolveInteractivity } from './policy';
