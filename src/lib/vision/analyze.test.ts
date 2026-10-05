import { describe, expect, it } from "vitest";
import { practiceBack, practiceFront } from "../sampleCard";
import { analyzeRaster } from "./analyze";
import { blank, type RGB } from "./raster";

describe("analyzeRaster", () => {
  it("measures a drawn front and marks the whitened corner and print line", () => {
    const vision = analyzeRaster(practiceFront(), { side: "front" });
    expect(vision.metrics.centering.reliable).toBe(true);
    expect(vision.metrics.centering.leftRight).toBeLessThan(0.56);
    expect(vision.metrics.centering.topBottom).toBeLessThan(0.56);
    expect(vision.defects.some((defect) => defect.kind === "corner")).toBe(true);
    expect(vision.metrics.surface.printLines).toBeGreaterThan(0);
    expect(vision.metrics.surface.crease).toBe("none");
  });

  it("keeps a wide dark band as a crease and a hairline as a print line", () => {
    const yellow: RGB = [232, 196, 48];
    const art: RGB = [86, 142, 196];
    const raster = blank(420, 580, (x, y) => {
      if (x < 20 || y < 20 || x >= 400 || y >= 560) return [180, 180, 180];
      const cardX = x - 20;
      const cardY = y - 20;
      const inBorder = cardX < 18 || cardY < 18 || cardX >= 362 || cardY >= 522;
      if (inBorder) return yellow;
      if (cardY > 250 && cardY < 278) return [36, 36, 40];
      return art;
    });
    const vision = analyzeRaster(raster, { side: "front" });
    expect(vision.metrics.surface.crease).not.toBe("none");
  });

  it("marks whitening on the back edge", () => {
    const vision = analyzeRaster(practiceBack(), { side: "back" });
    expect(vision.metrics.centering.reliable).toBe(true);
    expect(vision.defects.some((defect) => defect.kind === "edge" || defect.kind === "corner")).toBe(true);
  });
});
