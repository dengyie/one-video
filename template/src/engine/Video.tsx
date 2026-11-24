import React from "react";
import { AbsoluteFill } from "remotion";
import type { Timeline } from "./types";
import { TimelineContext } from "./context";
import { Watermark } from "../components/Watermark";
import { FilmLook } from "../components/Overlay";
import { AudioTracks } from "./Audio";
import { Captions } from "./Captions";
import { QcBounds } from "./QcBounds";
import { VisualTrack } from "./Visuals";

export const Video: React.FC<Timeline> = (timeline) => {
  const { theme } = timeline;
  return (
    <TimelineContext.Provider value={timeline}>
      <AbsoluteFill data-probe="frame" style={{ backgroundColor: theme.colors.bg, fontFamily: theme.fonts.body, color: theme.colors.text }}>
        <VisualTrack />
        <AudioTracks />
        <FilmLook />
        <Captions />
        <div data-probe="skip" style={{ display: "contents" }}>
          {timeline.watermark && <Watermark mark={timeline.watermark} />}
        </div>
        <QcBounds />
      </AbsoluteFill>
    </TimelineContext.Provider>
  );
};
