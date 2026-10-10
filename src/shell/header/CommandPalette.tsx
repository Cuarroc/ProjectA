import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

import { HonestState } from "../../design/data/HonestState";
import { Kbd } from "../../design/inputs/Kbd";
import { Sheet } from "../../design/layout/Sheet";
import { ROUTES } from "../routes";
import "../../design/inputs/inputs.css";
import "../../design/layout/layout.css";
import "./header.css";

interface Command { path: string; label: string }

/** Every route and tab of the registry is a command: the palette only navigates until agents, PRs and ideas have a backend. */
const COMMANDS: readonly Command[] = ROUTES.flatMap((r) =>
  r.tabs.length ? r.tabs.map((t) => ({ path: t.path, label: `${r.label} · ${t.label}` })) : [{ path: r.path, label: r.label }]);

export const matchCommands = (query: string): Command[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return COMMANDS.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
};

/** Search field in the header (Strg K / Cmd K) that opens the palette on the Sheet. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const base = useId();
  const hits = useMemo(() => matchCommands(query), [query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => { setOpen(false); setQuery(""); setIndex(0); };
  const run = (c: Command | undefined) => {
    if (!c) return;
    window.location.hash = `#${c.path}`;
    close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (hits.length ? (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(hits[index]);
    }
  };

  return (
    <>
      <button type="button" className="g-hdr-search" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM13.5 13.5 17 17" /></svg>
        <span>Seiten und Befehle suchen</span>
        <Kbd>Strg K</Kbd>
      </button>
      <Sheet open={open} onClose={close} aria-label="Befehlspalette">
        <div className="g-hdr-pal" onKeyDown={onKeyDown}>
          <input
            type="search" className="g-hdr-pal__in" placeholder="Seite suchen" aria-label="Suchen oder Befehl eingeben"
            role="combobox" aria-expanded="true" aria-controls={`${base}-list`}
            aria-activedescendant={hits[index] ? `${base}-${index}` : undefined}
            value={query} onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          />
          {hits.length ? (
            <ul id={`${base}-list`} role="listbox" aria-label="Treffer" className="g-hdr-pal__list">
              {hits.map((c, i) => (
                <li key={c.path} id={`${base}-${i}`} role="option" aria-selected={i === index} onClick={() => run(c)}>{c.label}</li>
              ))}
            </ul>
          ) : <HonestState kind="empty" title="Nichts gefunden" hint="Bisher sind nur Seiten durchsuchbar." />}
        </div>
      </Sheet>
    </>
  );
}
