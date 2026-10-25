import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Published sites call /_api/* (proxied by Caddy); map it onto the API routes.
  async rewrites() {
    return [{ source: "/_api/:path*", destination: "/api/:path*" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
