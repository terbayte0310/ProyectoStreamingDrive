import type { NextRequest } from "next/server";

type RequestOriginSource = {
  headers: Pick<NextRequest["headers"], "get">;
  nextUrl: Pick<NextRequest["nextUrl"], "hostname" | "origin" | "port">;
};

function isPrivateDevelopmentHost(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function developmentRequestOrigin(host: string | null, expectedPort: string) {
  if (!host) return null;
  try {
    const candidate = new URL(`http://${host}`);
    if (
      candidate.pathname !== "/"
      || candidate.search
      || candidate.hash
      || candidate.username
      || candidate.password
      || candidate.port !== expectedPort
      || !isPrivateDevelopmentHost(candidate.hostname)
    ) {
      return null;
    }
    return candidate.origin;
  } catch {
    return null;
  }
}

/**
 * Next binds its local development server to 0.0.0.0 for LAN testing. In that
 * mode, request.nextUrl can retain the bind address instead of the browser's
 * Host header. Only replace that unusable origin with a verified local host.
 */
export function getRequestOrigin(
  request: RequestOriginSource,
  environment = process.env.NODE_ENV,
) {
  const fallback = request.nextUrl.origin;
  const isAllInterfacesBind = request.nextUrl.hostname === "0.0.0.0";
  const isLocalDevelopmentOrigin = environment === "development"
    && isPrivateDevelopmentHost(request.nextUrl.hostname);
  if (
    !isAllInterfacesBind
    && !isLocalDevelopmentOrigin
  ) return fallback;

  return developmentRequestOrigin(request.headers.get("host"), request.nextUrl.port) ?? fallback;
}
