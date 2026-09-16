import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.17"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/catalog/cursos",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [{ hostname: "image.tmdb.org", pathname: "/t/p/**", protocol: "https" }],
  },
};

export default nextConfig;
