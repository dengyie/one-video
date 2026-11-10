// plan/handoff.md: where a project stands, in one page, for whoever picks it up next (a new
// session, a subagent, the user). The facts are regenerated on every run; the three hand-written
// sections (what is locked, what the next round changes, notes) are carried over untouched.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pipelineDef, readJson } from "../core/project.mjs";
import { stageStatus } from "../core/state.mjs";
import { checkProject } from "../review/check.mjs";
import { ttsConfig } from "../voice/tts.mjs";
import { localStamp as stamp, readRenders } from "./renders.mjs";

export const MANUAL = ["锁定（不要改）", "下一轮只改", "备注"];
const EMPTY = "（空）";

export const handoffPath = (project) => join(project.root, "plan", "handoff.md");

// The bodies of the hand-written sections of an existing handoff, keyed by heading.
export function manualSections(md) {
  const out = {};
  for (const part of (md ?? "").split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    if (!MANUAL.includes(head)) continue;
    const body = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    if (body && body !== EMPTY) out[head] = body;
  }
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

// `lock` adds a line to the locked list; `next` replaces the next-round line (one change per round).
export function buildHandoff(project, { lock, next, now = new Date() } = {}) {
  const { config } = project;
  const file = handoffPath(project);
  const manual = manualSections(existsSync(file) ? readFileSync(file, "utf8") : "");
  if (lock) {
    const lines = (manual[MANUAL[0]] ?? "").split("\n").filter(Boolean);
    const item = `- ${lock}`;
    if (!lines.includes(item)) lines.push(item);
    manual[MANUAL[0]] = lines.join("\n");
  }
  if (next) manual[MANUAL[1]] = `- ${next}`;

  const pipeline = pipelineDef(config.pipeline);
  const stages = stageStatus(project, pipeline);
  const icon = { done: "●", approved: "✔", "awaiting-approval": "◐", stale: "↻", pending: "○", optional: "◌" };
  const nextStage = stages.find((r) => !["done", "approved", "optional"].includes(r.status));

  const tts = ttsConfig(config);
  const music = config.music ?? {};
  const params = [
    `- 流水线 ${config.pipeline} · 风格 ${config.style} · 画幅 ${config.aspect}${config.targetSeconds ? ` · 目标 ${config.targetSeconds}s` : ""}`,
    `- 配音：${tts.model} · ${tts.voice}${tts.speed ? ` · 语速 ${tts.speed}` : ""}${tts.style ? ` · ${clip(tts.style, 30)}` : ""}`,
    `- 音乐：${music.enabled === false ? "关" : [music.preset ?? "默认", music.file, music.offset !== undefined ? `offset ${music.offset}` : null].filter(Boolean).join(" · ")}`,
  ];

  const assets = readJson(project.paths.assets, { items: [] }).items ?? [];
  const assetRows = assets.map((a) => [
    a.id, a.kind ?? "image", a.file ? (a.via ?? "") : "未取",
    a.picked !== undefined ? `take ${a.picked}${a.pickReason ? `：${a.pickReason}` : ""}` : "",
    a.inspect ? `${a.inspect.score ?? "?"}/10${a.inspect.kept ? ` 保留 ${a.inspect.kept[0]}s+${a.inspect.kept[1]}s` : ""}${a.inspect.issues?.length ? `；${a.inspect.issues.slice(0, 2).map((i) => i.issue).join("；")}` : ""}` : "",
  ]);

  const renders = readRenders(project).slice(-5).reverse();
  const renderRows = renders.map((r) => [
    `v${r.v}${r.pruned ? "（已清理）" : ""}`, r.at ? stamp(r.at) : "",
    [r.draft ? "draft" : "full", r.part ? "part" : null].filter(Boolean).join("+"),
    r.part ? `${r.offset}s 起${r.scenes ? ` (${r.scenes.join(",")})` : ""}` : "全片", r.timeline, r.note ?? "",
  ]);

  const look = readJson(join(project.paths.out, "qc", "look.json"), null);
  const review = readJson(project.paths.review, null);
  const rank = { high: 0, medium: 1, low: 2 };
  const lookLines = look ? [
    `- look ${look.score ?? "?"}/10（${look.video}，${look.at ? stamp(look.at) : ""}）`,
    ...[...(look.notes ?? [])].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5).map((n) => `  - [${n.severity}] ${n.t}s ${n.scene ?? ""}：${n.issue}${n.fix ? ` → ${n.fix}` : ""}`),
  ] : ["- 还没跑 look"];
  if (review) lookLines.push(`- qc ${review.verdict}${review.checks?.some((c) => c.status !== "pass") ? `：${review.checks.filter((c) => c.status !== "pass").map((c) => `${c.id} ${c.status}`).join("，")}` : ""}`);

  const { errors, warnings } = checkProject(project);
  const open = [...errors, ...warnings];
  const issueLines = open.length ? open.slice(0, 12).map((i) => `- ${i.level === "error" ? "✗" : "⚠"} [${i.gate}] ${i.msg}`) : ["- 无"];
  if (open.length > 12) issueLines.push(`- …另有 ${open.length - 12} 条，见 onevideo validate`);

  return [
    `# 交接：${config.title}`,
    "",
    `> ${stamp(now)} 由 \`onevideo handoff\` 生成。下面三节手写，重跑时保留；其余每次重写。接手的人先读这页，再 \`onevideo status\`。`,
    "",
    ...MANUAL.flatMap((h) => [`## ${h}`, "", manual[h] ?? EMPTY, ""]),
    "## 阶段",
    "",
    ...stages.map((r) => `- ${icon[r.status]} ${r.id} ${r.status}`),
    ...(nextStage ? ["", `下一步：${nextStage.id}（${nextStage.director}${nextStage.command ? ` · ${nextStage.command}` : ""}）`] : []),
    "",
    "## 已定参数",
    "",
    ...params,
    "",
    "## 素材",
    "",
    assetRows.length ? table(["id", "类型", "来源", "挑选", "质检"], assetRows) : "无",
    "",
    "## 渲染（最近 5 次）",
    "",
    renderRows.length ? table(["版本", "时间", "类型", "范围", "时间轴", "备注"], renderRows) : "还没有渲染",
    ...(renders.length > 1 ? ["", `对比：\`onevideo sheet --vs v${renders[1].v}\``] : []),
    "",
    "## 看片",
    "",
    ...lookLines,
    "",
    "## 待处理",
    "",
    ...issueLines,
    "",
  ].join("\n");
}

export const handoffRel = (project) => relative(project.root, handoffPath(project));
