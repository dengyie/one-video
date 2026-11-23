import React from "react";
import { AbsoluteFill } from "remotion";
import type { Timeline } from "./types";
import { TimelineContext } from "./context";
import { Backdrop } from "../components/Backdrop";
import { Watermark } from "../components/Watermark";
import { FilmLook } from "../components/Overlay";
import { AudioTracks } from "./Audio";
import { Captions } from "./Captions";
import { SceneVisual } from "./Visuals";

export const Video: React.FC<Timeline> = (timeline) => {
  const { theme } = timeline;
  return (
    <TimelineContext.Provider value={timeline}>
      <AbsoluteFill data-probe="frame" style={{ backgroundColor: theme.colors.bg, fontFamily: theme.fonts.body, color: theme.colors.text }}>
        <Backdrop variant={theme.background} />
        {timeline.scenes.map((scene) => <SceneVisual key={scene.id} scene={scene} theme={theme} />)}
        <AudioTracks />
        <FilmLook />
        <Captions />
        <div data-probe="skip" style={{ display: "contents" }}>
          {timeline.watermark && <Watermark mark={timeline.watermark} />}
        </div>
      </AbsoluteFill>
    </TimelineContext.Provider>
  );
};
