// Which web rendition the player plays (index.html imports it; tests/web-abr.test.mjs tests it).
// Tiers come from videos.json `renditions`, highest first, each with `kbps` (what it needs to play
// without stalling). The bytes come straight from MangoDrive, cross-origin, so the page cannot read
// transfer sizes; throughput is estimated from how fast the buffer grows while the video loads:
// buffered media seconds per wall-clock second × the tier's bitrate.

export const HEADROOM = 1.3; // a tier fits when the link carries its bitrate with this margin
const DEFAULT_HEIGHT = 720; // no estimate yet: start here (or the highest tier below it)

// Index of the tier to start with. `saved`: a quality the viewer picked; `kbps`: the last estimate
// in this browser; `downlink` (Mbps) and `saveData` from navigator.connection where there is one.
export function startTier(tiers, { saved = null, kbps = null, downlink = null, saveData = false } = {}) {
  if (!tiers.length) return -1;
  if (saved) {
    const i = tiers.findIndex((t) => t.q === saved);
    if (i >= 0) return i;
  }
  if (saveData) return tiers.length - 1;
  if (kbps > 0) return fit(tiers, kbps);
  // downlink is a coarse hint (Chrome caps it at 10 and knows nothing about a proxy): only let it
  // lower the default, never raise it.
  const d = tiers.findIndex((t) => (t.height ?? 0) <= DEFAULT_HEIGHT);
  const def = d >= 0 ? d : tiers.length - 1;
  return downlink > 0 ? Math.max(def, fit(tiers, downlink * 1000)) : def;
}

// The highest tier the throughput carries with headroom; the lowest when none does.
export function fit(tiers, kbps) {
  const i = tiers.findIndex((t) => (t.kbps ?? 0) * HEADROOM <= kbps);
  return i >= 0 ? i : tiers.length - 1;
}

// `samples`: [{ at: ms, end: buffered end (s) at the playhead, ahead: end − currentTime }] taken while
// the video loads. Returns { rate, kbps } over the last `span` ms, or null when there is too little
// to tell or the buffer is full enough that the browser may have stopped fetching.
export function estimate(samples, tierKbps, { span = 6000, full = 25 } = {}) {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.at - s.at <= span) ?? samples[0];
  const dt = (last.at - first.at) / 1000;
  if (dt < 3 || last.ahead >= full) return null;
  const rate = Math.max(0, last.end - first.end) / dt;
  return { rate, kbps: rate * tierKbps };
}

// Step down when the buffer is short and filling slower than playback, or after a stall; to the
// tier the estimate fits (at least one down). Returns the new index, or `i` to stay.
export function nextTier(tiers, i, est, { ahead, stalled = false, low = 6 } = {}) {
  if (i >= tiers.length - 1) return i;
  const starving = est && ahead < low && est.rate < 1;
  if (!starving && !stalled) return i;
  const to = est ? fit(tiers, est.kbps) : i + 1;
  return Math.max(i + 1, to);
}
