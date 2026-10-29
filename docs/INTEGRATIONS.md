# Home audio integration

The Cloudflare static site works without a server: local library, story writing, recording, projects, ZIP backups, FFmpeg processing, Yoto browser authentication and Android Web NFC. It does not contain Audiobookshelf or Home Assistant tokens.

The optional Node 22+ gateway serves the built app and same-origin `/api` endpoints. It adds Audiobookshelf library browsing and Home Assistant controls for explicitly allowed media-player entities. Audiobookshelf playback and progress currently open in Audiobookshelf's own interface. LibriVox discovery opens its official catalogue. Music Assistant is supported through an existing Home Assistant media-player entity; there is no independent Music Assistant server installation or direct API adapter.

## Before running on a home server

Inventory the actual server's existing services, mounts, available storage, backups and media ownership. The connected Windows laptop was inspected read-only: approximately 198 GB free on C:, no matching media-service Windows services, no Docker executable, no WSL distributions listed, and no local listeners at 13378/8095/8123. This does not establish the home server's inventory. No home service was installed or modified.

Configure server environment variables through the server's secret manager or a protected shell, never `VITE_*` variables or committed files:

| Variable | Purpose |
| --- | --- |
| `PARENT_PASSWORD` | Unique parent password, at least 20 characters; different from the browser PIN |
| `STUDIO_ORIGIN` | Exact browser origin. Default `http://127.0.0.1:8788`; remote access requires HTTPS |
| `ABS_URL`, `ABS_TOKEN` | Existing Audiobookshelf base URL and least-privilege read token |
| `HA_URL`, `HA_TOKEN` | Existing Home Assistant base URL and service token |
| `HA_PLAYERS` | Comma-separated explicit `media_player.*` entity allowlist |
| `HOST`, `PORT` | Defaults: `127.0.0.1`, `8788` |

After inventory and authorisation: `npm ci`, `npm run build`, `npm run gateway`. Serve it through an existing trusted HTTPS reverse proxy for phone access; do not expose the loopback HTTP listener directly. Configure the proxy to preserve the browser Origin. Tokens are forwarded only to fixed provider endpoints, never to redirects or browser clients. Browser sessions use HttpOnly, SameSite=Strict cookies (Secure on HTTPS), expire after 30 minutes, and are revoked when leaving Connections or locking the app. Server sessions do not survive a gateway restart. Login is rate-limited.

Home Assistant Cast playback accepts only `media-source://media_source/local/...` references on an explicitly allowed player. Put eligible media in Home Assistant's existing local media library using its official interface. The Cast receiver must reach that media. Browser `blob:` audio and IndexedDB files cannot be handed to Cast receivers. Available controls depend on the installed integration and player; an accepted service request is not proof the receiver actually played it. Volume requests are capped at 50% in the gateway. No device action was performed during this development session.

## Yoto

Register a public browser client at https://dashboard.yoto.dev and the exact callback shown in Settings. Never use a confidential client secret. Card export requests `user:content:manage user:icons:manage offline_access`. Connections separately requests optional `family:library:view family:devices:view family:devices:control` consent. Yoto documents player-control apps as unverified but usable for personal use.

MYO content comes from `/content/mine`; family groups from `/card/family/library/groups`; players from `/device-v2/devices/mine`. Controls use the official WSS MQTT broker and documented card/start, card/pause, card/resume, card/stop and volume/set topics. Commands use short-lived connections, only online family players, a volume cap of 50, no reconnect/offline queue, and a player acknowledgement timeout. A timeout has an uncertain outcome: inspect the player before retrying. Family cards shown only as IDs reflect the group API, not invented titles. Ungrouped purchased cards may not appear in this view.

OAuth runtime tokens remain in this browser's localStorage, as in the existing public-client integration; they are excluded from source bundles and backups. Sign out on shared devices. The local PIN is a child navigation guard, not an adversarial security boundary. It uses a salted PBKDF2 derivation, throttles failed attempts, relocks on refresh/backgrounding and after five minutes of inactivity. Use device-level parental controls for stronger protection. Clearing site data resets the PIN and deletes on-device media, so back up first.

Current official references checked 2026-10-29:
- https://yoto.dev/authentication/browser-auth
- https://yoto.dev/authentication/scopes
- https://yoto.dev/api/devices/getDevices
- https://yoto.dev/players-mqtt/connecting-to-players
- https://yoto.dev/players-mqtt/mqtt-docs
- https://api.audiobookshelf.org/
- https://developers.home-assistant.io/docs/api/rest/ (documentation endpoint returned 403 from the development environment; REST conventions covered by gateway contract tests, not live integration verification)
