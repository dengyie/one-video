// Share pages: /w/<slug> is the player page (site/index.html) with that video's title, summary and
// poster in <title>, the description and Open Graph / Twitter tags, so a link pasted into a chat
// unfurls as the video. Pure string work, shared by worker.mjs and tests/web-share.test.mjs.
export const SHARE = /^\/w\/([a-z0-9][a-z0-9-]*)\/?$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SITE = "OneVideo 放映室";

// `html` is index.html; `video` its videos.json entry (null: an unknown slug, the plain page);
// `origin` like https://vedio.example. (index.html has <base href="/">, so its relative URLs hold.)
export function sharePage(html, video, origin) {
  if (!video) return html;
  const url = `${origin}/w/${video.slug}`;
  const abs = (p) => new URL(p, `${origin}/`).href;
  const summary = video.summary || `${SITE}的视频`;
  const tags = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="video.other">`,
    `<meta property="og:site_name" content="${esc(SITE)}">`,
    `<meta property="og:title" content="${esc(video.title)}">`,
    `<meta property="og:description" content="${esc(summary)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(abs(video.poster))}">`,
    `<meta property="og:video" content="${esc(abs(video.video))}">`,
    `<meta property="og:video:type" content="video/mp4">`,
    ...(video.duration ? [`<meta property="video:duration" content="${Math.round(video.duration)}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(video.title)}">`,
    `<meta name="twitter:description" content="${esc(summary)}">`,
    `<meta name="twitter:image" content="${esc(abs(video.poster))}">`,
  ];
  // Function replacements: a title or summary containing "$&" must not be read as a pattern.
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(video.title)} · ${esc(SITE)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${esc(summary)}">\n${tags.join("\n")}`);
}
