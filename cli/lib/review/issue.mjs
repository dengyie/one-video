// Gate findings: the issue record every gate returns, its defaults and the error/warning split.
import { MAX_STILL } from "../timeline/index.mjs";

export const STATIC_TYPES = new Set(["quote", "bullets", "title", "chapter", "sources"]);
export const GATE_DEFAULTS = { staticRatioMax: 0.4, maxSameTypeRun: 2, longSceneNoCue: 25, syllablesPerSec: [3.5, 6.2], maxStill: MAX_STILL, maxSameTransitionRun: 2, echoMinChars: 8, hookReveal: 2.5 };

// `at` places a timeline finding: { scene, from, to } in timeline seconds (look matches its notes to it),
// and `field`, the storyboard field of that scene to change ("overlays[2]", "shots", "cues"), when one does.
// `fix` is a change `onevideo fix` can make for you: { scene, path: ["overlays", 2], set: { y } } merges into
// that storyboard object, { scene, path: ["cues", "quit"], value } replaces it.
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const issue = (level, gate, msg, at, fix) => ({ level, gate, msg, ...(at && { at: { scene: at.scene, from: r3(at.from), to: r3(at.to), ...(at.field && { field: at.field }) } }), ...(fix && { fix }) });

export function summarize(issues) {
  return { errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warn") };
}
