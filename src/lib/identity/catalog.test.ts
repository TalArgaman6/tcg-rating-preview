import { describe, expect, it } from "vitest";
import type { TcgCard } from "../../types";
import { catalogQuery, preferCards } from "./catalog";

describe("catalogQuery", () => {
  it("searches the Pokémon name without a wildcard and keeps the set as a hint", () => {
    expect(catalogQuery("Squirtle base")).toEqual({ q: "name:squirtle", hints: ["base"] });
  });

  it("keeps a collector number in the catalog query", () => {
    expect(catalogQuery("Squirtle 63/102")).toEqual({ q: "name:squirtle number:63", hints: [] });
  });
});

describe("preferCards", () => {
  const cards = [
    card("ecard1-132", "Expedition Base Set", "2002/09/15"),
    card("base4-93", "Base Set 2", "2000/02/24"),
    card("base1-63", "Base", "1999/01/09"),
    card("sv3pt5-170", "151", "2023/09/22"),
    card("base5-68", "Team Rocket", "2000/04/24"),
  ];

  it("puts the closest set name first", () => {
    expect(preferCards(cards, ["base"]).map((item) => item.id)).toEqual([
      "base1-63",
      "base4-93",
      "ecard1-132",
    ]);
  });

  it("does not treat a set id such as base5 as the word base", () => {
    expect(preferCards(cards, ["base"]).map((item) => item.set.name)).not.toContain("Team Rocket");
  });

  it("returns every printing when the extra words match nothing", () => {
    expect(preferCards(cards, ["jungle"]).map((item) => item.id)).toEqual([
      "sv3pt5-170",
      "ecard1-132",
      "base5-68",
      "base4-93",
      "base1-63",
    ]);
  });
});

function card(id: string, setName: string, releaseDate: string): TcgCard {
  return {
    id,
    name: "Squirtle",
    number: id.split("-")[1] ?? "1",
    set: { id: id.split("-")[0] ?? id, name: setName, releaseDate },
  };
}
