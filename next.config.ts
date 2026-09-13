import type { NextConfig } from "next";

// Dual build modes:
//  - default:   dev/standalone server (sandbox preview, self-hosted web)
//  - BUILD_MODE=static: static export to ./out for Capacitor (Android/iOS)
const isStatic = process.env.BUILD_MODE === "static";

const nextConfig: NextConfig = {
  ...(isStatic
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
        distDir: "out",
      }
    : {
        output: "standalone",
        // Dev/self-hosted: proxy /api to the yt-api gateway on :3001 so the
        // app works both through the sandbox gateway (XTransformPort hint)
        // and when accessed directly (localhost:3000). The Android static
        // build never uses this — it talks to YouTube on-device.
        async rewrites() {
          const api = process.env.API_PROXY_TARGET || "http://127.0.0.1:3001";
          return [
            { source: "/api/:path*", destination: `${api}/api/:path*` },
          ];
        },
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
