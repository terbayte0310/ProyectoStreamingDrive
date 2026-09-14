import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.17"],
  images: {
    remotePatterns: [{ hostname: "image.tmdb.org", pathname: "/t/p/**", protocol: "https" }],
  },
};

export default nextConfig;
