import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@botifyr/ui", "@botifyr/client", "@botifyr/shared"] },
  server: { port: 1422, strictPort: true },
});
