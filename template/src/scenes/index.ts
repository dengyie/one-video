import type React from "react";
import { BulletsScene, ChapterScene, QuoteScene, SourcesScene, TitleScene } from "./Text";
import { BarCompareScene, BarRaceScene, LineChartScene, ShareScene, StatCardsScene } from "./Data";
import { CompareScene, MediaScene, TimelineScene } from "./Story";
import { HeadlineScene, KineticScene, PriceChartScene, ScaleCompareScene, UnitGridScene } from "./Motion";
import { MapScene } from "./Map";
import { FocusScene, PhotoStackScene, SplitScene } from "./Frame";
import { FootageScene, ParallaxScene } from "./Footage";
import { CanvasScene } from "./Canvas";
import { TableauScene } from "./Tableau";
import { DeviceScene, MatchCutScene } from "./Promo";

// Scene registry: keys must match the storyboard schema's scene type enum.
export const SCENES: Record<string, React.FC<any>> = {
  title: TitleScene,
  chapter: ChapterScene,
  "stat-cards": StatCardsScene,
  "bar-compare": BarCompareScene,
  "bar-race": BarRaceScene,
  "line-chart": LineChartScene,
  share: ShareScene,
  timeline: TimelineScene,
  quote: QuoteScene,
  bullets: BulletsScene,
  media: MediaScene,
  compare: CompareScene,
  sources: SourcesScene,
  kinetic: KineticScene,
  headline: HeadlineScene,
  "unit-grid": UnitGridScene,
  "scale-compare": ScaleCompareScene,
  "price-chart": PriceChartScene,
  map: MapScene,
  focus: FocusScene,
  split: SplitScene,
  "photo-stack": PhotoStackScene,
  footage: FootageScene,
  parallax: ParallaxScene,
  canvas: CanvasScene,
  tableau: TableauScene,
  device: DeviceScene,
  "match-cut": MatchCutScene,
};
