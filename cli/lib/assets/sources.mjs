// Stock sources: keyless NASA Images (photos + video), Wikimedia Commons (photos + video),
// Openverse (photos) and the Internet Archive (video: newsreels, public-domain films, CC uploads);
// Pexels with PEXELS_API_KEY. Search, rank by licence / aspect / size.
import { getJson } from "../core/http.mjs";

const stripHtml = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const enc = encodeURIComponent;

export const PROVIDERS = {
  async nasa(query, { limit = 12, kind = "image" } = {}) {
    const j = await getJson(`https://images-api.nasa.gov/search?q=${enc(query)}&media_type=${kind === "video" ? "video" : "image"}&page_size=${limit}`);
    return (j.collection?.items ?? []).slice(0, limit).map((it) => {
      const d = it.data?.[0] ?? {};
      return {
        provider: "nasa", pid: d.nasa_id, kind: kind === "video" ? "video" : "image", title: d.title, author: d.photographer || d.secondary_creator || d.center || "NASA",
        license: "PD (NASA)", source: `https://images.nasa.gov/details/${enc(d.nasa_id)}`, preview: it.links?.[0]?.href, width: null, height: null,
        date: d.date_created?.slice(0, 10),
      };
    });
  },
  async wikimedia(query, { limit = 12, kind = "image" } = {}) {
    if (kind === "video") return wikimediaVideo(query, limit);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${enc(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=3840`;
    const j = await getJson(url);
    return Object.values(j.query?.pages ?? {})
      .sort((a, b) => a.index - b.index)
      .map((p) => {
        const ii = p.imageinfo?.[0] ?? {};
        const m = ii.extmetadata ?? {};
        return {
          provider: "wikimedia", pid: p.title, kind: "image", title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
          author: stripHtml(m.Artist?.value), license: stripHtml(m.LicenseShortName?.value) || "unknown", source: ii.descriptionurl,
          url: ii.thumburl || ii.url, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, mime: ii.mime,
        };
      })
      .filter((c) => /^image\/(jpeg|png|webp)/.test(c.mime ?? "") && !/\b(NC|ND)\b|non-?commercial/i.test(c.license));
  },
  async openverse(query, { limit = 12 } = {}) {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${enc(query)}&license_type=commercial,modification&page_size=${limit}`);
    return (j.results ?? []).map((r) => ({
      provider: "openverse", pid: r.id, kind: "image", title: r.title, author: r.creator,
      license: r.license === "cc0" ? "CC0" : r.license === "pdm" ? "PD" : `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim(),
      source: r.foreign_landing_url, url: r.url, width: r.width, height: r.height,
    }));
  },
  // Two passes, the phrase as a whole ("wall street" never matches "Wall-Garants"), open licences only
  // (public domain, CC0, CC BY, CC BY-SA): first the footage collections (Prelinger's ephemeral films,
  // Universal newsreels, FedFlix) by title, subject or description; then any film by title alone (its
  // full text matches stray words in long descriptions, and most of it is talks and vlogs).
  // The file is chosen per item later (archiveFullUrl), since an item can hold a film of gigabytes
  // next to a 480p copy.
  async archive(query, { limit = 12, kind = "image", getJsonFn = getJson } = {}) {
    if (kind !== "video") return [];
    const phrase = `"${String(query).replace(/["\\]/g, " ").trim()}"`;
    const open = "mediatype:movies AND (licenseurl:*publicdomain* OR licenseurl:*\\/by\\/* OR licenseurl:*\\/by-sa\\/*)";
    const ask = (q) => getJsonFn(`https://archive.org/advancedsearch.php?q=${enc(`${q} AND ${open}`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=${limit}&sort[]=downloads+desc&output=json`);
    const [footage, titled] = await Promise.all([
      ask(`(title:(${phrase}) OR subject:(${phrase}) OR description:(${phrase})) AND collection:(${ARCHIVE_FOOTAGE.join(" OR ")})`),
      ask(`title:(${phrase})`),
    ]);
    const seen = new Set();
    return [...(footage.response?.docs ?? []), ...(titled.response?.docs ?? [])].filter((d) => !seen.has(d.identifier) && seen.add(d.identifier)).map((d) => ({
      provider: "archive", pid: d.identifier, kind: "video", title: d.title, author: [].concat(d.creator ?? "Internet Archive")[0],
      license: licenseFromUrl(d.licenseurl), source: `https://archive.org/details/${enc(d.identifier)}`, width: null, height: null,
    })).filter((c) => c.license !== "unknown").slice(0, limit);
  },
  async pexels(query, { limit = 12, kind = "image" } = {}) {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw new Error("pexels needs PEXELS_API_KEY");
    const headers = { Authorization: key };
    if (kind === "video") {
      const j = await getJson(`https://api.pexels.com/videos/search?query=${enc(query)}&per_page=${limit}`, { headers });
      return (j.videos ?? []).map((v) => {
        const f = (v.video_files ?? []).filter((x) => x.file_type === "video/mp4" && x.width <= 1920).sort((a, b) => b.width - a.width)[0];
        return { provider: "pexels", pid: String(v.id), kind: "video", title: v.url.split("/").filter(Boolean).pop(), author: v.user?.name, license: "Pexels License", source: v.url, url: f?.link, width: f?.width, height: f?.height, duration: v.duration };
      }).filter((c) => c.url);
    }
    const j = await getJson(`https://api.pexels.com/v1/search?query=${enc(query)}&per_page=${limit}`, { headers });
    return (j.photos ?? []).map((p) => ({ provider: "pexels", pid: String(p.id), kind: "image", title: p.alt, author: p.photographer, license: "Pexels License", source: p.url, url: p.src?.large2x ?? p.src?.original, width: p.width, height: p.height }));
  },
};

// Commons serves transcodes of every video; take the sharpest WebM at or under 1080p.
async function wikimediaVideo(query, limit) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${enc(`${query} filetype:video`)}&prop=videoinfo&viprop=url|size|mime|extmetadata|derivatives`;
  const j = await getJson(url);
  return Object.values(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((p) => {
      const v = p.videoinfo?.[0] ?? {};
      const m = v.extmetadata ?? {};
      const d = (v.derivatives ?? []).filter((x) => /^video\/webm/.test(x.type ?? "") && (x.height ?? 0) <= 1080).sort((a, b) => b.height - a.height)[0];
      return {
        provider: "wikimedia", pid: p.title, kind: "video", title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
        author: stripHtml(m.Artist?.value), license: stripHtml(m.LicenseShortName?.value) || "unknown", source: v.descriptionurl,
        url: d?.src ?? v.url, width: d?.width ?? v.width, height: d?.height ?? v.height, duration: v.duration,
      };
    })
    .filter((c) => c.url && !/\b(NC|ND)\b|non-?commercial/i.test(c.license));
}

export const DEFAULT_PROVIDER_ORDER = ["nasa", "wikimedia", "openverse"];
export const DEFAULT_VIDEO_PROVIDERS = () => ["nasa", "wikimedia", "archive", ...(process.env.PEXELS_API_KEY ? ["pexels"] : [])];

// A Creative Commons licence URL as a short name; anything not open enough for reuse is "unknown".
export function licenseFromUrl(url) {
  const u = String(url ?? "").toLowerCase();
  if (/publicdomain\/zero/.test(u)) return "CC0";
  if (/publicdomain/.test(u)) return "PD";
  const m = /licenses\/(by|by-sa)\/([\d.]+)/.exec(u);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : "unknown";
}

// The Internet Archive item's best video file: MP4 (else WebM) at most 1080p and 400 MB, the
// sharpest that fits. Returns { url, width, height } or null.
export async function archiveFullUrl(identifier, { fetchJson = getJson, maxBytes = 400e6 } = {}) {
  const j = await fetchJson(`https://archive.org/metadata/${enc(identifier)}`);
  // Its mp4 is often only a 320x240 "_512kb" derivative next to a sharper original or ogv: of 480
  // lines or more, mp4 first; below that, simply the sharpest. Containers are the ones Remotion's
  // ffmpeg build reads (it has no MPEG program stream demuxer, so no .mpeg originals).
  const h = (f) => Number(f.height ?? 0);
  const mp4 = (f) => /\.mp4$/i.test(f.name);
  const files = (j.files ?? [])
    .filter((f) => /\.(mp4|webm|mov|ogv|avi)$/i.test(f.name) && Number(f.size ?? 0) <= maxBytes && h(f) <= 1080)
    .sort((a, b) => (h(b) >= 480) - (h(a) >= 480) || (h(a) >= 480 ? mp4(b) - mp4(a) : 0) || h(b) - h(a) || Number(b.size ?? 0) - Number(a.size ?? 0));
  const f = files[0];
  return f ? { url: `https://archive.org/download/${enc(identifier)}/${f.name.split("/").map(enc).join("/")}`, width: Number(f.width) || null, height: Number(f.height) || null } : null;
}

// Internet Archive collections of filmed footage (rather than lectures, streams and uploads).
export const ARCHIVE_FOOTAGE = ["prelinger", "universal_newsreels", "fedflix"];

// The download URL of a search hit whose results carry no direct link (NASA, Internet Archive).
export async function fullUrl(c) {
  if (c.provider === "nasa") return nasaFullUrl(c.pid, c.kind);
  if (c.provider === "archive") return (await archiveFullUrl(c.pid))?.url;
  return c.url;
}

// NASA search results only carry thumbnails; the asset manifest lists the full renditions.
// Video: ~large is ~1080p at a sane size; ~orig can run to gigabytes.
export async function nasaFullUrl(nasaId, kind = "image") {
  const j = await getJson(`https://images-api.nasa.gov/asset/${enc(nasaId)}`);
  const hrefs = (j.collection?.items ?? []).map((i) => i.href.replace(/^http:/, "https:"));
  if (kind === "video") {
    const mp4 = hrefs.filter((h) => /\.mp4$/i.test(h));
    return mp4.find((h) => /~large\./.test(h)) ?? mp4.find((h) => /~medium\./.test(h)) ?? mp4.find((h) => /~orig\./.test(h)) ?? mp4[0];
  }
  const img = hrefs.filter((h) => /\.(jpe?g|png)$/i.test(h));
  return img.find((h) => /~large\./.test(h)) ?? img.find((h) => /~orig\./.test(h)) ?? img.find((h) => /~medium\./.test(h)) ?? img[0];
}

const LICENSE_RANK = (l) => (/^(pd|public domain|cc0|pdm)/i.test(l) ? 0 : /pexels/i.test(l) ? 0.5 : /by-sa|by sa/i.test(l) ? 1.5 : /by/i.test(l) ? 1 : 3);

// Lower is better: license openness, aspect fit to the frame, resolution, the archive's own
// relevance order (`rank`, 0 = its best match) and, for footage, how much there is to search
// through for the usable seconds.
export function scoreCandidate(c, targetAspect = 16 / 9) {
  let s = LICENSE_RANK(c.license) + Math.min(c.rank ?? 0, 10) * 0.2;
  if (c.width && c.height) {
    s += Math.abs(Math.log(c.width / c.height / targetAspect)) * 2;
    const long = Math.max(c.width, c.height);
    if (long < 1280) s += long < 640 ? 3 : 1.5;
  } else s += 0.6;
  if (c.kind === "video" && c.duration > 600) s += c.duration > 1800 ? 1.5 : 0.75;
  return s;
}

// Providers whose CDN answered with a bot challenge: skipped for the rest of this process, so one
// blocked archive does not cost a request and a warning for every query.
const blocked = new Set();
const challenged = (msg) => /\b403\b/.test(msg) && /just a moment|cloudflare|cf-chl|attention required/i.test(msg);

export async function search(query, { providers = DEFAULT_PROVIDER_ORDER, kind = "image", limit = 12 } = {}) {
  const results = [];
  const errors = [];
  for (const name of providers) {
    const fn = PROVIDERS[name];
    if (!fn) { errors.push(`unknown provider "${name}"`); continue; }
    if (blocked.has(name)) continue;
    try {
      results.push(...(await fn(query, { limit, kind })).map((c, rank) => ({ rank, ...c })));
    } catch (e) {
      if (challenged(e.message)) {
        blocked.add(name);
        errors.push(`${name}: blocked by its CDN (403 bot challenge) from this machine; skipped for the rest of this run`);
      } else errors.push(`${name}: ${e.message.replace(/<[^>]*>[\s\S]*/, "").trim().slice(0, 200)}`);
    }
  }
  return { results, errors };
}
