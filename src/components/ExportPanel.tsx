import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { ChevronDown, ChevronUp, Cloud, Download, LoaderCircle, LogOut, Trash2 } from 'lucide-react';
import type { Output, Project } from '../types';
import { YOTO_LIMITS } from '../types';
import { exportTrack, outputFormat } from '../lib/audio/ffmpeg';
import { iconToPng } from '../lib/icons';
import { fmt, pad2, safeName, segments } from '../lib/time';
import { getClientId, isSignedIn, signIn, signOut } from '../lib/yoto/auth';
import { listMyCards, savePlaylist, uploadAudio, uploadIcon, type MyCard, type PlaylistTrack } from '../lib/yoto/api';
import { IconThumb } from './IconEditor';
import { Alert } from './IngestPanel';

interface Props {
  project: Project;
  onChange: (p: Project) => void;
  outputs: Output[];
  setOutputs: (o: Output[]) => void;
}

export function ExportPanel({ project, onChange, outputs, setOutputs }: Props) {
  const [bitrate, setBitrate] = useState<128 | 192>(128);
  const [fast, setFast] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const fileMode = !project.source;
  const spans = segments(project);

  const willCopy = project.source
    ? outputFormat({ file: project.source, fast, codecHint: project.codec }).copy
    : project.tracks.every((t) => t.file && outputFormat({ file: t.file, fast }).copy);

  const patchTrack = (id: string, title: string) =>
    onChange({ ...project, tracks: project.tracks.map((t) => (t.id === id ? { ...t, title } : t)) });

  const move = (i: number, d: -1 | 1) => {
    const next = [...project.tracks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...project, tracks: next });
  };

  const remove = (id: string) => onChange({ ...project, tracks: project.tracks.filter((t) => t.id !== id) });

  async function build() {
    setError('');
    setRunning(true);
    setOutputs([]);
    const total = project.tracks.length;
    const out: Output[] = [];
    try {
      for (const [i, t] of project.tracks.entries()) {
        const file = t.file ?? project.source!;
        const span = fileMode ? undefined : spans.get(t.id)!;
        const { blob, ext } = await exportTrack(
          {
            file,
            title: t.title,
            trackNo: i + 1,
            total,
            start: span?.start,
            end: span?.end,
            artist: project.artist,
            album: project.title,
            bitrate,
            fast,
            codecHint: fileMode ? undefined : project.codec,
          },
          (p) => setStatus(`Track ${i + 1}/${total} · ${Math.round(p * 100)}%`),
        );
        out.push({ trackId: t.id, trackNo: i + 1, title: t.title, name: `${pad2(i + 1)} - ${safeName(t.title)}.${ext}`, blob });
        setOutputs([...out]);
      }
      setStatus(`${out.length} tracks ready`);
    } catch (e) {
      setError(String(e));
      setStatus('');
    }
    setRunning(false);
  }

  async function downloadZip() {
    setStatus('Zipping…');
    const zip = new JSZip();
    const icons: Record<string, string> = {};
    for (const o of outputs) {
      zip.file(o.name, o.blob);
      const icon = project.tracks.find((t) => t.id === o.trackId)?.icon;
      if (icon) {
        const name = `icons/${pad2(o.trackNo)}.png`;
        zip.file(name, await iconToPng(icon));
        icons[o.name] = name;
      }
    }
    zip.file(
      'playlist.json',
      JSON.stringify({ title: project.title, artist: project.artist, tracks: outputs.map((o) => ({ n: o.trackNo, title: o.title, file: o.name, icon: icons[o.name] ?? null })) }, null, 2),
    );
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName(project.title)}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`${outputs.length} tracks ready`);
  }

  const size = outputs.reduce((s, o) => s + o.blob.size, 0);
  const tooBig = outputs.filter((o) => o.blob.size > YOTO_LIMITS.trackBytes).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <section className="card p-0">
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-slate-500">Playlist / album title</span>
            <input className="field mt-1 w-full" value={project.title} onChange={(e) => onChange({ ...project, title: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Artist / author</span>
            <input className="field mt-1 w-full" value={project.artist} onChange={(e) => onChange({ ...project, artist: e.target.value })} />
          </label>
        </div>
        <ol className="divide-y divide-white/5 border-t border-white/5">
          {project.tracks.map((t, i) => {
            const o = outputs.find((x) => x.trackId === t.id);
            const span = spans.get(t.id);
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-black">{t.icon && <IconThumb icon={t.icon} />}</div>
                <span className="w-6 shrink-0 text-right font-mono text-sm text-slate-500">{i + 1}</span>
                <input className="field min-w-0 flex-1" value={t.title} onChange={(e) => patchTrack(t.id, e.target.value)} />
                <span className="hidden w-16 text-right font-mono text-xs text-slate-500 sm:block">
                  {o ? `${(o.blob.size / 1e6).toFixed(1)} MB` : fileMode ? '' : span && fmt(span.end - span.start)}
                </span>
                {fileMode && (
                  <div className="flex shrink-0">
                    <button aria-label="Up" className="p-1 text-slate-400 disabled:opacity-25" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={16} /></button>
                    <button aria-label="Down" className="p-1 text-slate-400 disabled:opacity-25" disabled={i === project.tracks.length - 1} onClick={() => move(i, 1)}><ChevronDown size={16} /></button>
                    <button aria-label="Remove" className="p-1 text-slate-400" onClick={() => remove(t.id)}><Trash2 size={16} /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="space-y-4">
        <section className="card">
          <h3 className="mb-3 font-medium text-white">1 · Build tracks</h3>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 accent-amber-500" checked={fast} onChange={(e) => setFast(e.target.checked)} />
            <span>
              <span className="text-white">Fast mode</span>
              <span className="block text-slate-400">
                {willCopy ? 'Cuts without re-encoding (MP3 stays MP3, M4B → M4A). Seconds, not minutes.' : 'Source needs re-encoding to MP3 — this format can’t be cut losslessly.'}
              </span>
            </span>
          </label>
          {!willCopy || !fast ? (
            <select className="field mt-3 w-full" value={bitrate} onChange={(e) => setBitrate(+e.target.value as 128 | 192)}>
              <option value={128}>MP3 128 kbps (speech / audiobooks)</option>
              <option value={192}>MP3 192 kbps (music)</option>
            </select>
          ) : null}
          <button className="btn-primary mt-4 w-full" disabled={running || !project.tracks.length} onClick={build}>
            {running ? <><LoaderCircle size={16} className="animate-spin" /> {status}</> : `Build ${project.tracks.length} tracks`}
          </button>
          {!running && status && <p className="mt-2 text-center text-sm text-slate-400">{status} · {(size / 1e6).toFixed(1)} MB</p>}
          {tooBig > 0 && <p className="mt-2 text-sm text-amber-300">{tooBig} track(s) over Yoto’s 100 MB per-track limit.</p>}
          {error && <div className="mt-3"><Alert text={error} /></div>}
        </section>

        <section className="card">
          <h3 className="mb-3 font-medium text-white">2 · Save</h3>
          <button className="btn w-full" disabled={!outputs.length || running} onClick={downloadZip}>
            <Download size={16} /> Download ZIP (tracks + icons)
          </button>
        </section>

        <YotoSend project={project} outputs={outputs} disabled={running || outputs.length !== project.tracks.length} />
      </div>
    </div>
  );
}

function YotoSend({ project, outputs, disabled }: { project: Project; outputs: Output[]; disabled: boolean }) {
  const [signedIn, setSignedIn] = useState(isSignedIn());
  const [cards, setCards] = useState<MyCard[]>([]);
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (signedIn) listMyCards().then(setCards).catch((e) => setError(String(e)));
  }, [signedIn]);

  const login = async () => {
    setError('');
    try {
      await signIn();
      setSignedIn(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const send = async () => {
    if (outputs.length > YOTO_LIMITS.tracks) return setError(`Yoto allows ${YOTO_LIMITS.tracks} tracks per card.`);
    if (target && !confirm('Replace everything on that playlist with these tracks?')) return;
    setError('');
    setDone(false);
    setBusy(true);
    try {
      const tracks: PlaylistTrack[] = [];
      for (const o of outputs) {
        const label = `Track ${o.trackNo}/${outputs.length}`;
        const audio = await uploadAudio(o.blob, (s) => setStatus(`${label} · ${s}`));
        const icon = project.tracks.find((t) => t.id === o.trackId)?.icon;
        tracks.push({ title: o.title, audio, icon: icon ? await uploadIcon(await iconToPng(icon), `ycs-${pad2(o.trackNo)}`) : undefined });
      }
      setStatus('Saving playlist');
      await savePlaylist(project.title, tracks, target || undefined);
      setStatus('');
      setDone(true);
      listMyCards().then(setCards).catch(() => undefined);
    } catch (e) {
      setError(String(e));
      setStatus('');
    }
    setBusy(false);
  };

  return (
    <section className="card">
      <h3 className="mb-1 flex items-center gap-2 font-medium text-white">
        <Cloud size={16} className="text-amber-400" /> 3 · Send to Yoto
      </h3>
      {!getClientId() ? (
        <p className="text-sm text-slate-400">Add your free Yoto developer client ID in Settings to upload straight to your Yoto library.</p>
      ) : !signedIn ? (
        <button className="btn w-full" onClick={login}>Sign in to Yoto</button>
      ) : (
        <>
          <select className="field mt-2 w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">New playlist “{project.title}”</option>
            {cards.map((c) => (
              <option key={c.cardId} value={c.cardId}>Replace: {c.title}</option>
            ))}
          </select>
          <button className="btn-primary mt-3 w-full" disabled={disabled || busy} onClick={send}>
            {busy ? <><LoaderCircle size={16} className="animate-spin" /> {status}</> : `Upload ${outputs.length || ''} tracks`}
          </button>
          {done && (
            <p className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200 ring-1 ring-emerald-500/20">
              Saved to your Yoto library. Link it to a blank MYO card from the Yoto app.
            </p>
          )}
          <button
            className="mt-3 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
            onClick={() => {
              signOut();
              setSignedIn(false);
              setCards([]);
            }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </>
      )}
      {error && <div className="mt-3"><Alert text={error} /></div>}
    </section>
  );
}
