// Scene anchors: elements an overlay can pin itself to.
// Elements a scene marks with data-anchor, which an overlay can pin to with `on`; null when the
// scene type has none. Numbered names follow the authored order, cue names the item's own cue.
export function anchorNames(type, props = {}) {
  const list = (key, items) => (items ?? []).flatMap((x, i) => [`${key}${i + 1}`, ...(x?.cue ? [x.cue] : [])]);
  if (type === "stat-cards") return list("card", props.cards);
  if (type === "bar-compare") return list("bar", props.items);
  if (type === "share") return ["ring", ...list("seg", props.segments)];
  if (type === "line-chart") {
    const points = (props.series ?? []).flatMap((s, si) => {
      const pre = si ? `s${si + 1}-` : "";
      const n = s?.points?.length ?? 0;
      return [...Array.from({ length: n }, (_, k) => `${pre}point${k + 1}`), ...(n ? [`${pre}last`] : [])];
    });
    return [...points, ...list("note", props.annotations)];
  }
  if (type === "bar-race") {
    const n = props.series?.length ?? 0;
    return [...Array.from({ length: n }, (_, k) => `bar${k + 1}`), ...Array.from({ length: Math.min(props.top ?? 10, n) }, (_, k) => `rank${k + 1}`), "period"];
  }
  if (type === "compare") return ["left", "right", ...["left", "right"].filter((k) => props[k]?.value !== undefined).map((k) => `${k}-value`)];
  return null;
}
