import React from "react";
import { Img, staticFile } from "remotion";
import { Highlight, Underline } from "@remotion/rough-notation";
import { colorAt, cueOr, textEms, useLayout, useRevealAt, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { fmt, fmtCount } from "../engine/format";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import type { Format } from "../engine/types";
import { Icon } from "../components/Icon";
import { Stage, Title } from "./Stage";
import { niceTicks } from "./Data";

// ── kinetic ──────────────────────────────────────────────────────────────────
// Narration-synced typography: each line reveals word by word (character by character for CJK
// text, which Intl.Segmenter splits into words where it can).

type KLine = { text: string; cue?: string; style?: "rise" | "slam" | "type" | "blur"; emphasis?: string[]; size?: number; color?: string };

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new (Intl as any).Segmenter("zh", { granularity: "word" }) : null;
export function segments(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text) as Iterable<{ segment: string }>, (s) => s.segment);
  return text.split(/(\s+)/).filter(Boolean);
}

const KineticLine: React.FC<{ line: KLine; at: number; align: "left" | "center" }> = ({ line, at, align }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const t = useTime();
  const style = line.style ?? "rise";
  const segs = segments(line.text);
  const step = style === "type" ? 0.045 : style === "slam" ? 0.09 : 0.07;
  const emph = new Set(line.emphasis ?? []);
  const size = (line.size ?? 1) * (portrait ? 92 : 96) * u;
  const done = at + segs.length * step + 0.3;
  let cursor = 0;
  return (
    <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.22, textAlign: align, color: line.color ?? theme.colors.text, letterSpacing: 1 * u }}>
      {segs.map((seg, i) => {
        const s = at + i * step;
        const p = style === "type" ? (t >= s ? 1 : 0) : easeOut((t - s) / (style === "slam" ? 0.22 : 0.4));
        const isEmph = emph.has(seg.trim());
        let tf = "";
        let blur: string | undefined;
        if (style === "rise") tf = `translateY(${(1 - p) * 0.45}em)`;
        else if (style === "slam") tf = `scale(${lerp(1.8, 1, easeOutBack(clamp01((t - s) / 0.25)))})`;
        else if (style === "blur") blur = `blur(${(1 - p) * 10 * u}px)`;
        cursor = t >= s ? i : cursor;
        const node = (
          <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: p, transform: tf || undefined, filter: blur, color: isEmph ? theme.colors.accent : undefined }}>
            {seg}
          </span>
        );
        if (!isEmph) return node;
        const hp = clamp01((t - done) / 0.6);
        return (
          <Underline key={i} progress={hp} color={theme.colors.accent} strokeWidth={4 * u} padding={{ top: 4 * u }} iterations={1}>
            {node}
          </Underline>
        );
      })}
      {style === "type" && t >= at && t < done + 0.6 && <span style={{ opacity: Math.floor(t * 2.4) % 2 ? 0 : 0.9, color: theme.colors.accent }}>▍</span>}
    </div>
  );
};

export const KineticScene: React.FC<{ lines: KLine[]; align?: "left" | "center"; kicker?: string; number?: { value: number; format?: Format; label?: string; cue?: string } }> = ({
  lines, align = "center", kicker, number,
}) => {
  const theme = useTheme();
  const { u } = useLayout();
  const at = useRevealAt();
  const scene = useScene();
  const t = useTime();
  const k = easeOut((t - 0.05) / 0.5);
  const nAt = number ? cueOr(scene, number.cue, at(lines.length, lines.length + 1)) : 0;
  const np = number ? easeOut((t - nAt) / 0.9) : 0;
  // The count-up runs small, then slams to full size; easeOutBack's overshoot is the pop, so it settles without a jump.
  const slam = number ? easeOutBack(clamp01((t - nAt - 0.75) / 0.3)) : 0;
  return (
    <Stage center style={{ alignItems: align === "center" ? "center" : "flex-start", gap: 18 * u }}>
      {kicker && <div style={{ opacity: k, fontSize: 30 * u, letterSpacing: 6 * u, color: theme.colors.accent, fontWeight: 700 }}>{kicker}</div>}
      {lines.map((l, i) => <KineticLine key={i} line={l} at={at(i, lines.length + (number ? 1 : 0), l.cue)} align={align} />)}
      {number && (
        <div style={{ textAlign: align, opacity: clamp01((t - nAt) / 0.2) }}>
          <div style={{ fontFamily: theme.fonts.number, fontSize: 190 * u, fontWeight: 900, lineHeight: 1, color: theme.colors.accent, transform: `scale(${lerp(0.76, 1, slam)})` }}>
            {fmtCount(number.value * np, number.value, number.format)}
          </div>
          {number.label && <div style={{ fontSize: 34 * u, color: theme.colors.muted, marginTop: 10 * u }}>{number.label}</div>}
        </div>
      )}
    </Stage>
  );
};

// ── headline ─────────────────────────────────────────────────────────────────
// News cards dropped onto the frame in perspective; the key phrase gets a hand-drawn highlight.

type HeadlineItem = { outlet: string; title: string; date?: string; excerpt?: string; highlight?: string; cue?: string; asset?: string };

const HeadlineCard: React.FC<{ item: HeadlineItem; at: number; i: number; n: number }> = ({ item, at, i, n }) => {
  const theme = useTheme();
  const tl = useTimeline();
  const { u, portrait, width, pad } = useLayout();
  const t = useTime();
  const p = easeOut((t - at) / 0.55);
  const lineP = easeInOut((t - at - 0.25) / 0.7);
  const hl = clamp01((t - at - 1.0) / 0.6);
  const tilt = (i % 2 ? 1 : -1) * (n > 1 ? 4 : 2);
  const offset = n > 1 ? (i - (n - 1) / 2) * 70 * u : 0;
  const a = item.asset ? tl.assets[item.asset] : null;
  const idx = item.highlight ? item.title.indexOf(item.highlight) : -1;
  const titleNode = idx < 0 ? item.title : (
    <>
      {item.title.slice(0, idx)}
      <Highlight progress={hl} color={theme.colors.highlight + "66"} iterations={1}>
        <span>{item.highlight}</span>
      </Highlight>
      {item.title.slice(idx + (item.highlight?.length ?? 0))}
    </>
  );
  // 1:1 and 4:5 are only 1080u wide: keep the card inside the side margins.
  const w = Math.min(portrait ? 900 : 1180, (width - 2 * pad) / u);
  return (
    <div
      style={{
        position: "absolute", left: "50%", top: "50%", width: w * u,
        transform: `translate(-50%, -50%) translate(${offset}px, ${offset * 0.55 + (1 - p) * 160 * u}px) perspective(${1600 * u}px) rotateX(${(1 - p) * 30}deg) rotateZ(${tilt * p + (1 - p) * tilt * 3}deg)`,
        opacity: clamp01(p * 1.4),
        background: "#f7f5f0", color: "#16181d", borderRadius: 10 * u, padding: `${40 * u}px ${52 * u}px`,
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.45)`, textShadow: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `${3 * u}px solid #16181d`, paddingBottom: 14 * u, marginBottom: 22 * u }}>
        <div style={{ fontSize: 30 * u, fontWeight: 900, letterSpacing: 2 * u, fontFamily: "Georgia, 'Songti SC', serif" }}>{item.outlet}</div>
        {item.date && <div style={{ fontSize: 22 * u, color: "#5b5f68", fontFamily: theme.fonts.number }}>{item.date}</div>}
      </div>
      <div style={{ display: "flex", gap: 30 * u }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 56 * u, fontWeight: 900, lineHeight: 1.25, clipPath: `inset(0 ${(1 - lineP) * 100}% 0 0)`, fontFamily: "Georgia, 'Songti SC', serif" }}>{titleNode}</div>
          {item.excerpt && <div style={{ fontSize: 26 * u, lineHeight: 1.55, color: "#3b3f48", marginTop: 18 * u, opacity: easeOut((t - at - 0.8) / 0.5) }}>{item.excerpt}</div>}
        </div>
        {a && a.kind === "image" && <Img src={staticFile(a.src)} style={{ width: 320 * u, height: 220 * u, objectFit: "cover", borderRadius: 4 * u }} />}
      </div>
    </div>
  );
};

export const HeadlineScene: React.FC<{ items: HeadlineItem[] }> = ({ items }) => {
  const at = useRevealAt();
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {items.map((it, i) => <HeadlineCard key={i} item={it} i={i} n={items.length} at={at(i, items.length, it.cue)} />)}
    </div>
  );
};

// ── unit-grid ────────────────────────────────────────────────────────────────
// Icon array: "37 of every 100". Groups fill in order, each at its cue.

type UnitGroup = { count: number; label: string; color?: string; cue?: string };

export const UnitGridScene: React.FC<{ title?: string; total?: number; columns?: number; icon?: string; groups: UnitGroup[]; note?: string }> = ({
  title, total, columns, icon = "user-round", groups, note,
}) => {
  const theme = useTheme();
  const { u, portrait, height, top, bottom, pad } = useLayout();
  const scene = useScene();
  const at = useRevealAt();
  const t = useTime();
  const sum = groups.reduce((n, g) => n + g.count, 0);
  const N = Math.max(total ?? 100, sum);
  const cols = columns ?? (N <= 20 ? Math.ceil(N / 2) : N <= 50 ? 10 : portrait ? 10 : 20);
  const rows = Math.ceil(N / cols);
  // Portrait stacks the legend under the grid: the grid gets what the Stage has left after the
  // title and an estimate of the legend (~129u a group, the note ~2 lines), so neither runs into the captions.
  const stageH = height - (scene.header ? top + 20 * u : pad) - bottom - (title ? 72 * u : 0);
  const legendH = groups.length * 129 * u + Math.max(0, groups.length - 1) * 26 * u + (note ? 92 * u : 0);
  const cell = Math.min(((portrait ? 900 : 1080) / cols) * u, ((portrait ? 900 : 560) / rows) * u, portrait ? Math.max(8 * u, (stageH - legendH - 60 * u) / rows) : Infinity);
  const owner: { g: number; k: number }[] = [];
  groups.forEach((g, gi) => { for (let k = 0; k < g.count; k++) owner.push({ g: gi, k }); });
  const starts = groups.map((g, i) => at(i, groups.length, g.cue));
  return (
    <Stage center style={{ alignItems: "center" }}>
      <Title text={title} />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", alignItems: "center", gap: 60 * u }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 0 }}>
          {Array.from({ length: N }, (_, i) => {
            const o = owner[i];
            const base = easeOut((t - 0.2 - i * 0.004) / 0.4);
            const g = o ? groups[o.g] : null;
            const fill = o ? easeOutBack(clamp01((t - starts[o.g] - o.k * Math.min(0.03, 1.2 / Math.max(1, g!.count))) / 0.3)) : 0;
            const color = g ? g.color ?? colorAt(theme, o!.g) : theme.colors.border;
            return (
              <div key={i} style={{ width: cell, height: cell, display: "flex", alignItems: "center", justifyContent: "center", opacity: base }}>
                <Icon name={icon} size={cell * 0.82} color={fill > 0.02 ? color : theme.colors.muted} style={{ opacity: fill > 0.02 ? 1 : 0.28, transform: `scale(${fill > 0.02 ? 0.7 + 0.3 * fill : 0.8})` }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 * u }}>
          {groups.map((g, i) => {
            const o = easeOut((t - starts[i]) / 0.5);
            const color = g.color ?? colorAt(theme, i);
            return (
              <div key={i} style={{ opacity: o, transform: `translateX(${(1 - o) * 30 * u}px)` }}>
                <div style={{ fontFamily: theme.fonts.number, fontSize: 84 * u, fontWeight: 900, color, lineHeight: 1 }}>{fmtCount(g.count * easeOut((t - starts[i]) / 0.8), g.count)}<span style={{ fontSize: 34 * u, color: theme.colors.muted }}> / {N}</span></div>
                <div style={{ fontSize: 30 * u, color: theme.colors.text, marginTop: 6 * u }}>{g.label}</div>
              </div>
            );
          })}
          {note && <div style={{ fontSize: 22 * u, color: theme.colors.muted, maxWidth: 420 * u, lineHeight: 1.5 }}>{note}</div>}
        </div>
      </div>
    </Stage>
  );
};

// ── scale-compare ────────────────────────────────────────────────────────────
// Magnitudes too far apart for one axis: circles sized by area, the camera zooming out from the
// smallest to the largest so each step reads as "and this is how much bigger".

type ScaleItem = { label: string; value: number; format?: Format; color?: string; cue?: string; note?: string };

export const ScaleCompareScene: React.FC<{ title?: string; items: ScaleItem[]; shape?: "circle" | "square" }> = ({ title, items, shape = "circle" }) => {
  const theme = useTheme();
  const { u, width, height, portrait, narrow, pad } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const sorted = [...items].sort((a, b) => a.value - b.value);
  // Guarded so an all-zero list gives tiny circles rather than NaN radii.
  const R = sorted.map((it) => Math.sqrt(Math.max(1e-12, it.value / Math.max(1e-12, sorted[sorted.length - 1].value))));
  const starts = sorted.map((it, i) => at(i, sorted.length, it.cue));
  // Narrow frames (9:16, 1:1, 4:5) have no spare width beside a 0.33-short-edge circle: the label
  // column takes ~42% of the content width and the circle gets what is left, flush with the margin.
  const gap = (narrow ? 80 : 120) * u;
  const colW = narrow ? (width - 2 * pad) * 0.42 : width - pad - (width * 0.4 + Math.min(width, height) * 0.33 + gap);
  // Zoom so the newest item fills ~70% of the short edge; interpolate in log space between steps.
  const frameR = Math.min(Math.min(width, height) * 0.33, narrow ? (width - 2 * pad - colW - gap) / 2 : Infinity);
  const cx = narrow ? pad + frameR : width * 0.4;
  // One label scale for every row, small enough that the widest stays inside the column.
  const labelK = Math.min(1, ...sorted.map((it) => colW / Math.max(textEms(fmt(it.value, it.format)) * 60 * u, textEms(it.label + (it.note ? ` · ${it.note}` : "")) * 30 * u, 1)));
  let logZ = Math.log(frameR / Math.max(1e-6, R[0]));
  for (let i = 1; i < sorted.length; i++) {
    const p = easeInOut((t - starts[i] + 0.2) / 1.1);
    logZ = lerp(logZ, Math.log(frameR / R[i]), p);
  }
  const z = Math.exp(logZ);
  const baseY = height * (portrait ? 0.62 : 0.74);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Stage><Title text={title} /></Stage>
      {sorted.map((it, i) => {
        const r = R[i] * z;
        const o = easeOut((t - starts[i]) / 0.5);
        const color = it.color ?? colorAt(theme, i);
        // Labels sit in a column right of the biggest circle (largest on top), joined to their
        // circle's upper-right edge by a leader line, so nested circles never collide.
        const labelO = o * clamp01(1.6 - Math.abs(Math.log(r / frameR)) / 4);
        const ex = cx + r * Math.SQRT1_2, ey = baseY - r - r * Math.SQRT1_2;
        const colX = cx + frameR + gap;
        const rows = sorted.length;
        const colY = height * (portrait ? 0.2 : 0.24) + ((rows - 1 - i) * (baseY - height * 0.3)) / Math.max(1, rows - 1) * 0.85;
        return (
          <React.Fragment key={i}>
            <div style={{
              position: "absolute", left: cx - r, top: baseY - 2 * r, width: 2 * r, height: 2 * r,
              borderRadius: shape === "circle" ? "50%" : 8 * u, background: color + "33", border: `${Math.max(1, 3 * u)}px solid ${color}`,
              opacity: o, transform: `scale(${0.6 + 0.4 * o})`, transformOrigin: "50% 100%",
            }} />
            <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: labelO, overflow: "visible" }}>
              <polyline points={`${ex},${ey} ${colX - 40 * u},${colY + 40 * u} ${colX - 12 * u},${colY + 40 * u}`} fill="none" stroke={color} strokeWidth={2 * u} />
              <circle cx={ex} cy={ey} r={5 * u} fill={color} />
            </svg>
            <div style={{ position: "absolute", left: colX, top: colY, opacity: labelO, whiteSpace: "nowrap", transform: `translateX(${(1 - labelO) * 20 * u}px)` }}>
              <div style={{ fontFamily: theme.fonts.number, fontSize: 60 * u * labelK, fontWeight: 900, color, lineHeight: 1.1 }}>{fmt(it.value, it.format)}</div>
              <div style={{ fontSize: 30 * u * labelK, color: theme.colors.text }}>{it.label}{it.note ? <span style={{ color: theme.colors.muted }}> · {it.note}</span> : null}</div>
            </div>
          </React.Fragment>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: baseY, height: 2 * u, background: theme.colors.border }} />
      {/* No ratio against a zero: it would read ×Infinity. */}
      {sorted.length > 1 && sorted[0].value > 0 && (
        <div style={{ position: "absolute", right: 96 * u, top: baseY + 24 * u, fontSize: 30 * u, color: theme.colors.muted, fontFamily: theme.fonts.number, opacity: easeOut((t - starts[sorted.length - 1] - 0.8) / 0.5) }}>
          ×{fmt(sorted[sorted.length - 1].value / sorted[0].value, { compact: "zh" })}
        </div>
      )}
    </div>
  );
};

// ── price-chart ──────────────────────────────────────────────────────────────
// Market line (or candles) drawn by a pen dot that carries the live price; event flags pop as
// the pen passes them.

type PEvent = { x: string; label: string; cue?: string; tone?: "up" | "down" | "neutral" };

export const PriceChartScene: React.FC<{
  title?: string; points?: [string, number][]; candles?: [string, number, number, number, number][];
  format?: Format; events?: PEvent[]; drawCue?: string; baseline?: number; area?: boolean; label?: string;
}> = ({ title, points, candles, format, events = [], drawCue, baseline, area = true, label }) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, width, height, pad, top, bottom, portrait } = useLayout();
  const t = useTime();
  const xs = candles ? candles.map((c) => c[0]) : (points ?? []).map((p) => p[0]);
  const closes = candles ? candles.map((c) => c[4]) : (points ?? []).map((p) => p[1]);
  const lows = candles ? candles.map((c) => c[3]) : closes;
  const highs = candles ? candles.map((c) => c[2]) : closes;
  const n = xs.length;
  if (n < 2) return null;
  const lo0 = Math.min(...lows, baseline ?? Infinity), hi0 = Math.max(...highs, baseline ?? -Infinity);
  const ticks = niceTicks(lo0 - (hi0 - lo0) * 0.05, hi0 + (hi0 - lo0) * 0.05, 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const L = pad + 40 * u, R = width - pad - (portrait ? 40 : 180) * u, T = (scene.header ? top + 40 * u : pad + (title ? 170 : 80) * u), B = height - bottom - 50 * u;
  const X = (i: number) => L + ((R - L) * i) / (n - 1);
  const Y = (v: number) => B - ((B - T) * (v - lo)) / Math.max(1e-9, hi - lo);
  const d0 = cueOr(scene, drawCue, 0.5);
  const d1 = d0 + Math.max(1.5, Math.min(scene.duration * 0.6, scene.duration - d0 - 1));
  const prog = easeInOut((t - d0) / (d1 - d0));
  const head = prog * (n - 1);
  const hi_ = Math.floor(head), frac = head - hi_;
  const cur = hi_ >= n - 1 ? closes[n - 1] : lerp(closes[hi_], closes[hi_ + 1], frac);
  const visible = closes.slice(0, hi_ + 1).map((v, i) => [X(i), Y(v)] as const);
  if (hi_ < n - 1) visible.push([lerp(X(hi_), X(hi_ + 1), frac), Y(cur)]);
  const path = visible.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = cur >= closes[0];
  const color = up ? theme.colors.positive : theme.colors.negative;
  const [hx, hy] = visible[visible.length - 1];
  const axisO = easeOut((t - 0.1) / 0.5);
  // The change since the first close; none from a zero base (it would read Infinity%).
  const delta = closes[0] ? `${up ? "▲" : "▼"}${fmt(Math.abs((cur / closes[0] - 1) * 100), { decimals: 1, suffix: "%" })}` : "";
  // Near the right edge the live label would run off the frame: right-align it above the pen instead.
  const liveW = textEms(fmt(cur, format)) * 44 * u + (delta ? 10 * u + textEms(delta) * 26 * u : 0);
  const livePos = hx + 22 * u + liveW > width - pad ? { right: width - hx, top: hy - 100 * u } : { left: hx + 22 * u, top: hy - 34 * u };
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {!scene.header && <Stage><Title text={title} /></Stage>}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id={`pc-${scene.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v} opacity={axisO}>
            <line x1={L} x2={R} y1={Y(v)} y2={Y(v)} stroke={theme.colors.border} strokeWidth={1} strokeDasharray={`${4 * u} ${6 * u}`} />
            <text x={L - 14 * u} y={Y(v) + 8 * u} fill={theme.colors.muted} fontSize={22 * u} textAnchor="end" fontFamily={theme.fonts.number}>{fmt(v, format)}</text>
          </g>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={X(i)} y={B + 36 * u} fill={theme.colors.muted} fontSize={22 * u} textAnchor="middle" opacity={axisO} fontFamily={theme.fonts.number}>{xs[i]}</text>
        ))}
        {baseline !== undefined && <line x1={L} x2={R} y1={Y(baseline)} y2={Y(baseline)} stroke={theme.colors.muted} strokeWidth={2 * u} opacity={0.6 * axisO} />}
        {candles ? candles.slice(0, Math.ceil(head + 0.001)).map((c, i) => {
          const g = c[4] >= c[1];
          const col = g ? theme.colors.positive : theme.colors.negative;
          const bw = Math.max(2, ((R - L) / n) * 0.62);
          const o = clamp01(head - i + 1);
          return (
            <g key={i} opacity={o}>
              <line x1={X(i)} x2={X(i)} y1={Y(c[2])} y2={Y(c[3])} stroke={col} strokeWidth={Math.max(1, 2 * u)} />
              <rect x={X(i) - bw / 2} width={bw} y={Y(Math.max(c[1], c[4]))} height={Math.max(1, Math.abs(Y(c[1]) - Y(c[4])))} fill={col} />
            </g>
          );
        }) : (
          <>
            {area && visible.length > 1 && <path d={`${path} L${hx},${B} L${L},${B} Z`} fill={`url(#pc-${scene.id})`} />}
            <path d={path} fill="none" stroke={color} strokeWidth={5 * u} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {events.map((e, i) => {
          const xi = xs.indexOf(e.x);
          if (xi < 0) return null;
          const eAt = e.cue ? cueOr(scene, e.cue, 0) : d0 + (d1 - d0) * (xi / (n - 1));
          const o = easeOutBack(clamp01((t - eAt) / 0.35));
          const ex = X(xi), ey = Y(closes[xi]);
          const tone = e.tone === "up" ? theme.colors.positive : e.tone === "down" ? theme.colors.negative : theme.colors.highlight;
          const above = ey > (T + B) / 2;
          const fy = above ? ey - 130 * u : ey + 130 * u;
          return (
            <g key={i} opacity={clamp01(o)}>
              <line x1={ex} x2={ex} y1={ey} y2={lerp(ey, fy, clamp01(o))} stroke={tone} strokeWidth={2 * u} />
              <circle cx={ex} cy={ey} r={9 * u * clamp01(o)} fill={tone} />
              <g transform={`translate(${ex}, ${fy}) scale(${clamp01(o)})`}>
                <rect x={-12 * u} y={-26 * u} width={(e.label.length * 26 + 24) * u} height={44 * u} rx={6 * u} fill={tone} />
                <text x={0} y={5 * u} fill="#0b0f19" fontSize={26 * u} fontWeight={700}>{e.label}</text>
              </g>
            </g>
          );
        })}
        {!candles && t >= d0 && (
          <g>
            <circle cx={hx} cy={hy} r={(14 + 6 * Math.sin(t * 6)) * u} fill={color} opacity={0.25} />
            <circle cx={hx} cy={hy} r={8 * u} fill={color} />
          </g>
        )}
      </svg>
      {t >= d0 && (
        <div style={{ position: "absolute", ...livePos, fontFamily: theme.fonts.number, fontSize: 44 * u, fontWeight: 800, color, whiteSpace: "nowrap" }}>
          {fmt(cur, format)}
          {delta && <span style={{ fontSize: 26 * u, marginLeft: 10 * u }}>{delta}</span>}
        </div>
      )}
      {label && <div style={{ position: "absolute", right: width - R, top: T - 50 * u, fontSize: 26 * u, color: theme.colors.muted, opacity: axisO }}>{label}</div>}
    </div>
  );
};
