import { useEffect, useRef, useState } from "react";
import { Report } from "./components/Report";
import { collectFeatures } from "./lib/features";
import { assessCard } from "./lib/grading/predict";
import { searchCards } from "./lib/identity/catalog";
import { readCardText } from "./lib/identity/readText";
import { frameCard, renderPlate } from "./lib/cardFrame";
import { fileToRaster, rasterToDataUrl } from "./lib/images";
import { estimateMarket, preferredFinish } from "./lib/market/value";
import { practiceBack, practiceFront } from "./lib/sampleCard";
import { analyzeCloseup, analyzeRaster } from "./lib/vision/analyze";
import type { Raster } from "./lib/vision/raster";
import type { CloseupKind, CloseupResult, Defect, FeatureFinding, MarketEstimate, Opinion, SideMetrics, TcgCard } from "./types";

export interface Session {
  practice: boolean;
  frontUrl: string;
  backUrl: string;
  frontBounds: { x: number; y: number; w: number; h: number };
  backBounds: { x: number; y: number; w: number; h: number };
  front: SideMetrics;
  back: SideMetrics;
  defects: Defect[];
  closeups: CloseupResult[];
  opinion: Opinion;
  features: FeatureFinding[];
  candidates: TcgCard[];
  card: TcgCard | null;
  variant: string | null;
  market: MarketEstimate;
  ocrNote: string;
}

export function App() {
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  async function inspectFiles() {
    if (!frontFile || !backFile) return;
    setError(null);
    try {
      setWorking("Measuring the front");
      await pause();
      const front = await fileToRaster(frontFile);
      setWorking("Measuring the back");
      await pause();
      const back = await fileToRaster(backFile);
      const next = buildSession(front, back, false);
      setSession(next);
      setWorking("Reading the name and number");
      await identify(front, next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photos could not be read.");
    } finally {
      setWorking(null);
    }
  }

  async function inspectPractice() {
    setError(null);
    setWorking("Measuring the practice card");
    await pause();
    setSession(buildSession(practiceFront(), practiceBack(), true));
    setWorking(null);
  }

  async function identify(front: Raster, current: Session) {
    try {
      const text = await readCardText(front);
      if (text.name?.toLowerCase() === "practice") return;
      const query = [text.name, text.number].filter(Boolean).join(" ");
      const note = query
        ? `Read from the photo: ${query}. Confirm the printing before any price is used.`
        : "No English name or collector number could be read. Search for the card if you want a price.";
      setSession((latest) => (latest ? { ...latest, ocrNote: note } : latest));
      if (query) await lookup(query);
    } catch {
      setSession((latest) =>
        latest && latest === current
          ? { ...latest, ocrNote: "The name could not be read. The grades do not depend on it. Search below if you want a market price." }
          : latest,
      );
    }
  }

  async function lookup(query: string) {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setSearchError(null);
    try {
      const cards = await searchCards(query, controller.signal);
      setSession((latest) => (latest ? { ...latest, candidates: cards } : latest));
      if (cards.length === 0) setSearchError("No English-catalog card matched that search.");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setSearchError(caught instanceof Error ? caught.message : "The catalog could not be reached.");
    } finally {
      setSearching(false);
    }
  }

  function chooseCard(card: TcgCard) {
    setSession((latest) => {
      if (!latest) return latest;
      const variant = preferredFinish(card, latest.front.surface.holoLimited);
      const market = estimateMarket(card, variant);
      return {
        ...latest,
        card,
        variant,
        market,
        features: collectFeatures(latest.front, latest.back, latest.defects, card, market.status === "ready"),
      };
    });
  }

  function chooseVariant(variant: string) {
    setSession((latest) => {
      if (!latest) return latest;
      const market = estimateMarket(latest.card, variant);
      return {
        ...latest,
        variant,
        market,
        features: collectFeatures(latest.front, latest.back, latest.defects, latest.card, market.status === "ready"),
      };
    });
  }

  async function addCloseup(kind: CloseupKind, file: File) {
    if (!session) return;
    setWorking("Reading the close-up");
    try {
      const raster = await fileToRaster(file, 1600);
      const result = analyzeCloseup(raster, kind);
      setSession((latest) => {
        if (!latest) return latest;
        const closeups = [...latest.closeups.filter((shot) => shot.kind !== kind), result];
        const opinion = assessCard(latest.front, latest.back, closeups);
        return { ...latest, closeups, opinion };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The close-up could not be read.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="desk">
      <header className="top">
        <div>
          <p className="kicker">Pokémon pre-grade</p>
          <h1>Grading Desk</h1>
        </div>
        <p className="lede">
          Condition, collector demand, and price are scored apart. The grades follow the published wording of PSA, Beckett, and CGC, and they stay inside what the photos can actually show.
        </p>
      </header>

      {session ? (
        <Report
          session={session}
          searching={searching}
          searchError={searchError}
          working={working}
          onSearch={(query) => void lookup(query)}
          onSelect={chooseCard}
          onVariant={chooseVariant}
          onCloseup={(kind, file) => void addCloseup(kind, file)}
          onReset={() => {
            setSession(null);
            setError(null);
            setSearchError(null);
          }}
        />
      ) : (
        <Upload
          frontFile={frontFile}
          backFile={backFile}
          working={working}
          error={error}
          onFront={setFrontFile}
          onBack={setBackFile}
          onRun={() => void inspectFiles()}
          onPractice={() => void inspectPractice()}
        />
      )}
    </div>
  );
}

function buildSession(frontRaster: Raster, backRaster: Raster, practice: boolean): Session {
  const frontVision = analyzeRaster(frontRaster, { side: "front", shortSide: Math.min(frontRaster.width, frontRaster.height) });
  const backVision = analyzeRaster(backRaster, { side: "back", shortSide: Math.min(backRaster.width, backRaster.height) });
  const defects = [...frontVision.defects, ...backVision.defects];
  const opinion = assessCard(frontVision.metrics, backVision.metrics, []);
  const market = estimateMarket(null, null);
  return {
    practice,
    frontUrl: rasterToDataUrl(frontRaster),
    backUrl: rasterToDataUrl(backRaster),
    frontBounds: frontVision.bounds,
    backBounds: backVision.bounds,
    front: frontVision.metrics,
    back: backVision.metrics,
    defects,
    closeups: [],
    opinion,
    features: collectFeatures(frontVision.metrics, backVision.metrics, defects, null, false),
    candidates: [],
    card: null,
    variant: null,
    market,
    ocrNote: practice
      ? "This is a drawn practice card with a whitened corner, a print line, and a short whitened edge. It is not a real Pokémon card."
      : "Looking for a name and number…",
  };
}

function Upload({
  frontFile,
  backFile,
  working,
  error,
  onFront,
  onBack,
  onRun,
  onPractice,
}: {
  frontFile: File | null;
  backFile: File | null;
  working: string | null;
  error: string | null;
  onFront: (file: File) => void;
  onBack: (file: File) => void;
  onRun: () => void;
  onPractice: () => void;
}) {
  return (
    <section className="intake">
      <div className="drops">
        <CardSlot label="Front" file={frontFile} onFile={onFront} />
        <CardSlot label="Back" file={backFile} onFile={onBack} />
      </div>
      <div className="intake-copy">
        <h2>Both sides, then a closer look if the first photos are soft.</h2>
        <ul>
          <li>Shoot straight down, with a little of the table visible around the card.</li>
          <li>Use light that shows the surface without a white glare patch.</li>
          <li>The desk will ask for corner, edge, or surface close-ups when a call would otherwise be a guess.</li>
        </ul>
        <div className="actions">
          <button type="button" className="primary" disabled={!frontFile || !backFile || Boolean(working)} onClick={onRun}>
            {working ?? "Read both sides"}
          </button>
          <button type="button" className="quiet" disabled={Boolean(working)} onClick={onPractice}>
            Inspect a practice card
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <p className="fine">Photographs are not authentication and not a professional grade.</p>
      </div>
    </section>
  );
}

function CardSlot({ label, file, onFile }: { label: string; file: File | null; onFile: (file: File) => void }) {
  const [plate, setPlate] = useState<string | null>(null);
  const [framing, setFraming] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPlate(null);
      setFrameError(null);
      return;
    }
    let cancel = false;
    setFraming(true);
    setFrameError(null);
    fileToRaster(file, 1200)
      .then((raster) => {
        if (cancel) return;
        setPlate(renderPlate(frameCard(raster), "frost"));
      })
      .catch((caught: unknown) => {
        if (cancel) return;
        setPlate(null);
        setFrameError(caught instanceof Error ? caught.message : "The photo could not be framed.");
      })
      .finally(() => {
        if (!cancel) setFraming(false);
      });
    return () => {
      cancel = true;
    };
  }, [file]);

  return (
    <div className="slot">
      <label
        className={plate ? "drop card-frame has-file" : "drop card-frame"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const next = event.dataTransfer.files[0];
          if (next) onFile(next);
        }}
      >
        {plate ? <img className="crop" src={plate} alt="" /> : <span className="frame-guide" aria-hidden="true" />}
        <span className="slot-copy">
          <span>{label}</span>
          <strong>{framing ? "Finding the card" : file ? "Replace photo" : "Drop a photo or click to choose"}</strong>
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) onFile(next);
          }}
        />
      </label>
      {frameError ? <p className="error">{frameError}</p> : null}
    </div>
  );
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
