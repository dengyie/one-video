import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, fit, nextTier, startTier } from "../web/site/abr.mjs";

const tiers = [
  { q: "1080p", height: 1080, kbps: 2528 },
  { q: "720p", height: 720, kbps: 1196 },
  { q: "480p", height: 480, kbps: 484 },
];

test("abr: the starting tier", () => {
  assert.equal(startTier([]), -1);
  assert.equal(startTier(tiers), 1, "no estimate: 720p");
  assert.equal(startTier(tiers, { saved: "1080p", saveData: true }), 0, "a picked quality wins");
  assert.equal(startTier(tiers, { saved: "4k" }), 1);
  assert.equal(startTier(tiers, { saveData: true }), 2);
  assert.equal(startTier(tiers, { kbps: 4000 }), 0, "a measured link may raise it");
  assert.equal(startTier(tiers, { kbps: 500 }), 2);
  assert.equal(startTier(tiers, { downlink: 10 }), 1, "downlink never raises the default");
  assert.equal(startTier(tiers, { downlink: 0.7 }), 2);
  assert.equal(startTier([tiers[0]]), 0, "only a tier above 720p: that one");
});

test("abr: fit keeps headroom and falls back to the lowest", () => {
  assert.equal(fit(tiers, 2528 * 1.3), 0);
  assert.equal(fit(tiers, 2528 * 1.3 - 1), 1);
  assert.equal(fit(tiers, 100), 2);
});

test("abr: throughput from buffer growth", () => {
  const s = (at, end, t) => ({ at, end, ahead: end - t });
  assert.equal(estimate([s(0, 2, 0)], 1000), null);
  assert.equal(estimate([s(0, 2, 0), s(2000, 3, 2)], 1000), null, "under 3 s of samples");
  const e = estimate([s(0, 2, 0), s(2000, 3, 2), s(4000, 4, 3)], 1000);
  assert.equal(e.rate, 0.5);
  assert.equal(e.kbps, 500);
  assert.equal(estimate([s(0, 0, 0), s(4000, 30, 2)], 1000), null, "a full buffer may have stopped loading");
  // Only the last span counts.
  const old = [s(0, 0, 0), s(1000, 20, 1), s(10000, 21, 8), s(16000, 22, 14)];
  assert.equal(estimate(old, 1000).rate, 1 / 6);
});

test("abr: step down when starving or stalled, never below the lowest", () => {
  assert.equal(nextTier(tiers, 0, { rate: 2, kbps: 5000 }, { ahead: 3 }), 0, "filling faster than playback");
  assert.equal(nextTier(tiers, 0, { rate: 0.9, kbps: 2300 }, { ahead: 10 }), 0, "slow but plenty ahead");
  assert.equal(nextTier(tiers, 0, { rate: 0.9, kbps: 2300 }, { ahead: 3 }), 1, "at least one step");
  assert.equal(nextTier(tiers, 0, { rate: 0.2, kbps: 500 }, { ahead: 3 }), 2, "straight to what fits");
  assert.equal(nextTier(tiers, 1, null, { ahead: 0, stalled: true }), 2);
  assert.equal(nextTier(tiers, 2, null, { ahead: 0, stalled: true }), 2);
});
