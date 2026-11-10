// Quality check of a generated clip: the take as a contact sheet, read by a vision model.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffprobe } from "../core/ffmpeg.mjs";
import { ask, imagePart } from "../llm/client.mjs";
import { inspectClipPrompt } from "../prompts/index.mjs";
import { cellTime, writeSheets } from "../vision/sheet.mjs";

// Generated clips go wrong mid-shot (a person cloned, a face melting, a hand growing fingers) even
// when the first frame looks fine, so the whole take is read as a contact sheet and only its
// longest clean stretch is kept (capped at generate.keep seconds when set). An explicit `clip`
// or generate.inspect: false skips this.
export async function inspectClip(file, { prompt, brief, keep, llm = {} }) {
  const tmp = mkdtempSync(join(tmpdir(), "ov-inspect-"));
  try {
    const dur = +(await ffprobe(file)).format.duration;
    const { sheets: [s] } = await writeSheets(file, tmp, { fps: Math.min(2, 24 / Math.max(dur, 1)), cols: 6, width: 320, per: 24 });
    const { data, model } = await ask({
      prompt: inspectClipPrompt({ cells: s.cells, t0: cellTime(s, 0), step: +s.step.toFixed(3), prompt, brief }),
      images: [imagePart(s.file)], json: true, maxTokens: 2000, config: { llm },
    });
    const at = (i) => Math.max(0, Math.min(s.cells - 1, Math.round(Number(i))));
    const issues = (Array.isArray(data.issues) ? data.issues : []).map((x) => ({ t: cellTime(s, at(x.cell ?? 0)), issue: String(x.issue ?? "") }));
    let clip = null;
    if (data.best && Number.isFinite(Number(data.best.from)) && Number.isFinite(Number(data.best.to))) {
      const a = at(data.best.from), b = Math.max(a, at(data.best.to));
      const start = +(s.t0 + a * s.step).toFixed(2), end = Math.min(dur, s.t0 + (b + 1) * s.step);
      const len = +Math.min(end - start, keep ?? Infinity).toFixed(2);
      if (len >= 1) clip = [start, len];
    }
    return { model, score: Number(data.score) || null, issues, clip };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
