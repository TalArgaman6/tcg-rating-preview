import type { GradePrediction, MarketEstimate, TcgCard, TcgPrice } from "../../types";

export interface FinishChoice {
  key: string;
  label: string;
  price: TcgPrice;
}

export function finishChoices(card: TcgCard): FinishChoice[] {
  const prices = card.tcgplayer?.prices ?? {};
  return Object.entries(prices).flatMap(([key, price]) => (price ? [{ key, label: finishLabel(key), price }] : []));
}

export function preferredFinish(card: TcgCard, holoLikely: boolean): string | null {
  const choices = finishChoices(card);
  if (choices.length === 0) return null;
  if (holoLikely) {
    const holo = choices.find((choice) => /holo/i.test(choice.key) && !/reverse/i.test(choice.key));
    if (holo) return holo.key;
  }
  const normal = choices.find((choice) => choice.key === "normal");
  return (normal ?? choices[0]).key;
}

export function estimateMarket(card: TcgCard | null, variant: string | null): MarketEstimate {
  if (!card) {
    return {
      status: "needs-card",
      gradedNote: "A graded price is a different product from a raw card. It is not estimated until the printing is confirmed, and even then only sold comps can price the slab.",
      searchLinks: [],
    };
  }
  const choice = finishChoices(card).find((item) => item.key === variant) ?? finishChoices(card)[0];
  const query = `${card.name} ${card.set.name} ${card.number} pokemon`;
  const links = [
    card.tcgplayer?.url ? { label: "TCGplayer", href: card.tcgplayer.url } : null,
    card.cardmarket?.url ? { label: "Cardmarket", href: card.cardmarket.url } : null,
    { label: "Raw sold listings", href: soldSearch(query) },
    { label: "PSA 10 sold", href: soldSearch(`PSA 10 ${query}`) },
    { label: "PSA 9 sold", href: soldSearch(`PSA 9 ${query}`) },
    { label: "BGS 9.5 sold", href: soldSearch(`BGS 9.5 ${query}`) },
    { label: "CGC 10 sold", href: soldSearch(`CGC 10 ${query}`) },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  const eur = card.cardmarket?.prices;
  const gradedNote =
    "No graded dollar amount is shown. A multiple of the raw price would be a guess, and this desk does not present a guess as a value. The sold-listing links are searches, not completed sales. Check the date, the finish, and the grade on each sale before you treat it as a comp.";

  if (!choice || (choice.price.market == null && choice.price.low == null && choice.price.mid == null)) {
    return {
      status: "no-price",
      gradedNote,
      searchLinks: links,
      eur: eur
        ? { trend: eur.trendPrice ?? null, low: eur.lowPrice ?? null, url: card.cardmarket?.url ?? null, updatedAt: card.cardmarket?.updatedAt ?? null }
        : undefined,
    };
  }

  return {
    status: "ready",
    raw: {
      source: "TCGplayer via the Pokémon TCG API",
      currency: "USD",
      market: choice.price.market ?? null,
      low: choice.price.low ?? null,
      high: choice.price.high ?? null,
      updatedAt: card.tcgplayer?.updatedAt ?? null,
      url: card.tcgplayer?.url ?? null,
      variant: choice.label,
    },
    eur: eur
      ? { trend: eur.trendPrice ?? null, low: eur.lowPrice ?? null, url: card.cardmarket?.url ?? null, updatedAt: card.cardmarket?.updatedAt ?? null }
      : undefined,
    gradedNote,
    searchLinks: links,
  };
}

export function soldSearch(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
}

function finishLabel(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function gradeSearchHint(grades: GradePrediction[]): string {
  return grades.map((grade) => `${grade.companyName} ${grade.gradeText}`).join(", ");
}
