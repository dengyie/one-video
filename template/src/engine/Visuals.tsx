import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import type { Camera, Direction, Focus, Scene, Shot, Theme, Transition } from "./types";
import { SceneContext, useLayout, useTimeline } from "./context";
import { clamp01, easeInOut, easeOut } from "./motion";
import { cutBetween, farther, viewAt, viewTransform, viewVelocity } from "./camera";
import { MotionBlur } from "../components/MotionBlur";
import { Backdrop } from "../components/Backdrop";
import { Credit, MediaFill } from "../components/Media";
import { Header } from "../components/Header";
import { Overlays } from "../components/Overlay";
import { SCENES } from "../scenes";
import { canvasBackdrop } from "../scenes/Canvas";
import { cameraViewport } from "../../../shared/camera.mjs";
import { closingFade, dipOpacity, whipBlur, zoomScale } from "../../../shared/transition.mjs";

// Unit vector the incoming scene travels along: "left" means it enters from the right.
const DIR: Record<Direction, [number, number]> = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] };

// Clock-wipe polygon: a pie slice from 12 o'clock sweeping clockwise to p·360°.
function clockPolygon(p: number): string {
  const pts = ["50% 50%", "50% -100%"];
  const steps = Math.max(2, Math.ceil(p * 48));
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * p * Math.PI * 2;
    pts.push(`${50 + 150 * Math.sin(a)}% ${50 - 150 * Math.cos(a)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

type Look = { style: React.CSSProperties; whip?: number };

// One side of a boundary. `p` runs 0→1 across the overlap for both sides; the incoming scene is
// drawn on top, so an outgoing side only has to move or fade when the incoming one doesn't cover it.
function presentation(type: Transition, side: "in" | "out", p: number, dir: Direction, w: number, h: number, covered: boolean): Look {
  const [dx, dy] = DIR[dir] ?? DIR.left;
  const fadeOut = covered ? 1 : 1 - p;
  const inS = side === "in";
  switch (type) {
    case "cut": return { style: {} };
    case "fade": return { style: { opacity: inS ? p : fadeOut } };
    case "slide": {
      const k = inS ? 1 - p : -p;
      return { style: { opacity: inS ? p : 1 - p, transform: `translate(${k * dx * w * 0.06}px, ${k * dy * h * 0.06}px)` } };
    }
    case "push":
    case "whip": {
      const k = inS ? 1 - p : -p;
      const look: Look = { style: { transform: `translate(${k * dx * w}px, ${k * dy * h}px)` } };
      if (type === "whip") look.whip = p;
      return look;
    }
    case "zoom": return { style: { opacity: inS ? p : 1, transform: `scale(${zoomScale(side, p)})` } };
    case "punch": return { style: inS ? { opacity: Math.min(1, p * 1.6), transform: `scale(${0.85 + 0.15 * p})` } : { opacity: 1 - p, transform: `scale(${1 + 0.3 * p})` } };
    case "iris": return { style: inS ? { clipPath: `circle(${p * 72}% at 50% 50%)` } : { opacity: fadeOut } };
    case "clock": return { style: inS ? { clipPath: p >= 1 ? undefined : clockPolygon(p) } : { opacity: fadeOut } };
    case "wipe": {
      const e = p * 100;
      const horiz = dy === 0;
      // The edge travels along dir; each side keeps the part the edge hasn't / has passed.
      const inClip = horiz ? (dx > 0 ? `inset(0 0 0 ${100 - e}%)` : `inset(0 ${100 - e}% 0 0)`) : dy > 0 ? `inset(${100 - e}% 0 0 0)` : `inset(0 0 ${100 - e}% 0)`;
      const outClip = horiz ? (dx > 0 ? `inset(0 ${e}% 0 0)` : `inset(0 0 0 ${e}%)`) : dy > 0 ? `inset(0 0 ${e}% 0)` : `inset(${e}% 0 0 0)`;
      return { style: { clipPath: inS ? inClip : outClip } };
    }
    // Through: the camera dives into the outgoing frame's centre (where the shot track has put
    // the subject) until it blurs into the next scene, which settles back from an overshoot. The
    // next scene only shows from p 0.3, so the dive has read (≈1.5×) before it is covered.
    case "through": return { style: inS
      ? { opacity: clamp01((p - 0.3) / 0.4), transform: `scale(${1.35 - 0.35 * easeOut(p)})` }
      : { opacity: covered ? 1 : 1 - clamp01((p - 0.6) / 0.4), transform: `scale(${1 + 3 * p ** 1.5})`, filter: `blur(${(p * p * 0.012 * w).toFixed(1)}px)` } };
    case "dip": return { style: {} };
    default: return { style: { opacity: inS ? p : fadeOut } };
  }
}

// Slow camera on the scene's foreground; the backdrop keeps its own Ken Burns, so the two layers
// drift apart and read as depth. `k` is scene progress 0→1.
function cameraTransform(cam: Camera, k: number, t: number, w: number, seed: string): string {
  const a = cam.amount ?? 1;
  const e = easeInOut(k);
  switch (cam.move) {
    case "static": return "";
    case "push": return `scale(${1 + 0.06 * a * e})`;
    case "pull": return `scale(${1 + 0.06 * a * (1 - e)})`;
    case "pan-left": return `translateX(${(0.5 - e) * 0.04 * a * w}px) scale(${1 + 0.02 * a})`;
    case "pan-right": return `translateX(${(e - 0.5) * 0.04 * a * w}px) scale(${1 + 0.02 * a})`;
    case "rise": return `translateY(${(0.5 - e) * 0.03 * a * w}px) scale(${1 + 0.02 * a})`;
    case "handheld": {
      const x = noise2D(seed + "x", t * 0.6, 0) * 0.006 * a * w;
      const y = noise2D(seed + "y", t * 0.6, 0) * 0.006 * a * w;
      const r = noise2D(seed + "r", t * 0.4, 0) * 0.35 * a;
      return `translate(${x}px, ${y}px) rotate(${r}deg) scale(${1 + 0.015 * a})`;
    }
    default: return `scale(${1 + 0.018 * a * e}) translateX(${(e - 0.5) * 0.008 * a * w}px)`;
  }
}

// Shape and motion transitions only read when the moving layer is solid; a scene without a photo
// carries its own copy of the style background while one of these runs.
const SOLID: Transition[] = ["push", "whip", "iris", "clock", "wipe", "through", "zoom"];

// Screen point a through transition dives at: the outgoing subject filmed through that scene's
// shot track at time t (the backdrop layer through its weaker copy), as a CSS transform-origin.
function throughOrigin(f: Focus | undefined, shots: Shot[] | undefined, t: number): string | undefined {
  if (!f) return undefined;
  let { x, y } = f;
  if (f.layer !== "screen") {
    const v0 = viewAt(shots?.length ? shots : undefined, t);
    const v = f.layer === "backdrop" ? farther(v0, 0.55) : v0;
    x = 0.5 + v.zoom * (x - v.x);
    y = 0.5 + v.zoom * (y - v.y);
  }
  return `${(clamp01(x) * 100).toFixed(1)}% ${(clamp01(y) * 100).toFixed(1)}%`;
}

const SceneFrame: React.FC<{ scene: Scene; length: number; children: React.ReactNode; content: React.ReactNode; header: React.ReactNode; base: React.ReactNode }> = ({ scene, length, children, content, header, base }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { u, top } = useLayout();
  const tl = useTimeline();
  const tin = scene.transitionIn;
  const tout = scene.transitionOut;
  let look: Look = { style: {} };
  let active: Transition | null = null;
  let dip: number | undefined;
  let out = false;
  if (tin && tin.frames > 0 && frame < tin.frames) {
    active = tin.type;
    if (tin.type === "dip") dip = dipOpacity("in", frame, tin.frames, tin.lead);
    else look = presentation(tin.type, "in", easeInOut(frame / tin.frames), tin.direction, width, height, false);
  } else if (tout && tout.frames > 0 && frame >= length - tout.frames) {
    active = tout.type;
    out = true;
    const local = frame - (length - tout.frames);
    if (tout.type === "dip") dip = dipOpacity("out", local, tout.frames, tout.frames - tout.tail);
    else if (tout.type !== "fade" || scene !== tl.scenes.at(-1)) look = presentation(tout.type, "out", easeInOut(local / tout.frames), tout.direction, width, height, tout.nextOpaque);
  }
  const solid = !scene.opaque && active !== null && SOLID.includes(active);
  const t = (frame - (tin?.lead ?? 0)) / fps;
  if (active === "through") {
    const prev = out ? scene : tl.scenes[tl.scenes.findIndex((s) => s.id === scene.id) - 1];
    const f = out ? tout?.focus : tin?.focus;
    // The incoming side surfaces from the same screen point, read on the outgoing scene's clock.
    const origin = prev && throughOrigin(f, prev.shots, out ? t : (frame - (tin?.lead ?? 0) + scene.from - prev.from) / fps);
    if (origin) look = { ...look, style: { ...look.style, transformOrigin: origin } };
  }
  const cam = cameraTransform(scene.camera ?? { move: "drift" }, clamp01(t / Math.max(0.1, scene.duration)), t, width, scene.id);
  // Shot track: the foreground is filmed through the current framing, the backdrop through a
  // weaker one, and a move between framings smears by its per-frame travel.
  const shots = scene.shots?.length ? scene.shots : undefined;
  const view = viewAt(shots, t);
  const vel = shots && !cutBetween(shots, t - 1 / fps, t) ? viewVelocity(viewAt(shots, t - 1 / fps), view, width, height) : { vx: 0, vy: 0, radial: 0 };
  const filterId = `whip-${scene.id}`;
  let style: React.CSSProperties = { ...look.style };
  if (look.whip) style.filter = `url(#${filterId})`;
  // Text over a photo gets a soft shadow (inherited by every label in the scene).
  const shadow: React.CSSProperties = scene.backdrop ? { textShadow: "0 2px 14px rgba(0,0,0,0.6)" } : {};
  const [dx, dy] = DIR[(out ? tout : tin)?.direction ?? "left"] ?? DIR.left;
  const viewport = scene.type === "canvas" && scene.header ? cameraViewport(height, top) : null;
  const art = <>
    <AbsoluteFill style={{ transform: cam || undefined }}>{content}</AbsoluteFill>
    <Overlays />
  </>;
  const foreground = (
    <MotionBlur id={scene.id} vx={vel.vx} vy={vel.vy} radial={vel.radial} style={{ transform: viewTransform(view, width, height) }}>
      {viewport ? <AbsoluteFill style={{ transform: `translateY(${viewport.top}px) scale(${viewport.scale})`, transformOrigin: "top center" }}>{art}</AbsoluteFill> : art}
    </MotionBlur>
  );
  return (
    <>
      {dip !== undefined && out && <AbsoluteFill style={{ backgroundColor: "#000" }} />}
      <AbsoluteFill style={{ ...style, ...(dip !== undefined ? { opacity: dip } : {}), ...shadow }}>
        {look.whip ? (
          <svg width={0} height={0} style={{ position: "absolute" }}>
            <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={`${whipBlur(look.whip, width) * Math.abs(dx)} ${whipBlur(look.whip, height) * Math.abs(dy)}`} />
            </filter>
          </svg>
        ) : null}
        {solid && base}
        {shots ? <AbsoluteFill style={{ transform: viewTransform(farther(view, 0.55), width, height) }}>{children}</AbsoluteFill>
          : scene.type === "canvas" && scene.backdrop ? <AbsoluteFill style={{ transform: canvasBackdrop(scene.props, t, width, height, u) }}>{children}</AbsoluteFill>
          : children}
        {viewport ? <AbsoluteFill style={{ clipPath: `inset(${viewport.top}px 0 0)` }}>{foreground}</AbsoluteFill> : foreground}
        {/* The header is frame chrome: it rides the transition but not the camera, so a push-in cannot crop it. */}
        {header}
      </AbsoluteFill>
    </>
  );
};

const SceneVisual: React.FC<{ scene: Scene; theme: Theme }> = ({ scene, theme }) => {
  const Comp = Object.hasOwn(SCENES, scene.type) ? SCENES[scene.type] : undefined;
  if (!Comp) throw new Error(`unknown scene type "${scene.type}" in scene "${scene.id}"`);
  const lead = scene.transitionIn?.lead ?? 0;
  const length = lead + scene.durationInFrames + (scene.transitionOut?.tail ?? 0);
  return (
    <Sequence name={`${scene.id} · ${scene.type}`} from={scene.from - lead} durationInFrames={length}>
      <SceneContext.Provider value={scene}>
        <SceneFrame
          scene={scene}
          length={length}
          base={<AbsoluteFill style={{ backgroundColor: theme.colors.bg }}><Backdrop variant={theme.background} /></AbsoluteFill>}
          content={<Comp {...scene.props} />}
          header={scene.header && <Header title={scene.header.title} subtitle={scene.header.subtitle} />}
        >
          {scene.backdrop
            ? <><MediaFill asset={scene.backdrop.asset} motion={scene.backdrop.motion} dim={scene.backdrop.dim} blur={scene.backdrop.blur} startFrom={scene.backdrop.startFrom} /><Credit asset={scene.backdrop.asset} corner="bottom-right" /></>
            : scene.background && scene.background !== "default" && scene.background !== theme.background && <Backdrop variant={scene.background} />}
        </SceneFrame>
      </SceneContext.Provider>
    </Sequence>
  );
};

export const VisualTrack: React.FC = () => {
  const { scenes, theme, totalFrames } = useTimeline();
  const frame = useCurrentFrame();
  const last = scenes.at(-1);
  const frames = last?.transitionOut?.type === "fade" ? Math.min(last.transitionOut.frames, last.durationInFrames) : 0;
  const local = frame - (totalFrames - frames);
  const opacity = frames > 0 && local >= 0 ? 1 - closingFade(local, frames) : undefined;
  return (
    <>
      {opacity !== undefined && <AbsoluteFill style={{ backgroundColor: "#000" }} />}
      <AbsoluteFill style={{ opacity }}>
        <Backdrop variant={theme.background} />
        {scenes.map((scene) => <SceneVisual key={scene.id} scene={scene} theme={theme} />)}
      </AbsoluteFill>
    </>
  );
};
