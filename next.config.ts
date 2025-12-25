import type { NextConfig } from "next";

/**
 * For Electron packaging we run Next.js as a local server.
 * `output: "standalone"` generates a self-contained server bundle in `.next/standalone`.
 */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
