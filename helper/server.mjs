#!/usr/bin/env node
// Yoto Card Studio rip helper — zero dependencies, Node 18+.
// Wraps yt-dlp + ffmpeg on this machine so the PWA (laptop or phone) can pull audio from links
// without ad-riddled converter sites. Every request needs the token printed at startup.
//
//   node helper/server.mjs                 → http://localhost:8787
//   PORT=9000 YTDLP=/path/yt-dlp FFMPEG=/path/ffmpeg node helper/server.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1'; // tunnel connects locally; set HOST=0.0.0.0 for LAN access
const YTDLP = process.env.YTDLP ?? 'yt-dlp';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const WORK = join(tmpdir(), 'yoto-card-studio');
const JOB_TTL = 60 * 60e3;

const tokenFile = join(HERE, '.token');
const TOKEN = process.env.HELPER_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : (() => {
  const t = randomBytes(18).toString('base64url');
  writeFileSync(tokenFile, t, { mode: 0o600 });
  return t;
})());

mkdirSync(WORK, { recursive: true });

/** @type {Map<string, {id:string,status:'running'|'done'|'error',stage:string,progress:number,error?:string,file?:string,filename?:string,dir:string,at:number}>} */
const jobs = new Map();

function run(cmd, args, { onLine } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out, err: String(e) });
    }
    const feed = (buf, sink) => {
      const s = buf.toString();
      if (sink === 'out') out += s;
      else err += s;
      if (onLine) for (const line of s.split(/\r?\n|\r/)) if (line) onLine(line);
    };
    child.stdout.on('data', (b) => feed(b, 'out'));
    child.stderr.on('data', (b) => feed(b, 'err'));
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

const isHttpUrl = (u) => {
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

const authed = (req) => {
  const got = Buffer.from(String(req.headers['x-helper-token'] ?? ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null;
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : String(body ?? ''));
}

async function readJson(req, limit = 16_384) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const ffmpegArgs = () => (process.env.FFMPEG ? ['--ffmpeg-location', FFMPEG] : []);

async function info(url) {
  const r = await run(YTDLP, ['-J', '--no-playlist', '--no-warnings', '--skip-download', ...ffmpegArgs(), '--', url]);
  if (r.code !== 0) throw new Error(r.err.trim().split('\n').pop() || 'yt-dlp failed');
  const j = JSON.parse(r.out);
  return {
    title: j.title ?? '',
    uploader: j.uploader ?? j.channel ?? '',
    duration: j.duration ?? 0,
    thumbnail: j.thumbnail ?? null,
    chapters: (j.chapters ?? []).map((c) => ({ start: c.start_time, end: c.end_time, title: c.title })),
  };
}

function startRip(url, bitrate) {
  const id = randomBytes(8).toString('hex');
  const dir = join(WORK, id);
  mkdirSync(dir, { recursive: true });
  const job = { id, status: 'running', stage: 'starting', progress: 0, dir, at: Date.now() };
  jobs.set(id, job);

  const args = [
    '--no-playlist', '--newline', '--no-warnings',
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3', '--audio-quality', `${bitrate}K`,
    '--embed-metadata', '--embed-thumbnail', '--embed-chapters',
    '--convert-thumbnails', 'jpg',
    ...ffmpegArgs(),
    '-o', join(dir, '%(title).120B.%(ext)s'),
    '--', url,
  ];
  run(YTDLP, args, {
    onLine: (line) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) {
        job.stage = 'downloading';
        job.progress = Number(m[1]) / 100;
      } else if (/\[(ExtractAudio|Metadata|EmbedThumbnail|FFmpeg)/.test(line)) {
        job.stage = 'converting';
        job.progress = 1;
      }
    },
  }).then((r) => {
    const mp3 = readdirSync(dir).find((f) => f.endsWith('.mp3'));
    if (r.code === 0 && mp3) {
      Object.assign(job, { status: 'done', stage: 'done', progress: 1, file: join(dir, mp3), filename: mp3 });
    } else {
      const error = r.code === -1
        ? `yt-dlp not found ("${YTDLP}"). Install it or set YTDLP=/full/path — see README.`
        : r.err.trim().split('\n').filter(Boolean).pop() || 'yt-dlp failed';
      Object.assign(job, { status: 'error', error });
    }
  });
  return id;
}

setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.at > JOB_TTL && j.status !== 'running') {
    rmSync(j.dir, { recursive: true, force: true });
    jobs.delete(id);
  }
}, 5 * 60e3).unref();

const server = createServer(async (req, res) => {
  // CORS + Chrome Private Network Access: the PWA is served from another origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-helper-token, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'x-filename, content-length');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (!authed(req)) return send(res, 401, 'Wrong or missing helper token (see Settings).');

  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const [y, f] = await Promise.all([run(YTDLP, ['--version']), run(FFMPEG, ['-version'])]);
      return send(res, 200, { ok: true, ytDlp: y.code === 0 ? y.out.trim() : null, ffmpeg: f.code === 0 });
    }
    if (req.method === 'GET' && url.pathname === '/info') {
      const target = url.searchParams.get('url') ?? '';
      if (!isHttpUrl(target)) return send(res, 400, 'Not an http(s) link');
      return send(res, 200, await info(target));
    }
    if (req.method === 'POST' && url.pathname === '/rip') {
      const { url: target, bitrate } = await readJson(req);
      if (!isHttpUrl(target)) return send(res, 400, 'Not an http(s) link');
      const br = Number(bitrate) === 128 ? 128 : 192;
      return send(res, 202, { id: startRip(target, br) });
    }
    const m = /^\/jobs\/([a-f0-9]{16})(\/file)?$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, 'No such job');
      if (!m[2]) {
        const { dir, file, ...pub } = job;
        return send(res, 200, pub);
      }
      if (job.status !== 'done' || !job.file) return send(res, 409, 'Not ready');
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': statSync(job.file).size,
        'x-filename': encodeURIComponent(job.filename),
      });
      return createReadStream(job.file).pipe(res);
    }
    send(res, 404, 'Not found');
  } catch (e) {
    send(res, 500, e instanceof Error ? e.message : String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Yoto Card Studio helper on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  Phone access: cloudflared tunnel --url http://localhost:${PORT}  (paste the https URL + token into Settings)\n`);
});
