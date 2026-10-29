# Evie's library expansion

Decision (engineer, under autonomous implementation instruction): extend the existing React/Vite application in place. Keep personal audio on-device in IndexedDB; backups are portable ZIP archives containing original media, project metadata and icons. Do not introduce a paid service or install anything on the home server.

Alternatives: hosted object storage would permit synchronisation but introduces credentials, recurring operations and family-media privacy concerns; a new home server stack requires service/storage discovery and is deferred until the actual server is accessible.

Sequence:
1. Preserve main and record production rollback version; verify baseline build and dependencies.
2. Add validated immutable project snapshots, automatic current/previous recovery, portable checked backups and restore as copies. Verify with real IndexedDB semantics and corrupt-archive tests.
3. Add child library and parent device gate, local music/audiobooks, favourites and playlists; original story writing, recordings and offline activities. Keep original editing components.
4. Harden OAuth, NFC, card export, caching and remove link ripping from the app. Add optional same-origin integration server with server-held provider credentials and supported ABS/HA APIs. Never infer device eligibility or content rights.
5. Verify builds, tests and browser flows, document physical-device/integration limits, push branch and open PR. Production stays on the preserved version until release verification is complete.

Release criteria: passing typecheck/build/unit/browser tests; no bundled service secrets; non-destructive backup restore; child cannot reach editing/settings through normal navigation; no NFC overwrite; official-channel YouTube links only. Real device NFC, Yoto consent, authenticated providers and home-server inventory remain explicitly unverified until available.
