// @ts-check

/** @param {Element[]} stack @param {Element} overlay @param {Element} caption */
export function hitsCaption(stack, overlay, caption) {
  for (const el of stack) {
    if (caption.contains(el)) return false;
    if (overlay.contains(el)) return true;
  }
  return false;
}
