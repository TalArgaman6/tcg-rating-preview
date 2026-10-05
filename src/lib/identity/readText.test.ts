import { describe, expect, it } from "vitest";
import { pickCardName } from "./readText";

describe("pickCardName", () => {
  it("keeps Pikachu and skips the evolution line above it", () => {
    expect(pickCardName("Basic Pokémon\nPikachu\n40 HP")).toBe("Pikachu");
  });

  it("keeps a stage name instead of the stage label", () => {
    expect(pickCardName("Stage 2\nCharizard")).toBe("Charizard");
  });

  it("uses a later name when the first line is noise", () => {
    expect(pickCardName("the artwork is a forest scene with leaves\nPikachu")).toBe("Pikachu");
  });

  it("drops a lowercase scrap stuck to the name", () => {
    expect(pickCardName("Pikachu sowr")).toBe("Pikachu");
  });

  it("returns nothing when the header has no name", () => {
    expect(pickCardName("Basic\nHP")).toBeNull();
  });
});
