// Sound design: transition, overlay and motion sounds, and their library variants.
import { entryAvailable } from "../library/catalog.mjs";
import { r3 } from "./util.mjs";

// config.sfx.transition: one sound for every boundary, or a map by transition type ("*" = rest).
// sfx.transition: "auto" maps each transition type to a library category that fits its motion.
export const AUTO_TRANSITION_SFX = { "*": "whoosh-soft", fade: null, dip: null, slide: "whoosh-soft", push: "whoosh-fast", wipe: "swish", whip: "whip", zoom: "whoosh-cinematic", punch: "impact", iris: "swish", clock: "swish", through: "whoosh-cinematic" };

// Sound name → public/ path: "synth:tick" (force the procedural sound) becomes sfx/synth-tick.wav.
export const sfxFile = (name) => `sfx/${name.replace(/[^a-z0-9-]/gi, "-")}.wav`;

export function transitionSfx(cfg, type) {
  if (!cfg || type === "cut") return null;
  if (cfg === "auto") cfg = AUTO_TRANSITION_SFX;
  if (typeof cfg === "string") return cfg;
  return cfg[type] !== undefined ? cfg[type] : cfg["*"] ?? null;
}

// Overlay sounds: an overlay's `sfx` names one, "auto" picks by type, null mutes; with
// config.sfx.overlays = "auto" every overlay without its own `sfx` gets the auto sound.
export const OVERLAY_SFX = { word: "ui-pop", icon: "ui-pop", burst: "ui-pop", confetti: "success-sting", arrow: "swish", mark: "marker", callout: "click", stamp: "impact", "lower-third": "whoosh-soft", spotlight: "swell", flash: "boom", image: "ui-pop", lottie: "ui-pop" };
export function overlaySound(ov, cfg) {
  const s = ov.sfx === undefined ? (cfg?.overlays === "auto" ? "auto" : null) : ov.sfx;
  if (!s) return null;
  const name = typeof s === "object" ? s.sound : s;
  return { sound: name === "auto" ? OVERLAY_SFX[ov.type] ?? null : name, volume: typeof s === "object" ? s.volume : undefined };
}

// config.sfx.motion = "auto": the picture's own moves make sound. A canvas flight whooshes (a long
// one cinematically), a hard cut or a slammed word lands with an impact, a push-in breathes a soft
// whoosh, footage ramping back up to speed rushes. Each role's variants rotate through the library.
export const MOTION_SFX = { fly: "whoosh-soft", flyLong: "whoosh-cinematic", cut: "impact", push: "whoosh-soft", slam: "impact", ramp: "whoosh-cinematic", tap: "click", expand: "whoosh-soft", page: "swish", still: "tick" };
export const MOTION_GAIN = { fly: 0.8, flyLong: 0.9, cut: 0.5, push: 0.45, slam: 0.7, ramp: 0.85, tap: 0.7, expand: 0.55, page: 0.5, still: 0.35 };
export const slamWord = (ov) => ov.type === "word" && (ov.style ?? "slam") === "slam";

// Motion events of a compiled scene, in absolute seconds.
export function motionCues(sc) {
  const out = [];
  const at = (t, role) => out.push({ role, at: r3(sc.start + Math.max(0, t)) });
  // Stop 0 frames the opening (and an inherited canvas's join), so it makes no sound.
  if (sc.type === "canvas") for (const [i, st] of (sc.props.path ?? []).entries()) {
    if (i === 0 || !((st.t ?? 0) > 0)) continue;
    if (st.cut) at(st.t, "cut"); else at(st.t - 0.05, (st.fly ?? 0.9) >= 1.3 ? "flyLong" : "fly");
  }
  for (const [i, sh] of (sc.shots ?? []).entries()) {
    if (i === 0 || sh.t <= 0) continue;
    if (sh.cut) at(sh.t, "cut");
    else if (Math.abs(sh.zoom - sc.shots[i - 1].zoom) >= 0.12) at(sh.t, "push");
  }
  for (const ov of sc.overlays ?? []) if (slamWord(ov)) at(ov.t, "slam");
  // A device taps, opens cards and turns pages; a match cut ticks on every still.
  if (sc.type === "device") for (const st of sc.props.steps ?? []) {
    if (st.tap) at(st.t, "tap");
    if (st.expand) at(st.t + (st.tap ? 0.25 : 0), "expand");
    else if (st.screen !== undefined && !st.tap) at(st.t, "page");
  }
  if (sc.type === "match-cut") for (const [i, it] of (sc.props.items ?? []).entries()) if (i) at(it.t, "still");
  if (sc.type === "footage") {
    let speed = 1;
    for (const r of sc.props.ramp ?? []) { if (speed < 1 && r.speed > 1.3) at((r.t ?? 0) - 0.15, "ramp"); speed = r.speed; }
    // The inserted UI turning a page or scrolling.
    for (const st of sc.props.screen?.steps ?? []) at(st.t, "page");
  }
  return out.sort((a, b) => a.at - b.at);
}

// The library variants of a sound category present on this host, else the category itself.
export function sfxVariants(cat, catalog) {
  const ids = catalog.entries.filter((e) => (e.kind ?? "sfx") === "sfx" && e.category === cat && entryAvailable(e)).map((e) => e.id).sort();
  return ids.length ? ids : [cat];
}
