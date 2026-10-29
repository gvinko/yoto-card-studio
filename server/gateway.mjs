// Optional same-origin personal gateway. No services are installed or started by the frontend.
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
const digest = (value) => createHash("sha256").update(String(value)).digest();
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function createGateway({
  env = process.env,
  upstream = fetch,
  root = resolve("dist"),
} = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const origin = env.STUDIO_ORIGIN ?? "http://127.0.0.1:8788";
  const secure = new URL(origin).protocol === "https:";
  if (
    !secure &&
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)
  )
    throw new Error("Remote gateway access requires an HTTPS origin.");
  const players = (env.HA_PLAYERS ?? "")
    .split(",")
    .filter((x) => /^media_player\.[a-z0-9_]+$/.test(x));
  async function provider(name, path, body) {
    const base = env[`${name}_URL`];
    const token = env[`${name}_TOKEN`];
    if (!base || !token)
      throw Object.assign(
        new Error(`${name} is not configured on the server.`),
        { status: 503 },
      );
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid server provider URL.");
    // Only fixed paths built by this server are accepted. Credentials never follow redirects.
    const response = await upstream(base.replace(/\/$/, "") + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(`${name} request failed (${response.status}).`),
        { status: 502 },
      );
    return response.json();
  }
  function send(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(JSON.stringify(body));
  }
  async function json(req) {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16384)
        throw Object.assign(new Error("Request too large."), { status: 413 });
    }
    try {
      return JSON.parse(body || "{}");
    } catch {
      throw Object.assign(new Error("Invalid JSON."), { status: 400 });
    }
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      const path = url.pathname;
      if (path.startsWith("/api/")) {
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET" && req.headers.origin !== origin)
          return send(res, 403, { error: "Request origin is not allowed." });
        const now = Date.now();
        for (const [key, expiry] of sessions)
          if (expiry < now) sessions.delete(key);
        const cookie = String(req.headers.cookie ?? "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("studio_session="))
          ?.slice(15);
        const authenticated = !!cookie && sessions.has(cookie);
        if (path === "/api/status" && req.method === "GET")
          return send(res, 200, {
            available: true,
            authenticated,
            ...(authenticated
              ? {
                  audiobookshelf: !!env.ABS_URL && !!env.ABS_TOKEN,
                  homeAssistant: !!env.HA_URL && !!env.HA_TOKEN,
                }
              : {}),
          });
        if (path === "/api/login" && req.method === "POST") {
          if (!env.PARENT_PASSWORD || env.PARENT_PASSWORD.length < 20)
            return send(res, 503, {
              error: "Set a server parent password of at least 20 characters.",
            });
          const address = req.socket.remoteAddress;
          const recent = attempts.get(address) ?? [];
          const active = recent.filter((at) => now - at < 60000);
          if (active.length >= 5)
            return send(res, 429, {
              error: "Too many attempts. Wait one minute.",
            });
          active.push(now);
          attempts.set(address, active);
          if (attempts.size > 1000)
            attempts.delete(attempts.keys().next().value);
          const body = await json(req);
          if (
            !timingSafeEqual(digest(body.password), digest(env.PARENT_PASSWORD))
          )
            return send(res, 401, { error: "Incorrect server password." });
          if (sessions.size >= 100)
            sessions.delete(sessions.keys().next().value);
          const token = randomBytes(32).toString("base64url");
          sessions.set(token, now + 30 * 60000);
          res.setHeader(
            "Set-Cookie",
            `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800${secure ? "; Secure" : ""}`,
          );
          return send(res, 200, { ok: true });
        }
        if (!authenticated)
          return send(res, 401, {
            error: "Unlock the server connection first.",
          });
        if (path === "/api/logout" && req.method === "POST") {
          sessions.delete(cookie);
          res.setHeader(
            "Set-Cookie",
            "studio_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0",
          );
          return send(res, 200, { ok: true });
        }
        if (path === "/api/abs/libraries" && req.method === "GET") {
          const data = await provider("ABS", "/api/libraries");
          return send(
            res,
            200,
            (data.libraries ?? [])
              .filter((r) => id(r.id))
              .map((r) => ({ id: r.id, name: String(r.name) })),
          );
        }
        const books =
          /^\/api\/abs\/libraries\/([a-zA-Z0-9_-]{1,100})\/items$/.exec(path);
        if (books && req.method === "GET") {
          const page = Math.max(
            0,
            Math.min(10000, Number(url.searchParams.get("page")) || 0),
          );
          const data = await provider(
            "ABS",
            `/api/libraries/${books[1]}/items?limit=50&page=${page}&sort=media.metadata.title`,
          );
          return send(res, 200, {
            total: data.total ?? 0,
            items: (data.results ?? [])
              .filter((r) => id(r.id))
              .map((r) => ({
                id: r.id,
                title: String(r.media?.metadata?.title ?? "Untitled"),
                author: String(r.media?.metadata?.authorName ?? ""),
                url: env.ABS_URL.replace(/\/$/, "") + "/item/" + r.id,
              })),
          });
        }
        if (path === "/api/ha/players" && req.method === "GET") {
          const data = await provider("HA", "/api/states");
          return send(
            res,
            200,
            data
              .filter((r) => players.includes(r.entity_id))
              .map((r) => ({
                id: r.entity_id,
                name: String(r.attributes?.friendly_name ?? r.entity_id),
                state: String(r.state),
              })),
          );
        }
        if (path === "/api/ha/control" && req.method === "POST") {
          const body = await json(req);
          if (
            !players.includes(body.entity) ||
            ![
              "media_play",
              "media_pause",
              "media_stop",
              "media_next_track",
              "media_previous_track",
              "volume_set",
              "play_media",
            ].includes(body.service)
          )
            return send(res, 400, {
              error: "Player or action is not allowed.",
            });
          const payload = { entity_id: body.entity };
          if (body.service === "volume_set") {
            if (
              typeof body.volume !== "number" ||
              body.volume < 0 ||
              body.volume > 0.5
            )
              return send(res, 400, {
                error: "Volume must be between 0 and 0.5.",
              });
            payload.volume_level = body.volume;
          }
          if (body.service === "play_media") {
            // Cast receivers must resolve media themselves. Never send browser blob URLs, provider tokens or arbitrary URLs.
            if (
              typeof body.media !== "string" ||
              !/^media-source:\/\/media_source\/local\/[a-zA-Z0-9_./ -]+$/.test(
                body.media,
              ) ||
              body.media.includes("..")
            )
              return send(res, 400, {
                error: "Choose a Home Assistant local media-source URI.",
              });
            payload.media_content_id = body.media;
            payload.media_content_type = "music";
          }
          await provider(
            "HA",
            `/api/services/media_player/${body.service}`,
            payload,
          );
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: "Unknown API endpoint." });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, { error: "Method not allowed." });
      let relative = decodeURIComponent(path).replace(/^\/+/, "");
      if (!relative || !extname(relative)) relative = "index.html";
      const file = resolve(root, relative);
      if (!file.startsWith(root + "/"))
        return send(res, 404, { error: "Not found." });
      try {
        if (!(await stat(file)).isFile()) throw new Error();
        const body = await readFile(file);
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".webmanifest": "application/manifest+json",
              ".wasm": "application/wasm",
            }[extname(file)] ?? "application/octet-stream",
          "Cache-Control":
            extname(file) === ".html" || relative === "sw.js"
              ? "no-cache"
              : "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        return send(res, 404, { error: "Build the application first." });
      }
    } catch (error) {
      send(res, error.status ?? 500, {
        error: error.status
          ? error.message
          : "Connection failed. Check the server configuration and provider availability.",
      });
    }
  });
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const port = Number(process.env.PORT ?? 8788);
  createGateway().listen(port, process.env.HOST ?? "127.0.0.1", () =>
    console.log(
      `Studio gateway listening on port ${port}. Credentials are read from server environment only.`,
    ),
  );
}
