import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
