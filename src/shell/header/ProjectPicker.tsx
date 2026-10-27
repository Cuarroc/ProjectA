import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { HonestState } from "../../design/data/HonestState";
import { Button } from "../../design/controls/Button";
import { Popover } from "../../design/layout/Popover";
import { readActiveProjectId, subscribeActiveProject, writeActiveProjectId } from "../../lib/activeProject";
import { useT } from "../../i18n/useT";
import { listProjects } from "../../lib/ipc/projects";
import type { Project } from "../../types";
import { CREATE_TEXT, PICK_TEXT } from "../texts";
import { ProjectCreateSheet } from "./ProjectCreateSheet";
import "./header.css";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; projects: Project[] };

/** Project picker of the Glass header: shows the active project, opens a list, publishes the choice (V2-F8). */
export function ProjectPicker() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [activeId, setActiveId] = useState(readActiveProjectId);
  const [index, setIndex] = useState(0);
  const base = useId();
  const projects = load.state === "ready" ? load.projects : [];

  const cancelLoad = useRef<() => void>(() => {});
  /** Asks for the list; an answer to an earlier ask, or one after unmount, is dropped. */
  const refresh = useCallback(() => {
    cancelLoad.current();
    let live = true;
    cancelLoad.current = () => { live = false; };
    listProjects().then(
      (list) => { if (live) setLoad({ state: "ready", projects: list }); },
      () => { if (live) setLoad({ state: "error" }); },
    );
  }, []);
  useEffect(() => { refresh(); return () => cancelLoad.current(); }, [refresh]);
  useEffect(() => subscribeActiveProject(setActiveId), []);

  const close = useCallback(() => setOpen(false), []);
  /** The panel body takes focus when it appears, and again when the list replaces the loading note; not while it closes. */
  const focusIn = useCallback((el: HTMLElement | null) => { if (open) el?.focus(); }, [open]);

  const show = () => { setIndex(Math.max(0, projects.findIndex((p) => p.id === activeId))); setOpen(true); refresh(); };
  const pick = (p?: Project) => { if (p) { writeActiveProjectId(p.id); close(); } };
  const onBoxKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : projects.length - 1)) % Math.max(1, projects.length));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(projects[index]);
    }
  };

  const name = projects.find((p) => p.id === activeId)?.name ?? PICK_TEXT.choose;
  return (
    <>
    <Popover
      open={open} onOpenChange={setOpen} className="g-hdr-pick" panelClassName="g-hdr-pick__panel"
      trigger={(p) => (
        <button
          {...p} type="button" className="g-hdr-pick__btn" aria-haspopup="listbox" aria-label={PICK_TEXT.label(t("shell.projectSwitch"), name)}
          onClick={() => (open ? close() : show())}
        >
          <span>{name}</span>
          <svg className="g-shell-ic" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </button>
      )}
    >
      {load.state === "ready" && projects.length > 0 ? (
        <ul
          ref={focusIn} role="listbox" tabIndex={-1} aria-label={t("shell.projectSwitch")} className="g-hdr-pick__list"
          aria-activedescendant={`${base}-${index}`} onKeyDown={onBoxKey}
        >
          {projects.map((p, i) => (
            <li key={p.id} id={`${base}-${i}`} role="option" aria-selected={p.id === activeId} className={i === index ? "is-hot" : undefined} onClick={() => pick(p)}>{p.name}</li>
          ))}
        </ul>
      ) : (
        <div ref={focusIn} tabIndex={-1} className="g-hdr-pick__note" onKeyDown={onBoxKey}>
          {load.state === "loading" && PICK_TEXT.loading}
          {load.state === "error" && <HonestState kind="offline" title={PICK_TEXT.failed} />}
          {load.state === "ready" && <HonestState kind="empty" title={PICK_TEXT.empty} />}
        </div>
      )}
      {load.state === "ready" && <Button onClick={() => { close(); setCreating(true); }}>{CREATE_TEXT.action}</Button>}
    </Popover>
    {creating && <ProjectCreateSheet onClose={() => setCreating(false)} onCreated={(project) => {
      refresh();
      writeActiveProjectId(project.id);
      setCreating(false);
    }} />}
    </>
  );
}
