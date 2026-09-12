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
    : { output: "standalone" }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
