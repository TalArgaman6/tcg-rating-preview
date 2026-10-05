export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGB = [number, number, number];

export function idx(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

export function read(img: Raster, x: number, y: number): RGB {
  const i = idx(img.width, clamp(x, 0, img.width - 1), clamp(y, 0, img.height - 1));
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

export function colorDist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function medianColor(colors: RGB[]): RGB {
  if (colors.length === 0) return [0, 0, 0];
  return [median(colors.map((c) => c[0])), median(colors.map((c) => c[1])), median(colors.map((c) => c[2]))];
}

export function lumVariance(colors: RGB[]): number {
  if (colors.length === 0) return 0;
  const lums = colors.map((c) => luminance(...c));
  const mean = lums.reduce((sum, n) => sum + n, 0) / lums.length;
  return lums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lums.length;
}

export function crop(img: Raster, rect: { x: number; y: number; w: number; h: number }): Raster {
  const x0 = clamp(Math.round(rect.x), 0, img.width - 1);
  const y0 = clamp(Math.round(rect.y), 0, img.height - 1);
  const w = clamp(Math.round(rect.w), 1, img.width - x0);
  const h = clamp(Math.round(rect.h), 1, img.height - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = idx(img.width, x0 + x, y0 + y);
      const d = idx(w, x, y);
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
      data[d + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

export function blank(width: number, height: number, fill: (x: number, y: number) => RGB): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      const i = idx(width, x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
