// Publishing kit: SRT/VTT captions, platform chapters, credits and a description draft.
import { researchSources } from "../timeline/credits.mjs";
import { toSrt, toVtt } from "../captions/subtitles.mjs";

const pad = (n, w = 2) => String(n).padStart(w, "0");

export function chapterTime(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// YouTube/Bilibili chapter rules: first chapter at 0:00, at least 3, each ≥ 10s.
export function chapterList(chapters, duration) {
  const list = [...chapters].sort((a, b) => a.start - b.start);
  if (!list.length || list[0].start > 0) list.unshift({ title: "开场", start: 0 });
  const kept = list.filter((c, i) => i === 0 || c.start - list[i - 1].start >= 10);
  const warnings = [];
  if (kept.length < 3) warnings.push(`only ${kept.length} chapter(s); platforms need ≥3 for chapter markers`);
  if (kept.length !== list.length) warnings.push("dropped chapters shorter than 10s");
  if (duration && kept.length && duration - kept[kept.length - 1].start < 10) warnings.push("last chapter shorter than 10s");
  return { chapters: kept, text: kept.map((c) => `${chapterTime(c.start)} ${c.title}`).join("\n"), warnings };
}

export function creditsText(timeline, research) {
  const lines = [];
  const assets = Object.values(timeline.assets ?? {}).filter((a) => a.credit);
  if (assets.length) {
    lines.push("素材来源：");
    for (const a of assets) lines.push(`- ${a.credit}`);
  }
  if (timeline.libraryCredits?.length) {
    if (!assets.length) lines.push("素材来源：");
    for (const c of timeline.libraryCredits) lines.push(`- ${c.replace(/^动画：/, "动画 ")}`);
  }
  const sources = researchSources(research);
  if (sources.length) {
    lines.push("数据来源：");
    for (const src of sources) lines.push(`- ${src.line}${src.url ? ` ${src.url}` : ""}`);
  }
  if (timeline.music?.credit) lines.push(`背景音乐：${timeline.music.credit}`);
  return lines.join("\n");
}

// AI-generated assets carry no label in the video or the description: the uploader ticks the
// platform's AI-content tag, and this note says when one is due.
function aiNote(timeline) {
  const ids = Object.entries(timeline.assets ?? {}).filter(([, a]) => a.generated).map(([id]) => id);
  return ids.length ? [`${ids.length} AI-generated asset(s) in the cut (${ids.join(", ")}): tick the platform's AI-content tag when uploading`] : [];
}

export function buildPublishKit({ timeline, research, config, script }) {
  const ch = chapterList(timeline.chapters ?? [], timeline.duration);
  const meta = config.publish ?? {};
  const summary = meta.summary ?? script.summary ?? "";
  const description = [summary, ch.chapters.length >= 3 ? `章节：\n${ch.text}` : "", creditsText(timeline, research), (meta.tags ?? []).map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
  return {
    files: {
      "captions.srt": toSrt(timeline.captions.items),
      "captions.vtt": toVtt(timeline.captions.items),
      "chapters.txt": ch.text + "\n",
      "description.txt": description + "\n",
    },
    publish: {
      title: meta.title ?? timeline.title,
      summary,
      tags: meta.tags ?? [],
      duration: timeline.duration,
      chapters: ch.chapters,
      warnings: [...ch.warnings, ...aiNote(timeline)],
      cover: meta.cover ?? null,
    },
  };
}

// Sound groups a timeline actually plays, each rendered alone as a stem for a later remix.
export function stemGroups(timeline) {
  return [
    timeline.scenes.some((s) => s.audio) && "voice",
    timeline.music && "music",
    timeline.sfx?.length && "sfx",
  ].filter(Boolean);
}
