import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".zip": "application/zip",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".pdf": "application/pdf"
};

export function createStaticServer(rootDirectory = process.cwd()) {
  const root = resolve(rootDirectory);

  return createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const requestedPath = decodeURIComponent(url.pathname);

    if (/^\/t(?:\/|$)/.test(requestedPath)) {
      const destination = url.pathname.replace(/^\/t(?=\/|$)/, "/teeth").replace(/^\/teeth\/$/, "/teeth");
      response.writeHead(301, { Location: destination + url.search });
      response.end();
      return;
    }

    const isTeethApp = /^\/teeth(?:\/[^/]+)?\/?$/.test(requestedPath);
    if (isTeethApp) {
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Cache-Control", "no-store");
    }
    if (/^\/teeth\/.+/.test(requestedPath) || requestedPath.startsWith("/tools/teeth-chart/")) {
      response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }

    const isDownloadGuide = /^\/download\/(conway|teeth)\/[a-z0-9-]+\/$/.test(requestedPath);
    const relativePath = requestedPath === "/"
      ? "index.html"
      : isTeethApp
        ? "tools/teeth-chart/index.html"
        : isDownloadGuide
        ? "download/index.html"
        : requestedPath.replace(/^\/+/, "");
    let filePath = resolve(join(root, relativePath));

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = resolve(join(filePath, "index.html"));
    }

    const pathFromRoot = relative(root, filePath);

    if (pathFromRoot.startsWith("..") || pathFromRoot === "" || !existsSync(filePath)) {
      const notFoundPath = resolve(join(root, "404.html"));

      if (existsSync(notFoundPath)) {
        const fileSize = statSync(notFoundPath).size;
        response.writeHead(404, {
          "Content-Length": fileSize,
          "Content-Type": mimeTypes[".html"]
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(notFoundPath).pipe(response);
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const fileSize = statSync(filePath).size;
    const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);

    if (range) {
      const requestedStart = range[1] ? Number(range[1]) : 0;
      const requestedEnd = range[2] ? Number(range[2]) : fileSize - 1;
      const start = Math.max(0, requestedStart);
      const end = Math.min(fileSize - 1, requestedEnd);

      if (start > end || start >= fileSize) {
        response.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": end - start + 1,
        "Content-Type": contentType
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath, { start, end }).pipe(response);
      return;
    }

    const isUnlistedAppsArchive = requestedPath === "/apps" || requestedPath === "/apps/";
    const extraHeaders = requestedPath.startsWith("/download/") || isUnlistedAppsArchive
      ? {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet"
        }
      : {};
    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": fileSize,
      "Content-Type": contentType,
      ...extraHeaders
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}
