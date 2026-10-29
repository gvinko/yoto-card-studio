import { expect, test, vi } from "vitest";
import { guardedWrite } from "../src/lib/nfc/webnfc";
import { savePlaylist } from "../src/lib/yoto/api";
test("NFC never overwrites a nonempty tag, including unrecognised protected data", async () => {
  let reader: any;
  class Reader {
    onreading: any;
    onreadingerror: any;
    write = vi.fn();
    scan = vi.fn(async () => {});
    constructor() {
      reader = this;
    }
  }
  vi.stubGlobal("window", { NDEFReader: Reader });
  const pending = guardedWrite(
    { kind: "text", value: "Hello" },
    new AbortController().signal,
  );
  await Promise.resolve();
  reader.onreading({
    serialNumber: "one",
    message: {
      records: [
        {
          recordType: "mime",
          mediaType: "application/octet-stream",
          data: new DataView(new Uint8Array([1, 2]).buffer),
        },
      ],
    },
  });
  await expect(pending).rejects.toThrow(/blank|empty/i);
  expect(reader.write).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
test("Yoto refuses replacement card IDs before requesting authentication", async () => {
  await expect(savePlaylist("Family", [], "protected-card")).rejects.toThrow(
    /new|replace|protected/i,
  );
});
test("Yoto rejects oversize and overlong transcoded tracks before saving", async () => {
  const audio = {
    transcodedSha256: "hash",
    transcodedInfo: { duration: 3601, fileSize: 1000 },
  };
  await expect(
    savePlaylist("Family", [{ title: "Long", audio }]),
  ).rejects.toThrow(/limit|duration|long/i);
});
test("NFC read failure disarms subsequent writes", async () => {
  let reader: any;
  class Reader {
    onreading: any;
    onreadingerror: any;
    write = vi.fn();
    scan = vi.fn(async () => {});
    constructor() {
      reader = this;
    }
  }
  vi.stubGlobal("window", { NDEFReader: Reader });
  const pending = guardedWrite(
    { kind: "text", value: "Hello" },
    new AbortController().signal,
  );
  await Promise.resolve();
  reader.onreadingerror({});
  await expect(pending).rejects.toThrow();
  expect(reader.onreading).toBeNull();
  vi.unstubAllGlobals();
});
