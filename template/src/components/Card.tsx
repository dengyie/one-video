import React from "react";
import { useLayout, useScene, useTheme } from "../engine/context";

// Entrance-aware surface: `o` is the reveal progress 0→1; `anchor` names it for pinned overlays.
export const Card: React.FC<{ o: number; children: React.ReactNode; style?: React.CSSProperties; accent?: string; anchor?: string }> = ({ o, children, style, accent, anchor }) => {
  const theme = useTheme();
  const { u } = useLayout();
  // Over a photo backdrop the card turns into frosted glass so numbers stay legible.
  const onMedia = Boolean(useScene().backdrop);
  return (
    <div
      data-anchor={anchor}
      style={{
        opacity: o,
        transform: `translateY(${(1 - o) * 30 * u}px)`,
        background: onMedia ? "rgba(6,10,24,0.58)" : theme.colors.surface,
        backdropFilter: onMedia ? `blur(${18 * u}px)` : undefined,
        boxShadow: onMedia ? `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.35)` : undefined,
        border: `1px solid ${theme.colors.border}`,
        borderTop: accent ? `${4 * u}px solid ${accent}` : undefined,
        borderRadius: theme.radius * u,
        padding: `${28 * u}px ${32 * u}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
