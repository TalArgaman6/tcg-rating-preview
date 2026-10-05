import { blank, type Raster, type RGB } from "./vision/raster";

const GRAY: RGB = [188, 188, 188];
const YELLOW: RGB = [232, 196, 48];
const BLUE: RGB = [24, 78, 158];
const ART: RGB = [86, 142, 196];
const BACK_INNER: RGB = [214, 228, 242];
const WHITE: RGB = [248, 248, 246];
const INK: RGB = [28, 32, 38];

/** A drawn card with a whitened corner and a print line, so the desk can be tried without a scan. */
export function practiceFront(): Raster {
  return framed({
    width: 1000,
    height: 1380,
    margin: 40,
    border: 32,
    borderColor: YELLOW,
    inner: ART,
    paint(cardX, cardY, cardW, cardH, inBorder) {
      if (inBorder && cardX < 16 && cardY < 16) return WHITE;
      if (!inBorder && cardX > cardW * 0.12 && cardX < cardW * 0.88 && cardY >= Math.round(cardH * 0.48) && cardY < Math.round(cardH * 0.48) + 2) return INK;
      return null;
    },
  });
}

/** Back is slightly off-center and has a short whitened run on the right edge. */
export function practiceBack(): Raster {
  return framed({
    width: 1000,
    height: 1380,
    margin: 40,
    border: { left: 48, right: 32, top: 36, bottom: 36 },
    borderColor: BLUE,
    inner: BACK_INNER,
    paint(cardX, cardY, cardW, _cardH, inBorder) {
      const onRight = cardX >= cardW - 8 && cardY > _cardH * 0.46 && cardY < _cardH * 0.46 + 22;
      if (inBorder && onRight) return WHITE;
      return null;
    },
  });
}

function framed(spec: {
  width: number;
  height: number;
  margin: number;
  border: number | { left: number; right: number; top: number; bottom: number };
  borderColor: RGB;
  inner: RGB;
  paint: (cardX: number, cardY: number, cardW: number, cardH: number, inBorder: boolean) => RGB | null;
}): Raster {
  const border = typeof spec.border === "number"
    ? { left: spec.border, right: spec.border, top: spec.border, bottom: spec.border }
    : spec.border;
  const cardW = spec.width - spec.margin * 2;
  const cardH = spec.height - spec.margin * 2;
  return blank(spec.width, spec.height, (x, y) => {
    if (x < spec.margin || y < spec.margin || x >= spec.width - spec.margin || y >= spec.height - spec.margin) return GRAY;
    const cardX = x - spec.margin;
    const cardY = y - spec.margin;
    const inBorder = cardX < border.left || cardY < border.top || cardX >= cardW - border.right || cardY >= cardH - border.bottom;
    return spec.paint(cardX, cardY, cardW, cardH, inBorder) ?? (inBorder ? spec.borderColor : spec.inner);
  });
}
