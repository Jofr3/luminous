import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(() => {
  return {
    plugins: [react(), tsconfigPaths()],
    server: {
      port: 5173,
      proxy: {
        "/api": "http://localhost:8788",
        "/images": "http://localhost:8788",
      },
    },
    preview: {
      port: 5173,
    },
  };
});
