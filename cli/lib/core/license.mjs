// Licence names the render accepts, shared by the licensing gate and the asset search (a candidate
// the gate would refuse is not offered). Allowlist, not denylist: anything not recognised as
// reusable blocks the render.
export function normalizeLicense(l) {
  const s = String(l ?? "").trim().toLowerCase().replace(/[-_]/g, " ");
  if (/^(pd|public domain|pdm|cc0|pd \(nasa\))/.test(s) || s.includes("public domain")) return "pd";
  if (s === "generated") return "generated";
  if (s.includes("pexels")) return "pexels";
  if (s.includes("pixabay")) return "pixabay";
  if (/\b(nc|nd)\b|non ?commercial|no ?deriv/.test(s)) return null;
  if (/^cc by sa\b/.test(s)) return "cc-by-sa";
  if (/^cc by\b/.test(s)) return "cc-by";
  if (s === "own" || s === "self") return "own";
  return null;
}
