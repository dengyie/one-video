// The same cut in another frame (--aspect 9:16 for a vertical feed, 1:1, 4:5): layouts are in units
// of the short edge, so the plan compiles as is into its own timeline and renders beside the main
// cut (out/<name>.9x16.mp4) without touching its versions. This is the project seen through that
// frame. Its compiled timeline, caption timings and scene audio get their own files (tagged
// timeline.9x16.json, timings.9x16.json, public/audio/9x16/); the plan stays shared. `main` keeps
// the project's own config and timings path, which the variant's caption timings derive from.
import { UserError } from "../core/project.mjs";
import { DIMENSIONS } from "./compile.mjs";

export const aspectTag = (aspect) => String(aspect).replace(":", "x");

export function withAspect(project, aspect) {
  if (!aspect || aspect === true) return project;
  if (!DIMENSIONS[aspect]) throw new UserError(`--aspect "${aspect}": one of ${Object.keys(DIMENSIONS).join(", ")}`);
  if (aspect === (project.config.aspect ?? "16:9") && !project.config.width) return project;
  const { width: _w, height: _h, ...config } = project.config;
  const tag = aspectTag(aspect);
  return {
    ...project, config: { ...config, aspect }, aspect,
    main: { config: project.config, timings: project.paths.timings },
    paths: { ...project.paths, timeline: project.p("plan", `timeline.${tag}.json`), timings: project.p("plan", `timings.${tag}.json`), audioDir: project.p("public", "audio", tag), audioRel: `audio/${tag}` },
  };
}
