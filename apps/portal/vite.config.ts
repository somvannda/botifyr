import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // A unique id per build. The portal registers the service worker with it, so
  // each deploy installs a fresh SW (and purges the old cache) automatically.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  optimizeDeps: { exclude: ["@botifyr/ui", "@botifyr/client", "@botifyr/shared"] },
  server: { port: 1421, strictPort: true },
});
