import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import type { Asset } from "../engine/types";

// 1-based index into a clip's frame sequence at source time `s` seconds (held at the last frame).
export const seqIndex = (a: Asset, s: number) => Math.min(a.frames ?? 1, Math.max(1, Math.floor(s * (a.fps ?? 30)) + 1));
export const seqSrc = (a: Asset, s: number) => staticFile(`${a.seq}/${String(seqIndex(a, s)).padStart(4, "0")}.jpg`);

// Speed ramp: source seconds played by scene time t, integrating speed keyframes ({ t, speed },
// eased over `blend` s between values) frame by frame so it is identical on every render.
export type Ramp = { t?: number; speed: number }[];
export function rampTime(t: number, ramp: Ramp | undefined, fps: number, blend = 0.3): number {
  if (!ramp?.length) return t;
  const speedAt = (x: number) => {
    let v = 1;
    for (const k of ramp) {
      const at = k.t ?? 0;
      if (x < at) break;
      const p = Math.min(1, (x - at) / blend);
      v = v + (k.speed - v) * (p * p * (3 - 2 * p));
    }
    return v;
  };
  const n = Math.round(t * fps);
  let s = 0;
  for (let i = 0; i < Math.abs(n); i++) s += speedAt((i + 0.5) / fps) / fps;
  return n < 0 ? -s : s;
}

// A video clip: its JPEG sequence frame by frame when extracted (light, deterministic), otherwise
// <OffthreadVideo>. Holds the last frame once the clip runs out. `startFrom` is in seconds;
// `time` (seconds into the clip) overrides the frame clock, e.g. for a speed ramp.
export const ClipVideo: React.FC<{ a: Asset; style: React.CSSProperties; startFrom?: number; muted?: boolean; time?: number }> = ({ a, style, startFrom = 0, muted = true, time }) => {
  const frame = useCurrentFrame();
  const tl = useTimeline();
  if (a.seq && a.frames) return <Img src={seqSrc(a, time ?? startFrom + frame / tl.fps)} style={style} />;
  return <OffthreadVideo src={staticFile(a.src)} style={style} muted={muted} startFrom={Math.round(startFrom * tl.fps)} />;
};

export type Motion = "in" | "out" | "left" | "right" | "up" | "none";

// Full-bleed image/video with a slow Ken Burns move over the scene length.
export const MediaFill: React.FC<{ asset: string; motion?: Motion; fit?: "cover" | "contain"; dim?: number; blur?: number; startFrom?: number; muted?: boolean }> = ({
  asset, motion = "in", fit = "cover", dim = 0.35, blur = 0, startFrom = 0, muted = true,
}) => {
  const tl = useTimeline();
  const scene = useScene();
  const theme = useTheme();
  const t = useTime();
  const { u } = useLayout();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const p = Math.max(0, Math.min(1, t / Math.max(1, scene.duration)));
  const z = 0.05; // 5% travel over the scene (references/motion-rules.md: 3–6%)
  const tf =
    motion === "in" ? `scale(${1 + z * p})` :
    motion === "out" ? `scale(${1 + z * (1 - p)})` :
    motion === "left" ? `scale(${1 + z}) translateX(${(0.5 - p) * z * 50}%)` :
    motion === "right" ? `scale(${1 + z}) translateX(${(p - 0.5) * z * 50}%)` :
    motion === "up" ? `scale(${1 + z}) translateY(${(0.5 - p) * z * 50}%)` : "none";
  // A blurred backdrop is scaled a little more so the soft edge never shows.
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit, transform: blur > 0 ? `${tf === "none" ? "" : tf} scale(1.06)` : tf, filter: blur > 0 ? `blur(${blur * u}px)` : undefined };
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg, overflow: "hidden" }}>
      {a.kind === "video"
        ? <ClipVideo a={a} style={style} startFrom={startFrom} muted={muted} />
        : <Img src={staticFile(a.src)} style={style} />}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.6}) 0%, rgba(0,0,0,${dim}) 60%, rgba(0,0,0,${Math.min(0.9, dim + 0.3)}) 100%)` }} />
    </AbsoluteFill>
  );
};

export const Credit: React.FC<{ asset: string; corner?: "top-left" | "bottom-right" }> = ({ asset, corner = "top-left" }) => {
  const tl = useTimeline();
  const { u, pad, portrait } = useLayout();
  const c = tl.assets[asset]?.credit;
  if (!c) return null;
  // bottom-right sits under the caption band, clear of the header and the watermark.
  const place: React.CSSProperties = corner === "bottom-right"
    ? { right: pad, bottom: (portrait ? 40 : 12) * u, fontSize: 14 * u, textAlign: "right" }
    : { left: pad, top: (portrait ? 64 : 24) * u, fontSize: 16 * u };
  return (
    <div data-probe="skip" style={{ position: "absolute", ...place, color: "rgba(255,255,255,0.6)", textShadow: "0 1px 3px rgba(0,0,0,0.8)", maxWidth: "60%" }}>
      {c}
    </div>
  );
};
