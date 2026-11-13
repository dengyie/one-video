import React from "react";
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import type { Camera, Direction, Focus, Scene, Shot, Timeline, Transition } from "./types";
import { SceneContext, TimelineContext, useLayout, useTimeline } from "./context";
import { clamp01, easeInOut, easeOut } from "./motion";
import { cutBetween, farther, viewAt, viewTransform, viewVelocity } from "./camera";
import { MotionBlur } from "../components/MotionBlur";
import { Backdrop } from "../components/Backdrop";
import { Credit, MediaFill } from "../components/Media";
import { Header } from "../components/Header";
import { Watermark } from "../components/Watermark";
import { FilmLook, Overlays } from "../components/Overlay";
import { Captions } from "./Captions";
import { SCENES } from "../scenes";
import { canvasBackdrop } from "../scenes/Canvas";

// Music gain: full between lines, ducked under speech, with short ramps and fade in/out.
export function musicGain(t: number, total: number, m: NonNullable<Timeline["music"]>, narration: [number, number][]): number {
  const RAMP = 0.35;
  let d = Infinity;
  for (const [a, b] of narration) {
    if (t >= a && t <= b) { d = 0; break; }
    d = Math.min(d, t < a ? a - t : t - b);
  }
  const duck = m.duckTo + (m.volume - m.duckTo) * clamp01(d / RAMP);
  const fade = Math.min(clamp01(t / m.fade), clamp01((total - t) / m.fade));
  return duck * fade;
}

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

type Look = { style: React.CSSProperties; whip?: number; dip?: number };

// One side of a boundary. `p` runs 0→1 across the overlap for both sides; the incoming scene is
// drawn on top, so an outgoing side only has to move or fade when the incoming one doesn't cover it.
export function presentation(type: Transition, side: "in" | "out", p: number, dir: Direction, w: number, h: number, covered: boolean): Look {
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
      if (type === "whip") look.whip = Math.sin(Math.PI * p);
      return look;
    }
    case "zoom": return { style: inS ? { opacity: p, transform: `scale(${0.94 + 0.06 * p})` } : { opacity: fadeOut, transform: `scale(${1 + 0.05 * p})` } };
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
    case "dip": return inS ? { style: { opacity: 1 }, dip: p } : { style: {} };
    default: return { style: { opacity: inS ? p : fadeOut } };
  }
}

// Slow camera on the scene's foreground; the backdrop keeps its own Ken Burns, so the two layers
// drift apart and read as depth. `k` is scene progress 0→1.
export function cameraTransform(cam: Camera, k: number, t: number, w: number, seed: string): string {
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
const SOLID: Transition[] = ["push", "whip", "iris", "clock", "wipe", "through"];

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
  const { u } = useLayout();
  const tin = scene.transitionIn;
  const tout = scene.transitionOut;
  let look: Look = { style: {} };
  let active: Transition | null = null;
  let out = false;
  if (tin && tin.frames > 0 && frame < tin.frames) {
    active = tin.type;
    look = presentation(tin.type, "in", easeInOut(frame / tin.frames), tin.direction, width, height, false);
  } else if (tout && tout.frames > 0 && frame > length - tout.frames) {
    active = tout.type;
    out = true;
    look = presentation(tout.type, "out", easeInOut((frame - (length - tout.frames)) / tout.frames), tout.direction, width, height, tout.nextOpaque);
  }
  const solid = !scene.opaque && active !== null && SOLID.includes(active);
  const t = (frame - (tin?.lead ?? 0)) / fps;
  const tl = useTimeline();
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
  const dip = look.dip;
  const [dx, dy] = DIR[tin?.direction ?? "left"] ?? DIR.left;
  return (
    <>
      {dip !== undefined && <AbsoluteFill style={{ backgroundColor: "#000", opacity: dip < 0.5 ? dip * 2 : 2 - dip * 2 }} />}
      <AbsoluteFill style={{ ...style, ...(dip !== undefined ? { opacity: dip < 0.5 ? 0 : dip * 2 - 1 } : {}), ...shadow }}>
        {look.whip ? (
          <svg width={0} height={0} style={{ position: "absolute" }}>
            <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation={`${look.whip * 0.03 * width * Math.abs(dx)} ${look.whip * 0.03 * height * Math.abs(dy)}`} />
            </filter>
          </svg>
        ) : null}
        {solid && base}
        {shots ? <AbsoluteFill style={{ transform: viewTransform(farther(view, 0.55), width, height) }}>{children}</AbsoluteFill>
          : scene.type === "canvas" && scene.backdrop ? <AbsoluteFill style={{ transform: canvasBackdrop(scene.props, t, width, height, u) }}>{children}</AbsoluteFill>
          : children}
        <MotionBlur id={scene.id} vx={vel.vx} vy={vel.vy} radial={vel.radial} style={{ transform: viewTransform(view, width, height) }}>
          <AbsoluteFill style={{ transform: cam || undefined }}>{content}</AbsoluteFill>
          <Overlays />
        </MotionBlur>
        {/* The header is frame chrome: it rides the transition but not the camera, so a push-in cannot crop it. */}
        {header}
      </AbsoluteFill>
    </>
  );
};

export const Video: React.FC<Timeline> = (timeline) => {
  const { fps } = useVideoConfig();
  const { theme, music } = timeline;
  // A stem render (onevideo stems) plays one sound group and mutes the rest.
  const play = (group: NonNullable<Timeline["stem"]>) => !timeline.stem || timeline.stem === group;
  return (
    <TimelineContext.Provider value={timeline}>
      <AbsoluteFill style={{ backgroundColor: theme.colors.bg, fontFamily: theme.fonts.body, color: theme.colors.text }}>
        <Backdrop variant={theme.background} />
        {timeline.scenes.map((scene) => {
          const Comp = SCENES[scene.type];
          if (!Comp) throw new Error(`unknown scene type "${scene.type}" in scene "${scene.id}"`);
          const lead = scene.transitionIn?.lead ?? 0;
          const length = lead + scene.durationInFrames + (scene.transitionOut?.tail ?? 0);
          return (
            <React.Fragment key={scene.id}>
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
              {scene.audio && play("voice") && (
                <Sequence name={`${scene.id} · voice`} from={scene.from} durationInFrames={scene.durationInFrames} layout="none">
                  <Html5Audio src={staticFile(scene.audio)} />
                </Sequence>
              )}
            </React.Fragment>
          );
        })}
        {music && play("music") && (
          <Html5Audio
            src={staticFile(music.src)}
            trimBefore={music.offset ? Math.round(music.offset * fps) : undefined}
            loop
            volume={(f) => musicGain(f / fps, timeline.duration, music, timeline.narration)}
          />
        )}
        {play("sfx") && timeline.sfx.map((s, i) => (
          <Sequence key={`sfx-${i}`} name={`sfx ${s.sound}`} from={Math.max(0, Math.round(s.at * fps))} durationInFrames={Math.round((s.duration ?? 3) * fps) + 2} layout="none">
            <Html5Audio src={staticFile(s.src)} volume={s.volume} />
          </Sequence>
        ))}
        <FilmLook />
        {timeline.captions.enabled && timeline.captions.style !== "none" && <Captions />}
        {timeline.watermark && <Watermark mark={timeline.watermark} />}
      </AbsoluteFill>
    </TimelineContext.Provider>
  );
};
