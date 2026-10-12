import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
