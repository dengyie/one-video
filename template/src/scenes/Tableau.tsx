import React from "react";
import { AbsoluteFill } from "remotion";
import { useLayout, useScene, useTheme, useTime } from "../engine/context";
import {
  SEA_BANDS, bandBase, bandDepth, bandFor, boltPath, cameraAt, cameraMoving, elementAt, flashAt, flashTotal, hash, lampLevel,
  layerView, mixHex, noise, paletteAt, waveY,
} from "../../../shared/tableau.mjs";

// Tableau: an illustrated place drawn by code, in layers at their own depth — sky, stars, moon or
// sun, clouds, a sea of swells, cliffs, a lighthouse sweeping its beam, a hut, a rocking boat, a
// figure carrying a lantern, a fire on the shore, rain and lightning — each piece keyframed
// (`to`, by cue or time) and a camera (`camera`) that moves through them with parallax.
// State, palettes, waves and the camera are shared/tableau.mjs (the compiler uses them too).

type El = Record<string, any> & { id: string; type: string };
type Props = { elements?: El[]; camera?: Record<string, any>[]; inherit?: boolean };
type Ctx = { W: number; H: number; S: number; t: number; pal: ReturnType<typeof paletteAt>; horizon: number; swell: number; id: string; fonts: { body: string } };

const LANTERN = "#ffd48a";
const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

// One layer's transform: points of the layer (frame px) move by its share of the camera.
function layerTransform(cam: ReturnType<typeof cameraAt>, depth: number, W: number, H: number) {
  const v = layerView(cam, depth);
  return `translate(${(W / 2).toFixed(1)} ${(H / 2).toFixed(1)}) scale(${v.scale.toFixed(4)}) translate(${(-v.cx * W).toFixed(1)} ${(-v.cy * H).toFixed(1)})`;
}

const Stars: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const a = c.pal.stars * s.density * s.opacity * s.enter;
  if (a < 0.01) return null;
  const n = Math.round(170 * Math.min(1.5, s.density));
  return (
    <g>
      {Array.from({ length: n }, (_, k) => {
        const x = hash(k, 1) * 1.5 - 0.25, y = Math.pow(hash(k, 2), 1.3) * (c.horizon - 0.04);
        const fade = Math.min(1, (c.horizon - y) / 0.18);
        const tw = 0.55 + 0.45 * Math.sin(c.t * (0.8 + hash(k, 3) * 2.6) + hash(k, 4) * 20);
        const r = (0.5 + Math.pow(hash(k, 5), 3) * 1.9) * (c.S / 1080);
        return <circle key={k} cx={x * c.W} cy={y * c.H} r={r} fill="#f4f1e6" opacity={a * fade * tw * (0.35 + 0.65 * hash(k, 6))} />;
      })}
    </g>
  );
};

const Moon: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const r = s.r * c.S, x = s.x * c.W, y = s.y * c.H, o = s.opacity * s.enter;
  return (
    <g opacity={o}>
      <circle cx={x} cy={y} r={r * 5} fill={`url(#${c.id}-moonglow)`} />
      <circle cx={x} cy={y} r={r} fill={mixHex("#f3ecd4", c.pal.rim, 0.25)} />
      <circle cx={x - r * 0.3} cy={y - r * 0.2} r={r * 0.22} fill="#000" opacity={0.07} />
      <circle cx={x + r * 0.28} cy={y + r * 0.3} r={r * 0.15} fill="#000" opacity={0.06} />
      <circle cx={x + r * 0.1} cy={y - r * 0.42} r={r * 0.1} fill="#000" opacity={0.05} />
    </g>
  );
};

const Sun: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const r = s.r * c.S, x = s.x * c.W, y = s.y * c.H, o = s.opacity * s.enter;
  return (
    <g opacity={o}>
      <circle cx={x} cy={y} r={r * 7} fill={`url(#${c.id}-sunglow)`} />
      <circle cx={x} cy={y} r={r} fill="#fff1cf" />
    </g>
  );
};

const Clouds: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const n = Math.round(5 + s.cover * 14);
  const o = s.opacity * s.enter * (0.35 + 0.65 * s.cover);
  return (
    <g opacity={o}>
      {Array.from({ length: n }, (_, k) => {
        const span = 2.0;
        const raw = hash(k, s.seed) * span - 0.5 + c.t * s.speed * (0.6 + hash(k, s.seed + 1) * 0.8);
        const x = ((raw + 0.5) % span + span) % span - 0.5;
        const y = s.y + (hash(k, s.seed + 2) - 0.5) * 0.16 * (0.6 + s.cover);
        const rx = (0.14 + 0.2 * hash(k, s.seed + 3)) * (0.7 + s.cover * 0.6), ry = rx * (0.26 + 0.12 * hash(k, s.seed + 4));
        return <ellipse key={k} cx={x * c.W} cy={y * c.H} rx={rx * c.W} ry={ry * c.H * 1.6} fill={`url(#${c.id}-cloud)`} />;
      })}
    </g>
  );
};

// One band of the sea: its surface path, fill, a rim of light along the crest, whitecaps in a
// swell, and glints of the moon (or sun) on its face.
function bandPath(c: Ctx, i: number, swell: number) {
  const p: [number, number][] = [];
  for (let x = -0.7; x <= 1.7001; x += 0.012) p.push([x * c.W, waveY(i, x, c.t, swell, c.horizon) * c.H]);
  return p;
}
// Indices of the surface's crests (local highs on screen: smallest y).
function crests(surf: [number, number][]) {
  const out: number[] = [];
  for (let k = 1; k < surf.length - 1; k++) if (surf[k][1] < surf[k - 1][1] && surf[k][1] <= surf[k + 1][1]) out.push(k);
  return out;
}
const SeaBand: React.FC<{ c: Ctx; i: number; s: any; glint: { x: number; a: number } | null }> = ({ c, i, s, glint }) => {
  const surf = bandPath(c, i, s.swell);
  const fill = mixHex(c.pal.seaFar, c.pal.seaNear, i / (SEA_BANDS - 1));
  const d = `M ${pts(surf)} L ${(1.7 * c.W).toFixed(1)},${(1.6 * c.H).toFixed(1)} L ${(-0.7 * c.W).toFixed(1)},${(1.6 * c.H).toFixed(1)} Z`;
  const caps = Math.max(0, s.swell - 0.45) * 1.6;
  const next = i + 1 < SEA_BANDS ? bandBase(i + 1, c.horizon) : 1.05;
  return (
    <g opacity={s.opacity * s.enter}>
      <path d={d} fill={fill} />
      <polyline points={pts(surf)} fill="none" stroke={c.pal.rim} strokeWidth={(1 + i * 0.5) * (c.S / 1080)} opacity={0.16 + 0.05 * i} />
      {caps > 0 && crests(surf).map((k, j) => {
        // Foam breaks on a crest: a ragged stroke along the surface either side of it, its size
        // and brightness varying crest to crest (and swelling and fading as the crest travels).
        const span = Math.max(2, Math.round((3 + i * 2) * (0.4 + noise(j * 1.7 + c.t * 0.6, i + 40))));
        const seg = surf.slice(Math.max(0, k - span), k + Math.round(span * 0.6) + 1);
        const a = Math.min(0.75, caps) * (0.3 + 0.7 * noise(j * 2.3 + c.t * 0.8, i + 50));
        return <polyline key={`cap${j}`} points={pts(seg.map(([px, py]) => [px, py + (1 + i) * 0.6 * (c.S / 1080)]))} fill="none" stroke="#e9eef2" strokeWidth={(1.5 + i * 1.1) * (c.S / 1080) * (0.6 + 0.6 * a)} strokeLinecap="round" opacity={a} />;
      })}
      {glint && glint.a > 0.01 && Array.from({ length: 6 + i * 3 }, (_, k) => {
        const y0 = waveY(i, glint.x, c.t, s.swell, c.horizon), y = y0 + (next - y0) * hash(k, i * 13 + 1) * 0.9 + 0.004;
        const spread = 0.008 + (y - c.horizon) * 0.22;
        const x = glint.x + (hash(k, i * 13 + 2) - 0.5) * spread * 2 + Math.sin(c.t * 1.7 + k) * spread * 0.25;
        const len = (0.006 + (y - c.horizon) * 0.06) * (0.5 + hash(k, i * 13 + 3));
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(c.t * (1.2 + hash(k, i) * 2) + k * 1.3));
        return <line key={k} x1={(x - len) * c.W} x2={(x + len) * c.W} y1={y * c.H} y2={y * c.H} stroke={c.pal.rim} strokeWidth={(1.2 + i * 0.5) * (c.S / 1080)} strokeLinecap="round" opacity={glint.a * tw * 0.75} />;
      })}
    </g>
  );
};

const Cliff: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const dir = s.side === "right" ? -1 : 1;
  const top: [number, number][] = [];
  const far = s.side === "right" ? 1.8 : -0.8;
  for (let k = 0; k <= 24; k++) {
    const x = far + (s.x - far) * (k / 24);
    top.push([x, s.y + (noise(k * 0.7, s.seed) - 0.5) * 0.025 + (1 - k / 24) * -0.01]);
  }
  const face: [number, number][] = [0.06, 0.15, 0.27, 0.42, 0.6].map((dy, k) => [s.x + dir * (0.02 + k * 0.022 + (hash(k, s.seed) - 0.5) * 0.02), s.y + dy]);
  const poly: [number, number][] = [[far, 1.5], ...top, ...face, [s.x + dir * 0.16, 1.5]];
  const px = poly.map(([x, y]) => [x * c.W, y * c.H] as [number, number]);
  return (
    <g opacity={s.opacity * s.enter}>
      <polygon points={pts(px)} fill={c.pal.land} />
      <polyline points={pts([...top, face[0]].map(([x, y]) => [x * c.W, y * c.H]))} fill="none" stroke={c.pal.rim} strokeWidth={1.6 * (c.S / 1080)} opacity={0.22} />
    </g>
  );
};

const Lighthouse: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const H = s.h * c.H, x = s.x * c.W, base = s.y * c.H;
  const wb = H * 0.2, wt = wb * 0.66, top = base - H * 0.78;
  const lamp = lampLevel(s.lit, c.t);
  const body = mixHex(c.pal.land, c.pal.rim, 0.2), band = mixHex(c.pal.land, c.pal.rim, 0.07);
  const at = (f: number) => wb + (wt - wb) * f;
  const stripe = (f0: number, f1: number) => {
    const y0 = base - H * 0.78 * f0, y1 = base - H * 0.78 * f1;
    return pts([[x - at(f0) / 2, y0], [x + at(f0) / 2, y0], [x + at(f1) / 2, y1], [x - at(f1) / 2, y1]]);
  };
  const lr = { y0: top - H * 0.16, y1: top - H * 0.02, w: wt * 0.78 };
  const lc = { x, y: (lr.y0 + lr.y1) / 2 };
  // The beam turns about the tower: its horizontal reach is cos(angle); facing us it flares.
  const ang = (c.t * s.sweep * Math.PI) / 180 + 0.6;
  const reach = Math.cos(ang), toward = Math.sin(ang);
  const beam = lamp * s.beam * s.opacity * s.enter;
  const L = c.W * 1.25 * Math.abs(reach), spread = H * (0.22 + 0.2 * (1 - Math.abs(reach)));
  const end = { x: lc.x + Math.sign(reach) * L, y: lc.y + H * 0.04 * Math.abs(reach) };
  const flare = Math.max(0, (toward - 0.8) / 0.2) * beam;
  return (
    <g opacity={s.opacity * s.enter}>
      <defs>
        <linearGradient id={`${c.id}-beam-${s.id}`} gradientUnits="userSpaceOnUse" x1={lc.x} y1={lc.y} x2={end.x} y2={end.y}>
          <stop offset="0" stopColor={LANTERN} stopOpacity={0.6} />
          <stop offset="0.5" stopColor={LANTERN} stopOpacity={0.18} />
          <stop offset="1" stopColor={LANTERN} stopOpacity={0} />
        </linearGradient>
      </defs>
      {beam > 0.01 && L > 4 && (
        <polygon points={pts([[lc.x, lc.y - H * 0.03], [end.x, end.y - spread / 2], [end.x, end.y + spread / 2], [lc.x, lc.y + H * 0.03]])} fill={`url(#${c.id}-beam-${s.id})`} opacity={beam} />
      )}
      <circle cx={lc.x} cy={lc.y} r={H * (0.5 + flare * 0.9)} fill={`url(#${c.id}-lamp)`} opacity={lamp * (0.65 + 0.35 * flare)} />
      <polygon points={stripe(0, 1)} fill={body} />
      <polygon points={stripe(0.18, 0.34)} fill={band} />
      <polygon points={stripe(0.52, 0.68)} fill={band} />
      <polygon points={pts([[x, base], [x + wb / 2, base], [x + wt / 2, top], [x, top]])} fill="#000" opacity={0.22} />
      <rect x={x - wb * 0.09} y={base - H * 0.1} width={wb * 0.18} height={H * 0.1} fill={c.pal.land} />
      {[0.42, 0.74].map((f) => <rect key={f} x={x - wb * 0.05} y={base - H * 0.78 * f - H * 0.03} width={wb * 0.1} height={H * 0.05} fill={lamp > 0.05 ? LANTERN : c.pal.land} opacity={lamp > 0.05 ? 0.55 * lamp : 1} />)}
      <rect x={x - wt * 0.7} y={top - H * 0.025} width={wt * 1.4} height={H * 0.025} fill={body} />
      <rect x={x - lr.w / 2} y={lr.y0} width={lr.w} height={lr.y1 - lr.y0} fill={mixHex(c.pal.land, LANTERN, 0.1 + 0.9 * lamp)} />
      {[-0.25, 0, 0.25].map((f) => <line key={f} x1={x + lr.w * f} x2={x + lr.w * f} y1={lr.y0} y2={lr.y1} stroke={c.pal.land} strokeWidth={H * 0.008} />)}
      <polygon points={pts([[x - lr.w * 0.62, lr.y0], [x + lr.w * 0.62, lr.y0], [x, lr.y0 - H * 0.09]])} fill={body} />
      <line x1={x} x2={x} y1={lr.y0 - H * 0.09} y2={lr.y0 - H * 0.13} stroke={body} strokeWidth={H * 0.008} />
      {flare > 0.01 && <circle cx={lc.x} cy={lc.y} r={H * 0.06} fill="#fffbe8" opacity={flare} />}
    </g>
  );
};

const Hut: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const z = s.size * c.S, x = s.x * c.W, y = s.y * c.H;
  const w = s.window * (0.85 + 0.15 * noise(c.t * 3, 5));
  return (
    <g opacity={s.opacity * s.enter}>
      {w > 0.01 && <circle cx={x + z * 0.12} cy={y - z * 0.32} r={z * 1.6} fill={`url(#${c.id}-lamp)`} opacity={0.5 * w} />}
      <rect x={x - z * 0.5} y={y - z * 0.6} width={z} height={z * 0.6} fill={c.pal.land} />
      <polygon points={pts([[x - z * 0.62, y - z * 0.58], [x, y - z * 1.05], [x + z * 0.62, y - z * 0.58]])} fill={c.pal.land} />
      <rect x={x + z * 0.2} y={y - z * 1.0} width={z * 0.12} height={z * 0.3} fill={c.pal.land} />
      <rect x={x + z * 0.02} y={y - z * 0.44} width={z * 0.22} height={z * 0.2} fill={w > 0.01 ? LANTERN : c.pal.land} opacity={w > 0.01 ? w : 1} />
      <rect x={x - z * 0.3} y={y - z * 0.4} width={z * 0.16} height={z * 0.4} fill="#000" opacity={0.3} />
    </g>
  );
};

const Boat: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const b = bandFor(s.depth);
  const sea = c.swell;
  const wy = waveY(b, s.x, c.t, sea, c.horizon);
  const slope = (waveY(b, s.x + 0.012, c.t, sea, c.horizon) - waveY(b, s.x - 0.012, c.t, sea, c.horizon)) / 0.024;
  const L = s.size * c.S, x = s.x * c.W, y = (s.y ?? wy) * c.H;
  const roll = (Math.atan((slope * c.H) / c.W) * 180) / Math.PI * s.rock + Math.sin(c.t * 1.1) * 2 * s.rock * (0.4 + sea);
  const hull = mixHex(c.pal.land, c.pal.rim, 0.1), sail = mixHex(c.pal.land, c.pal.rim, 0.26);
  const lan = s.lantern * (0.8 + 0.2 * noise(c.t * 6, 2));
  const P = (px: number, py: number) => `${(px * L).toFixed(1)},${(py * L).toFixed(1)}`;
  return (
    <g opacity={s.opacity * s.enter}>
      {lan > 0.01 && Array.from({ length: 5 }, (_, k) => (
        <line key={k} x1={x - L * 0.18 * s.facing - L * 0.03} x2={x - L * 0.18 * s.facing + L * 0.03} y1={y + L * (0.1 + k * 0.07)} y2={y + L * (0.1 + k * 0.07)} stroke={LANTERN} strokeWidth={L * 0.012} strokeLinecap="round" opacity={lan * 0.5 * (1 - k / 5) * (0.5 + 0.5 * Math.sin(c.t * 3 + k))} />
      ))}
      <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${roll.toFixed(2)}) scale(${s.facing} 1)`}>
        {lan > 0.01 && <circle cx={-0.18 * L} cy={-0.3 * L} r={L * 0.9} fill={`url(#${c.id}-lamp)`} opacity={lan * 0.7} />}
        <line x1={0.08 * L} x2={0.08 * L} y1={-0.08 * L} y2={-0.82 * L} stroke={hull} strokeWidth={L * 0.018} />
        <polygon points={`${P(0.1, -0.78)} ${P(0.1, -0.16)} ${P(0.46, -0.18)}`} fill={sail} />
        <polygon points={`${P(0.06, -0.62)} ${P(0.06, -0.18)} ${P(-0.2, -0.2)}`} fill={sail} opacity={0.85} />
        <rect x={-0.32 * L} y={-0.24 * L} width={0.26 * L} height={0.14 * L} fill={hull} />
        <path d={`M ${P(-0.52, -0.1)} L ${P(0.52, -0.14)} Q ${P(0.4, 0.07)} ${P(0.22, 0.08)} L ${P(-0.34, 0.08)} Q ${P(-0.48, 0.04)} ${P(-0.52, -0.1)} Z`} fill={hull} />
        <rect x={-0.205 * L} y={-0.34 * L} width={0.05 * L} height={0.07 * L} fill={lan > 0.01 ? "#fff2c8" : hull} opacity={lan > 0.01 ? Math.max(0.3, lan) : 1} />
      </g>
      <path d={`M ${(x - L * 0.58).toFixed(1)},${(y + L * 0.06).toFixed(1)} q ${(L * 0.29).toFixed(1)},${(-L * 0.03).toFixed(1)} ${(L * 0.58).toFixed(1)},0 t ${(L * 0.58).toFixed(1)},0`} fill="none" stroke="#e9eef2" strokeWidth={L * 0.012} opacity={0.35} />
    </g>
  );
};

const Shore: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const top: [number, number][] = [];
  for (let k = 0; k <= 40; k++) { const x = -0.7 + (2.4 * k) / 40; top.push([x * c.W, (s.y + (noise(k * 0.5, 11) - 0.5) * 0.03 + Math.sin(x * 2.2) * 0.015) * c.H]); }
  return (
    <g opacity={s.opacity * s.enter}>
      <polygon points={pts([[-0.7 * c.W, 1.6 * c.H], ...top, [1.7 * c.W, 1.6 * c.H]])} fill={c.pal.land} />
      <polyline points={pts(top)} fill="none" stroke={c.pal.rim} strokeWidth={1.4 * (c.S / 1080)} opacity={0.18} />
    </g>
  );
};

const Figure: React.FC<{ c: Ctx; s: any; walking: number }> = ({ c, s, walking }) => {
  const L = s.size * c.S, x = s.x * c.W, y = s.y * c.H;
  const step = walking > 0 ? Math.sin(c.t * 5.5) : 0;
  const bob = walking > 0 ? Math.abs(Math.sin(c.t * 5.5)) * L * 0.012 : 0;
  const lan = s.lantern * (0.8 + 0.2 * noise(c.t * 7, 3));
  const ink = c.pal.land;
  const P = (px: number, py: number) => `${(px * L).toFixed(1)},${(py * L).toFixed(1)}`;
  return (
    <g opacity={s.opacity * s.enter}>
      {lan > 0.01 && <circle cx={x + s.facing * L * 0.26} cy={y - L * 0.36} r={L * 1.4} fill={`url(#${c.id}-lamp)`} opacity={lan * 0.75} />}
      <g transform={`translate(${x.toFixed(1)} ${(y - bob).toFixed(1)}) scale(${s.facing} 1)`}>
        <path d={`M ${P(-0.04, -0.16)} L ${P(-0.06 - step * 0.05, 0)} L ${P(-0.01 - step * 0.05, 0)} L ${P(0.01, -0.16)} Z`} fill={ink} />
        <path d={`M ${P(0.03, -0.16)} L ${P(0.04 + step * 0.05, 0)} L ${P(0.09 + step * 0.05, 0)} L ${P(0.08, -0.16)} Z`} fill={ink} />
        <path d={`M ${P(-0.05, -0.8)} Q ${P(0.06, -0.86)} ${P(0.12, -0.76)} L ${P(0.16, -0.16)} L ${P(-0.12, -0.16)} Q ${P(-0.12, -0.5)} ${P(-0.05, -0.8)} Z`} fill={ink} />
        <path d={`M ${P(0.08, -0.7)} Q ${P(0.2, -0.56)} ${P(0.25, -0.46)} L ${P(0.22, -0.44)} Q ${P(0.13, -0.55)} ${P(0.06, -0.62)} Z`} fill={ink} />
        <circle cx={0.07 * L} cy={-0.87 * L} r={0.065 * L} fill={ink} />
        <path d={`M ${P(-0.04, -0.9)} L ${P(0.19, -0.9)} L ${P(0.16, -0.93)} L ${P(0.12, -1.0)} L ${P(0.02, -1.0)} L ${P(-0.01, -0.93)} Z`} fill={ink} />
        <line x1={0.24 * L} x2={0.24 * L} y1={-0.45 * L} y2={-0.41 * L} stroke={ink} strokeWidth={L * 0.008} />
        <rect x={0.205 * L} y={-0.41 * L} width={0.07 * L} height={0.09 * L} rx={L * 0.01} fill={lan > 0.01 ? "#fff0c0" : ink} opacity={lan > 0.01 ? Math.max(0.35, lan) : 1} />
      </g>
    </g>
  );
};

const Fire: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const r = s.r * c.S, x = s.x * c.W, y = s.y * c.H;
  const k = s.intensity * s.opacity * s.enter;
  if (k < 0.01) return null;
  const flick = (i: number) => 0.82 + 0.3 * noise(c.t * 7 + i * 3, i + 20);
  const flame = (h: number, w: number, color: string, i: number) => {
    const f = flick(i), sway = (noise(c.t * 3 + i, i + 30) - 0.5) * w * 0.8;
    return <path key={i} d={`M ${x - w},${y} Q ${x - w * 0.9},${y - h * 0.5 * f} ${x + sway},${y - h * f} Q ${x + w * 0.9},${y - h * 0.5 * f} ${x + w},${y} Z`} fill={color} />;
  };
  return (
    <g opacity={k}>
      <circle cx={x} cy={y - r * 0.6} r={r * 7 * flick(0)} fill={`url(#${c.id}-fire)`} />
      <ellipse cx={x} cy={y + r * 0.1} rx={r * 3.5} ry={r * 0.5} fill={c.pal.glow} opacity={0.25 * flick(1)} />
      <rect x={x - r * 1.1} y={y - r * 0.12} width={r * 2.2} height={r * 0.22} fill={c.pal.land} transform={`rotate(12 ${x} ${y})`} />
      <rect x={x - r * 1.1} y={y - r * 0.12} width={r * 2.2} height={r * 0.22} fill={c.pal.land} transform={`rotate(-14 ${x} ${y})`} />
      {flame(r * 2.3, r * 0.85, "#ff6a24", 1)}
      {flame(r * 1.7, r * 0.6, "#ffa83a", 2)}
      {flame(r * 1.0, r * 0.34, "#fff0b5", 3)}
      {Array.from({ length: 16 }, (_, i) => {
        const ph = (c.t * (0.35 + hash(i, 70) * 0.4) + hash(i, 71)) % 1;
        const ex = x + (hash(i, 72) - 0.5) * r * 1.6 + Math.sin(c.t * 2 + i) * r * 0.5 * ph;
        return <circle key={i} cx={ex} cy={y - r * (0.8 + ph * 6)} r={r * 0.045 * (1 - ph * 0.5)} fill="#ffc46a" opacity={(1 - ph) * 0.9} />;
      })}
    </g>
  );
};

const Title: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => (
  <text x={s.x * c.W} y={s.y * c.H} textAnchor="middle" dominantBaseline="middle" fontFamily={c.fonts.body} fontWeight={700}
    fontSize={s.size * c.S} letterSpacing={`${0.18 * s.size * c.S}px`} fill={mixHex("#f4eedc", c.pal.rim, 0.25)}
    opacity={s.opacity * s.enter} style={{ filter: `drop-shadow(0 0 ${(s.size * c.S * 0.35).toFixed(1)}px rgba(0,0,0,0.6))` }}>
    {s.text}
  </text>
);

const Rain: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => {
  const a = s.intensity * s.opacity * s.enter;
  if (a < 0.01) return null;
  const n = Math.round(260 * Math.min(1, a));
  return (
    <g>
      <rect width={c.W} height={c.H} fill={c.pal.haze} opacity={0.14 * a} />
      {Array.from({ length: n }, (_, k) => {
        const sp = 1.5 + hash(k, 81) * 0.9, len = 0.04 + 0.05 * hash(k, 82);
        const ph = (c.t * sp + hash(k, 83)) % 1;
        const y = ph * 1.3 - 0.15, x = hash(k, 84) * 1.4 - 0.2 - s.wind * ph * 0.3;
        return <line key={k} x1={x * c.W} y1={y * c.H} x2={(x - s.wind * len) * c.W} y2={(y + len) * c.H} stroke={c.pal.rim} strokeWidth={(0.8 + hash(k, 85)) * (c.S / 1080)} opacity={a * (0.2 + 0.35 * hash(k, 86))} />;
      })}
    </g>
  );
};

const Bolts: React.FC<{ c: Ctx; s: any }> = ({ c, s }) => (
  <g>
    {(s.strikes ?? []).map((st: any, i: number) => {
      const f = flashAt(c.t - (st.t ?? 0));
      if (f < 0.25) return null;
      const { main, branch } = boltPath(st.x ?? s.x, c.horizon, i * 7 + 3);
      const line = (p: [number, number][]) => pts(p.map(([x, y]) => [x * c.W, y * c.H]));
      return (
        <g key={i} opacity={f * s.opacity}>
          <polyline points={line(main)} fill="none" stroke={c.pal.rim} strokeWidth={c.S * 0.012} opacity={0.35} strokeLinejoin="round" />
          <polyline points={line(main)} fill="none" stroke="#ffffff" strokeWidth={c.S * 0.003} strokeLinejoin="round" />
          <polyline points={line(branch)} fill="none" stroke="#ffffff" strokeWidth={c.S * 0.0018} strokeLinejoin="round" opacity={0.8} />
        </g>
      );
    })}
  </g>
);

export const TableauScene: React.FC<Props> = ({ elements = [], camera = [] }) => {
  const scene = useScene();
  const theme = useTheme();
  const { width: W, height: H } = useLayout();
  const t = useTime();
  const id = `tb-${scene.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cam = cameraAt(camera, t);
  const pal = paletteAt(elements, t);
  const states = elements.map((el) => ({ el, s: elementAt(el, t) })).filter((x) => x.s.shown);
  const sea = states.find((x) => x.el.type === "sea")?.s;
  const horizon = sea?.y ?? 0.66;
  const c: Ctx = { W, H, S: Math.min(W, H), t, pal, horizon, swell: sea?.swell ?? 0.3, id, fonts: theme.fonts };
  const flash = flashTotal(elements, t);
  const shore = states.find((x) => x.el.type === "shore")?.s;
  const moon = states.find((x) => x.el.type === "moon")?.s ?? states.find((x) => x.el.type === "sun")?.s;
  const glint = moon && sea && sea.reflect > 0 ? { x: moon.x, a: moon.opacity * moon.enter * sea.reflect * (1 - 0.8 * (states.find((x) => x.el.type === "clouds")?.s.cover ?? 0) ** 2) } : null;
  // Horizon on screen, as the farthest sea band sees the camera: the sky gradient meets it.
  const fv = layerView(cam, bandDepth(0));
  const hz = Math.min(0.98, Math.max(0.05, (horizon - fv.cy) * fv.scale + 0.5));

  // Draw back to front: every piece in its depth's layer; the sea is one layer per band, and a
  // shore in front replaces the bands it would cover.
  type Draw = { depth: number; order: number; node: React.ReactNode };
  const draws: Draw[] = [];
  const walkingOf = (el: El) => Math.abs(elementAt(el, t + 0.1).x - elementAt(el, t - 0.1).x) > 0.0005 ? 1 : 0;
  states.forEach(({ el, s }, order) => {
    const node = (() => {
      switch (el.type) {
        case "stars": return <Stars c={c} s={s} />;
        case "moon": return <Moon c={c} s={s} />;
        case "sun": return <Sun c={c} s={s} />;
        case "clouds": return <Clouds c={c} s={s} />;
        case "cliff": return <Cliff c={c} s={s} />;
        case "lighthouse": return <Lighthouse c={c} s={{ ...s, id: el.id }} />;
        case "hut": return <Hut c={c} s={s} />;
        case "boat": return <Boat c={c} s={s} />;
        case "shore": return <Shore c={c} s={s} />;
        case "figure": return <Figure c={c} s={s} walking={walkingOf(el)} />;
        case "fire": return <Fire c={c} s={s} />;
        case "title": return <Title c={c} s={s} />;
        case "lightning": return <Bolts c={c} s={{ ...s, strikes: el.strikes }} />;
        case "sea": {
          for (let i = 0; i < SEA_BANDS; i++) {
            if (shore && bandDepth(i) > shore.depth) continue;
            draws.push({ depth: bandDepth(i), order: -1, node: <SeaBand key={`sea${i}`} c={c} i={i} s={s} glint={glint} /> });
          }
          return null;
        }
        default: return null;
      }
    })();
    if (node && el.type !== "rain") draws.push({ depth: s.depth, order, node });
  });
  draws.sort((a, b) => a.depth - b.depth || a.order - b.order);
  const rain = states.find((x) => x.el.type === "rain")?.s;
  const moving = cameraMoving(camera, t);

  return (
    <AbsoluteFill data-moving={moving ? "1" : undefined}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.top} />
            <stop offset={(hz * 0.6).toFixed(3)} stopColor={pal.mid} />
            <stop offset={hz.toFixed(3)} stopColor={pal.horizon} />
            <stop offset="1" stopColor={pal.haze} />
          </linearGradient>
          <radialGradient id={`${id}-moonglow`}>
            <stop offset="0" stopColor={pal.rim} stopOpacity={0.4} />
            <stop offset="0.35" stopColor={pal.rim} stopOpacity={0.12} />
            <stop offset="1" stopColor={pal.rim} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${id}-sunglow`}>
            <stop offset="0" stopColor="#fff1cf" stopOpacity={0.85} />
            <stop offset="0.3" stopColor={pal.glow} stopOpacity={0.35} />
            <stop offset="1" stopColor={pal.glow} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${id}-lamp`}>
            <stop offset="0" stopColor={LANTERN} stopOpacity={0.75} />
            <stop offset="0.25" stopColor={LANTERN} stopOpacity={0.22} />
            <stop offset="1" stopColor={LANTERN} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${id}-fire`}>
            <stop offset="0" stopColor="#ffb54d" stopOpacity={0.6} />
            <stop offset="0.3" stopColor="#ff8a3a" stopOpacity={0.2} />
            <stop offset="1" stopColor="#ff6a24" stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${id}-cloud`}>
            <stop offset="0" stopColor={pal.cloud} stopOpacity={0.95} />
            <stop offset="0.6" stopColor={pal.cloud} stopOpacity={0.55} />
            <stop offset="1" stopColor={pal.cloud} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${id}-haze`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={pal.haze} stopOpacity={0} />
            <stop offset="0.5" stopColor={pal.haze} stopOpacity={0.35} />
            <stop offset="1" stopColor={pal.haze} stopOpacity={0} />
          </linearGradient>
          <radialGradient id={`${id}-vignette`} cx="50%" cy="50%" r="75%">
            <stop offset="0.55" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.6} />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-sky)`} />
        {draws.filter((d) => d.depth < bandDepth(0) - 0.05).map((d, i) => <g key={`b${i}`} transform={layerTransform(cam, d.depth, W, H)}>{d.node}</g>)}
        <rect x={0} y={(hz - 0.07) * H} width={W} height={0.14 * H} fill={`url(#${id}-haze)`} />
        {draws.filter((d) => d.depth >= bandDepth(0) - 0.05).map((d, i) => <g key={`f${i}`} transform={layerTransform(cam, d.depth, W, H)}>{d.node}</g>)}
        {rain && <Rain c={c} s={rain} />}
        {flash > 0.01 && <rect width={W} height={H} fill={mixHex(pal.rim, "#ffffff", 0.6)} opacity={flash * 0.42} />}
        <rect width={W} height={H} fill={`url(#${id}-vignette)`} />
      </svg>
    </AbsoluteFill>
  );
};
