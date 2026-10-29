import { afterEach, expect, test, vi } from "vitest";
import { createGateway } from "../server/gateway.mjs";
const servers: any[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  servers.length = 0;
});
async function start(env: Record<string, string> = {}, upstream = vi.fn()) {
  const server = createGateway({
    env: {
      PARENT_PASSWORD: "a-long-private-parent-password",
      STUDIO_ORIGIN: "http://localhost",
      ...env,
    },
    upstream,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, upstream };
}
async function login(base: string) {
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ password: "a-long-private-parent-password" }),
  });
  return r.headers.get("set-cookie")!.split(";")[0];
}
test("provider endpoints require a server session, even if client PIN is bypassed", async () => {
  const { base, upstream } = await start();
  expect((await fetch(base + "/api/abs/libraries")).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});
test("cross-origin login cannot create a session", async () => {
  const { base } = await start();
  expect(
    (
      await fetch(base + "/api/login", {
        method: "POST",
        headers: {
          Origin: "https://evil.test",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
});
test("ABS responses expose metadata but never the server token", async () => {
  const upstream = vi.fn(async () =>
    Response.json({
      libraries: [{ id: "lib1", name: "Books", token: "secret" }],
    }),
  );
  const { base } = await start(
    { ABS_URL: "https://abs.test", ABS_TOKEN: "server-only-secret" },
    upstream,
  );
  const cookie = await login(base);
  const r = await fetch(base + "/api/abs/libraries", {
    headers: { Cookie: cookie },
  });
  expect(await r.json()).toEqual([{ id: "lib1", name: "Books" }]);
  expect(upstream.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer server-only-secret",
  );
});
test("HA controls reject entities outside explicit allowlist", async () => {
  const { base, upstream } = await start({
    HA_URL: "https://ha.test",
    HA_TOKEN: "secret",
    HA_PLAYERS: "media_player.family",
  });
  const cookie = await login(base);
  const r = await fetch(base + "/api/ha/control", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://localhost",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity: "lock.front_door", service: "turn_on" }),
  });
  expect(r.status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
