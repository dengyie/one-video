// Feeds built from the deployed videos.json at request time, so they carry whatever origin the site is
// served from: /feed.xml (RSS 2.0 with a video enclosure and Media RSS thumbnail per video, newest
// first), /sitemap.xml (the home page and each share page /w/<slug>, with Google video sitemap tags)
// and /robots.txt pointing at the sitemap. Pure strings, shared by worker.mjs and tests/web-feed.test.mjs.
export const FEEDS = {
  "/feed.xml": { type: "application/rss+xml; charset=utf-8", build: rss },
  "/sitemap.xml": { type: "application/xml; charset=utf-8", build: sitemap },
  "/robots.txt": { type: "text/plain; charset=utf-8", build: robots },
};

const SITE = "OneVideo 放映室";
const xml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c])
  // Characters XML 1.0 does not allow at all (control codes other than tab / newline / return).
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
const abs = (origin, p) => new URL(p, `${origin}/`).href;
const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d ?? "") ? d : null);
const newest = (videos) => videos.map((v) => day(v.date)).filter(Boolean).sort().pop() ?? null;

// `videos`: videos.json entries in site order (newest first); `generatedAt`: videos.json's stamp.
export function rss(videos, origin, generatedAt) {
  const built = generatedAt && !Number.isNaN(Date.parse(generatedAt)) ? new Date(generatedAt) : null;
  const items = videos.map((v) => {
    const page = `${origin}/w/${v.slug}`;
    const date = day(v.date);
    return [
      "<item>",
      `<title>${xml(v.title)}</title>`,
      `<link>${xml(page)}</link>`,
      `<guid isPermaLink="true">${xml(page)}</guid>`, // a re-cut is the same item, not a new one
      date ? `<pubDate>${new Date(`${date}T00:00:00Z`).toUTCString()}</pubDate>` : "",
      `<description>${xml(v.summary || v.title)}</description>`,
      `<enclosure url="${xml(abs(origin, v.video))}" length="${Number(v.size) || 0}" type="video/mp4"/>`,
      `<media:content url="${xml(abs(origin, v.video))}" type="video/mp4" medium="video"${v.duration ? ` duration="${Math.round(v.duration)}"` : ""}/>`,
      `<media:thumbnail url="${xml(abs(origin, v.poster))}"/>`,
      ...(v.tags ?? []).map((t) => `<category>${xml(t)}</category>`),
      "</item>",
    ].filter(Boolean).join("");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">`,
    "<channel>",
    `<title>${xml(SITE)}</title>`,
    `<link>${xml(`${origin}/`)}</link>`,
    `<atom:link href="${xml(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `<description>OneVideo 流水线产出的视频</description>`,
    `<language>zh-CN</language>`,
    built ? `<lastBuildDate>${built.toUTCString()}</lastBuildDate>` : "",
    ...items,
    "</channel>",
    "</rss>",
  ].filter(Boolean).join("\n") + "\n";
}

export function sitemap(videos, origin) {
  const home = newest(videos);
  const urls = [
    `<url><loc>${xml(`${origin}/`)}</loc>${home ? `<lastmod>${home}</lastmod>` : ""}</url>`,
    ...videos.map((v) => {
      const date = day(v.date);
      return [
        `<url><loc>${xml(`${origin}/w/${v.slug}`)}</loc>`,
        date ? `<lastmod>${date}</lastmod>` : "",
        "<video:video>",
        `<video:thumbnail_loc>${xml(abs(origin, v.poster))}</video:thumbnail_loc>`,
        `<video:title>${xml(v.title)}</video:title>`,
        `<video:description>${xml((v.summary || v.title).slice(0, 2048))}</video:description>`,
        `<video:content_loc>${xml(abs(origin, v.video))}</video:content_loc>`,
        v.duration ? `<video:duration>${Math.max(1, Math.min(28800, Math.round(v.duration)))}</video:duration>` : "",
        date ? `<video:publication_date>${date}</video:publication_date>` : "",
        "</video:video></url>",
      ].filter(Boolean).join("");
    }),
  ];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`,
    ...urls,
    "</urlset>",
  ].join("\n") + "\n";
}

export function robots(_videos, origin) {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}
