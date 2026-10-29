import { beforeEach, expect, test, vi } from "vitest";
import { completeSignInIfCallback } from "../src/lib/yoto/auth";
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  vi.stubGlobal("location", {
    origin: "https://studio.test",
    pathname: "/",
    search: "?code=untrusted&state=bad",
  });
  vi.stubGlobal("history", { replaceState: vi.fn() });
});
test("OAuth callback rejects unsolicited codes without calling token endpoint", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(completeSignInIfCallback()).rejects.toThrow(
    /state|expired|sign-in/i,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
test("valid PKCE callback exchanges the matching verifier and restores a redirected app", async () => {
  vi.stubGlobal("window", {});
  localStorage.setItem(
    "yoto.state",
    JSON.stringify({ state: "bad", at: Date.now() }),
  );
  localStorage.setItem("yoto.pkce", "verifier");
  localStorage.setItem("yoto.clientId", "public-client");
  const token =
    "header." +
    btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })) +
    ".sig";
  const fetcher = vi.fn(async () =>
    Response.json({ access_token: token, refresh_token: "rotated" }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(completeSignInIfCallback()).resolves.toBe(false);
  expect(fetcher.mock.calls[0][1].body.get("code_verifier")).toBe("verifier");
  expect(localStorage.getItem("yoto.pkce")).toBeNull();
  expect(localStorage.getItem("yoto.state")).toBeNull();
  expect(JSON.parse(localStorage.getItem("yoto.tokens")!).refresh_token).toBe(
    "rotated",
  );
});
test("parallel API calls refresh an expired token only once and retain the rotated token", async () => {
  const { getAccessToken } = await import("../src/lib/yoto/auth");
  localStorage.setItem(
    "yoto.tokens",
    JSON.stringify({
      access_token: "old",
      refresh_token: "old-refresh",
      exp: 0,
    }),
  );
  const token =
    "header." +
    btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })) +
    ".sig";
  const fetcher = vi.fn(async () =>
    Response.json({ access_token: token, refresh_token: "new-refresh" }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]),
  ).toEqual([token, token, token]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem("yoto.tokens")!).refresh_token).toBe(
    "new-refresh",
  );
});
