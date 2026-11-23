import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useLayout, useTimeline } from "./context";
import { clamp01, easeOut, easeOutBack, lerp } from "./motion";
import { deviceViewportHeight } from "../../../shared/safe-layout.mjs";

// Split into runs; numbers (with %/$/units glued on) and Latin words are the line's key tokens.
const KEY = /([$¥€£]?\d[\d,.]*\s*(?:%|万亿|亿|万|倍|美元|元|[kKmMbB]\b)?|[A-Za-z][A-Za-z0-9.&-]*)/;
function tokens(text: string) {
  let at = 0;
  // split() with one capture group alternates plain, key, plain, … — odd parts are the keys.
  return text.split(KEY).map((part, i) => {
    const chars = Array.from(part);
    const tok = { chars, at, key: i % 2 === 1 };
    at += chars.length;
    return tok;
  }).filter((tok) => tok.chars.length);
}

// Captions run on absolute time from the measured TTS line spans.
// "line": the whole line; "karaoke": spoken characters brighten progressively; "kinetic":
// karaoke plus numbers/Latin words lit in the accent, each line rising in on a light plate.
export const Captions: React.FC = () => {
  const tl = useTimeline();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, height, portrait } = useLayout();
  const t = frame / fps;
  const hidden = new Set(tl.scenes.filter((s) => !s.captions).map((s) => s.id));
  // A line lingers 0.25 s past its end, but the line started most recently wins: a next line
  // starting inside that linger must not be shadowed by the one before it.
  const item = tl.captions.items
    .filter((c) => t >= c.start - 0.05 && t < c.end + 0.25 && !hidden.has(c.scene))
    .reduce<(typeof tl.captions.items)[number] | undefined>((m, c) => (!m || c.start >= m.start ? c : m), undefined);
  if (!item) return null;
  const device = tl.scenes.some((s) => s.id === item.scene && s.type === "device");
  const { colors, captionBg } = tl.theme;
  const fadeIn = clamp01((t - (item.start - 0.05)) / 0.12);
  const fadeOut = clamp01((item.end + 0.25 - t) / 0.12);
  const chars = Array.from(item.text);
  const kinetic = tl.captions.style === "kinetic";
  const spoken = tl.captions.style === "karaoke" || kinetic ? Math.floor(clamp01((t - item.start) / Math.max(0.1, item.end - item.start)) * chars.length + 0.5) : chars.length;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        ...(device
          ? { top: deviceViewportHeight(height, u, portrait) + 8 * u, bottom: 14 * u, alignItems: "center", overflow: "hidden" }
          : item.top ? { top: (portrait ? 220 : 46) * u } : { bottom: (portrait ? 300 : 46) * u }),
        display: "flex",
        justifyContent: "center",
        opacity: Math.min(fadeIn, fadeOut),
        pointerEvents: "none",
      }}
    >
      <div
        data-caption={item.scene}
        style={{
          maxWidth: portrait ? "88%" : "80%",
          boxSizing: "border-box",
          pointerEvents: tl.probe ? "auto" : undefined,
          transform: kinetic ? `translateY(${(1 - easeOut(fadeIn)) * 18 * u}px) scale(${lerp(0.94, 1, easeOutBack(fadeIn))})` : undefined,
          fontSize: (portrait ? 54 : 42) * u,
          lineHeight: 1.35,
          textAlign: "center",
          color: kinetic ? "#fff" : colors.text,
          background: kinetic ? "rgba(0,0,0,0.86)" : captionBg ?? "rgba(0,0,0,0.6)",
          backdropFilter: kinetic ? `blur(${8 * u}px)` : undefined,
          fontWeight: kinetic ? 700 : 600,
          padding: `${10 * u}px ${28 * u}px`,
          borderRadius: 12 * u,
          textShadow: "0 2px 6px rgba(0,0,0,0.75)",
          letterSpacing: 0.5 * u,
        }}
      >
        {kinetic
          ? tokens(item.text).map((tok, j) => (
              <span key={j} style={{ whiteSpace: tok.key ? "nowrap" : undefined }}>
                {tok.chars.map((c, i) => {
                  const on = tok.at + i < spoken;
                  // Just-spoken characters overshoot slightly, so the eye rides the voice.
                  const fresh = on && tok.at + i >= spoken - 2;
                  return (
                    <span key={i} style={{
                      display: "inline-block", whiteSpace: "pre", color: tok.key ? `color-mix(in srgb, ${colors.accent} 55%, white)` : "#fff",
                      opacity: on ? 1 : 0.8, transform: fresh ? "translateY(-6%) scale(1.06)" : undefined,
                    }}>{c}</span>
                  );
                })}
              </span>
            ))
          : tl.captions.style === "karaoke"
          ? chars.map((c, i) => (
              <span key={i} style={{ color: i < spoken ? colors.highlight : colors.text, opacity: i < spoken ? 1 : 0.78 }}>{c}</span>
            ))
          : item.text}
      </div>
    </div>
  );
};
