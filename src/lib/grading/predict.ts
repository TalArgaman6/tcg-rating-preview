import type {
  CloseupResult,
  CornerRead,
  EdgeRead,
  FactorRow,
  FactorScore,
  GradePrediction,
  Opinion,
  Severity,
  SideMetrics,
  SurfaceRead,
} from "../../types";
import { clampHalf, confidenceLabel, formatGrade, formatRatio } from "../format";
import { STANDARDS } from "./standards";

const RANK: Record<Severity, number> = { none: 0, speck: 1, minor: 2, moderate: 3, heavy: 4 };

/** Beckett's published combination examples, checked in predict.test.ts. */
export function combineBgs(centering: number, corners: number, edges: number, surface: number): {
  grade: number;
  label: "Black Label" | "Gold Label" | null;
} {
  const subs = [centering, corners, edges, surface];
  const low = Math.min(...subs);
  const tens = subs.filter((value) => value >= 9.99).length;
  if (tens === 4) return { grade: 10, label: "Black Label" };
  if (tens === 3 && low >= 9.49) return { grade: 10, label: "Gold Label" };

  const othersAtTen = tens >= 3 && low < 9.99;
  let bump = 0;
  if (othersAtTen) bump = 1;
  else if (centering > low && corners > low) bump = 0.5;

  let grade = clampHalf(Math.min(low + bump, low + 1));
  const atLeast95 = subs.filter((value) => value >= 9.5).length;
  if (grade >= 9.5 && !(atLeast95 >= 3 && low >= 9)) grade = 9;
  if (grade >= 10) grade = 9.5;
  return { grade, label: null };
}

export function assessCard(
  front: SideMetrics,
  back: SideMetrics,
  closeups: CloseupResult[] = [],
): Opinion {
  const reading = prepare(front, back, closeups);
  const scores = scoreFactors(reading);
  const confidence = photoConfidence(front, back, reading.surfaceReviewed);
  const psa = predictPsa(reading, confidence);
  const bgs = predictBgs(reading, scores, confidence);
  const cgc = predictCgc(reading, confidence);
  return {
    grades: [psa, bgs, cgc],
    scores,
    factors: factorRows(reading, psa.grade, bgs),
    limits: limits(front, back, reading),
    requests: requests(front, back, reading, closeups),
  };
}

interface Reading {
  front: SideMetrics;
  back: SideMetrics;
  corners: CornerRead[];
  edges: EdgeRead[];
  surface: SurfaceRead;
  backSurface: SurfaceRead;
  surfaceReviewed: boolean;
  focus: SideMetrics["quality"]["focus"];
}

function prepare(front: SideMetrics, back: SideMetrics, closeups: CloseupResult[]): Reading {
  const surfaceReviewed = closeups.some((shot) => shot.kind === "surface" && shot.clean && !shot.inconclusive);
  let surface = { ...front.surface };
  let backSurface = { ...back.surface };
  if (surfaceReviewed) {
    surface = clearUnseenSurface(surface);
    backSurface = clearUnseenSurface(backSurface);
  }
  const surfaceHit = closeups.find((shot) => shot.kind === "surface" && shot.foundDamage);
  if (surfaceHit) {
    if (surfaceHit.defects.some((defect) => defect.kind === "scratch")) {
      surface = { ...surface, reliable: true, scratches: Math.max(surface.scratches, 1) };
    }
    const crease = surfaceHit.defects.find((defect) => defect.kind === "crease" || defect.kind === "fold");
    if (crease) {
      const next = crease.severity === "heavy" ? "heavy" : "moderate";
      surface = { ...surface, reliable: true, crease: worseCrease(surface.crease, next) };
    }
  }

  const focus = worseFocus(front.quality.focus, back.quality.focus);
  let corners = [...front.corners, ...back.corners];
  let edges = [...front.edges, ...back.edges];
  if (focus === "poor") {
    corners = corners.map((corner) =>
      corner.severity === "heavy" || corner.severity === "moderate" ? corner : { ...corner, severity: "none" },
    );
    edges = edges.map((edge) =>
      edge.severity === "heavy" || edge.severity === "moderate" ? edge : { ...edge, severity: "none" },
    );
  }
  corners = raiseGroup(corners, closeups, "corner");
  edges = raiseGroup(edges, closeups, "edge");

  if (!surface.reliable && surface.holoLimited) {
    surface = { ...surface, scratches: 0, spots: 0, printLines: 0, crease: surface.crease === "light" ? "none" : surface.crease };
  }

  return { front, back, corners, edges, surface, backSurface, surfaceReviewed, focus };
}

function clearUnseenSurface(surface: SurfaceRead): SurfaceRead {
  if (surface.reliable && !surface.holoLimited) return surface;
  return {
    ...surface,
    reliable: true,
    holoLimited: false,
    printLines: 0,
    scratches: 0,
    spots: 0,
    crease: surface.crease === "light" ? "none" : surface.crease,
    note: undefined,
  };
}

function raiseGroup<T extends { severity: Severity }>(items: T[], closeups: CloseupResult[], kind: "corner" | "edge"): T[] {
  const shot = closeups.find((item) => item.kind === kind && item.foundDamage);
  if (!shot) return items;
  const added = shot.defects.reduce<Severity>((worst, defect) => {
    if (defect.severity === "info") return worst;
    return RANK[defect.severity] > RANK[worst] ? defect.severity : worst;
  }, "none");
  if (added === "none") return items;
  const current = items.reduce((worst, item) => (RANK[item.severity] > RANK[worst] ? item.severity : worst), "none" as Severity);
  if (RANK[added] <= RANK[current]) return items;
  const copy = items.map((item) => ({ ...item }));
  const target = copy.find((item) => item.severity === "none") ?? copy[0];
  if (target) target.severity = added;
  return copy;
}

function scoreFactors(reading: Reading): FactorScore[] {
  return [
    centeringScore(reading),
    cornerScore(reading),
    edgeScore(reading),
    surfaceScore(reading),
  ];
}

function centeringScore(reading: Reading): FactorScore {
  const front = reading.front.centering;
  if (!front.reliable) {
    return {
      label: "Centering",
      score: null,
      caption: front.note ?? "Front centering is not reliable in this photo.",
    };
  }
  const worse = Math.max(front.leftRight, front.topBottom);
  const better = Math.min(front.leftRight, front.topBottom);
  let grade = band(worse, better, [
    [52, 52, 10],
    [55, 52, 9.5],
    [55, 100, 9],
    [60, 52, 8.5],
    [60, 55, 8],
    [60, 100, 7.5],
    [65, 60, 7],
    [65, 100, 6.5],
    [70, 100, 6],
    [75, 100, 5],
    [80, 100, 4],
    [85, 100, 3],
    [90, 100, 2],
    [100, 100, 1],
  ]);
  const back = reading.back.centering;
  let backNote = "The back centering was not reliable, so it did not move this score.";
  if (back.reliable) {
    const backPct = largerPercent(Math.max(back.leftRight, back.topBottom));
    backNote = `Back centering is ${formatRatio(Math.max(back.leftRight, back.topBottom))}.`;
    if (backPct > 90) grade -= 1.5;
    else if (backPct > 75) grade -= 1;
    else if (backPct > 60) grade -= 0.5;
  }
  return {
    label: "Centering",
    score: clampHalf(Math.max(1, grade)),
    caption: `Front ${axisText(front.left, front.right, "left", "right")} and ${axisText(front.top, front.bottom, "top", "bottom")}. ${backNote} Beckett's graders have described 60/40 both ways as a 7.5 centering subgrade, with 50/50 required for a 10.`,
  };
}

function band(worse: number, better: number, rows: [number, number, number][]): number {
  const w = largerPercent(worse);
  const b = largerPercent(better);
  for (const [worseMax, betterMax, grade] of rows) {
    if (w <= worseMax && b <= betterMax) return grade;
  }
  return 1;
}

function cornerScore(reading: Reading): FactorScore {
  if (reading.focus === "poor") {
    return { label: "Corners", score: null, caption: "The photo is too soft to score corner tips." };
  }
  const counts = tally(reading.corners);
  const value = wearScore(counts, { speck: [1, 9], minor: [1, 8], moderate: [1, 7], heavy: [1, 4] }, reading.focus === "soft" ? 9 : 9.5);
  return {
    label: "Corners",
    score: value,
    caption:
      value >= 9.5
        ? "No whitening on the eight corners in these photos. Beckett still asks for corners to be mint under magnification, which a photo does not show."
        : `Whitening: ${wearPhrase(counts)}. A mark the photo can already see is more than Beckett's Gem Mint allowance of a speck only under magnification.`,
  };
}

function edgeScore(reading: Reading): FactorScore {
  if (reading.focus === "poor") {
    return { label: "Edges", score: null, caption: "The photo is too soft to score edge chipping." };
  }
  const counts = tally(reading.edges);
  const value = wearScore(counts, { speck: [1, 9], minor: [1, 8], moderate: [1, 6.5], heavy: [1, 4] }, reading.focus === "soft" ? 9 : 9.5);
  return {
    label: "Edges",
    score: value,
    caption:
      value >= 9.5
        ? "No whitening run on the edges. The top of Beckett's edge scale still expects the edge to be virtually free of flaws under magnification."
        : `Edge wear: ${wearPhrase(counts)}. Beckett's Near Mint-Mint 8 edges allow specks of chipping that are visible without a loupe.`,
  };
}

function surfaceScore(reading: Reading): FactorScore {
  const surface = worseSurface(reading.surface, reading.backSurface);
  if (surface.crease === "heavy") return { label: "Surface", score: 2, caption: "A heavy crease or fold is visible. That is structural wear, not a print error." };
  if (surface.crease === "moderate") return { label: "Surface", score: 3, caption: "A crease crosses the surface." };
  if (surface.crease === "light") return { label: "Surface", score: 4.5, caption: "A light crease is visible. CGC's VG-EX+ 4.5 text allows one light crease." };
  if (surface.scratches >= 2) return { label: "Surface", score: 7, caption: "More than one scratch is visible. Scratches break original gloss." };
  if (surface.scratches === 1) return { label: "Surface", score: 8, caption: "A scratch is visible. Beckett's Gem Mint 9.5 surface standard is devoid of scratches." };
  if (surface.printLines >= 2) return { label: "Surface", score: 8, caption: "More than one print line is visible. Ordinary print lines are a condition issue, not a valuable misprint." };
  if (surface.printLines === 1) return { label: "Surface", score: 9, caption: "One print line is visible. Beckett's Mint 9 surface can allow one faint line. The Gem Mint 9.5 surface text does not. It is not a valuable misprint." };
  if (surface.spots >= 2) return { label: "Surface", score: 8, caption: "More than one discoloration spot is visible. The photo cannot tell a print spot from a stain." };
  if (surface.spots === 1) return { label: "Surface", score: 9, caption: "One small discoloration is visible. PSA's Mint 9 text allows one minor printing imperfection." };
  if (!reading.surface.reliable && !reading.surfaceReviewed) {
    return {
      label: "Surface",
      score: null,
      caption: reading.surface.note ?? "The surface is hidden by glare or holofoil, so gloss and hairline scratches are not scored.",
    };
  }
  return {
    label: "Surface",
    score: 9.5,
    caption: reading.surfaceReviewed
      ? "A closer surface photo showed no scratch or crease. It is still not a 10× inspection."
      : "No scratch, print line, or crease the measurement will stand behind. Magnification was not used, so this is not a pristine 10 surface.",
  };
}

function wearScore(
  counts: Record<Severity, number>,
  caps: { speck: [number, number]; minor: [number, number]; moderate: [number, number]; heavy: [number, number] },
  clean: number,
): number {
  if (counts.heavy >= 2) return 3;
  if (counts.heavy >= 1) return caps.heavy[1];
  if (counts.moderate >= 2) return Math.min(caps.moderate[1], 6);
  if (counts.moderate >= 1) return caps.moderate[1];
  if (counts.minor >= 3) return 7;
  if (counts.minor >= 2) return Math.min(8, caps.minor[1]);
  if (counts.minor >= 1) return caps.minor[1];
  if (counts.speck >= 2) return 8.5;
  if (counts.speck >= 1) return caps.speck[1];
  return clean;
}

function predictPsa(reading: Reading, confidence: number): GradePrediction {
  const caps: { grade: number; reason: string }[] = [];
  let flaws = 0;
  const front = reading.front.centering;
  const back = reading.back.centering;
  const frontPct = front.reliable ? largerPercent(Math.max(front.leftRight, front.topBottom)) : null;
  const backPct = back.reliable ? largerPercent(Math.max(back.leftRight, back.topBottom)) : null;
  const frontRatio = front.reliable ? formatRatio(Math.max(front.leftRight, front.topBottom)) : null;

  if (frontPct == null) {
    caps.push({ grade: 9, reason: "Front centering could not be measured, so a Gem Mint 10 is not supported." });
  } else {
    let centeringGrade = 10;
    let centeringReason = "";
    if (frontPct <= 55) {
      centeringReason = `Front centering is ${frontRatio}, inside PSA's published Gem Mint 10 tolerance of about 55/45.`;
    } else if (frontPct <= 65) {
      centeringGrade = 9;
      flaws += 1;
      centeringReason = `Front centering is ${frontRatio}. PSA's published Gem Mint 10 front tolerance is about 55/45. Mint 9 allows about 60/40 to 65/35.`;
    } else if (frontPct <= 70) {
      centeringGrade = 7;
      centeringReason = `Front centering is ${frontRatio}. PSA's NM-MT 8 asks for about 65/35 or better, and Near Mint 7 allows about 70/30.`;
    } else if (frontPct <= 80) {
      centeringGrade = 6;
      centeringReason = `Front centering is ${frontRatio}. PSA's EX-MT 6 centering figure is about 80/20 or better.`;
    } else if (frontPct <= 85) {
      centeringGrade = 5;
      centeringReason = `Front centering is ${frontRatio}, outside the centering PSA publishes for Excellent-Mint.`;
    } else if (frontPct <= 90) {
      centeringGrade = 3;
      centeringReason = `Front centering is ${frontRatio}, far enough off-center to leave the near-mint grades.`;
    } else {
      centeringGrade = 2;
      centeringReason = `Front centering is ${frontRatio}. That is miscut territory, not a mint card.`;
    }
    if (backPct == null) {
      centeringGrade = Math.min(centeringGrade, 9);
      centeringReason += " Back centering could not be measured, so Gem Mint 10 is not supported.";
    } else if (backPct > 90) {
      centeringGrade = Math.min(centeringGrade, 5);
      centeringReason += " Back centering is worse than the 90/10 figure PSA publishes from Mint down through Excellent-Mint.";
    } else if (backPct > 75) {
      centeringGrade = Math.min(centeringGrade, 9);
      centeringReason += ` Back centering is ${formatRatio(Math.max(back.leftRight, back.topBottom))}, outside PSA's published 75/25 Gem Mint 10 reverse tolerance.`;
    }
    if (centeringGrade < 10) caps.push({ grade: centeringGrade, reason: centeringReason.trim() });
  }

  const corners = tally(reading.corners);
  if (corners.heavy > 0) caps.push({ grade: 3, reason: "A corner is heavily whitened or soft. That is well below every near-mint grade." });
  else if (corners.moderate >= 2) caps.push({ grade: 5, reason: "Whitening is visible on more than one corner." });
  else if (corners.moderate === 1) caps.push({ grade: 6, reason: "One corner shows whitening beyond a speck. PSA Mint 9 allows slightly off-white borders as a single minor flaw, not a fuzzy corner." });
  else if (corners.minor >= 2) caps.push({ grade: 8, reason: "Whitening is visible on more than one corner. PSA Mint 9 allows only one minor flaw." });
  else if (corners.minor === 1) {
    flaws += 1;
    caps.push({ grade: 9, reason: "One corner is slightly whitened. PSA's Mint 9 text allows slightly off-white borders as its one minor flaw." });
  } else if (corners.speck >= 2) {
    flaws += 1;
    caps.push({ grade: 8, reason: "More than one corner speck is visible. That is already more than the single minor flaw in PSA's Mint 9 text." });
  } else if (corners.speck === 1) flaws += 1;

  const edges = tally(reading.edges);
  if (edges.heavy > 0) caps.push({ grade: 4, reason: "An edge has heavy whitening. That is handling wear, not a print variant." });
  else if (edges.moderate > 0) caps.push({ grade: 6, reason: "Edge whitening is visible along a run, which misses PSA's mint grades." });
  else if (edges.minor > 0) {
    flaws += 1;
    caps.push({ grade: 8, reason: "Edge whitening is visible. PSA's NM-MT 8 description is where slight fraying starts to fit. Mint 9 does not list it." });
  }

  const surface = worseSurface(reading.surface, reading.backSurface);
  if (surface.crease === "heavy") caps.push({ grade: 2, reason: "A crease or fold travels the card. PSA keeps creased cards far from mint." });
  else if (surface.crease === "moderate") caps.push({ grade: 4, reason: "A crease is visible. That is structural wear and it caps the card in the very-good range." });
  else if (surface.crease === "light") caps.push({ grade: 5, reason: "A light crease is visible. PSA's Excellent range is where a light crease can still fit." });
  if (surface.scratches >= 2) caps.push({ grade: 7, reason: "More than one scratch is visible. PSA Gem Mint 10 calls for full original gloss." });
  else if (surface.scratches === 1) {
    flaws += 1;
    caps.push({ grade: 8, reason: "A scratch is visible, so the original gloss is broken. That misses both Gem Mint 10 and a clean Mint 9." });
  }
  if (surface.printLines >= 2) caps.push({ grade: 8, reason: "More than one print line is visible. PSA may allow one slight print flaw on a 10 only when it does not hurt eye appeal. A line this photo can see does." });
  else if (surface.printLines === 1) {
    flaws += 1;
    caps.push({ grade: 9, reason: "One print line is visible. That can be PSA's one minor printing imperfection, which spends the Mint 9 allowance and misses Gem Mint 10." });
  }
  if (surface.spots >= 2) caps.push({ grade: 8, reason: "More than one spot is visible. PSA Mint 9 allows one minor printing imperfection, not several." });
  else if (surface.spots === 1) {
    flaws += 1;
    caps.push({ grade: 9, reason: "One spot is visible. It can be the single printing imperfection in PSA's Mint 9 text. It was not treated as a valuable error." });
  }
  if (!reading.surface.reliable && !reading.surfaceReviewed && surface.crease === "none" && surface.scratches === 0 && surface.printLines === 0) {
    caps.push({ grade: 9, reason: "The surface is not fully visible, so full original gloss — part of PSA's Gem Mint 10 text — is not established." });
  }

  if (reading.focus === "poor") caps.push({ grade: 7, reason: "The photo is soft, so a mint or gem mint call would be a guess. The grade stops at Near Mint until a sharper photo is available." });
  else if (reading.focus === "soft") caps.push({ grade: 9, reason: "Focus is only fair, so corner tips and hairline scratches can hide. Gem Mint 10 is not supported." });

  let grade = 10;
  for (const cap of caps) grade = Math.min(grade, cap.grade);
  if (grade >= 9 && flaws >= 2) grade = Math.min(grade, 8);
  if (grade === 10 && flaws >= 1) grade = 9;
  grade = Math.max(1, Math.round(grade));

  const binding = caps.filter((cap) => cap.grade <= grade + 1).sort((a, b) => a.grade - b.grade);
  const reasons = unique(binding.map((cap) => cap.reason)).slice(0, 4);
  if (grade === 10) {
    reasons.unshift("Centering is inside PSA's published 55/45 front and 75/25 back Gem Mint 10 tolerances, and the photos show no whitening, scratch, crease, or print line.");
  }
  if (reasons.length === 0) reasons.push("Nothing measured in the photos forces a lower PSA grade.");

  const drop = confidence < 0.45 ? 2 : 1;
  return {
    company: "psa",
    companyName: STANDARDS.psa.name,
    grade,
    gradeText: formatGrade(grade, false),
    title: psaTitle(grade),
    range: [Math.max(1, grade - drop), grade],
    confidence: round2(confidence),
    confidenceLabel: confidenceLabel(confidence),
    summary: psaSummary(grade, frontRatio),
    reasons,
    notAssessed: notAssessed(reading, "PSA does not print subgrades. Eye appeal can move a card that sits on a published line, and this desk does not give that benefit of the doubt."),
    labelNote: STANDARDS.psa.note,
  };
}

function predictBgs(reading: Reading, scores: FactorScore[], confidence: number): GradePrediction {
  const byLabel = Object.fromEntries(scores.map((score) => [score.label, score])) as Record<string, FactorScore>;
  const missing = scores.filter((score) => score.score == null).map((score) => score.label);
  let grade: number;
  let label: "Black Label" | "Gold Label" | null = null;
  if (missing.length === 0) {
    const combined = combineBgs(byLabel.Centering.score!, byLabel.Corners.score!, byLabel.Edges.score!, byLabel.Surface.score!);
    grade = combined.grade;
    label = combined.label;
  } else {
    const known = scores.map((score) => score.score).filter((score): score is number => score != null);
    grade = known.length ? Math.min(9, ...known) : 8;
  }
  const surface = worseSurface(reading.surface, reading.backSurface);
  if ((surface.printLines > 0 || surface.scratches > 0) && grade > 9) grade = 9;
  if (reading.focus === "poor") grade = Math.min(grade, 7.5);
  else if (reading.focus === "soft") grade = Math.min(grade, 9);
  if (label === "Black Label" || label === "Gold Label") {
    grade = 9.5;
    label = null;
  }
  grade = clampHalf(grade);

  const reasons = scores.filter((score) => score.score != null && score.score <= grade).map((score) => `${score.label} ${formatGrade(score.score!, true)}: ${score.caption}`);
  if (missing.length) reasons.unshift(`${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not scored, so the final grade cannot enter Gem Mint.`);
  reasons.push("The lowest subgrade anchors the result. Beckett's own examples rise by half a point when centering and corners are stronger, and by a full point only when the other three are 10s.");

  const bgsConfidence = round2(Math.max(0.28, confidence - 0.04));
  const drop = bgsConfidence < 0.45 ? 1 : 0.5;
  return {
    company: "bgs",
    companyName: STANDARDS.bgs.name,
    grade,
    gradeText: formatGrade(grade, true),
    title: bgsTitle(grade),
    range: [clampHalf(Math.max(1, grade - drop)), grade],
    confidence: bgsConfidence,
    confidenceLabel: confidenceLabel(bgsConfidence),
    summary: `Predicted Beckett ${formatGrade(grade, true)} ${bgsTitle(grade)}. ${label ? "" : "A Pristine 10 or Black Label is not predicted, because those require four 10 subgrades and a look under magnification."}`,
    reasons: unique(reasons).slice(0, 5),
    notAssessed: notAssessed(reading, "Black Label Pristine 10 and the gold-label 10 need subgrades this photo cannot prove."),
    subgrades: scores.map((score) => ({
      label: score.label,
      value: score.score == null ? "—" : formatGrade(score.score, true),
      caption: score.caption,
    })),
    labelNote: STANDARDS.bgs.note,
  };
}

function predictCgc(reading: Reading, confidence: number): GradePrediction {
  const caps: { grade: number; reason: string }[] = [];
  const front = reading.front.centering;
  const back = reading.back.centering;
  const frontPct = front.reliable ? largerPercent(Math.max(front.leftRight, front.topBottom)) : null;
  const backPct = back.reliable ? largerPercent(Math.max(back.leftRight, back.topBottom)) : null;
  const frontRatio = front.reliable ? formatRatio(Math.max(front.leftRight, front.topBottom)) : null;
  let minorItems = 0;

  if (frontPct == null) caps.push({ grade: 9, reason: "Front centering was not measured, so neither Pristine 10 nor Gem Mint 10 is supported." });
  else {
    let centeringGrade = 9.5;
    let centeringReason = `Front centering is ${frontRatio}, inside the about 55/45 figure CGC publishes for Gem Mint 10.`;
    if (frontPct > 85) {
      centeringGrade = 3;
      centeringReason = `Front centering is ${frontRatio}, past the centering CGC describes for very good.`;
    } else if (frontPct > 75) {
      centeringGrade = 4.5;
      centeringReason = `Front centering is ${frontRatio}. CGC's VG/EX+ text allows 85/15 centering on sports cards.`;
    } else if (frontPct > 70) {
      centeringGrade = 6;
      centeringReason = `Front centering is ${frontRatio}, past the 70/30 sports centering CGC attaches to Near Mint 7.`;
    } else if (frontPct > 65) {
      centeringGrade = 7;
      centeringReason = `Front centering is ${frontRatio}. CGC's Near Mint 7 sports centering is about 70/30.`;
    } else if (frontPct > 60) {
      centeringGrade = 8;
      centeringReason = `Front centering is ${frontRatio}. CGC's NM/Mint 8 sports centering is 65/35 or better.`;
    } else if (frontPct > 55) {
      centeringGrade = 9;
      centeringReason = `Front centering is ${frontRatio}. CGC's page gives Gem Mint 10 about 55/45. The 60/40 figure is the sports and non-sports Mint 9 line on that same page.`;
    }
    if (backPct == null) {
      centeringGrade = Math.min(centeringGrade, 9);
      centeringReason += " Back centering was not measured. CGC's Gem Mint 10 reverse figure is 75/25.";
    } else if (backPct > 90) {
      centeringGrade = Math.min(centeringGrade, 7);
      centeringReason += " Back centering is worse than 90/10, the sports-card back figure CGC attaches to Mint 9.";
    } else if (backPct > 75 && centeringGrade > 9) {
      centeringGrade = 9;
      centeringReason += " Back centering misses CGC's 75/25 Gem Mint 10 reverse figure.";
    }
    if (centeringGrade < 9.5) caps.push({ grade: centeringGrade, reason: centeringReason.trim() });
  }

  const corners = tally(reading.corners);
  if (corners.heavy > 0) caps.push({ grade: 4, reason: "A corner is heavily worn. CGC's lower grades are where rounded or damaged corners are described." });
  else if (corners.moderate >= 2) caps.push({ grade: 6, reason: "More than one corner is visibly worn. CGC's EX/NM grades are where dinged corners start." });
  else if (corners.moderate === 1) caps.push({ grade: 7, reason: "One corner is worn beyond a touch. CGC Near Mint allows a touch of wear on several corners, and this is already past a mint card." });
  else if (corners.minor >= 3) caps.push({ grade: 7, reason: "Three or more corners show whitening. CGC's Near Mint 7 text is where wear on three or more corners fits." });
  else if (corners.minor === 2) caps.push({ grade: 8, reason: "Two corners show whitening. That is more than the few minor handling defects in CGC's Mint 9 TCG sentence." });
  else if (corners.minor === 1) {
    minorItems += 1;
    caps.push({ grade: 9, reason: "One corner shows minor whitening. CGC Mint 9 allows minor wear on sharp corners." });
  }

  const edges = tally(reading.edges);
  if (edges.heavy > 0) caps.push({ grade: 5, reason: "An edge is heavily chipped." });
  else if (edges.moderate > 0) caps.push({ grade: 7, reason: "Edge wear is obvious. CGC's Near Mint grades allow slightly rough edges." });
  else if (edges.minor > 0) {
    minorItems += 1;
    caps.push({ grade: 9, reason: "A slight edge flaw is visible. CGC's Mint 9 text allows slight minor flaws on the edges." });
  }

  const surface = worseSurface(reading.surface, reading.backSurface);
  if (surface.crease === "heavy") caps.push({ grade: 2, reason: "A fold crosses the card. CGC's Good grade is where a crease can travel edge to edge." });
  else if (surface.crease === "moderate") caps.push({ grade: 3.5, reason: "A moderate crease is visible. CGC's Very Good+ text allows one moderate crease." });
  else if (surface.crease === "light") caps.push({ grade: 4.5, reason: "One light crease is visible. That matches CGC's VG/EX+ 4.5 wording, not a mint card." });
  if (surface.scratches >= 2) caps.push({ grade: 7, reason: "Scratches are visible. CGC Gem Mint 10 requires a surface devoid of flaws." });
  else if (surface.scratches === 1) caps.push({ grade: 8, reason: "A scratch is visible. CGC Mint 9 allows one minor surface defect, and a scratch the photo can see is already that defect spent." });
  if (surface.printLines >= 2) caps.push({ grade: 8, reason: "More than one print line is visible. CGC treats a few minor manufacturing defects as Mint 9 territory, not Gem Mint." });
  else if (surface.printLines === 1) {
    minorItems += 1;
    caps.push({ grade: 9, reason: "One print line is visible. On a TCG card, CGC's Mint 9 sentence allows a few minor manufacturing defects. It does not meet Gem Mint 10's flawless-surface wording." });
  }
  if (surface.spots >= 2) caps.push({ grade: 8, reason: "More than one spot is visible." });
  else if (surface.spots === 1) {
    minorItems += 1;
    caps.push({ grade: 9, reason: "One spot is visible. CGC Mint 9 allows a small number of specks or one minor spot." });
  }
  if (!reading.surface.reliable && !reading.surfaceReviewed && surface.crease === "none") {
    caps.push({ grade: 9, reason: "The surface is partly hidden, so CGC's Gem Mint requirement of perfect gloss and no surface flaws is not met." });
  }
  if (reading.focus === "poor") caps.push({ grade: 7.5, reason: "The photo cannot show the minor handling defects CGC's upper grades turn on." });
  else if (reading.focus === "soft") caps.push({ grade: 9, reason: "Focus is only fair. CGC Gem Mint 10 corners have to be Mint+ under 10×, which this photo cannot show." });

  let grade = 9.5;
  for (const cap of caps) grade = Math.min(grade, cap.grade);
  if (grade >= 9 && minorItems >= 3) {
    grade = Math.min(grade, 8);
    caps.push({
      grade: 8,
      reason: "Three or more minor flaws are visible at once. CGC's Mint 9 wording for TCG cards allows only a few, so together they land at NM/Mint.",
    });
  }
  if (reading.focus !== "poor" && reading.focus !== "soft" && grade > 9.5) grade = 9.5;
  grade = clampHalf(Math.max(1, grade));

  const reasons = unique(
    caps
      .filter((cap) => cap.grade <= grade + 1)
      .sort((a, b) => a.grade - b.grade)
      .map((cap) => cap.reason),
  ).slice(0, 4);
  if (grade === 9.5) {
    reasons.unshift("The photos are clean enough for CGC Mint+ 9.5. Pristine 10 needs 50/50 centering and a card that is flawless under 10×, and Gem Mint 10 still requires corners to be Mint+ under 10×. Neither is predicted from a photograph.");
  }

  const cgcConfidence = round2(Math.max(0.28, confidence - 0.04));
  const drop = cgcConfidence < 0.45 ? 1 : 0.5;
  return {
    company: "cgc",
    companyName: STANDARDS.cgc.name,
    grade,
    gradeText: formatGrade(grade, true),
    title: cgcTitle(grade),
    range: [clampHalf(Math.max(1, grade - drop)), grade],
    confidence: cgcConfidence,
    confidenceLabel: confidenceLabel(cgcConfidence),
    summary: `Predicted CGC ${formatGrade(grade, true)} ${cgcTitle(grade)}. ${frontRatio ? `Front centering measures ${frontRatio}. ` : ""}Pristine 10 is a separate label and is not used here.`,
    reasons: reasons.length ? reasons : ["No measured flaw in these photos forces CGC below this grade."],
    notAssessed: notAssessed(reading, "CGC's 60/40, 65/35, and 70/30 centering lines are published for sports and non-sports cards. They are applied here as that page's numeric scale and labeled as such."),
    labelNote: STANDARDS.cgc.note,
  };
}

function factorRows(reading: Reading, psaGrade: number, bgs: GradePrediction): FactorRow[] {
  const frontC = reading.front.centering;
  const backC = reading.back.centering;
  const cornerEffect = wearPhrase(tally(reading.corners));
  const edgeEffect = wearPhrase(tally(reading.edges));
  const surface = worseSurface(reading.surface, reading.backSurface);
  return [
    {
      factor: "Centering",
      front: frontC.reliable ? `${axisText(frontC.left, frontC.right, "left", "right")}; ${axisText(frontC.top, frontC.bottom, "top", "bottom")}` : "Not measured",
      back: backC.reliable ? `${axisText(backC.left, backC.right, "left", "right")}; ${axisText(backC.top, backC.bottom, "top", "bottom")}` : "Not measured",
      effect: frontC.reliable ? `Used for the grades. PSA's point grade is ${psaGrade}. Beckett centering subgrade is ${bgs.subgrades?.[0]?.value ?? "—"}.` : "Left out of the numeric grade because the border is not a clean frame.",
      assessed: frontC.reliable && backC.reliable ? "measured" : frontC.reliable || backC.reliable ? "partial" : "not-assessed",
    },
    {
      factor: "Corners",
      front: sideWear(reading.front.corners),
      back: sideWear(reading.back.corners),
      effect: cornerEffect === "none visible" ? "No whitening measured on the corners." : `${cornerEffect}. Whitening lowers the grade. It is not a printing error.`,
      assessed: reading.focus === "poor" ? "not-assessed" : "measured",
    },
    {
      factor: "Edges",
      front: sideWear(reading.front.edges),
      back: sideWear(reading.back.edges),
      effect: edgeEffect === "none visible" ? "No edge run measured." : `${edgeEffect}. Edge chipping is handling wear.`,
      assessed: reading.focus === "poor" ? "not-assessed" : "measured",
    },
    {
      factor: "Surface",
      front: surfacePhrase(reading.surface),
      back: surfacePhrase(reading.backSurface),
      effect: surfaceEffect(surface, reading),
      assessed: reading.surfaceReviewed || (reading.surface.reliable && reading.backSurface.reliable) ? "measured" : reading.surface.crease !== "none" ? "partial" : "partial",
    },
    {
      factor: "Out of reach",
      front: "Loupe, gloss at a raking angle, authenticity",
      back: "Pressed creases, trimmed edges, ink added by hand",
      effect: "These can change a professional grade and cannot be settled from the upload.",
      assessed: "not-assessed",
    },
  ];
}

function limits(front: SideMetrics, back: SideMetrics, reading: Reading): string[] {
  const lines = [
    "A photograph is not a grade. PSA, Beckett, and CGC decide after they have the card.",
    "This desk does not authenticate the card, certify a misprint, or detect trimming and recoloring.",
    "The grade, any collector demand, and the price are three separate judgments.",
    ...front.quality.notes,
    ...back.quality.notes,
  ];
  if (!reading.surface.reliable && !reading.surfaceReviewed) {
    lines.push("Surface gloss and hairline scratches are only partly visible, so they were not used to push the grade down or up.");
  }
  if (!front.centering.reliable) lines.push("Front centering was left out of the numeric grade.");
  return unique(lines);
}

function requests(front: SideMetrics, back: SideMetrics, reading: Reading, closeups: CloseupResult[]): { priority: "needed" | "optional"; text: string }[] {
  const items: { priority: "needed" | "optional"; text: string }[] = [];
  const asked = new Set(closeups.filter((shot) => !shot.inconclusive).map((shot) => shot.kind));
  if (reading.focus !== "sharp" || front.quality.shortSide < 900 || back.quality.shortSide < 900) {
    items.push({ priority: "needed", text: "Retake both sides straight-on, with the card large in the frame and a little of the table showing around all four edges." });
  }
  if (!front.centering.reliable || !back.centering.reliable) {
    items.push({ priority: "needed", text: "Centering needs a square photo where the whole border is visible and the card is not tilted." });
  }
  if (!reading.surface.reliable && !asked.has("surface")) {
    items.push({ priority: "needed", text: "Add a close-up of the front surface under a lamp, tilted just enough to catch scratches without a white glare patch." });
  }
  const wornCorner = reading.corners.some((corner) => corner.severity !== "none");
  if ((wornCorner || reading.focus !== "sharp") && !asked.has("corner")) {
    items.push({ priority: wornCorner ? "needed" : "optional", text: "Add one close-up per corner that looks light. Include a corner you think is clean if you want that corner cleared." });
  }
  if (reading.edges.some((edge) => edge.severity !== "none") && !asked.has("edge")) {
    items.push({ priority: "optional", text: "Add a close-up of the whitened edge, with the colored border filling the frame." });
  }
  return items.slice(0, 4);
}

function notAssessed(reading: Reading, extra: string): string[] {
  const items = [
    "Authentication and alterations such as trimming, pressing, or recoloring",
    "Anything that requires a loupe or 10× magnification",
    extra,
  ];
  if (!reading.surfaceReviewed && !reading.surface.reliable) items.push("Full original gloss on the hidden part of the surface");
  if (!reading.front.centering.reliable) items.push("Front centering");
  if (!reading.back.centering.reliable) items.push("Back centering");
  return items;
}

function photoConfidence(front: SideMetrics, back: SideMetrics, surfaceReviewed: boolean): number {
  let value = 0.66;
  const focus = worseFocus(front.quality.focus, back.quality.focus);
  if (focus === "poor") value -= 0.28;
  else if (focus === "soft") value -= 0.12;
  if (front.quality.perspective || back.quality.perspective) value -= 0.08;
  if (!front.centering.reliable) value -= 0.12;
  if (!back.centering.reliable) value -= 0.06;
  if (!front.surface.reliable && !surfaceReviewed) value -= 0.1;
  if (front.surface.glareFraction > 0.05) value -= 0.05;
  if (front.quality.shortSide < 800 || back.quality.shortSide < 800) value -= 0.08;
  if (surfaceReviewed) value += 0.06;
  return Math.min(0.74, Math.max(0.28, value));
}

function psaSummary(grade: number, frontRatio: string | null): string {
  const name = psaTitle(grade);
  if (grade === 10) {
    return `Predicted PSA 10, ${name}. The photos sit inside the published centering tolerances and show none of the flaws PSA names. This is a candidate. It is not a grade PSA has given the card.`;
  }
  return `Predicted PSA ${grade}, ${name}. ${frontRatio ? `Front centering measures ${frontRatio}. ` : ""}The number is the highest grade the published wording still allows. The band below it is the in-hand risk, not a chance of something higher.`;
}

function psaTitle(grade: number): string {
  return ["", "Poor", "Good", "Very Good", "VG-EX", "Excellent", "EX-MT", "Near Mint", "NM-MT", "Mint", "Gem Mint"][grade] ?? "Graded";
}

function bgsTitle(grade: number): string {
  const names: Record<string, string> = {
    "10": "Pristine",
    "9.5": "Gem Mint",
    "9": "Mint",
    "8.5": "NM-MT+",
    "8": "NM-MT",
    "7.5": "Near Mint+",
    "7": "Near Mint",
    "6.5": "EX-NM+",
    "6": "EX-NM",
    "5.5": "EX+",
    "5": "Excellent",
    "4.5": "VG-EX+",
    "4": "VG-EX",
    "3.5": "VG+",
    "3": "Very Good",
    "2.5": "Good+",
    "2": "Good",
    "1.5": "Fair",
    "1": "Poor",
  };
  return names[formatGrade(grade, true)] ?? "Graded";
}

function cgcTitle(grade: number): string {
  const names: Record<string, string> = {
    "10": "Gem Mint",
    "9.5": "Mint+",
    "9": "Mint",
    "8.5": "NM/Mint+",
    "8": "NM/Mint",
    "7.5": "Near Mint+",
    "7": "Near Mint",
    "6.5": "EX/NM+",
    "6": "EX/NM",
    "5.5": "Excellent+",
    "5": "Excellent",
    "4.5": "VG/EX+",
    "4": "VG/EX",
    "3.5": "Very Good+",
    "3": "Very Good",
    "2.5": "Good+",
    "2": "Good",
    "1.5": "Fair",
    "1": "Poor",
  };
  return names[formatGrade(grade, true)] ?? "Graded";
}

function largerPercent(share: number): number {
  return Math.min(100, Math.max(50, Math.round(share * 100)));
}

function axisText(a: number, b: number, aName: string, bName: string): string {
  const total = a + b;
  if (total <= 0) return "not measured";
  const ratio = formatRatio(Math.max(a, b) / total);
  if (Math.abs(a - b) / total < 0.015) return ratio;
  return a > b ? `${ratio}, ${aName} wider` : `${ratio}, ${bName} wider`;
}

function tally(items: { severity: Severity }[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { none: 0, speck: 0, minor: 0, moderate: 0, heavy: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

function wearPhrase(counts: Record<Severity, number>): string {
  const parts = (["heavy", "moderate", "minor", "speck"] as const).filter((key) => counts[key] > 0).map((key) => `${counts[key]} ${key}`);
  return parts.length ? parts.join(", ") : "none visible";
}

function sideWear(items: { severity: Severity; corner?: string; edge?: string }[]): string {
  const bad = items.filter((item) => item.severity !== "none");
  if (bad.length === 0) return "Clean in the photo";
  return bad.map((item) => `${item.corner ?? item.edge} ${item.severity}`).join(", ");
}

function surfacePhrase(surface: SurfaceRead): string {
  if (!surface.reliable && surface.crease === "none" && surface.printLines === 0 && surface.scratches === 0) {
    return surface.holoLimited ? "Holofoil or a busy image; gloss not scored" : "Not fully visible";
  }
  const parts: string[] = [];
  if (surface.crease !== "none") parts.push(`${surface.crease} crease`);
  if (surface.scratches) parts.push(`${surface.scratches} scratch${surface.scratches === 1 ? "" : "es"}`);
  if (surface.printLines) parts.push(`${surface.printLines} print line${surface.printLines === 1 ? "" : "s"}`);
  if (surface.spots) parts.push(`${surface.spots} spot${surface.spots === 1 ? "" : "s"}`);
  if (surface.glareFraction > 0.04) parts.push("glare present");
  return parts.length ? parts.join(", ") : "No mark stood up to measurement";
}

function surfaceEffect(surface: SurfaceRead, reading: Reading): string {
  if (surface.crease !== "none") return "A crease is damage. It caps every company well below mint, and it is not a misprint.";
  if (surface.printLines > 0) return "A visible print line spends the mint allowance at PSA and CGC and fails Beckett's Gem Mint surface text. It is not priced as an error.";
  if (surface.scratches > 0) return "A scratch breaks gloss. All three companies keep a visibly scratched card out of their top grade.";
  if (!reading.surface.reliable && !reading.surfaceReviewed) return "Hidden surface was not scored. The top grade is withheld until it can be seen.";
  return "Nothing on the surface forced the grade down. A loupe can still find what the photo missed.";
}

function worseSurface(front: SurfaceRead, back: SurfaceRead): SurfaceRead {
  const rank = { none: 0, light: 1, moderate: 2, heavy: 3 };
  const frontWeight = rank[front.crease] * 10 + front.scratches * 3 + front.printLines * 2 + front.spots;
  const backWeight = rank[back.crease] * 10 + back.scratches * 3 + back.printLines * 2 + back.spots;
  const base = backWeight > frontWeight ? back : front;
  return {
    ...base,
    scratches: Math.max(front.scratches, back.scratches),
    printLines: Math.max(front.printLines, back.printLines),
    spots: Math.max(front.spots, back.spots),
    crease: worseCrease(front.crease, back.crease),
  };
}

function worseCrease(a: SurfaceRead["crease"], b: SurfaceRead["crease"]): SurfaceRead["crease"] {
  const rank = { none: 0, light: 1, moderate: 2, heavy: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function worseFocus(a: SideMetrics["quality"]["focus"], b: SideMetrics["quality"]["focus"]): SideMetrics["quality"]["focus"] {
  if (a === "poor" || b === "poor") return "poor";
  if (a === "soft" || b === "soft") return "soft";
  return "sharp";
}

function unique(lines: string[]): string[] {
  return [...new Set(lines.filter(Boolean))];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
