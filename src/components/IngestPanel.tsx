import { useRef, useState } from 'react';
import { Link2, LoaderCircle, Music, TriangleAlert, Upload } from 'lucide-react';
import type { Project } from '../types';
import { uid } from '../types';
import { probe } from '../lib/audio/ffmpeg';
import { cleanTitle, fmt, stem } from '../lib/time';
import * as helper from '../lib/helper';

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|flac|wav|ogg|opus|mp4)$/i;

export function IngestPanel({ onProject }: { onProject: (p: Project) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function take(list: File[]) {
    const files = list.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
    if (!files.length) return setError('No audio files in that selection.');
    setError('');
    try {
      if (files.length === 1) {
        const f = files[0];
        setBusy('Reading file (first run downloads the audio engine, ~30 MB)…');
        const info = await probe(f).catch(() => null);
        const chapters = info?.chapters.filter((c) => c.end - c.start > 1) ?? [];
        onProject({
          title: info?.album || info?.title || stem(f.name),
          artist: info?.artist ?? '',
          source: f,
          codec: info?.codec,
          duration: info?.duration ?? 0,
          tracks: chapters.length
            ? chapters.map((c, i) => ({ id: uid(), title: c.title || `Chapter ${i + 1}`, start: i === 0 ? 0 : c.start }))
            : [{ id: uid(), title: info?.title || cleanTitle(f.name), start: 0 }],
        });
      } else {
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        onProject({
          title: 'New playlist',
          artist: '',
          duration: 0,
          tracks: sorted.map((f) => ({ id: uid(), title: cleanTitle(f.name), start: 0, file: f })),
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <section
        className={`card grid place-items-center border-2 border-dashed py-12 text-center transition ${over ? 'border-amber-500 bg-amber-500/5' : 'border-white/10'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take([...e.dataTransfer.files]);
        }}
      >
        {busy ? (
          <p className="flex items-center gap-2 text-slate-300">
            <LoaderCircle className="animate-spin" size={18} /> {busy}
          </p>
        ) : (
          <>
            <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/10 text-amber-400">
              <Upload size={26} />
            </div>
            <p className="font-medium text-white">Drop audio here</p>
            <p className="mt-1 max-w-sm text-sm text-slate-400">
              One file (MP3, M4B audiobook…) opens the chapter studio. Several files (a CD rip, a folder of MP3s) become one track each.
            </p>
            <button className="btn-primary mt-5" onClick={() => input.current?.click()}>
              <Music size={16} /> Choose files
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="audio/*,.m4b,.m4a,.flac"
          onChange={(e) => {
            take([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </section>

      {error && <Alert text={error} />}
      <UrlRipper onFile={(f) => take([f])} />
    </div>
  );
}

function UrlRipper({ onFile }: { onFile: (f: File) => void }) {
  const [url, setUrl] = useState('');
  const [bitrate, setBitrate] = useState<128 | 192>(192);
  const [meta, setMeta] = useState<helper.MediaInfo | null>(null);
  const [job, setJob] = useState<helper.Job | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    setError('');
    setMeta(null);
    setBusy(true);
    try {
      setMeta(await helper.info(url));
    } catch (e) {
      setError(helperError(e));
    }
    setBusy(false);
  };

  const go = async () => {
    setError('');
    setBusy(true);
    try {
      onFile(await helper.rip(url, bitrate, setJob));
      setUrl('');
      setMeta(null);
    } catch (e) {
      setError(helperError(e));
    }
    setJob(null);
    setBusy(false);
  };

  return (
    <section className="card">
      <h3 className="mb-1 flex items-center gap-2 font-medium text-white">
        <Link2 size={16} className="text-amber-400" /> From a link
      </h3>
      <p className="mb-3 text-sm text-slate-400">Runs yt-dlp on your own laptop helper. No converter sites, no pop-ups.</p>
      <div className="flex gap-2">
        <input className="field min-w-0 flex-1" placeholder="https://…" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && lookup()} />
        <button className="btn" disabled={!url || busy} onClick={lookup}>Check</button>
      </div>

      {meta && (
        <div className="mt-3 flex gap-3 rounded-xl bg-slate-950/50 p-3">
          {meta.thumbnail && <img src={meta.thumbnail} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />}
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-white">{meta.title}</p>
            <p className="text-slate-400">
              {meta.uploader} · {fmt(meta.duration)}
              {meta.chapters.length > 0 && ` · ${meta.chapters.length} chapters`}
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <select className="field" value={bitrate} onChange={(e) => setBitrate(+e.target.value as 128 | 192)}>
          <option value={192}>192 kbps MP3</option>
          <option value={128}>128 kbps MP3</option>
        </select>
        <button className="btn-primary flex-1" disabled={!url || busy} onClick={go}>
          {job ? `${job.stage} ${Math.round(job.progress * 100)}%` : busy ? <LoaderCircle size={16} className="animate-spin" /> : 'Rip to studio'}
        </button>
      </div>
      {error && <div className="mt-3"><Alert text={error} /></div>}
    </section>
  );
}

function helperError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return /Failed to fetch|NetworkError|Load failed/i.test(msg)
    ? `Can't reach the helper at ${helper.getHelper().url}. Start it with "npm run helper" on the laptop and check Settings.`
    : msg;
}

export function Alert({ text }: { text: string }) {
  return (
    <p className="flex gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {text}
    </p>
  );
}
