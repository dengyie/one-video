// The changes gates know how to make (issue.fix), applied to a storyboard and re-checked round by round:
// moving one sticker changes where the next one fits, so each round takes one change per scene.
import { checkProject } from "./check.mjs";

const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const fmt = (v) => (v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

// Applies one fix to `storyboard` in place. Returns what it changed ({ from, to } per key) or null when
// the target is not in the storyboard as written (an anchored overlay, a cue defined elsewhere);
// a fix with `add` may write a key the scene does not have yet. `with` lists more changes to the
// same scene that only make sense together (a cue and the element naming it): all or none.
// `set` merges one level down too, so { "9:16": { y } } keeps that frame's x.
export function applyFix(storyboard, fix) {
  const sb = storyboard?.scenes?.find((s) => s.id === fix.scene);
  const parts = [fix, ...(fix.with ?? []).map((w) => ({ add: fix.add, ...w }))];
  const spots = parts.map((f) => {
    const parent = f.path.slice(0, -1).reduce((v, k) => v?.[k], sb);
    const key = f.path.at(-1);
    if (!parent || typeof parent !== "object" || !(key in parent || (f.add && (f.value !== undefined || f.set)))) return null;
    if (f.set && parent[key] !== undefined && (!parent[key] || typeof parent[key] !== "object")) return null;
    return { f, parent, key };
  });
  if (spots.some((x) => !x)) return null;
  const change = {};
  for (const [i, { f, parent, key }] of spots.entries()) {
    if (f.set) {
      const obj = (parent[key] ??= {});
      for (const [k, v] of Object.entries(f.set)) {
        const to = isObj(obj[k]) && isObj(v) ? { ...obj[k], ...v } : v;
        change[k] = { from: obj[k], to };
        obj[k] = to;
      }
    } else {
      change[i ? f.path.join(".") : key] = { from: parent[key], to: f.value };
      parent[key] = f.value;
    }
  }
  return change;
}

// Runs the gates on `plan` (in memory), applies their fixes and checks again, up to `rounds` times.
// A target is changed once, so two gates cannot ping-pong it. Returns { applied, check } with
// `check` the last result; `plan.storyboard` holds the changed storyboard. `extra` are issues measured
// elsewhere (the stills probe) that the gates cannot re-check; their fixes are offered every round.
// The camera goes in before stickers are placed against it: a shot track moves where they land.
// A cue already written gets its element (props) before new cues are made up for the same reveal.
const FIRST = ["cues", "props", "shots"];

export function fixPlan(project, plan, { rounds = 8, extra = [] } = {}) {
  const applied = [];
  const touched = new Set();
  let check = checkProject(project, { plan });
  if (check.errors.some((i) => i.gate === "schema:storyboard")) return { applied, check };
  const mainAspect = check.timeline?.aspect ?? project.config.aspect ?? "16:9";
  const authored = new Map(plan.storyboard?.scenes?.map((s) => [s.id, s.overlays]));
  const aspectFix = (i) => {
    const { fix } = i;
    if (fix?.path[0] !== "overlays" || fix.path.length !== 2 || !fix.set) return i;
    const aspect = i.aspect ?? mainAspect;
    const hasOverride = authored.get(fix.scene)?.[fix.path[1]]?.aspects?.[aspect];
    if (!hasOverride && aspect === mainAspect) return i;
    return { ...i, fix: { ...fix, path: [...fix.path, "aspects"], set: { [aspect]: fix.set }, add: true } };
  };
  for (let r = 0; r < rounds; r++) {
    const target = (f) => `${f.scene}/${f.path.join(".")}${f.path.at(-1) === "aspects" ? `:${Object.keys(f.set).join(",")}` : ""}`;
    const scenes = new Set();
    const pick = [...check.issues, ...extra].map(aspectFix).filter((i) => i.fix && !touched.has(target(i.fix)))
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
