import { useEffect, useRef, useState } from "react";
import type { Session } from "../App";
import { STANDARDS } from "../lib/grading/standards";
import { finishChoices, gradeSearchHint } from "../lib/market/value";
import { money } from "../lib/format";
import type { CloseupKind, Defect, TcgCard } from "../types";

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

      <section className="viewers">
        <Viewer title="Front" src={session.frontUrl} defects={frontMarks} />
        <Viewer title="Back" src={session.backUrl} defects={backMarks} />
      </section>

      <section className="block">
        <div className="section-head">
          <h2>Predicted grades</h2>
          <p>Each company is scored on its own published scale. The high end of a band is the prediction. The low end is how far it could fall once the card is in hand.</p>
        </div>
        <div className="slabs">
          {session.opinion.grades.map((grade) => {
            const standard = STANDARDS[grade.company];
            return (
              <article key={grade.company} className={`slab slab-${grade.company}`}>
                <header>
                  <h3>{standard.full}</h3>
                  <span>{grade.confidenceLabel}</span>
                </header>
                <p className="eyebrow">Predicted {grade.companyName}</p>
                <p className="grade-num">{grade.gradeText}</p>
                <p className="grade-title">{grade.title}</p>
                <p className="band">
                  Likely band {formatBand(grade.range[0], grade.company !== "psa")}–{formatBand(grade.range[1], grade.company !== "psa")}
                </p>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(grade.confidence * 100)} aria-label={`${grade.companyName} photo confidence`}>
                  <span style={{ width: `${Math.round(grade.confidence * 100)}%` }} />
                </div>
                <p className="summary">{grade.summary}</p>
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
                <p className="fine">{grade.labelNote}</p>
                <a href={standard.url} target="_blank" rel="noreferrer">
                  {standard.name} published scale
                </a>
                <h4>Not established from these photos</h4>
                <ul className="quiet-list">
                  {grade.notAssessed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            );
          })}
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

function Viewer({ title, src, defects }: { title: string; src: string; defects: Defect[] }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState<string | null>(defects[0]?.id ?? null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const selected = defects.find((defect) => defect.id === active) ?? null;

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => clamp(current * (event.deltaY > 0 ? 0.92 : 1.08), 1, 5));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <article className="viewer">
      <header>
        <h2>{title}</h2>
        <div>
          <button type="button" onClick={() => setZoom((current) => clamp(current / 1.2, 1, 5))} aria-label={`Zoom out ${title}`}>
            −
          </button>
          <button type="button" onClick={() => setZoom((current) => clamp(current * 1.2, 1, 5))} aria-label={`Zoom in ${title}`}>
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
        </div>
      </header>
      <div
        className="stage"
        ref={frame}
        onDoubleClick={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".mark")) return;
          drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div className="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <img src={src} alt={`${title} of the card, cropped to the card edges`} />
          {defects.map((defect) => (
            <button
              key={defect.id}
              type="button"
              className={defect.id === active ? "mark is-on" : "mark"}
              data-kind={defect.kind}
              data-evidence={defect.evidence}
              style={{ left: `${defect.x * 100}%`, top: `${defect.y * 100}%`, width: `${Math.max(defect.w * 100, 4)}%`, height: `${Math.max(defect.h * 100, 3)}%` }}
              aria-pressed={defect.id === active}
              aria-label={defect.title}
              onClick={() => setActive(defect.id)}
            />
          ))}
        </div>
      </div>
      <p className="fine">Scroll to zoom. Drag to move. Click a mark.</p>
      {defects.length === 0 ? <p>No mark on this side was strong enough to draw. That is not a gem mint declaration.</p> : null}
      <ul className="marks">
        {defects.map((defect) => (
          <li key={defect.id}>
            <button type="button" className={defect.id === active ? "is-on" : ""} onClick={() => setActive(defect.id)}>
              <strong>{defect.title}</strong>
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
    </article>
  );
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

function formatBand(grade: number, halves: boolean): string {
  if (!halves) return String(Math.round(grade));
  return Number.isInteger(grade) ? String(grade) : grade.toFixed(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
