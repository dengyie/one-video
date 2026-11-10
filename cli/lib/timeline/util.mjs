// Small numeric helpers shared by the timeline passes.
export const clampT = (t, d) => Math.max(0, Math.min(d, t));
export const r3 = (x) => Math.round(x * 1000) / 1000;
