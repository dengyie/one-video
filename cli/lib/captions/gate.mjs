// Caption gate: every line fits the width captions are cut to.
import { visualLength } from "../core/text.mjs";
import { captionMaxChars, sceneLines } from "./lines.mjs";

const issue = (level, gate, msg) => ({ level, gate, msg });

export function captionGate(script, config) {
  const max = captionMaxChars(config);
  const out = [];
  for (const s of script.scenes) {
    for (const l of sceneLines(s, config)) {
      if (visualLength(l.text) > max + 0.5) out.push(issue("warn", "captions", `scene "${s.id}": line "${l.text}" is ${visualLength(l.text).toFixed(1)} wide (max ${max})`));
    }
  }
  return out;
}
