// Scene props that carry their own times (canvas, footage, device, match-cut) and device rects.
import { snapToBar, snapToBeat } from "../audio/beats.mjs";
import { resolveWhen } from "./cues.mjs";
import { clampT, r3 } from "./util.mjs";

// An inherited canvas item arrives in its final form: already shown, morphs applied.
export const settled = (it) => {
  const { morph = [], at: _a, cue: _c, ...rest } = it;
  const last = morph.length ? morph[morph.length - 1] : {};
  const { at: _ma, cue: _mc, t: _mt, ...state } = last;
  return { ...rest, ...state, t: 0, settled: true };
};

// Resolve every `at`/`cue` in a canvas / footage scene's props to `t` (scene seconds).
export function resolvePropTimes(type, props, ctx, errors, where) {
  // `beat`: camera moves snap like shots ("beat", or "bar" for cuts and speed-ups).
  const fix = (o, label, beat) => {
    if (!o || (o.at === undefined && o.cue === undefined)) return;
    const res = resolveWhen(o, ctx);
    if (res.error) { errors.push(`${where} ${label}: ${res.error}`); return; }
    let t = clampT(res.t, ctx.duration);
    if (beat && ctx.snap && ctx.beats?.length && o.snap !== false) {
      const abs = ctx.start + t;
      t = (beat === "bar" ? snapToBar(abs, ctx.beats, ctx.downbeats) : snapToBeat(abs, ctx.beats, 0.12)) - ctx.start;
    }
    o.t = r3(clampT(t, ctx.duration));
  };
  if (type === "canvas") {
    for (const [i, it] of (props.items ?? []).entries()) { fix(it, `item ${it.id ?? i}`); for (const [j, m] of (it.morph ?? []).entries()) fix(m, `item ${it.id ?? i} morph ${j}`); }
    for (const [i, v] of (props.path ?? []).entries()) fix(v, `path ${i}`, i === 0 ? null : v.cut ? "bar" : "beat");
    for (const [i, l] of (props.links ?? []).entries()) fix(l, `link ${i}`);
  }
  if (type === "footage") {
    // A keyframe without a time starts at 0, as the player reads it; cues may resolve out of order.
    for (const [i, r] of (props.ramp ?? []).entries()) { fix(r, `ramp ${i}`, r.speed > 1.3 ? "bar" : null); r.t ??= 0; }
    props.ramp?.sort((a, b) => a.t - b.t);
    fix(props.title, "title");
  }
  if (type === "parallax") fix(props.title, "title");
  if (type === "footage") {
    fix(props.screen, "screen"); fix(props.windows, "windows");
    // A step without a time comes 1.2s after the one before it.
    let last = props.screen?.t ?? 0;
    for (const [i, st] of (props.screen?.steps ?? []).entries()) { fix(st, `screen step ${i}`); st.t ??= r3(Math.min(ctx.duration, last + 1.2)); last = st.t; }
    props.screen?.steps?.sort((a, b) => a.t - b.t);
  }
  if (type === "device") {
    // Taps land on the beat; steps without a time spread over the first three quarters.
    const steps = props.steps ?? [];
    steps.forEach((st, i) => { fix(st, `step ${i}`, st.tap ? "beat" : null); st.t ??= r3(Math.min(ctx.duration, 0.6 + (i * Math.max(0, 0.75 * ctx.duration - 0.6)) / Math.max(1, steps.length - 1 || 1))); });
    steps.sort((a, b) => a.t - b.t);
  }
  if (type === "match-cut") {
    // `every`: seconds per still, or "beat" / "bar" to cut on the music from `from` seconds on.
    const items = props.items ?? [], every = props.every ?? 0.5, from = props.from ?? 0;
    const grid = every === "bar" ? ctx.downbeats : every === "beat" ? ctx.beats : null;
    const local = (grid ?? []).map((b) => b - ctx.start).filter((b) => b >= from - 1e-3 && b < ctx.duration);
    if (grid && local.length < items.length) errors.push(`${where} match-cut: ${items.length} stills but only ${local.length} ${every}s from ${from}s in the scene (no music beats? use every: <seconds>)`);
    const step = typeof every === "number" ? every : 0.5;
    if (!grid && items.length && from + (items.length - 1) * step >= ctx.duration) errors.push(`${where} match-cut: ${items.length} stills every ${step}s from ${from}s run past the ${r3(ctx.duration)}s scene (use a smaller every)`);
    items.forEach((it, i) => { fix(it, `item ${i}`, "beat"); it.t ??= r3(grid ? local[i] ?? from + i * step : from + i * step); });
  }
}

// Device steps may name a region by the capture's rects (onevideo capture --rects): a tap lands
// on its centre, expand/focus take the rect. Names are looked up on the screen showing at the step.
export function resolveDeviceRects(props, assetById, errors, where) {
  const screens = props.screens ?? [];
  const idx = (s) => (typeof s === "number" ? s : screens.findIndex((x) => x.id === s));
  let cur = 0;
  const rect = (name, label) => {
    const r = assetById.get(screens[cur]?.asset)?.rects?.[name];
    if (!r) errors.push(`${where} ${label}: no rect "${name}" on screen ${screens[cur]?.id ?? cur} (rects come from onevideo capture --rects)`);
    return r ?? [0.25, 0.25, 0.5, 0.5];
  };
  for (const [i, st] of (props.steps ?? []).entries()) {
    if (st.screen !== undefined) {
      if (idx(st.screen) < 0 || idx(st.screen) >= screens.length) errors.push(`${where} step ${i}: unknown screen "${st.screen}"`);
      else cur = idx(st.screen);
    }
    if (typeof st.tap === "string") { const r = rect(st.tap, `step ${i} tap`); st.tap = [r3(r[0] + r[2] / 2), r3(r[1] + r[3] / 2)]; }
    if (typeof st.focus === "string") st.focus = rect(st.focus, `step ${i} focus`);
    if (st.expand && typeof st.expand.rect === "string") st.expand.rect = rect(st.expand.rect, `step ${i} expand`);
    if (st.expand && typeof st.expand.to === "string") st.expand.to = rect(st.expand.to, `step ${i} expand.to`);
    // A tap that opens a card with no rect of its own grows the region around the tap.
    if (st.expand && !st.expand.rect && Array.isArray(st.tap)) st.expand.rect = [r3(Math.max(0, st.tap[0] - 0.2)), r3(Math.max(0, st.tap[1] - 0.06)), 0.4, 0.12];
  }
}
