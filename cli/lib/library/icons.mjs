// Icon resolution at compile time: storyboard props name icons ("rocket", "flag:cn"), the
// compiler inlines just those SVG bodies into timeline.icons so the bundle never ships the sets.
// Sources: Lucide (ISC) via @iconify-json/lucide, circle-flags (MIT).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATE_DIR } from "../core/ffmpeg.mjs";

let lucide = null;
function lucideSet() {
  if (!lucide) {
    const file = join(TEMPLATE_DIR, "node_modules", "@iconify-json", "lucide", "icons.json");
    lucide = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { icons: {}, aliases: {}, width: 24, height: 24 };
  }
  return lucide;
}

// → {body, viewBox} or null. Flag SVG ids are namespaced so several flags can share a page.
export function resolveIcon(name) {
  if (typeof name !== "string" || !name) return null;
  if (name.startsWith("flag:")) {
    const code = name.slice(5).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(code)) return null;
    const file = join(TEMPLATE_DIR, "node_modules", "circle-flags", "flags", `${code}.svg`);
    if (!existsSync(file)) return null;
    const svg = readFileSync(file, "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 512 512";
    const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
      .replace(/id="([^"]+)"/g, (_, id) => `id="flag-${code}-${id}"`)
      .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#flag-${code}-${id})`);
    return { body, viewBox };
  }
  const set = lucideSet();
  const key = set.icons[name] ? name : set.aliases?.[name]?.parent;
  const icon = key && set.icons[key];
  if (!icon) return null;
  return { body: icon.body, viewBox: `0 0 ${icon.width ?? set.width ?? 24} ${icon.height ?? set.height ?? 24}` };
}

// Every string under an "icon" key, anywhere in a props/overlays tree.
export function collectIcons(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => collectIcons(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (k === "icon" && typeof x === "string") out.add(x);
      else collectIcons(x, out);
    }
  }
  return out;
}
