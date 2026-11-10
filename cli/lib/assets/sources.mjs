// Stock sources: keyless NASA Images (photos + video), Wikimedia Commons (photos + video) and
// Openverse (photos); Pexels with PEXELS_API_KEY. Search, rank by licence / aspect / size.
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
export const DEFAULT_VIDEO_PROVIDERS = () => ["nasa", "wikimedia", ...(process.env.PEXELS_API_KEY ? ["pexels"] : [])];

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

// Lower is better: license openness, aspect fit to the frame, and resolution.
export function scoreCandidate(c, targetAspect = 16 / 9) {
  let s = LICENSE_RANK(c.license);
  if (c.width && c.height) {
    s += Math.abs(Math.log(c.width / c.height / targetAspect)) * 2;
    if (Math.max(c.width, c.height) < 1280) s += 1.5;
  } else s += 0.6;
  return s;
}

export async function search(query, { providers = DEFAULT_PROVIDER_ORDER, kind = "image", limit = 12 } = {}) {
  const results = [];
  const errors = [];
  for (const name of providers) {
    const fn = PROVIDERS[name];
    if (!fn) { errors.push(`unknown provider "${name}"`); continue; }
    try {
      results.push(...(await fn(query, { limit, kind })));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { results, errors };
}
