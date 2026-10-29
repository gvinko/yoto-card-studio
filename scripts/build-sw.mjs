import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("dist/ffmpeg", { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
  await copyFile(
    "node_modules/@ffmpeg/core/dist/esm/" + file,
    "dist/ffmpeg/" + file,
  );
const assets = (await readdir("dist/assets")).map((f) => "/assets/" + f);
const files = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  ...assets,
];
const version = createHash("sha256")
  .update(files.join("\n"))
  .update(await readFile("dist/index.html"))
  .digest("hex")
  .slice(0, 16);
await writeFile(
  "dist/sw.js",
  (await readFile("public/sw.js", "utf8"))
    .replace("__VERSION__", version)
    .replace(/\/\*__FILES__\*\/\s*\[\]/, JSON.stringify(files)),
);
