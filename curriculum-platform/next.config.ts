import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next's default optimizePackageImports rewrites lucide-react to
  // dist/esm/icons/*.mjs paths that do not exist in current package builds
  // (files are *.js). Disable to keep barrel imports working.
  experimental: {
    optimizePackageImports: [],
  },
};

export default nextConfig;
