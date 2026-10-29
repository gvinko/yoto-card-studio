// Web NFC (Chrome on Android only). Spec: https://w3c.github.io/web-nfc/
// Limits of the API itself: no chip model / memory size, no raw commands, NDEF only.
// Guard: any tag carrying a Yoto URL is treated as a Yoto card and is never written.

interface NDEFRecordLike {
  recordType: string;
  mediaType?: string;
  id?: string;
  encoding?: string;
  lang?: string;
  data?: DataView;
}
interface NDEFReadingEventLike extends Event {
  serialNumber: string;
  message: { records: NDEFRecordLike[] };
}
type NDEFRecordInitLike = {
  recordType: string;
  data?: string | BufferSource;
  mediaType?: string;
  lang?: string;
};
interface NDEFReaderLike extends EventTarget {
  scan(opts?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: { records: NDEFRecordInitLike[] },
    opts?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
  onreading: ((e: NDEFReadingEventLike) => void) | null;
  onreadingerror: ((e: Event) => void) | null;
}
declare global {
  interface Window {
    NDEFReader?: { new (): NDEFReaderLike };
  }
}

export const nfcSupported = () =>
  typeof window !== "undefined" && "NDEFReader" in window;

export interface ReadRecord {
  type: string;
  mediaType?: string;
  value: string;
  bytes: number;
}

export interface TagInfo {
  serial: string;
  records: ReadRecord[];
  isYoto: boolean;
}

const YOTO_HOSTS = /(^|\.)(yoto\.io|yotoplay\.com|yoto\.space)$/i;

function decodeRecord(r: NDEFRecordLike): ReadRecord {
  const bytes = r.data?.byteLength ?? 0;
  let value = "";
  if (r.data) {
    if (r.recordType === "text")
      value = new TextDecoder(r.encoding || "utf-8").decode(r.data);
    else if (
      r.recordType === "url" ||
      r.recordType === "absolute-url" ||
      r.mediaType?.startsWith("text/")
    )
      value = new TextDecoder().decode(r.data);
    else
      value =
        Array.from(
          new Uint8Array(r.data.buffer, r.data.byteOffset, Math.min(bytes, 48)),
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ") + (bytes > 48 ? " …" : "");
  }
  return { type: r.recordType, mediaType: r.mediaType, value, bytes };
}

function toTagInfo(e: NDEFReadingEventLike): TagInfo {
  const records = e.message.records.map(decodeRecord);
  const isYoto = records.some((r) => {
    try {
      return YOTO_HOSTS.test(new URL(r.value).host);
    } catch {
      return /yoto/i.test(r.value);
    }
  });
  return { serial: e.serialNumber, records, isYoto };
}

function reader(): NDEFReaderLike {
  if (!window.NDEFReader)
    throw new Error("Web NFC needs Chrome on Android (HTTPS).");
  return new window.NDEFReader();
}

/** Waits for one tap and returns UID + decoded records. */
export async function readTag(signal: AbortSignal): Promise<TagInfo> {
  const r = reader();
  await r.scan({ signal });
  return new Promise((resolve, reject) => {
    r.onreading = (e) => {
      r.onreading = null;
      resolve(toTagInfo(e));
    };
    r.onreadingerror = () =>
      reject(
        new Error(
          "Could not read that tag — hold it still, or it may not be NDEF-formatted.",
        ),
      );
    signal.addEventListener(
      "abort",
      () => {
        r.onreading = null;
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

export type WritePayload =
  | { kind: "url"; value: string }
  | { kind: "text"; value: string }
  | { kind: "empty" };

function toRecords(p: WritePayload): NDEFRecordInitLike[] {
  if (p.kind === "empty") return [{ recordType: "empty" }];
  if (p.kind === "url") {
    const u = new URL(p.value); // throws on invalid
    if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links");
    return [{ recordType: "url", data: u.toString() }];
  }
  return [{ recordType: "text", data: p.value, lang: "en" }];
}

/**
 * NDEF size estimate (TLV + record header + payload). Usable user memory:
 * NTAG213 ≈ 144 B, NTAG215 ≈ 496 B, NTAG216 ≈ 872 B. Web NFC can't report which chip you hold,
 * so the write itself is the real test — an oversize write fails without changing the tag.
 */
export function estimateBytes(p: WritePayload): number {
  if (p.kind === "empty") return 6;
  let payload: number;
  if (p.kind === "url") {
    const prefix = /^https:\/\/www\./.test(p.value)
      ? 12
      : /^http:\/\/www\./.test(p.value)
        ? 11
        : /^https:\/\//.test(p.value)
          ? 8
          : /^http:\/\//.test(p.value)
            ? 7
            : 0;
    payload = 1 + new TextEncoder().encode(p.value).length - prefix; // 1 = URI identifier code
  } else payload = 3 + new TextEncoder().encode(p.value).length; // status byte + "en"
  const record = 1 + 1 + (payload < 256 ? 1 : 4) + 1 + payload; // flags, type len, payload len, type, payload
  return 1 + (record < 255 ? 1 : 3) + record + 1; // TLV tag, length, record, terminator
}

export function chipFit(bytes: number): string {
  if (bytes <= 144) return "Fits NTAG213 / 215 / 216";
  if (bytes <= 496) return "Needs NTAG215 or 216";
  if (bytes <= 872) return "Needs NTAG216";
  return "Too large for any NTAG21x";
}

/**
 * Scan-then-write on the same tap: reads the tag first and refuses Yoto cards,
 * then writes while the tag is still in the field.
 */
export async function guardedWrite(
  p: WritePayload,
  signal: AbortSignal,
): Promise<TagInfo> {
  const records = toRecords(p);
  const r = reader();
  await r.scan({ signal });
  return new Promise((resolve, reject) => {
    r.onreading = async (e) => {
      const info = toTagInfo(e);
      r.onreading = null; // one decision per tap; never queue a second write
      if (
        info.isYoto ||
        info.records.some((record) => record.type !== "empty")
      ) {
        reject(
          new Error(
            "Only an empty NDEF tag can be written. Use a blank NTAG215; existing cards are protected.",
          ),
        );
        return;
      }
      try {
        await r.write({ records }, { overwrite: false, signal });
        resolve(info);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    r.onreadingerror = () => {
      r.onreading = null;
      reject(
        new Error(
          "Tag not readable — keep it flat against the back of the phone.",
        ),
      );
    };
    signal.addEventListener(
      "abort",
      () => {
        r.onreading = null;
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}
