import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** Tiny dependency-free static server for the Botifyr marketing/help site. */
const root = fileURLToPath(new URL(".", import.meta.url));
// The web image copies the shared UI's fonts to `/fonts`; dev mirrors that so
// the site loads the same Inter face it gets in the container.
const fontsRoot = fileURLToPath(new URL("../portal/public/fonts/", import.meta.url));
const port = Number(process.env.PORT ?? 4321);
// The old static /admin.html is retired; send people to the real console.
const adminUrl = process.env.ADMIN_URL ?? "http://localhost:4324";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

createServer(async (request, response) => {
  try {
    let path = decodeURIComponent((request.url ?? "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    if (path === "/help" || path === "/docs") path = "/help.html";
    if (path === "/admin" || path === "/admin.html") {
      response.writeHead(302, { location: adminUrl, "cache-control": "no-store" });
      response.end();
      return;
    }
    if (path === "/skills") path = "/skills.html";
    if (path === "/developers") path = "/developers.html";
    if (path === "/login" || path === "/signin" || path === "/signin.html") path = "/login.html";
    const file = path.startsWith("/fonts/")
      ? join(fontsRoot, normalize(path.slice("/fonts/".length)).replace(/^(\.\.[/\\])+/, ""))
      : join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`Botifyr web on http://localhost:${port}`);
});
