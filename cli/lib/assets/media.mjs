// Media files of a fetched asset: the cut clip, its JPEG frame sequence, depth and luma maps.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ffmpeg, ffprobe } from "../core/ffmpeg.mjs";

export const CLIP_MAX = 20;

// A downloaded video becomes a short, silent, ≤1080p H.264 clip: `clip: [start, seconds]`
// picks the window (default the first CLIP_MAX seconds). Returns the clip's dimensions.
export async function cutClip(src, dest, clip) {
  const [start, seconds] = Array.isArray(clip) ? [clip[0] ?? 0, clip[1] ?? CLIP_MAX] : [0, CLIP_MAX];
  await ffmpeg(["-y", "-ss", String(start), "-i", src, "-t", String(Math.min(seconds, 60)), "-an",
    "-vf", "scale=min(1920\\,iw):-2:flags=lanczos", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest]);
  const v = (await ffprobe(dest)).streams.find((x) => x.codec_type === "video");
  if (!v) throw new Error(`clip ${dest} has no video stream (start ${start}s past the end?)`);
  return { width: v.width, height: v.height, duration: +(+v.duration || seconds).toFixed(2) };
}

// Clips render from a JPEG sequence next to the mp4 (assets/<id>.frames/0001.jpg…): <Img> per frame
// is deterministic and light, where <OffthreadVideo>'s frame cache shrinks with free memory and on
// a 2 GB render node evicts frames as soon as they are decoded ("No frame found at position").
export const framesDir = (file) => file.replace(/\.mp4$/i, ".frames");
// Depth map made by `onevideo depth`: one PNG for an image, a PNG sequence dir for a video.
export const depthPath = (a) => (a.kind === "video" ? a.file.replace(/\.mp4$/i, ".depth") : a.file.replace(/\.[a-z0-9]+$/i, ".depth.png"));
// Coarse luma grid written alongside it, for text legibility (see cli/py/luma.py).
export const lumaPath = (a) => a.file.replace(/\.[a-z0-9]+$/i, ".luma.json");
export const countFrames = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}\.jpg$/.test(f)).length : 0);

export async function clipFrames(mp4, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await ffmpeg(["-y", "-i", mp4, "-an", "-q:v", "4", "-start_number", "1", join(dir, "%04d.jpg")]);
  const n = countFrames(dir);
  if (!n) throw new Error(`no frames extracted from ${mp4}`);
  return n;
}

export const assetFileExists = (publicDir, item) => Boolean(item.file) && existsSync(join(publicDir, item.file));

// Frames between depth maps of a clip: every 2nd only where a footage title is cut out behind the
// subject; dives, word dodging and scrims sample a few moments, so every 8th does.
export function depthStep(storyboard, id) {
  if (!storyboard) return 2;
  return storyboard.scenes.some((s) => s.type === "footage" && s.props?.asset === id && s.props?.title?.behind) ? 2 : 8;
}
