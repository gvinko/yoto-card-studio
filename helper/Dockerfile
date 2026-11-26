# Yoto Card Studio rip helper for an always-on Linux box (home server).
# Build/run with helper/compose.yaml — see README "Run it on a home server".
FROM node:22-bookworm-slim

ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp build (no Python needed). Kept writable so it can update itself (`yt-dlp -U`).
RUN mkdir -p /opt/yt-dlp \
 && case "$TARGETARCH" in arm64) f=yt-dlp_linux_aarch64 ;; *) f=yt-dlp_linux ;; esac \
 && curl -fsSL -o /opt/yt-dlp/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$f" \
 && chmod 755 /opt/yt-dlp/yt-dlp \
 && chown -R node:node /opt/yt-dlp

ENV PATH=/opt/yt-dlp:$PATH HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY server.mjs entrypoint.sh ./
USER node
EXPOSE 8787
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
