import { beforeEach, expect, test, vi } from "vitest";
import { hasParentPin, setParentPin, unlockParent } from "../src/lib/parent";
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
test("PIN is stored as a salted derivation and supports unlocking", async () => {
  await setParentPin("123456");
  expect(hasParentPin()).toBe(true);
  expect(localStorage.getItem("yoto.parent.v1")).not.toContain("123456");
  await expect(unlockParent("123456")).resolves.toBeUndefined();
});
test("wrong PIN throttles subsequent attempts", async () => {
  await setParentPin("123456");
  await expect(unlockParent("654321")).rejects.toThrow(/Incorrect/);
  await expect(unlockParent("123456")).rejects.toThrow(/wait/);
});
