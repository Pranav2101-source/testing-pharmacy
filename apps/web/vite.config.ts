import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Point the dev server at a REMOTE API (e.g. a deployed staging/prod box) by
  // setting VITE_PROXY_TARGET in .env.local and VITE_API_URL="/api/v1". The
  // browser then talks same-origin to :3000, so there's no CORS to configure and
  // the httpOnly refresh cookie survives (domain rewritten to the local host).
  // Unset → no proxy, and VITE_API_URL points straight at a local API as usual.
  const proxyTarget = env.VITE_PROXY_TARGET;

  return {
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
      ...(proxyTarget && {
        proxy: {
          "/api": {
            target: proxyTarget,
            changeOrigin: true,
            secure: true,
            cookieDomainRewrite: "localhost",
            // The API's CSRF backstop (CookieOriginValidationFilter) and its CORS
            // list only know the deployed origin, not localhost — present as that.
            configure: (proxy) => {
              proxy.on("proxyReq", (proxyReq) => {
                try {
                  proxyReq.setHeader("origin", proxyTarget);
                  proxyReq.setHeader("referer", proxyTarget + "/");
                } catch {
                  /* header already sent */
                }
              });
            },
          },
        },
      }),
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
  };
});
