import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/dashboard",
    emptyOutDir: false,
  },
  server: {
    host: "127.0.0.1",
  },
});
