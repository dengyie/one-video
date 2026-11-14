// Where the screen is in footage of a device filmed switched off (or showing black): the largest
// dark region that does not run off the frame, and its four corners, for footage.props.screen.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ffmpeg, ffprobe } from "../core/ffmpeg.mjs";

// rgb: packed RGB24, w×h. → { corners: [TL, TR, BR, BL] in 0–1, share (of the frame), border } or null.
export function findScreen(rgb, w, h, { threshold = 40, minShare = 0.01 } = {}) {
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2] < threshold ? 1 : 0;
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = null;
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || label[start] >= 0) continue;
    let n = 0, top = 0, border = false;
    let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity];
    stack[top++] = start;
    label[start] = start;
    while (top) {
      const p = stack[--top], x = p % w, y = (p - x) / w;
      n++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const s = x + y, d = x - y;
      if (s < tl[2]) tl = [x, y, s];
      if (s > br[2]) br = [x, y, s];
      if (d > tr[2]) tr = [x, y, d];
      if (d < bl[2]) bl = [x, y, d];
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && dark[q] && label[q] < 0) { label[q] = start; stack[top++] = q; }
      }
    }
    // A dark background touches the frame edge; the screen usually does not.
    const score = n * (border ? 0.15 : 1);
    if (n / (w * h) >= minShare && (!best || score > best.score)) best = { score, n, border, pts: [tl, tr, br, bl] };
  }
  if (!best) return null;
  const r = (v) => Math.round(v * 1000) / 1000;
  return { corners: best.pts.map(([x, y]) => [r((x + 0.5) / w), r((y + 0.5) / h)]), share: r(best.n / (w * h)), border: best.border };
}

// One frame of an image or video (at t seconds), scaled to `width`, as packed RGB.
export async function frameRgb(file, { t = 0, width = 480 } = {}) {
  const v = (await ffprobe(file)).streams.find((s) => s.codec_type === "video");
  const h = Math.max(2, Math.round((width * v.height) / v.width / 2) * 2);
  const tmp = mkdtempSync(join(tmpdir(), "ov-screen-"));
  const out = join(tmp, "f.rgb");
  try {
    await ffmpeg(["-y", "-v", "error", ...(t ? ["-ss", String(t)] : []), "-i", resolve(file), "-frames:v", "1", "-vf", `scale=${width}:${h}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2", "-update", "1", out]);
    return { rgb: readFileSync(out), w: width, h };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
