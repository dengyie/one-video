// Silent showcase timeline: used by `remotion studio` when no project props are passed,
// and as the default props so every scene type can be previewed in isolation.
import style from "../../../styles/midnight-data.json";
import type { Scene, Theme, Timeline, Transition, CameraMove } from "./types";

const FPS = 30;
type Spec = Pick<Scene, "id" | "type" | "props"> & { seconds: number; header?: Scene["header"] };

const specs: Spec[] = [
  { id: "title", type: "title", seconds: 4, props: { kicker: "ONEVIDEO", title: "数据驱动的视频引擎", subtitle: "脚本 → 配音 → 时间轴 → 渲染 → 质检", date: "2026" } },
  { id: "chapter", type: "chapter", seconds: 3, props: { index: 1, title: "场景目录", subtitle: "22 种可组合场景" } },
  { id: "stats", type: "stat-cards", seconds: 5, header: { title: "关键数字" }, props: { cards: [
    { value: 1.75e12, format: { prefix: "$", compact: "en", decimals: 2 }, label: "估值" },
    { value: 155, format: { suffix: " 亿" }, label: "年收入（美元）" },
    { value: 38.5, format: { suffix: "%" }, label: "增速" },
  ] } },
  { id: "bars", type: "bar-compare", seconds: 5, header: { title: "对比" }, props: { format: { compact: "zh" }, items: [
    { label: "甲", value: 32e8 }, { label: "乙", value: 21e8, highlight: true }, { label: "丙", value: 9e8 }, { label: "丁", value: 4e8 },
  ] } },
  { id: "race", type: "bar-race", seconds: 7, header: { title: "排名变化" }, props: { top: 5, periods: ["2020", "2022", "2024", "2026"], series: [
    { name: "A", values: [10, 14, 20, 26] }, { name: "B", values: [16, 15, 14, 13] }, { name: "C", values: [5, 12, 22, 30] },
    { name: "D", values: [12, 11, 9, 8] }, { name: "E", values: [8, 9, 12, 15] }, { name: "F", values: [3, 4, 6, 18] },
  ] } },
  { id: "line", type: "line-chart", seconds: 6, header: { title: "趋势" }, props: { format: { suffix: "%" }, series: [
    { name: "收入增速", points: [["2021", 12], ["2022", 18], ["2023", 25], ["2024", 31], ["2025", 38]] },
  ], annotations: [{ x: "2024", label: "拐点" }] } },
  { id: "share", type: "share", seconds: 5, header: { title: "构成" }, props: { segments: [
    { label: "发射服务", value: 42 }, { label: "星链", value: 48 }, { label: "其他", value: 10 },
  ] } },
  { id: "timeline", type: "timeline", seconds: 6, header: { title: "时间线" }, props: { events: [
    { date: "2002", title: "成立" }, { date: "2008", title: "首次入轨" }, { date: "2015", title: "首次回收", highlight: true }, { date: "2020", title: "载人飞行" },
  ] } },
  { id: "quote", type: "quote", seconds: 4, props: { text: "精确的文字放在原生文字卡里，不交给 AI 生图。", author: "OneVideo 规则" } },
  { id: "bullets", type: "bullets", seconds: 5, header: { title: "三条原则" }, props: { items: ["每个数字都有来源", { text: "按句配音，时间轴实测", note: "字幕和动画对齐到真实语音" }, "渲染后自动质检"] } },
  { id: "compare", type: "compare", seconds: 5, props: { title: "两种做法", left: { title: "手工剪辑", items: ["慢", "难复用"] }, right: { title: "OneVideo", items: ["声明式", "可复现"], value: 10, format: { suffix: "×" } } } },
  { id: "kinetic", type: "kinetic", seconds: 5, props: { kicker: "KINETIC", lines: [
    { text: "一枚火箭", style: "rise" }, { text: "回收了", style: "slam", emphasis: ["回收"] }, { text: "四百次以上", style: "type", size: 1.3 },
  ], number: { value: 400, format: { suffix: "+" }, label: "次回收" } } },
  { id: "headline", type: "headline", seconds: 5, props: { items: [
    { outlet: "示例日报", title: "可回收火箭第一次成功着陆", date: "2015-12-21", highlight: "成功着陆" },
    { outlet: "示例周刊", title: "发射成本下降一个数量级", date: "2020-06-01", excerpt: "示例摘要，仅用于预览。", highlight: "一个数量级" },
  ] } },
  { id: "units", type: "unit-grid", seconds: 5, header: { title: "一百人里" }, props: { total: 100, columns: 20, icon: "user-round", groups: [
    { count: 62, label: "用过" }, { count: 25, label: "听说过" }, { count: 13, label: "不知道" },
  ], note: "示例数据" } },
  { id: "scale", type: "scale-compare", seconds: 5, props: { title: "体量对比", items: [
    { label: "小", value: 1, format: { suffix: " 吨" } }, { label: "中", value: 22, format: { suffix: " 吨" } }, { label: "大", value: 150, format: { suffix: " 吨" } },
  ] } },
  { id: "price", type: "price-chart", seconds: 6, props: { title: "示例价格", label: "USD", format: { prefix: "$" }, area: true,
    points: [["1月", 100], ["2月", 112], ["3月", 104], ["4月", 131], ["5月", 126], ["6月", 158], ["7月", 149], ["8月", 171]],
    events: [{ x: "4月", label: "利好", tone: "up" }, { x: "7月", label: "回调", tone: "down" }] } },
  { id: "map", type: "map", seconds: 6, props: { title: "航线", views: [{ center: [20, 30], zoom: 1 }, { center: [110, 30], zoom: 2.6, at: 2.5 }],
    highlight: [{ id: "156", label: "中国" }], pins: [{ lon: 116.4, lat: 39.9, label: "北京" }, { lon: 100.3, lat: 40.96, label: "酒泉" }, { lon: 110.95, lat: 19.6, label: "文昌" }],
    routes: [{ from: [110.95, 19.6], to: [103.8, 1.35], label: "示例航线" }] } },
  { id: "globe", type: "map", seconds: 5, props: { mode: "globe", spin: 8, views: [{ center: [-90, 25], zoom: 1 }],
    pins: [{ lon: -80.6, lat: 28.5, label: "卡纳维拉尔角" }, { lon: -97.2, lat: 26, label: "博卡奇卡" }] } },
  { id: "sources", type: "sources", seconds: 4, props: { items: ["示例数据，仅用于预览场景"] } },
];

// The demo cycles every transition and camera move so one preview shows them all.
const TRANSITIONS: Transition[] = ["fade", "push", "whip", "punch", "iris", "wipe", "clock", "dip", "slide", "zoom", "through", "cut"];
const CAMERAS: CameraMove[] = ["drift", "push", "pan-left", "handheld", "pull", "rise", "pan-right"];
let from = 0;
const scenes: Scene[] = specs.map((s, i) => {
  const durationInFrames = s.seconds * FPS;
  const type = TRANSITIONS[(i - 1 + TRANSITIONS.length) % TRANSITIONS.length];
  const frames = i === 0 ? 14 : type === "cut" ? 0 : 15;
  const scene: Scene = {
    id: s.id, type: s.type, from, durationInFrames, start: from / FPS, duration: s.seconds, audio: null,
    enter: null, exit: null, header: s.header ?? null, background: null,
    transitionIn: { type: i === 0 ? "fade" : type, frames, lead: i === 0 ? 0 : Math.floor(frames / 2), direction: "left" },
    transitionOut: null, camera: { move: CAMERAS[i % CAMERAS.length] }, opaque: false,
    backdrop: null, captions: true, cues: {}, lines: [], props: s.props,
  };
  from += durationInFrames;
  return scene;
});
scenes.forEach((sc, i) => {
  const next = scenes[i + 1];
  const tin = next?.transitionIn;
  sc.transitionOut = tin ? { type: tin.type, frames: tin.frames, tail: tin.frames - tin.lead, direction: tin.direction, nextOpaque: false } : { type: "fade", frames: 18, tail: 0, direction: "left", nextOpaque: false };
});

export const DEMO_TIMELINE: Timeline = {
  version: 1,
  title: "OneVideo demo",
  fps: FPS,
  width: 1920,
  height: 1080,
  aspect: "16:9",
  totalFrames: from,
  duration: from / FPS,
  theme: style as unknown as Theme,
  watermark: { text: "OneVideo", sub: "数据解说", position: "top-right", style: "badge" },
  captions: { enabled: false, style: "line", items: [] },
  narration: [],
  music: null,
  sfx: [],
  chapters: [],
  assets: {},
  // Inlined like the compiler does (cli/lib/library/icons.mjs), so the bundle never ships the icon set.
  icons: {
    "user-round": { viewBox: "0 0 24 24", body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></g>' },
  },
  scenes,
};
