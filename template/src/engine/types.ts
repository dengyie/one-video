export type Format = { prefix?: string; suffix?: string; decimals?: number; compact?: "none" | "zh" | "en" };

export type Theme = {
  name: string;
  colors: {
    bg: string; bgAlt: string; surface: string; border: string; text: string; muted: string;
    accent: string; accent2: string; positive: string; negative: string; highlight: string;
  };
  palette: string[];
  fonts: { body: string; number: string };
  background: Background;
  radius: number;
  transition: Transition | TransitionSpec;
  camera?: CameraMove | Camera;
  motion?: { pace?: "slow" | "medium" | "fast"; spring?: { damping?: number } };
  captionBg?: string;
};

export type Transition = "fade" | "slide" | "push" | "whip" | "zoom" | "punch" | "iris" | "wipe" | "clock" | "dip" | "through" | "cut";
export type Direction = "left" | "right" | "up" | "down";
export type TransitionSpec = { type: Transition; duration?: number; direction?: Direction; sfx?: string | null; focus?: [number, number] };
// A boundary as compiled: `frames` of overlap, `lead` of them before this scene's own start (in)
// or `tail` of them after its end (out).
// `focus`: where a through transition dives, in frame coordinates of the outgoing scene's layer
// before its shot track ("screen": already on screen).
export type Focus = { x: number; y: number; layer: "content" | "backdrop" | "screen" };
export type TransitionIn = { type: Transition; frames: number; lead: number; direction: Direction; focus?: Focus };
export type TransitionOut = { type: Transition; frames: number; tail: number; direction: Direction; nextOpaque: boolean; focus?: Focus };
export type CameraMove = "static" | "drift" | "push" | "pull" | "pan-left" | "pan-right" | "rise" | "handheld";
export type Camera = { move: CameraMove; amount?: number };
export type Background = "default" | "plain" | "grid" | "stars" | "media";

export type Overlay = {
  type: "lottie" | "icon" | "burst" | "confetti" | "arrow" | "mark" | "callout" | "stamp" | "lower-third" | "spotlight" | "flash" | "image" | "word";
  t: number; end: number;
  x?: number; y?: number; size?: number; color?: string;
  src?: string; loop?: boolean; speed?: number;
  icon?: string; label?: string; ring?: boolean; count?: number; origin?: "top" | "point";
  from?: [number, number]; to?: [number, number]; curve?: number;
  kind?: "circle" | "box" | "underline" | "highlight" | "strike"; rect?: [number, number, number, number];
  // Pinned to a scene element (its data-anchor name) at `place`; x/y/rect are the fallback.
  on?: string; place?: "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
  text?: string; subtitle?: string; side?: "left" | "right"; rotate?: number;
  asset?: string; shape?: "circle" | "rounded"; style?: "slam" | "rise" | "type";
  // Word only: 0–1 strength of the backing that keeps it legible over bright or busy media.
  scrim?: number;
};
export type Look = { grain?: number; vignette?: number; leak?: number };

export type Line = { text: string; start: number; end: number };

// One framing of a scene's shot track: the camera is centred on (x, y) (0–1 of the frame) at
// `zoom`, reached at scene time `t` either by a hard cut or an `ease`-second move.
export type Shot = { t: number; zoom: number; x: number; y: number; rotate: number; cut: boolean; ease: number };

export type Scene = {
  id: string;
  type: string;
  from: number;
  durationInFrames: number;
  start: number;
  duration: number;
  audio: string | null;
  enter: Transition | TransitionSpec | null;
  exit: Transition | TransitionSpec | null;
  transitionIn: TransitionIn | null;
  transitionOut: TransitionOut | null;
  camera: Camera;
  opaque: boolean;
  header: { title: string; subtitle?: string } | null;
  background: Background | null;
  backdrop: { asset: string; dim: number; blur: number; motion: "in" | "out" | "left" | "right" | "up" | "none"; startFrom: number } | null;
  captions: boolean;
  cues: Record<string, number>;
  lines: Line[];
  props: Record<string, any>;
  overlays?: Overlay[];
  shots?: Shot[];
};

// Video assets carry a JPEG sequence (seq/0001.jpg…, `frames` long at `fps`) when one was extracted.
// `depth` is a near-is-white depth map (an image, or a sequence dir for a video) when one was made.
export type Asset = { src: string; kind: "image" | "video"; credit: string; seq?: string; frames?: number; fps?: number; depth?: string; depthStep?: number; depthFrames?: number; luma?: string; pages?: number };

export type Timeline = {
  version: number;
  title: string;
  fps: number;
  width: number;
  height: number;
  aspect: string;
  totalFrames: number;
  duration: number;
  theme: Theme;
  watermark: string | null;
  captions: { enabled: boolean; style: "line" | "karaoke" | "kinetic" | "none"; items: { scene: string; text: string; start: number; end: number; top?: boolean }[] };
  narration: [number, number][];
  // `offset`: seconds into the track the video starts at.
  music: { src: string; offset?: number; volume: number; duckTo: number; fade: number; credit?: string | null } | null;
  sfx: { sound: string; src: string; at: number; volume: number; duration?: number }[];
  chapters: { title: string; start: number }[];
  assets: Record<string, Asset>;
  icons?: Record<string, { body: string; viewBox: string }>;
  lottie?: Record<string, any>;
  libraryCredits?: string[];
  look?: Look | null;
  // Music beat times in seconds (empty without music); shots and cues can snap to them.
  beats?: number[];
  scenes: Scene[];
  // Set only for a stem render: the one sound group to play.
  stem?: "voice" | "music" | "sfx";
};
