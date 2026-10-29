// A device-local child navigation lock, not an account or a defence against developer tools.
const KEY = "yoto.parent.v1";
const WAIT = "yoto.parent.wait";
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
async function derive(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return base64(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: salt as BufferSource,
          iterations: 210000,
          hash: "SHA-256",
        },
        key,
        256,
      ),
    ),
  );
}
export const hasParentPin = () => !!localStorage.getItem(KEY);
export async function setParentPin(pin: string) {
  if (!/^\d{6,12}$/.test(pin))
    throw new Error("Choose a PIN with 6 to 12 digits.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(
    KEY,
    JSON.stringify({ salt: base64(salt), hash: await derive(pin, salt) }),
  );
}
export async function unlockParent(pin: string) {
  const wait = Number(localStorage.getItem(WAIT) ?? 0);
  if (Date.now() < wait)
    throw new Error("Please wait 30 seconds before trying again.");
  const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  if (!saved) throw new Error("Set up a parent PIN first.");
  const ok = (await derive(pin, bytes(saved.salt))) === saved.hash;
  if (!ok) {
    localStorage.setItem(WAIT, String(Date.now() + 30000));
    throw new Error("Incorrect parent PIN.");
  }
  localStorage.removeItem(WAIT);
}
