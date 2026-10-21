import type { Project } from '../types';

export function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Accepts "ss", "m:ss(.s)", "h:mm:ss(.s)". */
export function parseTime(t: string): number | null {
  const parts = t.trim().split(':');
  if (!parts.length || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    const n = Number(p);
    if (p === '' || Number.isNaN(n) || n < 0) return null;
    total = total * 60 + n;
  }
  return total;
}

/** Time span per track in source mode: a track runs until the next marker in time order. */
export function segments(p: Project): Map<string, { start: number; end: number }> {
  const byTime = [...p.tracks].sort((a, b) => a.start - b.start);
  const map = new Map<string, { start: number; end: number }>();
  byTime.forEach((t, i) => map.set(t.id, { start: t.start, end: byTime[i + 1]?.start ?? p.duration }));
  return map;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const safeName = (s: string) =>
  s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Track';

export const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** "03 - Some Song" / "Track 03" → "Some Song". */
export const cleanTitle = (name: string) =>
  stem(name).replace(/^\s*(track\s*)?\d+\s*[-._)]?\s*/i, '').trim() || stem(name);
