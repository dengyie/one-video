import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHARE, sharePage } from "../web/share.mjs";

const INDEX = readFileSync(new URL("../web/site/index.html", import.meta.url), "utf8");
const video = { slug: "keeper", title: "守灯人 <$&>", summary: "一盏灯 \"守\" 了三十年", duration: 64.3, poster: "v/keeper/poster.jpg?v=abc", video: "v/keeper/video.mp4?v=abc" };

test("a share page carries the video's title, summary and absolute poster as Open Graph tags", () => {
  const html = sharePage(INDEX, video, "https://vedio.example");
  assert.match(html, /<title>守灯人 &lt;\$&amp;&gt; · OneVideo 放映室<\/title>/);
  assert.match(html, /<meta name="description" content="一盏灯 &quot;守&quot; 了三十年">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/vedio\.example\/v\/keeper\/poster\.jpg\?v=abc">/);
  assert.match(html, /<meta property="og:video" content="https:\/\/vedio\.example\/v\/keeper\/video\.mp4\?v=abc">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/vedio\.example\/w\/keeper">/);
  assert.match(html, /<meta property="video:duration" content="64">/);
  assert.equal(html.match(/<title>/g).length, 1);
  // The page's own relative URLs resolve from the root under /w/.
  assert.match(html, /<base href="\/">/);
});

test("an unknown slug gets the plain page; only well-formed slugs are share paths", () => {
  assert.equal(sharePage(INDEX, null, "https://vedio.example"), INDEX);
  assert.equal(SHARE.exec("/w/keeper")[1], "keeper");
  assert.equal(SHARE.exec("/w/keeper/")[1], "keeper");
  for (const p of ["/w/", "/w/Keeper", "/w/../x", "/w/a/b", "/v/keeper"]) assert.equal(SHARE.exec(p), null, p);
});
