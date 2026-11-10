import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { clamp01, easeInOut, easeOut, lerp } from "../engine/motion";
import { ClipVideo, rampTime, seqSrc, type Ramp } from "../components/Media";
import { depthSrc, ForegroundCut, ParallaxCanvas, type Matte, type ParallaxMove } from "../components/Depth";

// Big title over footage. With `behind` and a depth map the subject is cut out and drawn again
// on top, so the title sits between the subject and the world behind it.
type Title = { text: string; t?: number; x?: number; y?: number; size?: number; color?: string; kicker?: string; behind?: boolean; matte?: Matte; style?: "rise" | "slam"; duration?: number };

const TitleText: React.FC<{ title: Title }> = ({ title }) => {
  const theme = useTheme();
  const { u, width, height } = useLayout();
  const t = useTime();
  const local = t - (title.t ?? 0.2);
  if (local < 0) return null;
  const gone = title.duration !== undefined ? clamp01((local - title.duration) / 0.3) : 0;
  if (gone >= 1) return null;
  const size = (title.size ?? 260) * u;
  const slam = title.style === "slam";
  const p = slam ? clamp01(local / 0.25) : easeOut(local / 0.7);
  const k = easeOut(clamp01((local - 0.25) / 0.5));
  return (
    <div style={{ position: "absolute", left: (title.x ?? 0.5) * width, top: (title.y ?? 0.42) * height, transform: "translate(-50%, -50%)", textAlign: "center", opacity: 1 - gone }}>
      {title.kicker && <div style={{ fontSize: size * 0.16, fontWeight: 700, letterSpacing: size * 0.04, whiteSpace: "nowrap", color: theme.colors.highlight, opacity: k, marginBottom: size * 0.04 }}>{title.kicker}</div>}
      <div style={{ overflow: slam ? "visible" : "hidden" }}>
        <div style={{
          fontSize: size, fontWeight: 900, lineHeight: 0.95, whiteSpace: "nowrap", letterSpacing: -0.03 * size, color: title.color ?? "#fff",
          transform: slam ? `scale(${lerp(1.5, 1, easeOut(p))})` : `translateY(${(1 - p) * 100}%)`, opacity: slam ? Math.min(1, p * 3) : 1,
          filter: slam && p < 1 ? `blur(${(1 - p) * 0.05 * size}px)` : undefined,
        }}>{title.text}</div>
      </div>
    </div>
  );
};

// ── footage ──────────────────────────────────────────────────────────────────
// Footage as the hero: full-bleed, light grade, speed ramps (slow-mo on the key moment, then
// back up to speed), optional title behind the subject. Punch-ins come from the scene's shots.

// A homography taking the unit square onto a quad (TL, TR, BR, BL in px), as a CSS matrix3d for an
// element of w×h with transform-origin 0 0 — how a flat capture lands on a screen filmed at an angle.
export function quadMatrix(q: [number, number][], w: number, h: number): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / det, k = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1].map((n) => +n.toFixed(9)).join(",")})`;
}

// Real UI on a phone/laptop filmed with a dark screen: the capture is pinned to the four screen
// corners (onevideo screen finds them), blended with "screen" so the glass keeps its reflections,
// and a finger or hand in front is drawn again on top — from a mask (white = in front) or the
// depth matte. Holds for a static device; a moving one needs tracked corners.
// `steps` move the UI on it: another capture slides in, or a tall one scrolls.
type ScreenStep = { t?: number; asset?: string; scroll?: number };
type ScreenInsert = { asset: string; corners: [number, number][]; t?: number; blend?: "screen" | "normal"; opacity?: number; occlude?: { asset?: string; matte?: Matte }; steps?: ScreenStep[] };

// What the inserted screen shows at t: the current capture (and the one it is replacing), and scroll.
function screenState(screen: ScreenInsert, t: number) {
  let cur = screen.asset, prev: string | undefined, switchAt = -Infinity, scroll = 0, scrollFrom = 0, scrollAt = -Infinity;
  for (const st of screen.steps ?? []) {
    if ((st.t ?? 0) > t) break;
    if (st.asset && st.asset !== cur) { prev = cur; cur = st.asset; switchAt = st.t ?? 0; scroll = scrollFrom = 0; }
    if (st.scroll !== undefined) { scrollFrom = scroll; scroll = st.scroll; scrollAt = st.t ?? 0; }
  }
  return { cur, prev, sw: easeInOut((t - switchAt) / 0.4), scroll: lerp(scrollFrom, scroll, easeInOut((t - scrollAt) / 0.8)) };
}

// Background revealed through vertical windows that open behind the subject (depth matte).
type Windows = { asset: string; count?: number; t?: number; stagger?: number; gap?: number; matte?: Matte };

export const FootageScene: React.FC<{ asset: string; startFrom?: number; ramp?: Ramp; dim?: number; title?: Title; tint?: string; screen?: ScreenInsert; windows?: Windows }> = ({
  asset, startFrom = 0, ramp, dim = 0.12, title, tint, screen, windows,
}) => {
  const tl = useTimeline();
  const { width, height } = useVideoConfig();
  const t = useTime();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const s = startFrom + rampTime(Math.max(0, t), ramp, tl.fps);
  const style: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  const photo = a.kind === "video" ? (a.seq ? seqSrc(a, s) : null) : staticFile(a.src);
  const depth = depthSrc(a, s);
  const local = t - (title?.t ?? 0.2);
  const cut = title?.behind && photo && depth && local >= 0 && (title.duration === undefined || local < title.duration + 0.3);
  const base = (extra: React.CSSProperties = {}) => (a.kind === "video" ? <ClipVideo a={a} style={{ ...style, ...extra }} time={s} /> : <Img src={staticFile(a.src)} style={{ ...style, ...extra }} />);
  const ins = screen && tl.assets[screen.asset];
  const insOn = screen ? easeOut((t - (screen.t ?? 0)) / 0.3) : 0;
  const mask = screen?.occlude?.asset ? tl.assets[screen.occlude.asset] : undefined;
  const win = windows && tl.assets[windows.asset];
  const n = windows?.count ?? 4, gap = windows?.gap ?? 0.02;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {base()}
      {ins && insOn > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, width, height, transformOrigin: "0 0", transform: quadMatrix(screen.corners.map(([x, y]) => [x * width, y * height]), width, height), mixBlendMode: (screen.blend ?? "screen") === "screen" ? "screen" : "normal", opacity: (screen.opacity ?? 1) * insOn }}>
          {(() => {
            const ss = screenState(screen, t);
            const page = (id: string, scroll: number) => {
              const p = tl.assets[id];
              if (!p) throw new Error(`asset "${id}" not in timeline.assets`);
              if (p.kind === "video") return <ClipVideo a={p} style={{ ...style, objectPosition: "top" }} time={Math.max(0, t - (screen.t ?? 0))} />;
              // A full-page capture is `pages` screens tall and slides up as it scrolls.
              const pages = Math.max(1, p.pages ?? 1);
              return <Img src={staticFile(p.src)} style={{ position: "absolute", left: 0, top: `${-scroll * (pages - 1) * 100}%`, width: "100%", height: `${pages * 100}%`, objectFit: "fill" }} />;
            };
            return (
              <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
                {ss.prev && ss.sw < 1 && <div style={{ position: "absolute", inset: 0, transform: `translateX(${-ss.sw * 30}%)`, opacity: 1 - ss.sw * 0.6 }}>{page(ss.prev, 0)}</div>}
                <div style={{ position: "absolute", inset: 0, overflow: "hidden", transform: ss.prev ? `translateX(${(1 - ss.sw) * 100}%)` : undefined }}>{page(ss.cur, ss.scroll)}</div>
              </div>
            );
          })()}
        </div>
      )}
      {ins && insOn > 0 && mask && base({ maskImage: `url(${staticFile(mask.src)})`, WebkitMaskImage: `url(${staticFile(mask.src)})`, maskMode: "luminance", maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } as React.CSSProperties)}
      {ins && insOn > 0 && !mask && screen.occlude?.matte && photo && depth && <ForegroundCut photo={photo} depth={depth} width={width} height={height} matte={screen.occlude.matte} />}
      {win && Array.from({ length: n }, (_, i) => {
        const o = easeInOut((t - (windows.t ?? 0.4) - i * (windows.stagger ?? 0.12)) / 0.6);
        if (o <= 0) return null;
        const cw = 100 / n, half = (cw * (1 - gap) * (1 - o)) / 2 + (cw * gap) / 2;
        return (
          <AbsoluteFill key={i} style={{ clipPath: `inset(0 ${100 - (i + 1) * cw + half}% 0 ${i * cw + half}%)` }}>
            {win.kind === "video" ? <ClipVideo a={win} style={style} time={Math.max(0, t)} /> : <Img src={staticFile(win.src)} style={{ ...style, transform: `scale(${lerp(1.15, 1.03, o)})` }} />}
          </AbsoluteFill>
        );
      })}
      {win && photo && depth && t > (windows.t ?? 0.4) && <ForegroundCut photo={photo} depth={depth} width={width} height={height} matte={windows.matte ?? { mode: "near" }} />}
      {tint && <AbsoluteFill style={{ background: tint, mixBlendMode: "soft-light" }} />}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.5}) 0%, rgba(0,0,0,${dim}) 55%, rgba(0,0,0,${Math.min(0.85, dim + 0.35)}) 100%)` }} />
      {title && <TitleText title={title} />}
      {cut && <ForegroundCut photo={photo} depth={depth} width={width} height={height} matte={title.matte} />}
    </AbsoluteFill>
  );
};

// ── parallax ─────────────────────────────────────────────────────────────────
// A still photo given 2.5D depth: near pixels travel further than far ones as the camera dollies,
// trucks or cranes. Uses the asset's depth map (onevideo depth), else a ground-plane gradient.

type Move = "dolly-in" | "dolly-out" | "truck-left" | "truck-right" | "crane-up" | "orbit";

export function parallaxMove(move: Move, k: number, amount: number, w: number, h: number): ParallaxMove {
  const e = easeInOut(k);
  switch (move) {
    case "dolly-out": return { dx: 0, dy: 0, zoom: 0.22 * amount * (1 - e), focus: 0.15 };
    case "truck-left": return { dx: (e - 0.5) * 0.07 * w * amount, dy: 0, zoom: 0.04 * amount, focus: 0.45 };
    case "truck-right": return { dx: (0.5 - e) * 0.07 * w * amount, dy: 0, zoom: 0.04 * amount, focus: 0.45 };
    case "crane-up": return { dx: 0, dy: (e - 0.5) * 0.06 * h * amount, zoom: 0.04 * amount, focus: 0.45 };
    case "orbit": return { dx: Math.sin((e - 0.5) * Math.PI) * 0.05 * w * amount, dy: 0, zoom: 0.08 * amount * e, focus: 0.4 };
    default: return { dx: 0, dy: 0, zoom: 0.22 * amount * e, focus: 0.15 };
  }
}

export const ParallaxScene: React.FC<{ asset: string; move?: Move; amount?: number; dim?: number; title?: Title }> = ({
  asset, move = "dolly-in", amount = 1, dim = 0.12, title,
}) => {
  const tl = useTimeline();
  const scene = useScene();
  const { width, height } = useVideoConfig();
  const t = useTime();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  if (a.kind !== "image") throw new Error(`parallax scene "${scene.id}" needs an image asset, got ${a.kind}`);
  // Quantize the move to 1/1000 so near-identical frames share a cached warp.
  const k = Math.round(clamp01((t + 0.3) / (scene.duration + 0.6)) * 1000) / 1000;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <ParallaxCanvas photo={staticFile(a.src)} depth={a.depth ? staticFile(a.depth) : null} width={width} height={height} move={parallaxMove(move, k, amount, width, height)} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.5}) 0%, rgba(0,0,0,${dim}) 55%, rgba(0,0,0,${Math.min(0.85, dim + 0.35)}) 100%)` }} />
      {title && <TitleText title={{ ...title, behind: false }} />}
    </AbsoluteFill>
  );
};
