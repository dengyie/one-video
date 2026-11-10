import React from "react";
import { colorAt, fitFont, useLayout, useRevealAt, useTheme, useTime } from "../engine/context";
import { fmtCount } from "../engine/format";
import { clamp01, easeOut, lerp } from "../engine/motion";
import type { Format } from "../engine/types";
import { Card } from "../components/Card";
import { Credit, MediaFill, type Motion } from "../components/Media";
import { Img, staticFile } from "remotion";
import { useTimeline } from "../engine/context";
import { Stage, Title } from "./Stage";

type Event = { date: string; title: string; note?: string; highlight?: boolean; cue?: string };

export const TimelineScene: React.FC<{ title?: string; events: Event[] }> = ({ title, events }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const starts = events.map((e, i) => at(i, events.length, e.cue));
  const reached = starts.filter((s) => t >= s).length;
  const lineP = events.length <= 1 ? 1 : clamp01(lerp(Math.max(0, reached - 1), reached, easeOut((t - (starts[Math.max(0, reached - 1)] ?? 0)) / 0.6)) / (events.length - 1));
  const dot = (e: Event, on: boolean) => ({
    width: (e.highlight ? 30 : 22) * u, height: (e.highlight ? 30 : 22) * u, borderRadius: "50%", flex: "none" as const,
    background: on ? (e.highlight ? theme.colors.highlight : theme.colors.accent) : theme.colors.surface,
    border: `${3 * u}px solid ${on ? theme.colors.bg : theme.colors.border}`, boxShadow: on && e.highlight ? `0 0 ${24 * u}px ${theme.colors.highlight}` : "none",
  });
  if (portrait) {
    return (
      <Stage center>
        <Title text={title} />
        <div style={{ position: "relative", paddingLeft: 56 * u, display: "flex", flexDirection: "column", gap: 40 * u }}>
          <div style={{ position: "absolute", left: 14 * u, top: 10 * u, bottom: 10 * u, width: 4 * u, background: theme.colors.border }} />
          <div style={{ position: "absolute", left: 14 * u, top: 10 * u, height: `calc(${lineP * 100}% - ${20 * u * lineP}px)`, width: 4 * u, background: theme.colors.accent }} />
          {events.map((e, i) => {
            const o = easeOut((t - starts[i]) / 0.5);
            return (
              <div key={i} style={{ position: "relative", opacity: Math.max(0.2, o), transform: `translateX(${(1 - o) * 30 * u}px)` }}>
                <div style={{ position: "absolute", left: -54 * u, top: 8 * u, ...dot(e, o > 0.5) }} />
                <div style={{ fontFamily: theme.fonts.number, fontSize: 34 * u, fontWeight: 700, color: e.highlight ? theme.colors.highlight : theme.colors.accent }}>{e.date}</div>
                <div style={{ fontSize: 42 * u, fontWeight: 700, marginTop: 4 * u }}>{e.title}</div>
                {e.note && <div style={{ fontSize: 28 * u, color: theme.colors.muted, marginTop: 6 * u }}>{e.note}</div>}
              </div>
            );
          })}
        </div>
      </Stage>
    );
  }
  return (
    <Stage center>
      <Title text={title} />
      <div style={{ position: "relative", marginTop: 40 * u }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 120 * u, height: 4 * u, background: theme.colors.border }} />
        <div style={{ position: "absolute", left: 0, width: `${(lineP * (events.length - 1) / events.length + 0.5 / events.length) * 100}%`, top: 120 * u, height: 4 * u, background: theme.colors.accent }} />
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${events.length}, 1fr)` }}>
          {events.map((e, i) => {
            const o = easeOut((t - starts[i]) / 0.5);
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: `0 ${10 * u}px`, opacity: Math.max(0.18, o) }}>
                <div style={{ height: 122 * u - ((e.highlight ? 30 : 22) * u) / 2, display: "flex", alignItems: "flex-end", fontFamily: theme.fonts.number, fontSize: (events.length > 6 ? 28 : 36) * u, fontWeight: 700, color: e.highlight ? theme.colors.highlight : theme.colors.accent, paddingBottom: 14 * u }}>{e.date}</div>
                <div style={{ ...dot(e, o > 0.5), boxSizing: "border-box" }} />
                <div style={{ fontSize: (events.length > 6 ? 26 : 32) * u, fontWeight: 700, marginTop: (e.highlight ? 18 : 22) * u, transform: `translateY(${(1 - o) * 20 * u}px)`, lineHeight: 1.3 }}>{e.title}</div>
                {e.note && <div style={{ fontSize: 22 * u, color: theme.colors.muted, marginTop: 10 * u, lineHeight: 1.4 }}>{e.note}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </Stage>
  );
};

export const MediaScene: React.FC<{ asset: string; caption?: string; title?: string; subtitle?: string; motion?: Motion; fit?: "cover" | "contain"; dim?: number; startFrom?: number; muted?: boolean }> = ({
  asset, caption, title, subtitle, motion, fit, dim, startFrom, muted,
}) => {
  const theme = useTheme();
  const { u, pad, portrait, bottom } = useLayout();
  const o = easeOut((useTime() - 0.4) / 0.7);
  return (
    <>
      <MediaFill asset={asset} motion={motion} fit={fit} dim={dim ?? (title ? 0.5 : 0.25)} startFrom={startFrom} muted={muted} />
      <Credit asset={asset} />
      {(title || subtitle || caption) && (
        <div style={{ position: "absolute", left: pad, right: pad, bottom: bottom + 20 * u, opacity: o, transform: `translateY(${(1 - o) * 24 * u}px)` }}>
          {title && <div style={{ fontSize: (portrait ? 72 : 76) * u, fontWeight: 800, textShadow: "0 4px 16px rgba(0,0,0,0.6)" }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 34 * u, color: theme.colors.text, opacity: 0.85, marginTop: 10 * u, textShadow: "0 2px 8px rgba(0,0,0,0.7)" }}>{subtitle}</div>}
          {caption && (
            <div style={{ display: "inline-block", marginTop: 18 * u, fontSize: 24 * u, padding: `${6 * u}px ${14 * u}px`, borderLeft: `${4 * u}px solid ${theme.colors.accent}`, background: "rgba(0,0,0,0.45)" }}>{caption}</div>
          )}
        </div>
      )}
    </>
  );
};

type Side = { title: string; subtitle?: string; value?: number; format?: Format; items?: string[]; color?: string; asset?: string };

const CompareSide: React.FC<{ side: Side; at: number; color: string; valueSize: number }> = ({ side, at, color, valueSize }) => {
  const theme = useTheme();
  const tl = useTimeline();
  const { u } = useLayout();
  const t = useTime();
  const o = easeOut((t - at) / 0.45);
  const a = side.asset ? tl.assets[side.asset] : null;
  return (
    <Card o={o} accent={color} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 * u, padding: `${40 * u}px ${44 * u}px` }}>
      {a && a.kind === "image" && <Img src={staticFile(a.src)} style={{ width: "100%", height: 220 * u, objectFit: "cover", borderRadius: 10 * u }} />}
      <div style={{ fontSize: 50 * u, fontWeight: 800, color }}>{side.title}</div>
      {side.subtitle && <div style={{ fontSize: 30 * u, color: theme.colors.muted }}>{side.subtitle}</div>}
      {side.value !== undefined && (
        <div style={{ fontFamily: theme.fonts.number, fontSize: valueSize, fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap" }}>{fmtCount(side.value * easeOut((t - at - 0.1) / 0.8), side.value, side.format)}</div>
      )}
      {(side.items ?? []).map((it, i) => (
        <div key={i} style={{ fontSize: 32 * u, display: "flex", gap: 14 * u, opacity: easeOut((t - at - 0.5 - i * 0.35) / 0.4) }}>
          <span style={{ color }}>●</span>
          <span>{it}</span>
        </div>
      ))}
    </Card>
  );
};

export const CompareScene: React.FC<{ title?: string; vs?: string; left: Side; right: Side }> = ({ title, vs = "VS", left, right }) => {
  const theme = useTheme();
  const { u, portrait, width, pad } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const a0 = at(0, 2), a1 = at(1, 2);
  // Both values at one size that keeps the longer on one line in its card (1:1 / 4:5 cards are narrow).
  const room = portrait ? width - 2 * pad - 88 * u : (width - 2 * pad - 80 * u - [...vs].length * 40 * u) / 2 - 88 * u;
  const valueSize = Math.min(...[left, right].map((s) => (s.value === undefined ? 112 * u : fitFont(fmtCount(s.value, s.value, s.format), room, 112 * u))));
  return (
    <Stage center>
      <Title text={title} />
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", gap: 40 * u, alignItems: "stretch" }}>
        <CompareSide side={left} at={a0} color={left.color ?? colorAt(theme, 0)} valueSize={valueSize} />
        <div style={{ alignSelf: "center", fontFamily: theme.fonts.number, fontSize: 56 * u, fontWeight: 900, color: theme.colors.muted, opacity: easeOut((t - a1 + 0.3) / 0.4) }}>{vs}</div>
        <CompareSide side={right} at={a1} color={right.color ?? colorAt(theme, 1)} valueSize={valueSize} />
      </div>
    </Stage>
  );
};
