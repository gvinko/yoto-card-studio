import JSZip from "jszip";
import type { Project } from "../types";

export interface LibraryRecord {
  id: string;
  kind: "project" | "music" | "audiobook" | "voice" | "story" | "playlist";
  title: string;
  updated: number;
  project?: Project;
  file?: File;
  text?: string;
  favourite?: boolean;
  approved?: boolean;
  eligible?: boolean;
  items?: string[];
}
const DB = "yoto-family-library-v1";
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records", { keyPath: "id" });
      request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
  }));
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore, result: (v: T) => void) => void,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () =>
      reject(
        tx.error ??
          new Error(
            "Storage failed. Export a backup and check device storage.",
          ),
      );
    action(tx.objectStore(store), (v) => {
      value = v;
    });
  });
}
// Some WebKit builds cannot persist Blob/File values. Probe once, then use binary buffers there.
let bufferStorage: Promise<boolean> | undefined;
async function needsBuffers() {
  return (bufferStorage ??= (async () => {
    try {
      await transaction<void>("drafts", "readwrite", (s) => {
        s.put(new File(["probe"], "probe"), "media-probe");
      });
      const roundTrip = await transaction<unknown>(
        "drafts",
        "readonly",
        (s, result) => {
          s.get("media-probe").onsuccess = (e) =>
            result((e.target as IDBRequest).result);
        },
      );
      await transaction<void>("drafts", "readwrite", (s) => {
        s.delete("media-probe");
      });
      return !(roundTrip instanceof File && roundTrip.name === "probe");
    } catch {
      return true;
    }
  })());
}
async function prepareForStorage<T>(value: T): Promise<T> {
  if (!(await needsBuffers())) return value;
  const files = new WeakMap<File, Promise<unknown>>();
  async function encode(v: unknown): Promise<unknown> {
    if (v instanceof File) {
      let pending = files.get(v);
      if (!pending) {
        pending = v.arrayBuffer().then((bytes) => ({
          $storedFile: true,
          bytes,
          name: v.name,
          type: v.type,
          lastModified: v.lastModified,
        }));
        files.set(v, pending);
      }
      return pending;
    }
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v;
    if (Array.isArray(v)) return Promise.all(v.map(encode));
    if (v && typeof v === "object")
      return Object.fromEntries(
        await Promise.all(
          Object.entries(v).map(async ([k, val]) => [k, await encode(val)]),
        ),
      );
    return v;
  }
  return (await encode(value)) as T;
}
function fromStorage<T>(value: T): T {
  const files = new WeakMap<object, File>();
  function decode(v: unknown): unknown {
    if (
      !v ||
      typeof v !== "object" ||
      v instanceof Blob ||
      v instanceof ArrayBuffer ||
      ArrayBuffer.isView(v)
    )
      return v;
    const o = v as {
      $storedFile?: boolean;
      bytes?: ArrayBuffer;
      name: string;
      type: string;
      lastModified: number;
    };
    if (o.$storedFile && o.bytes instanceof ArrayBuffer) {
      let file = files.get(o);
      if (!file) {
        file = new File([o.bytes], o.name, {
          type: o.type,
          lastModified: o.lastModified,
        });
        files.set(o, file);
      }
      return file;
    }
    if (Array.isArray(v)) return v.map(decode);
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [k, decode(val)]),
    );
  }
  return decode(value) as T;
}
export const listRecords = () =>
  transaction<LibraryRecord[]>("records", "readonly", (s, result) => {
    s.getAll().onsuccess = (e) => result((e.target as IDBRequest).result);
  }).then(fromStorage);
export async function putRecord(r: LibraryRecord) {
  const stored = await prepareForStorage(r);
  return transaction<void>("records", "readwrite", (s) => {
    s.put(stored);
  });
}
export const recoverDraft = (previous = false) =>
  transaction<Project | undefined>("drafts", "readonly", (s, result) => {
    s.get(previous ? "previous" : "current").onsuccess = (e) =>
      result((e.target as IDBRequest).result);
  }).then(fromStorage);
export async function saveDraft(project: Project) {
  const stored = await prepareForStorage(project);
  return transaction<void>("drafts", "readwrite", (s) => {
    s.get("current").onsuccess = (e) => {
      const old = (e.target as IDBRequest).result;
      if (old) s.put(old, "previous");
      s.put(stored, "current");
    };
  });
}
export const clearDatabaseForTests = () => {
  bufferStorage = undefined;
  return transaction<void>("records", "readwrite", (s) => {
    s.clear();
  }).then(() =>
    transaction<void>("drafts", "readwrite", (s) => {
      s.clear();
    }),
  );
};
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
const hash = async (data: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
/** Portable archives contain only family records, never settings, OAuth tokens or service credentials. */
export async function backup(records?: LibraryRecord[]): Promise<Blob> {
  const rows = records ?? (await listRecords());
  if (rows.length > 2000)
    throw new Error(
      "Library exceeds backup limits. Back up individual items instead.",
    );
  for (const r of rows)
    if (r.project && !validProject(r.project))
      throw new Error(
        "Project metadata exceeds backup limits. Split it into smaller projects.",
      );
  const zip = new JSZip();
  let mediaBytes = 0;
  let n = 0;
  async function encode(v: unknown): Promise<unknown> {
    if (v instanceof Blob) {
      mediaBytes += v.size;
      if (v.size > 512 * 1024 ** 2 || mediaBytes > 1024 ** 3 - 8e6 || n >= 2990)
        throw new Error(
          "Audio exceeds backup limits. Back up individual items smaller than 512 MB.",
        );
      const path = `media/${++n}`;
      const data = await v.arrayBuffer();
      zip.file(path, data);
      return {
        $file: path,
        name: v instanceof File ? v.name : "audio",
        type: v.type,
        size: v.size,
        sha256: await hash(data),
      };
    }
    if (v instanceof Uint8Array) return { $icon: Array.from(v) };
    if (Array.isArray(v)) return Promise.all(v.map(encode));
    if (v && typeof v === "object")
      return Object.fromEntries(
        await Promise.all(
          Object.entries(v).map(async ([k, val]) => [k, await encode(val)]),
        ),
      );
    return v;
  }
  const manifest = JSON.stringify({
    format: "yoto-family-backup",
    version: 1,
    records: await encode(rows),
  });
  if (new TextEncoder().encode(manifest).length > 2e6)
    throw new Error(
      "Backup manifest exceeds size limit. Back up individual items.",
    );
  zip.file("manifest.json", manifest);
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
function validProject(p: Project) {
  return (
    p &&
    typeof p.title === "string" &&
    typeof p.artist === "string" &&
    Number.isFinite(p.duration) &&
    p.duration >= 0 &&
    (!p.source || p.source instanceof File) &&
    Array.isArray(p.tracks) &&
    p.tracks.length <= 1000 &&
    new Set(p.tracks.map((t) => t.id)).size === p.tracks.length &&
    p.tracks.every(
      (t) =>
        typeof t.id === "string" &&
        typeof t.title === "string" &&
        Number.isFinite(t.start) &&
        t.start >= 0 &&
        (!t.file || t.file instanceof File) &&
        (!t.icon || (t.icon instanceof Uint8Array && t.icon.length === 256)),
    )
  );
}
export async function restore(blob: Blob): Promise<number> {
  if (blob.size > 1024 ** 3)
    throw new Error("Backup is too large (maximum 1 GB).");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries = Object.values(zip.files);
  // JSZip exposes uncompressed sizes after parsing the central directory; reject bombs before allocating their contents.
  let total = 0;
  for (const entry of entries) {
    const size =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    total += size;
    if (size > 512 * 1024 ** 2 || total > 1024 ** 3 || entries.length > 3000)
      throw new Error("Backup exceeds restore limits.");
  }
  const manifest = zip.file("manifest.json");
  if (
    !manifest ||
    (manifest as unknown as { _data: { uncompressedSize: number } })._data
      .uncompressedSize > 2e6
  )
    throw new Error("Missing or oversized backup manifest.");
  const m = JSON.parse(await manifest.async("string"));
  if (
    m.format !== "yoto-family-backup" ||
    m.version !== 1 ||
    !Array.isArray(m.records) ||
    m.records.length > 2000
  )
    throw new Error("Unsupported backup format.");
  const fileMetadata = new Map<string, string>();
  const decodedFiles = new Map<string, Promise<File>>();
  let references = 0;
  async function decode(v: unknown, depth = 0): Promise<unknown> {
    if (depth > 20) throw new Error("Invalid backup nesting.");
    if (!v || typeof v !== "object") return v;
    const obj = v as Record<string, unknown>;
    if ("$file" in obj) {
      if (
        typeof obj.$file !== "string" ||
        !/^media\/[1-9]\d*$/.test(obj.$file) ||
        typeof obj.name !== "string" ||
        typeof obj.type !== "string"
      )
        throw new Error("Invalid media reference.");
      if (++references > 5000) throw new Error("Too many media references.");
      const descriptor = JSON.stringify([
        obj.name,
        obj.type,
        obj.size,
        obj.sha256,
      ]);
      const key = obj.$file;
      const existing = decodedFiles.get(key);
      if (existing) {
        if (fileMetadata.get(key) !== descriptor)
          throw new Error("Conflicting media reference.");
        return existing;
      }
      const pending = (async () => {
        const f = zip.file(key);
        if (!f) throw new Error("Backup media is missing.");
        const data = await f.async("arraybuffer");
        if (data.byteLength !== obj.size || (await hash(data)) !== obj.sha256)
          throw new Error("Backup media checksum failed.");
        return new File([data], obj.name as string, {
          type: obj.type as string,
        });
      })();
      decodedFiles.set(key, pending);
      fileMetadata.set(key, descriptor);
      return pending;
    }
    if ("$icon" in obj) {
      if (
        !Array.isArray(obj.$icon) ||
        obj.$icon.length !== 256 ||
        obj.$icon.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
      )
        throw new Error("Invalid icon.");
      return Uint8Array.from(obj.$icon);
    }
    if (Array.isArray(v)) {
      const out = [];
      for (const x of v) out.push(await decode(x, depth + 1));
      return out;
    }
    if (
      Object.keys(obj).some((k) =>
        ["__proto__", "constructor", "prototype"].includes(k),
      )
    )
      throw new Error("Invalid backup key.");
    return Object.fromEntries(
      await Promise.all(
        Object.entries(obj).map(async ([k, val]) => [
          k,
          await decode(val, depth + 1),
        ]),
      ),
    );
  }
  const rows = (await decode(m.records)) as LibraryRecord[];
  const ids = new Map<string, string>();
  for (const r of rows) {
    if (
      !r ||
      typeof r.id !== "string" ||
      ids.has(r.id) ||
      !["project", "music", "audiobook", "voice", "story", "playlist"].includes(
        r.kind,
      ) ||
      typeof r.title !== "string" ||
      !Number.isFinite(r.updated) ||
      (r.project && !validProject(r.project)) ||
      (r.file && !(r.file instanceof File)) ||
      (r.text !== undefined && typeof r.text !== "string") ||
      (r.items &&
        (!Array.isArray(r.items) || r.items.some((x) => typeof x !== "string")))
    )
      throw new Error("Invalid library record.");
    ids.set(r.id, crypto.randomUUID());
  }
  // Validate the entire archive before starting one atomic write; restored records always get fresh IDs.
  const storedRows = await prepareForStorage(rows);
  await transaction<void>("records", "readwrite", (s) => {
    for (const r of storedRows)
      s.add({
        ...r,
        id: ids.get(r.id)!,
        updated: Date.now(),
        approved: false,
        items: r.items
          ?.map((id) => ids.get(id))
          .filter((id): id is string => !!id),
      });
  });
  return rows.length;
}
