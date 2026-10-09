import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
    environment: "node",
    // Some suites mutate process.env (e.g. BOTIFYR_DOWNLOADS_DIR) and build a
    // server from it. Run files sequentially so that can't leak across files.
    fileParallelism: false,
  },
});
