// Heavy commands on a bigger machine: with ONEVIDEO_WORKERS set (ssh hosts, in order of preference),
// render / build / depth / stills / preview (and publish --formats) run on the idlest worker. The project stays
// here: it is mirrored to the same path on the worker, the job runs detached there (a dropped connection only
// pauses the log), and what it wrote comes back. The worker reads its own /etc/onevideo/env.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { ONEVIDEO_ROOT, UserError, findProjectRoot, log, warn } from "./project.mjs";

export const HEAVY = new Set(["render", "build", "depth", "stills", "preview"]);
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/ov-ssh-%C", "-o", "ControlPersist=120"];
const JOBS = "/tmp/onevideo-jobs";

export const workerHosts = (env = process.env) => (env.ONEVIDEO_WORKERS ?? "").split(/[\s,]+/).filter(Boolean);
export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// publish renders the other frame sizes it is asked for (--formats 9:16,1:1).
const heavy = (cmd, argv) => HEAVY.has(cmd) || (cmd === "publish" && argv.some((a) => a === "--formats" || a.startsWith("--formats=")));

// Run where we are: not a heavy command, already on a worker, --local, or no workers configured.
export function wantsWorker(cmd, argv, env = process.env) {
  return heavy(cmd, argv) && !env.ONEVIDEO_ON_WORKER && !argv.includes("--local") && workerHosts(env).length > 0;
}

const ssh = (host, script, opts = {}) => spawnSync("ssh", [...SSH, host, script], { encoding: "utf8", maxBuffer: 1 << 26, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The worker running the fewest OneVideo jobs (first listed wins a tie); null when none answers.
export function pickWorker(hosts, probe = (h) => ssh(h, "pgrep -fc '[o]nevideo.mjs' || true", { timeout: 20000 })) {
  let best = null;
  for (const host of hosts) {
    const r = probe(host);
    const busy = r.status === 0 ? Number.parseInt(r.stdout, 10) : NaN;
    if (!Number.isFinite(busy)) { warn(`worker ${host} unreachable`); continue; }
    if (!best || busy < best.busy) best = { host, busy };
    if (busy === 0) break;
  }
  return best?.host ?? null;
}

// Bring the worker's checkout to this commit (a bundle over ssh, no GitHub round trip); reinstall
// the template only when its lockfile moved.
function syncCode(host, root) {
  const head = execFileSync("git", ["-C", ONEVIDEO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const theirs = ssh(host, `git -C ${shq(root)} rev-parse HEAD`).stdout?.trim();
  if (theirs === head) return;
  const known = theirs && spawnSync("git", ["-C", ONEVIDEO_ROOT, "cat-file", "-e", `${theirs}^{commit}`]).status === 0;
  // The worker has everything up to the merge base. When HEAD is itself that base (the worker is
  // ahead), excluding it would leave an empty bundle, which git refuses: send HEAD whole.
  const base = known ? spawnSync("git", ["-C", ONEVIDEO_ROOT, "merge-base", "HEAD", theirs], { encoding: "utf8" }).stdout.trim() : "";
  const b = spawnSync("git", ["-C", ONEVIDEO_ROOT, "bundle", "create", "-", "HEAD", ...(base && base !== head ? [`^${base}`] : [])], { maxBuffer: 1 << 28 });
  if (b.status !== 0) throw new UserError(`worker ${host}: git bundle failed: ${b.stderr?.toString().trim() || `exit ${b.status}`}`);
  const bundle = b.stdout;
  log(`worker ${host}: code ${theirs?.slice(0, 7) || "?"} → ${head.slice(0, 7)}`);
  const r = ssh(host, `set -e; cd ${shq(root)}; f=$(mktemp); cat > "$f"; old=$(git rev-parse HEAD); git fetch -q "$f" HEAD; rm -f "$f"; git checkout -q -f --detach FETCH_HEAD; git diff --quiet "$old" HEAD -- template/package-lock.json || npm ci --prefix template --no-audit --no-fund --loglevel=error`, { input: bundle, stdio: ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) throw new UserError(`worker ${host}: code sync failed (exit ${r.status})`);
}

function rsync(args) {
  // No owner/group: files come back owned by whoever runs the CLI here, not the worker's uid.
  // -H: out/<name>.mp4 is a hard link to its version, one file on both sides.
  const r = spawnSync("rsync", ["-rlptzH", "--mkpath", "-e", `ssh ${SSH.join(" ")}`, ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new UserError(`rsync ${args.slice(-2).join(" → ")} exited ${r.status}`);
}

// Job ids start with the project's directory name; the job script's `cd` tells same-named projects apart.
const jobPrefix = (project) => basename(project).replace(/[^\w.-]/g, "_");
const cdLine = (project) => `cd ${shq(project)} ||`;

// This project's jobs on the worker: still running (no .exit yet and the process lives), or ended
// without their results coming back (the CLI was stopped with Ctrl-C, or the connection was lost).
export function projectJobs(host, project, run = ssh) {
  const r = run(host, `for f in ${JOBS}/${jobPrefix(project)}-*.sh; do [ -e "$f" ] && grep -qF ${shq(cdLine(project))} "$f" || continue; j=\${f%.sh}; if [ ! -e "$j.exit" ] && pgrep -f "$f" > /dev/null; then echo "running $j"; elif [ ! -e "$j.synced" ]; then echo "unsynced $j"; fi; done; true`, { timeout: 30000 });
  if (r.status !== 0) throw new UserError(`worker ${host}: could not list its jobs: ${r.stderr?.trim() || `exit ${r.status}`}`);
  const jobs = { running: [], unsynced: [] };
  for (const line of r.stdout.split("\n")) {
    const [kind, job] = line.trim().split(" ");
    if (jobs[kind] && job) jobs[kind].push(job);
  }
  return jobs;
}

// Start the job detached on the worker and stream its log until it writes an exit code.
async function runJob(host, project, cmd, argv, root) {
  const id = `${jobPrefix(project)}-${cmd}-${Date.now()}`, logf = `${JOBS}/${id}.log`, exitf = `${JOBS}/${id}.exit`;
  const job = ["set -a; [ -r /etc/onevideo/env ] && . /etc/onevideo/env; set +a", `${cdLine(project)} exit 97`, `ONEVIDEO_ON_WORKER=1 exec node ${shq(join(root, "cli", "onevideo.mjs"))} ${[cmd, ...argv].map(shq).join(" ")}`].join("\n");
  const start = ssh(host, `mkdir -p ${JOBS} && find ${JOBS} -type f -mtime +7 -delete; cat > ${JOBS}/${id}.sh && { setsid sh -c 'sh ${JOBS}/${id}.sh > ${logf} 2>&1 < /dev/null; echo $? > ${exitf}' > /dev/null 2>&1 < /dev/null & }`, { input: job });
  if (start.status !== 0) throw new UserError(`worker ${host}: could not start the job: ${start.stderr?.trim()}`);
  log(`worker ${host}: ${cmd} running (log ${logf}; Ctrl-C stops following, not the job)`);
  let off = 0, down = 0;
  while (true) {
    // The exit code is read before the log, so once it is there the log is complete.
    const r = spawnSync("ssh", [...SSH, host, `cat ${exitf} 2>/dev/null; echo; tail -c +${off + 1} ${logf} 2>/dev/null`], { maxBuffer: 1 << 26, timeout: 60000 });
    if (r.status !== 0) {
      if (++down === 1) warn(`worker ${host}: connection lost, retrying (the job keeps running)`);
      if (down > 300) throw new UserError(`worker ${host}: unreachable for 10+ min; the job may still be running (${logf})`);
      await sleep(2000);
      continue;
    }
    down = 0;
    const nl = r.stdout.indexOf(10), code = r.stdout.subarray(0, nl).toString().trim(), chunk = r.stdout.subarray(nl + 1);
    if (chunk.length) process.stdout.write(chunk), (off += chunk.length);
    if (code !== "") return { code: Number.parseInt(code, 10), id };
    await sleep(2000);
  }
}

// True when the command was handled on a worker (process.exitCode carries its result); false to run here.
export async function dispatch(cmd, argv) {
  if (!wantsWorker(cmd, argv)) return false;
  let project;
  try { project = findProjectRoot(); } catch { return false; }
  const host = pickWorker(workerHosts());
  if (!host) { warn("no worker reachable; running here"); return false; }
  const root = process.env.ONEVIDEO_WORKER_ROOT || "/opt/onevideo";
  syncCode(host, root);
  // The push below deletes on the worker what is not here: it must not run under a job that is
  // still writing, nor before an earlier job's results have come back.
  const jobs = projectJobs(host, project);
  if (jobs.running.length) throw new UserError(`worker ${host}: a job for this project is still running (log ${jobs.running[0]}.log); wait for it to end, then run again`);
  if (jobs.unsynced.length) {
    log(`worker ${host}: bringing back the results of ${jobs.unsynced.length} earlier job(s)`);
    rsync(["--update", `${host}:${project}/`, `${project}/`]);
    ssh(host, `touch ${jobs.unsynced.map((j) => shq(`${j}.synced`)).join(" ")}`);
  }
  rsync(["--delete", `${project}/`, `${host}:${project}/`]);
  // Licensed sound files live outside the repo; the raw import area stays here.
  const ext = process.env.ONEVIDEO_LIBRARY_EXT || "/srv/onevideo/library";
  if (existsSync(ext)) rsync(["--exclude", "_raw", `${ext}/`, `${host}:${ext}/`]);
  const { code, id } = await runJob(host, project, cmd, argv, root);
  // --update: a file edited here while the job ran is newer than the worker's copy and is kept.
  rsync(["--update", `${host}:${project}/`, `${project}/`]);
  ssh(host, `touch ${JOBS}/${id}.synced`);
  log(`worker ${host}: ${cmd} exited ${code}; results synced back`);
  process.exitCode = code;
  return true;
}
