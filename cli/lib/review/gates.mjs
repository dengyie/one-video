// Pre-compose gates: catch structural, factual and pacing problems before spending a render.
// One import point for the gate families, each in its own module:
//   issue.mjs         the finding record, defaults, summarize
//   gates-plan.mjs    on the written plan: schema, numbers, storyboard, timings, rate, assets, budget
//   gates-pacing.mjs  on the compiled timeline: opening, rhythm, device holds, question, echo
//   gates-layout.mjs  on the compiled timeline: layout (map-model.mjs for maps), fitOverlays, density
export { normalizeLicense } from "../core/license.mjs";
export { captionGate } from "../captions/gate.mjs";
export { screenEvents } from "../timeline/index.mjs";
export { GATE_DEFAULTS, STATIC_TYPES, summarize } from "./issue.mjs";
export { schemaGate, numbersGate, storyboardGate, timingsGate, rateGate, assetsGate, budgetGate, SYLLABLES_PER_SEC } from "./gates-plan.mjs";
export { openingGate, rhythmGate, DEVICE_HOLD, deviceGate, questionGate, echoGate } from "./gates-pacing.mjs";
export { LAYOUT_DEFAULTS, layoutGate, fitOverlays, DENSITY_DEFAULTS, densityGate } from "./gates-layout.mjs";
export { mapBoxes } from "./map-model.mjs";
