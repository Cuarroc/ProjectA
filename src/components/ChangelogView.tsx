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

function germanDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
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
  return (
    <section className={`changelog-release${installed ? " changelog-installed" : ""}`} aria-labelledby={id}>
      <div className="changelog-rail">
        <h2 id={id}>v{release.version}</h2>
        <time dateTime={release.date}>{germanDate(release.date)}</time>
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
export default function ChangelogView({ currentVersion }: { currentVersion?: string | null }) {
  const releases = useMemo(() => parseChangelog(changelogSource), []);
  const [showOlder, setShowOlder] = useState(false);
  const shown = showOlder ? releases : releases.slice(0, OPEN_RELEASES);
  const older = releases.length - OPEN_RELEASES;
  return (
    <div className="changelog">
      {releases[0] ? <Highlights release={releases[0]} /> : null}
      <ul className="changelog-legend" aria-label="Legende">
        {TAGS.map((t) => (
          <li key={t.tag}>
            <span className={`changelog-tag changelog-tag-${t.tag}`}>{t.label}</span> {t.hint}
          </li>
        ))}
      </ul>
      {shown.map((release) => (
        <ReleaseSection key={release.version} release={release} installed={release.version === currentVersion} />
      ))}
      {older > 0 && !showOlder ? (
        <button type="button" className="button-ghost changelog-more" onClick={() => setShowOlder(true)}>
          Ältere Versionen anzeigen ({older})
        </button>
      ) : null}
    </div>
  );
}
