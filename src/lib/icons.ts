import type { Icon } from '../types';

export const TRANSPARENT = 255;

/** 16-colour palette tuned for the player's small LED matrix (high saturation, distinct at 16×16). */
export const PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
] as const;

const RGB = PALETTE.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

export const blankIcon = (): Icon => new Uint8Array(256).fill(TRANSPARENT);

export function nearest(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  RGB.forEach(([pr, pg, pb], i) => {
    // weighted RGB distance (cheap perceptual approximation)
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function iconToImageData(icon: Icon): ImageData {
  const img = new ImageData(16, 16);
  icon.forEach((c, i) => {
    if (c === TRANSPARENT) return;
    const [r, g, b] = RGB[c];
    img.data.set([r, g, b, 255], i * 4);
  });
  return img;
}

export function iconToPng(icon: Icon): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d')!.putImageData(iconToImageData(icon), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
}

/** Any image → 16×16 palette icon. Pixel art stays crisp; photos are averaged down. */
export async function imageToIcon(src: Blob): Promise<Icon> {
  const bmp = await createImageBitmap(src);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = bmp.width > 32;
  ctx.imageSmoothingQuality = 'high';
  const side = Math.min(bmp.width, bmp.height); // centre-crop to square
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 16, 16);
  const { data } = ctx.getImageData(0, 0, 16, 16);
  const icon = blankIcon();
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
    icon[i] = a < 128 ? TRANSPARENT : nearest(r, g, b);
  }
  return icon;
}

export function floodFill(icon: Icon, idx: number, color: number): Icon {
  const out = icon.slice();
  const target = out[idx];
  if (target === color) return out;
  const stack = [idx];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] !== target) continue;
    out[i] = color;
    const x = i % 16;
    if (x > 0) stack.push(i - 1);
    if (x < 15) stack.push(i + 1);
    if (i >= 16) stack.push(i - 16);
    if (i < 240) stack.push(i + 16);
  }
  return out;
}
