import type { NextConfig } from "next";
import path from "path";
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  // Single yjs copy: duplicate instances break CRDT constructor checks.
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      yjs: path.resolve(__dirname, "node_modules/yjs"),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      yjs: "./node_modules/yjs",
    },
  },
};
export default nextConfig;
