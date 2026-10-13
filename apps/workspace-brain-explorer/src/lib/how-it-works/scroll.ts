const OFFSET = 24;
const SETTLE_MS = 3000;

function scrollContainer(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(overflowY) &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * Scrolls only the nearest scrollable ancestor. `scrollIntoView` also nudges
 * every ancestor, which shifts the fixed app chrome.
 */
export function scrollToElement(
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth',
) {
  const container = scrollContainer(element);
  const viewportTop =
    container === document.scrollingElement
      ? 0
      : container.getBoundingClientRect().top;
  container.scrollTo({
    top:
      container.scrollTop +
      element.getBoundingClientRect().top -
      viewportTop -
      OFFSET,
    behavior,
  });
}

/**
 * Jumps to an element and keeps it pinned while late content above it (for
 * example Mermaid diagrams) changes the layout. Stops on user interaction.
 */
export function pinScroll(resolve: () => HTMLElement | null): () => void {
  const target = resolve();
  if (!target) return () => undefined;
  scrollToElement(target, 'auto');
  const root = scrollContainer(target);
  const observer = new ResizeObserver(() => {
    const element = resolve();
    if (element) scrollToElement(element, 'auto');
  });
  for (const child of Array.from(root.children)) observer.observe(child);
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const name of events) window.removeEventListener(name, stop, true);
  };
  for (const name of events)
    window.addEventListener(name, stop, { capture: true, passive: true });
  const timer = window.setTimeout(stop, SETTLE_MS);
  return stop;
}
