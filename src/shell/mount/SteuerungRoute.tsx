import { HonestState } from "../../design/data/HonestState";
import { useT } from "../../i18n/useT";
import { KontingenteScreen } from "../../screens/steuerung/KontingenteScreen";
import { resolveRoute } from "../routes";

/** Kontingente is the default tab of Steuerung; the other two tabs have no screen yet. */
export default function SteuerungRoute({ path }: { path: string }) {
  const t = useT();
  const found = resolveRoute(path);
  const tabs = found?.route.tabs ?? [];
  const title = found?.tab?.label ?? found?.route.label ?? "";
  return (
    <div className="g-sr">
      <nav className="g-shell-tabs" aria-label={t("tab.aria")}>
        {tabs.map((tab) => (
          <a key={tab.path} href={`#${tab.path}`} aria-current={tab === found?.tab ? "page" : undefined}>{tab.label}</a>
        ))}
      </nav>
      {found?.tab?.path === "/steuerung" ? (
        <KontingenteScreen />
      ) : (
        <section className="g-glass g-sr-pane" aria-labelledby="g-sr-title">
          <h1 id="g-sr-title">{title}</h1>
          <HonestState kind="offline" title={t("shell.notConnected")} />
        </section>
      )}
    </div>
  );
}
