import Tesseract from "tesseract.js";
import { rasterToCanvas } from "../images";
import { crop, type Raster } from "../vision/raster";

let workerPromise: Promise<Tesseract.Worker> | null = null;

export async function readCardText(card: Raster): Promise<{ name: string | null; number: string | null; raw: string }> {
  const engine = await getWorker();
  const top = crop(card, { x: card.width * 0.06, y: card.height * 0.015, w: card.width * 0.78, h: card.height * 0.14 });
  const bottom = crop(card, { x: card.width * 0.28, y: card.height * 0.86, w: card.width * 0.68, h: card.height * 0.12 });
  await engine.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
  const nameResult = await engine.recognize(rasterToCanvas(top));
  const numberResult = await engine.recognize(rasterToCanvas(bottom));
  const raw = `${nameResult.data.text}\n${numberResult.data.text}`.trim();
  return { name: cleanName(nameResult.data.text), number: cleanNumber(`${numberResult.data.text}\n${nameResult.data.text}`), raw };
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

function cleanName(text: string): string | null {
  const line = text
    .split("\n")
    .map((part) => part.replace(/[^A-Za-z' .-]/g, " ").replace(/\s+/g, " ").trim())
    .find((part) => /[A-Za-z]{3,}/.test(part));
  if (!line || line.length < 3 || line.length > 28) return null;
  const lower = line.toLowerCase();
  if (["pokemon", "basic", "stage", "trainer", "energy", "item"].some((word) => lower === word)) return null;
  return line;
}

function cleanNumber(text: string): string | null {
  const match = text.match(/(\d{1,3})\s*[/|lI]\s*(\d{2,3})/);
  if (!match) return null;
  return `${Number(match[1])}/${Number(match[2])}`;
}
