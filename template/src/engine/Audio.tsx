import React from "react";
import { Html5Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { useTimeline } from "./context";
import { clamp01 } from "./motion";
import type { Timeline } from "./types";

// Music gain: full between lines, ducked under speech, with short ramps and fade in/out.
function musicGain(t: number, total: number, m: NonNullable<Timeline["music"]>, narration: Timeline["narration"]): number {
  const RAMP = 0.35;
  let d = Infinity;
  for (const [a, b] of narration) {
    if (t >= a && t <= b) { d = 0; break; }
    d = Math.min(d, t < a ? a - t : t - b);
  }
  const duck = m.duckTo + (m.volume - m.duckTo) * clamp01(d / RAMP);
  const fade = Math.min(clamp01(t / m.fade), clamp01((total - t) / m.fade));
  return duck * fade;
}

type AudioInput = Pick<Timeline, "scenes" | "music" | "sfx" | "duration" | "narration" | "stem" | "fps">;
type AudioTrack = React.FC<AudioInput>;

const AUDIO_TRACKS: Record<NonNullable<Timeline["stem"]>, AudioTrack> = {
  voice: ({ scenes }) => scenes.map((scene) => scene.audio && (
    <Sequence key={scene.id} name={`${scene.id} · voice`} from={scene.from} durationInFrames={scene.durationInFrames} layout="none">
      <Html5Audio src={staticFile(scene.audio)} />
    </Sequence>
  )),
  music: ({ music, fps, duration, narration }) => music && (
    <Html5Audio
      src={staticFile(music.src)}
      trimBefore={music.offset ? Math.round(music.offset * fps) : undefined}
      loop
      volume={(f) => musicGain(f / fps, duration, music, narration)}
    />
  ),
  sfx: ({ sfx, fps }) => sfx.map((s, i) => (
    <Sequence key={i} name={`sfx ${s.sound}`} from={Math.max(0, Math.round(s.at * fps))} durationInFrames={Math.round((s.duration ?? 3) * fps) + 2} layout="none">
      <Html5Audio src={staticFile(s.src)} volume={s.volume} />
    </Sequence>
  )),
};

export const AudioTracks: React.FC = () => {
  const { scenes, duration, narration, music, sfx, stem } = useTimeline();
  const { fps } = useVideoConfig();
  return Object.entries(AUDIO_TRACKS).map(([group, Track]) => (!stem || stem === group) &&
    <Track key={group} {...{ scenes, duration, narration, music, sfx, fps }} />,
  );
};
