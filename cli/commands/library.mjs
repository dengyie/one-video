// lib list | search | import | merge | verify | recipe — the shared asset library (cli/lib/library.mjs).
import { readFileSync } from "node:fs";
import { UserError, log, warn } from "../lib/core/project.mjs";
import { CATALOG, extRoot, fillRecipe, importCandidates, loadCatalog, loadRecipes, mergeCatalogs, recipeSlots, saveCatalog, searchCatalog, verifyCatalog, entryAvailable } from "../lib/library/catalog.mjs";

const row = (e) => `${e.id.padEnd(24)} ${(e.store === "ext" ? "ext " : "repo")} ${entryAvailable(e) ? "✓" : "·"} ${String(e.audio?.duration ?? e.lottie?.duration ?? "").padStart(6)}s  ${e.provenance?.source ?? ""}${e.note ? ` — ${e.note}` : ""}`;

export async function lib(args) {
  const [sub, ...rest] = args._;
  const catalog = loadCatalog();
  if (!sub || sub === "list") {
    const entries = catalog.entries.filter((e) => (!args.category || e.category === args.category) && (!args.kind || e.kind === args.kind));
    if (args.json) return console.log(JSON.stringify(entries, null, 2));
    const byCat = new Map();
    for (const e of entries) { const k = `${e.kind ?? "sfx"}:${e.category}`; byCat.set(k, [...(byCat.get(k) ?? []), e]); }
    for (const [key, es] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
      const def = catalog.defaults[key.startsWith("sfx:") ? key.slice(4) : key];
      console.log(`${key}  (default ${def ?? "—"})`);
      for (const e of es) console.log(`  ${row(e)}`);
    }
    return log(`${entries.length} entries, ${byCat.size} categories · ✓ = file on this host (ext store: ${extRoot()})`);
  }
  if (sub === "search") {
    const hits = searchCatalog(rest.join(" "), catalog);
    if (args.json) return console.log(JSON.stringify(hits, null, 2));
    for (const e of hits) console.log(row(e));
    return log(`${hits.length} matches`);
  }
  if (sub === "import") {
    if (!rest[0]) throw new UserError("usage: onevideo lib import <candidates.json> [--force]");
    const candidates = JSON.parse(readFileSync(rest[0], "utf8"));
    if (!Array.isArray(candidates)) throw new UserError("candidates file must be a JSON array");
    const res = await importCandidates(candidates, {
      catalog, force: Boolean(args.force),
      onEntry: ({ id, status, error }) => { if (status === "added") log(`+ ${id}`); else if (status === "failed") warn(`${id}: ${error}`); },
    });
    saveCatalog(res.catalog);
    return log(`import: ${res.added} added, ${res.skipped} kept/absent, ${res.failed} failed → ${CATALOG}`);
  }
  if (sub === "merge") {
    if (!rest[0]) throw new UserError("usage: onevideo lib merge <other-catalog.json>");
    const merged = mergeCatalogs(catalog, JSON.parse(readFileSync(rest[0], "utf8")));
    saveCatalog(merged);
    return log(`merged: ${merged.entries.length} entries`);
  }
  if (sub === "verify") {
    const res = verifyCatalog(catalog);
    const bad = res.filter((r) => r.status === "missing" || r.status === "mismatch");
    for (const r of bad) warn(`${r.id}: ${r.status}`);
    const n = (s) => res.filter((r) => r.status === s).length;
    log(`verify: ${n("ok")} ok, ${n("unavailable")} ext not on this host, ${n("missing")} missing, ${n("mismatch")} mismatch`);
    if (bad.length) process.exitCode = 1;
    return;
  }
  if (sub === "recipe") {
    const recipes = loadRecipes();
    if (!rest[0]) {
      if (args.json) return console.log(JSON.stringify(recipes, null, 2));
      for (const r of recipes) console.log(`${r.name.padEnd(20)} ${r.title} — ${r.description}${r.notes ? `（${r.notes}）` : ""}\n${"".padEnd(20)} 场景: ${r.scenes.map((s) => s.type).join(" + ")} · 槽位: ${recipeSlots(r).join(", ")}`);
      return log(`${recipes.length} recipes · onevideo lib recipe <name> [--id scene-id] [--set k=v,k2=v2 (a JSON value fills a whole slot)]`);
    }
    const r = recipes.find((x) => x.name === rest[0]);
    if (!r) throw new UserError(`unknown recipe "${rest[0]}" (${recipes.map((x) => x.name).join(", ")})`);
    const vars = Object.fromEntries(String(args.set ?? "").split(/,(?=\w+=)/).filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    const { scenes, missing } = fillRecipe(r, { id: typeof args.id === "string" ? args.id : undefined, vars });
    console.log(JSON.stringify(scenes, null, 2));
    if (missing.length) warn(`unfilled slots: ${missing.join(", ")} — replace the {{…}} strings before validate`);
    return;
  }
  throw new UserError(`unknown lib subcommand "${sub}" (list, search, import, merge, verify, recipe)`);
}
