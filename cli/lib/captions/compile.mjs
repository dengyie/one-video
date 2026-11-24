import { normalizeForMatch } from "../core/text.mjs";
import { placeCaptions } from "./layout.mjs";

export function sceneCaptions(scene, lines) {
  if (scene.captions !== undefined && scene.captions !== null) return scene.captions;
  const readAloud = scene.type === "quote" && typeof scene.props?.text === "string" && lines.length > 0
    && normalizeForMatch(scene.props.text) === normalizeForMatch(lines.map((l) => l.text).join(""));
  return !readAloud;
}

export function compileCaptions(scenes, config, { place = placeCaptions, ...layout }) {
  const items = scenes.flatMap((scene) => scene.lines.map((line) => ({
    scene: scene.id, text: line.text,
    start: Math.round((scene.from / layout.fps + line.start) * 1000) / 1000,
    end: Math.round((scene.from / layout.fps + line.end) * 1000) / 1000,
  })));
  place(scenes, items, layout);
  return { enabled: config?.enabled !== false, style: config?.style ?? "line", items };
}
