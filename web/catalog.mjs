// The player's catalogue from MangoDrive (web/sync.mjs, drive source): every project at the drive
// root whose archive record lists plan/publish.json and the cut it names. Poster, captions and
// description come down into `vdir/<slug>/`, each checked against the record's sha256; the cut and
// its web renditions (publish.json `renditions`, out/publish/web-*.mp4) stay on the drive and the
// viewer's browser loads them from there (the Worker hands out signed links, web/drive.mjs). `drive` is anything with list / readJson /
// download(remote, sink) → { sha256 } (cli/lib/archive/drive.mjs, or a fake in tests).
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { joinRemote } from "../cli/lib/archive/index.mjs";

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const QUALITY = /^\d{3,4}p$/;
const KIT = { captions: "out/publish/captions.vtt", description: "out/publish/description.txt" };
const LOCAL = { poster: "poster.jpg", captions: "captions.vtt", description: "description.txt" };

// `previous`: slug → the entry the site lists now; a project that fails this run (a network error,
// an archive run in flight) keeps it while its files are still here.
export async function driveCatalogue({ drive, root = "", vdir, previous = new Map(), log = () => {}, warn = () => {} }) {
  const out = [];
  for (const e of await drive.list(root || "/")) {
    if (!e.is_dir || !SLUG.test(e.name)) continue;
    try {
      const v = await driveEntry(drive, root, vdir, e.name, log);
      if (v) out.push(v);
    } catch (err) {
      const prev = previous.get(e.name);
      const keep = prev && existsSync(join(vdir, e.name, LOCAL.poster));
      warn(`! ${e.name}: ${err.message}${keep ? " — keeping the listed version" : ""}`);
      if (keep) out.push(prev);
    }
  }
  return out;
}

async function driveEntry(drive, root, vdir, slug, log) {
  const base = joinRemote(root, slug);
  const record = await drive.readJson(joinRemote(base, "plan/archive.json"));
  const files = record?.files ?? {};
  if (!files["plan/publish.json"]) return null; // archived but never published
  const dst = join(vdir, slug);
  const made = !existsSync(dst);
  mkdirSync(dst, { recursive: true });
  try {
    return await publishedEntry(drive, base, dst, slug, record, files, log);
  } catch (err) {
    if (made) rmSync(dst, { recursive: true, force: true }); // nothing half-made for a project that never listed
    throw err;
  }
}

async function publishedEntry(drive, base, dst, slug, record, files, log) {
  const stage = mkdtempSync(join(dst, ".sync-"));
  try {
    return await stageEntry(drive, base, dst, stage, slug, record, files, log);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

async function stageEntry(drive, base, dst, stage, slug, record, files, log) {
  const publish = ".publish.json";
  await fetchChecked(drive, base, "plan/publish.json", files, join(stage, publish));
  const pub = JSON.parse(readFileSync(join(stage, publish), "utf8"));
  if (!pub.video) throw new Error("plan/publish.json names no cut (published before the player read the drive): run onevideo publish again on its render node");
  if (!pub.poster) throw new Error("plan/publish.json names no poster frame: run onevideo publish again on its render node");
  const need = { video: pub.video, poster: pub.poster, ...KIT };
  for (const [what, rel] of Object.entries(need)) if (!files[rel]?.sha256) throw new Error(`${rel} (${what}) is not in the archive record yet`);

  // Re-download only when a file the page shows changed on the drive.
  const stamp = join(dst, ".synced");
  const want = JSON.stringify(Object.values(need).map((rel) => files[rel].sha256).concat(files["plan/publish.json"].sha256));
  const fresh = readText(stamp) === want && [publish, ...Object.values(LOCAL)].every((f) => existsSync(join(dst, f)));
  if (!fresh) {
    for (const [what, file] of Object.entries(LOCAL)) await fetchChecked(drive, base, need[what], files, join(stage, file));
    writeFileSync(join(stage, ".synced"), want);
  }
  // Tiers already on the drive, highest first; one listed but not uploaded yet waits for the next run.
  const renditions = (Array.isArray(pub.renditions) ? pub.renditions : [])
    .filter((r) => QUALITY.test(r?.q ?? "") && typeof r.file === "string" && files[r.file]?.sha256)
    .map((r) => ({ q: r.q, height: Number(r.height) || null, kbps: Number(r.kbps) || null, size: files[r.file].size, v: files[r.file].sha256.slice(0, 12), drive: joinRemote(base, r.file) }))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const result = entry(slug, pub, {
    renditions,
    size: files[pub.video].size,
    date: (pub.rendered ?? files[pub.video].at ?? record.at ?? new Date().toISOString()).slice(0, 10),
    v: files[pub.video].sha256.slice(0, 12),
    description: readFileSync(join(fresh ? dst : stage, LOCAL.description), "utf8"),
    drive: joinRemote(base, pub.video),
  });
  if (!fresh) {
    for (const file of [publish, ...Object.values(LOCAL), ".synced"]) renameSync(join(stage, file), join(dst, file));
    log(`↓ ${slug} (${pub.video}, ${(files[pub.video].size / 2 ** 20).toFixed(1)} MiB on the drive)`);
  } else log(`= ${slug}`);
  return result;
}

// One archived file to a staging path, checked against the archive record.
async function fetchChecked(drive, base, rel, files, abs) {
  const sink = createWriteStream(abs);
  try {
    const [got] = await Promise.all([drive.download(joinRemote(base, rel), sink), finished(sink)]);
    if (got.sha256 !== files[rel].sha256) {
      throw new Error(`${rel} on the drive does not match its archive record (an archive run in flight?)`);
    }
  } finally { sink.destroy(); }
}

// One videos.json entry. `drive`: the cut's path on the drive (the Worker redirects to it); without
// it the cut is the static asset v/<slug>/video.mp4. `renditions` (drive only): the lighter tiers the
// player picks from, each at v/<slug>/video-<q>.mp4; the cut itself stays the download.
export function entry(slug, pub, { size, date, v, description, drive, renditions = [] }) {
  return {
    slug,
    title: pub.title,
    summary: pub.summary ?? "",
    duration: pub.duration,
    chapters: pub.chapters ?? [],
    tags: pub.tags ?? [],
    date,
    size,
    video: `v/${slug}/video.mp4?v=${v}`,
    poster: `v/${slug}/poster.jpg?v=${v}`,
    captions: `v/${slug}/captions.vtt?v=${v}`,
    description,
    ...(drive ? { source: "drive", drive } : { source: "static" }),
    ...(drive && renditions.length ? { renditions: renditions.map((r) => ({ q: r.q, height: r.height, kbps: r.kbps, size: r.size, video: `v/${slug}/video-${r.q}.mp4?v=${r.v}`, drive: r.drive })) } : {}),
  };
}

function readText(f) { try { return readFileSync(f, "utf8"); } catch { return null; } }
