import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostinger cannot run Next's native build tools, so deployments are built elsewhere as a self-contained server.
  output: process.env.HIMS_STANDALONE === "1" ? "standalone" : undefined,
  /* config options here */
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
