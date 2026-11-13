import React, { useMemo } from "react";
import { geoCentroid, geoGraticule10, geoInterpolate, geoMercator, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import world110 from "world-atlas/countries-110m.json";
import world50 from "world-atlas/countries-50m.json";
import { colorAt, cueOr, useLayout, useRevealAt, useScene, useTheme, useTime } from "../engine/context";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import { Stage, Title } from "./Stage";

// Natural Earth (world-atlas) draws Taiwan as its own feature; for Chinese-language videos a
// highlight of China always includes it (the compiler resolves names to these numeric ids).
export const CHINA = "156";
export const TAIWAN = "158";

type View = { center: [number, number]; zoom: number; cue?: string; at?: number };
type HL = { id: string; color?: string; label?: string; cue?: string };
type Pin = { lon: number; lat: number; label?: string; cue?: string; color?: string };
type Route = { from: [number, number]; to: [number, number]; label?: string; cue?: string; color?: string; duration?: number };

let cache: Record<string, any[]> = {};
function countries(detail: "110m" | "50m"): any[] {
  if (!cache[detail]) {
    const topo: any = detail === "50m" ? world50 : world110;
    cache[detail] = (feature(topo, topo.objects.countries) as any).features;
  }
  return cache[detail];
}

// Camera path through the views: hold each, ease to the next over `fly` seconds ending at its cue.
function viewAt(views: View[], starts: number[], t: number, fly: number): { center: [number, number]; zoom: number } {
  let c = views[0].center, z = Math.log(views[0].zoom);
  for (let i = 1; i < views.length; i++) {
    const p = easeInOut((t - (starts[i] - fly)) / fly);
    if (p <= 0) break;
    // Shortest way round in longitude.
    let dLon = views[i].center[0] - c[0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    c = [c[0] + dLon * p, lerp(c[1], views[i].center[1], p)];
    z = lerp(z, Math.log(views[i].zoom), p);
  }
  return { center: c, zoom: Math.exp(z) };
}

export const MapScene: React.FC<{
  mode?: "map" | "globe"; title?: string; views?: View[]; highlight?: HL[]; pins?: Pin[]; routes?: Route[]; spin?: number; fly?: number; detail?: "auto" | "110m" | "50m";
}> = ({ mode = "map", title, views, highlight = [], pins = [], routes = [], spin = 0, fly = 1.6, detail = "auto" }) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, width, height, portrait } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const vs: View[] = views?.length ? views : [{ center: [mode === "globe" ? 105 : 20, mode === "globe" ? 25 : 20], zoom: 1 }];
  const starts = vs.map((v, i) => (i === 0 ? 0 : v.cue ? cueOr(scene, v.cue, 0) : v.at ?? at(i, vs.length)));
  const view = viewAt(vs, starts, t, fly);
  const lon = view.center[0] + spin * t;
  const globe = mode === "globe";
  const base = globe ? Math.min(width, height) * 0.42 : width / (2 * Math.PI);
  const proj: GeoProjection = globe
    ? geoOrthographic().rotate([-lon, -view.center[1], 0]).scale(base * view.zoom).translate([width / 2, height / 2]).clipAngle(90)
    : geoMercator().rotate([-lon, 0, 0]).center([0, view.center[1]]).scale(base * view.zoom).translate([width / 2, height * (portrait ? 0.5 : 0.54)]);
  const path = geoPath(proj);
  const feats = countries(detail === "auto" ? (view.zoom > 2.2 ? "50m" : "110m") : detail);
  const hlById = useMemo(() => {
    const m = new Map<string, { h: HL; i: number }>();
    highlight.forEach((h, i) => {
      m.set(h.id, { h, i });
      if (h.id === CHINA && !m.has(TAIWAN)) m.set(TAIWAN, { h: { ...h, label: undefined }, i });
    });
    return m;
  }, [highlight]);
  const hlStart = highlight.map((h, i) => at(i, highlight.length, h.cue));
  // Screen position and label fade of each visible pin (null when off the map or behind the globe).
  const pinAt = pins.map((pn, i) => {
    const xy = proj([pn.lon, pn.lat]);
    if (!xy || (globe && !visibleOnGlobe([pn.lon, pn.lat], [lon, view.center[1]]))) return null;
    const s = pn.cue ? cueOr(scene, pn.cue, 0) : at(i, pins.length);
    return { i, x: xy[0], y: xy[1], text: pn.label, o: easeOut((t - s - 0.15) / 0.4) };
  });
  const appear = easeOut(t / 0.6);
  // Style borders are translucent whites: enough to read land against the sea on any theme.
  const land = theme.colors.border;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: appear }}>
        {globe && (
          <>
            <defs>
              <radialGradient id={`sea-${scene.id}`} cx="40%" cy="35%" r="70%">
                <stop offset="0%" stopColor={theme.colors.bgAlt} />
                <stop offset="100%" stopColor={theme.colors.bg} />
              </radialGradient>
            </defs>
            <path d={path({ type: "Sphere" } as any) ?? ""} fill={`url(#sea-${scene.id})`} stroke={theme.colors.accent} strokeOpacity={0.5} strokeWidth={2 * u} />
          </>
        )}
        <path d={path(geoGraticule10()) ?? ""} fill="none" stroke={theme.colors.border} strokeWidth={1} strokeOpacity={0.5} />
        {feats.map((f) => {
          const hl = hlById.get(String(f.id));
          const p = hl ? easeOut((t - hlStart[hl.i]) / 0.6) : 0;
          const color = hl ? hl.h.color ?? colorAt(theme, hl.i) : land;
          const d = path(f);
          if (!d) return null;
          return <path key={f.id ?? f.properties?.name} d={d} fill={p > 0 ? color : land} fillOpacity={p > 0 ? lerp(0.3, 0.88, p) : 1} stroke={p > 0.5 ? color : theme.colors.border} strokeWidth={(p > 0.5 ? 2 : 0.8) * u} />;
        })}
        {routes.map((r, i) => {
          const s = r.cue ? cueOr(scene, r.cue, 0) : at(i, routes.length);
          const dur = r.duration ?? 1.4;
          const p = easeInOut((t - s) / dur);
          if (p <= 0) return null;
          const interp = geoInterpolate(r.from, r.to);
          const N = 64;
          const line = { type: "LineString", coordinates: Array.from({ length: Math.max(2, Math.ceil(N * p) + 1) }, (_, k) => interp(Math.min(p, k / N))) };
          const color = r.color ?? theme.colors.accent;
          const head = proj(interp(p));
          return (
            <g key={i}>
              <path d={path(line as any) ?? ""} fill="none" stroke={color} strokeWidth={4 * u} strokeLinecap="round" strokeDasharray={`${14 * u} ${8 * u}`} strokeDashoffset={-t * 40 * u} />
              {head && <circle cx={head[0]} cy={head[1]} r={9 * u} fill={color} />}
            </g>
          );
        })}
        {pins.map((pn, i) => {
          const xy = proj([pn.lon, pn.lat]);
          if (!xy) return null;
          if (globe && !visibleOnGlobe([pn.lon, pn.lat], [lon, view.center[1]])) return null;
          const s = pn.cue ? cueOr(scene, pn.cue, 0) : at(i, pins.length);
          const p = easeOutBack(clamp01((t - s) / 0.4));
          if (p <= 0) return null;
          const color = pn.color ?? theme.colors.highlight;
          const ring = ((t - s) % 1.6) / 1.6;
          return (
            <g key={i} transform={`translate(${xy[0]}, ${xy[1]})`}>
              <circle r={(10 + 34 * ring) * u} fill="none" stroke={color} strokeWidth={3 * u} opacity={(1 - ring) * clamp01(p)} />
              <circle r={11 * u * p} fill={color} stroke="#fff" strokeWidth={3 * u} />
            </g>
          );
        })}
      </svg>
      {placePinLabels(pinAt.map((p) => p && p.text ? { ...p, text: p.text } : null), u).map((l) => <Label key={`p${l.i}`} x={l.x} y={l.y} o={l.o} text={l.text} />)}
      {highlight.map((h, i) => {
        if (!h.label) return null;
        const f = feats.find((x) => String(x.id) === h.id);
        if (!f) return null;
        const c = geoCentroid(f);
        if (globe && !visibleOnGlobe(c, [lon, view.center[1]])) return null;
        const xy = proj(c);
        if (!xy) return null;
        const o = easeOut((t - hlStart[i] - 0.3) / 0.5);
        // A country label centred on a visible pin would hide it: it drops below the pin instead.
        const w = labelWidth(h.label) * u, lh = 52 * u;
        const under = pinAt.find((p) => p && p.o > 0 && Math.abs(p.x - xy[0]) < w / 2 + 14 * u && Math.abs(p.y - xy[1]) < lh / 2 + 14 * u);
        const y = under ? under.y + 22 * u + lh / 2 : xy[1];
        return <Label key={`h${i}`} x={under ? under.x : xy[0]} y={y} o={o} text={h.label} center color={h.color ?? colorAt(theme, i)} />;
      })}
      {routes.map((r, i) => {
        if (!r.label) return null;
        const s = r.cue ? cueOr(scene, r.cue, 0) : at(i, routes.length);
        const mid = proj(geoInterpolate(r.from, r.to)(0.5));
        if (!mid) return null;
        return <Label key={`r${i}`} x={mid[0]} y={mid[1] - 40 * u} o={easeOut((t - s - (r.duration ?? 1.4) * 0.6) / 0.4)} text={r.label} center />;
      })}
      {title && <Stage><Title text={title} /></Stage>}
    </div>
  );
};

const Label: React.FC<{ x: number; y: number; o: number; text: string; center?: boolean; color?: string }> = ({ x, y, o, text, center, color }) => {
  const theme = useTheme();
  const { u } = useLayout();
  if (o <= 0) return null;
  return (
    <div style={{
      position: "absolute", left: x, top: y, transform: `translate(${center ? "-50%" : "0"}, -50%) translateY(${(1 - o) * 12 * u}px)`, opacity: o,
      background: "rgba(6,10,24,0.72)", border: `1px solid ${color ?? theme.colors.border}`, borderRadius: 8 * u,
      padding: `${8 * u}px ${16 * u}px`, fontSize: 28 * u, fontWeight: 700, whiteSpace: "nowrap", color: theme.colors.text,
    }}>
      {text}
    </div>
  );
};

// Label width in u, estimated from the text (CJK ≈ 1em per char at 28u, plus padding).
const labelWidth = (text: string) => [...text].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.6), 0) * 28 + 36;

// Pin labels go right of their pin; when one would overlap an earlier label it flips to the
// left, then steps down until clear. Width is estimated from the text (CJK ≈ 1em per char).
function placePinLabels(items: ({ i: number; x: number; y: number; text: string; o: number } | null)[], u: number) {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: { i: number; x: number; y: number; text: string; o: number }[] = [];
  const hit = (b: { x: number; y: number; w: number; h: number }) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  for (const it of items) {
    if (!it || it.o <= 0) continue;
    const w = labelWidth(it.text) * u, h = 52 * u;
    let box = { x: it.x + 22 * u, y: it.y - 26 * u - h / 2, w, h };
    if (hit(box)) box = { ...box, x: it.x - 22 * u - w };
    for (let k = 0; k < 6 && hit(box); k++) box = { ...box, y: box.y + h + 6 * u };
    placed.push(box);
    out.push({ ...it, x: box.x, y: box.y + h / 2 });
  }
  return out;
}

// Point on the near hemisphere of an orthographic globe centred on `c`.
function visibleOnGlobe(p: [number, number], c: [number, number]): boolean {
  const r = Math.PI / 180;
  const cos = Math.sin(p[1] * r) * Math.sin(c[1] * r) + Math.cos(p[1] * r) * Math.cos(c[1] * r) * Math.cos((p[0] - c[0]) * r);
  return cos > 0.05;
}
