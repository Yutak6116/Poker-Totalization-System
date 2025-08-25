import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isDocker = !!process.env.DOCKER;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Docker for Mac/Windows のバインドマウントで変更検知を安定化
    watch: { usePolling: isDocker },
    // Vite v5 なら基本これでOK（WSも5173経由）
    hmr: { clientPort: 5173 },
  },
});
