import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import {
  ChevronDown, ChevronUp, LoaderCircle, Pause, Play, Plus, Scissors, Sparkles, Trash2, TriangleAlert, ZoomIn,
} from 'lucide-react';
import type { Project, Track } from '../types';
import { uid, YOTO_LIMITS } from '../types';
import { computePeaks, detectSilence } from '../lib/audio/ffmpeg';
import { fmt, parseTime, segments } from '../lib/time';

/** Above this length the browser can't decode the whole file; peaks come from ffmpeg instead. */
const LONG_SECONDS = 25 * 60;
const MIN_GAP = 0.5;

interface Props {
  project: Project;
  onChange: (p: Project) => void;
}

export function ChapterStudio({ project, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const projRef = useRef(project);
  const changeRef = useRef(onChange);
  projRef.current = project;
  changeRef.current = onChange;

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [busy, setBusy] = useState<{ label: string; progress: number | null } | null>(null);
  const [error, setError] = useState('');
  const [silence, setSilence] = useState({ noiseDb: -35, minSilence: 2, minChapterMin: 3 });
  const source = project.source;

  const update = useCallback((tracks: Track[]) => changeRef.current({ ...projRef.current, tracks }), []);

  // ── WaveSurfer lifecycle (one instance per source file) ──────────────────────────
  useEffect(() => {
    if (!source || !box.current) return;
    let cancelled = false;
    const url = URL.createObjectURL(source);
    const rp = RegionsPlugin.create();
    regions.current = rp;
    const w = WaveSurfer.create({
      container: box.current,
      height: 120,
      waveColor: '#334155',
      progressColor: '#f59e0b',
      cursorColor: '#fde68a',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      dragToSeek: true,
      plugins: [rp, TimelinePlugin.create({ height: 16 })],
    });
    ws.current = w;
    w.on('ready', (d) => {
      setReady(true);
      if (Math.abs(projRef.current.duration - d) > 1) changeRef.current({ ...projRef.current, duration: d });
    });
    w.on('timeupdate', setTime);
    w.on('play', () => setPlaying(true));
    w.on('pause', () => setPlaying(false));
    w.on('error', (e) => setError(String(e)));
    rp.on('region-updated', (r) => {
      const p = projRef.current;
      changeRef.current({ ...p, tracks: p.tracks.map((t) => (t.id === r.id ? { ...t, start: Math.max(0, r.start) } : t)) });
    });
    rp.on('region-clicked', (r, e) => {
      e.stopPropagation();
      w.setTime(r.start);
    });

    (async () => {
      const dur = projRef.current.duration;
      let peaks: Float32Array | undefined;
      if (dur > LONG_SECONDS) {
        setBusy({ label: 'Building waveform', progress: 0 });
        try {
          peaks = await computePeaks(source, (p) => setBusy({ label: 'Building waveform', progress: p }));
        } catch (e) {
          setError(`Waveform preview failed (${e}). Playback and markers still work.`);
        }
        setBusy(null);
      }
      if (cancelled) return;
      // With peaks + duration, WaveSurfer skips decoding and streams playback from the media element.
      await w.load(url, peaks ? [peaks] : undefined, peaks ? dur : undefined);
    })().catch((e) => !cancelled && setError(String(e)));

    return () => {
      cancelled = true;
      w.destroy();
      URL.revokeObjectURL(url);
      ws.current = null;
      regions.current = null;
      setReady(false);
      setPlaying(false);
    };
  }, [source]);

  // ── Keep marker regions in sync with track list ───────────────────────────────────
  useEffect(() => {
    const rp = regions.current;
    if (!rp || !ready) return;
    rp.clearRegions();
    project.tracks.forEach((t, i) => {
      const label = document.createElement('span');
      label.textContent = String(i + 1);
      label.className = 'ycs-marker';
      rp.addRegion({ id: t.id, start: t.start, content: label, color: '#f59e0b', drag: t.start > 0, resize: false });
    });
  }, [project.tracks, ready]);

  useEffect(() => {
    if (ready) ws.current?.zoom(zoom);
  }, [zoom, ready]);

  // ── Marker operations ────────────────────────────────────────────────────────────
  const addMarker = useCallback(
    (at: number) => {
      const p = projRef.current;
      if (p.tracks.some((t) => Math.abs(t.start - at) < MIN_GAP)) return;
      // insert after the track whose span contains `at`, so playlist order follows the timeline
      const spans = segments(p);
      const host = p.tracks.findIndex((t) => {
        const s = spans.get(t.id)!;
        return at >= s.start && at < s.end;
      });
      const next = [...p.tracks];
      next.splice(host + 1, 0, { id: uid(), title: `Chapter ${p.tracks.length + 1}`, start: at });
      update(next);
    },
    [update],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'm' || e.key === 'M') addMarker(ws.current?.getCurrentTime() ?? 0);
      if (e.key === ' ') {
        e.preventDefault();
        ws.current?.playPause();
      }
      if (e.key === 'ArrowLeft') ws.current?.setTime(Math.max(0, (ws.current?.getCurrentTime() ?? 0) - 5));
      if (e.key === 'ArrowRight') ws.current?.setTime((ws.current?.getCurrentTime() ?? 0) + 5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addMarker]);

  const runSilence = async () => {
    if (!source) return;
    if (project.tracks.length > 1 && !confirm('Replace the current chapter markers with silence-detected ones?')) return;
    setError('');
    setBusy({ label: 'Detecting silence', progress: 0 });
    try {
      const points = await detectSilence(source, silence, (p) => setBusy({ label: 'Detecting silence', progress: p }));
      const minLen = silence.minChapterMin * 60;
      const starts = [0];
      for (const pt of points) if (pt - starts[starts.length - 1] >= minLen && project.duration - pt >= minLen / 2) starts.push(pt);
      update(starts.map((s, i) => ({ id: uid(), title: `Chapter ${i + 1}`, start: s })));
      if (starts.length === 1) setError('No gaps matched. Lower the minimum chapter length or raise the noise floor (e.g. -30 dB).');
    } catch (e) {
      setError(String(e));
    }
    setBusy(null);
  };

  const splitEvenly = () => {
    const n = Math.ceil(project.duration / YOTO_LIMITS.trackSeconds) || 1;
    const len = project.duration / n;
    if (project.tracks.length > 1 && !confirm(`Replace markers with ${n} equal parts of ${fmt(len)}?`)) return;
    update(Array.from({ length: n }, (_, i) => ({ id: uid(), title: `Part ${i + 1}`, start: i * len })));
  };

  const patch = (id: string, p: Partial<Track>) => update(project.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...project.tracks];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const remove = (id: string) => {
    const t = project.tracks.find((x) => x.id === id);
    if (!t || project.tracks.length === 1) return;
    let next = project.tracks.filter((x) => x.id !== id);
    // removing the 0:00 marker would orphan the opening audio — promote the earliest remaining one
    if (t.start === 0) {
      const first = next.reduce((a, b) => (b.start < a.start ? b : a));
      next = next.map((x) => (x.id === first.id ? { ...x, start: 0 } : x));
    }
    update(next);
  };
  const sortByTime = () => update([...project.tracks].sort((a, b) => a.start - b.start));

  // ── Derived info / Yoto limit warnings ───────────────────────────────────────────
  const spans = useMemo(() => segments(project), [project]);
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (project.tracks.length > YOTO_LIMITS.tracks) w.push(`${project.tracks.length} tracks — a MYO card holds ${YOTO_LIMITS.tracks}.`);
    const long = project.tracks.filter((t) => {
      const s = spans.get(t.id)!;
      return s.end - s.start > YOTO_LIMITS.trackSeconds;
    }).length;
    if (long) w.push(`${long} chapter(s) over 60 min — Yoto rejects tracks longer than that. Add markers or use "Split ≤60 min".`);
    if (project.duration > YOTO_LIMITS.cardSeconds) w.push(`Total ${fmt(project.duration)} — over the 5 h per-card limit. Split across two cards.`);
    return w;
  }, [project, spans]);

  if (!source) return <p className="text-slate-400">The chapter studio works on a single long file. Load one in Import.</p>;

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-white">{project.title || source.name}</h2>
            <p className="text-sm text-slate-400">
              {fmt(time)} / {fmt(project.duration)} · {project.tracks.length} chapters
            </p>
          </div>
          <button className="btn-primary h-12 w-12 shrink-0 rounded-full p-0" disabled={!ready} onClick={() => ws.current?.playPause()} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} /> : <Play size={20} className="translate-x-px" />}
          </button>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-slate-950/60 ring-1 ring-white/5">
          <div ref={box} className="min-h-[136px]" />
          {(!ready || busy) && (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/70 text-sm text-slate-300">
              <span className="flex items-center gap-2">
                <LoaderCircle size={16} className="animate-spin" />
                {busy ? `${busy.label}${busy.progress != null ? ` ${Math.round(busy.progress * 100)}%` : ''}` : 'Loading audio'}
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn" disabled={!ready} onClick={() => addMarker(ws.current?.getCurrentTime() ?? 0)}>
            <Plus size={16} /> Marker at {fmt(time)}
          </button>
          <button className="btn" disabled={!ready || !!busy} onClick={splitEvenly}>
            <Scissors size={16} /> Split ≤60 min
          </button>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-400">
            <ZoomIn size={16} />
            <input type="range" min={0} max={300} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-28 accent-amber-500" />
          </label>
        </div>
        <p className="mt-2 hidden text-xs text-slate-500 sm:block">Keys: Space play · M marker · ←/→ 5 s · drag markers to fine-tune</p>
      </section>

      <section className="card">
        <h3 className="mb-3 flex items-center gap-2 font-medium text-white">
          <Sparkles size={16} className="text-amber-400" /> Auto-detect from silence
        </h3>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Num label="Noise floor (dB)" value={silence.noiseDb} step={1} onChange={(v) => setSilence({ ...silence, noiseDb: v })} />
          <Num label="Gap ≥ (s)" value={silence.minSilence} step={0.5} onChange={(v) => setSilence({ ...silence, minSilence: v })} />
          <Num label="Chapter ≥ (min)" value={silence.minChapterMin} step={1} onChange={(v) => setSilence({ ...silence, minChapterMin: v })} />
        </div>
        <button className="btn mt-3 w-full" disabled={!ready || !!busy} onClick={runSilence}>
          Detect chapters
        </button>
      </section>

      {(warnings.length > 0 || error) && (
        <section className="space-y-2">
          {[...warnings, ...(error ? [error] : [])].map((w) => (
            <p key={w} className="flex gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200 ring-1 ring-amber-500/20">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </section>
      )}

      <section className="card p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="font-medium text-white">Chapters</h3>
          <button className="text-sm text-amber-400 hover:text-amber-300" onClick={sortByTime}>
            Sort by time
          </button>
        </div>
        <ol className="divide-y divide-white/5">
          {project.tracks.map((t, i) => {
            const s = spans.get(t.id)!;
            const active = time >= s.start && time < s.end;
            return (
              <li key={t.id} className={`flex items-center gap-2 px-4 py-3 ${active ? 'bg-amber-500/5' : ''}`}>
                <button className={`w-7 shrink-0 text-right font-mono text-sm ${active ? 'text-amber-400' : 'text-slate-500'}`} onClick={() => ws.current?.setTime(s.start)}>
                  {i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <input className="field w-full font-medium" value={t.title} onChange={(e) => patch(t.id, { title: e.target.value })} />
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <TimeInput value={t.start} disabled={t.start === 0 && i === project.tracks.findIndex((x) => x.start === 0)} max={project.duration} onCommit={(v) => patch(t.id, { start: v })} />
                    <span>· {fmt(s.end - s.start)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col">
                  <IconBtn label="Up" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={16} /></IconBtn>
                  <IconBtn label="Down" onClick={() => move(i, 1)} disabled={i === project.tracks.length - 1}><ChevronDown size={16} /></IconBtn>
                </div>
                <IconBtn label="Delete" onClick={() => remove(t.id)} disabled={project.tracks.length === 1}><Trash2 size={16} /></IconBtn>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function TimeInput({ value, onCommit, disabled, max }: { value: number; onCommit: (v: number) => void; disabled?: boolean; max: number }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = parseTime(text);
    if (v == null || v < 0 || (max && v >= max)) setText(fmt(value));
    else onCommit(v);
  };
  return (
    <input
      className="w-24 rounded bg-transparent font-mono text-slate-400 outline-none focus:bg-slate-800 focus:text-white disabled:opacity-60"
      value={text}
      disabled={disabled}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Num({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input type="number" className="field mt-1 w-full" value={value} step={step} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function IconBtn({ label, children, ...rest }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button aria-label={label} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-25" {...rest}>
      {children}
    </button>
  );
}
