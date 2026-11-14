// The changes gates know how to make (issue.fix), applied to a storyboard and re-checked round by round:
// moving one sticker changes where the next one fits, so each round takes one change per scene.
import { checkProject } from "./check.mjs";

const fmt = (v) => (v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

// Applies one fix to `storyboard` in place. Returns what it changed ({ from, to } per key) or null when
// the target is not in the storyboard as written (an anchored overlay, a cue defined elsewhere);
// a fix with `add` may write a key the scene does not have yet.
export function applyFix(storyboard, fix) {
  const sb = storyboard?.scenes?.find((s) => s.id === fix.scene);
  const parent = fix.path.slice(0, -1).reduce((v, k) => v?.[k], sb);
  const key = fix.path.at(-1);
  if (!parent || typeof parent !== "object" || !(key in parent || (fix.add && fix.value !== undefined))) return null;
  if (fix.set) {
    const obj = parent[key];
    if (!obj || typeof obj !== "object") return null;
    const change = Object.fromEntries(Object.entries(fix.set).map(([k, v]) => [k, { from: obj[k], to: v }]));
    Object.assign(obj, fix.set);
    return change;
  }
  const change = { [key]: { from: parent[key], to: fix.value } };
  parent[key] = fix.value;
  return change;
}

// Runs the gates on `plan` (in memory), applies their fixes and checks again, up to `rounds` times.
// A target is changed once, so two gates cannot ping-pong it. Returns { applied, check } with
// `check` the last result; `plan.storyboard` holds the changed storyboard.
// The camera goes in before stickers are placed against it: a shot track moves where they land.
const FIRST = ["cues", "shots"];

export function fixPlan(project, plan, { rounds = 8 } = {}) {
  const applied = [];
  const touched = new Set();
  let check = checkProject(project, { plan });
  for (let r = 0; r < rounds; r++) {
    const target = (f) => `${f.scene}/${f.path.join(".")}`;
    const scenes = new Set();
    const pick = check.issues.filter((i) => i.fix && !touched.has(target(i.fix)))
      .sort((a, b) => FIRST.indexOf(b.fix.path[0]) - FIRST.indexOf(a.fix.path[0]))
      .filter((i) => !scenes.has(i.fix.scene) && scenes.add(i.fix.scene));
    let n = 0;
    for (const i of pick) {
      touched.add(target(i.fix));
      const change = applyFix(plan.storyboard, i.fix);
      if (!change) continue;
      // A new shot track moves where the scene's stickers land: they may be placed again (once more).
      if (i.fix.path[0] === "shots") for (const k of [...touched]) if (k.startsWith(`${i.fix.scene}/overlays.`)) touched.delete(k);
      applied.push({ gate: i.gate, msg: i.msg, scene: i.fix.scene, path: i.fix.path, change });
      n++;
    }
    if (!n) break;
    check = checkProject(project, { plan });
  }
  return { applied, check };
}

export const describeFix = (a) => `${a.scene} ${a.path[0]}${a.path.slice(1).map((k) => (typeof k === "number" ? `[${k}]` : `.${k}`)).join("")}: ${Object.entries(a.change).map(([k, c]) => `${k} ${fmt(c.from)} → ${fmt(c.to)}`).join(", ")}`;
