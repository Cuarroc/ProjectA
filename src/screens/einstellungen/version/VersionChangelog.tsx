import { useMemo } from "react";
import changelogSource from "../../../../CHANGELOG.md?raw";
import { Chip } from "../../../design/controls/Chip";
import { HonestState } from "../../../design/data/HonestState";
import { useT } from "../../../i18n/useT";
import { parseChangelog } from "../../../lib/changelog";
import "./version.css";

/** A brief view of the same bundled changelog as the classic Neuigkeiten view. */
export function VersionChangelog({ source = changelogSource }: { source?: string }) {
  const t = useT();
  const releases = useMemo(() => parseChangelog(source)
    .sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }))
    .slice(0, 3), [source]);
  const brief = (text: string) => text.length > 160 ? `${text.slice(0, 159)}…` : text;
  return (
    <section className="es-changelog" aria-label={t("settings.changelog.title")}>
      <h3>{t("settings.changelog.title")}</h3>
      {releases.length === 0 ? <HonestState kind="empty" title={t("settings.changelog.empty")} /> : (
        <>
          <p className="es-note">{t("settings.changelog.summary")}</p>
          {releases.map((release) => {
            const items = release.groups.flatMap((group) => group.items).slice(0, 3);
            return (
              <article key={release.version}>
                <header>
                  <h4>{`v${release.version}`}</h4>
                  <time dateTime={release.date}>{release.date.split("-").reverse().join(".")}</time>
                  {release.beta ? <Chip size="sm">{t("settings.changelog.beta")}</Chip> : null}
                </header>
                {items.length > 0 ? (
                  <ul>{items.map((item, index) => (
                    <li key={index}>{brief(item.title ?? item.text)}</li>
                  ))}</ul>
                ) : <p className="es-note">{brief(release.notes[0] ?? t("settings.changelog.empty"))}</p>}
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
