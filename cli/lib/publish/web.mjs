// Web renditions of the published cut for the player site: a ladder of H.264/AAC MP4s at capped
// bitrates, so a viewer on a slow link gets a tier that plays without stalling. Each has a 2 s
// keyframe interval (a seek fetches at most 2 s of video before it shows; renders out of Remotion
// carry one every ~8 s) and its index at the front (+faststart: playback starts after the first
// bytes). They go into out/publish/, which `onevideo archive` uploads with the rest of the kit;
// plan/publish.json lists them and web/catalog.mjs puts them in videos.json.
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Highest first. `vmax`: peak video bitrate (CRF below it, so quiet scenes take far less); the
// total with audio is about vmax + ab, the throughput a viewer needs for the tier.
export const WEB_LADDER = [
  { q: "1080p", height: 1080, crf: 23, vmax: 2400, ab: 128 },
  { q: "720p", height: 720, crf: 24, vmax: 1100, ab: 96 },
  { q: "480p", height: 480, crf: 26, vmax: 420, ab: 64 },
];

// The tiers for a cut `height` px tall: none above the source (no upscaling); a source between two
// tiers still gets the tier just below it.
export function ladderFor(height) {
  return WEB_LADDER.filter((r) => r.height <= height);
}

export const webFile = (q) => `web-${q}.mp4`;

// ffmpeg arguments for one tier. `fps`: the cut's frame rate (the keyframe interval is 2 s of it).
export function webArgs(src, dst, r, fps = 30) {
  const gop = Math.max(1, Math.round(fps * 2));
  return [
    "-v", "error", "-y", "-i", src,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `scale=-2:${r.height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-profile:v", r.height > 720 ? "high" : "main",
    "-crf", String(r.crf), "-maxrate", `${r.vmax}k`, "-bufsize", `${r.vmax * 2}k`,
    "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", `${r.ab}k`, "-ac", "2",
    "-movflags", "+faststart",
    dst,
  ];
}

// Encode the tiers that are missing or older than the cut; returns publish.json's `renditions`
// (highest first). `probe(file)` → ffprobe JSON, `encode(args)` runs ffmpeg (injected for tests).
export async function webRenditions({ root, main, dir, probe, encode, log = () => {} }) {
  const info = await probe(main);
  const v = info.streams?.find((s) => s.codec_type === "video");
  if (!v?.height) throw new Error(`no video stream in ${relative(root, main)}`);
  const [n, d = 1] = String(v.avg_frame_rate || v.r_frame_rate || "30/1").split("/").map(Number);
  const fps = n && d ? n / d : 30;
  const src = statSync(main).mtimeMs;
  const out = [];
  for (const r of ladderFor(v.height)) {
    const file = join(dir, webFile(r.q));
    if (!existsSync(file) || statSync(file).mtimeMs < src) {
      const part = `${file}.part.mp4`;
      try {
        await encode(webArgs(main, part, r, fps));
        renameSync(part, file);
      } finally { rmSync(part, { force: true }); }
      log(`web ${r.q} → ${relative(root, file)} (${(statSync(file).size / 2 ** 20).toFixed(1)} MiB)`);
    }
    out.push({ q: r.q, height: r.height, kbps: r.vmax + r.ab, file: relative(root, file) });
  }
  return out;
}
