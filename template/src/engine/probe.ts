// The stills probe (onevideo stills / preview): what each frame actually shows, measured in the
// page, for the CLI's review (cli/lib/review/probe.mjs). DOM measurement only: no React, no
// rendering; the overlay layer calls it once the frame is laid out.
import { hitsCaption } from "../../../shared/probe-order.mjs";
import type { Overlay } from "./types";

export const PROBE_TAG = "ONEVIDEO_PROBE ";
// template/stills.mjs collects these lines from the browser console.
export const logProbe = (rec: object) => console.log(`${PROBE_TAG}${JSON.stringify(rec)}`);

// The probe (onevideo stills): on-screen boxes, as frame fractions, of each sticker-like overlay and
// of visible text and caption plates, so the CLI can flag clashes the gates cannot model.
// `covers` is how much of each line's box the sticker's drawn shape hides, found by hit tests on a
// grid over their overlap: a tilted stamp's bounding box has empty corners. Only the middle of a
// line counts, where its glyphs are inked; the line box runs above and below them.
const PROBED = new Set(["image", "icon", "lottie", "stamp", "word"]);
type Frac = [number, number, number, number];
// Boxes are taken relative to the composition's root, which the renderer may place and scale off-page.
export function probeBoxes(layer: HTMLElement, list: Overlay[]) {
  const doc = layer.ownerDocument;
  const root = layer.closest("[data-probe=frame]") ?? doc.body;
  const F = root.getBoundingClientRect();
  const frame = (r: DOMRect): Frac | null => {
    const b: Frac = [Math.max(0, (r.left - F.left) / F.width), Math.max(0, (r.top - F.top) / F.height), Math.min(1, (r.right - F.left) / F.width), Math.min(1, (r.bottom - F.top) / F.height)];
    return b[2] - b[0] > 0.002 && b[3] - b[1] > 0.002 ? (b.map((v) => Math.round(v * 1000) / 1000) as Frac) : null;
  };
  const union = (rs: DOMRect[]) => (rs.length ? new DOMRect(Math.min(...rs.map((r) => r.left)), Math.min(...rs.map((r) => r.top)), Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)), Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top))) : null);
  const seen = (el: Element | null) => {
    let a = 1;
    for (let e = el; e; e = e.parentElement) {
      if (e.hasAttribute("data-ov") || e.getAttribute("data-probe") === "skip") return 0;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none") return 0;
      a *= Number(cs.opacity);
    }
    return a;
  };
  // What of a line its own ancestors leave showing (a mask, a scrolling strip, an odometer reel
  // clip their overflow on purpose), and the sides where it runs past the frame while nothing of its
  // own clips it sooner: its words are cut at the frame edge.
  const clipOf = (n: Node, r: DOMRect) => {
    let [l, t, rt, b] = [F.left, F.top, F.right, F.bottom];
    for (let e = n.parentElement; e && e !== root; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = e.getBoundingClientRect();
      if (cs.overflowX !== "visible") [l, rt] = [Math.max(l, c.left), Math.min(rt, c.right)];
      if (cs.overflowY !== "visible") [t, b] = [Math.max(t, c.top), Math.min(b, c.bottom)];
    }
    const sx = F.width * 0.005, sy = F.height * 0.005;
    const sides = [
      r.left < F.left - 2 * sx && l <= F.left + sx && "left",
      r.right > F.right + 2 * sx && rt >= F.right - sx && "right",
      r.top < F.top - 2 * sy && t <= F.top + sy && "top",
      r.bottom > F.bottom + 2 * sy && b >= F.bottom - sy && "bottom",
    ].filter((s): s is string => Boolean(s));
    const L = Math.max(l, r.left), T = Math.max(t, r.top), R = Math.min(rt, r.right), B = Math.min(b, r.bottom);
    return { sides, shown: R > L && B > T ? new DOMRect(L, T, R - L, B - T) : null };
  };
  // A line's plate: the nearest of its close ancestors painted as a label or card (a background or a
  // border) and smaller than a quarter of the frame, else its own element.
  const alpha = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m ? m[1].split(/[ ,/]+/).filter(Boolean) : []; return !m ? 0 : p.length > 3 ? Number(p[3].replace("%", "")) / (p[3].endsWith("%") ? 100 : 1) : 1; };
  const plateOf = (el: Element) => {
    for (let e: Element | null = el, k = 0; e && e !== root && k < 4; e = e.parentElement, k++) {
      const cs = getComputedStyle(e), b = e.getBoundingClientRect();
      const painted = alpha(cs.backgroundColor) > 0.3 || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      if (painted && b.width * b.height < 0.25 * F.width * F.height) return e;
    }
    return el;
  };
  // `a`: the line's opacity when under 1; `v`: the part its clipping ancestors leave showing, when
  // that is less than its box ([] when none of it shows); `over`: how much of its inked middle
  // another line or that line's plate is drawn on top of (`t` indexes texts).
  const texts: { text: string; box: Frac; cut?: string[]; a?: number; v?: Frac | []; over?: { t: number; area: number }[] }[] = [];
  const lines: { el: Element; plate: Element; r: DOMRect; shown: DOMRect | null }[] = [];
  const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = (n.textContent ?? "").trim();
    if (n.parentElement?.closest("[data-caption]")) continue;
    const a = text ? seen(n.parentElement) : 0;
    if (a < 0.5) continue;
    const range = doc.createRange();
    range.selectNodeContents(n);
    const r = union([...range.getClientRects()].filter((c) => c.width > 0 && c.height > 0));
    const box = r && frame(r);
    if (!r || !box) continue;
    const { sides: cut, shown } = clipOf(n, r);
    const v = shown ? frame(shown) : null;
    const part = !v ? { v: [] as [] } : v.some((x, k) => x !== box[k]) ? { v } : {};
    texts.push({ text: text.slice(0, 24), box, ...(cut.length ? { cut } : {}), ...(a < 0.995 ? { a: Math.round(a * 100) / 100 } : {}), ...part });
    lines.push({ el: n.parentElement!, plate: plateOf(n.parentElement!), r, shown });
  }
  const protectedViews = [...root.querySelectorAll("[data-caption-protected]")].filter((el) => seen(el) >= 0.5);
  const captionClashes: string[] = [];
  for (const el of root.querySelectorAll("[data-caption]")) {
    if (seen(el) < 0.5) continue;
    const r = el.getBoundingClientRect(), box = frame(r);
    if (!box) continue;
    const text = (el.textContent ?? "").slice(0, 24);
    const { sides, shown } = clipOf(el, r);
    texts.push({ text, box, ...(sides.length ? { cut: sides } : {}) });
    lines.push({ el, plate: el, r, shown });
    if (protectedViews.some((v) => {
      const b = v.getBoundingClientRect();
      return shown && Math.min(b.right, shown.right) - Math.max(b.left, shown.left) > 1
        && Math.min(b.bottom, shown.bottom) - Math.max(b.top, shown.top) > 1;
    })) captionClashes.push(text);
  }
  const N = 8;
  // Scene text under other scene text: down the hit-test stack at a grid over the line's inked middle,
  // the first element that is its own (or an ancestor) means it shows; the first inside another solid
  // line's plate means that line is drawn over it. Stickers and anything belonging to no line (full-frame
  // layers, a depth cut-out) are passed through; lines sharing a plate (one card) are not compared.
  const solid = texts.map((tx) => (tx.a ?? 1) >= 0.8);
  lines.forEach((ln, k) => {
    const s = ln.shown;
    if (!s || !solid[k]) return;
    const ink = ln.r.height * 0.2;
    const x0 = s.left, x1 = s.right, y0 = Math.max(s.top, ln.r.top + ink), y1 = Math.min(s.bottom, ln.r.bottom - ink);
    if (x1 <= x0 || y1 <= y0) return;
    const others = lines.map((o, j) => (j !== k && solid[j] && !o.plate.contains(ln.el) ? j : -1)).filter((j) => j >= 0);
    if (!others.length) return;
    const hits = new Map<number, number>();
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const px = x0 + ((a + 0.5) / N) * (x1 - x0), py = y0 + ((b + 0.5) / N) * (y1 - y0);
      for (const e of doc.elementsFromPoint(px, py)) {
        if (e.contains(ln.el)) break;
        if (e.closest("[data-ov]")) continue;
        const j = others.filter((j) => lines[j].plate.contains(e)).sort((p, q) => (lines[p].plate.contains(lines[q].plate) ? 1 : -1))[0];
        if (j === undefined) continue;
        hits.set(j, (hits.get(j) ?? 0) + 1);
        break;
      }
    }
    const cell = ((x1 - x0) / F.width) * ((y1 - y0) / F.height) / (N * N);
    if (hits.size) texts[k].over = [...hits].map(([t, h]) => ({ t, area: Math.round(h * cell * 1e6) / 1e6 }));
  });
  const overlays: { i: number; box: Frac; covers: { t: number; area: number }[] }[] = [];
  for (const el of layer.querySelectorAll<HTMLElement>("[data-ov]")) {
    const i = Number(el.dataset.ov);
    if (!list[i] || !PROBED.has(list[i].type)) continue;
    const r = union([...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((c) => c.width > 0 && c.height > 0));
    const box = r && frame(r);
    if (!box) continue;
    const covers: { t: number; area: number }[] = [];
    texts.forEach((tx, k) => {
      const ink = (tx.box[3] - tx.box[1]) * 0.2;
      const x0 = Math.max(box[0], tx.box[0]), y0 = Math.max(box[1], tx.box[1] + ink), x1 = Math.min(box[2], tx.box[2]), y1 = Math.min(box[3], tx.box[3] - ink);
      if (x1 <= x0 || y1 <= y0) return;
      let hits = 0;
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        const px = F.left + (x0 + ((a + 0.5) / N) * (x1 - x0)) * F.width, py = F.top + (y0 + ((b + 0.5) / N) * (y1 - y0)) * F.height;
        const stack = doc.elementsFromPoint(px, py);
        const target = lines[k].el;
        if (target.hasAttribute("data-caption")
          ? hitsCaption(stack, el, target) : stack.some((e) => el.contains(e))) hits++;
      }
      if (hits) covers.push({ t: k, area: Math.round(((hits / (N * N)) * (x1 - x0) * (y1 - y0)) * 1e6) / 1e6 });
    });
    overlays.push({ i, box, covers });
  }
  // `hit`: text-over-text coverage was hit-tested (`over`), so its absence means none.
  return { overlays, texts, hit: true, ...(captionClashes.length ? { captionClashes } : {}) };
}
