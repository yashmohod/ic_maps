import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // reactStrictMode: false,
  basePath: "/ic_maps",
  skipTrailingSlashRedirect: true,
  output: "standalone",
  // next/image optimizer does not resolve basePath in the url= param; serve public files directly
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: "/ic_maps",
  },
};

export default nextConfig;
