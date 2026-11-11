import React, { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, Sequence, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Lottie } from "@remotion/lottie";
import { evolvePath, getLength, getPointAtLength, getTangentAtLength } from "@remotion/paths";
import { colorAt, useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import type { Overlay } from "../engine/types";
import { Icon } from "./Icon";

// Overlay layer: motion graphics placed on top of any scene at a cue (compiled to `t`, seconds
// scene-relative, and `end`). Positions are fractions of the frame; sizes are layout units.
// They ride with the scene through transitions and its shot track, but ignore its slow camera drift.
// An overlay with `on` is pinned to a scene element instead (its `data-anchor` name), measured
// every frame, so it stays on the card or number it marks in any aspect, drift included, and
// fades out when that element leaves the frame.
const FADE = 0.3;

type Box = { x: number; y: number; w: number; h: number };
const Anchors = createContext<Record<string, Box>>({});

const sameBoxes = (a: Record<string, Box>, b: Record<string, Box>) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] && a[k].x === b[k].x && a[k].y === b[k].y && a[k].w === b[k].w && a[k].h === b[k].h);
};

export const Overlays: React.FC = () => {
  const scene = useScene();
  const t = useTime();
  const { width, height } = useLayout();
  const ref = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const names = [...new Set((scene.overlays ?? []).map((o) => o.on).filter(Boolean))] as string[];
  // Element boxes in frame px, relative to this layer (it shares the scene content's transform
  // parent); the state update lands before paint, so the frame renders with this frame's boxes.
  useLayoutEffect(() => {
    const me = ref.current, root = me?.parentElement;
    if (!me || !root || !names.length) return;
    const c = me.getBoundingClientRect();
    const k = c.width / width || 1;
    const r = (v: number) => Math.round(v * 10) / 10;
    const next: Record<string, Box> = {};
    for (const n of names) {
      const el = root.querySelector(`[data-anchor~="${CSS.escape(n)}"]`);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      next[n] = { x: r((b.left - c.left) / k), y: r((b.top - c.top) / k), w: r(b.width / k), h: r(b.height / k) };
    }
    setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
  });
  if (!scene.overlays?.length) return null;
  // A pinned overlay fades out with its element as it leaves the frame (a canvas card the camera
  // flew past). With the element gone it falls back to x/y/rect only if the storyboard gave them.
  const shown = (o: Overlay) => {
    if (!o.on) return 1;
    const b = boxes[o.on];
    if (!b) return o.x !== undefined || o.y !== undefined || o.rect ? 1 : 0;
    const iw = Math.min(b.x + b.w, width) - Math.max(b.x, 0), ih = Math.min(b.y + b.h, height) - Math.max(b.y, 0);
    return iw <= 0 || ih <= 0 ? 0 : clamp01(((iw * ih) / Math.max(1, b.w * b.h)) * 2);
  };
  return (
    <AbsoluteFill ref={ref} style={{ pointerEvents: "none" }}>
      <Anchors.Provider value={boxes}>
        {scene.overlays.map((o, i) => {
          if (t < o.t - 0.05 || t > o.end) return null;
          const vis = shown(o);
          if (vis <= 0) return null;
          const out = clamp01((o.end - t) / FADE);
          return <OverlayView key={i} o={o} i={i} local={t - o.t} out={(o.type === "flash" ? 1 : out) * vis} />;
        })}
      </Anchors.Provider>
    </AbsoluteFill>
  );
};

// The point of `place` on a box, moved by `off` (px), kept far enough inside the frame for a sticker centred on it.
function placeAt(b: Box, place: string, width: number, height: number, off: [number, number] = [0, 0]): [number, number] {
  const fx = place.includes("left") ? 0 : place.includes("right") ? 1 : 0.5;
  const fy = place.startsWith("top") ? 0 : place.startsWith("bottom") ? 1 : 0.5;
  const cl = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [cl(b.x + b.w * fx + off[0], width * 0.14, width * 0.86), cl(b.y + b.h * fy + off[1], height * 0.08, height * 0.92)];
}

const CORNER = new Set(["stamp", "icon", "lottie", "image"]);
const defaultPlace = (type: Overlay["type"]) => (CORNER.has(type) ? "top-right" : type === "callout" ? "right" : "center");

const OverlayView: React.FC<{ o: Overlay; i: number; local: number; out: number }> = ({ o, i, local, out }) => {
  const theme = useTheme();
  const { u, width, height } = useLayout();
  const color = o.color ?? (o.type === "mark" || o.type === "stamp" ? theme.colors.highlight : colorAt(theme, i));
  const box = useContext(Anchors)[o.on ?? ""];
  const [x, y] = box ? placeAt(box, o.place ?? defaultPlace(o.type), width, height, [(o.offset?.[0] ?? 0) * u, (o.offset?.[1] ?? 0) * u]) : [(o.x ?? 0.5) * width, (o.y ?? 0.5) * height];
  const size = (o.size ?? 160) * u;
  const at = (node: React.ReactNode, s = 1, extra: React.CSSProperties = {}) => (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${s})`, opacity: out, ...extra }}>{node}</div>
  );
  switch (o.type) {
    case "lottie": return <LottieView o={o} x={x} y={y} size={size} out={out} />;
    case "icon": {
      const p = easeOutBack(local / 0.45);
      const ring = (local % 1.4) / 1.4;
      return at(
        <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {o.ring !== false && <div style={{ position: "absolute", inset: -size * 0.35 * ring, borderRadius: "50%", border: `${3 * u}px solid ${color}`, opacity: (1 - ring) * 0.8 }} />}
          <div style={{ width: size, height: size, borderRadius: "50%", background: o.icon?.startsWith("flag:") ? "transparent" : color, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 ${10 * u}px ${36 * u}px rgba(0,0,0,0.35)` }}>
            {o.icon && <Icon name={o.icon} size={o.icon.startsWith("flag:") ? size : size * 0.56} color="#fff" />}
          </div>
          {o.label && <Tag text={o.label} style={{ position: "absolute", top: size + 14 * u, left: "50%", transform: "translateX(-50%)" }} />}
        </div>,
        Math.max(0, p),
      );
    }
    case "burst": return <Burst x={x} y={y} size={size} color={color} local={local} out={out} seed={`${i}`} count={o.count ?? 14} />;
    case "confetti": return <Confetti local={local} out={out} count={o.count ?? 90} seed={`c${i}`} origin={o.origin ?? "top"} x={x} y={y} />;
    case "arrow": return <Arrow o={o} color={color} local={local} out={out} to={box ? [x, y] : undefined} />;
    case "mark": return <Mark o={o} color={color} local={local} out={out} box={box} />;
    case "callout": return <Callout o={o} color={color} local={local} out={out} px={x} py={y} />;
    case "stamp": {
      const p = clamp01(local / 0.28);
      const s = lerp(2.2, 1, easeOut(p));
      const shake = local < 0.45 && local > 0.26 ? Math.sin(local * 90) * 6 * u * (0.45 - local) / 0.2 : 0;
      return at(
        <div style={{
          border: `${6 * u}px solid ${color}`, color, borderRadius: 12 * u, padding: `${10 * u}px ${30 * u}px`,
          fontSize: (o.size ?? 72) * u, fontWeight: 900, letterSpacing: 4 * u, whiteSpace: "nowrap", background: "rgba(0,0,0,0.25)",
          transform: `rotate(${o.rotate ?? -8}deg) translateX(${shake}px)`, textShadow: "none",
        }}>{o.text}</div>,
        s,
        { opacity: out * Math.min(1, p * 2.5) },
      );
    }
    case "lower-third": {
      const p = easeOut(local / 0.5);
      return (
        <div style={{ position: "absolute", left: (o.x ?? 0.06) * width, top: (o.y ?? 0.72) * height, opacity: out, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "stretch", transform: `translateX(${(p - 1) * 110}%)` }}>
            <div style={{ width: 10 * u, background: color, borderRadius: 4 * u }} />
            <div style={{ background: "rgba(6,10,24,0.78)", padding: `${14 * u}px ${28 * u}px`, borderRadius: `0 ${10 * u}px ${10 * u}px 0` }}>
              <div style={{ fontSize: 44 * u, fontWeight: 800, whiteSpace: "nowrap" }}>{o.text}</div>
              {o.subtitle && <div style={{ fontSize: 28 * u, color: theme.colors.muted, marginTop: 4 * u, whiteSpace: "nowrap", opacity: easeOut((local - 0.25) / 0.4) }}>{o.subtitle}</div>}
            </div>
          </div>
        </div>
      );
    }
    case "spotlight": {
      const p = easeInOut(local / 0.6);
      const r = lerp(Math.max(width, height), (o.size ?? 260) * u, p);
      return <AbsoluteFill style={{ opacity: out, background: `radial-gradient(circle ${r}px at ${x}px ${y}px, transparent 0, transparent ${r * 0.85}px, rgba(0,0,0,${0.7 * p}) ${r}px)` }} />;
    }
    case "flash": {
      const k = local < 0.06 ? local / 0.06 : 1 - (local - 0.06) / 0.35;
      return <AbsoluteFill style={{ background: o.color ?? "#fff", opacity: clamp01(k) * 0.85, mixBlendMode: "screen" }} />;
    }
    case "image": return <ImageSticker o={o} x={x} y={y} size={size} local={local} out={out} />;
    case "word": return <Word o={o} x={x} y={y} color={o.color ?? theme.colors.text} local={local} out={out} />;
    default: return null;
  }
};

const Tag: React.FC<{ text: string; style?: React.CSSProperties; color?: string }> = ({ text, style, color }) => {
  const theme = useTheme();
  const { u } = useLayout();
  return (
    <div style={{
      background: "rgba(6,10,24,0.8)", border: `1px solid ${color ?? theme.colors.border}`, borderRadius: 8 * u, padding: `${8 * u}px ${18 * u}px`,
      fontSize: 30 * u, fontWeight: 700, whiteSpace: "nowrap", color: theme.colors.text, ...style,
    }}>{text}</div>
  );
};

const LottieView: React.FC<{ o: Overlay; x: number; y: number; size: number; out: number }> = ({ o, x, y, size, out }) => {
  const data = useTimeline().lottie?.[o.src ?? ""];
  const scene = useScene();
  const { fps } = useVideoConfig();
  if (!data) return null;
  // Frames are relative to the scene's Sequence, which starts `lead` frames before the scene.
  const startFrame = (scene.transitionIn?.lead ?? 0) + Math.round(o.t * fps);
  const aspect = data.w && data.h ? data.w / data.h : 1;
  const w = aspect >= 1 ? size : size * aspect, h = aspect >= 1 ? size / aspect : size;
  return (
    <div style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, opacity: out }}>
      <Sequence from={startFrame} layout="none">
        <Lottie animationData={data} loop={o.loop ?? false} playbackRate={o.speed ?? 1} style={{ width: w, height: h }} />
      </Sequence>
    </div>
  );
};

const Burst: React.FC<{ x: number; y: number; size: number; color: string; local: number; out: number; seed: string; count: number }> = ({ x, y, size, color, local, out, seed, count }) => {
  const { u } = useLayout();
  const p = easeOut(local / 0.6);
  return (
    <svg style={{ position: "absolute", left: x - size * 1.5, top: y - size * 1.5, overflow: "visible", opacity: out * (1 - clamp01((local - 0.45) / 0.5)) }} width={size * 3} height={size * 3}>
      <g transform={`translate(${size * 1.5}, ${size * 1.5})`}>
        <circle r={size * 0.9 * p} fill="none" stroke={color} strokeWidth={4 * u * (1 - p)} />
        {Array.from({ length: count }, (_, k) => {
          const a = (k / count) * Math.PI * 2 + random(`${seed}a${k}`) * 0.3;
          const len = size * (0.25 + 0.35 * random(`${seed}l${k}`));
          const r0 = size * (0.25 + 0.85 * p), r1 = r0 + len * (1 - p * 0.7);
          return <line key={k} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1} stroke={k % 3 === 0 ? "#fff" : color} strokeWidth={(5 - 3 * p) * u} strokeLinecap="round" />;
        })}
      </g>
    </svg>
  );
};

const Confetti: React.FC<{ local: number; out: number; count: number; seed: string; origin: "top" | "point"; x: number; y: number }> = ({ local, out, count, seed, origin, x, y }) => {
  const theme = useTheme();
  const { u, width, height } = useLayout();
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {Array.from({ length: count }, (_, k) => {
        const r = (n: string) => random(`${seed}${n}${k}`);
        const delay = r("d") * (origin === "top" ? 0.8 : 0.1);
        const tt = Math.max(0, local - delay);
        let px: number, py: number;
        if (origin === "top") {
          px = r("x") * width + Math.sin(tt * (2 + r("w") * 3) + r("p") * 6) * 40 * u;
          py = -40 * u + tt * (260 + r("v") * 320) * u;
        } else {
          const a = -Math.PI / 2 + (r("a") - 0.5) * Math.PI * 1.1, v = (700 + r("v") * 900) * u;
          px = x + Math.cos(a) * v * tt;
          py = y + Math.sin(a) * v * tt + 0.5 * 1800 * u * tt * tt;
        }
        if (py > height + 40 * u) return null;
        const rot = tt * (300 + r("r") * 500) * (r("s") > 0.5 ? 1 : -1);
        const w = (10 + r("z") * 10) * u;
        return <div key={k} style={{ position: "absolute", left: px, top: py, width: w, height: w * 0.5, background: theme.palette[k % theme.palette.length], transform: `rotate(${rot}deg) scaleX(${Math.cos(tt * 8 + k)})`, opacity: tt > 0 ? 1 : 0 }} />;
      })}
    </AbsoluteFill>
  );
};

// Hand-drawn arrow from → to (frame fractions), bowed by `curve`, drawn over 0.6s then the head pops.
// Pinned (`on`), it points at the element instead of `to`.
const Arrow: React.FC<{ o: Overlay; color: string; local: number; out: number; to?: [number, number] }> = ({ o, color, local, out, to }) => {
  const { u, width, height } = useLayout();
  const [fx, fy] = o.from ?? [0.3, 0.3], [tx, ty] = o.to ?? [0.5, 0.5];
  const a = [fx * width, fy * height], b = to ?? [tx * width, ty * height];
  const bend = o.curve ?? 0.25;
  const c = [(a[0] + b[0]) / 2 - (b[1] - a[1]) * bend, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend];
  const d = `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`;
  const p = easeInOut(local / 0.6);
  const ev = evolvePath(p, d);
  const len = getLength(d);
  const tip = getPointAtLength(d, len * p) ?? { x: b[0], y: b[1] };
  const tan = getTangentAtLength(d, Math.max(0.01, len * p)) ?? { x: 1, y: 0 };
  const ang = Math.atan2(tan.y, tan.x), hs = 26 * u;
  const head = `M ${tip.x - Math.cos(ang - 0.5) * hs} ${tip.y - Math.sin(ang - 0.5) * hs} L ${tip.x} ${tip.y} L ${tip.x - Math.cos(ang + 0.5) * hs} ${tip.y - Math.sin(ang + 0.5) * hs}`;
  return (
    <>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: out, overflow: "visible", filter: `drop-shadow(0 ${3 * u}px ${6 * u}px rgba(0,0,0,0.5))` }}>
        <path d={d} fill="none" stroke={color} strokeWidth={7 * u} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
        {p > 0.02 && <path d={head} fill="none" stroke={color} strokeWidth={7 * u} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {o.label && <Tag text={o.label} color={color} style={{ position: "absolute", left: a[0], top: a[1], transform: `translate(-50%, ${a[1] < b[1] ? "-130%" : "30%"})`, opacity: out * easeOut(local / 0.3) }} />}
    </>
  );
};

// Hand-drawn mark around a rect [x, y, w, h] (frame fractions): an over-rotated ellipse, a
// double-stroked box, a wavy underline, a strike, or a marker highlight. Paths are seeded, so the
// same storyboard always draws the same wobble. Pinned (`on`), the rect is the element's box.
function markPaths(kind: string, x: number, y: number, w: number, h: number, seed: string, u: number): string[] {
  const j = (k: string, amt: number) => (random(`${seed}${k}`) - 0.5) * 2 * amt * u;
  if (kind === "circle") {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2 + 18 * u, ry = h / 2 + 14 * u, a0 = -2.2 + random(seed) * 0.4;
    const pts = Array.from({ length: 49 }, (_, i) => {
      const a = a0 + (i / 48) * Math.PI * 2 * 1.08, k = 1 + 0.04 * Math.sin(i * 0.7 + random(seed + "p") * 6) + (i / 48) * 0.05;
      return `${cx + Math.cos(a) * rx * k},${cy + Math.sin(a) * ry * k}`;
    });
    return [`M ${pts.join(" L ")}`];
  }
  if (kind === "box") {
    const p = 12 * u;
    const rect = (s2: string) => `M ${x - p + j(s2 + "a", 4)} ${y - p + j(s2 + "b", 4)} L ${x + w + p + j(s2 + "c", 4)} ${y - p + j(s2 + "d", 4)} L ${x + w + p + j(s2 + "e", 4)} ${y + h + p + j(s2 + "f", 4)} L ${x - p + j(s2 + "g", 4)} ${y + h + p + j(s2 + "h", 4)} Z`;
    return [rect("1"), rect("2")];
  }
  if (kind === "underline") {
    const yy = y + h + 8 * u, n = 8;
    return [`M ${Array.from({ length: n + 1 }, (_, i) => `${x + (w * i) / n},${yy + Math.sin(i * 1.3) * 4 * u + j("u" + i, 2)}`).join(" L ")}`];
  }
  if (kind === "strike") return [`M ${x - 6 * u} ${y + h * 0.55 + j("s1", 3)} L ${x + w + 6 * u} ${y + h * 0.45 + j("s2", 3)}`];
  return [];
}

const Mark: React.FC<{ o: Overlay; color: string; local: number; out: number; box?: Box }> = ({ o, color, local, out, box }) => {
  const scene = useScene();
  const { u, width, height } = useLayout();
  const [rx, ry, rw, rh] = o.rect ?? [0.4, 0.4, 0.2, 0.1];
  const [x, y, w, h] = box ? [box.x, box.y, box.w, box.h] : [rx * width, ry * height, rw * width, rh * height];
  const p = easeInOut(local / 0.6);
  const kind = o.kind ?? "circle";
  if (kind === "highlight") {
    return <div style={{ position: "absolute", left: x - 6 * u, top: y + h * 0.15, width: (w + 12 * u) * p, height: h * 0.75, background: color, opacity: out * 0.38, borderRadius: 6 * u, mixBlendMode: "screen", transform: "skewX(-6deg)" }} />;
  }
  const paths = markPaths(kind, x, y, w, h, box ? `${scene.id}${o.on}` : `${scene.id}${rx}${ry}`, u);
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: out, overflow: "visible" }}>
      {paths.map((d, k) => {
        // Multi-stroke marks draw one stroke after the other.
        const share = 1 / paths.length, pk = clamp01((p - k * share) / share);
        const ev = evolvePath(pk, d);
        return pk > 0 ? <path key={k} d={d} fill="none" stroke={color} strokeWidth={6 * u} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} opacity={k ? 0.7 : 1} /> : null;
      })}
    </svg>
  );
};

// Point marker with a leader line to a label box.
const Callout: React.FC<{ o: Overlay; color: string; local: number; out: number; px: number; py: number }> = ({ o, color, local, out, px, py }) => {
  const { u, width, height } = useLayout();
  const right = (o.side ?? (px < width * 0.6 ? "right" : "left")) === "right";
  const lx = px + (right ? 1 : -1) * 160 * u, ly = py - 110 * u;
  const dot = easeOutBack(local / 0.35);
  const line = easeInOut((local - 0.15) / 0.4);
  const tag = easeOut((local - 0.45) / 0.35);
  const ring = (local % 1.4) / 1.4;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: out }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <circle cx={px} cy={py} r={(10 + 30 * ring) * u} fill="none" stroke={color} strokeWidth={3 * u} opacity={1 - ring} />
        <circle cx={px} cy={py} r={10 * u * Math.max(0, dot)} fill={color} stroke="#fff" strokeWidth={3 * u} />
        <polyline points={`${px},${py} ${lerp(px, lx, line)},${lerp(py, ly, line)}`} fill="none" stroke={color} strokeWidth={3 * u} />
      </svg>
      {o.text && (
        <div style={{ position: "absolute", left: lx, top: ly, transform: `translate(${right ? "0" : "-100%"}, -50%) translateY(${(1 - tag) * 10 * u}px)`, opacity: tag }}>
          <Tag text={o.text} color={color} />
          {o.subtitle && <div style={{ fontSize: 24 * u, marginTop: 6 * u, textAlign: right ? "left" : "right", opacity: 0.85 }}>{o.subtitle}</div>}
        </div>
      )}
    </div>
  );
};

const ImageSticker: React.FC<{ o: Overlay; x: number; y: number; size: number; local: number; out: number }> = ({ o, x, y, size, local, out }) => {
  const a = useTimeline().assets[o.asset ?? ""];
  const { u } = useLayout();
  if (!a || a.kind !== "image") return null;
  const p = easeOutBack(local / 0.45);
  const round = o.shape !== "rounded";
  return (
    <div style={{ position: "absolute", left: x, top: y, width: size, height: size, transform: `translate(-50%, -50%) scale(${Math.max(0, p)}) rotate(${(1 - clamp01(p)) * -12}deg)`, opacity: out }}>
      <Img src={staticFile(a.src)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: round ? "50%" : 18 * u, border: `${5 * u}px solid #fff`, boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.45)` }} />
      {o.label && <Tag text={o.label} style={{ position: "absolute", top: size + 12 * u, left: "50%", transform: "translateX(-50%)" }} />}
    </div>
  );
};

// Whole-video finish: film grain, vignette and a slow light leak, above the scenes, under captions.
export const FilmLook: React.FC = () => {
  const look = useTimeline().look;
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  if (!look) return null;
  const t = frame / fps;
  const grain = look.grain ?? 0, vig = look.vignette ?? 0, leak = look.leak ?? 0;
  // Grain re-seeds every other frame (~15 fps): film-like, and cheaper than every frame.
  const seed = Math.floor(frame / 2) % 24;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {leak > 0 && (
        <AbsoluteFill style={{
          mixBlendMode: "screen", opacity: leak * (0.55 + 0.45 * Math.sin(t * 0.35)),
          background: `radial-gradient(ellipse 45% 60% at ${50 + 45 * Math.sin(t * 0.11)}% ${30 + 20 * Math.cos(t * 0.07)}%, rgba(255,150,60,0.35), transparent 70%), radial-gradient(ellipse 35% 45% at ${50 - 40 * Math.cos(t * 0.09)}% ${70 + 15 * Math.sin(t * 0.13)}%, rgba(255,60,120,0.22), transparent 70%)`,
        }} />
      )}
      {vig > 0 && <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 70% at 50% 50%, transparent 55%, rgba(0,0,0,${0.75 * vig}) 100%)` }} />}
      {grain > 0 && (
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: grain * 0.5, mixBlendMode: "overlay" }}>
          <filter id={`grain-${seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={2} seed={seed} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
        </svg>
      )}
    </AbsoluteFill>
  );
};

// Keyword pop: the word the narrator is saying, set huge for a beat. "slam" drops in from 1.6×
// with a blur that clears on impact, "rise" slides up out of a mask, "type" types it out.
// Rough perceived lightness (0–1) of #rrggbb.
const luma = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

const Word: React.FC<{ o: Overlay; x: number; y: number; color: string; local: number; out: number }> = ({ o, x, y, color, local, out }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const text = o.text ?? "";
  const size = (o.size ?? 150) * u;
  const style = o.style ?? "slam";
  const base: React.CSSProperties = { fontSize: size, fontWeight: 900, lineHeight: 1, whiteSpace: "nowrap", color, fontFamily: /^[\d$¥%+.,-]+$/.test(text) ? theme.fonts.number : undefined, letterSpacing: -0.02 * size };
  // Scrim (compiled from the background luma under the word): a soft dark pool behind light text,
  // a light one behind dark text, plus a matching glow on the glyphs.
  const k = o.scrim ?? 0;
  const dark = !/^#?[0-9a-f]{6}$/i.test(color) || luma(color) > 0.45;
  const tone = dark ? "0,0,0" : "255,255,255";
  if (k) base.textShadow = `0 0 ${0.08 * size}px rgba(${tone},${0.7 * k}), 0 ${0.02 * size}px ${0.04 * size}px rgba(${tone},${0.5 * k})`;
  const box = (node: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) rotate(${o.rotate ?? 0}deg)`, opacity: out, ...extra }}>
      {k > 0 && <div style={{ position: "absolute", inset: `${-0.35 * size}px ${-0.3 * size}px`, background: `radial-gradient(closest-side, rgba(${tone},${0.6 * k}), rgba(${tone},${0.25 * k}) 60%, transparent)` }} />}
      <div style={{ position: "relative" }}>{node}</div>
    </div>
  );
  if (style === "rise") {
    const p = easeOut(local / 0.4);
    return box(<div style={{ overflow: "hidden", padding: `0 ${0.05 * size}px` }}><div style={{ ...base, transform: `translateY(${(1 - p) * 110}%)` }}>{text}</div></div>);
  }
  if (style === "type") {
    const chars = Array.from(text);
    const n = Math.min(chars.length, Math.floor(local / 0.06) + 1);
    return box(<div style={base}>{chars.slice(0, n).join("")}<span style={{ opacity: Math.floor(local * 3) % 2 ? 0 : 0.8 }}>▍</span></div>);
  }
  const p = clamp01(local / 0.22);
  const s = lerp(1.6, 1, easeOut(p)) * (1 + 0.04 * Math.sin(clamp01((local - 0.22) / 0.25) * Math.PI));
  return box(<div style={{ ...base, transform: `scale(${s})`, filter: p < 1 ? `blur(${(1 - p) * 0.06 * size}px)` : undefined }}>{text}</div>, { opacity: out * Math.min(1, p * 3) });
};
