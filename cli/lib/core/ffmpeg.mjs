// Remotion ships ffmpeg/ffprobe builds; run them through its CLI so no system install is needed.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ONEVIDEO_ROOT, UserError } from "./project.mjs";

export const TEMPLATE_DIR = join(ONEVIDEO_ROOT, "template");
export const REMOTION_BIN = join(TEMPLATE_DIR, "node_modules", ".bin", "remotion");

export function requireRemotion() {
  if (!existsSync(REMOTION_BIN)) throw new UserError(`Remotion is not installed; run: npm ci --prefix ${TEMPLATE_DIR}`);
}

// Spawn and collect output; rejects with stderr tail on non-zero exit.
export function run(cmd, args, { cwd = TEMPLATE_DIR, stdio = "pipe" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout?.on("data", (d) => out.push(d));
    child.stderr?.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out), stderr = Buffer.concat(err).toString();
      if (code !== 0) return reject(new Error(`${cmd.split("/").pop()} ${args.slice(0, 2).join(" ")} exited ${code}: ${stderr.trim().split("\n").slice(-6).join("\n")}`));
      resolve({ stdout: stdout.toString(), stderr });
    });
  });
}

export function ffmpeg(args, opts) {
  requireRemotion();
  return run(REMOTION_BIN, ["ffmpeg", "-hide_banner", "-nostdin", ...args], opts);
}

export async function ffprobe(file) {
  requireRemotion();
  const { stdout } = await run(REMOTION_BIN, ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  return JSON.parse(stdout);
}
