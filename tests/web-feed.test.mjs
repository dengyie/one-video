import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEDS, robots, rss, sitemap } from "../web/feed.mjs";

const O = "https://videos.example";
const videos = [
  { slug: "keeper", title: "守灯人 <&>", summary: "一盏灯\u0007 \"守\" 了三十年", duration: 64.3, size: 31234567, date: "2026-11-20", tags: ["故事", "a&b"],
    video: "v/keeper/video.mp4?v=abc123", poster: "v/keeper/poster.jpg?v=abc123" },
  { slug: "old", title: "旧片", summary: "", duration: 0, size: 0, date: "unknown", video: "v/old/video.mp4?v=1", poster: "v/old/poster.jpg?v=1" },
];

test("rss: one item per video with an absolute enclosure, thumbnail and escaped text", () => {
  const x = rss(videos, O, "2026-11-22T10:00:00.000Z");
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.match(x, /<atom:link href="https:\/\/videos\.example\/feed\.xml" rel="self"/);
  assert.match(x, /<lastBuildDate>Sun, 22 Nov 2026 10:00:00 GMT<\/lastBuildDate>/);
  assert.equal(x.match(/<item>/g).length, 2);
  assert.match(x, /<title>守灯人 &lt;&amp;&gt;<\/title><link>https:\/\/videos\.example\/w\/keeper<\/link><guid isPermaLink="true">https:\/\/videos\.example\/w\/keeper<\/guid>/);
  assert.match(x, /<pubDate>Fri, 20 Nov 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(x, /<description>一盏灯 &quot;守&quot; 了三十年<\/description>/, "control characters dropped, quotes escaped");
  assert.match(x, /<enclosure url="https:\/\/videos\.example\/v\/keeper\/video\.mp4\?v=abc123" length="31234567" type="video\/mp4"\/>/);
  assert.match(x, /<media:content [^>]*duration="64"\/>/);
  assert.match(x, /<media:thumbnail url="https:\/\/videos\.example\/v\/keeper\/poster\.jpg\?v=abc123"\/>/);
  assert.match(x, /<category>a&amp;b<\/category>/);
  // A video with no usable date or summary still makes a valid item.
  const old = x.slice(x.lastIndexOf("<item>"));
  assert.doesNotMatch(old, /pubDate|duration=/);
  assert.match(old, /<description>旧片<\/description>/);
  assert.doesNotMatch(rss([], O, "not a date"), /lastBuildDate|<item>/);
});

test("sitemap: the home page and each share page with video tags; robots points at it", () => {
  const x = sitemap(videos, O);
  assert.match(x, /<url><loc>https:\/\/videos\.example\/<\/loc><lastmod>2026-11-20<\/lastmod><\/url>/);
  assert.match(x, /<loc>https:\/\/videos\.example\/w\/keeper<\/loc><lastmod>2026-11-20<\/lastmod><video:video>/);
  assert.match(x, /<video:content_loc>https:\/\/videos\.example\/v\/keeper\/video\.mp4\?v=abc123<\/video:content_loc>/);
  assert.match(x, /<video:duration>64<\/video:duration><video:publication_date>2026-11-20<\/video:publication_date>/);
  assert.match(x, /<loc>https:\/\/videos\.example\/w\/old<\/loc><video:video>/, "no lastmod for an unparseable date");
  assert.doesNotMatch(sitemap([], O), /lastmod/);
  assert.equal(robots(videos, O), "User-agent: *\nAllow: /\nSitemap: https://videos.example/sitemap.xml\n");
  assert.deepEqual(Object.keys(FEEDS), ["/feed.xml", "/sitemap.xml", "/robots.txt"]);
  for (const f of Object.values(FEEDS)) assert.equal(typeof f.build(videos, O, null), "string");
});
