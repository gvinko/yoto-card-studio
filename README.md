# Yoto Card Studio

Personal PWA for prepping audio for Yoto **Make Your Own** cards: import → chapter → 16×16 icons → export or upload to Yoto via the official API. Runs on the laptop and on Android Chrome. No backend, no cost.

```
src/
  App.tsx                      shell + tabs (bottom nav on phone, sidebar on desktop)
  types.ts                     Project / Track / Output + Yoto MYO limits
  components/
    IngestPanel.tsx            drag-drop / file picker + "From a link" ripper UI
    ChapterStudio.tsx          WaveSurfer waveform, markers, silence detect, chapter list
    IconEditor.tsx             16×16 pixel editor, PNG import/export, per-track icons
    ExportPanel.tsx            build tracks (ffmpeg.wasm), ZIP, send to Yoto
    NfcPanel.tsx               Web NFC read / guarded write / wipe
    SettingsPanel.tsx          Yoto client ID, helper URL + token
  lib/
    audio/ffmpeg.ts            ffmpeg.wasm: probe, chapters, silence, peaks, split/encode (WORKERFS, no copies)
    yoto/auth.ts               PKCE sign-in (popup), token refresh
    yoto/api.ts                audio upload → transcode poll → icon upload → create/replace playlist
    nfc/webnfc.ts              NDEFReader wrapper, Yoto-card guard, size estimate
    helper.ts                  client for the laptop rip helper
    icons.ts                   16-colour palette, quantise, flood fill, PNG encode
    time.ts                    timecodes, segment maths, filenames
helper/server.mjs              yt-dlp/ffmpeg wrapper, zero dependencies
public/                        manifest, service worker (caches the 30 MB ffmpeg core after first use)
```

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (and your LAN IP)
npm run build        # → dist/
```

Host `dist/` anywhere static with HTTPS — Cloudflare Pages free tier: build command `npm run build`, output `dist`. Unlisted URL, nothing public about it. HTTPS is required for Web NFC, the service worker and Yoto sign-in.

## Yoto API (one-time, free)

1. Sign in at https://dashboard.yoto.dev → create an app (public / browser client).
2. Allowed callback URL = the exact URL shown in **Settings** (e.g. `https://yoto-card-studio.pages.dev/`). Add `http://localhost:5173/` too for dev.
3. Paste the client ID into **Settings**. Scopes requested: `user:content:manage user:icons:manage offline_access`.
4. Export → *Send to Yoto* uploads each track, waits for Yoto's transcode, uploads icons, and creates a new playlist (or replaces an existing one). Then link a blank MYO card to it in the Yoto app.

MYO limits enforced in the UI: 100 tracks, 60 min / 100 MB per track, 5 h / 500 MB per card.

## Link ripper (yt-dlp helper)

Browsers can't run yt-dlp, so a tiny helper runs on the laptop. Install the two binaries once:

| OS | Command |
|---|---|
| Windows | `winget install yt-dlp.yt-dlp Gyan.FFmpeg` |
| macOS | `brew install yt-dlp ffmpeg` |
| Linux | `pipx install yt-dlp` and `sudo apt install ffmpeg` |

Keep yt-dlp current — sites break it often: `yt-dlp -U` (or `winget upgrade yt-dlp.yt-dlp` / `brew upgrade yt-dlp`).

```bash
npm run helper       # prints the token; http://localhost:8787
```

Not on PATH? `YTDLP=C:\tools\yt-dlp.exe FFMPEG=C:\tools\ffmpeg.exe npm run helper`.

- **On the laptop:** Settings → helper URL `http://localhost:8787` + token.
- **From the phone:** the app is HTTPS, so it can't call `http://192.168…`. Use a free Cloudflare quick tunnel:
  `cloudflared tunnel --url http://localhost:8787` (install: `winget install Cloudflare.cloudflared` / `brew install cloudflared`), paste the printed `https://….trycloudflare.com` URL + token into Settings on the phone. URL changes each run.

Rips are async jobs (poll + download), so long audiobooks don't hit tunnel timeouts. YouTube chapters are embedded into the MP3 and show up as markers automatically. Files are deleted from the laptop an hour after the job finishes. Only rip things you have the rights to use.

## How the audio side works

- **Single file** (MP3/M4B/…) → embedded chapters become markers; otherwise one marker at 0:00. Add markers at the playhead (`M`), drag them, type exact timecodes, detect silence, or split into ≤60 min parts.
- **Several files** (CD rip folder, MP3 set) → one track each, reorder/rename in Export.
- **Long files (>25 min)** get their waveform from an ffmpeg peak pass (10 points/s) instead of browser decoding, which would need >10 GB for a 10-hour book.
- **Fast mode** cuts MP3→MP3 and AAC/M4B→M4A without re-encoding (seconds even on a phone). Other formats, or Fast off, encode to MP3 128/192 kbps (wasm is single-threaded: expect ~10–30× realtime on a laptop, a few × on a phone).
- Output: `01 - Title.mp3` with ID3 title/artist/album/track; ZIP adds `icons/NN.png` and `playlist.json`.

## NFC

Web NFC = Chrome on Android only (not desktop, not USB readers). It can read UID + NDEF records, write a link/text, or wipe a tag. It **cannot** tell NTAG213 from 215/216 — the panel estimates the byte size and the write fails harmlessly if it doesn't fit. Any tag holding a Yoto URL is refused for writes; Yoto cards are linked via the Yoto app, never written here.

## Deliberately not built

- **CD ripping:** browsers can't read optical drives. Rip with any free ripper (e.g. fre:ac) and drop the folder in.
- **Electron / PC/SC (ACR122U):** everything above works without it; would add a native toolchain for little gain.
