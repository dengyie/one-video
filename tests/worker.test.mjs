import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWorker, projectJobs, shq, wantsWorker, workerHosts } from "../cli/lib/core/worker.mjs";

test("only heavy commands go to a worker, and only when one is configured", () => {
  const env = { ONEVIDEO_WORKERS: "ov-a, ov-b" };
  assert.deepEqual(workerHosts(env), ["ov-a", "ov-b"]);
  assert.deepEqual(workerHosts({}), []);
  assert.equal(wantsWorker("render", ["--draft"], env), true);
  assert.equal(wantsWorker("build", [], env), true);
  assert.equal(wantsWorker("validate", [], env), false);
  assert.equal(wantsWorker("publish", [], env), false);
  assert.equal(wantsWorker("publish", ["--formats", "9:16"], env), true);
  assert.equal(wantsWorker("publish", ["--formats=1:1"], env), true);
  assert.equal(wantsWorker("render", ["--local"], env), false);
  assert.equal(wantsWorker("render", [], { ...env, ONEVIDEO_ON_WORKER: "1" }), false);
  assert.equal(wantsWorker("render", [], { ONEVIDEO_WORKERS: "" }), false);
});

test("the idlest reachable worker is picked, the first listed on a tie", () => {
  const probe = (busy) => (h) => (busy[h] === undefined ? { status: 255, stdout: "" } : { status: 0, stdout: `${busy[h]}\n` });
  assert.equal(pickWorker(["a", "b"], probe({ a: 0, b: 0 })), "a");
  assert.equal(pickWorker(["a", "b"], probe({ a: 1, b: 0 })), "b");
  assert.equal(pickWorker(["a", "b"], probe({ b: 2 })), "b");
  assert.equal(pickWorker(["a", "b"], probe({ a: 2, b: 1 })), "b");
  assert.equal(pickWorker(["a", "b"], probe({})), null);
});

test("arguments reach the worker's shell intact", () => {
  assert.equal(shq("--note"), "'--note'");
  assert.equal(shq("it's v2; rm -rf /"), `'it'\\''s v2; rm -rf /'`);
});

test("projectJobs sorts this project's jobs into running and not yet synced back", () => {
  let sent;
  const run = (host, cmd) => ((sent = cmd), { status: 0, stdout: "running /tmp/onevideo-jobs/demo-render-2\nunsynced /tmp/onevideo-jobs/demo-render-1\n\n" });
  assert.deepEqual(projectJobs("ov-a", "/srv/demo", run), { running: ["/tmp/onevideo-jobs/demo-render-2"], unsynced: ["/tmp/onevideo-jobs/demo-render-1"] });
  // Only jobs that cd into this very project count, not another checkout with the same basename.
  assert.match(sent, /demo-\*\.sh/);
  assert.ok(sent.includes(shq("cd '/srv/demo' ||")));
  assert.throws(() => projectJobs("ov-a", "/srv/demo", () => ({ status: 255, stdout: "", stderr: "no route" })), /could not list its jobs: no route/);
});
