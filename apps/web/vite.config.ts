import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@pharmacy/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
      "@pharmacy/utils": path.resolve(__dirname, "../../packages/utils/src/index.ts"),
    },
  },
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "motion":       ["framer-motion"],
          "ui":           ["lucide-react", "clsx", "tailwind-merge"],
          "forms":        ["react-hook-form", "@hookform/resolvers", "zod"],
          "query":        ["@tanstack/react-query", "axios"],
        },
      },
    },
  },
});
