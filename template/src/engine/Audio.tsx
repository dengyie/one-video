import React from "react";
import { Html5Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { useTimeline } from "./context";
import type { Timeline } from "./types";
import { musicVolumeProps } from "../../../shared/music-envelope.mjs";

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
      {...musicVolumeProps(fps, duration, music, narration)}
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
