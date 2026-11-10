import React, { createContext, useContext } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, Theme, Timeline } from "./types";
import { PACE, progress } from "./motion";

export const TimelineContext = createContext<Timeline | null>(null);
export const SceneContext = createContext<Scene | null>(null);

export function useTimeline(): Timeline {
  const t = useContext(TimelineContext);
  if (!t) throw new Error("useTimeline outside <Video>");
  return t;
}

export function useScene(): Scene {
  const s = useContext(SceneContext);
  if (!s) throw new Error("useScene outside a scene");
  return s;
}

export const useTheme = (): Theme => useTimeline().theme;

// Scene-relative time in seconds. A scene's visuals start `lead` frames before its own start so
// the incoming transition can overlap the previous scene; t is negative during that lead-in.
export function useTime(): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scene = useContext(SceneContext);
  return (frame - (scene?.transitionIn?.lead ?? 0)) / fps;
}

// Layout unit: 1u = 1px at 1080 on the short edge, so every layout scales across aspects.
export function useLayout() {
  const { width, height } = useVideoConfig();
  const u = Math.min(width, height) / 1080;
  const portrait = height > width;
  const pad = (portrait ? 64 : 96) * u;
  return { width, height, u, portrait, pad, top: (portrait ? 220 : 190) * u, bottom: (portrait ? 420 : 170) * u };
}

export function usePace(): number {
  return PACE[useTheme().motion?.pace ?? "medium"];
}

// When item i of n appears: its named cue if the storyboard gave one, otherwise a stagger
// spread across the first ~55% of the scene so reveals follow the narration loosely.
export function revealAt(scene: Scene, pace: number, i: number, n: number, cue?: string): number {
  if (cue && scene.cues[cue] !== undefined) return scene.cues[cue];
  const first = 0.35 * pace;
  const span = Math.max(0, Math.min(scene.duration * 0.55, n * 1.4 * pace) - first);
  return n <= 1 ? first : first + (span * i) / (n - 1);
}

export function useRevealAt() {
  const scene = useScene();
  const pace = usePace();
  return (i: number, n: number, cue?: string): number => revealAt(scene, pace, i, n, cue);
}

export function useReveal(at: number, dur = 0.6): number {
  const t = useTime();
  const pace = usePace();
  return progress(t, at, dur * pace);
}

export const cueOr = (scene: Scene, name: string | undefined, fallback: number) =>
  name && scene.cues[name] !== undefined ? scene.cues[name] : fallback;

export const colorAt = (theme: Theme, i: number, override?: string) => override ?? theme.palette[i % theme.palette.length];
