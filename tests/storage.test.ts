import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import {
  listRecords,
  putRecord,
  recoverDraft,
  saveDraft,
  backup,
  restore,
  clearDatabaseForTests,
} from "../src/lib/storage";
const project = () => ({
  title: "Evie",
  artist: "Family",
  duration: 20,
  source: new File(["audio"], "story.mp3", { type: "audio/mpeg" }),
  tracks: [
    { id: "one", title: "Hello", start: 0, icon: new Uint8Array(256).fill(3) },
  ],
});
beforeEach(clearDatabaseForTests);
test("project saves preserve source audio and icons", async () => {
  await putRecord({
    id: "p1",
    kind: "project",
    title: "Evie",
    updated: 1,
    project: project(),
  });
  const [r] = await listRecords();
  expect(await r.project!.source!.text()).toBe("audio");
  expect(r.project!.tracks[0].icon![0]).toBe(3);
});
test("draft recovery retains previous committed version", async () => {
  await saveDraft(project());
  await saveDraft({ ...project(), title: "Edited" });
  expect((await recoverDraft())?.title).toBe("Edited");
  expect((await recoverDraft(true))?.title).toBe("Evie");
});
test("backup restores as fresh copies without overwriting existing records", async () => {
  const p = project();
  await putRecord({
    id: "original",
    kind: "project",
    title: p.title,
    updated: 1,
    project: p,
  });
  const zip = await backup();
  await restore(zip);
  const rows = await listRecords();
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  expect(await rows[1].project!.source!.text()).toBe("audio");
});
test("corrupt backups leave library untouched", async () => {
  await expect(restore(new Blob(["bad"]))).rejects.toThrow();
  expect(await listRecords()).toEqual([]);
});
test("tampered audio is rejected before any restored records are committed", async () => {
  const { default: JSZip } = await import("jszip");
  await putRecord({
    id: "original",
    kind: "project",
    title: "Evie",
    updated: 1,
    project: project(),
  });
  const good = await backup();
  const zip = await JSZip.loadAsync(await good.arrayBuffer());
  zip.file("media/1", "tampered");
  const bad = new Blob([await zip.generateAsync({ type: "uint8array" })]);
  await expect(restore(bad)).rejects.toThrow(/checksum/);
  expect(await listRecords()).toHaveLength(1);
});
test("playlist restoration remaps references and clears sharing approval", async () => {
  await putRecord({
    id: "audio",
    kind: "music",
    title: "Song",
    updated: 1,
    approved: true,
    file: new File(["song"], "song.mp3"),
  });
  await putRecord({
    id: "list",
    kind: "playlist",
    title: "Bedtime",
    updated: 2,
    approved: true,
    items: ["audio"],
  });
  const zip = await backup();
  await restore(zip);
  const rows = await listRecords();
  const restored = rows.filter((r) => !["audio", "list"].includes(r.id));
  const audio = restored.find((r) => r.kind === "music")!;
  expect(restored.find((r) => r.kind === "playlist")!.items).toEqual([
    audio.id,
  ]);
  expect(restored.every((r) => r.approved === false)).toBe(true);
});
test("repeated archive references share one decoded audio file", async () => {
  const { default: JSZip } = await import("jszip");
  const p = project();
  p.tracks[0].file = p.source;
  const zip = await JSZip.loadAsync(
    await (
      await backup([
        {
          id: "alias",
          kind: "project",
          title: p.title,
          updated: 1,
          project: p,
        },
      ])
    ).arrayBuffer(),
  );
  const m = JSON.parse(await zip.file("manifest.json")!.async("string"));
  m.records[0].project.tracks[0].file = m.records[0].project.source;
  zip.file("manifest.json", JSON.stringify(m));
  await restore(new Blob([await zip.generateAsync({ type: "uint8array" })]));
  const [r] = await listRecords();
  expect(r.project!.source).toBe(r.project!.tracks[0].file);
});

test("binary fallback saves media when a browser cannot store Files", async () => {
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (value instanceof File)
        throw new DOMException("Blob storage unavailable", "UnknownError");
      return original.call(this, value, key);
    });
  try {
    await putRecord({
      id: "fallback",
      kind: "project",
      title: "Evie",
      updated: 1,
      project: project(),
    });
    const [r] = await listRecords();
    expect(r.project!.source).toBeInstanceOf(File);
    expect(await r.project!.source!.text()).toBe("audio");
    await saveDraft(project());
    expect(await (await recoverDraft())!.source!.text()).toBe("audio");
    const zip = await backup();
    await restore(zip);
    expect(await listRecords()).toHaveLength(2);
  } finally {
    spy.mockRestore();
  }
});
test("backup refuses a manifest that its restore cannot accept", async () => {
  await expect(
    backup([
      {
        id: "large",
        kind: "story",
        title: "Long story",
        updated: 1,
        text: "a".repeat(2100000),
      },
    ]),
  ).rejects.toThrow(/large|limit/i);
});
