import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const readGitValue = (args: string[], fallback = "unknown") => {
  try {
    return execFileSync("git", args, {
      cwd: new URL(".", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || fallback;
  } catch {
    return fallback;
  }
};

const readGitBuffer = (args: string[]) => {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return Buffer.alloc(0);
  }
};

const createWorkspaceRevision = () => {
  const trackedDiff = readGitBuffer([
    "diff",
    "--no-ext-diff",
    "--binary",
    "HEAD",
    "--",
    "src",
    "scripts",
    "package.json",
    "vite.config.ts"
  ]);
  const untrackedFiles = readGitValue([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "src",
    "scripts",
    "package.json",
    "vite.config.ts"
  ], "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  if (trackedDiff.length === 0 && untrackedFiles.length === 0) {
    return { dirty: false, digest: "clean" };
  }
  const digest = createHash("sha256");
  digest.update(trackedDiff);
  for (const relativePath of untrackedFiles) {
    digest.update(`\n--untracked:${relativePath}\n`);
    try {
      digest.update(readFileSync(resolve(projectRoot, relativePath)));
    } catch {
      digest.update("unreadable");
    }
  }
  return { dirty: true, digest: digest.digest("hex").slice(0, 10) };
};

const packageInfo = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version?: string };
const manifestInfo = JSON.parse(
  readFileSync(new URL("./src/manifest.json", import.meta.url), "utf8")
) as { versionName?: string; versionCode?: string };

const createBuildInfo = () => {
  const appVersion = manifestInfo.versionName || packageInfo.version || "0.0.0";
  const versionCode = manifestInfo.versionCode || "0";
  const gitCommit = readGitValue(["rev-parse", "--short=12", "HEAD"]);
  const gitBranch = readGitValue(["branch", "--show-current"], "detached");
  const workspaceRevision = createWorkspaceRevision();
  const buildTime = new Date().toISOString();
  const compactBuildTime = buildTime.replace(/[-:TZ.]/g, "").slice(0, 14);
  return {
    appVersion,
    versionCode,
    gitCommit,
    gitBranch,
    gitDirty: workspaceRevision.dirty,
    workspaceDigest: workspaceRevision.digest,
    buildTime,
    buildId: `${appVersion}+${gitCommit}${workspaceRevision.dirty ? `.dirty-${workspaceRevision.digest}` : ""}.${compactBuildTime}`
  };
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const buildInfo = createBuildInfo();
  return {
    plugins: [uni()],
    define: {
      __QKEER_BUILD_INFO__: JSON.stringify(buildInfo)
    },
    esbuild: command === "build" ? { drop: ["console", "debugger"] } : undefined,
  };
});
