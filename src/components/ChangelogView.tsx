import { useMemo, useState } from "react";

import changelogSource from "../../CHANGELOG.md?raw";
import { parseChangelog, type ChangelogItem, type ChangelogTag, type Release } from "../lib/changelog";

const OPEN_RELEASES = 5;
const MAX_PR_CHIPS = 6;

const TAGS: ReadonlyArray<{ tag: ChangelogTag; label: string; hint: string }> = [
  { tag: "new", label: "Neu", hint: "neue Fähigkeit" },
  { tag: "improved", label: "Verbessert", hint: "besser als vorher" },
  { tag: "fix", label: "Behoben", hint: "Fehler beseitigt" },
  { tag: "security", label: "Sicherheit", hint: "Schutz und Daten" },
  { tag: "internal", label: "Intern", hint: "Werkzeuge und Ablauf" },
];
const LABEL = Object.fromEntries(TAGS.map((t) => [t.tag, t.label])) as Record<ChangelogTag, string>;

/** `dd.mm.yyyy` for a real calendar date in ISO form, otherwise null. */
function germanDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function PrRefs({ prs }: { prs: number[] }) {
  if (prs.length === 0) return null;
  const rest = prs.length - MAX_PR_CHIPS;
  return (
    <span className="changelog-refs">
      {prs.slice(0, MAX_PR_CHIPS).map((n) => `#${n}`).join(" ")}
      {rest > 0 ? ` +${rest}` : ""}
    </span>
  );
}

function Entry({ item }: { item: ChangelogItem }) {
  return (
    <li>
      <span className={`changelog-tag changelog-tag-${item.tag}`}>{LABEL[item.tag]}</span>
      <span className="changelog-text">
        {item.title ? <strong>{item.title}</strong> : null}
        {item.title && item.text ? " " : null}
        {item.text} <PrRefs prs={item.prs} />
      </span>
    </li>
  );
}

function ReleaseSection({ release, installed }: { release: Release; installed: boolean }) {
  const id = `changelog-v${release.version}`;
  const count = release.groups.reduce((n, g) => n + g.items.length, 0);
  const date = germanDate(release.date);
  return (
    <section className={`changelog-release${installed ? " changelog-installed" : ""}`} aria-labelledby={id}>
      <div className="changelog-rail">
        <h2 id={id}>v{release.version}</h2>
        {date ? <time dateTime={release.date}>{date}</time> : <time>Datum unbekannt</time>}
        <span className="changelog-pills">
          {release.beta ? <span className="changelog-pill changelog-pill-beta">Beta</span> : null}
          {installed ? <span className="changelog-pill changelog-pill-installed">Installiert</span> : null}
        </span>
        <span className="changelog-count">{count} Einträge</span>
      </div>
      <div className="changelog-entries">
        {release.notes.map((note) => (
          <p key={note} className="changelog-note">
            {note}
          </p>
        ))}
        {release.groups.map((group, i) => (
          <div key={`${group.title}-${i}`} className="changelog-group">
            {group.title ? <h3>{group.title}</h3> : null}
            <ul>
              {group.items.map((item, j) => (
                <Entry key={j} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Highlights({ release }: { release: Release }) {
  const picks = release.groups
    .map((g) => g.items.find((i) => i.title && i.tag !== "internal"))
    .filter((i): i is ChangelogItem => !!i)
    .slice(0, 3);
  if (picks.length === 0) return null;
  return (
    <section className="changelog-highlights" aria-labelledby="changelog-highlights-h">
      <h2 id="changelog-highlights-h">Die größten Änderungen in v{release.version}</h2>
      <div className="changelog-cards">
        {picks.map((item, i) => (
          <article key={item.title} className={`changelog-card${i === 0 ? " changelog-card-lead" : ""}`}>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
            <PrRefs prs={item.prs} />
          </article>
        ))}
      </div>
    </section>
  );
}

/** The app's changelog ("Neuigkeiten"), rendered from the repository's CHANGELOG.md. */
export default function ChangelogView({
  currentVersion,
  source = changelogSource,
}: {
  currentVersion?: string | null;
  source?: string;
}) {
  const releases = useMemo(() => parseChangelog(source), [source]);
  const [showOlder, setShowOlder] = useState(false);
  const shown = showOlder ? releases : releases.slice(0, OPEN_RELEASES);
  const older = releases.length - OPEN_RELEASES;
  return (
    <div className="changelog">
      <header className="view-head changelog-head">
        <h2>Neuigkeiten</h2>
      </header>
      {releases.length === 0 ? (
        <p className="changelog-empty" role="status">
          <strong>Keine Neuigkeiten vorhanden</strong>
          Der Änderungsverlauf ist leer oder konnte nicht gelesen werden. Die Neuigkeiten erscheinen mit der nächsten Version.
        </p>
      ) : (
        <>
          <Highlights release={releases[0]} />
          <ul className="changelog-legend" aria-label="Legende">
            {TAGS.map((t) => (
              <li key={t.tag}>
                <span className={`changelog-tag changelog-tag-${t.tag}`}>{t.label}</span> {t.hint}
              </li>
            ))}
          </ul>
        </>
      )}
      {shown.map((release) => (
        <ReleaseSection key={release.version} release={release} installed={release.version === currentVersion} />
      ))}
      {older > 0 && !showOlder ? (
        <button type="button" className="button-subtle changelog-more" onClick={() => setShowOlder(true)}>
          Ältere Versionen anzeigen ({older})
        </button>
      ) : null}
    </div>
  );
}
