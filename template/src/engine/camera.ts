// Shot track camera. The model lives in shared/camera.mjs, so the CLI's gates frame exactly what
// this renders; here it is typed for the engine's compiled shots.
export { WIDE, clampView, viewAt, cameraMoving, seenSpan, seenBox, farther, viewTransform, viewVelocity, cutBetween, captionBand } from "../../../shared/camera.mjs";
export type { View } from "../../../shared/camera.mjs";
