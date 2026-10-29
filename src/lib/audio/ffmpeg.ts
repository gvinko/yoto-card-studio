import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

/** Single-threaded core: no COOP/COEP headers needed, runs on Android Chrome. Cached by sw.js after first load. */
const CORE = new URL('/ffmpeg', location.origin).href;

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
/** ffmpeg.wasm runs one command at a time; serialise every job through this chain. */
let queue: Promise<unknown> = Promise.resolve();

export function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  loading ??= (async () => {
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    instance = ff;
    return ff;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

type Progress = (fraction: number) => void;

function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

async function run(ff: FFmpeg, args: string[], onProgress?: Progress) {
  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => logs.push(message);
  const onProg = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
  ff.on('log', onLog);
  ff.on('progress', onProg);
  try {
    const code = await ff.exec(args);
    return { code, logs };
  } finally {
    ff.off('log', onLog);
    ff.off('progress', onProg);
  }
}

/** Mount the File read-only via WORKERFS so multi-hundred-MB audiobooks are never copied into wasm memory. */
function withInput<T>(file: File, fn: (ff: FFmpeg, path: string) => Promise<T>): Promise<T> {
  return serial(async () => {
    const ff = await getFFmpeg();
    const dir = `/in${Date.now()}`;
    await ff.createDir(dir);
    await ff.mount('WORKERFS' as never, { files: [file] }, dir);
    try {
      return await fn(ff, `${dir}/${file.name}`);
    } finally {
      await ff.unmount(dir).catch(() => undefined);
      await ff.deleteDir(dir).catch(() => undefined);
    }
  });
}

async function readText(ff: FFmpeg, path: string): Promise<string> {
  try {
    const data = await ff.readFile(path, 'utf8');
    await ff.deleteFile(path);
    return typeof data === 'string' ? data : new TextDecoder().decode(data);
  } catch {
    return '';
  }
}

export interface ProbeResult {
  duration: number;
  codec: string;
  title: string;
  artist: string;
  album: string;
  chapters: { start: number; end: number; title: string }[];
}

export function probe(file: File): Promise<ProbeResult> {
  return withInput(file, async (ff, path) => {
    const { logs } = await run(ff, ['-hide_banner', '-i', path, '-f', 'ffmetadata', '-y', '/meta.txt']);
    const meta = parseFfmetadata(await readText(ff, '/meta.txt'));
    const text = logs.join('\n');
    const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
    return {
      duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
      codec: /Audio: (\w+)/.exec(text)?.[1] ?? '',
      ...meta,
    };
  });
}

export function parseFfmetadata(text: string): Omit<ProbeResult, 'duration' | 'codec'> {
  const tags: Record<string, string> = {};
  const raw: { tb: number; start: number; end: number; title: string }[] = [];
  let cur: (typeof raw)[number] | null = null;
  let inSection = false;
  for (const line of text.split('\n').map((l) => l.trimEnd())) {
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      inSection = true;
      cur = line === '[CHAPTER]' ? { tb: 1e-3, start: 0, end: 0, title: '' } : null;
      if (cur) raw.push(cur);
      continue;
    }
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).toLowerCase();
    const v = line.slice(i + 1).replace(/\\(.)/g, '$1');
    if (cur) {
      if (k === 'timebase') {
        const [a, b] = v.split('/').map(Number);
        if (a && b) cur.tb = a / b;
      } else if (k === 'start') cur.start = +v;
      else if (k === 'end') cur.end = +v;
      else if (k === 'title') cur.title = v;
    } else if (!inSection) tags[k] = v;
  }
  return {
    title: tags.title ?? '',
    artist: tags.artist ?? tags.album_artist ?? '',
    album: tags.album ?? '',
    chapters: raw.map((c) => ({ start: c.start * c.tb, end: c.end * c.tb, title: c.title })),
  };
}

/** Returns split points (midpoint of each silence) in seconds. */
export function detectSilence(
  file: File,
  opts: { noiseDb: number; minSilence: number },
  onProgress?: Progress,
): Promise<number[]> {
  return withInput(file, async (ff, path) => {
    const { logs } = await run(
      ff,
      ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilence}`, '-f', 'null', '-'],
      onProgress,
    );
    const points: number[] = [];
    let start: number | null = null;
    for (const m of logs) {
      const s = /silence_start: (-?[\d.]+)/.exec(m);
      if (s) start = Math.max(0, +s[1]);
      const e = /silence_end: ([\d.]+)/.exec(m);
      if (e && start !== null) {
        points.push((start + +e[1]) / 2);
        start = null;
      }
    }
    return points;
  });
}

/**
 * Peak envelope at 10 values/second without decoding the whole file into JS memory
 * (a 10 h book decoded by the browser would need >10 GB). Feeds WaveSurfer's `peaks` option.
 */
const peakCache = new WeakMap<File, Promise<Float32Array>>();

export function computePeaks(file: File, onProgress?: Progress): Promise<Float32Array> {
  let job = peakCache.get(file);
  if (!job) {
    job = peaksFor(file, onProgress);
    job.catch(() => peakCache.delete(file));
    peakCache.set(file, job);
  }
  return job;
}

function peaksFor(file: File, onProgress?: Progress): Promise<Float32Array> {
  return withInput(file, async (ff, path) => {
    const filter =
      'aresample=8000,asetnsamples=n=800:p=0,astats=metadata=1:reset=1,' +
      'ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=/peaks.txt';
    await run(ff, ['-hide_banner', '-nostats', '-i', path, '-vn', '-ac', '1', '-af', filter, '-f', 'null', '-'], onProgress);
    const text = await readText(ff, '/peaks.txt');
    const out: number[] = [];
    for (const m of text.matchAll(/Peak_level=(-?[\d.]+|-inf)/g)) out.push(m[1] === '-inf' ? 0 : 10 ** (+m[1] / 20));
    if (!out.length) throw new Error('No peaks produced');
    return Float32Array.from(out);
  });
}

export interface ExportJob {
  file: File;
  title: string;
  trackNo: number;
  total: number;
  start?: number;
  end?: number;
  artist: string;
  album: string;
  bitrate: 128 | 192;
  /** Stream-copy when the input is already MP3/AAC: seconds instead of minutes on a phone. */
  fast: boolean;
  codecHint?: string;
}

/** Output format for a job: copy keeps MP3 as .mp3 and AAC as .m4a, everything else is encoded to MP3. */
export function outputFormat(job: Pick<ExportJob, 'file' | 'fast' | 'codecHint'>): { ext: 'mp3' | 'm4a'; copy: boolean } {
  const ext = job.file.name.split('.').pop()?.toLowerCase() ?? '';
  const codec = job.codecHint ?? (ext === 'mp3' ? 'mp3' : ['m4a', 'm4b', 'aac', 'mp4'].includes(ext) ? 'aac' : '');
  if (job.fast && codec === 'mp3') return { ext: 'mp3', copy: true };
  if (job.fast && codec === 'aac') return { ext: 'm4a', copy: true };
  return { ext: 'mp3', copy: false };
}

export function exportTrack(job: ExportJob, onProgress?: Progress): Promise<{ blob: Blob; ext: string }> {
  return withInput(job.file, async (ff, path) => {
    const { ext, copy } = outputFormat(job);
    const out = `/out_${job.trackNo}.${ext}`;
    const args = ['-hide_banner', '-nostats', '-y'];
    if (job.start != null && job.start > 0) args.push('-ss', job.start.toFixed(3));
    args.push('-i', path);
    if (job.end != null) args.push('-t', Math.max(0.1, job.end - (job.start ?? 0)).toFixed(3));
    args.push('-map', '0:a:0', '-vn', '-map_metadata', '-1', '-map_chapters', '-1');
    if (copy) args.push('-c:a', 'copy');
    else args.push('-c:a', 'libmp3lame', '-b:a', `${job.bitrate}k`, '-ar', '44100', '-ac', '2');
    if (ext === 'mp3') args.push('-id3v2_version', '3');
    args.push(
      '-metadata', `title=${job.title}`,
      '-metadata', `artist=${job.artist}`,
      '-metadata', `album=${job.album}`,
      '-metadata', `track=${job.trackNo}/${job.total}`,
      out,
    );
    const { code, logs } = await run(ff, args, onProgress);
    if (code !== 0) throw new Error(`ffmpeg failed on track ${job.trackNo}: ${logs.slice(-3).join(' ')}`);
    const data = await ff.readFile(out);
    await ff.deleteFile(out);
    return { blob: new Blob([data as unknown as BlobPart], { type: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }), ext };
  });
}
