import { useEffect, useRef } from "react";

import { isLastEnabled, useProjectSkillPacks } from "../lib/skills";
import { useFocusTrap } from "../lib/useFocusTrap";
import type { Project } from "../types";

/** Why the last remaining pack refuses to be switched off. */
const LAST_PACK_HINT =
  "Mindestens ein Pack bleibt aktiv — eine leere Auswahl bedeutet für den Core „alle Packs“.";

interface SkillPackDialogProps {
  project: Project;
  onClose: () => void;
}

/**
 * Which skill packs the agents of one project are launched with. Every tick
 * writes straight through, so the dialog has no save button to press.
 */
export default function SkillPackDialog({ project, onClose }: SkillPackDialogProps) {
  const { packs, enabled, loading, error, toggle, saving } = useProjectSkillPacks(project.id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);

  const active = enabled ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Skill-Packs — ${project.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">Skill-Packs — {project.name}</div>
        <div className="modal-body">
          {loading ? <div className="modal-note">Lade Skill-Packs…</div> : null}
          {!loading && packs.length === 0 && error === null ? (
            <div className="modal-note">Keine Skill-Packs installiert.</div>
          ) : null}

          {packs.length > 0 ? (
            <ul className="skill-list">
              {packs.map((pack) => {
                const on = active.includes(pack.id);
                const last = isLastEnabled(active, pack.id);
                return (
                  <li key={pack.id} className="skill-row">
                    <label
                      className="skill-option"
                      title={last ? LAST_PACK_HINT : pack.id}
                    >
                      <input
                        type="checkbox"
                        className="skill-check"
                        checked={on}
                        disabled={enabled === null || last}
                        onChange={(event) => toggle(pack.id, event.target.checked)}
                      />
                      <span className="skill-text">
                        <span className="skill-name">{pack.name}</span>
                        {pack.description === "" ? null : (
                          <span className="skill-description">{pack.description}</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {error ? <div className="modal-note modal-error">{error}</div> : null}
          <div className="modal-note skill-hint" aria-live="polite">
            {saving ? "Speichere…" : "Änderungen werden sofort gespeichert."}
          </div>
          {!loading && active.length === 1 ? (
            <div className="modal-note skill-hint">{LAST_PACK_HINT}</div>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
