import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { revealAt, useLayout, usePace, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import type { Scene } from "../engine/types";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import { ClipVideo } from "../components/Media";

// ── device ───────────────────────────────────────────────────────────────────
// A product demo on one device that never leaves the frame: real UI captures (onevideo capture)
// play on its screen, taps ripple where the finger lands, a card grows out of the exact spot it
// sits on the page and folds back, and the camera relays between three framings — the whole
// device, the part of the page being touched, and the result up close — holding on the result
// long enough to read it. Screen coordinates are 0–1 of the visible screen.

type Rect = [number, number, number, number];
type Kind = "phone" | "browser" | "laptop";
type Level = "device" | "page" | "result";
type Screen = { id?: string; asset: string };
type Step = {
  t?: number; cue?: string; screen?: number | string; scroll?: number; tap?: [number, number];
  expand?: { rect: Rect; asset?: string; to?: Rect }; collapse?: boolean;
  camera?: Level; focus?: Rect; label?: string;
};
type Box = { x: number; y: number; w: number; h: number };

// Where the device and its screen sit in the frame (px). Phones are 390×844 captures, browsers and
// laptops 1440×900, so a capture fills the screen edge to edge.
export function deviceLayout(kind: Kind, width: number, height: number, u: number): { body: Box; screen: Box; radius: number } {
  const portrait = height > width;
  const cy = portrait ? 0.45 * height : 0.5 * height;
  if (kind === "phone") {
    let sh = (portrait ? 0.62 : 0.8) * height, sw = sh * (390 / 844);
    if (sw > 0.8 * width) { sw = 0.8 * width; sh = sw * (844 / 390); }
    const bz = 0.035 * sw;
    const screen = { x: (width - sw) / 2, y: cy - sh / 2, w: sw, h: sh };
    return { screen, body: { x: screen.x - bz, y: screen.y - bz, w: sw + 2 * bz, h: sh + 2 * bz }, radius: 0.13 * sw };
  }
  const bar = kind === "browser" ? 46 * u : 0;
  let sw = (portrait ? 0.92 : kind === "laptop" ? 0.68 : 0.78) * width, sh = sw / 1.6;
  const maxH = (portrait ? 0.6 : 0.78) * height - bar;
  if (sh > maxH) { sh = maxH; sw = sh * 1.6; }
  const bz = kind === "laptop" ? 0.022 * sw : 0;
  const top = cy - (sh + bar) / 2 - (kind === "laptop" ? 0.03 * sw : 0);
  const screen = { x: (width - sw) / 2, y: top + bar + bz, w: sw, h: sh };
  return { screen, body: { x: screen.x - bz, y: top, w: sw + 2 * bz, h: sh + bar + 2 * bz }, radius: kind === "browser" ? 14 * u : 18 * u };
}

const inScreen = (s: Box, r: Rect): Box => ({ x: s.x + r[0] * s.w, y: s.y + r[1] * s.h, w: r[2] * s.w, h: r[3] * s.h });

// The capture on the screen; `scroll` 0–1 slides a full-page capture from its top to its bottom.
const Page: React.FC<{ asset: string; w: number; h: number; scroll?: number }> = ({ asset, w, h, scroll = 0 }) => {
  const tl = useTimeline();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const style: React.CSSProperties = { position: "absolute", left: 0, width: "100%", top: `${scroll * 100}%`, transform: `translateY(${-scroll * 100}%)`, display: "block" };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "#fff" }}>
      {a.kind === "video" ? <ClipVideo a={a} style={{ ...style, height: "100%", objectFit: "cover", objectPosition: "top" }} /> : <Img src={staticFile(a.src)} style={style} />}
    </div>
  );
};

// Where an expanded card lands: its `to` rect, else centred on the screen as large as fits.
function cardTarget(s: Box, from: Box, to?: Rect): Box {
  if (to) return inScreen(s, to);
  const k = Math.min((0.9 * s.w) / from.w, (0.72 * s.h) / from.h);
  const w = from.w * k, h = from.h * k;
  return { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h };
}

type View = { x: number; y: number; z: number };
type Card = { i: number; open: number; close: number; from: Box; to: Box; asset?: string; rect: Rect };

const stepTimes = (scene: Scene, pace: number, steps: Step[]) => steps.map((st, i) => st.t ?? revealAt(scene, pace, i, steps.length));
const screenIndex = (screens: Screen[], s: number | string | undefined) => (typeof s === "number" ? s : Math.max(0, screens.findIndex((x) => x.id === s)));

// Cards: each expand grows from its rect after the tap that opens it and folds back at the next
// collapse (or the next page switch).
function deviceCards(steps: Step[], times: number[], screens: Screen[], screen: Box): Card[] {
  const idx = (s: number | string | undefined) => screenIndex(screens, s);
  return steps.flatMap((st, i) => {
    if (!st.expand) return [];
    const open = times[i] + (st.tap ? 0.25 : 0);
    const j = steps.findIndex((x, k) => k > i && (x.collapse || (x.screen !== undefined && idx(x.screen) !== idx(steps.slice(0, i + 1).reverse().find((y) => y.screen !== undefined)?.screen ?? 0))));
    const close = j >= 0 ? times[j] : Infinity;
    const from = inScreen(screen, st.expand.rect);
    return [{ i, open, close, from, to: cardTarget(screen, from, st.expand.to), asset: st.expand.asset, rect: st.expand.rect }];
  });
}

// Camera relay: keys at each step, eased one into the next, from `from` (the whole device unless
// the scene continues another). A key due before the scene starts begins at 0 instead of joining
// halfway, so the first frame never jumps.
function deviceCamera({ steps, times, cards, screen, kind, zoom, width, height, portrait, t, from }: {
  steps: Step[]; times: number[]; cards: Card[]; screen: Box; kind: Kind; zoom?: number; width: number; height: number; portrait: boolean; t: number; from?: View;
}): View {
  const levelView = (level: Level, i: number): View => {
    const st = steps[i];
    if (level === "device") return { x: width / 2, y: height / 2, z: 1 };
    if (level === "page") {
      const p = st.tap ? { x: screen.x + st.tap[0] * screen.w, y: screen.y + st.tap[1] * screen.h } : st.focus ? (() => { const b = inScreen(screen, st.focus!); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; })() : { x: width / 2, y: height / 2 };
      return { ...p, z: zoom ?? (kind === "phone" ? (portrait ? 1.45 : 1.25) : 1.9) };
    }
    const card = cards.find((c) => c.i === i);
    const b = card ? card.to : st.focus ? inScreen(screen, st.focus) : screen;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2, z: Math.min(3, (0.78 * width) / b.w, (0.7 * height) / b.h) };
  };
  const keys: { t: number; v: View; dur: number }[] = [];
  steps.forEach((st, i) => {
    const at = times[i];
    if (st.camera) { keys.push({ t: at, v: levelView(st.camera, i), dur: 0.6 }); return; }
    if (st.tap) keys.push({ t: at - 0.6, v: levelView("page", i), dur: 0.55 });
    if (st.expand) keys.push({ t: at + (st.tap ? 0.3 : 0), v: levelView("result", i), dur: 0.6 });
    else if (st.collapse) keys.push({ t: at, v: levelView("device", i), dur: 0.6 });
    else if (st.screen !== undefined && !st.tap) keys.push({ t: at + 0.2, v: st.focus ? levelView("result", i) : levelView("device", i), dur: 0.6 });
  });
  keys.sort((a, b) => a.t - b.t);
  let v: View = from ?? { x: width / 2, y: height / 2, z: 1 };
  for (const k of keys) {
    const p = easeInOut((t - Math.max(0, k.t)) / k.dur);
    if (p <= 0) break;
    v = { x: lerp(v.x, k.v.x, p), y: lerp(v.y, k.v.y, p), z: lerp(v.z, k.v.z, p) };
  }
  return v;
}

export const DeviceScene: React.FC<{ device?: Kind; screens: Screen[]; steps?: Step[]; url?: string; zoom?: number; color?: string; caption?: string }> = ({
  device, screens, steps = [], url, zoom, color, caption,
}) => {
  const theme = useTheme();
  const tl = useTimeline();
  const scene = useScene();
  const { u, width, height, portrait, pad } = useLayout();
  const pace = usePace();
  const t = useTime();
  const kind: Kind = device ?? (portrait ? "phone" : "browser");
  const { body, screen, radius } = deviceLayout(kind, width, height, u);
  const idx = (s: number | string | undefined) => screenIndex(screens, s);
  const times = stepTimes(scene, pace, steps);

  // The device arrives once; a device scene after another one picks up where it left off, the
  // camera too: it starts from wherever the previous scene's camera ended.
  const i0 = tl.scenes.findIndex((s) => s.id === scene.id);
  const before = tl.scenes[i0 - 1];
  const continued = before?.type === "device" && (before.props.device ?? (portrait ? "phone" : "browser")) === kind;
  let startView: View | undefined;
  if (continued) {
    const bs = (before.props.steps ?? []) as Step[], bt = stepTimes(before, pace, bs);
    const bcards = deviceCards(bs, bt, (before.props.screens ?? []) as Screen[], screen);
    startView = deviceCamera({ steps: bs, times: bt, cards: bcards, screen, kind, zoom: before.props.zoom, width, height, portrait, t: before.duration });
  }

  // Screen history and the scroll of each: a step with `screen` switches page, `scroll` moves it.
  let cur = 0, prev = -1, switchAt = -Infinity, scroll = 0, scrollFrom = 0, scrollAt = -Infinity;
  steps.forEach((st, i) => {
    if (times[i] > t) return;
    if (st.screen !== undefined && idx(st.screen) !== cur) { prev = cur; cur = idx(st.screen); switchAt = times[i]; scroll = scrollFrom = 0; }
    if (st.scroll !== undefined) { scrollFrom = scroll; scroll = st.scroll; scrollAt = times[i]; }
  });
  const sw = easeInOut((t - switchAt) / 0.4);
  const scrollNow = lerp(scrollFrom, scroll, easeInOut((t - scrollAt) / 0.8));

  const cards = deviceCards(steps, times, screens, screen);

  const v = deviceCamera({ steps, times, cards, screen, kind, zoom, width, height, portrait, t, from: startView });
  // Keep the view inside the frame.
  const hx = width / 2 / v.z, hy = height / 2 / v.z;
  const cx = Math.min(width - hx, Math.max(hx, v.x)), cy = Math.min(height - hy, Math.max(hy, v.y));
  const camera = `translate(${width / 2 - cx * v.z}px, ${height / 2 - cy * v.z}px) scale(${v.z})`;

  const enter = continued ? 1 : easeOut((t + 0.1) / 0.7);
  const bezel = color ?? "#111318";
  const activeLabel = steps.map((st, i) => ({ st, at: times[i] })).filter((x) => x.st.label && x.at <= t + 0.2).at(-1);
  const labelEnd = activeLabel ? times.find((x) => x > activeLabel.at) ?? Infinity : Infinity;
  const lp = activeLabel ? easeOut((t - activeLabel.at) / 0.4) * (1 - clamp01((t - labelEnd + 0.3) / 0.3)) : 0;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: camera, transformOrigin: "0 0" }}>
        <div style={{ position: "absolute", inset: 0, opacity: enter, transform: `translateY(${(1 - enter) * 0.12 * height}px)` }}>
          {/* glow behind the device */}
          <div style={{ position: "absolute", left: body.x - 0.1 * body.w, top: body.y + 0.1 * body.h, width: body.w * 1.2, height: body.h * 0.9, borderRadius: "50%", background: theme.colors.accent, opacity: 0.18, filter: `blur(${70 * u}px)` }} />
          {kind === "laptop" && (
            <div style={{ position: "absolute", left: body.x - 0.08 * body.w, top: body.y + body.h, width: body.w * 1.16, height: 0.045 * body.w, background: "linear-gradient(180deg, #2a2d34, #15171b)", borderRadius: `0 0 ${24 * u}px ${24 * u}px`, clipPath: "polygon(4% 0, 96% 0, 100% 100%, 0 100%)" }} />
          )}
          <div style={{ position: "absolute", left: body.x, top: body.y, width: body.w, height: body.h, borderRadius: radius + (kind === "phone" ? 0.035 * screen.w : 0), background: bezel, boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.55), inset 0 0 0 ${2 * u}px rgba(255,255,255,0.08)` }}>
            {kind === "browser" && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 46 * u, display: "flex", alignItems: "center", gap: 10 * u, padding: `0 ${18 * u}px`, background: "#1d2026", borderRadius: `${radius}px ${radius}px 0 0` }}>
                {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 13 * u, height: 13 * u, borderRadius: "50%", background: c }} />)}
                <div style={{ flex: 1, marginLeft: 16 * u, height: 26 * u, borderRadius: 13 * u, background: "#2b2f37", color: "#aab0bc", fontSize: 15 * u, lineHeight: `${26 * u}px`, padding: `0 ${14 * u}px`, whiteSpace: "nowrap", overflow: "hidden", textShadow: "none" }}>{url ?? ""}</div>
              </div>
            )}
          </div>
          <div style={{ position: "absolute", left: screen.x, top: screen.y, width: screen.w, height: screen.h, overflow: "hidden", borderRadius: kind === "phone" ? radius : kind === "browser" ? `0 0 ${radius}px ${radius}px` : 4 * u, background: "#fff" }}>
            {prev >= 0 && sw < 1 && <div style={{ position: "absolute", inset: 0, transform: `translateX(${-sw * 0.3 * screen.w}px)`, opacity: 1 - sw * 0.6 }}><Page asset={screens[prev].asset} w={screen.w} h={screen.h} /></div>}
            <div style={{ position: "absolute", inset: 0, transform: prev >= 0 ? `translateX(${(1 - sw) * screen.w}px)` : undefined, boxShadow: sw < 1 ? `0 0 ${30 * u}px rgba(0,0,0,0.35)` : undefined }}>
              <Page asset={screens[cur].asset} w={screen.w} h={screen.h} scroll={scrollNow} />
            </div>
            {/* the page dims while a card is open over it */}
            <div style={{ position: "absolute", inset: 0, background: "#000", opacity: 0.45 * Math.max(0, ...cards.map((c) => easeInOut((t - c.open) / 0.5) * (1 - easeInOut((t - c.close) / 0.4)))) }} />
            {kind === "phone" && <div style={{ position: "absolute", left: "50%", top: 0.012 * screen.h, width: 0.3 * screen.w, height: 0.036 * screen.h, transform: "translateX(-50%)", borderRadius: 999, background: "#000" }} />}
          </div>
          {cards.map((c) => {
            const o = easeOutBack(clamp01((t - c.open) / 0.55)), back = easeInOut((t - c.close) / 0.4);
            const p = Math.min(o, 1 + 0.08) * (1 - back);
            if (t < c.open || back >= 1) return null;
            const b = { x: lerp(c.from.x, c.to.x, p), y: lerp(c.from.y, c.to.y, p), w: lerp(c.from.w, c.to.w, p), h: lerp(c.from.h, c.to.h, p) };
            const k = b.w / c.from.w;
            return (
              <div key={c.i} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, overflow: "hidden", borderRadius: 14 * u * Math.min(1, p + 0.3), boxShadow: `0 ${24 * u * p}px ${60 * u * p}px rgba(0,0,0,${0.5 * p})` }}>
                {c.asset
                  ? <Img src={staticFile(tl.assets[c.asset]?.src ?? "")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `scale(${k}, ${b.h / c.from.h}) translate(${-c.rect[0] * screen.w}px, ${-c.rect[1] * screen.h}px)` }}><Page asset={screens[cur].asset} w={screen.w} h={screen.h} scroll={scrollNow} /></div>}
              </div>
            );
          })}
          {steps.map((st, i) => {
            if (!st.tap) return null;
            const local = t - times[i];
            if (local < -0.2 || local > 0.8) return null;
            const x = screen.x + st.tap[0] * screen.w, y = screen.y + st.tap[1] * screen.h;
            const press = clamp01((local + 0.2) / 0.2) * (1 - clamp01((local - 0.15) / 0.25));
            const ring = easeOut(clamp01(local / 0.6));
            const r = (kind === "phone" ? 0.075 : 0.022) * screen.w + 26 * u;
            return (
              <React.Fragment key={`tap-${i}`}>
                <div style={{ position: "absolute", left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: "50%", border: `${4 * u}px solid ${theme.colors.highlight}`, transform: `scale(${0.4 + 1.4 * ring})`, opacity: local < 0 ? 0 : 1 - ring }} />
                <div style={{ position: "absolute", left: x - r * 0.5, top: y - r * 0.5, width: r, height: r, borderRadius: "50%", background: "rgba(255,255,255,0.85)", boxShadow: `0 0 0 ${3 * u}px ${theme.colors.highlight}`, transform: `scale(${0.7 + 0.3 * (1 - press)})`, opacity: press }} />
              </React.Fragment>
            );
          })}
        </div>
      </AbsoluteFill>
      {activeLabel && lp > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: (portrait ? 140 : 70) * u, display: "flex", justifyContent: "center", opacity: lp, transform: `translateY(${(1 - lp) * -16 * u}px)` }}>
          <div style={{ background: theme.colors.highlight, color: "#0b0f19", fontSize: 40 * u, fontWeight: 800, padding: `${10 * u}px ${26 * u}px`, borderRadius: 10 * u, textShadow: "none", whiteSpace: "nowrap" }}>{activeLabel.st.label}</div>
        </div>
      )}
      {caption && <div style={{ position: "absolute", left: pad, right: pad, bottom: (portrait ? 300 : 60) * u, textAlign: "center", fontSize: 30 * u, color: theme.colors.muted, opacity: easeOut((t - 0.5) / 0.5) }}>{caption}</div>}
    </AbsoluteFill>
  );
};

// ── match-cut ────────────────────────────────────────────────────────────────
// A brand beat: everyday things that share one silhouette, each centred on the same spot and the
// same size, hard-cut one after another on the music's beats, so the shape stays and the object
// changes. `items[].t` are compiled from the beats (every: beats per cut) or seconds.

// Sized to the picture itself (not the square), with its edges feathered away, so a still shot on
// its own backdrop melts into the scene's background instead of showing as a box.
const FEATHER = "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent), linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent)";
const STILL_FIT: React.CSSProperties = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", maskImage: FEATHER, WebkitMaskImage: FEATHER, maskComposite: "intersect", WebkitMaskComposite: "source-in" };

type Still = { asset: string; t?: number; x?: number; y?: number; scale?: number; label?: string };

export const MatchCutScene: React.FC<{ items: Still[]; size?: number; background?: string; title?: string; flash?: boolean }> = ({
  items, size = 0.62, background, title, flash = true,
}) => {
  const theme = useTheme();
  const tl = useTimeline();
  const { u, width, height } = useLayout();
  const t = useTime();
  let k = 0;
  for (let i = 0; i < items.length; i++) if ((items[i].t ?? i * 0.5) <= t) k = i;
  const it = items[k];
  const since = t - (it.t ?? k * 0.5);
  const a = tl.assets[it.asset];
  const s = Math.min(width, height) * size * (it.scale ?? 1);
  // Each cut lands slightly large and settles, a beat-sized punch.
  const punch = 1 + 0.06 * (1 - easeOut(clamp01(since / 0.18)));
  const titleAt = items.at(-1)?.t ?? (items.length - 1) * 0.5;
  const tp = title ? easeOut((t - titleAt - 0.35) / 0.5) : 0;
  return (
    <AbsoluteFill style={{ background: background ?? theme.colors.bg, overflow: "hidden" }}>
      {a && (
        <div style={{ position: "absolute", left: (it.x ?? 0.5) * width - s / 2, top: (it.y ?? 0.5) * height - s / 2, width: s, height: s, transform: `scale(${punch})`, opacity: 1 - 0.85 * tp, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {a.kind === "video"
            ? <ClipVideo a={a} style={STILL_FIT} />
            : <Img src={staticFile(a.src)} style={STILL_FIT} />}
        </div>
      )}
      {flash && since < 0.08 && k > 0 && <AbsoluteFill style={{ background: "#fff", opacity: 0.18 * (1 - since / 0.08) }} />}
      {it.label && <div style={{ position: "absolute", left: 0, right: 0, top: (it.y ?? 0.5) * height + s / 2 + 30 * u, textAlign: "center", fontSize: 34 * u, letterSpacing: 6 * u, color: theme.colors.muted }}>{it.label}</div>}
      {title && tp > 0 && <div style={{ position: "absolute", left: 0, right: 0, top: "50%", transform: `translateY(-50%) scale(${lerp(1.1, 1, tp)})`, textAlign: "center", fontSize: 150 * u, fontWeight: 900, letterSpacing: -2 * u, opacity: tp, color: theme.colors.text }}>{title}</div>}
    </AbsoluteFill>
  );
};
