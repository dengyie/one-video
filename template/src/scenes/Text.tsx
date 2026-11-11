import React from "react";
import { fitFont, textEms, useLayout, useScene, useReveal, useRevealAt, useTheme, useTime } from "../engine/context";
import { MediaFill } from "../components/Media";
import { Stage } from "./Stage";

export const TitleScene: React.FC<{ kicker?: string; title: string; subtitle?: string; date?: string }> = ({ kicker, title, subtitle, date }) => {
  const theme = useTheme();
  const { u, portrait, width, pad } = useLayout();
  const k = useReveal(0.1, 0.5);
  const tt = useReveal(0.3, 0.8);
  // A long unbreakable word (a URL, a ticker run) cannot wrap: shrink it to one line of the frame.
  const titleSize = Math.min(...title.split(/\s+/).map((w) => fitFont(w, (width - 2 * pad) * 0.92, (portrait ? 100 : 104) * u)));
  const s = useReveal(0.9, 0.7);
  const t = useTime();
  return (
    <Stage center style={{ alignItems: "center", textAlign: "center" }}>
      {kicker && <div style={{ opacity: k, fontSize: (portrait ? 34 : 28) * u, letterSpacing: 6 * u, color: theme.colors.accent, marginBottom: 28 * u, fontWeight: 600 }}>{kicker}</div>}
      <div
        style={{
          opacity: tt,
          transform: `scale(${0.94 + 0.06 * tt + t * 0.002})`,
          fontSize: titleSize,
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: 2 * u,
          maxWidth: "92%",
        }}
      >
        {title}
      </div>
      <div style={{ width: 140 * u * s, height: 5 * u, background: `linear-gradient(90deg, ${theme.colors.accent}, ${theme.colors.accent2})`, borderRadius: 3 * u, margin: `${36 * u}px 0` }} />
      {subtitle && <div style={{ opacity: s, fontSize: (portrait ? 42 : 38) * u, color: theme.colors.muted, maxWidth: "85%", lineHeight: 1.4 }}>{subtitle}</div>}
      {date && <div style={{ opacity: s, fontSize: 24 * u, color: theme.colors.muted, marginTop: 24 * u, fontFamily: theme.fonts.number }}>{date}</div>}
    </Stage>
  );
};

export const ChapterScene: React.FC<{ index?: number | string; title: string; subtitle?: string }> = ({ index, title, subtitle }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const a = useReveal(0.05, 0.7);
  const b = useReveal(0.35, 0.7);
  const label = typeof index === "number" ? String(index).padStart(2, "0") : index;
  return (
    <Stage center style={{ alignItems: portrait ? "center" : "flex-start", textAlign: portrait ? "center" : "left", paddingLeft: portrait ? 0 : 80 * u }}>
      {label !== undefined && (
        <div style={{ fontFamily: theme.fonts.number, fontSize: 200 * u, fontWeight: 800, lineHeight: 1, color: theme.colors.accent, opacity: 0.85 * a, transform: `translateX(${(1 - a) * -40 * u}px)` }}>{label}</div>
      )}
      <div style={{ fontSize: (portrait ? 84 : 88) * u, fontWeight: 800, marginTop: 16 * u, opacity: b, transform: `translateY(${(1 - b) * 24 * u}px)` }}>{title}</div>
      {subtitle && <div style={{ fontSize: 34 * u, color: theme.colors.muted, marginTop: 20 * u, opacity: b }}>{subtitle}</div>}
    </Stage>
  );
};

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

// When the quote is what the narrator reads, each character's spoken time: the line's letters are
// spread evenly over its span, punctuation takes the time of the letter before it. Null otherwise.
function spokenTimes(text: string, lines: { text: string; start: number; end: number }[] | undefined): number[] | null {
  if (!lines?.length) return null;
  const said = lines.flatMap((l) => {
    const cs = [...l.text].filter(isWordChar);
    return cs.map((c, k) => ({ c, t: l.start + ((k + 0.5) / cs.length) * (l.end - l.start) }));
  });
  const chars = [...text];
  if (chars.filter(isWordChar).join("") !== said.map((s) => s.c).join("")) return null;
  let k = 0, last = lines[0].start;
  return chars.map((c) => (isWordChar(c) ? (last = said[k++].t) : last));
}

export const QuoteScene: React.FC<{ text: string; author?: string; source?: string; asset?: string }> = ({ text, author, source, asset }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const scene = useScene();
  const t = useTime();
  const q = useReveal(0.2, 0.9);
  const a = useReveal(1.0, 0.6);
  // A quote read aloud lights up as it is spoken (and the timeline drops its caption).
  const times = spokenTimes(text, scene.lines);
  return (
    <>
      {asset && <MediaFill asset={asset} dim={0.65} motion="in" />}
      <Stage center style={{ alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 180 * u, lineHeight: 0.6, color: theme.colors.accent, opacity: q * 0.8, fontFamily: "Georgia, serif" }}>“</div>
        <div style={{ fontSize: (portrait ? 58 : 60) * u, fontWeight: 700, lineHeight: 1.45, maxWidth: "86%", opacity: q, transform: `translateY(${(1 - q) * 20 * u}px)` }}>
          {times
            ? [...text].map((c, i) => <span key={i} style={{ opacity: 0.3 + 0.7 * Math.min(1, Math.max(0, (t - times[i] + 0.1) / 0.25)) }}>{c}</span>)
            : text}
        </div>
        {(author || source) && (
          <div style={{ marginTop: 40 * u, fontSize: 30 * u, color: theme.colors.muted, opacity: a }}>
            {author && <span style={{ color: theme.colors.text, fontWeight: 600 }}>— {author}</span>}
            {source && <span>{author ? " · " : ""}{source}</span>}
          </div>
        )}
      </Stage>
    </>
  );
};

type Bullet = string | { text: string; note?: string; icon?: string; cue?: string };

export const BulletsScene: React.FC<{ title?: string; items: Bullet[] }> = ({ title, items }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  const at = useRevealAt();
  const t = useTime();
  const list = items.map((b) => (typeof b === "string" ? { text: b } : b));
  const titleO = useReveal(0.1, 0.5);
  return (
    <Stage center>
      {title && <div style={{ fontSize: (portrait ? 52 : 46) * u, fontWeight: 700, marginBottom: 40 * u, opacity: titleO }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: (portrait ? 34 : 28) * u }}>
        {list.map((b, i) => {
          const s = at(i, list.length, b.cue);
          const o = Math.min(1, Math.max(0, (t - s) / 0.5));
          const e = 1 - Math.pow(1 - o, 3);
          const active = t >= s && (i === list.length - 1 || t < at(i + 1, list.length, list[i + 1].cue));
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 26 * u, opacity: e * (active ? 1 : 0.72), transform: `translateX(${(1 - e) * 40 * u}px)` }}>
              <div
                style={{
                  flex: "none",
                  width: 56 * u,
                  height: 56 * u,
                  borderRadius: 14 * u,
                  background: active ? theme.colors.accent : theme.colors.surface,
                  border: `1px solid ${theme.colors.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: theme.fonts.number,
                  fontSize: 28 * u,
                  fontWeight: 700,
                  color: active ? theme.colors.bg : theme.colors.text,
                }}
              >
                {b.icon ?? i + 1}
              </div>
              <div>
                <div style={{ fontSize: (portrait ? 46 : 42) * u, fontWeight: 600, lineHeight: 1.3 }}>{b.text}</div>
                {b.note && <div style={{ fontSize: 26 * u, color: theme.colors.muted, marginTop: 6 * u }}>{b.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

// Regular-weight Latin in the source list measures about 0.48 em; 0.52 keeps a little slack.
const LIST_LATIN = 0.52;

export const SourcesScene: React.FC<{ title?: string; items?: string[] }> = ({ title = "资料来源", items = [] }) => {
  const theme = useTheme();
  const { u, portrait, width, height, pad, top, bottom } = useLayout();
  const scene = useScene();
  // A silent credits card has no caption band to keep clear: the list may run down to the margin.
  const floor = scene.lines?.length ? bottom : pad;
  const o = useReveal(0.1, 0.6);
  const t = useTime();
  const cols = !portrait && items.length > 8 ? 2 : 1;
  // The largest size (30u down to 16u) at which the list, wrapped to its column width, fits the safe area.
  const colW = (width - pad * 2 - 48 * u * (cols - 1)) / cols, room = height - (scene.header ? top + 20 * u : pad) - floor - 110 * u;
  const listH = (fs: number) => {
    let h = 0;
    for (let i = 0; i < items.length; i += cols) {
      const lines = Math.max(...items.slice(i, i + cols).map((s) => Math.ceil(((textEms(s, LIST_LATIN) + 2) * fs) / (colW - 12 * u))));
      h += lines * fs * 1.4 + 14 * u;
    }
    return h;
  };
  let fs = 30 * u;
  // 1.15: word wrapping of Latin titles leaves ragged line ends the em estimate doesn't see.
  while (fs > 16 * u && listH(fs) * 1.15 > room) fs -= u;
  return (
    <Stage center style={{ bottom: floor }}>
      <div style={{ fontSize: 44 * u, fontWeight: 700, marginBottom: 32 * u, opacity: o }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, columnGap: 48 * u, rowGap: 14 * u }}>
        {items.map((s, i) => {
          const e = Math.min(1, Math.max(0, (t - 0.3 - i * 0.12) / 0.4));
          return (
            <div key={i} style={{ fontSize: fs, color: theme.colors.text, lineHeight: 1.4, opacity: e, display: "flex", gap: 12 * u }}>
              <span style={{ color: theme.colors.accent, fontFamily: theme.fonts.number }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ opacity: 0.86 }}>{s}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};
