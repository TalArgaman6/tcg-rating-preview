import type { TcgCard } from "../../types";

const FIELDS = "id,name,supertype,subtypes,hp,types,number,artist,rarity,nationalPokedexNumbers,set,images,tcgplayer,cardmarket";

export async function searchCards(input: string, signal?: AbortSignal): Promise<TcgCard[]> {
  const { q, hints } = catalogQuery(input);
  const cards = await run(q, signal);
  return preferCards(cards, hints);
}

async function run(query: string, signal?: AbortSignal): Promise<TcgCard[]> {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=250&select=${encodeURIComponent(FIELDS)}`;
  let lastStatus = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
      if (response.ok) {
        const body = (await response.json()) as { data?: TcgCard[] };
        return body.data ?? [];
      }
      lastStatus = response.status;
      if (response.status < 500) break;
    } catch (error) {
      if (isAbort(error)) throw error;
      lastError = error;
    }
    if (attempt < 3) await delay(350 * (attempt + 1), signal);
  }
  if (lastStatus) throw new Error(`The card catalog returned ${lastStatus}.`);
  throw lastError instanceof Error ? lastError : new Error("The catalog could not be reached.");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function catalogQuery(input: string): { q: string; hints: string[] } {
  const trimmed = input.trim();
  const number = trimmed.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
  const name = trimmed
    .replace(/(\d{1,3})\s*\/\s*(\d{1,3})/, " ")
    .replace(/[^A-Za-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = name ? name.split(" ") : [];
  const parts: string[] = [];
  if (tokens[0]) parts.push(`name:${tokens[0].toLowerCase()}`);
  if (number) parts.push(`number:${Number(number[1])}`);
  const hints = tokens.slice(1).map((token) => token.toLowerCase());
  return { q: parts.join(" ") || "name:pikachu", hints };
}

export function preferCards(cards: TcgCard[], hints: string[]): TcgCard[] {
  const ranked = [...cards].sort(byRelease);
  if (hints.length === 0) return ranked;
  const matched = ranked.filter((card) => hints.every((hint) => matchesHint(card, hint)));
  if (matched.length === 0) return ranked;
  return matched.sort((a, b) => matchScore(b, hints) - matchScore(a, hints) || byRelease(a, b));
}

function matchesHint(card: TcgCard, hint: string): boolean {
  if (card.set.id.toLowerCase() === hint || card.number === hint) return true;
  const words = card.set.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => word === hint || (hint.length >= 4 && word.startsWith(hint)));
}

function matchScore(card: TcgCard, hints: string[]): number {
  const set = card.set.name.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    if (set === hint) score += 500;
    else if (set.startsWith(hint)) score += 300;
    else if (set.split(/\s+/).includes(hint)) score += 200;
    else score += 100;
  }
  return score - set.length;
}

function byRelease(a: TcgCard, b: TcgCard): number {
  return (b.set.releaseDate ?? "").localeCompare(a.set.releaseDate ?? "");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
