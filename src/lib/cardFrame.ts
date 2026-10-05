import { rasterToCanvas } from "./images";
import { colorDist, crop, medianColor, read, type Raster, type RGB } from "./vision/raster";

/** A Pokémon card is 63mm wide and 88mm tall. */
export const CARD_RATIO = 63 / 88;

export function frameCard(source: Raster): Raster {
  const subject = findSubject(source) ?? { x: 0, y: 0, w: source.width, h: source.height };
  return crop(source, fitRatio(subject, CARD_RATIO));
}

export function renderPlate(raster: Raster, mode: "crop" | "frost"): string {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not draw the card.");
  const source = rasterToCanvas(raster);
  if (mode === "frost") paintGlass(context, source, raster.width, raster.height);
  else context.drawImage(source, 0, 0);
  return canvas.toDataURL("image/png");
}

function findSubject(img: Raster): { x: number; y: number; w: number; h: number } | null {
  const background = cornerColor(img);
  if (!background) return null;
  const left = firstBreak(img, background, "left");
  const right = firstBreak(img, background, "right");
  const top = firstBreak(img, background, "top");
  const bottom = firstBreak(img, background, "bottom");
  const inset = Math.min(left / img.width, right / img.width, top / img.height, bottom / img.height);
  if (inset < 0.07) return null;
  const w = img.width - left - right;
  const h = img.height - top - bottom;
  if (w < img.width * 0.35 || h < img.height * 0.35) return null;
  return { x: left, y: top, w, h };
}

function cornerColor(img: Raster): RGB | null {
  const points = [
    read(img, 2, 2),
    read(img, img.width - 3, 2),
    read(img, 2, img.height - 3),
    read(img, img.width - 3, img.height - 3),
  ];
  const background = medianColor(points);
  if (points.some((point) => colorDist(point, background) > 26)) return null;
  return background;
}

function firstBreak(img: Raster, background: RGB, side: "left" | "right" | "top" | "bottom"): number {
  const horizontal = side === "left" || side === "right";
  const limit = horizontal ? img.width : img.height;
  const span = horizontal ? img.height : img.width;
  const maxScan = Math.floor(limit * 0.46);
  for (let i = 1; i < maxScan; i += 1) {
    let different = 0;
    let seen = 0;
    for (let t = 0.15; t <= 0.85; t += 0.1) {
      const along = Math.round(t * (span - 1));
      const x = side === "left" ? i : side === "right" ? img.width - 1 - i : along;
      const y = side === "top" ? i : side === "bottom" ? img.height - 1 - i : along;
      seen += 1;
      if (colorDist(read(img, x, y), background) > 34) different += 1;
    }
    if (different / seen > 0.55) return i;
  }
  return 0;
}

function fitRatio(
  rect: { x: number; y: number; w: number; h: number },
  ratio: number,
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = rect;
  const current = w / h;
  if (current > ratio) {
    const next = h * ratio;
    x += (w - next) / 2;
    w = next;
  } else if (current < ratio) {
    const next = w / ratio;
    y += (h - next) / 2;
    h = next;
  }
  return { x, y, w, h };
}

function paintGlass(context: CanvasRenderingContext2D, source: HTMLCanvasElement, width: number, height: number): void {
  const veil = context.createLinearGradient(0, 0, width * 0.2, height);
  veil.addColorStop(0, "rgba(255,255,255,0.16)");
  veil.addColorStop(0.5, "rgba(255,255,255,0.04)");
  veil.addColorStop(1, "rgba(214,226,255,0.08)");
  context.fillStyle = veil;
  context.fillRect(0, 0, width, height);

  const lip = context.createLinearGradient(0, 0, 0, height * 0.18);
  lip.addColorStop(0, "rgba(255,255,255,0.28)");
  lip.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = lip;
  context.fillRect(0, 0, width, height * 0.18);

  const lines = whiteDrawing(source, width, height);
  if (lines) context.drawImage(lines, 0, 0);
}

function whiteDrawing(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement | null {
  const smallWidth = 240;
  const smallHeight = Math.max(1, Math.round(height * (smallWidth / width)));
  const sample = document.createElement("canvas");
  sample.width = smallWidth;
  sample.height = smallHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return null;
  sampleContext.filter = "grayscale(1) contrast(1.4) blur(0.4px)";
  sampleContext.drawImage(source, 0, 0, smallWidth, smallHeight);
  const pixels = sampleContext.getImageData(0, 0, smallWidth, smallHeight).data;
  const lines = document.createElement("canvas");
  lines.width = smallWidth;
  lines.height = smallHeight;
  const lineContext = lines.getContext("2d");
  if (!lineContext) return null;
  const image = lineContext.createImageData(smallWidth, smallHeight);
  const edge = image.data;
  const stride = smallWidth * 4;
  for (let y = 1; y < smallHeight - 1; y += 1) {
    for (let x = 1; x < smallWidth - 1; x += 1) {
      const i = y * stride + x * 4;
      const strength = Math.abs(pixels[i] - pixels[i + 4]) + Math.abs(pixels[i] - pixels[i + stride]);
      if (strength < 48) continue;
      edge[i] = 255;
      edge[i + 1] = 255;
      edge[i + 2] = 255;
      edge[i + 3] = 255;
    }
  }
  lineContext.putImageData(image, 0, 0);

  const plate = document.createElement("canvas");
  plate.width = width;
  plate.height = height;
  const plateContext = plate.getContext("2d");
  if (!plateContext) return null;
  plateContext.imageSmoothingEnabled = true;
  plateContext.drawImage(lines, 0, 0, width, height);
  const painted = plateContext.getImageData(0, 0, width, height);
  const ink = painted.data;
  for (let i = 0; i < ink.length; i += 4) {
    if (ink[i + 3] < 28) {
      ink[i + 3] = 0;
      continue;
    }
    ink[i] = 255;
    ink[i + 1] = 255;
    ink[i + 2] = 255;
    ink[i + 3] = 235;
  }
  plateContext.putImageData(painted, 0, 0);
  return plate;
}
