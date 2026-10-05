import type {
  CloseupKind,
  CloseupResult,
  CornerRead,
  Defect,
  EdgeRead,
  Severity,
  SideMetrics,
  SideName,
  SurfaceRead,
} from "../../types";
import {
  colorDist,
  crop,
  luminance,
  lumVariance,
  median,
  medianColor,
  read,
  saturation,
  type Raster,
  type RGB,
} from "./raster";

export interface CardVision {
  rectified: Raster;
  metrics: SideMetrics;
  defects: Defect[];
}

export interface LocateResult {
  rect: { x: number; y: number; w: number; h: number };
  fill: "cropped-margin" | "edge-to-edge";
  perspective: boolean;
}

const SIDE_SAMPLES = [0.22, 0.36, 0.5, 0.64, 0.78];

export function locateCard(img: Raster): LocateResult {
  const left = edgeInsets(img, "left");
  const right = edgeInsets(img, "right");
  const top = edgeInsets(img, "top");
  const bottom = edgeInsets(img, "bottom");

  const x = median(left.map((sample) => sample.inset));
  const y = median(top.map((sample) => sample.inset));
  const rightInset = median(right.map((sample) => sample.inset));
  const bottomInset = median(bottom.map((sample) => sample.inset));

  const useLeft = shouldCrop(left, img.width);
  const useRight = shouldCrop(right, img.width);
  const useTop = shouldCrop(top, img.height);
  const useBottom = shouldCrop(bottom, img.height);

  const rect = {
    x: useLeft ? x : 0,
    y: useTop ? y : 0,
    w: img.width - (useLeft ? x : 0) - (useRight ? rightInset : 0),
    h: img.height - (useTop ? y : 0) - (useBottom ? bottomInset : 0),
  };

  const cropped = useLeft || useRight || useTop || useBottom;
  const perspective =
    spread(left.map((sample) => sample.inset)) > img.width * 0.035 ||
    spread(right.map((sample) => sample.inset)) > img.width * 0.035 ||
    spread(top.map((sample) => sample.inset)) > img.height * 0.035 ||
    spread(bottom.map((sample) => sample.inset)) > img.height * 0.035;

  if (rect.w < img.width * 0.35 || rect.h < img.height * 0.35) {
    return {
      rect: { x: 0, y: 0, w: img.width, h: img.height },
      fill: "edge-to-edge",
      perspective: true,
    };
  }

  return {
    rect,
    fill: cropped ? "cropped-margin" : "edge-to-edge",
    perspective,
  };
}

export function analyzeRaster(
  source: Raster,
  options?: { shortSide?: number; side?: SideName },
): CardVision {
  const located = locateCard(source);
  const rectified = crop(source, located.rect);
  const borders = measureBorders(rectified);
  const corners = measureCorners(rectified, borders);
  const edges = measureEdges(rectified, borders);
  const surface = measureSurface(rectified, borders);
  const quality = measureQuality(rectified, located, options?.shortSide ?? Math.min(rectified.width, rectified.height));
  const side = options?.side ?? "front";
  const defects = collectDefects(side, rectified, borders, corners, edges, surface, quality);

  if (quality.focus === "poor") {
    const kept = defects.filter((defect) => defect.severity !== "speck" && defect.kind !== "print-spot");
    defects.length = 0;
    defects.push(...kept);
  }

  const metrics: SideMetrics = {
    centering: borders,
    corners,
    edges,
    surface,
    quality,
  };
  return { rectified, metrics, defects };
}

interface BorderMeasure {
  reliable: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  leftRight: number;
  topBottom: number;
  note?: string;
  color: RGB;
}

function measureBorders(card: Raster): BorderMeasure {
  const left = borderWidth(card, "left");
  const right = borderWidth(card, "right");
  const top = borderWidth(card, "top");
  const bottom = borderWidth(card, "bottom");
  const widths = [left.width, right.width, top.width, bottom.width];
  const colors = [left.color, right.color, top.color, bottom.color];
  const colorSpread = Math.max(
    colorDist(colors[0], colors[1]),
    colorDist(colors[0], colors[2]),
    colorDist(colors[1], colors[3]),
  );
  const tooThin = widths.some((width) => width < card.width * 0.012);
  const tooThick = widths.some(
    (width, index) => width > (index < 2 ? card.width : card.height) * 0.16,
  );
  const unstable = [left, right, top, bottom].some((side) => side.spread > Math.max(6, side.width * 0.45));
  const noisy = [left, right, top, bottom].some((side) => side.variance > 420);
  let reliable = !tooThin && !tooThick && !unstable && !noisy && colorSpread < 78;
  let note: string | undefined;
  if (!reliable) {
    note =
      "The border is not a clean, even frame in this photo, so centering is not reliable. Full-art cards, busy edges, and tilted shots cause that.";
  }
  const lrTotal = left.width + right.width;
  const tbTotal = top.width + bottom.width;
  const leftShare = lrTotal > 0 ? left.width / lrTotal : 0.5;
  const topShare = tbTotal > 0 ? top.width / tbTotal : 0.5;
  return {
    reliable,
    left: left.width,
    right: right.width,
    top: top.width,
    bottom: bottom.width,
    leftRight: Math.max(leftShare, 1 - leftShare),
    topBottom: Math.max(topShare, 1 - topShare),
    note,
    color: medianColor(colors),
  };
}

function measureCorners(card: Raster, borders: BorderMeasure): CornerRead[] {
  const names = ["tl", "tr", "bl", "br"] as const;
  return names.map((corner) => {
    const box = cornerBox(card, borders, corner);
    let white = 0;
    let total = 0;
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        if (!inBorder(x, y, card, borders)) continue;
        total += 1;
        if (isWhitening(read(card, x, y), borders.color)) white += 1;
      }
    }
    const fraction = total > 0 ? white / total : 0;
    return { corner, fraction, severity: whiteningSeverity(fraction, total) };
  });
}

function measureEdges(card: Raster, borders: BorderMeasure): EdgeRead[] {
  const names = ["top", "right", "bottom", "left"] as const;
  return names.map((edge) => {
    const points = edgeSamples(card, edge);
    let white = 0;
    let run = 0;
    let maxRun = 0;
    for (const point of points) {
      const hit = isWhitening(read(card, point.x, point.y), borders.color);
      if (hit) {
        white += 1;
        run += 1;
        maxRun = Math.max(maxRun, run);
      } else {
        run = 0;
      }
    }
    const fraction = points.length > 0 ? white / points.length : 0;
    let severity: Severity = "none";
    const span = edge === "left" || edge === "right" ? card.height : card.width;
    if (maxRun >= 6 && fraction >= 0.012) {
      if (maxRun > span * 0.12 || fraction > 0.16) severity = "heavy";
      else if (maxRun > span * 0.045 || fraction > 0.06) severity = "moderate";
      else severity = "minor";
    }
    return { edge, severity, fraction, run: maxRun };
  });
}

function measureSurface(card: Raster, borders: BorderMeasure): SurfaceRead {
  const inner = innerRect(card, borders);
  if (inner.w < 40 || inner.h < 40) {
    return {
      reliable: false,
      holoLimited: false,
      glareFraction: 0,
      printLines: 0,
      scratches: 0,
      spots: 0,
      crease: "none",
      note: "The inner image is too small in this photo to score the surface.",
    };
  }

  const gray = new Float32Array(inner.w * inner.h);
  let glare = 0;
  for (let y = 0; y < inner.h; y += 1) {
    for (let x = 0; x < inner.w; x += 1) {
      const [r, g, b] = read(card, inner.x + x, inner.y + y);
      gray[y * inner.w + x] = luminance(r, g, b);
      if (luminance(r, g, b) > 246 && saturation(r, g, b) < 0.08) glare += 1;
    }
  }
  const glareFraction = glare / (inner.w * inner.h);
  const residual = highPass(gray, inner.w, inner.h, 2);
  let busy = 0;
  for (let i = 0; i < residual.length; i += 1) {
    if (Math.abs(residual[i]) > 20) busy += 1;
  }
  const busyFraction = busy / residual.length;
  const holoLimited = busyFraction > 0.14;

  const printLines = countPrintLines(gray, inner.w, inner.h, holoLimited);
  const crease = detectCrease(gray, inner.w, inner.h, holoLimited);
  const scratches = holoLimited ? 0 : countLongResiduals(residual, inner.w, inner.h, printLines);
  const spots = holoLimited || glareFraction > 0.08 ? 0 : countSpots(card, inner);

  const reliable = glareFraction < 0.12 && !holoLimited;
  let note: string | undefined;
  if (holoLimited) {
    note =
      "The inner image is visually busy, which is common on holofoil. Sparkle was not counted as scratches. Only long, straight marks were kept.";
  } else if (glareFraction >= 0.05) {
    note = "Glare covers part of the surface. Those pixels were not treated as damage, and the surface grade is less certain.";
  }

  return {
    reliable,
    holoLimited,
    glareFraction,
    printLines,
    scratches,
    spots,
    crease,
    note,
  };
}

function measureQuality(
  card: Raster,
  located: LocateResult,
  shortSide: number,
): SideMetrics["quality"] {
  const focusScore = edgeAcutance(card);
  const focus = focusScore < 8 ? "poor" : focusScore < 16 ? "soft" : "sharp";
  const notes: string[] = [];
  if (focus === "poor") notes.push("The photo is soft, so small corner and surface marks are not trustworthy.");
  if (focus === "soft") notes.push("Focus is only fair. Micro-scratches and corner tips are easy to miss.");
  if (shortSide < 700) notes.push("The card is small in the photo. Corner wear needs a closer shot.");
  if (located.perspective) notes.push("The card edges are not square to the camera, so measurements can shift.");
  if (located.fill === "edge-to-edge") {
    notes.push("No table margin was found, so the photo edges were treated as the card edges.");
  }
  return {
    shortSide,
    focus,
    perspective: located.perspective,
    fill: located.fill,
    notes,
  };
}

function collectDefects(
  side: SideName,
  card: Raster,
  borders: BorderMeasure,
  corners: CornerRead[],
  edges: EdgeRead[],
  surface: SurfaceRead,
  quality: SideMetrics["quality"],
): Defect[] {
  const defects: Defect[] = [];
  const uncertain = !borders.reliable || quality.focus !== "sharp";
  const cornerName: Record<CornerRead["corner"], string> = {
    tl: "top-left",
    tr: "top-right",
    bl: "bottom-left",
    br: "bottom-right",
  };
  for (const corner of corners) {
    if (corner.severity === "none") continue;
    const box = cornerBox(card, borders, corner.corner);
    defects.push({
      id: `${side}-corner-${corner.corner}`,
      side,
      kind: "corner",
      severity: corner.severity === "speck" ? "speck" : corner.severity,
      x: box.x / card.width,
      y: box.y / card.height,
      w: box.w / card.width,
      h: box.h / card.height,
      title: `${capitalize(cornerName[corner.corner])} corner whitening`,
      detail: `${Math.round(corner.fraction * 100)}% of the border in this corner is lighter and less saturated than the surrounding border.`,
      gradeImpact: cornerImpact(corner.severity),
      confidence: uncertain ? 0.46 : corner.severity === "speck" ? 0.58 : 0.74,
      evidence: uncertain ? "uncertain" : "visible",
    });
  }

  const edgeName: Record<EdgeRead["edge"], string> = {
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
  };
  for (const edge of edges) {
    if (edge.severity === "none") continue;
    const box = edgeBox(card, borders, edge.edge);
    defects.push({
      id: `${side}-edge-${edge.edge}`,
      side,
      kind: "edge",
      severity: edge.severity,
      x: box.x / card.width,
      y: box.y / card.height,
      w: box.w / card.width,
      h: box.h / card.height,
      title: `${capitalize(edgeName[edge.edge])} edge whitening`,
      detail: `A light run about ${edge.run}px long sits on the ${edgeName[edge.edge]} border.`,
      gradeImpact:
        "Edge chipping and whitening are handling wear. A visible run is enough to miss a gem mint at PSA, Beckett, and CGC, all of which expect essentially clean edges at the top of the scale.",
      confidence: uncertain ? 0.48 : 0.7,
      evidence: uncertain ? "uncertain" : "visible",
    });
  }

  if (surface.glareFraction > 0.04) {
    defects.push({
      id: `${side}-glare`,
      side,
      kind: "glare",
      severity: "info",
      x: 0.2,
      y: 0.2,
      w: 0.6,
      h: 0.6,
      title: "Glare on the surface",
      detail: `${Math.round(surface.glareFraction * 100)}% of the inner image is blown out. That area was not scored as damage.`,
      gradeImpact: "Glare hides scratches and print lines. It lowers confidence and is not itself a defect.",
      confidence: 0.66,
      evidence: "visible",
    });
  }

  if (surface.printLines > 0) {
    defects.push({
      id: `${side}-print-line`,
      side,
      kind: "print-line",
      severity: surface.printLines > 1 ? "moderate" : "minor",
      x: 0.12,
      y: 0.48,
      w: 0.76,
      h: 0.04,
      title: surface.printLines === 1 ? "Print line" : `${surface.printLines} print lines`,
      detail:
        "A thin, straight tone change runs across the inner image. That pattern fits a factory print line better than a scratch.",
      gradeImpact:
        "Beckett's published Gem Mint 9.5 surface does not allow metallic print lines. A Mint 9 may allow one faint line. PSA can allow a slight print flaw on a Gem Mint 10 only when it does not hurt eye appeal, so a line the photo can see usually costs the 10. Ordinary print lines are not a valuable misprint.",
      confidence: surface.holoLimited ? 0.42 : 0.64,
      evidence: surface.holoLimited ? "uncertain" : "visible",
    });
  }

  if (surface.scratches > 0) {
    defects.push({
      id: `${side}-scratch`,
      side,
      kind: "scratch",
      severity: surface.scratches > 1 ? "moderate" : "minor",
      x: 0.3,
      y: 0.34,
      w: 0.28,
      h: 0.08,
      title: surface.scratches === 1 ? "Possible surface scratch" : "Possible surface scratches",
      detail: `${surface.scratches} elongated mark${surface.scratches === 1 ? "" : "s"} in the inner image, separate from a full-width print line.`,
      gradeImpact:
        "A scratch breaks original gloss. PSA Gem Mint 10 calls for full original gloss, and Beckett's 9.5 surface standard is devoid of scratches. One light scratch the photo can already see usually lands at a mint or below, not a pristine grade.",
      confidence: 0.5,
      evidence: "uncertain",
    });
  }

  if (surface.crease !== "none") {
    const heavy = surface.crease === "heavy" || surface.crease === "moderate";
    defects.push({
      id: `${side}-crease`,
      side,
      kind: heavy ? "fold" : "crease",
      severity: heavy ? "heavy" : "moderate",
      x: 0.08,
      y: 0.3,
      w: 0.84,
      h: 0.12,
      title: surface.crease === "light" ? "Possible light crease" : "Crease or fold",
      detail: `A broad linear band crosses the inner image (${surface.crease}).`,
      gradeImpact:
        "A crease is structural wear. On CGC's scale a light crease fits the VG-EX range, around 4 to 4.5, and a crease that travels the card fits Good. PSA and Beckett also keep creased cards well out of mint. This is damage, not a printing error.",
      confidence: surface.crease === "light" ? 0.48 : 0.7,
      evidence: surface.crease === "light" ? "uncertain" : "visible",
    });
  }

  if (surface.spots > 0) {
    defects.push({
      id: `${side}-spot`,
      side,
      kind: "print-spot",
      severity: "minor",
      x: 0.42,
      y: 0.42,
      w: 0.12,
      h: 0.1,
      title: surface.spots === 1 ? "Discoloration spot" : "Discoloration spots",
      detail:
        "A compact patch does not match the surrounding ink. The photo cannot tell a print spot from a stain or a compression artifact.",
      gradeImpact:
        "PSA Mint 9 allows one minor printing imperfection. Several spots, or a stain, pull the card lower. This was not treated as a valuable error.",
      confidence: 0.4,
      evidence: "uncertain",
    });
  }

  return defects;
}

function cornerImpact(severity: Severity): string {
  if (severity === "speck") {
    return "A single speck can fit Beckett's Mint 9 corners, which allow a speck under scrutiny, and it is already more than PSA's perfectly sharp Gem Mint 10 corners. It is not, by itself, a reason to leave the 8–9 range.";
  }
  if (severity === "minor") {
    return "Whitening the photo can see is real corner wear. PSA's Mint 9 wording allows one minor flaw such as a print speck or slightly off-white border, not fuzzy corners. This fits near mint-mint more than gem mint.";
  }
  if (severity === "moderate") {
    return "Corner wear on more than a speck fails mint standards at all three companies. CGC's Near Mint grades are where touched corners start to be described directly.";
  }
  return "Heavy whitening or a soft corner is serious handling wear and keeps the card out of every near-mint grade.";
}

function edgeInsets(img: Raster, side: "left" | "right" | "top" | "bottom"): { inset: number; insideBusy: boolean }[] {
  const horizontal = side === "left" || side === "right";
  const limit = horizontal ? img.width : img.height;
  const span = horizontal ? img.height : img.width;
  return SIDE_SAMPLES.map((t) => {
    const start = sampleAt(img, side, t, 1);
    let inset = 0;
    let run = 0;
    const maxScan = Math.floor(limit * 0.46);
    for (let i = 2; i < maxScan; i += 1) {
      const color = sampleAt(img, side, t, i);
      if (colorDist(start, color) > 40) {
        run += 1;
        if (run >= 3) {
          inset = i - 2;
          break;
        }
      } else {
        run = 0;
      }
    }
    const probe = Math.min(limit - 2, inset + Math.max(6, Math.round(limit * 0.03)));
    const colors: RGB[] = [];
    for (let delta = -2; delta <= 2; delta += 1) {
      const along = clamp(Math.round(t * span) + delta * 3, 1, span - 2);
      colors.push(sampleAlong(img, side, along, probe));
    }
    return { inset, insideBusy: lumVariance(colors) > 220 };
  });
}

function shouldCrop(samples: { inset: number; insideBusy: boolean }[], span: number): boolean {
  const inset = median(samples.map((sample) => sample.inset));
  const busyVotes = samples.filter((sample) => sample.insideBusy).length;
  const insideBusy = busyVotes >= 3;
  if (inset < 3) return false;
  if (inset > span * 0.4) return false;
  return !insideBusy;
}

function borderWidth(card: Raster, side: "left" | "right" | "top" | "bottom"): {
  width: number;
  color: RGB;
  variance: number;
  spread: number;
} {
  const horizontal = side === "left" || side === "right";
  const span = horizontal ? card.height : card.width;
  const limit = horizontal ? card.width : card.height;
  const widths: number[] = [];
  const colors: RGB[] = [];
  for (const t of SIDE_SAMPLES) {
    const along = Math.round(t * (span - 1));
    const edgeColors: RGB[] = [];
    for (let i = 2; i <= 5; i += 1) edgeColors.push(sampleAlong(card, side, along, i));
    const edge = medianColor(edgeColors);
    colors.push(...edgeColors);
    let width = Math.round(limit * 0.06);
    let run = 0;
    const maxScan = Math.floor(limit * 0.2);
    for (let i = 3; i < maxScan; i += 1) {
      if (colorDist(edge, sampleAlong(card, side, along, i)) > 38) {
        run += 1;
        if (run >= 3) {
          width = i - 2;
          break;
        }
      } else {
        run = 0;
      }
    }
    widths.push(width);
  }
  return {
    width: Math.round(median(widths)),
    color: medianColor(colors),
    variance: lumVariance(colors),
    spread: spread(widths),
  };
}

function sampleAt(img: Raster, side: "left" | "right" | "top" | "bottom", t: number, inset: number): RGB {
  const along = side === "left" || side === "right" ? Math.round(t * (img.height - 1)) : Math.round(t * (img.width - 1));
  return sampleAlong(img, side, along, inset);
}

function sampleAlong(img: Raster, side: "left" | "right" | "top" | "bottom", along: number, inset: number): RGB {
  if (side === "left") return read(img, inset, along);
  if (side === "right") return read(img, img.width - 1 - inset, along);
  if (side === "top") return read(img, along, inset);
  return read(img, along, img.height - 1 - inset);
}

function cornerBox(card: Raster, borders: BorderMeasure, corner: CornerRead["corner"]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const border = Math.max(borders.left, borders.right, borders.top, borders.bottom, 8);
  const size = clamp(Math.round(border * 2.4), 14, Math.round(Math.min(card.width, card.height) * 0.16));
  const x = corner === "tl" || corner === "bl" ? 0 : card.width - size;
  const y = corner === "tl" || corner === "tr" ? 0 : card.height - size;
  return { x, y, w: size, h: size };
}

function edgeBox(card: Raster, borders: BorderMeasure, edge: EdgeRead["edge"]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const depth = Math.max(6, Math.round((edge === "left" ? borders.left : edge === "right" ? borders.right : edge === "top" ? borders.top : borders.bottom) * 0.7));
  if (edge === "top") return { x: card.width * 0.12, y: 0, w: card.width * 0.76, h: depth };
  if (edge === "bottom") return { x: card.width * 0.12, y: card.height - depth, w: card.width * 0.76, h: depth };
  if (edge === "left") return { x: 0, y: card.height * 0.12, w: depth, h: card.height * 0.76 };
  return { x: card.width - depth, y: card.height * 0.12, w: depth, h: card.height * 0.76 };
}

function edgeSamples(card: Raster, edge: EdgeRead["edge"]): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const inset = 3;
  if (edge === "top" || edge === "bottom") {
    const y = edge === "top" ? inset : card.height - 1 - inset;
    const x0 = Math.round(card.width * 0.12);
    const x1 = Math.round(card.width * 0.88);
    for (let x = x0; x < x1; x += 1) points.push({ x, y });
  } else {
    const x = edge === "left" ? inset : card.width - 1 - inset;
    const y0 = Math.round(card.height * 0.12);
    const y1 = Math.round(card.height * 0.88);
    for (let y = y0; y < y1; y += 1) points.push({ x, y });
  }
  return points;
}

function inBorder(x: number, y: number, card: Raster, borders: BorderMeasure): boolean {
  return x < borders.left || x >= card.width - borders.right || y < borders.top || y >= card.height - borders.bottom;
}

function innerRect(card: Raster, borders: BorderMeasure): { x: number; y: number; w: number; h: number } {
  const pad = 3;
  const x = clamp(borders.left + pad, 0, card.width - 2);
  const y = clamp(borders.top + pad, 0, card.height - 2);
  const right = clamp(card.width - borders.right - pad, x + 1, card.width);
  const bottom = clamp(card.height - borders.bottom - pad, y + 1, card.height);
  return { x, y, w: right - x, h: bottom - y };
}

function isWhitening(color: RGB, border: RGB): boolean {
  const [r, g, b] = color;
  if (r < 210 || g < 205 || b < 198) return false;
  const sat = saturation(r, g, b);
  const borderSat = saturation(...border);
  const lum = luminance(r, g, b);
  const borderLum = luminance(...border);
  if (sat > 0.16) return false;
  if (borderSat < 0.12) return false;
  return borderSat - sat > 0.18 || lum - borderLum > 22;
}

function whiteningSeverity(fraction: number, total: number): Severity {
  if (total < 12 || fraction < 0.012) return "none";
  if (fraction < 0.035) return "speck";
  if (fraction < 0.09) return "minor";
  if (fraction < 0.2) return "moderate";
  return "heavy";
}

function highPass(gray: Float32Array, width: number, height: number, radius: number): Float32Array {
  const residual = new Float32Array(gray.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += radius) {
        for (let dx = -radius; dx <= radius; dx += radius) {
          sum += gray[(y + dy) * width + (x + dx)];
          count += 1;
        }
      }
      residual[y * width + x] = gray[y * width + x] - sum / count;
    }
  }
  return residual;
}

function countPrintLines(gray: Float32Array, width: number, height: number, strict: boolean): number {
  let lines = 0;
  const need = strict ? 0.72 : 0.58;
  const considerRow = (y: number) => {
    if (y < 2 || y > height - 3) return false;
    let diff = 0;
    let rowVar = 0;
    let neighborVar = 0;
    const row: number[] = [];
    const neighbor: number[] = [];
    for (let x = 2; x < width - 2; x += 1) {
      const value = gray[y * width + x];
      const above = gray[(y - 1) * width + x];
      row.push(value);
      neighbor.push(above);
      if (Math.abs(value - above) > 26) diff += 1;
    }
    rowVar = variance(row);
    neighborVar = variance(neighbor);
    const coverage = diff / (width - 4);
    return coverage > need && rowVar < Math.max(30, neighborVar * 0.55);
  };
  for (let y = 2; y < height - 2; y += 1) {
    if (considerRow(y) && !considerRow(y - 1)) lines += 1;
  }
  for (let x = 2; x < width - 2; x += 1) {
    let diff = 0;
    const col: number[] = [];
    const neighbor: number[] = [];
    for (let y = 2; y < height - 2; y += 1) {
      const value = gray[y * width + x];
      const left = gray[y * width + (x - 1)];
      col.push(value);
      neighbor.push(left);
      if (Math.abs(value - left) > 26) diff += 1;
    }
    const coverage = diff / (height - 4);
    if (coverage > need && variance(col) < Math.max(30, variance(neighbor) * 0.55)) lines += 1;
  }
  return Math.min(lines, 4);
}

function detectCrease(
  gray: Float32Array,
  width: number,
  height: number,
  holoLimited: boolean,
): SurfaceRead["crease"] {
  const reach = Math.max(12, Math.round(height * 0.02));
  const threshold = holoLimited ? 0.8 : 0.58;
  const hits = new Uint8Array(height);
  for (let y = reach; y < height - reach; y += 1) {
    let hit = 0;
    let total = 0;
    for (let x = 2; x < width - 2; x += 4) {
      const value = gray[y * width + x];
      const above = gray[(y - reach) * width + x];
      const below = gray[(y + reach) * width + x];
      const shoulder = Math.max(above, below);
      total += 1;
      if (value < shoulder - 24) hit += 1;
    }
    if (total > 0 && hit / total > threshold) hits[y] = 1;
  }
  let best = 0;
  let run = 0;
  for (let y = 0; y < height; y += 1) {
    if (hits[y]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  const minWidth = Math.max(6, Math.round(height * 0.012));
  if (best < minWidth) return "none";
  if (best > height * 0.08) return "heavy";
  if (best > height * 0.03) return "moderate";
  return "light";
}

function countLongResiduals(residual: Float32Array, width: number, height: number, printLines: number): number {
  let count = 0;
  for (let y = 2; y < height - 2; y += 4) {
    let run = 0;
    for (let x = 2; x < width - 2; x += 1) {
      if (Math.abs(residual[y * width + x]) > 28) run += 1;
      else {
        if (run > width * 0.12 && run < width * 0.55) count += 1;
        run = 0;
      }
    }
  }
  return Math.max(0, Math.min(3, count - printLines));
}

function countSpots(card: Raster, inner: { x: number; y: number; w: number; h: number }): number {
  let spots = 0;
  const step = 6;
  for (let y = step; y < inner.h - step; y += step) {
    for (let x = step; x < inner.w - step; x += step) {
      const center = read(card, inner.x + x, inner.y + y);
      const around = [
        read(card, inner.x + x + step, inner.y + y),
        read(card, inner.x + x - step, inner.y + y),
        read(card, inner.x + x, inner.y + y + step),
        read(card, inner.x + x, inner.y + y - step),
      ];
      const local = medianColor(around);
      if (colorDist(center, local) > 90 && luminance(...center) < 235) spots += 1;
    }
  }
  if (spots > 8) return 0;
  return Math.min(spots, 4);
}

function edgeAcutance(card: Raster): number {
  const samples: number[] = [];
  const y0 = Math.round(card.height * 0.3);
  const y1 = Math.round(card.height * 0.7);
  for (let y = y0; y < y1; y += 6) {
    let best = 0;
    for (let x = 2; x < Math.min(card.width - 2, Math.round(card.width * 0.2)); x += 1) {
      const jump = Math.abs(luminance(...read(card, x, y)) - luminance(...read(card, x - 1, y)));
      best = Math.max(best, jump);
    }
    samples.push(best);
  }
  return median(samples);
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  return values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length;
}

function spread(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A tight photo of one corner, one edge, or the surface. Not used for centering. */
export function analyzeCloseup(source: Raster, kind: CloseupKind): CloseupResult {
  if (kind === "surface") return surfaceCloseup(source);
  return rimCloseup(source, kind);
}

function surfaceCloseup(source: Raster): CloseupResult {
  const shortSide = Math.min(source.width, source.height);
  if (shortSide < 180) {
    return {
      kind: "surface",
      clean: false,
      foundDamage: false,
      inconclusive: true,
      note: "This surface photo is too small to judge gloss or scratches.",
      defects: [],
    };
  }
  const gray = new Float32Array(source.width * source.height);
  let glare = 0;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const [r, g, b] = read(source, x, y);
      gray[y * source.width + x] = luminance(r, g, b);
      if (luminance(r, g, b) > 246 && saturation(r, g, b) < 0.08) glare += 1;
    }
  }
  const glareFraction = glare / (source.width * source.height);
  if (glareFraction > 0.18) {
    return {
      kind: "surface",
      clean: false,
      foundDamage: false,
      inconclusive: true,
      note: "Glare covers too much of this close-up, so the surface still is not scored.",
      defects: [],
    };
  }
  const residual = highPass(gray, source.width, source.height, 2);
  const scratches = countLongResiduals(residual, source.width, source.height, 0);
  const crease = detectCrease(gray, source.width, source.height, false);
  const defects: Defect[] = [];
  if (scratches > 0) {
    defects.push(closeDefect("surface-scratch", "scratch", scratches > 1 ? "moderate" : "minor", "Scratch in the surface close-up", "An elongated mark is visible in the closer photo."));
  }
  if (crease !== "none") {
    defects.push(closeDefect("surface-crease", crease === "light" ? "crease" : "fold", crease === "light" ? "moderate" : "heavy", "Crease in the surface close-up", `The closer photo shows a ${crease} linear band.`));
  }
  if (defects.length === 0) {
    return {
      kind: "surface",
      clean: true,
      foundDamage: false,
      inconclusive: false,
      note: "The surface close-up shows no scratch or crease the detector will stand behind. Gloss under a loupe is still not the same as this photo.",
      defects: [],
    };
  }
  return {
    kind: "surface",
    clean: false,
    foundDamage: true,
    inconclusive: false,
    note: "The surface close-up added damage that the wider photo did not have to carry alone.",
    defects,
  };
}

function rimCloseup(source: Raster, kind: CloseupKind): CloseupResult {
  const colors: RGB[] = [];
  const x0 = Math.round(source.width * 0.3);
  const x1 = Math.round(source.width * 0.7);
  const y0 = Math.round(source.height * 0.3);
  const y1 = Math.round(source.height * 0.7);
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) colors.push(read(source, x, y));
  }
  const base = medianColor(colors);
  if (saturation(...base) < 0.12) {
    return {
      kind,
      clean: false,
      foundDamage: false,
      inconclusive: true,
      note: "This close-up does not show a saturated card border, so whitening cannot be separated from the artwork.",
      defects: [],
    };
  }
  let white = 0;
  let total = 0;
  const rim = Math.max(4, Math.round(Math.min(source.width, source.height) * 0.12));
  for (let y = 0; y < source.height; y += 2) {
    for (let x = 0; x < source.width; x += 2) {
      if (x > rim && x < source.width - rim && y > rim && y < source.height - rim) continue;
      total += 1;
      if (isWhitening(read(source, x, y), base)) white += 1;
    }
  }
  const fraction = total > 0 ? white / total : 0;
  if (fraction < 0.02) {
    return {
      kind,
      clean: true,
      foundDamage: false,
      inconclusive: false,
      note: "The closer photo of this border does not show whitening beyond the wider shot.",
      defects: [],
    };
  }
  const severity = fraction > 0.2 ? "heavy" : fraction > 0.08 ? "moderate" : "minor";
  return {
    kind,
    clean: false,
    foundDamage: true,
    inconclusive: false,
    note: "The closer photo shows border whitening, so that wear is treated as visible.",
    defects: [
      closeDefect(
        `${kind}-whitening`,
        kind === "corner" ? "corner" : "edge",
        severity,
        kind === "corner" ? "Whitening in the corner close-up" : "Whitening in the edge close-up",
        `${Math.round(fraction * 100)}% of the outer rim in this close-up is lighter than the border color.`,
      ),
    ],
  };
}

function closeDefect(id: string, kind: Defect["kind"], severity: Defect["severity"], title: string, detail: string): Defect {
  return {
    id: `closeup-${id}`,
    side: "closeup",
    kind,
    severity,
    x: 0.08,
    y: 0.08,
    w: 0.84,
    h: 0.84,
    title,
    detail,
    gradeImpact: "A closer photo outweighs a soft wider shot for this one area.",
    confidence: 0.72,
    evidence: "visible",
  };
}
