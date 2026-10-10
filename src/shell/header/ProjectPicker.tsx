import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { HonestState } from "../../design/data/HonestState";
import { readActiveProjectId, subscribeActiveProject, writeActiveProjectId } from "../../lib/activeProject";
import { useT } from "../../i18n/useT";
import { listProjects } from "../../lib/ipc/projects";
import type { Project } from "../../types";
import { PICK_TEXT } from "../texts";
import "./header.css";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; projects: Project[] };

/** Project picker of the Glass header: shows the active project, opens a list, publishes the choice (V2-F8). */
export function ProjectPicker() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [activeId, setActiveId] = useState(readActiveProjectId);
  const [index, setIndex] = useState(0);
  const base = useId();
  const [root, button] = [useRef<HTMLDivElement>(null), useRef<HTMLButtonElement>(null)];
  const projects = load.state === "ready" ? load.projects : [];

  const refresh = useCallback(() => {
    let live = true;
    listProjects().then(
      (list) => { if (live) setLoad({ state: "ready", projects: list }); },
      () => { if (live) setLoad({ state: "error" }); },
    );
    return () => { live = false; };
  }, []);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => subscribeActiveProject(setActiveId), []);

  const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>('[tabindex="-1"]')?.focus(); }, [open, load.state]);

  const show = () => { setIndex(Math.max(0, projects.findIndex((p) => p.id === activeId))); setOpen(true); refresh(); };
  const pick = (p?: Project) => { if (p) { writeActiveProjectId(p.id); close(true); } };
  const onBoxKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : projects.length - 1)) % Math.max(1, projects.length));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(projects[index]);
    } else if (e.key === "Escape") {
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  const name = projects.find((p) => p.id === activeId)?.name ?? PICK_TEXT.choose;
  return (
    <div className="g-hdr-pick" ref={root}>
      <button
        type="button" ref={button} className="g-hdr-pick__btn" aria-haspopup="listbox" aria-expanded={open} aria-label={PICK_TEXT.label(t("shell.projectSwitch"), name)}
        onClick={() => (open ? close(false) : show())}
      >
        <span>{name}</span>
        <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      {open && (
        <div className="g-hdr-pick__panel">
          {load.state === "ready" && projects.length > 0 ? (
            <ul
              role="listbox" tabIndex={-1} aria-label={t("shell.projectSwitch")} className="g-hdr-pick__list"
              aria-activedescendant={`${base}-${index}`} onKeyDown={onBoxKey}
            >
              {projects.map((p, i) => (
                <li key={p.id} id={`${base}-${i}`} role="option" aria-selected={p.id === activeId} className={i === index ? "is-hot" : undefined} onClick={() => pick(p)}>{p.name}</li>
              ))}
            </ul>
          ) : (
            <div tabIndex={-1} className="g-hdr-pick__note" onKeyDown={onBoxKey}>
              {load.state === "loading" && PICK_TEXT.loading}
              {load.state === "error" && <HonestState kind="offline" title={PICK_TEXT.failed} />}
              {load.state === "ready" && <HonestState kind="empty" title={PICK_TEXT.empty} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
