/** Published sources the predictor is built from. Numeric bands below are those sources, not a blended hobby scale. */
export const STANDARDS = {
  psa: {
    id: "psa" as const,
    name: "PSA",
    full: "Professional Sports Authenticator",
    url: "https://www.psacard.com/gradingstandards",
    scale: "Whole numbers from 1 to 10. PSA does not use half grades.",
    note: "Gem Mint 10 centering is the current published figure: about 55/45 on the front and 75/25 on the back. PSA says a grader may allow a small variance for eye appeal. This desk does not grant that variance.",
  },
  bgs: {
    id: "bgs" as const,
    name: "Beckett",
    full: "Beckett Grading Services",
    url: "https://www.beckett.com/grading/scale",
    scale: "Half points from 1 to 10, with four printed subgrades: centering, corners, edges, and surface.",
    note: "The final grade is not an average. Beckett's 2018 process note says the lowest subgrade weighs the most, a Gem Mint needs at least three 9.5s with nothing under 9, and the final grade rarely rises more than one point above the lowest subgrade. A Black Label Pristine 10 is four subgrades of 10.",
  },
  cgc: {
    id: "cgc" as const,
    name: "CGC",
    full: "CGC Cards",
    url: "https://www.cgccards.com/card-grading/grading-scale/",
    scale: "Half points from 1 to 10. Pristine 10 and Gem Mint 10 are different labels.",
    note: "Pristine 10 requires 50/50 centering and a card that is flawless under 10× magnification. Gem Mint 10 allows about 55/45 on the front and 75/25 on the back, with corners Mint+ under 10×. The 60/40 Mint 9 centering figure on CGC's page is stated for sports and non-sports cards. The same page judges TCG cards by how many handling defects are visible. Both parts are applied here, and the sports ratio is labeled as such.",
  },
} as const;
