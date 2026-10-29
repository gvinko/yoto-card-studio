# Release candidate 0.2.0 — 2026-10-29

Status: implementation and local verification complete; production release held for authenticated integration and physical-device verification. This is a pull-request candidate, not a claim that the home stack or Yoto player has been configured.

## Preserved release

- Source baseline: `b9a3becb710b6705b3c2f65eb876222f081698df` on `main`.
- Rollback tag: `rollback/pre-evie-library-b9a3bec`.
- Additional local Git bundle: `/workspace/yoto-pre-expansion.bundle`.
- Existing production: https://yoto-card-studio.tradekitau.workers.dev/ (HTTP 200 verified).
- Existing Cloudflare deployment: `f6ed0ccc-e684-4768-b3b1-573bbbcbfba8`.
- Existing Cloudflare version serving 100%: `90d29ba7-0b73-481d-a0fb-6b0f5062898a`.

No production deployment, merge, protected card write or home-server installation was performed. No unrelated project was changed.

## Verified locally

| Check | Result |
| --- | --- |
| Baseline build before changes | Passed |
| `npm test` | 24 tests, six files, passed on Node 22 and Node 24 |
| `npm run build` | TypeScript and Vite production build passed; FFmpeg core copied and service worker generated |
| Browser suite | 24 passed across Chromium desktop, Android emulation, iPhone WebKit emulation and Surface touch viewport |
| `npm audit --audit-level=high` | Zero known vulnerabilities |
| `git diff --check` | Passed |
| Configured credential-value scan | No configured GH/GitHub/Cloudflare token value found in source or build |
| Focused independent code review | Reported recovery/recording/ZIP memory issues corrected; no further important findings reported |

Unit/security coverage: File/icon persistence, current/previous drafts, non-destructive ZIP restore, checksums and corrupt archives, playlist reference remapping, shared media decoding, binary-storage fallback, backup size limits, PIN derivation/throttling, OAuth state rejection and PKCE success, rotating refresh token coalescing, new-playlist-only export, duration limits, nonempty NFC refusal and read-error disarming, supported player command construction, gateway sessions, cross-origin rejection, server token filtering and Home Assistant entity restrictions.

Browser coverage: parent setup and reload lock, parent-only/child-shared audio, offline story access after app-shell installation, backup download and restore as fresh parent-only copies, real PCM WAV import and FFmpeg MP3 export, previous draft recovery after reload, permission-gated library-to-MYO preparation with chapter editing, recording finalisation on parent lock (mock microphone), playlist playback order, and child-screen horizontal overflow checks. Desktop and phone screenshots are in `docs/evidence/`; CI uploads full browser reports.

The cloud development container could not install system browser libraries as root. Required Debian browser libraries were downloaded and extracted into temporary workspace paths and linked into the local Playwright distribution. The local suite therefore ran with `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` after confirming the actual browser could launch; no application tests were skipped. CI uses the normal `playwright install --with-deps` path. WebKit exposed a genuine Blob/File IndexedDB failure, confirmed with a direct capability experiment; a tested binary-buffer fallback now handles it.

The first GitHub CI run found that Node 22's structured clone turns a File into a Blob and drops its name. This was reproduced locally and corrected by checking the complete media storage round trip, rather than only whether writing succeeded. The binary fallback preserves File metadata in this case. The full unit suite now passes on both Node 22 and 24.

## Functional boundaries

Audiobookshelf integration browses existing libraries and opens playback/progress in the official Audiobookshelf interface. It does not yet embed Audiobookshelf streaming, synchronise listening progress into the child view, or silently copy server books. Local audiobooks are playable in the family library. LibriVox discovery opens the official catalogue; it does not automatically download books.

Music Assistant is reached through an existing Home Assistant media-player entity. Cast playback accepts Home Assistant local media-source URIs; it cannot cast an on-device `blob:` URL. These paths require the optional gateway and existing reachable services. No server endpoints, tokens or running media services were supplied by the runtime, and the connected laptop is not established as the home server.

Yoto uses official REST library/player discovery and MQTT controls. Live login, upload, playback acknowledgements and Mini-specific behaviour remain unverified without the family's consent and online player. Purchased cards outside family groups may not appear; use the official Yoto app for the complete library. Export creates new MYO playlists only. No subscription content is downloaded and no protected card is writable.

The browser PIN is a local child navigation guard, not an identity system. The app has no cross-device cloud sync. Backups contain private unencrypted media; protect downloaded ZIPs. Browser quota/eviction can remove local data. Long audio conversions, background playback, microphone permission and format support need real-device checks. Finish recording before closing the browser; an in-progress microphone session is not crash-recoverable.

## Release gates requiring the owner or physical devices

1. Register/confirm the public Yoto client and callback, grant optional player scopes, turn on the Mini, and verify login/refresh, a new eligible MYO upload, pause/resume/stop/play and volume. Inspect the player after any command timeout before retrying.
2. Identify the actual home server and authorise its read-only service/storage inventory. Reuse existing Audiobookshelf, Home Assistant and Music Assistant/Cast services. Configure the gateway's server secrets privately only after this inventory; no credentials should be pasted into source or `VITE_*` variables.
3. On Android Chrome, iPhone Safari and Surface Edge: test microphone recording, representative long files, playback, exported ZIP backup/restore and offline reopening. On Android, verify protected-card refusal and a deliberately empty test tag; do not test writing on a protected card.
4. Review the PR and CI evidence. Deploy the verified commit only after the above gates, keeping the recorded Cloudflare version available. Recheck the deployed root, assets, service worker, authentication callback and a restore on the production origin before declaring release success.

## Deployment / rollback procedure

Build the exact reviewed commit with `npm ci && npm run build`. Use the existing `yoto-card-studio` Worker configuration, not a new unrelated project. Deploy its `dist` assets through the existing authorised Cloudflare release route after gates pass. Keep server credentials out of static assets; the optional Node gateway is a separately inventoried home-service decision.

For an application rollback, select Cloudflare version `90d29ba7-0b73-481d-a0fb-6b0f5062898a` at 100% in the existing Worker's Deployments controls, then verify the root and assets. Preserve the IndexedDB family database and browser downloads; do not clear site data as a rollback step. The former app does not know about the new library database. Export a backup before rolling back, and use an already-installed new version or the reviewed source to recover those records if needed. Source rollback is also available from the rollback tag; do not rewrite `main` history.
