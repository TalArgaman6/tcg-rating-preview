import type { Defect, FeatureFinding, SideMetrics, TcgCard } from "../types";
import { formatRatio } from "./format";

export function collectFeatures(front: SideMetrics, back: SideMetrics, defects: Defect[], card: TcgCard | null, hasPrice: boolean): FeatureFinding[] {
  const findings: FeatureFinding[] = [];
  const frontOff = front.centering.reliable ? Math.max(front.centering.leftRight, front.centering.topBottom) : 0;
  const backOff = back.centering.reliable ? Math.max(back.centering.leftRight, back.centering.topBottom) : 0;
  const worstOff = Math.max(frontOff, backOff);
  if (worstOff >= 0.85) {
    const side = frontOff >= backOff ? "front" : "back";
    findings.push({
      id: "miscut",
      title: "Possible miscut",
      category: "Possible error",
      evidence: `The ${side} border measures about ${formatRatio(worstOff)}. That is far enough off-center to be a factory cut problem, but the photo does not show another card's image in the border.`,
      demand: "Some collectors pay more for a dramatic miscut. Many do not. No completed sale is cited here, so no added value is claimed.",
      confidence: front.centering.reliable || back.centering.reliable ? 0.48 : 0.3,
      valueEffect: "unknown",
    });
  }

  const printLines = Math.max(front.surface.printLines, back.surface.printLines);
  if (printLines > 0 && (front.surface.reliable || back.surface.reliable)) {
    findings.push({
      id: "print-line",
      title: printLines === 1 ? "Factory print line" : "Factory print lines",
      category: "Manufacturing",
      evidence: "A thin straight tone change runs across the inner image. That is a common print artifact, and the photo cannot prove it is a catalogued error.",
      demand: "A print line usually lowers the condition grade. It is not, by itself, a reason to pay more.",
      confidence: 0.62,
      valueEffect: "not-a-premium",
    });
  }

  const crease = [front.surface.crease, back.surface.crease].includes("heavy")
    ? "heavy"
    : [front.surface.crease, back.surface.crease].includes("moderate")
      ? "moderate"
      : [front.surface.crease, back.surface.crease].includes("light")
        ? "light"
        : "none";
  if (crease !== "none") {
    findings.push({
      id: "crease",
      title: crease === "light" ? "Light crease" : "Crease or fold",
      category: "Wear",
      evidence: `A ${crease} linear band is visible. Creases come from handling, not from the printing plates.`,
      demand: "Damage makes a card less desirable, not more. This is not a misprint.",
      confidence: crease === "light" ? 0.5 : 0.72,
      valueEffect: "unlikely",
    });
  }

  if (defects.some((defect) => (defect.kind === "corner" || defect.kind === "edge") && defect.evidence === "visible")) {
    findings.push({
      id: "whitening",
      title: "Edge or corner whitening",
      category: "Wear",
      evidence: "Light, low-saturation pixels sit on the colored border. That is the paper showing through, which is wear.",
      demand: "Whitening lowers condition. It does not identify a valuable variant.",
      confidence: 0.7,
      valueEffect: "not-a-premium",
    });
  }

  if ((front.surface.holoLimited || back.surface.holoLimited) && !card) {
    findings.push({
      id: "holo",
      title: "Busy inner image",
      category: "Demand",
      evidence: "The inner image is visually busy in the way holofoil often is. Sparkle was not counted as scratches.",
      demand: "Holofoil is a finish. Whether this printing is the holo version is a market question, answered only after the card is identified. The shine itself is not an error.",
      confidence: 0.4,
      valueEffect: "unknown",
    });
  }

  if (card) {
    const number = card.set.printedTotal ? `${card.number}/${card.set.printedTotal}` : card.number;
    findings.push({
      id: "identity",
      title: `${card.name} · ${card.set.name} · ${number}`,
      category: "Identity",
      evidence: `You confirmed this English-catalog printing. Rarity: ${card.rarity ?? "not listed"}. Illustrator: ${card.artist ?? "not listed"}. ${card.subtypes?.length ? `Subtype: ${card.subtypes.join(", ")}.` : ""}`.trim(),
      demand: `${card.name} is the Pokémon on the confirmed printing. Demand for that character and that set is what the market price already measures. It is not added again on top, and it does not change the condition grade. A 1st Edition or shadowless stamp is not inferred from the photo — pick that printing if the card shows it.`,
      confidence: 0.86,
      valueEffect: hasPrice ? "cited-from-market" : "unknown",
    });
  }

  if (!findings.some((finding) => finding.category === "Possible error" || finding.category === "Manufacturing")) {
    findings.unshift({
      id: "no-error",
      title: "No recognized error",
      category: "Demand",
      evidence: "Nothing in the photos matches a catalogued misprint. Uneven borders inside normal centering, holofoil sparkle, and photo noise were not promoted to errors.",
      demand: "No feature here is a reason to pay more than the confirmed printing is already worth.",
      confidence: 0.58,
      valueEffect: "unlikely",
    });
  }

  return findings;
}
