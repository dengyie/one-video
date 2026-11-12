import React from "react";
import { colorAt, fitFont, textEms, useLayout, useRevealAt, useScene, useTheme, useTime, useTimeline, cueOr } from "../engine/context";
import { fmt, fmtCount } from "../engine/format";
import { Roll } from "../components/Roll";
import { clamp01, easeInOut, easeOut, lerp } from "../engine/motion";
import type { Format } from "../engine/types";
import { Card } from "../components/Card";
import { Stage, Title } from "./Stage";

// Count-ups finish fast: the number should be readable while the voice is still saying it.
const COUNT = 0.8;

// Round axis ticks (1/2/2.5/5 × 10^n) covering [lo, hi].
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-12, raw))));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

type StatCard = { value: number; from?: number; format?: Format; label: string; note?: string; color?: string; cue?: string };

export const StatCardsScene: React.FC<{ columns?: number; cards: StatCard[] }> = ({ columns, cards }) => {
  const theme = useTheme();
  const { u, portrait, width, pad } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const { fps } = useTimeline();
  const cols = columns ?? (portrait ? (cards.length > 3 ? 2 : 1) : Math.min(cards.length, cards.length === 4 ? 2 : 3));
  const big = cards.length <= 2 ? 1.4 : cards.length <= 4 ? 1.15 : 0.8;
  // One value size for every card, small enough that the longest stays inside its card.
  const room = (width - 2 * pad - (cols - 1) * 36 * u) / cols - 80 * u;
  const valueSize = Math.min(...cards.map((c) => fitFont(fmtCount(c.value, c.value, c.format), room, 88 * u * big)));
  return (
    <Stage center>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 36 * u }}>
        {cards.map((c, i) => {
          const s = at(i, cards.length, c.cue);
          const o = easeOut((t - s) / 0.45);
          const v = lerp(c.from ?? 0, c.value, easeOut((t - s) / COUNT));
          const color = c.color ?? (i === 0 ? theme.colors.accent : colorAt(theme, i));
          return (
            <Card key={i} o={o} accent={color} anchor={[`card${i + 1}`, c.cue].filter(Boolean).join(" ")} style={{ textAlign: "left", padding: `${34 * u}px ${40 * u}px` }}>
              <div style={{ fontSize: 28 * u * Math.max(0.85, big * 0.9), color: theme.colors.muted }}>{c.label}</div>
              <div style={{ fontFamily: theme.fonts.number, fontSize: valueSize, fontWeight: 800, color, marginTop: 10 * u, lineHeight: 1.05, whiteSpace: "nowrap" }}>
                {c.from === undefined && t - s < COUNT ? <Roll text={fmtCount(c.value, c.value, c.format)} p={easeOut((t - s) / COUNT)} was={easeOut((t - 1 / fps - s) / COUNT)} /> : fmtCount(v, c.value, c.format)}
              </div>
              {c.note && <div style={{ fontSize: 22 * u, color: theme.colors.muted, marginTop: 12 * u, lineHeight: 1.4 }}>{c.note}</div>}
            </Card>
          );
        })}
      </div>
    </Stage>
  );
};

type BarItem = { label: string; value: number; color?: string; highlight?: boolean; note?: string; cue?: string };

export const BarCompareScene: React.FC<{ title?: string; unit?: string; format?: Format; sort?: "none" | "desc" | "asc"; max?: number; items: BarItem[] }> = ({
  title, unit, format, sort = "desc", max, items,
}) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const rows = sort === "none" ? items : [...items].sort((a, b) => (sort === "desc" ? b.value - a.value : a.value - b.value));
  const top = max ?? Math.max(...items.map((x) => Math.abs(x.value)));
  const anyHi = items.some((x) => x.highlight);
  const rowH = Math.min(portrait ? 110 : 90, (portrait ? 1100 : 640) / rows.length) * u;
  const labelW = (portrait ? 260 : 320) * u;
  return (
    <Stage center>
      <Title text={title} />
      {unit && <div style={{ fontSize: 22 * u, color: theme.colors.muted, marginTop: -14 * u, marginBottom: 20 * u }}>单位：{unit}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => {
          const s = at(items.indexOf(r), items.length, r.cue);
          const p = easeOut((t - s) / 0.9);
          const color = r.color ?? (r.highlight ? theme.colors.accent : anyHi ? theme.colors.muted : colorAt(theme, items.indexOf(r)));
          const w = Math.max(0.004, Math.abs(r.value) / top) * p;
          return (
            <div key={r.label} data-anchor={[`bar${items.indexOf(r) + 1}`, r.cue].filter(Boolean).join(" ")} style={{ height: rowH, display: "flex", alignItems: "center", opacity: clamp01((t - s) / 0.3) }}>
              <div style={{ width: labelW, flex: "none", textAlign: "right", paddingRight: 22 * u, fontSize: Math.min(32, rowH / u * 0.42) * u, fontWeight: r.highlight ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.label}
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    width: `${w * 78}%`,
                    height: rowH * 0.62,
                    borderRadius: 8 * u,
                    background: `linear-gradient(90deg, ${color}88, ${color})`,
                    boxShadow: r.highlight ? `0 0 ${24 * u}px ${color}66` : "none",
                  }}
                />
                <div style={{ marginLeft: 16 * u, fontFamily: theme.fonts.number, fontSize: Math.min(30, rowH / u * 0.4) * u, fontWeight: 600, whiteSpace: "nowrap", color: r.highlight ? color : theme.colors.text }}>
                  {fmtCount(r.value * p, r.value, format)}
                  {r.note && <span style={{ fontFamily: theme.fonts.body, fontSize: 20 * u, color: theme.colors.muted, marginLeft: 12 * u }}>{r.note}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

type Series = { name: string; color?: string; group?: string; values: (number | null)[] };

// Bars re-rank smoothly while the period advances; each period gets an equal slice of the scene.
// Time (s) at which each period is fully shown. Cued periods (periodCues[k]) are anchors;
// the rest are spread evenly between anchors, and the last period lands by 72% of the scene
// (unless cued) so the final standings get a hold.
export function periodTimes(n: number, duration: number, cueAt: (k: number) => number | undefined): number[] {
  const endAt = Math.max(1.6, Math.min(duration * 0.72, duration - 1.5));
  const T: (number | undefined)[] = Array.from({ length: n }, (_, k) => cueAt(k));
  T[0] = T[0] ?? 0.6;
  T[n - 1] = T[n - 1] ?? Math.max(endAt, T[0] + 1);
  let a = 0;
  for (let k = 1; k < n; k++) {
    if (T[k] === undefined) continue;
    for (let j = a + 1; j < k; j++) T[j] = T[a]! + ((T[k]! - T[a]!) * (j - a)) / (k - a);
    a = k;
  }
  const out = T as number[];
  for (let k = 1; k < n; k++) out[k] = Math.max(out[k], out[k - 1] + 0.5);
  return out;
}

export const BarRaceScene: React.FC<{ title?: string; unit?: string; format?: Format; top?: number; periods: string[]; series: Series[]; groupColors?: Record<string, string>; periodCues?: (string | null)[] }> = ({
  title, unit, format, top = 10, periods, series, groupColors = {}, periodCues = [],
}) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, portrait, narrow, width, height, top: headerBottom, bottom, pad } = useLayout();
  const t = useTime();
  const T = periodTimes(periods.length, scene.duration, (k) => {
    const name = periodCues[k];
    return name ? scene.cues[name] : undefined;
  });
  let seg = 0;
  while (seg < periods.length - 2 && t >= T[seg + 1]) seg++;
  const i = seg;
  // A short swap then a hold: crossing bars overlap, so keep the crossing brief and the ranking readable.
  const p = easeInOut(clamp01((t - T[i]) / Math.max(0.3, Math.min(1.6, (T[i + 1] - T[i]) * 0.6))));
  const pos = i + p;
  const rankAt = (k: number) => {
    const order = series.map((s, idx) => ({ idx, v: s.values[k] ?? -Infinity })).sort((a, b) => b.v - a.v);
    const r: number[] = [];
    order.forEach((o, n) => (r[o.idx] = o.v === -Infinity ? series.length : n));
    return r;
  };
  const rA = rankAt(i), rB = rankAt(i + 1);
  const rows = series.map((s, idx) => {
    const a = s.values[i] ?? 0, b = s.values[i + 1] ?? 0;
    return { s, idx, value: lerp(a, b, p), rank: lerp(rA[idx], rB[idx], p) };
  });
  const max = Math.max(1e-9, ...rows.filter((r) => r.rank < top).map((r) => r.value));
  // Opening: bars rise from the last place up and their values count, the leader landing last
  // (~1.9 s), so a first period held while the narrator talks about it doesn't open on a still.
  const grow = (rank: number) => easeOut((t - 0.15 - Math.max(0, Math.min(top, series.length) - 1 - rank) * 0.15) / 0.7);
  // Fill what the Stage leaves after the title/unit lines, never the caption band.
  const stageH = height - (scene.header ? headerBottom + 20 * u : pad) - bottom;
  // 1:1 and 4:5 have no room beside the bars for the period label: it gets a strip below them.
  const strip = narrow && !portrait ? 120 * u : 0;
  const areaH = Math.min((portrait ? 1100 : 700) * u, stageH - (title ? 62 * u : 0) - (unit ? 30 * u : 0) - 16 * u - strip);
  const rowH = areaH / top;
  const labelW = (portrait ? 250 : 300) * u;
  const current = periods[pos - i >= 0.5 ? i + 1 : i];
  const groups = [...new Set(series.map((s) => s.group).filter(Boolean))] as string[];
  const valueFont = Math.min(26, rowH / u * 0.4) * u;
  // On wide frames the period label sits in the chart's bottom-right corner. Rows beside it get
  // their bars shortened so the value text stops short of it; all bars share one scale so they
  // stay comparable, and each row counts by how much it overlaps the label so the scale eases.
  const barPct = (() => {
    const base = portrait ? 58 : 62;
    if (narrow) return base;
    const rowW = width - pad * 2;
    const periodFont = 150 * u;
    const legendW = groups.reduce((w, g) => w + (16 + 8 + 20) * u + textEms(g) * 22 * u, 0);
    const blockW = Math.max(...periods.map((p) => textEms(p) * periodFont), legendW) + 24 * u;
    const blockTop = areaH - 10 * u - periodFont - (groups.length ? 50 * u : 0);
    let pct = base;
    for (const r of rows) {
      if (r.rank >= top || r.value <= 0) continue;
      const w = clamp01((r.rank * rowH + rowH - blockTop) / rowH);
      if (w <= 0) continue;
      const room = rowW - blockW - labelW - 14 * u - textEms(fmt(r.value, format)) * valueFont;
      const fit = Math.max(20, (room / ((r.value / max) * rowW)) * 100);
      pct = Math.min(pct, lerp(base, Math.min(base, fit), w));
    }
    return pct;
  })();
  return (
    <Stage>
      <Title text={title} />
      {unit && <div style={{ fontSize: 22 * u, color: theme.colors.muted, marginTop: -14 * u }}>单位：{unit}</div>}
      <div style={{ position: "relative", height: areaH, marginTop: 16 * u }}>
        {rows.map((r) => {
          const color = r.s.color ?? (r.s.group && groupColors[r.s.group]) ?? colorAt(theme, r.idx);
          const visible = clamp01(top - r.rank), value = r.value * grow(r.rank);
          return (
            <div key={r.s.name} style={{ position: "absolute", top: r.rank * rowH, left: 0, right: 0, height: rowH, display: "flex", alignItems: "center", opacity: visible }}>
              <div style={{ width: labelW, flex: "none", textAlign: "right", paddingRight: 18 * u, fontSize: Math.min(30, rowH / u * 0.45) * u, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.s.name}</div>
              <div data-anchor={`bar${r.idx + 1}`} style={{ width: `${Math.max(0.5, (value / max) * barPct)}%`, height: rowH * 0.7, borderRadius: 6 * u, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
              <div style={{ marginLeft: 14 * u, fontFamily: theme.fonts.number, fontSize: valueFont, color: theme.colors.muted, whiteSpace: "nowrap" }}>{fmt(value, format)}</div>
            </div>
          );
        })}
        {/* Fixed name slots, so an overlay can mark "the leader" whoever it is at that moment. */}
        {Array.from({ length: Math.min(top, series.length) }, (_, k) => (
          <div key={`rank${k}`} data-anchor={`rank${k + 1}`} style={{ position: "absolute", top: k * rowH, left: 0, width: labelW, height: rowH }} />
        ))}
        <div style={strip
          ? { position: "absolute", left: 0, right: 0, top: areaH + 8 * u, display: "flex", flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "flex-end" }
          : { position: "absolute", right: 0, bottom: portrait ? -150 * u : 10 * u, textAlign: "right" }}>
          <div data-anchor="period" style={{ fontFamily: theme.fonts.number, fontSize: (strip ? 104 : portrait ? 120 : 150) * u, fontWeight: 800, lineHeight: 1, opacity: 0.9 }}>{current}</div>
          {groups.length > 0 && (
            <div style={{ display: "flex", gap: 20 * u, justifyContent: "flex-end", marginTop: 14 * u }}>
              {groups.map((g, k) => (
                <div key={g} style={{ display: "flex", alignItems: "center", gap: 8 * u, fontSize: 22 * u, color: theme.colors.muted }}>
                  <div style={{ width: 16 * u, height: 16 * u, borderRadius: 4 * u, background: groupColors[g] ?? colorAt(theme, k) }} />
                  {g}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Stage>
  );
};

type Point = [number | string, number | string];
// Anchor names of a line-chart point: series 1 is `point<k>` / `last`, series n is `s<n>-point<k>` / `s<n>-last`.
// Mirrors anchorNames in cli/lib/timeline/anchors.mjs.
export const pointAnchors = (si: number, k: number, n: number) => {
  const pre = si ? `s${si + 1}-` : "";
  return [`${pre}point${k + 1}`, ...(k === n - 1 ? [`${pre}last`] : [])];
};
type LineSeries = { name: string; color?: string; points: Point[] };
type Annotation = { x: number | string; label: string; series?: number; cue?: string };

export const LineChartScene: React.FC<{ title?: string; xLabel?: string; yLabel?: string; format?: Format; yMin?: number; yMax?: number; series: LineSeries[]; annotations?: Annotation[]; drawCue?: string; pointCues?: (string | null)[] }> = ({
  title, xLabel, yLabel, format, yMin, yMax, series, annotations = [], drawCue, pointCues = [],
}) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, width, height, pad, portrait, top: topY, bottom } = useLayout();
  const t = useTime();
  const categorical = series.some((s) => s.points.some((p) => typeof p[0] === "string"));
  const xs = categorical ? [...new Set(series.flatMap((s) => s.points.map((p) => String(p[0]))))] : [];
  const xVal = (x: number | string) => (categorical ? xs.indexOf(String(x)) : Number(x));
  const allX = series.flatMap((s) => s.points.map((p) => xVal(p[0])));
  const allY = series.flatMap((s) => s.points.map((p) => Number(p[1])));
  const x0 = Math.min(...allX), x1 = Math.max(...allX);
  const tickVals = niceTicks(yMin ?? Math.min(0, ...allY), yMax ?? Math.max(...allY) * 1.05);
  const lo = yMin ?? tickVals[0], hi = yMax ?? tickVals[tickVals.length - 1];
  const W = width - pad * 2 - 120 * u;
  const H = height - (scene.header ? topY + 20 * u : pad) - bottom - (title ? 80 : 20) * u - 70 * u;
  const X = (x: number) => ((x - x0) / Math.max(1e-9, x1 - x0)) * W;
  const Y = (y: number) => H - ((y - lo) / Math.max(1e-9, hi - lo)) * H;
  const drawStart = cueOr(scene, drawCue, 0.5);
  // With pointCues the line reaches point k when its cue resolves (one segment at a time, like the
  // narration reading the values out, travelling through most of the gap so the frame keeps moving);
  // otherwise it draws in one sweep from drawStart.
  const n = Math.max(...series.map((s) => s.points.length));
  const pointT = pointCues.some(Boolean) && n > 1
    ? periodTimes(n, scene.duration, (k) => (pointCues[k] ? scene.cues[pointCues[k]!] : k === 0 ? drawStart : undefined))
    : null;
  const pos = pointT
    ? pointT.slice(1).reduce((sum, T, k) => {
        const travel = Math.min(3, Math.max(0.3, (T - pointT[k]) * 0.8));
        return sum + easeInOut(clamp01((t - (T - travel)) / travel));
      }, 0)
    : 0;
  const drawP = pointT ? pos / (n - 1) : easeInOut((t - drawStart) / Math.max(1.2, Math.min(4, scene.duration * 0.45)));
  // The big label sits on the last point reached; cued, that is the last value spoken (none before the first).
  const reached = pointT ? (t >= pointT[0] ? Math.floor(pos + 1e-6) : -1) : Math.ceil(drawP * (n - 1));
  const lastLabel = (s: LineSeries) => s.points[Math.max(0, Math.min(reached, s.points.length - 1))];
  return (
    <Stage>
      <Title text={title} />
      <svg width={W + 120 * u} height={H + 60 * u} style={{ overflow: "visible" }}>
        <g transform={`translate(${100 * u}, ${10 * u})`}>
          {tickVals.filter((v) => v >= lo && v <= hi).map((v, k) => {
            return (
              <g key={k}>
                <line x1={0} x2={W} y1={Y(v)} y2={Y(v)} stroke={theme.colors.border} strokeDasharray={`${4 * u} ${6 * u}`} />
                <text x={-14 * u} y={Y(v) + 8 * u} textAnchor="end" fontSize={24 * u} fill={theme.colors.muted} fontFamily={theme.fonts.number}>{fmt(v, format)}</text>
              </g>
            );
          })}
          {(categorical ? xs.map((x, k) => [k, x] as const) : [...new Set(allX)].map((x) => [x, String(x)] as const))
            .filter((_, k, arr) => arr.length <= (portrait ? 6 : 12) || k % Math.ceil(arr.length / (portrait ? 6 : 12)) === 0)
            .map(([x, label]) => (
              <text key={label} x={X(x)} y={H + 38 * u} textAnchor="middle" fontSize={24 * u} fill={theme.colors.muted} fontFamily={theme.fonts.number}>{label}</text>
            ))}
          {series.map((s, si) => {
            const color = s.color ?? colorAt(theme, si);
            const pts = s.points.map((p) => [X(xVal(p[0])), Y(Number(p[1]))]);
            const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
            let len = 0, upTo = 0;
            for (let k = 1; k < pts.length; k++) {
              const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
              upTo += seg * clamp01(pos - (k - 1));
              len += seg;
            }
            // Dash length is in path length, not points: cued segments must end exactly on their point.
            const drawn = pointT ? upTo / Math.max(1e-9, len) : drawP;
            // The shaded area follows the pen: the drawn part of the polyline, closed down to the axis.
            const shown: number[][] = [pts[0]];
            for (let k = 1, left = drawn * len; k < pts.length && left > 0; k++) {
              const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
              const f = Math.min(1, left / Math.max(1e-9, seg));
              shown.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]);
              left -= seg;
            }
            const area = shown.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
            const tip = lastLabel(s);
            const tipK = s.points.indexOf(tip);
            const annotated = new Set(annotations.filter((a) => (a.series ?? 0) === si).map((a) => String(a.x)));
            return (
              <g key={s.name}>
                {pts.map(([x, y], k) => (
                  <circle key={`a${k}`} data-anchor={pointAnchors(si, k, pts.length).join(" ")} cx={x} cy={y} r={10 * u} fill="none" />
                ))}
                {pts.map(([x, y], k) => {
                  // Cued, the start point waits half-lit until its value is spoken.
                  const o = pointT && k === 0 ? (reached >= 0 ? 1 : 0.5) : clamp01(((pointT ? pos : drawP * (pts.length - 1)) - k + 0.15) / 0.3);
                  if (o <= 0) return null;
                  return (
                    <g key={k} opacity={o}>
                      <circle cx={x} cy={y} r={8 * u} fill={theme.colors.bg} stroke={color} strokeWidth={4 * u} />
                      {series.length === 1 && k !== tipK && !annotated.has(String(s.points[k][0])) && (
                        // The first point sits on the y axis: start its label there so it clears the tick labels.
                        <text x={k === 0 ? x - 8 * u : x} y={y - 24 * u} textAnchor={k === 0 ? "start" : "middle"} fontSize={28 * u} fontWeight={600} fill={theme.colors.text} fontFamily={theme.fonts.number}>{fmt(Number(s.points[k][1]), format)}</text>
                      )}
                    </g>
                  );
                })}
                {shown.length > 1 && <path d={`${area} L${shown[shown.length - 1][0].toFixed(1)},${H} L${pts[0][0]},${H} Z`} fill={color} opacity={0.08} />}
                {/* The gap is twice the path so the next dash's round cap never shows as a dot at the far end. */}
                <path d={d} fill="none" stroke={color} strokeWidth={5 * u} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${len} ${len * 2}`} strokeDashoffset={len * (1 - drawn)} opacity={drawn > 0 ? 1 : 0} />
                {(pointT ? reached >= 0 : drawP > 0.02) && (
                  // Near the right edge the label would run off the frame: right-align it above the point instead.
                  <text {...(X(xVal(tip[0])) > W * 0.85 ? { x: X(xVal(tip[0])), y: Y(Number(tip[1])) - 28 * u, textAnchor: "end" as const } : { x: X(xVal(tip[0])) + 14 * u, y: Y(Number(tip[1])) - 14 * u })} fontSize={34 * u} fontWeight={800} fill={color} fontFamily={theme.fonts.number}>
                    {series.length > 1 ? `${s.name} ` : ""}{fmt(Number(tip[1]), format)}
                  </text>
                )}
              </g>
            );
          })}
          {annotations.map((a, k) => {
            const s = series[a.series ?? 0];
            const pt = s.points.find((p) => String(p[0]) === String(a.x));
            if (!pt) return null;
            const at = cueOr(scene, a.cue, drawStart + 1 + k * 0.8);
            const o = easeOut((t - at) / 0.5);
            const x = X(xVal(pt[0])), y = Y(Number(pt[1]));
            return (
              <g key={k} opacity={o}>
                <circle cx={x} cy={y} r={9 * u * o} fill={theme.colors.highlight} />
                <line x1={x} x2={x} y1={y - 14 * u} y2={y - 70 * u} stroke={theme.colors.highlight} strokeWidth={2 * u} />
                <text data-anchor={[`note${k + 1}`, a.cue].filter(Boolean).join(" ")} x={x} y={y - 80 * u} textAnchor="middle" fontSize={24 * u} fontWeight={600} fill={theme.colors.text}>{a.label}</text>
              </g>
            );
          })}
          {yLabel && <text x={-90 * u} y={-4 * u} fontSize={20 * u} fill={theme.colors.muted}>{yLabel}</text>}
          {xLabel && <text x={W} y={H + 64 * u} textAnchor="end" fontSize={20 * u} fill={theme.colors.muted}>{xLabel}</text>}
        </g>
      </svg>
    </Stage>
  );
};

type Segment = { label: string; value: number; color?: string; cue?: string };

export const ShareScene: React.FC<{ title?: string; unit?: string; format?: Format; segments: Segment[]; total?: { label?: string; cue?: string } }> = ({ title, unit, format, segments, total: totalRow }) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, portrait, narrow, height, top, bottom } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  // One precision for the whole chart: a decimal only when some slice is under 10%.
  const pctDecimals = segments.some((x) => x.value / total < 0.1) ? 1 : 0;
  const pct = (v: number) => `${((v / total) * 100).toFixed(pctDecimals)}%`;
  // Narrow frames stack the legend under the ring; a square one has to shrink the ring to fit it.
  const R = portrait ? 320 * u : narrow ? Math.min(300 * u, (height - top - bottom - (180 + (segments.length + (totalRow ? 1.4 : 0)) * 66) * u) / 2) : 300 * u, r = R * 0.62;
  // The whole ring sweeps in on the first reveal, so the chart never shows a broken circle;
  // each slice then lights up (and its legend row) on its own cue.
  // A total read out first brings the whole ring with it.
  const first = Math.min(...segments.map((s, i) => at(i, segments.length, s.cue)), ...(totalRow?.cue && scene.cues[totalRow.cue] !== undefined ? [scene.cues[totalRow.cue]] : []));
  const sweep = easeInOut((t - first + 0.3) / 1.1) * Math.PI * 2;
  let acc = 0;
  const arcs = segments.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += s.value;
    const a1 = (acc / total) * Math.PI * 2;
    const p = easeOut((t - at(i, segments.length, s.cue)) / 0.5);
    return { s, i, a0: Math.min(a0, sweep), a1: Math.min(a1, sweep), p, color: s.color ?? colorAt(theme, i) };
  });
  const arc = (a0: number, a1: number) => {
    if (a1 - a0 < 1e-4) return "";
    const pt = (rad: number, a: number) => [rad * Math.sin(a), -rad * Math.cos(a)];
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
    return `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`;
  };
  const lead = arcs.reduce((m, a) => (a.s.value > m.s.value ? a : m), arcs[0]);
  // The centre text shrinks with a squeezed ring (square frames); the label goes when it won't fit the hole.
  const pctFont = Math.min(76 * u, 0.6 * R), showLabel = textEms(lead.s.label) * 26 * u <= 1.15 * r;
  // The whole the slices add up to, as the legend's headline: on its cue, else with the ring.
  const totalP = totalRow ? easeOut((t - cueOr(scene, totalRow.cue, first)) / 0.5) : 0;
  return (
    <Stage center>
      <Title text={title} />
      <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", alignItems: "center", gap: (narrow && !portrait ? 36 : 80) * u, justifyContent: "center" }}>
        <svg data-anchor="ring" width={R * 2 + 20 * u} height={R * 2 + 20 * u} viewBox={`${-R - 10 * u} ${-R - 10 * u} ${R * 2 + 20 * u} ${R * 2 + 20 * u}`}>
          {arcs.map((a) => <path key={a.s.label} d={arc(a.a0, a.a1)} fill={a.color} opacity={0.3 + 0.7 * a.p} stroke={theme.colors.bg} strokeWidth={3 * u} />)}
          <text x={0} y={showLabel ? -6 * u : pctFont * 0.35} textAnchor="middle" fontSize={pctFont} fontWeight={800} fill={theme.colors.text} fontFamily={theme.fonts.number} opacity={lead.p}>
            {pct(lead.s.value)}
          </text>
          {showLabel && <text x={0} y={40 * u} textAnchor="middle" fontSize={26 * u} fill={theme.colors.muted} opacity={lead.p}>{lead.s.label}</text>}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 * u, minWidth: 420 * u }}>
          {totalRow && (
            <div data-anchor="total" style={{ display: "flex", alignItems: "baseline", gap: 18 * u, paddingBottom: 14 * u, borderBottom: `${2 * u}px solid ${theme.colors.muted}`, opacity: totalP, transform: `translateY(${(1 - totalP) * 12 * u}px)` }}>
              <div style={{ flex: 1, fontSize: 34 * u, color: theme.colors.muted }}>{totalRow.label ?? "合计"}</div>
              <div style={{ fontFamily: theme.fonts.number, fontSize: 64 * u, fontWeight: 800 }}>{fmt(total, format)}{unit ? ` ${unit}` : ""}</div>
            </div>
          )}
          {arcs.map((a) => (
            <div key={a.s.label} data-anchor={[`seg${a.i + 1}`, a.s.cue].filter(Boolean).join(" ")} style={{ display: "flex", alignItems: "center", gap: 18 * u, opacity: Math.max(0.3, a.p), transform: `translateX(${(1 - a.p) * 12 * u}px)` }}>
              <div style={{ width: 26 * u, height: 26 * u, borderRadius: 6 * u, background: a.color }} />
              <div style={{ flex: 1, fontSize: 38 * u }}>{a.s.label}</div>
              <div style={{ fontFamily: theme.fonts.number, fontSize: 40 * u, fontWeight: 700 }}>{pct(a.s.value)}</div>
              <div style={{ fontFamily: theme.fonts.number, fontSize: 28 * u, color: theme.colors.muted, minWidth: 160 * u, textAlign: "right" }}>
                {fmt(a.s.value, format)}{unit ? ` ${unit}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
};
