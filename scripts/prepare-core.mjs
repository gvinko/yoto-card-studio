import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public/ffmpeg", { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
  await copyFile(
    "node_modules/@ffmpeg/core/dist/esm/" + file,
    "public/ffmpeg/" + file,
  );
