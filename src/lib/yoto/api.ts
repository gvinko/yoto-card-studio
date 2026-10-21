// Yoto Developer API: https://yoto.dev/myo/uploading-to-cards , https://yoto.dev/icons/uploading-icons
import { API, getAccessToken } from './auth';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const r = await fetch(path.startsWith('http') ? path : API + path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Yoto API ${r.status} on ${path}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

export interface Transcoded {
  transcodedSha256: string;
  transcodedInfo?: { duration?: number; fileSize?: number; channels?: string | number; format?: string };
}

export async function uploadAudio(blob: Blob, onStage?: (s: string) => void): Promise<Transcoded> {
  onStage?.('requesting upload slot');
  const { upload } = await (await authed('/media/transcode/audio/uploadUrl')).json();
  if (upload?.uploadUrl) {
    onStage?.('uploading');
    const put = await fetch(upload.uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'audio/mpeg' } });
    if (!put.ok) throw new Error(`Audio upload failed (${put.status})`);
  }
  if (!upload?.uploadId) throw new Error('Yoto did not return an uploadId');
  onStage?.('transcoding');
  // Long chapters can take minutes to transcode; poll every 2 s for up to 15 min.
  for (let i = 0; i < 450; i++) {
    const r = await fetch(`${API}/media/upload/${upload.uploadId}/transcoded?loudnorm=false`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
    });
    if (r.ok) {
      const data = await r.json();
      if (data?.transcode?.transcodedSha256) return data.transcode as Transcoded;
    }
    await sleep(2000);
  }
  throw new Error('Transcoding timed out');
}

const iconCache = new Map<string, string>();

/** Uploads a 16×16 PNG; returns the `yoto:#mediaId` reference. Identical icons are uploaded once per session. */
export async function uploadIcon(png: Blob, name: string): Promise<string> {
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await png.arrayBuffer())))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const cached = iconCache.get(key);
  if (cached) return cached;
  const form = new FormData();
  form.append('file', png, `${name}.png`);
  const url = new URL(`${API}/media/displayIcons/user/me/upload`);
  url.searchParams.set('autoConvert', 'true');
  url.searchParams.set('filename', name);
  const { displayIcon } = await (await authed(url.toString(), { method: 'POST', body: form })).json();
  const ref = `yoto:#${displayIcon.mediaId}`;
  iconCache.set(key, ref);
  return ref;
}

export interface MyCard {
  cardId: string;
  title: string;
}

export async function listMyCards(): Promise<MyCard[]> {
  const data = await (await authed('/content/mine')).json();
  return (data.cards ?? []).map((c: { cardId: string; title?: string }) => ({ cardId: c.cardId, title: c.title ?? c.cardId }));
}

export interface PlaylistTrack {
  title: string;
  audio: Transcoded;
  icon?: string;
}

/** Creates a playlist, or replaces the content of `cardId` when given. One chapter per track, matching the Yoto app's MYO layout. */
export async function savePlaylist(title: string, tracks: PlaylistTrack[], cardId?: string) {
  const key = (i: number) => String(i + 1).padStart(2, '0');
  const chapters = tracks.map((t, i) => {
    const info = t.audio.transcodedInfo ?? {};
    const display = t.icon ? { icon16x16: t.icon } : undefined;
    return {
      key: key(i),
      title: t.title,
      overlayLabel: String(i + 1),
      ...(display && { display }),
      tracks: [
        {
          key: '01',
          title: t.title,
          trackUrl: `yoto:#${t.audio.transcodedSha256}`,
          duration: info.duration,
          fileSize: info.fileSize,
          channels: info.channels,
          format: info.format,
          type: 'audio',
          overlayLabel: String(i + 1),
          ...(display && { display }),
        },
      ],
    };
  });
  const duration = tracks.reduce((s, t) => s + (t.audio.transcodedInfo?.duration ?? 0), 0);
  const fileSize = tracks.reduce((s, t) => s + (t.audio.transcodedInfo?.fileSize ?? 0), 0);
  const body = {
    ...(cardId && { cardId }),
    title,
    content: { chapters },
    metadata: { media: { duration, fileSize, readableFileSize: Math.round((fileSize / 1024 / 1024) * 10) / 10 } },
  };
  return (await authed('/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
}
