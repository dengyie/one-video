import React from "react";
import { Img, staticFile } from "remotion";
import { useLayout, useTheme, useTime, useTimeline } from "../engine/context";
import { clamp01, easeOut } from "../engine/motion";
import type { Watermark as Mark } from "../engine/types";
import { Icon } from "./Icon";

// The channel mark, in a corner for the whole video. The badge is a glass pill: a mark (logo
// asset, icon, or the text's first letter on the accent), the name and an optional second line.
// It eases in after the opening second and a light sweep crosses it now and then; it stays quiet
// (no pulsing) so it never competes with the scene.
const SWEEP_EVERY = 14;
const SWEEP_FOR = 1.1;

export const Watermark: React.FC<{ mark: Mark }> = ({ mark }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const t = useTime();
  const assets = useTimeline().assets;
  const [v, h] = mark.position.split("-") as ["top" | "bottom", "left" | "right"];
  const place: React.CSSProperties = {
    position: "absolute",
    [h]: (portrait ? 48 : 60) * u,
    [v]: v === "top" ? (portrait ? 60 : 40) * u : (portrait ? 40 : 24) * u,
  };

  if (mark.style === "text") {
    return <div style={{ ...place, fontSize: 20 * u, color: theme.colors.muted, opacity: 0.55, letterSpacing: 2 * u }}>{mark.text}</div>;
  }

  const enter = easeOut(clamp01((t - 0.6) / 0.8));
  const cycle = t > 2 ? (t - 2) % SWEEP_EVERY : -1;
  const sweep = cycle >= 0 && cycle < SWEEP_FOR ? cycle / SWEEP_FOR : -1;
  const d = 34 * u;
  const logo = mark.logo && assets[mark.logo];
  const markEl = logo ? (
    <Img src={staticFile(logo.src)} style={{ width: d, height: d, borderRadius: d / 2, objectFit: "cover", display: "block" }} />
  ) : (
    <div style={{ width: d, height: d, borderRadius: d / 2, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent2})`, color: "#fff", fontWeight: 800, fontSize: 18 * u, boxShadow: `0 0 ${10 * u}px ${theme.colors.accent}55` }}>
      {mark.icon ? <Icon name={mark.icon} size={20 * u} color="#fff" /> : [...(mark.text ?? "")][0]}
    </div>
  );
  return (
    <div style={{
      ...place,
      display: "flex", alignItems: "center", gap: 10 * u,
      padding: `${6 * u}px ${mark.text ? 16 * u : 6 * u}px ${6 * u}px ${6 * u}px`,
      borderRadius: 999,
      background: "rgba(10,14,28,0.42)",
      border: `${1 * u}px solid rgba(255,255,255,0.14)`,
      backdropFilter: `blur(${10 * u}px)`,
      boxShadow: `0 ${4 * u}px ${18 * u}px rgba(0,0,0,0.28)`,
      overflow: "hidden",
      opacity: 0.88 * enter,
      transform: `translateY(${(v === "top" ? -1 : 1) * (1 - enter) * 10 * u}px)`,
    }}>
      {markEl}
      {mark.text && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <div style={{ fontSize: 18 * u, fontWeight: 700, color: theme.colors.text, letterSpacing: 1 * u, whiteSpace: "nowrap" }}>{mark.text}</div>
          {mark.sub && <div style={{ fontSize: 12 * u, color: theme.colors.muted, letterSpacing: 1.5 * u, marginTop: 2 * u, whiteSpace: "nowrap" }}>{mark.sub}</div>}
        </div>
      )}
      {sweep >= 0 && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(105deg, transparent ${sweep * 140 - 40}%, rgba(255,255,255,0.22) ${sweep * 140 - 20}%, transparent ${sweep * 140}%)` }} />
      )}
    </div>
  );
};
