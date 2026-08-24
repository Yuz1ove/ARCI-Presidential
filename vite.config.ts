import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/dashboard",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        opening: resolve(import.meta.dirname, "index.html"),
        dashboard: resolve(import.meta.dirname, "dashboard.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
  },
});
