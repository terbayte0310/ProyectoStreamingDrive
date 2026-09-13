import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);

function argument(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const mediaDirectory = argument("--media-dir");
const host = argument("--host", "127.0.0.1");
const port = Number(argument("--port", "8080"));

if (!mediaDirectory || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Uso: node scripts/serve_media_pilot.mjs --media-dir RUTA [--host 127.0.0.1] [--port 8080]");
  process.exit(1);
}

const files = {
  "/m1.mp4": { file: "MR0001.es.mp4", type: "video/mp4" },
  "/m2.mp4": { file: "PP0001.es.mp4", type: "video/mp4" },
  "/m3.mp4": { file: "SS0001.S01E04.es.mp4", type: "video/mp4" },
  "/m3.es.vtt": { file: "SS0001.S01E04.es.vtt", type: "text/vtt; charset=utf-8" },
};

function page() {
  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Piloto multimedia</title>
<style>
  body { background: #101217; color: #f5f7fa; font: 18px system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 24px; }
  h1 { margin-top: 0; } section { margin: 32px 0; } video { background: #000; display: block; max-width: 100%; width: 100%; }
  p { color: #c7cbd3; } code { color: #a9d8ff; }
</style>
<h1>Piloto multimedia</h1>
<p>Prueba iniciar, saltar al 10 %, 50 % y 90 %, y terminar cada muestra. M3 debe mostrar subtítulos en español.</p>
<section><h2>M1 · H.264/AAC ya compatible</h2><video controls preload="metadata" src="/m1.mp4"></video></section>
<section><h2>M2 · audio convertido a AAC</h2><video controls preload="metadata" src="/m2.mp4"></video></section>
<section><h2>M3 · episodio + WebVTT</h2><video controls preload="metadata" src="/m3.mp4"><track kind="subtitles" src="/m3.es.vtt" srclang="es" label="Español" default></video></section>
</html>`;
}

function writeError(response, status) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(status === 404 ? "No encontrado" : "Rango no válido");
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return "invalid";
  const start = match[1] === "" ? undefined : Number(match[1]);
  const end = match[2] === "" ? undefined : Number(match[2]);
  if ((!Number.isInteger(start) && start !== undefined) || (!Number.isInteger(end) && end !== undefined)) return "invalid";
  if (start === undefined && end === undefined) return "invalid";
  if (start === undefined) {
    const length = Math.min(end, size);
    return { start: size - length, end: size - 1 };
  }
  if (start >= size || (end !== undefined && end < start)) return "invalid";
  return { start, end: Math.min(end ?? size - 1, size - 1) };
}

const root = resolve(mediaDirectory);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(page());
    return;
  }

  const asset = files[url.pathname];
  if (!asset) return writeError(response, 404);
  const filePath = resolve(root, asset.file);
  if (basename(filePath) !== asset.file || !existsSync(filePath)) return writeError(response, 404);

  const size = statSync(filePath).size;
  const range = parseRange(request.headers.range, size);
  if (range === "invalid") {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }

  const headers = { "Content-Type": asset.type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (!range) {
    response.writeHead(200, { ...headers, "Content-Length": size });
    if (request.method === "HEAD") return response.end();
    createReadStream(filePath).pipe(response);
    return;
  }

  const length = range.end - range.start + 1;
  response.writeHead(206, { ...headers, "Content-Length": length, "Content-Range": `bytes ${range.start}-${range.end}/${size}` });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath, range).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Piloto listo en http://${host}:${port}/`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
