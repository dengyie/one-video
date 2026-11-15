import React from "react";
import { useLayout, useReveal, useTheme } from "../engine/context";

export const Header: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => {
  const theme = useTheme();
  const { u, pad, portrait } = useLayout();
  const o = useReveal(0.05, 0.5);
  return (
    <div style={{ position: "absolute", left: pad, right: pad, top: (portrait ? 120 : 56) * u, opacity: o, transform: `translateY(${(1 - o) * 16 * u}px)` }}>
      <div style={{ fontSize: (portrait ? 60 : 48) * u, fontWeight: 700, letterSpacing: 1 * u, color: theme.colors.text, textWrap: "balance" }}>{title}</div>
      {subtitle && <div style={{ fontSize: (portrait ? 32 : 25) * u, color: theme.colors.muted, marginTop: 8 * u, textWrap: "balance" }}>{subtitle}</div>}
      <div style={{ width: 72 * u * o, height: 4 * u, marginTop: 16 * u, borderRadius: 2 * u, background: theme.colors.accent }} />
    </div>
  );
};
