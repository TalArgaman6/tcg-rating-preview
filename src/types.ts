export type SideName = "front" | "back";

export type Severity = "none" | "speck" | "minor" | "moderate" | "heavy";

export type DefectKind =
  | "whitening"
  | "corner"
  | "edge"
  | "scratch"
  | "crease"
  | "fold"
  | "print-line"
  | "print-spot"
  | "glare";

export interface Defect {
  id: string;
  side: SideName | "closeup";
  kind: DefectKind;
  severity: Exclude<Severity, "none"> | "info";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  detail: string;
  gradeImpact: string;
  confidence: number;
  evidence: "visible" | "uncertain";
}

export interface CenteringRead {
  reliable: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Larger side's share of left+right, from 0.5 to 1. */
  leftRight: number;
  topBottom: number;
  note?: string;
}

export interface CornerRead {
  corner: "tl" | "tr" | "bl" | "br";
  severity: Severity;
  fraction: number;
}

export interface EdgeRead {
  edge: "top" | "right" | "bottom" | "left";
  severity: Severity;
  fraction: number;
  run: number;
}

export interface SurfaceRead {
  reliable: boolean;
  holoLimited: boolean;
  glareFraction: number;
  printLines: number;
  scratches: number;
  spots: number;
  crease: "none" | "light" | "moderate" | "heavy";
  note?: string;
}

export interface QualityRead {
  shortSide: number;
  focus: "sharp" | "soft" | "poor";
  perspective: boolean;
  fill: "cropped-margin" | "edge-to-edge";
  notes: string[];
}

export interface SideMetrics {
  centering: CenteringRead;
  corners: CornerRead[];
  edges: EdgeRead[];
  surface: SurfaceRead;
  quality: QualityRead;
}

export interface GradePrediction {
  company: "psa" | "bgs" | "cgc";
  companyName: string;
  grade: number;
  gradeText: string;
  title: string;
  range: [number, number];
  confidence: number;
  confidenceLabel: string;
  summary: string;
  reasons: string[];
  notAssessed: string[];
  subgrades?: { label: string; value: string; caption: string }[];
  labelNote?: string;
}

export interface FactorRow {
  factor: string;
  front: string;
  back: string;
  effect: string;
  assessed: "measured" | "partial" | "not-assessed";
}

export interface FeatureFinding {
  id: string;
  title: string;
  category: "Manufacturing" | "Wear" | "Possible error" | "Identity" | "Demand";
  evidence: string;
  demand: string;
  confidence: number;
  /** Whether this finding, by itself, is evidence of a higher price. */
  valueEffect: "unknown" | "unlikely" | "cited-from-market" | "not-a-premium";
}

export interface MarketEstimate {
  status: "ready" | "needs-card" | "no-price";
  raw?: {
    source: string;
    currency: "USD";
    market: number | null;
    low: number | null;
    high: number | null;
    updatedAt: string | null;
    url: string | null;
    variant: string;
  };
  eur?: {
    trend: number | null;
    low: number | null;
    url: string | null;
    updatedAt: string | null;
  };
  gradedNote: string;
  searchLinks: { label: string; href: string }[];
}

export interface CloseupRequest {
  priority: "needed" | "optional";
  text: string;
}

export interface FactorScore {
  label: string;
  /** Null when the photo cannot support a number. */
  score: number | null;
  caption: string;
}

export interface Opinion {
  grades: GradePrediction[];
  factors: FactorRow[];
  scores: FactorScore[];
  limits: string[];
  requests: CloseupRequest[];
}

export type CloseupKind = "corner" | "edge" | "surface";

export interface CloseupResult {
  kind: CloseupKind;
  clean: boolean;
  foundDamage: boolean;
  inconclusive: boolean;
  note: string;
  defects: Defect[];
}

export interface TcgPrice {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
}

export interface TcgCard {
  id: string;
  name: string;
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  number: string;
  artist?: string;
  rarity?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  set: {
    id: string;
    name: string;
    series?: string;
    printedTotal?: number;
    total?: number;
    releaseDate?: string;
  };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, TcgPrice | undefined>;
  };
  cardmarket?: {
    url?: string;
    updatedAt?: string;
    prices?: {
      averageSellPrice?: number | null;
      lowPrice?: number | null;
      trendPrice?: number | null;
      avg1?: number | null;
      avg7?: number | null;
      avg30?: number | null;
    };
  };
}
