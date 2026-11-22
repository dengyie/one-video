// The player's catalogue from MangoDrive (web/sync.mjs, drive source): every project at the drive
// root whose archive record lists plan/publish.json and the cut it names. Poster, captions and
// description come down into `vdir/<slug>/`, each checked against the record's sha256; the cut stays
// on the drive (the Worker streams it, web/drive.mjs). `drive` is anything with list / readJson /
// download(remote, sink) → { sha256 } (cli/lib/archive/drive.mjs, or a fake in tests).
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { joinRemote } from "../cli/lib/archive/index.mjs";

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
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
  const pub = JSON.parse(await fetchChecked(drive, base, "plan/publish.json", files, join(dst, ".publish.json")));
  if (!pub.video) throw new Error("plan/publish.json names no cut (published before the player read the drive): run onevideo publish again on its render node");
  if (!pub.poster) throw new Error("plan/publish.json names no poster frame: run onevideo publish again on its render node");
  const need = { video: pub.video, poster: pub.poster, ...KIT };
  for (const [what, rel] of Object.entries(need)) if (!files[rel]?.sha256) throw new Error(`${rel} (${what}) is not in the archive record yet`);

  // Re-download only when a file the page shows changed on the drive.
  const stamp = join(dst, ".synced");
  const want = JSON.stringify(Object.values(need).map((rel) => files[rel].sha256).concat(files["plan/publish.json"].sha256));
  const fresh = readText(stamp) === want && Object.values(LOCAL).every((f) => existsSync(join(dst, f)));
  if (!fresh) {
    for (const [what, file] of Object.entries(LOCAL)) await fetchChecked(drive, base, need[what], files, join(dst, file));
    writeFileSync(stamp, want);
    log(`↓ ${slug} (${pub.video}, ${(files[pub.video].size / 2 ** 20).toFixed(1)} MiB on the drive)`);
  } else log(`= ${slug}`);
  return entry(slug, pub, {
    size: files[pub.video].size,
    date: (pub.rendered ?? files[pub.video].at ?? record.at ?? new Date().toISOString()).slice(0, 10),
    v: files[pub.video].sha256.slice(0, 12),
    description: readFileSync(join(dst, LOCAL.description), "utf8"),
    drive: joinRemote(base, pub.video),
  });
}

// One archived file to a local path, checked against the archive record; returns its text.
async function fetchChecked(drive, base, rel, files, abs) {
  const part = `${abs}.part`;
  const got = await drive.download(joinRemote(base, rel), createWriteStream(part));
  if (got.sha256 !== files[rel].sha256) {
    rmSync(part, { force: true });
    throw new Error(`${rel} on the drive does not match its archive record (an archive run in flight?)`);
  }
  renameSync(part, abs);
  return readFileSync(abs, "utf8");
}

// One videos.json entry. `drive`: the cut's path on the drive (streamed by the Worker); without it
// the cut is the static asset v/<slug>/video.mp4.
export function entry(slug, pub, { size, date, v, description, drive }) {
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
  };
}

function readText(f) { try { return readFileSync(f, "utf8"); } catch { return null; } }
