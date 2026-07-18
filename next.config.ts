import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Label photos from phones routinely exceed the 1 MB default for Server
  // Actions / route handler bodies.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
