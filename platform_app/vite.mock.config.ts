import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Explicit local mock entry point: do not load provider or frontend .env files.
export default defineConfig({
  envDir: false,
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(""),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8015", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8015", changeOrigin: true },
    },
  },
});
