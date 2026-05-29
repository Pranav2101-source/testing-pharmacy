import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pharmacy/types", "@pharmacy/utils"],
  images: {
    remotePatterns: [{ hostname: "*.r2.dev" }],
  },
  webpack(config) {
    // TypeScript workspace packages use .js extensions in ESM re-exports.
    // Teach webpack to fall back to .ts/.tsx when it can't find a .js file.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
