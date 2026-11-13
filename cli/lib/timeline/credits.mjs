// Attribution: research sources, asset credits and library licence lines.
// One line per distinct source: "publisher · title · date". Facts first, then extra research.sources.
export function researchSources(research) {
  const seen = new Map();
  for (const s of [...(research?.facts ?? []).map((f) => f.source), ...(research?.sources ?? [])]) {
    if (!s?.title) continue;
    const line = [s.publisher, s.title, s.date].filter(Boolean).join(" · ");
    if (!seen.has(line)) seen.set(line, { line, url: s.url ?? null });
    else if (!seen.get(line).url && s.url) seen.get(line).url = s.url;
  }
  return [...seen.values()];
}

// On-screen credits for the sources scene: research sources, then the attribution of every asset
// the video shows (`used`: ids the storyboard references; candidates left unused are not credited).
export function sourceList(research, assets, extra = [], used = null) {
  const out = researchSources(research).map((s) => s.line);
  for (const a of assets?.items ?? []) {
    if (used && !used.has(a.id)) continue;
    const line = `${a.kind === "video" ? "视频" : "图片"}：${credit(a)}`;
    if (!out.includes(line)) out.push(line);
  }
  for (const line of extra) if (!out.includes(line)) out.push(line);
  return out;
}

// Library entries under an attribution licence (CC BY) owe a credit line in every video using them.
export function libraryCredit(entry) {
  const p = entry?.provenance ?? {};
  if (!/cc[- ]?by/i.test(p.license ?? "")) return null;
  return `动画：${[p.author ?? p.source, "CC BY 4.0"].filter(Boolean).join(" · ")}`;
}

export function collectAssetRefs(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => collectAssetRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "asset" || k === "avatar" || k === "logo") && typeof x === "string") out.add(x);
      else collectAssetRefs(x, out);
    }
  }
  return out;
}

export function credit(a) {
  if (a.license === "generated") return `AI 生成 · ${a.author ?? "image model"}`;
  return [a.title, a.author, a.license].filter(Boolean).join(" · ");
}
