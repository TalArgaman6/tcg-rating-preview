import Tesseract from "tesseract.js";
import { rasterToCanvas } from "../images";
import { locateCard } from "../vision/analyze";
import { crop, type Raster } from "../vision/raster";

let workerPromise: Promise<Tesseract.Worker> | null = null;

export async function readCardText(photo: Raster): Promise<{ name: string | null; number: string | null; raw: string }> {
  const engine = await getWorker();
  const frame = cardFrame(photo);
  const header = crop(frame, { x: frame.width * 0.03, y: 0, w: frame.width * 0.94, h: frame.height * 0.24 });
  const footer = crop(frame, { x: frame.width * 0.08, y: frame.height * 0.8, w: frame.width * 0.88, h: frame.height * 0.18 });
  await engine.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
  const nameResult = await engine.recognize(prepareForReading(header));
  const numberResult = await engine.recognize(prepareForReading(footer));
  const raw = `${nameResult.data.text}\n${numberResult.data.text}`.trim();
  return {
    name: pickCardName(nameResult.data.text),
    number: cleanNumber(`${numberResult.data.text}\n${nameResult.data.text}`),
    raw,
  };
}

/** The name line on a Pokémon card, ignoring the evolution label above it. */
export function pickCardName(text: string): string | null {
  const lines = text
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line.length >= 3 && line.length <= 32 && /[A-Za-z]{3,}/.test(line));
  const names = lines.filter((line) => !isLabel(line)).map(keepTitleWords);
  if (names.length === 0) return null;
  return names.sort((a, b) => nameScore(b) - nameScore(a))[0];
}

function keepTitleWords(line: string): string {
  const words = line.split(" ");
  const titled = words.filter((word) => /^[A-Z]/.test(word) && /[A-Za-z]{3,}/.test(word));
  if (titled.length > 0 && titled.length < words.length) return titled.join(" ");
  return line;
}

function cardFrame(photo: Raster): Raster {
  const rect = locateCard(photo).rect;
  const padX = Math.round(rect.w * 0.08);
  const padTop = Math.round(rect.h * 0.2);
  const padBottom = Math.round(rect.h * 0.08);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padTop);
  const right = Math.min(photo.width, rect.x + rect.w + padX);
  const bottom = Math.min(photo.height, rect.y + rect.h + padBottom);
  return crop(photo, { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) });
}

function prepareForReading(raster: Raster): HTMLCanvasElement {
  const scale = raster.height < 240 ? Math.max(2, Math.ceil(240 / raster.height)) : 2;
  const canvas = document.createElement("canvas");
  canvas.width = raster.width * scale;
  canvas.height = raster.height * scale;
  const context = canvas.getContext("2d");
  if (!context) return rasterToCanvas(raster);
  context.imageSmoothingEnabled = true;
  context.filter = "grayscale(1) contrast(1.85)";
  context.drawImage(rasterToCanvas(raster), 0, 0, canvas.width, canvas.height);
  return canvas;
}

function normalizeLine(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z' .-]/g, " ")
    .replace(/\bhp\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLabel(line: string): boolean {
  const words = line.toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0) return true;
  if (words.every((word) => LABEL_WORDS.has(word))) return true;
  if (/^stage\s*[12]$/i.test(line)) return true;
  if (/^basic\b/i.test(line) && /pokemon/i.test(line)) return true;
  if (/^evolves\b/i.test(line)) return true;
  return false;
}

function nameScore(line: string): number {
  const letters = line.replace(/[^A-Za-z]/g, "").length;
  const words = line.split(" ").length;
  return letters + (words > 1 && words < 5 ? 2 : 0);
}

const LABEL_WORDS = new Set([
  "basic",
  "stage",
  "pokemon",
  "trainer",
  "energy",
  "item",
  "supporter",
  "stadium",
  "tool",
  "from",
  "evolves",
  "lv",
  "hp",
]);

function cleanNumber(text: string): string | null {
  const match = text.match(/(\d{1,3})\s*[/|lI]\s*(\d{2,3})/);
  if (!match) return null;
  return `${Number(match[1])}/${Number(match[2])}`;
}

function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng").catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}
