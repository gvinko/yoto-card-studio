// Client for helper/server.mjs (yt-dlp + ffmpeg on the laptop). Jobs are async so long rips survive
// proxy timeouts (e.g. a Cloudflare quick tunnel used from the phone).

const K = { url: 'helper.url', token: 'helper.token' } as const;
export const getHelper = () => ({ url: (localStorage.getItem(K.url) ?? 'http://localhost:8787').replace(/\/+$/, ''), token: localStorage.getItem(K.token) ?? '' });
export const setHelper = (url: string, token: string) => {
  localStorage.setItem(K.url, url.trim());
  localStorage.setItem(K.token, token.trim());
};

async function call(path: string, init: RequestInit = {}) {
  const { url, token } = getHelper();
  const r = await fetch(url + path, { ...init, headers: { ...(init.headers as Record<string, string>), 'x-helper-token': token } });
  if (!r.ok) throw new Error((await r.text()) || `Helper error ${r.status}`);
  return r;
}

export interface HelperHealth {
  ok: boolean;
  ytDlp: string | null;
  ffmpeg: boolean;
}
export const health = async (): Promise<HelperHealth> => (await call('/health')).json();

export interface MediaInfo {
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string | null;
  chapters: { start: number; end: number; title: string }[];
}
export const info = async (url: string): Promise<MediaInfo> => (await call(`/info?url=${encodeURIComponent(url)}`)).json();

export interface Job {
  id: string;
  status: 'running' | 'done' | 'error';
  stage: string;
  progress: number;
  error?: string;
  filename?: string;
}

export async function rip(url: string, bitrate: 128 | 192, onJob: (j: Job) => void, signal?: AbortSignal): Promise<File> {
  const { id } = await (await call('/rip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, bitrate }) })).json();
  for (;;) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const job: Job = await (await call(`/jobs/${id}`)).json();
    onJob(job);
    if (job.status === 'error') throw new Error(job.error ?? 'Rip failed');
    if (job.status === 'done') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const res = await call(`/jobs/${id}/file`);
  const name = decodeURIComponent(res.headers.get('x-filename') ?? 'download.mp3');
  return new File([await res.blob()], name, { type: 'audio/mpeg' });
}
