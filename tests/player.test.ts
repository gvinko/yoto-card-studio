import { expect, test } from "vitest";
import { playerCommand } from "../src/lib/yoto/player";
test("player command uses supported topics and caps child listening volume", () => {
  expect(playerCommand("volume", 30)).toEqual({
    topic: "volume/set",
    payload: { volume: 30 },
  });
  expect(playerCommand("pause")).toEqual({ topic: "card/pause", payload: {} });
  expect(() => playerCommand("volume", 90)).toThrow();
});
test("card playback accepts only a selected family library identifier", () => {
  expect(playerCommand("play", "family_card")).toEqual({
    topic: "card/start",
    payload: { uri: "https://yoto.io/family_card" },
  });
  expect(() => playerCommand("play", "https://evil.test")).toThrow();
});
