import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Copy, Download, Eraser, ImageUp, PaintBucket, Pencil, Trash2 } from 'lucide-react';
import type { Icon, Project } from '../types';
import { blankIcon, floodFill, iconToImageData, iconToPng, imageToIcon, PALETTE, TRANSPARENT } from '../lib/icons';
import { pad2, safeName } from '../lib/time';

type Tool = 'pencil' | 'eraser' | 'fill';

export function IconStudio({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const [sel, setSel] = useState(project.tracks[0]?.id ?? '');
  const track = project.tracks.find((t) => t.id === sel) ?? project.tracks[0];
  if (!track) return <p className="text-slate-400">Import audio first.</p>;
  const index = project.tracks.indexOf(track);

  const setIcon = (id: string, icon: Icon | undefined) =>
    onChange({ ...project, tracks: project.tracks.map((t) => (t.id === id ? { ...t, icon } : t)) });
  const applyToAll = () => {
    if (!track.icon || !confirm('Use this icon for every track?')) return;
    onChange({ ...project, tracks: project.tracks.map((t) => ({ ...t, icon: track.icon!.slice() })) });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section className="card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="truncate font-semibold text-white">
            {index + 1}. {track.title}
          </h2>
          <button className="btn" disabled={!track.icon} onClick={applyToAll}>
            <Copy size={16} /> All tracks
          </button>
        </div>
        <PixelEditor key={track.id} value={track.icon} onChange={(icon) => setIcon(track.id, icon)} name={`${pad2(index + 1)} ${safeName(track.title)}`} />
      </section>

      <section className="card p-2">
        <ol className="grid max-h-[60vh] grid-cols-4 gap-2 overflow-auto p-1 sm:grid-cols-6 lg:grid-cols-4">
          {project.tracks.map((t, i) => (
            <li key={t.id}>
              <button
                onClick={() => setSel(t.id)}
                className={`relative aspect-square w-full overflow-hidden rounded-lg bg-black ring-2 ${t.id === track.id ? 'ring-amber-500' : 'ring-transparent hover:ring-white/20'}`}
                title={t.title}
              >
                {t.icon ? <IconThumb icon={t.icon} /> : <span className="text-xs text-slate-600">{i + 1}</span>}
                <span className="absolute bottom-0 right-1 font-mono text-[10px] text-white/50">{i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function IconThumb({ icon, className = '' }: { icon: Icon; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    ref.current?.getContext('2d')?.putImageData(iconToImageData(icon), 0, 0);
  }, [icon]);
  return <canvas ref={ref} width={16} height={16} className={`pixelated h-full w-full ${className}`} />;
}

function PixelEditor({ value, onChange, name }: { value?: Icon; onChange: (i: Icon | undefined) => void; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState<Icon>(() => value?.slice() ?? blankIcon());
  const [color, setColor] = useState(9);
  const [tool, setTool] = useState<Tool>('pencil');
  const drawing = useRef(false);
  const dirty = useRef(false);
  const latest = useRef(icon);
  latest.current = icon;

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(iconToImageData(icon), 0, 0);
  }, [icon]);

  const commit = (next: Icon) => {
    setIcon(next);
    onChange(next.every((c) => c === TRANSPARENT) ? undefined : next);
  };

  const cellAt = (e: RPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 16);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 16);
    return x < 0 || y < 0 || x > 15 || y > 15 ? -1 : y * 16 + x;
  };

  const paint = (e: RPointerEvent) => {
    const i = cellAt(e);
    if (i < 0) return;
    if (tool === 'fill') {
      commit(floodFill(icon, i, color));
      return;
    }
    const c = tool === 'eraser' ? TRANSPARENT : color;
    if (icon[i] === c) return;
    setIcon((prev) => {
      const next = prev.slice();
      next[i] = c;
      return next;
    });
    dirty.current = true;
  };

  const end = () => {
    drawing.current = false;
    if (dirty.current) {
      dirty.current = false;
      const cur = latest.current;
      onChange(cur.every((c) => c === TRANSPARENT) ? undefined : cur);
    }
  };

  const importImage = async (f?: File) => {
    if (f) commit(await imageToIcon(f));
  };

  const exportPng = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await iconToPng(icon));
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div>
      <div className="mx-auto max-w-[min(100%,420px)]">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
          <canvas
            ref={canvas}
            width={16}
            height={16}
            className="pixelated absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              drawing.current = true;
              paint(e);
            }}
            onPointerMove={(e) => drawing.current && tool !== 'fill' && paint(e)}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <div className="pointer-events-none absolute inset-0 bg-[length:6.25%_6.25%] [background-image:linear-gradient(to_right,rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.06)_1px,transparent_1px)]" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-8 gap-1.5">
        {PALETTE.map((hex, i) => (
          <button
            key={hex}
            aria-label={hex}
            onClick={() => {
              setColor(i);
              if (tool === 'eraser') setTool('pencil');
            }}
            className={`aspect-square rounded-md ring-2 ring-offset-2 ring-offset-slate-900 ${color === i && tool !== 'eraser' ? 'ring-white' : 'ring-transparent'}`}
            style={{ background: hex }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Seg active={tool === 'pencil'} onClick={() => setTool('pencil')}><Pencil size={16} /> Draw</Seg>
        <Seg active={tool === 'fill'} onClick={() => setTool('fill')}><PaintBucket size={16} /> Fill</Seg>
        <Seg active={tool === 'eraser'} onClick={() => setTool('eraser')}><Eraser size={16} /> Erase</Seg>
        <span className="flex-1" />
        <button className="btn" onClick={() => file.current?.click()}><ImageUp size={16} /> Import</button>
        <button className="btn" onClick={exportPng}><Download size={16} /> PNG</button>
        <button className="btn" onClick={() => commit(blankIcon())}><Trash2 size={16} /></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => importImage(e.target.files?.[0])} />
      </div>
    </div>
  );
}

function Seg({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`btn ${active ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : ''}`}>
      {children}
    </button>
  );
}
