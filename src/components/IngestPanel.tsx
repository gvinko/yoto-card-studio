import { useRef, useState } from 'react';
import { LoaderCircle, Music, TriangleAlert, Upload } from 'lucide-react';
import type { Project } from '../types';
import { uid } from '../types';
import { probe } from '../lib/audio/ffmpeg';
import { cleanTitle, stem } from '../lib/time';

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
      <p className="text-sm text-slate-300">Import audio you own or have permission to copy. <a className="text-amber-300 underline" href="https://music.youtube.com" target="_blank" rel="noreferrer">YouTube Music opens in its official player</a>; subscription audio stays there.</p>
    </div>
  );
}

export function Alert({ text }: { text: string }) {
  return (
    <p className="flex gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/20">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {text}
    </p>
  );
}
