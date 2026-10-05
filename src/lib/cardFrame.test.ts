import { describe, expect, it } from "vitest";
import { blank } from "./vision/raster";
import { CARD_RATIO, frameCard } from "./cardFrame";

describe("frameCard", () => {
  it("lifts a card off a flat table and fits it to card size", () => {
    const source = blank(400, 560, (x, y) => (x > 40 && x < 360 && y > 50 && y < 510 ? [30, 90, 200] : [150, 140, 120]));
    const framed = frameCard(source);
    expect(framed.width / framed.height).toBeCloseTo(CARD_RATIO, 2);
    expect(framed.data[0]).toBeLessThan(50);
    expect(framed.data[2]).toBeGreaterThan(150);
  });

  it("keeps a photo that is already the card", () => {
    const source = blank(630, 880, (x, y) => (x < 36 || y < 36 || x > 593 || y > 843 ? [230, 190, 40] : [20, 80, 160]));
    const framed = frameCard(source);
    expect(framed.width).toBe(630);
    expect(framed.height).toBe(880);
  });
});
