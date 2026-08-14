import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
  const buildTime = new Date().toISOString();
  const compactBuildTime = buildTime.replace(/[-:TZ.]/g, "").slice(0, 14);
  return {
    appVersion,
    versionCode,
    gitCommit,
    gitBranch,
    buildTime,
    buildId: `${appVersion}+${gitCommit}.${compactBuildTime}`
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
