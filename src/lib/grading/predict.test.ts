import { describe, expect, it } from "vitest";
import type { CornerRead, EdgeRead, SideMetrics, SurfaceRead } from "../../types";
import { assessCard, combineBgs } from "./predict";

describe("combineBgs", () => {
  it("follows Beckett's published examples", () => {
    expect(combineBgs(9.5, 9.5, 9, 8).grade).toBe(8.5);
    expect(combineBgs(9.5, 9.5, 8.5, 9).grade).toBe(9);
    expect(combineBgs(10, 6, 10, 10).grade).toBe(7);
    expect(combineBgs(10, 10, 10, 10)).toEqual({ grade: 10, label: "Black Label" });
    expect(combineBgs(10, 10, 10, 9.5)).toEqual({ grade: 10, label: "Gold Label" });
  });
});

describe("assessCard", () => {
  it("lets a clean 50/50 card reach PSA 10 and stops Beckett and CGC short of pristine", () => {
    const opinion = assessCard(side(), side());
    const psa = grade(opinion, "psa");
    const bgs = grade(opinion, "bgs");
    const cgc = grade(opinion, "cgc");
    expect(psa.grade).toBe(10);
    expect(psa.range[1]).toBe(10);
    expect(psa.range[0]).toBeLessThan(10);
    expect(bgs.grade).toBe(9.5);
    expect(bgs.subgrades?.find((item) => item.label === "Centering")?.value).toBe("10");
    expect(cgc.grade).toBe(9.5);
    expect(cgc.summary.toLowerCase()).toContain("pristine");
    expect(psa.confidence).toBeLessThan(0.8);
  });

  it("holds 70/30 centering to each company's published band", () => {
    const opinion = assessCard(side({ leftRight: 0.7, topBottom: 0.7 }), side());
    expect(grade(opinion, "psa").grade).toBe(7);
    expect(grade(opinion, "bgs").subgrades?.find((item) => item.label === "Centering")?.value).toBe("6");
    expect(grade(opinion, "bgs").grade).toBeLessThanOrEqual(6.5);
    expect(grade(opinion, "cgc").grade).toBe(7);
  });

  it("treats a light crease as damage, not a gem", () => {
    const opinion = assessCard(side({ crease: "light" }), side());
    expect(grade(opinion, "psa").grade).toBeLessThanOrEqual(5);
    expect(grade(opinion, "bgs").grade).toBeLessThanOrEqual(5.5);
    expect(grade(opinion, "cgc").grade).toBeLessThanOrEqual(4.5);
    expect(opinion.grades.every((item) => item.summary.toLowerCase().includes("predicted"))).toBe(true);
  });

  it("spends the mint allowance on one visible print line", () => {
    const opinion = assessCard(side({ printLines: 1 }), side());
    expect(grade(opinion, "psa").grade).toBe(9);
    expect(grade(opinion, "bgs").grade).toBe(9);
    expect(grade(opinion, "cgc").grade).toBe(9);
    expect(opinion.grades.some((item) => item.reasons.some((reason) => /misprint|error/i.test(reason)))).toBe(true);
  });

  it("does not call gem mint when the back is outside 75/25", () => {
    const opinion = assessCard(side(), side({ leftRight: 0.8, topBottom: 0.55 }));
    const psa = grade(opinion, "psa");
    expect(psa.grade).toBe(9);
    expect(psa.reasons.join(" ")).toMatch(/back centering/i);
  });

  it("does not invent centering when the border cannot be read", () => {
    const opinion = assessCard(side({ reliable: false }), side());
    expect(grade(opinion, "psa").grade).toBeLessThanOrEqual(9);
    expect(grade(opinion, "bgs").subgrades?.find((item) => item.label === "Centering")?.value).toBe("—");
    expect(opinion.limits.join(" ")).toMatch(/centering/i);
  });

  it("drops to 8 when two separate minor flaws are visible", () => {
    const front = side({ printLines: 1 });
    front.corners = front.corners.map((corner, index) => (index === 0 ? { ...corner, severity: "minor" } : corner));
    const opinion = assessCard(front, side());
    expect(grade(opinion, "psa").grade).toBeLessThanOrEqual(8);
  });

  it("asks for a surface photo when holofoil hides the gloss", () => {
    const opinion = assessCard(side({ holo: true }), side());
    expect(grade(opinion, "psa").grade).toBeLessThanOrEqual(9);
    expect(opinion.requests.some((request) => /surface/i.test(request.text))).toBe(true);
  });

  it("can clear the surface cap after a clean close-up", () => {
    const hidden = assessCard(side({ holo: true }), side(), [
      {
        kind: "surface",
        clean: true,
        foundDamage: false,
        inconclusive: false,
        note: "clean",
        defects: [],
      },
    ]);
    expect(grade(hidden, "psa").grade).toBe(10);
  });
});

function grade(opinion: ReturnType<typeof assessCard>, company: "psa" | "bgs" | "cgc") {
  const found = opinion.grades.find((item) => item.company === company);
  if (!found) throw new Error(company);
  return found;
}

function side(options: {
  leftRight?: number;
  topBottom?: number;
  reliable?: boolean;
  printLines?: number;
  scratches?: number;
  crease?: SurfaceRead["crease"];
  holo?: boolean;
  focus?: SideMetrics["quality"]["focus"];
} = {}): SideMetrics {
  const leftRight = options.leftRight ?? 0.5;
  const topBottom = options.topBottom ?? 0.5;
  const corners: CornerRead[] = (["tl", "tr", "bl", "br"] as const).map((corner) => ({ corner, severity: "none", fraction: 0 }));
  const edges: EdgeRead[] = (["top", "right", "bottom", "left"] as const).map((edge) => ({ edge, severity: "none", fraction: 0, run: 0 }));
  return {
    centering: {
      reliable: options.reliable ?? true,
      left: Math.round(leftRight * 40),
      right: Math.round((1 - leftRight) * 40),
      top: Math.round(topBottom * 40),
      bottom: Math.round((1 - topBottom) * 40),
      leftRight,
      topBottom,
    },
    corners,
    edges,
    surface: {
      reliable: !options.holo,
      holoLimited: Boolean(options.holo),
      glareFraction: 0,
      printLines: options.printLines ?? 0,
      scratches: options.scratches ?? 0,
      spots: 0,
      crease: options.crease ?? "none",
    },
    quality: {
      shortSide: 1200,
      focus: options.focus ?? "sharp",
      perspective: false,
      fill: "cropped-margin",
      notes: [],
    },
  };
}
