# Yoto Card Studio — Evie's family library

React 19 / TypeScript / Vite audio library and Make Your Own card studio. Free and open source dependencies; no new paid subscription required.

- A child listening room shows only parent-approved songs, audiobooks, family recordings, original stories and playlists, with favourites and listening activities.
- A parent PIN unlocks imports, playlists, sharing, original story writing, microphone recordings, chapter editing, pixel icons, export, NFC and settings. The PIN protects normal navigation on one browser, not access through developer tools or an account boundary.
- Projects automatically recover from IndexedDB. Named snapshots keep original media and icons. Library ZIP backups use checksummed media and restore atomically as new, parent-only copies.
- FFmpeg.wasm is served from this app, loaded on demand and cached after first use. MP3/AAC stream copy and MP3 conversion remain available. WaveSurfer chapter editing and silence detection remain in the studio.
- Yoto uses official public-client PKCE authentication and optional official MQTT player controls. Export creates new playlists only; it cannot replace existing cards. Linking to an eligible MYO card happens in the official Yoto app.
- Android Chrome NFC reads tags and writes only empty NDEF tags with overwrite disabled. All nonempty tags are protected; wiping has been removed. NFC is unavailable on iPhone and desktop browsers.
- Optional Audiobookshelf browsing and Home Assistant / Cast controls use a server gateway with server-held provider tokens. See [integration setup](docs/INTEGRATIONS.md). LibriVox catalogue and YouTube Music open official playback/discovery channels. URL ripping has been retired.

## Run

Use Node 22 or newer.

```sh
npm ci
npm run dev
```

For complete media handling use a production build (the build copies the pinned FFmpeg core into the output):

```sh
npm run build
npm run preview
```

Development mode prepares the same pinned engine automatically. Generated core files are excluded from Git.

```sh
npm test
npx playwright install --with-deps chromium webkit
npm run test:browser
```

Browser tests exercise desktop Chromium, an Android viewport, and iPhone-shaped WebKit. These are emulations, not physical-device certification. The optional integration gateway is tested with controlled upstream responses; real credentials and devices are required for end-to-end provider testing.

## Keep family media safe

Save a snapshot from Projects, then download a library backup. Keep that ZIP outside the browser and test restoring it. Restore never replaces existing records and clears child-sharing approval. Backups contain original family media and text, without encryption; protect them as private files. They exclude settings and all credentials. Current restore limits are 1 GB total archive/expanded media, 512 MB per entry, 2 MB manifest, 2,000 records and 5,000 media references. Very large libraries should be split into smaller sets; mobile memory may be lower than those limits.

The current and previous draft are held separately. Recovery on startup does not replace the previous draft. Media stays on its current device; there is no automatic cloud sync. Storage quota, browser eviction, private mode and clearing site data can remove it. The storage-persistence request is a best-effort browser feature, not a backup. Finish recordings before closing the browser; the app saves the final recording when changing views but cannot promise crash recovery for a microphone session still in progress.

The app shell and saved audio work offline after initial installation. Audio processing works offline after the engine's first successful load. Yoto authentication/upload/player commands, home services, external catalogues and some system speech voices need connectivity. Supported audio codecs and microphone formats vary by browser. Large conversions may exceed phone memory; use the Surface or another computer for long books.

See [release and rollback notes](docs/RELEASE.md) for verification evidence and remaining physical checks. No protected-card writes, DRM removal, subscription downloading, home-server installations or unrelated-project changes are part of this release.
