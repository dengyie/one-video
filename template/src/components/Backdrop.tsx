import React, { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "../engine/context";
import type { Background } from "../engine/types";

const Stars: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stars = useMemo(
    () =>
      Array.from({ length: Math.round((width * height) / 15000) }, (_, i) => ({
        x: random(`x${i}`) * width,
        y: random(`y${i}`) * height,
        r: 0.6 + random(`r${i}`) * 1.6,
        p: random(`p${i}`) * Math.PI * 2,
        s: 0.05 + random(`s${i}`) * 0.25,
      })),
    [width, height],
  );
  return (
    <svg width={width} height={height} style={{ position: "absolute" }}>
      {stars.map((s, i) => (
        <circle key={i} cx={(s.x - frame * s.s + width * 10) % width} cy={s.y} r={s.r} fill="#fff" opacity={0.12 + 0.3 * (0.5 + 0.5 * Math.sin(frame / 40 + s.p))} />
      ))}
    </svg>
  );
};

const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const step = Math.min(width, height) / 12;
  const off = (frame * 0.25) % step;
  return (
    <svg width={width} height={height} style={{ position: "absolute", opacity: 0.5 }}>
      <defs>
        <radialGradient id="ov-grid-fade" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="ov-grid-mask"><rect width={width} height={height} fill="url(#ov-grid-fade)" /></mask>
      </defs>
      <g mask="url(#ov-grid-mask)" stroke={theme.colors.border} strokeWidth={1}>
        {Array.from({ length: Math.ceil(width / step) + 2 }, (_, i) => <line key={`v${i}`} x1={i * step - off} y1={0} x2={i * step - off} y2={height} />)}
        {Array.from({ length: Math.ceil(height / step) + 2 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * step - off} x2={width} y2={i * step - off} />)}
      </g>
    </svg>
  );
};

// Slowly drifting light blobs keep "static" scenes from reading as frozen frames.
const Glow: React.FC = () => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const a = frame / 300;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(circle at ${50 + 30 * Math.cos(a)}% ${30 + 15 * Math.sin(a * 1.3)}%, ${theme.colors.accent}22 0%, transparent 45%)`,
          `radial-gradient(circle at ${40 + 25 * Math.sin(a * 0.8)}% ${75 + 10 * Math.cos(a)}%, ${theme.colors.accent2}18 0%, transparent 40%)`,
        ].join(","),
      }}
    />
  );
};

// Code-drawn backdrops for projects without photos (pipeline graphics): every one is a pure
// function of the frame, so a still and the render agree and a re-render is identical.

// Slow ribbons of light in the theme accents, crossing the upper half of the frame.
const Aurora: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const t = frame / 30;
  const ribbons = [
    { color: theme.colors.accent, y: 0.28, amp: 0.07, k: 1.6, speed: 0.11, phase: 0, w: 0.16 },
    { color: theme.colors.accent2, y: 0.4, amp: 0.06, k: 2.3, speed: -0.08, phase: 1.7, w: 0.12 },
    { color: theme.palette[2] ?? theme.colors.highlight, y: 0.2, amp: 0.05, k: 3.1, speed: 0.06, phase: 3.1, w: 0.08 },
  ];
  const path = (r: (typeof ribbons)[number], off: number) => {
    const pts = Array.from({ length: 25 }, (_, i) => {
      const x = i / 24;
      const y = r.y + off + r.amp * Math.sin(x * r.k * Math.PI + t * r.speed * Math.PI * 2 + r.phase) + 0.02 * Math.sin(x * 7 + t * 0.4 + r.phase);
      return `${(x * width).toFixed(1)},${(y * height).toFixed(1)}`;
    });
    return pts;
  };
  return (
    <svg width={width} height={height} style={{ position: "absolute", filter: `blur(${Math.min(width, height) / 40}px)` }}>
      {ribbons.map((r, i) => {
        const top = path(r, -r.w / 2), bottom = path(r, r.w / 2).reverse();
        return <polygon key={i} points={[...top, ...bottom].join(" ")} fill={r.color} opacity={0.16 + 0.06 * Math.sin(t * 0.5 + r.phase)} />;
      })}
    </svg>
  );
};

// A drifting constellation: points wander on their own slow orbits; near pairs are joined.
const Particles: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const u = Math.min(width, height) / 1080;
  const pts = useMemo(
    () =>
      Array.from({ length: Math.round((width * height) / 36000) }, (_, i) => ({
        x: random(`px${i}`), y: random(`py${i}`),
        rx: 0.02 + random(`prx${i}`) * 0.05, ry: 0.02 + random(`pry${i}`) * 0.05,
        w: (0.15 + random(`pw${i}`) * 0.35) * (random(`pd${i}`) > 0.5 ? 1 : -1),
        p: random(`pp${i}`) * Math.PI * 2,
        r: (1.5 + random(`pr${i}`) * 2.5) * u,
      })),
    [width, height, u],
  );
  const t = frame / 30;
  const at = pts.map((q) => [(q.x + q.rx * Math.cos(t * q.w + q.p)) * width, (q.y + q.ry * Math.sin(t * q.w * 1.3 + q.p)) * height]);
  const reach = 230 * u;
  const links: React.ReactNode[] = [];
  for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
    const d = Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1]);
    if (d < reach) links.push(<line key={`${i}-${j}`} x1={at[i][0]} y1={at[i][1]} x2={at[j][0]} y2={at[j][1]} stroke={theme.colors.accent2} strokeWidth={1.4 * u} opacity={0.42 * (1 - d / reach)} />);
  }
  return (
    <svg width={width} height={height} style={{ position: "absolute" }}>
      {links}
      {at.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={pts[i].r} fill={i % 5 === 0 ? theme.colors.accent : theme.colors.text} opacity={0.55} />)}
    </svg>
  );
};

// Contour lines of a slowly shifting swell, like a topographic plot seen from above.
const Waves: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const u = Math.min(width, height) / 1080;
  const t = frame / 30;
  const rows = 14;
  return (
    <svg width={width} height={height} style={{ position: "absolute" }}>
      {Array.from({ length: rows }, (_, k) => {
        const base = 0.45 + (k / rows) * 0.6;
        const d = Array.from({ length: 41 }, (_, i) => {
          const x = i / 40;
          const y = base + 0.035 * Math.sin(x * 5 + t * 0.35 + k * 0.45) + 0.02 * Math.sin(x * 11 - t * 0.22 + k);
          return `${i ? "L" : "M"}${(x * width).toFixed(1)},${(y * height).toFixed(1)}`;
        }).join("");
        return <path key={k} d={d} fill="none" stroke={k % 4 === 0 ? theme.colors.accent : theme.colors.border} strokeWidth={1.4 * u} opacity={0.25 + 0.35 * (k / rows)} />;
      })}
    </svg>
  );
};

export const Backdrop: React.FC<{ variant: Background }> = ({ variant }) => {
  const theme = useTheme();
  const v = variant === "default" ? theme.background : variant;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 70% 20%, ${theme.colors.bgAlt} 0%, ${theme.colors.bg} 70%)` }}>
      {v !== "plain" && <Glow />}
      {v === "stars" && <Stars />}
      {v === "grid" && <Grid />}
      {v === "aurora" && <Aurora />}
      {v === "particles" && <Particles />}
      {v === "waves" && <Waves />}
    </AbsoluteFill>
  );
};
