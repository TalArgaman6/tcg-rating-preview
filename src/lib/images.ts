import type { Raster } from "./vision/raster";

export async function fileToRaster(file: File, maxEdge = 1400): Promise<Raster> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser could not read the image.");
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return { width, height, data: image.data };
  } finally {
    bitmap.close();
  }
}

export function rasterToDataUrl(raster: Raster): string {
  const canvas = rasterToCanvas(raster);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function rasterToCanvas(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not draw the card.");
  const copy = new Uint8ClampedArray(raster.data);
  context.putImageData(new ImageData(copy, raster.width, raster.height), 0, 0);
  return canvas;
}
