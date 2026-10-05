import { useEffect, useRef, useState } from "react";
import type { Session } from "../App";
import { STANDARDS } from "../lib/grading/standards";
import { finishChoices, gradeSearchHint } from "../lib/market/value";
import { money } from "../lib/format";
import type { CloseupKind, Defect, GradePrediction, TcgCard } from "../types";

export function Report({
  session,
  searching,
  searchError,
  working,
  onSearch,
  onSelect,
  onVariant,
  onCloseup,
  onReset,
}: {
  session: Session;
  searching: boolean;
  searchError: string | null;
  working: string | null;
  onSearch: (query: string) => void;
  onSelect: (card: TcgCard) => void;
  onVariant: (variant: string) => void;
  onCloseup: (kind: CloseupKind, file: File) => void;
  onReset: () => void;
}) {
  const [query, setQuery] = useState("");
  const frontMarks = session.defects.filter((defect) => defect.side === "front");
  const backMarks = session.defects.filter((defect) => defect.side === "back");
  const choices = session.card ? finishChoices(session.card) : [];

  return (
    <main className="sheet">
      <div className="sheet-bar">
        <p>{session.practice ? "Practice card" : "Your photos"}</p>
        <button type="button" className="quiet" onClick={onReset}>
          Start over
        </button>
      </div>
      <p className="banner">{session.ocrNote}</p>
      {working ? <p className="working">{working}</p> : null}

      <CardFlight
        frontSrc={session.frontUrl}
        backSrc={session.backUrl}
        frontMarks={frontMarks}
        backMarks={backMarks}
        frontBounds={session.frontBounds ?? { x: 0, y: 0, w: 1, h: 1 }}
        backBounds={session.backBounds ?? { x: 0, y: 0, w: 1, h: 1 }}
      />

      <section className="block">
        <div className="section-head">
          <h2>Predicted grades</h2>
          <p>Each company is scored on its own published scale. Open a card for the full reasoning.</p>
        </div>
        <div className="slabs">
          {session.opinion.grades.map((grade) => (
            <GradeCard key={grade.company} grade={grade} />
          ))}
        </div>
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Condition</h2>
          <p>The four bars are this desk’s reading. Beckett prints those four as subgrades. PSA and CGC use the same evidence with different cutoffs, so a bar of 9.5 is not a PSA 9.5.</p>
        </div>
        <div className="scores">
          {session.opinion.scores.map((score) => (
            <article key={score.label}>
              <div className="score-top">
                <h3>{score.label}</h3>
                <strong>{score.score == null ? "—" : score.score.toFixed(1).replace(".0", "")}</strong>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: score.score == null ? "0%" : `${score.score * 10}%` }} />
              </div>
              <p>{score.caption}</p>
            </article>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Factor</th>
                <th>Front</th>
                <th>Back</th>
                <th>Effect on the grade</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {session.opinion.factors.map((factor) => (
                <tr key={factor.factor}>
                  <th scope="row">{factor.factor}</th>
                  <td data-label="Front">{factor.front}</td>
                  <td data-label="Back">{factor.back}</td>
                  <td data-label="Effect">{factor.effect}</td>
                  <td data-label="Evidence">
                    <span className={`pill pill-${factor.assessed}`}>{evidenceLabel(factor.assessed)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Special features and errors</h2>
          <p>A feature is listed only when the photo supports it. Value is claimed only when a market price for that exact printing is available, and even then it is not added a second time.</p>
        </div>
        <div className="features">
          {session.features.map((feature) => (
            <article key={feature.id}>
              <header>
                <span>{feature.category}</span>
                <strong>{valueLabel(feature.valueEffect)}</strong>
              </header>
              <h3>{feature.title}</h3>
              <p>{feature.evidence}</p>
              <p>{feature.demand}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Market value</h2>
          <p>Raw price and graded price are different products. {gradeSearchHint(session.opinion.grades)} are the grades to look up, not prices.</p>
        </div>
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) onSearch(query.trim());
          }}
        >
          <label htmlFor="card-search">Find the printing</label>
          <div>
            <input
              id="card-search"
              value={query}
              placeholder="Squirtle base, or Charizard 4/102"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" className="primary" disabled={searching || !query.trim()}>
              {searching ? "Searching" : "Search"}
            </button>
          </div>
        </form>
        {searchError ? <p className="error">{searchError}</p> : null}
        {session.candidates.length > 0 ? (
          <div className="candidates">
            {session.candidates.map((card) => (
              <button type="button" key={card.id} className={session.card?.id === card.id ? "candidate is-on" : "candidate"} onClick={() => onSelect(card)}>
                {card.images?.small ? <img src={card.images.small} alt="" /> : <span className="thumb" />}
                <span>
                  <strong>{card.name}</strong>
                  <em>
                    {card.set.name} · {card.number}
                    {card.set.printedTotal ? `/${card.set.printedTotal}` : ""} · {card.rarity ?? "Rarity unlisted"}
                  </em>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="prices">
          <article>
            <h3>Raw card</h3>
            {session.market.status === "ready" && session.market.raw ? (
              <>
                <p className="price">{money(session.market.raw.market, "USD")}</p>
                <p>
                  TCGplayer market for {session.market.raw.variant}. Low {money(session.market.raw.low, "USD")}, high {money(session.market.raw.high, "USD")}.
                  {session.market.raw.updatedAt ? ` Updated ${session.market.raw.updatedAt}.` : ""} This is an asking-market snapshot, not a promise of what the next sale brings.
                </p>
                {choices.length > 1 ? (
                  <div className="variants">
                    {choices.map((choice) => (
                      <button type="button" key={choice.key} className={session.variant === choice.key ? "is-on" : ""} onClick={() => onVariant(choice.key)}>
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p>{session.market.status === "no-price" ? "This printing has no TCGplayer price in the catalog right now." : "Confirm the printing before a raw price is shown. A guessed card would produce a guessed price."}</p>
            )}
            {session.market.eur?.trend != null ? <p>Cardmarket trend {money(session.market.eur.trend, "EUR")}{session.market.eur.updatedAt ? `, updated ${session.market.eur.updatedAt}` : ""}.</p> : null}
            {session.card ? (
              <p className="fine">
                {session.card.name}, {session.card.set.name}
                {session.card.set.releaseDate ? ` (${session.card.set.releaseDate})` : ""}. {session.card.artist ? `Illustrated by ${session.card.artist}. ` : ""}
                English catalog only. A Japanese or other-language printing is a different market.
              </p>
            ) : null}
          </article>
          <article>
            <h3>After grading</h3>
            <p className="price quiet-price">Not estimated</p>
            <p>{session.market.gradedNote}</p>
            {session.market.searchLinks.length > 0 ? (
              <div className="links">
                {session.market.searchLinks.map((link) => (
                  <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </section>

      <section className="block">
        <div className="section-head">
          <h2>What the photos still cannot settle</h2>
          <p>Add a closer photo only for the area named. A clean close-up raises confidence. It does not turn the card into a pristine 10.</p>
        </div>
        <ul className="limits">
          {session.opinion.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        {session.opinion.requests.length > 0 ? (
          <div className="requests">
            {session.opinion.requests.map((request) => (
              <p key={request.text}>
                <strong>{request.priority === "needed" ? "Needed" : "Useful"}</strong>
                {request.text}
              </p>
            ))}
          </div>
        ) : (
          <p>The first photos were sharp enough that no extra shot is required for this reading.</p>
        )}
        <div className="closeups">
          <CloseupControl kind="corner" label="Corner close-up" onCloseup={onCloseup} />
          <CloseupControl kind="edge" label="Edge close-up" onCloseup={onCloseup} />
          <CloseupControl kind="surface" label="Surface close-up" onCloseup={onCloseup} />
        </div>
        {session.closeups.length > 0 ? (
          <ul className="closeup-notes">
            {session.closeups.map((shot) => (
              <li key={shot.kind}>
                <strong>{shot.kind}</strong> {shot.note}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}

function CardFlight({
  frontSrc,
  backSrc,
  frontMarks,
  backMarks,
  frontBounds,
  backBounds,
}: {
  frontSrc: string;
  backSrc: string;
  frontMarks: Defect[];
  backMarks: Defect[];
  frontBounds: { x: number; y: number; w: number; h: number };
  backBounds: { x: number; y: number; w: number; h: number };
}) {
  const marks = [...frontMarks, ...backMarks];
  const reduced = usePrefersReducedMotion();
  const faceRef = useRef<"front" | "back">("front");
  const prefersStill = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [yaw, setYaw] = useState(prefersStill ? 0 : -14);
  const [pitch, setPitch] = useState(prefersStill ? 0 : 10);
  const [active, setActive] = useState<string | null>(marks[0]?.id ?? null);
  const selected = marks.find((defect) => defect.id === active) ?? null;
  const showingBack = Math.cos((yaw * Math.PI) / 180) < 0;

  useEffect(() => {
    if (!reduced) return;
    setPitch(0);
    setYaw(faceRef.current === "back" ? 180 : 0);
  }, [reduced]);

  function settle(side: "front" | "back") {
    faceRef.current = side;
    setYaw(side === "back" ? (reduced ? 180 : 194) : reduced ? 0 : -14);
    setPitch(reduced ? 0 : 10);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setPitch((ny - 0.5) * 14);
    if (faceRef.current === "back") {
      if (nx < 0.18) {
        faceRef.current = "front";
        setYaw(nx * 20);
        return;
      }
      setYaw(180 + (nx - 0.5) * 16);
      return;
    }
    const spun = nx < 0.38 ? (nx / 0.38) * 20 : 20 + ((nx - 0.38) / 0.62) * 160;
    if (spun > 90) faceRef.current = "back";
    setYaw(spun);
  }

  function choose(id: string, side: Defect["side"]) {
    setActive(id);
    if (side === "front" || side === "back") settle(side);
  }

  return (
    <section className="card-flight" aria-label="Card">
      <div className="flight-stage">
        <div
          className="flight-hit"
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            if (!reduced) settle(faceRef.current);
          }}
        >
          <div
            className="flight-card"
            data-facing={showingBack ? "back" : "front"}
            data-yaw={yaw.toFixed(1)}
            style={{ transform: `rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)` }}
          >
            <div className="flight-core" aria-hidden="true" />
            <CardFace
              side="front"
              src={frontSrc}
              bounds={frontBounds}
              defects={frontMarks}
              active={active}
              away={showingBack}
              onSelect={(id) => {
                setActive(id);
                if (faceRef.current !== "front") settle("front");
              }}
            />
            <CardFace
              side="back"
              src={backSrc}
              bounds={backBounds}
              defects={backMarks}
              active={active}
              away={!showingBack}
              onSelect={(id) => {
                setActive(id);
                if (faceRef.current !== "back") settle("back");
              }}
            />
          </div>
        </div>
      </div>
      {reduced ? (
        <button type="button" className="flight-flip" onClick={() => settle(showingBack ? "front" : "back")}>
          {showingBack ? "Show the front" : "Show the back"}
        </button>
      ) : null}
      <p className="fine">{reduced ? "Use the button to see the other side. Click a mark." : "Move across the card to turn it. Click a mark."}</p>
      {frontMarks.length === 0 ? <p>No mark on the front was strong enough to draw. That is not a gem mint declaration.</p> : null}
      {backMarks.length === 0 ? <p>No mark on the back was strong enough to draw. That is not a gem mint declaration.</p> : null}
      <ul className="marks">
        {marks.map((defect) => (
          <li key={defect.id}>
            <button type="button" className={defect.id === active ? "is-on" : ""} onClick={() => choose(defect.id, defect.side)}>
              <strong>{defect.side === "back" ? "Back" : "Front"} · {defect.title}</strong>
              <em>{defect.evidence === "visible" ? "Visible" : "Uncertain — not used to lower the grade by itself"}</em>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="mark-copy">
          <p>{selected.detail}</p>
          <p>{selected.gradeImpact}</p>
        </div>
      ) : null}
    </section>
  );
}

function CardFace({
  side,
  src,
  bounds,
  defects,
  active,
  away,
  onSelect,
}: {
  side: "front" | "back";
  src: string;
  bounds: { x: number; y: number; w: number; h: number };
  defects: Defect[];
  active: string | null;
  away: boolean;
  onSelect: (id: string) => void;
}) {
  const label = side === "front" ? "Front" : "Back";
  return (
    <div className={`flight-face flight-${side}${away ? " is-away" : ""}`}>
      <div className="flight-sheet">
        <img src={src} alt={`${label} of the card`} draggable={false} style={plateStyle(bounds)} />
        {defects.map((defect) => (
          <button
            key={defect.id}
            type="button"
            className={defect.id === active ? "mark is-on" : "mark"}
            data-kind={defect.kind}
            data-evidence={defect.evidence}
            data-side={defect.side}
            style={markBox(defect)}
            aria-pressed={defect.id === active}
            aria-label={defect.title}
            onClick={() => onSelect(defect.id)}
          />
        ))}
      </div>
    </div>
  );
}

function plateStyle(bounds: { x: number; y: number; w: number; h: number }) {
  const located = bounds.w > 0.2 && bounds.h > 0.2;
  const w = located ? bounds.w : 1;
  const h = located ? bounds.h : 1;
  const x = located ? bounds.x : 0;
  const y = located ? bounds.y : 0;
  return {
    width: `${(100 / w).toFixed(3)}%`,
    height: `${(100 / h).toFixed(3)}%`,
    left: `${((-x / w) * 100).toFixed(3)}%`,
    top: `${((-y / h) * 100).toFixed(3)}%`,
  };
}

function markBox(defect: Defect) {
  return {
    left: `${defect.x * 100}%`,
    top: `${defect.y * 100}%`,
    width: `${Math.max(defect.w * 100, 4)}%`,
    height: `${Math.max(defect.h * 100, 3)}%`,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function CloseupControl({ kind, label, onCloseup }: { kind: CloseupKind; label: string; onCloseup: (kind: CloseupKind, file: File) => void }) {
  return (
    <label className="closeup">
      {label}
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onCloseup(kind, file);
        }}
      />
    </label>
  );
}

function evidenceLabel(value: "measured" | "partial" | "not-assessed"): string {
  if (value === "measured") return "Measured";
  if (value === "partial") return "Partial";
  return "Not assessed";
}

function valueLabel(value: "unknown" | "unlikely" | "cited-from-market" | "not-a-premium"): string {
  if (value === "cited-from-market") return "Already in the market price";
  if (value === "not-a-premium") return "Not a separate premium";
  if (value === "unlikely") return "Unlikely to add value";
  return "No price effect claimed";
}

function GradeCard({ grade }: { grade: GradePrediction }) {
  const [open, setOpen] = useState(false);
  const standard = STANDARDS[grade.company];
  const brief = cardBrief(grade);
  const halves = grade.company !== "psa";
  const detailsId = `${grade.company}-details`;

  return (
    <article className={`slab slab-${grade.company}`}>
      <h3 className="sr-only">{standard.full}</h3>
      <div className="grade-row">
        <CompanyMark company={grade.company} />
        <div>
          <p className="grade-num">{grade.gradeText}</p>
          <p className="grade-title">{grade.title}</p>
        </div>
      </div>
      <p className="band">
        Likely band {formatBand(grade.range[0], halves)}–{formatBand(grade.range[1], halves)}
      </p>
      <dl className="brief">
        <div>
          <dt>In its favor</dt>
          <dd>{brief.good}</dd>
        </div>
        <div>
          <dt>Holding it back</dt>
          <dd>{brief.bad}</dd>
        </div>
      </dl>
      <button type="button" className="read-more" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
        {open ? "Show less" : "Read more"}
      </button>
      {open ? (
        <div className="slab-more" id={detailsId}>
          <p className="summary">{grade.summary}</p>
          <p className="fine">{grade.confidenceLabel}</p>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(grade.confidence * 100)} aria-label={`${grade.companyName} photo confidence`}>
            <span style={{ width: `${Math.round(grade.confidence * 100)}%` }} />
          </div>
          <ul>
            {grade.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {grade.subgrades ? (
            <dl className="subs">
              {grade.subgrades.map((sub) => (
                <div key={sub.label}>
                  <dt>{sub.label}</dt>
                  <dd>{sub.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {grade.labelNote ? <p className="fine">{grade.labelNote}</p> : null}
          <a href={standard.url} target="_blank" rel="noreferrer">
            {standard.name} published scale
          </a>
          <h4>Not established from these photos</h4>
          <ul className="quiet-list">
            {grade.notAssessed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function CompanyMark({ company }: { company: GradePrediction["company"] }) {
  const label = company === "psa" ? "PSA" : company === "bgs" ? "BGS" : "CGC";
  const name = company === "bgs" ? "Beckett" : label;
  return (
    <span className={`company-mark mark-${company}`} role="img" aria-label={name}>
      {label}
    </span>
  );
}

function cardBrief(grade: GradePrediction): { good: string; bad: string } {
  const bad = grade.reasons.map(opening).slice(0, 2).join(" ");
  const goodBits: string[] = [];
  const centering = grade.summary.match(/Front centering measures [^.]+\./);
  if (centering && !grade.reasons.some((reason) => /centering/i.test(reason))) {
    goodBits.push(centering[0].replace("Front centering measures ", "Centering is "));
  }
  for (const sub of grade.subgrades ?? []) {
    const value = Number(sub.value);
    if (value >= 9.5) goodBits.push(`${sub.label} is ${sub.value}.`);
  }
  return {
    good: goodBits.slice(0, 2).join(" ") || "The clean areas of the card still support this grade.",
    bad: bad || "Nothing measured in these photos pulls the grade down.",
  };
}

function opening(text: string): string {
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  if (sentence.length <= 140) return sentence;
  return `${sentence.slice(0, 137).trim()}…`;
}

function formatBand(grade: number, halves: boolean): string {
  if (!halves) return String(Math.round(grade));
  return Number.isInteger(grade) ? String(grade) : grade.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
