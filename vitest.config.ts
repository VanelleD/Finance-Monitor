import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Kept separate from vite.config.ts, whose `root` points at the client bundle.
export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
