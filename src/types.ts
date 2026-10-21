/** 256 palette indices (row-major 16×16). 255 = transparent. */
export type Icon = Uint8Array;

export interface Track {
  id: string;
  title: string;
  /** Start offset (s) inside `Project.source`. Ignored in file mode. */
  start: number;
  /** File mode: each track is its own file (CD rips, folders of MP3s). */
  file?: File;
  icon?: Icon;
}

export interface Project {
  title: string;
  artist: string;
  /** Source mode: one long file split by markers. */
  source?: File;
  /** Codec reported by ffmpeg for the source, e.g. "mp3", "aac". */
  codec?: string;
  duration: number;
  /** Playlist order. */
  tracks: Track[];
}

export interface Output {
  trackId: string;
  trackNo: number;
  title: string;
  name: string;
  blob: Blob;
}

/** Yoto MYO limits (support.yotoplay.com). */
export const YOTO_LIMITS = { tracks: 100, trackSeconds: 3600, trackBytes: 100e6, cardSeconds: 5 * 3600, cardBytes: 500e6 };

export const uid = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2);
