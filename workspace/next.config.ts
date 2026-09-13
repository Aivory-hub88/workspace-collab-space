import type { NextConfig } from "next";
import path from "path";
const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/dashboard",
  assetPrefix: "/dashboard",
  reactStrictMode: false,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  // Dedup yjs — MissionControl + AgentRail both import * as Y from "yjs" + y-websocket bundles its own copy.
  // Duplicate copies break Yjs constructor checks ("Yjs was already imported").
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
  experimental: {
    // Default staleTime for dynamic routes is 0s, so every re-intersection of a
    // sidebar <Link> (layout shifts, font loads, badge updates — all common in
    // the first seconds of a fresh load) fires a brand-new RSC prefetch fetch
    // instead of reusing one. Measured live: 10 sidebar routes were each
    // refetched 4-5x (43 duplicate requests) within 4s of landing on the
    // dashboard. Caching prefetches for a short window reuses the same fetch.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};
export default nextConfig;
