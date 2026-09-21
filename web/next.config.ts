import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.17"],
  experimental: {
    // Las páginas precargadas por intención (ficha, reproductor, vuelta) se
    // reutilizan 2 minutos: así la transición y el morfismo arrancan al instante.
    // Sin esta opción caducan en unos 10 s y volver desde el reproductor pasa por
    // el esqueleto. Las páginas normales (dynamic: 0) siguen pidiéndose siempre
    // al servidor, para no mostrar progreso o listas desactualizados.
    staleTimes: { dynamic: 0, static: 120 },
  },
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
