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
  if (mode === "frost") {
    context.globalAlpha = 0.5;
    context.drawImage(source, 0, 0);
  }
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


