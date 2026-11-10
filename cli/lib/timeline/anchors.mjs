// Scene anchors: elements an overlay can pin itself to.
// Elements a scene marks with data-anchor, which an overlay can pin to with `on`; null when the
// scene type has none. Numbered names follow the authored order, cue names the item's own cue.
export function anchorNames(type, props = {}) {
  const list = (key, items) => (items ?? []).flatMap((x, i) => [`${key}${i + 1}`, ...(x?.cue ? [x.cue] : [])]);
  if (type === "stat-cards") return list("card", props.cards);
  if (type === "bar-compare") return list("bar", props.items);
  if (type === "share") return ["ring", ...list("seg", props.segments)];
  if (type === "compare") return ["left", "right", ...["left", "right"].filter((k) => props[k]?.value !== undefined).map((k) => `${k}-value`)];
  return null;
}
