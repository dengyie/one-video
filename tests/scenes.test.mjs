import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorNames, compileTimeline, motionCues, overlaySound } from "../cli/lib/timeline/index.mjs";
import { findScreen } from "../cli/lib/vision/screen.mjs";
import { normRects, parseRects } from "../cli/lib/vision/capture.mjs";
import { isMonoDark, tintLottie } from "../cli/lib/library/catalog.mjs";
import { deviceGate, schemaGate } from "../cli/lib/review/gates.mjs";
import { resolveCountry } from "../cli/lib/library/geo.mjs";
import { collectIcons, resolveIcon } from "../cli/lib/library/icons.mjs";
import { example } from "./helpers.mjs";

const scenes = [
  { id: "k", type: "kinetic", duration: 3, props: { lines: [{ text: "一行", style: "slam", emphasis: ["一"] }], number: { value: 3 } } },
  { id: "h", type: "headline", duration: 3, props: { items: [{ outlet: "报", title: "标题", highlight: "标" }] } },
  { id: "u", type: "unit-grid", duration: 3, props: { icon: "rocket", groups: [{ count: 3, label: "a" }] } },
  { id: "s", type: "scale-compare", duration: 3, props: { items: [{ label: "a", value: 1 }, { label: "b", value: 9 }] } },
  { id: "p", type: "price-chart", duration: 3, props: { points: [["1", 1], ["2", 2]], events: [{ x: "2", label: "e" }] } },
  { id: "m", type: "map", duration: 3, props: { mode: "globe", highlight: [{ id: "美国" }, { id: "cn" }], pins: [{ lon: 1, lat: 2, label: "x" }], routes: [{ from: [0, 0], to: [10, 10] }] } },
  { id: "f", type: "focus", duration: 3, props: { asset: "a", regions: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: "这里" }] } },
  { id: "sp", type: "split", duration: 3, props: { mode: "pip", left: { title: "L" }, right: { value: 5 } } },
  { id: "ps", type: "photo-stack", duration: 3, props: { items: [{ asset: "a", caption: "c" }] } },
];

test("storyboard schema accepts every new scene type and rejects bad props", () => {
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "x", type: "kinetic", props: { lines: [{ text: "a", style: "spin" }] } }] });
  assert.ok(bad.some((i) => /style/.test(i.msg)));
  const badRegion = schemaGate("storyboard", { scenes: [{ id: "x", type: "focus", props: { asset: "a", regions: [{ x: 2, y: 0, w: 0.1, h: 0.1 }] } }] });
  assert.ok(badRegion.some((i) => /x/.test(i.msg)));
});

test("resolveCountry: numeric, ISO alpha-2, Chinese and Natural Earth names", () => {
  assert.equal(resolveCountry("156"), "156");
  assert.equal(resolveCountry("76"), "076");
  assert.equal(resolveCountry("CN"), "156");
  assert.equal(resolveCountry("美国"), "840");
  assert.equal(resolveCountry("Germany"), "276");
  assert.equal(resolveCountry("Atlantis"), null);
});

test("icons: Lucide names and aliases, namespaced flags, unknown names", () => {
  const rocket = resolveIcon("rocket");
  assert.ok(rocket.body.includes("<path") && rocket.viewBox === "0 0 24 24");
  const cn = resolveIcon("flag:cn");
  assert.ok(cn && !/id="(?!flag-cn-)/.test(cn.body));
  assert.equal(resolveIcon("no-such-icon-xyz"), null);
  assert.equal(resolveIcon("flag:../x"), null);
  assert.deepEqual([...collectIcons({ a: [{ icon: "x" }, { b: { icon: "y" } }], icon: 3 })], ["x", "y"]);
});

test("compileTimeline inlines icons, resolves map countries without mutating the storyboard", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[1] = { ...sb.scenes[1], type: "unit-grid", props: { icon: "rocket", groups: [{ count: 2, label: "a", icon: "flag:us" }] } };
  sb.scenes[2] = { ...sb.scenes[2], type: "map", props: { highlight: [{ id: "日本" }] } };
  const before = JSON.stringify(sb);
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(timeline.icons).sort(), ["flag:us", "rocket"]);
  assert.equal(timeline.scenes[2].props.highlight[0].id, "392");
  assert.equal(JSON.stringify(sb), before);
  sb.scenes[1].props.icon = "nope-nope";
  sb.scenes[2].props.highlight[0].id = "Atlantis";
  const bad = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets }).errors;
  assert.ok(bad.some((e) => /unknown icon "nope-nope"/.test(e)));
  assert.ok(bad.some((e) => /unknown country "Atlantis"/.test(e)));
});

test("compileTimeline marks full-frame scene types opaque", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  const asset = ex.fetchedAssets.items[0].id;
  sb.scenes[1] = { ...sb.scenes[1], type: "focus", backdrop: undefined, props: { asset, regions: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] } };
  sb.scenes[2] = { ...sb.scenes[2], type: "photo-stack", backdrop: undefined, props: { items: [{ asset }] } };
  const { timeline } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.equal(timeline.scenes[1].opaque, true);
  assert.equal(timeline.scenes[2].opaque, false);
});

test("storyboard schema validates overlays", () => {
  const ok = { id: "x", type: "kinetic", props: { lines: [{ text: "a" }] }, overlays: [
    { type: "lottie", src: "check", at: 0.5, tint: "#ffffff" },
    { type: "mark", kind: "circle", rect: [0.1, 0.1, 0.2, 0.1], sfx: "auto" },
    { type: "stamp", text: "SOLD", sfx: { sound: "impact", volume: 0.4 } },
    { type: "arrow", from: [0.1, 0.8], to: [0.5, 0.5], sfx: null },
  ] };
  assert.deepEqual(schemaGate("storyboard", { scenes: [ok] }), []);
  const bad = schemaGate("storyboard", { scenes: [{ ...ok, overlays: [{ type: "sparkler" }] }] });
  assert.ok(bad.some((i) => /type/.test(i.path + i.msg)));
  assert.ok(schemaGate("storyboard", { scenes: [{ ...ok, overlays: [{ type: "lottie", src: "a", tint: "white" }] }] }).length > 0);
});

test("compileTimeline compiles overlays: timing, icons, auto sfx, lottie inlining, tint and credits", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "sfx/ui-pop.wav", "music/bgm.wav"] });
  const sb = structuredClone(ex.storyboard);
  sb.scenes[1] = { ...sb.scenes[1], overlays: [
    { type: "icon", icon: "rocket", at: 0.5, duration: 1, sfx: "auto" },
    { type: "lottie", src: "check", at: 1 },
    { type: "lottie", src: "lottie-check-02", at: 1.5 },
  ] };
  const { timeline, errors } = compileTimeline({ ...ex, config: { ...ex.config, look: { grain: 0.3 } }, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const sc = timeline.scenes[1];
  const [icon, noto, line] = sc.overlays;
  assert.deepEqual([icon.t, icon.end], [0.5, 1.5]);
  assert.ok(!("at" in icon) && !("duration" in icon) && !("sfx" in icon));
  assert.equal(noto.end, +(sc.duration + 0.5).toFixed(3));
  assert.ok(timeline.icons.rocket);
  assert.ok(timeline.sfx.some((s) => s.sound === "ui-pop" && Math.abs(s.at - (sc.start + 0.5)) < 1e-6));
  // The colour emoji is inlined as-is; the black line icon gets a tinted copy keyed by colour.
  assert.equal(noto.src, "check");
  assert.equal(line.src, `lottie-check-02#${timeline.theme.colors.text}`);
  assert.deepEqual(Object.keys(timeline.lottie).sort(), ["check", line.src].sort());
  assert.deepEqual(timeline.look, { grain: 0.3 });
  assert.ok(timeline.libraryCredits.some((c) => /Noto/.test(c) && /CC BY/.test(c)));
  const src = timeline.scenes.find((s) => s.type === "sources");
  if (src && !sb.scenes.find((s) => s.id === src.id).props?.items?.length) assert.ok(src.props.items.some((l) => /Noto/.test(l)));

  sb.scenes[1].overlays = [{ type: "lottie", src: "no-such-lottie" }];
  const bad = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets }).errors;
  assert.ok(bad.some((e) => /unknown lottie "no-such-lottie"/.test(e)));
});

test("overlays pin to scene anchors with on: names per scene type, compile errors for unknown ones", () => {
  assert.deepEqual(anchorNames("stat-cards", { cards: [{ value: 1 }, { value: 2, cue: "rev" }] }), ["card1", "card2", "rev"]);
  assert.deepEqual(anchorNames("compare", { left: { title: "a", value: 1 }, right: { title: "b" } }), ["left", "right", "left-value"]);
  assert.deepEqual(anchorNames("share", { segments: [{ value: 1 }, { value: 2 }] }), ["ring", "seg1", "seg2"]);
  assert.deepEqual(anchorNames("bar-compare", { items: [{ value: 1, cue: "x" }] }), ["bar1", "x"]);
  assert.deepEqual(anchorNames("bar-race", { top: 2, periods: ["a", "b"], series: [{ name: "x" }, { name: "y" }, { name: "z" }] }), ["bar1", "bar2", "bar3", "rank1", "rank2", "period"]);
  assert.deepEqual(
    anchorNames("line-chart", { series: [{ points: [[1, 1], [2, 2]] }, { points: [[1, 3]] }], annotations: [{ x: 2, label: "peak", cue: "pk" }] }),
    ["point1", "point2", "last", "s2-point1", "s2-last", "note1", "pk"],
  );
  assert.deepEqual(anchorNames("canvas", { items: [{ id: "rev" }, { id: "cost" }] }), ["rev", "cost"]);
  assert.equal(anchorNames("kinetic", {}), null);
  assert.deepEqual(schemaGate("storyboard", { scenes: [{ id: "x", type: "kinetic", props: { lines: [{ text: "a" }] }, overlays: [{ type: "mark", on: "card1", place: "top-right" }] }] }), []);
  assert.ok(schemaGate("storyboard", { scenes: [{ id: "x", type: "kinetic", props: { lines: [{ text: "a" }] }, overlays: [{ type: "mark", on: "card1", place: "middle" }] }] }).length > 0);
  assert.ok(schemaGate("storyboard", { scenes: [{ id: "x", type: "kinetic", props: { lines: [{ text: "a" }] }, overlays: [{ type: "lottie", on: "last", offset: [0] }] }] }).length > 0);

  const ex = example();
  const sb = structuredClone(ex.storyboard);
  const i = sb.scenes.findIndex((s) => s.type !== "stat-cards" && !anchorNames(s.type, s.props));
  sb.scenes[i] = { ...sb.scenes[i], overlays: [{ type: "stamp", text: "!", on: "card1" }] };
  const errs = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets }).errors;
  assert.ok(errs.some((e) => /on "card1": .* scenes have no anchors/.test(e)), errs.join("\n"));
  sb.scenes[i] = { ...sb.scenes[i], type: "stat-cards", props: { cards: [{ value: 3, label: "a" }] }, overlays: [{ type: "stamp", text: "!", on: "card2" }, { type: "mark", on: "card1" }] };
  const out = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.ok(out.errors.some((e) => /on "card2" is not an element of this stat-cards scene \(card1\)/.test(e)), out.errors.join("\n"));
  sb.scenes[i].overlays = [{ type: "mark", on: "card1", place: "center", offset: [0, 160] }];
  const ok = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.ok(!ok.errors.some((e) => /overlay/.test(e)), ok.errors.join("\n"));
  const o = ok.timeline.scenes[i].overlays[0];
  assert.deepEqual([o.on, o.place, o.offset], ["card1", "center", [0, 160]]);
});

test("overlaySound: explicit, auto, project default and silence", () => {
  assert.equal(overlaySound({ type: "stamp" }, {}), null);
  assert.equal(overlaySound({ type: "stamp" }, { overlays: "auto" }).sound, "impact");
  assert.equal(overlaySound({ type: "stamp", sfx: null }, { overlays: "auto" }), null);
  assert.equal(overlaySound({ type: "stamp", sfx: "whoosh-fast" }, {}).sound, "whoosh-fast");
  assert.deepEqual(overlaySound({ type: "stamp", sfx: { sound: "boom", volume: 0.2 } }, {}), { sound: "boom", volume: 0.2 });
});

test("tintLottie recolours static colours; isMonoDark spots black line icons", () => {
  const data = { layers: [{ shapes: [{ ty: "st", c: { a: 0, k: [0, 0, 0, 1] } }, { ty: "fl", c: { a: 0, k: [0.05, 0.05, 0.05, 1] } }] }] };
  assert.equal(isMonoDark(data), true);
  const t = tintLottie(data, "#ff0000");
  assert.deepEqual(t.layers[0].shapes[0].c.k, [1, 0, 0, 1]);
  assert.equal(isMonoDark(t), false);
  assert.deepEqual(data.layers[0].shapes[0].c.k, [0, 0, 0, 1]);
  assert.throws(() => tintLottie(data, "red"));
});

test("a footage title fades out as a word lands on it, and keeps its time when the word is elsewhere", () => {
  const ex = example();
  const asset = ex.fetchedAssets.items[0].id;
  const sb = structuredClone(ex.storyboard);
  const hook = (overlays) => ({ ...sb.scenes[0], type: "footage", backdrop: undefined, shots: undefined, props: { asset, title: { text: "SpaceX", at: 0.5, y: 0.34, size: 300, duration: 4.8 } }, overlays });
  sb.scenes[0] = hook([{ type: "word", text: "SPCX", style: "slam", at: 2, y: 0.5, size: 220 }]);
  let { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.equal(timeline.scenes[0].props.title.duration, 1.2);
  sb.scenes[0] = hook([{ type: "word", text: "x", at: 2, x: 0.9, y: 0.9, size: 60 }]);
  ({ timeline } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets }));
  assert.equal(timeline.scenes[0].props.title.duration, 4.8);
});

test("device: steps get times, rect names resolve on the screen showing, results that hold too short warn, same device cuts", () => {
  const ex = example();
  const [a, b] = ex.fetchedAssets.items.map((x) => x.id);
  const items = ex.fetchedAssets.items.map((x) => (x.id === a ? { ...x, rects: { buy: [0.1, 0.6, 0.8, 0.1] } } : x.id === b ? { ...x, rects: { card: [0.05, 0.3, 0.9, 0.2] } } : x));
  const sb = structuredClone(ex.storyboard);
  const dev = (id, steps) => ({ ...sb.scenes[0], id, type: "device", backdrop: undefined, shots: undefined, props: { device: "phone", screens: [{ id: "home", asset: a }, { id: "detail", asset: b }], steps } });
  sb.scenes[0] = dev(sb.scenes[0].id, [{ at: 0.5, tap: "buy", label: "下单" }, { at: 1.2, screen: "detail", expand: { rect: "card" } }, { at: 1.6, collapse: true }]);
  sb.scenes[1] = { ...dev(sb.scenes[1].id, [{ tap: [0.5, 0.5] }, { screen: 1 }]), enter: undefined };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: { items }, config: { ...ex.config, beats: { snap: false } } });
  assert.deepEqual(errors, []);
  const [s0, s1] = timeline.scenes;
  assert.deepEqual(s0.props.steps[0].tap, [0.5, 0.65]);
  assert.deepEqual(s0.props.steps[1].expand.rect, [0.05, 0.3, 0.9, 0.2]);
  assert.ok(s1.props.steps.every((st) => typeof st.t === "number"));
  assert.equal(s1.transitionIn.type, "cut");
  const warns = deviceGate(timeline, {});
  assert.ok(warns.some((w) => w.msg.includes(`"${s0.id}" step 1`)));
  assert.deepEqual(motionCues(s0).map((c) => c.role), ["tap", "expand"]);
  const bad = compileTimeline({ ...ex, storyboard: { ...sb, scenes: [dev(sb.scenes[0].id, [{ at: 0.5, tap: "nope" }]), ...sb.scenes.slice(1)] }, assets: { items } });
  assert.ok(bad.errors.some((e) => /no rect "nope"/.test(e)));
});

test("match-cut: stills on fixed spacing or on the beats, too few beats is an error", () => {
  const ex = example();
  const ids = ex.fetchedAssets.items.slice(0, 3).map((x) => x.id);
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0] = { ...sb.scenes[0], type: "match-cut", backdrop: undefined, shots: undefined, overlays: undefined, props: { items: ids.map((asset) => ({ asset })), every: 0.4, from: 0.2 } };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.deepEqual(timeline.scenes[0].props.items.map((i) => i.t), [0.2, 0.6, 1]);
  assert.equal(timeline.scenes[0].opaque, true);
  sb.scenes[0].props.every = "beat";
  const res = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets, config: { ...ex.config, music: { enabled: false } } });
  assert.ok(res.errors.some((e) => /match-cut: 3 stills but only 0 beats/.test(e)));
});

test("footage screen steps: pages and scrolls get times, sound and count as something new", () => {
  const ex = example();
  const [a, b] = ex.fetchedAssets.items.map((x) => x.id);
  const sb = structuredClone(ex.storyboard);
  const corners = [[0.4, 0.2], [0.6, 0.2], [0.6, 0.8], [0.4, 0.8]];
  sb.scenes[0] = { ...sb.scenes[0], type: "footage", backdrop: undefined, shots: undefined, overlays: undefined, props: { asset: a, screen: { asset: b, corners, at: 0.3, steps: [{ at: 2.5, asset: a }, { scroll: 1 }] } } };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const steps = timeline.scenes[0].props.screen.steps;
  assert.deepEqual(steps.map((st) => st.t), [2.5, Math.min(3.7, timeline.scenes[0].duration)]);
  assert.deepEqual(motionCues(timeline.scenes[0]).map((c) => c.role), ["page", "page"]);
  assert.ok(timeline.assets[a] && timeline.assets[b]);
  const tall = ex.fetchedAssets.items.map((x) => (x.id === b ? { ...x, width: 1170, height: 5064, capture: { url: "https://x.com", full: true, viewport: [390, 844] } } : x));
  assert.equal(compileTimeline({ ...ex, storyboard: sb, assets: { items: tall } }).timeline.assets[b].pages, 2);
  assert.deepEqual(schemaGate("storyboard", { scenes: [{ id: "f", type: "footage", props: { asset: "a", screen: { asset: "ui", corners, steps: [{ at: 1, scroll: 0.5 }, { cue: "c", asset: "ui2" }] } } }] }), []);
  assert.ok(schemaGate("storyboard", { scenes: [{ id: "f", type: "footage", props: { asset: "a", screen: { asset: "ui", corners, steps: [{ scroll: 2 }] } } }] }).length);
});

test("storyboard schema: device, match-cut, footage screen and windows", () => {
  const ok = [
    { id: "d", type: "device", props: { device: "browser", url: "x.com", screens: [{ asset: "a" }], steps: [{ at: 1, tap: "buy" }, { cue: "c", expand: { rect: [0, 0, 0.5, 0.5] } }, { at: 3, collapse: true, camera: "device" }] } },
    { id: "m", type: "match-cut", props: { items: [{ asset: "a" }, { asset: "b", label: "x" }], every: "beat", title: "T" } },
    { id: "f", type: "footage", props: { asset: "a", screen: { asset: "ui", corners: [[0.4, 0.2], [0.6, 0.2], [0.6, 0.8], [0.4, 0.8]], occlude: { asset: "m" } }, windows: { asset: "b", count: 4 } } },
  ];
  assert.deepEqual(schemaGate("storyboard", { scenes: ok }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "f", type: "footage", props: { asset: "a", screen: { asset: "ui", corners: [[0, 0], [1, 0], [1, 1]] } } }] });
  assert.ok(bad.length);
});

test("findScreen: corners of a tilted dark quad on a bright frame, ignoring a dark border", () => {
  const w = 200, h = 120, rgb = Buffer.alloc(w * h * 3, 200);
  const quad = [[60, 20], [140, 30], [130, 100], [70, 95]];
  const inside = (x, y) => quad.every(([x0, y0], i) => { const [x1, y1] = quad[(i + 1) % 4]; return (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0) >= 0; });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) || x < 8) rgb.fill(10, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const hit = findScreen(rgb, w, h);
  assert.equal(hit.border, false);
  hit.corners.forEach(([x, y], i) => { assert.ok(Math.abs(x * w - quad[i][0]) < 3, `x${i}`); assert.ok(Math.abs(y * h - quad[i][1]) < 3, `y${i}`); });
  assert.equal(findScreen(Buffer.alloc(w * h * 3, 255), w, h), null);
});

test("capture: rect specs parse and boxes normalise to the image, clipped", () => {
  assert.deepEqual(parseRects("buy=#buy, card=.card > a"), { buy: "#buy", card: ".card > a" });
  assert.throws(() => parseRects("nope"), /name=selector/);
  assert.deepEqual(normRects({ a: { x: 39, y: 84.4, w: 312, h: 84.4 }, off: { x: 500, y: 0, w: 10, h: 10 }, gone: null }, 390, 844), { a: [0.1, 0.1, 0.8, 0.1] });
});
