import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [uni()],
  esbuild: command === "build" ? { drop: ["console", "debugger"] } : undefined,
}));
