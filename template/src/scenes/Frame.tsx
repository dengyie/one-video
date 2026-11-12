import React from "react";
import { Img, staticFile } from "remotion";
import { Box, Circle } from "@remotion/rough-notation";
import { colorAt, useLayout, useRevealAt, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { fmtCount } from "../engine/format";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import type { Format } from "../engine/types";
import { ClipVideo, MediaFill } from "../components/Media";

// ── focus ────────────────────────────────────────────────────────────────────
// One photo, the camera pushing into regions one by one: the rest dims, the region gets a
// hand-drawn box or circle and a label. Region coordinates are 0–1 of the frame.

type Region = { x: number; y: number; w: number; h: number; label?: string; cue?: string; shape?: "box" | "circle"; zoom?: number };

export const FocusScene: React.FC<{ asset: string; regions: Region[]; hold?: number }> = ({ asset, regions, hold = 0 }) => {
  const theme = useTheme();
  const scene = useScene();
  const { u, width, height } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const starts = regions.map((r, i) => at(i, regions.length, r.cue));
  // Active region: the latest one whose cue has passed; zoom eases in over 0.9s.
  let cx = 0.5, cy = 0.5, z = 1;
  let active = -1;
  for (let i = 0; i < regions.length; i++) {
    const p = easeInOut((t - starts[i]) / 0.9);
    if (p <= 0) break;
    active = i;
    const r = regions[i];
    const target = r.zoom ?? Math.min(2.6, Math.max(1.15, 0.55 / Math.max(r.w, r.h)));
    cx = lerp(cx, r.x + r.w / 2, p);
    cy = lerp(cy, r.y + r.h / 2, p);
    z = lerp(z, target, p);
  }
  // Optional pull back to the full frame at the end.
  if (hold > 0) {
    const back = easeInOut((t - (scene.duration - hold)) / 0.9);
    cx = lerp(cx, 0.5, back); cy = lerp(cy, 0.5, back); z = lerp(z, 1, back);
  }
  // Keep the zoomed frame inside the image.
  const half = 0.5 / z;
  cx = Math.min(1 - half, Math.max(half, cx));
  cy = Math.min(1 - half, Math.max(half, cy));
  const tx = (0.5 - cx) * width * z, ty = (0.5 - cy) * height * z;
  const r = active >= 0 ? regions[active] : null;
  const rp = r ? easeOut((t - starts[active] - 0.7) / 0.5) : 0;
  // Region rect in screen space after the camera transform.
  const sx = (x: number) => (x - cx) * width * z + width / 2;
  const sy = (y: number) => (y - cy) * height * z + height / 2;
  // A long label wraps inside the frame (portrait is narrow); above the region it grows upward.
  const lx = r ? Math.min(width - 520 * u, Math.max(40 * u, sx(r.x))) : 0;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
        <MediaFill asset={asset} motion="none" dim={0.1} />
      </div>
      {r && (
        <>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <mask id={`fm-${scene.id}`}>
                <rect width={width} height={height} fill="#fff" />
                <rect x={sx(r.x)} y={sy(r.y)} width={r.w * width * z} height={r.h * height * z} rx={12 * u} fill="#000" />
              </mask>
            </defs>
            <rect width={width} height={height} fill="#000" opacity={0.55 * rp} mask={`url(#fm-${scene.id})`} />
          </svg>
          <div style={{ position: "absolute", left: sx(r.x), top: sy(r.y), width: r.w * width * z, height: r.h * height * z }}>
            {(r.shape ?? "box") === "circle"
              ? <Circle progress={rp} color={theme.colors.highlight} strokeWidth={5 * u} iterations={1} style={{ width: "100%", height: "100%" }}><div style={{ width: "100%", height: "100%" }} /></Circle>
              : <Box progress={rp} color={theme.colors.highlight} strokeWidth={5 * u} iterations={1} style={{ width: "100%", height: "100%" }}><div style={{ width: "100%", height: "100%" }} /></Box>}
          </div>
          {r.label && (
            <div style={{
              position: "absolute", left: lx, maxWidth: width - 40 * u - lx,
              ...(sy(r.y + r.h) + 18 * u > height - 220 * u ? { bottom: height - sy(r.y) + 26 * u } : { top: sy(r.y + r.h) + 18 * u }),
              opacity: rp, transform: `translateY(${(1 - rp) * 14 * u}px)`, background: theme.colors.highlight, color: "#0b0f19",
              fontSize: 32 * u, fontWeight: 800, padding: `${8 * u}px ${18 * u}px`, borderRadius: 6 * u, textShadow: "none",
            }}>{r.label}</div>
          )}
        </>
      )}
    </div>
  );
};

// ── split / pip ──────────────────────────────────────────────────────────────

type Panel = { asset?: string; title?: string; text?: string; value?: number; format?: Format; caption?: string; color?: string; cue?: string };

const PanelView: React.FC<{ panel: Panel; at: number; color: string; compact?: boolean }> = ({ panel, at, color, compact }) => {
  const theme = useTheme();
  const tl = useTimeline();
  const { u } = useLayout();
  const t = useTime();
  const o = easeOut((t - at) / 0.5);
  const a = panel.asset ? tl.assets[panel.asset] : null;
  const k = compact ? 0.7 : 1;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: theme.colors.bgAlt }}>
      {a && (a.kind === "video"
        ? <ClipVideo a={a} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.04 + 0.04 * clamp01(t / 8)})` }} />
        : <Img src={staticFile(a.src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${1.04 + 0.04 * clamp01(t / 8)})` }} />)}
      {a && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }} />}
      <div style={{ position: "absolute", left: 48 * u * k, right: 48 * u * k, bottom: 48 * u * k, opacity: o, transform: `translateY(${(1 - o) * 24 * u}px)` }}>
        {panel.title && <div style={{ fontSize: 54 * u * k, fontWeight: 800, color: a ? "#fff" : color }}>{panel.title}</div>}
        {panel.value !== undefined && <div style={{ fontFamily: theme.fonts.number, fontSize: 110 * u * k, fontWeight: 900, color, lineHeight: 1.05 }}>{fmtCount(panel.value * easeOut((t - at - 0.1) / 0.8), panel.value, panel.format)}</div>}
        {panel.text && <div style={{ fontSize: 32 * u * k, lineHeight: 1.45, color: a ? "#e8eaf0" : theme.colors.text, marginTop: 8 * u }}>{panel.text}</div>}
        {panel.caption && <div style={{ fontSize: 22 * u * k, color: a ? "#c9cdd6" : theme.colors.muted, marginTop: 10 * u }}>{panel.caption}</div>}
      </div>
    </div>
  );
};

export const SplitScene: React.FC<{ mode?: "split" | "pip"; left: Panel; right: Panel; ratio?: number; corner?: "top-right" | "bottom-right" | "top-left" | "bottom-left" }> = ({
  mode = "split", left, right, ratio = 0.5, corner = "top-right",
}) => {
  const theme = useTheme();
  const { u, width, height, portrait, pad } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const a0 = at(0, 2, left.cue), a1 = at(1, 2, right.cue);
  if (mode === "pip") {
    const p = easeOutBack(clamp01((t - a1) / 0.5));
    const w = (portrait ? 0.46 : 0.32) * width, h = w * (9 / 16);
    const [vx, vy] = corner.split("-");
    return (
      <div style={{ position: "absolute", inset: 0 }}>
        <PanelView panel={left} at={a0} color={left.color ?? colorAt(theme, 0)} />
        <div style={{
          position: "absolute", width: w, height: h, [vy === "top" ? "left" : "left"]: undefined,
          ...(vx === "top" ? { top: pad } : { bottom: pad + 120 * u }), ...(vy === "right" ? { right: pad } : { left: pad }),
          transform: `scale(${p})`, transformOrigin: `${vy === "right" ? "100%" : "0%"} ${vx === "top" ? "0%" : "100%"}`,
          borderRadius: 14 * u, overflow: "hidden", border: `${3 * u}px solid ${right.color ?? theme.colors.accent}`, boxShadow: `0 ${16 * u}px ${40 * u}px rgba(0,0,0,0.5)`,
        }}>
          <PanelView panel={right} at={a1 + 0.2} color={right.color ?? colorAt(theme, 1)} compact />
        </div>
      </div>
    );
  }
  // Split: the divider slides open from the centre, each side revealed at its cue.
  const open = easeInOut((t - a0 + 0.2) / 0.7);
  const second = easeInOut((t - a1 + 0.2) / 0.7);
  const cut = (portrait ? height : width) * ratio;
  const gap = 6 * u;
  const sideA: React.CSSProperties = portrait ? { left: 0, right: 0, top: 0, height: cut - gap / 2 } : { top: 0, bottom: 0, left: 0, width: cut - gap / 2 };
  const sideB: React.CSSProperties = portrait ? { left: 0, right: 0, bottom: 0, top: cut + gap / 2 } : { top: 0, bottom: 0, right: 0, left: cut + gap / 2 };
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", ...sideA, overflow: "hidden", clipPath: portrait ? `inset(0 0 ${(1 - open) * 100}% 0)` : `inset(0 ${(1 - open) * 100}% 0 0)` }}>
        <PanelView panel={left} at={a0} color={left.color ?? colorAt(theme, 0)} />
      </div>
      <div style={{ position: "absolute", ...sideB, overflow: "hidden", clipPath: portrait ? `inset(${(1 - second) * 100}% 0 0 0)` : `inset(0 0 0 ${(1 - second) * 100}%)` }}>
        <PanelView panel={right} at={a1} color={right.color ?? colorAt(theme, 1)} />
      </div>
      <div style={{ position: "absolute", ...(portrait ? { left: 0, right: 0, top: cut - gap / 2, height: gap } : { top: 0, bottom: 0, left: cut - gap / 2, width: gap }), background: theme.colors.accent, opacity: open }} />
    </div>
  );
};

// ── photo-stack ──────────────────────────────────────────────────────────────
// Prints dropped one by one onto a table, each slightly rotated; the newest lands on top.

type Photo = { asset: string; caption?: string; cue?: string };

export const PhotoStackScene: React.FC<{ items: Photo[]; title?: string }> = ({ items, title }) => {
  const theme = useTheme();
  const tl = useTimeline();
  const { u, width, height, portrait } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const n = items.length;
  const w = (portrait ? 0.7 : 0.36) * width;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {title && <div style={{ position: "absolute", left: 96 * u, top: 70 * u, fontSize: 48 * u, fontWeight: 800, opacity: easeOut(t / 0.5) }}>{title}</div>}
      {items.map((it, i) => {
        const a = tl.assets[it.asset];
        if (!a) return null;
        const s = at(i, n, it.cue);
        const p = easeOut((t - s) / 0.55);
        if (p <= 0) return null;
        // Deterministic scatter around the centre.
        const rot = ((i * 37) % 13) - 6;
        const ox = (((i * 53) % 9) - 4) * 0.035 * width;
        const oy = (((i * 29) % 7) - 3) * 0.03 * height;
        const settle = easeOutBack(clamp01((t - s) / 0.5));
        const older = Math.max(0, items.slice(i + 1).filter((_, k) => t > at(i + 1 + k, n, items[i + 1 + k].cue)).length);
        return (
          <div key={i} style={{
            position: "absolute", left: width / 2 + ox, top: height / 2 + oy, width: w,
            transform: `translate(-50%, -50%) translateY(${(1 - p) * -0.25 * height}px) rotate(${rot * settle}deg) scale(${lerp(1.25, 1, settle) * (1 - older * 0.03)})`,
            opacity: clamp01(p * 2) * (1 - older * 0.12), background: "#f4f1ea", padding: `${18 * u}px ${18 * u}px ${it.caption ? 64 * u : 18 * u}px`,
            boxShadow: `0 ${18 * u}px ${46 * u}px rgba(0,0,0,0.5)`, borderRadius: 4 * u, textShadow: "none",
          }}>
            {a.kind === "video"
              ? <ClipVideo a={a} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }} />
              : <Img src={staticFile(a.src)} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }} />}
            {it.caption && <div style={{ position: "absolute", left: 0, right: 0, bottom: 16 * u, textAlign: "center", color: "#2a2d33", fontSize: 28 * u, fontWeight: 600 }}>{it.caption}</div>}
          </div>
        );
      })}
    </div>
  );
};

