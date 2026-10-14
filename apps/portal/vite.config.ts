import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation for the WebGPU smoke page (apps/portal/public/webgpu-smoke.html):
// it needs SharedArrayBuffer for multithreaded ffmpeg. Scoped to that one path so
// the rest of the portal is unaffected. Mirrored in the nginx config (apps/web/Dockerfile).
const smokeIsolation: Plugin = {
  name: "webgpu-smoke-isolation",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if ((req.url ?? "").split("?")[0] === "/webgpu-smoke.html") {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), smokeIsolation],
  // A unique id per build. The portal registers the service worker with it, so
  // each deploy installs a fresh SW (and purges the old cache) automatically.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  optimizeDeps: { exclude: ["@botifyr/ui", "@botifyr/client", "@botifyr/shared"] },
  server: { port: 1421, strictPort: true },
});
