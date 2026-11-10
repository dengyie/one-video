// Scene boundaries: which transition joins two scenes and how many frames it overlaps.
// Seconds each transition overlaps the two scenes it joins (half before the cut, half after).
export const TRANSITION_DURATION = { fade: 0.5, slide: 0.45, push: 0.5, whip: 0.32, zoom: 0.45, punch: 0.36, iris: 0.6, wipe: 0.5, clock: 0.6, dip: 0.7, through: 0.8, cut: 0 };
export const CAMERA_DEFAULT = { move: "drift", amount: 1 };

export const normTransition = (t) => (t == null ? null : typeof t === "string" ? { type: t } : t);

// The boundary between two scenes is one transition: the incoming scene's enter wins, then the
// outgoing scene's exit, then the style's default. Narration never moves; only visuals overlap.
export function boundaryTransition(prev, next, theme, fps) {
  // One device across several scenes stays put: the screen changes, the device never re-enters.
  const sameDevice = prev.type === "device" && next.type === "device" && (prev.props?.device ?? null) === (next.props?.device ?? null);
  const spec = normTransition(next.enter) ?? normTransition(prev.exit) ?? (sameDevice ? { type: "cut" } : null) ?? normTransition(theme.transition) ?? { type: "fade" };
  const want = Math.round((spec.duration ?? TRANSITION_DURATION[spec.type] ?? 0.5) * fps);
  // Never let a transition eat more than 40% of either scene.
  const frames = spec.type === "cut" ? 0 : Math.max(2, Math.min(want, Math.floor(prev.durationInFrames * 0.4), Math.floor(next.durationInFrames * 0.4)));
  const lead = Math.floor(frames / 2);
  return { type: spec.type, frames, lead, direction: spec.direction ?? "left", sfx: spec.sfx, ...(spec.focus ? { focus: spec.focus } : {}) };
}
