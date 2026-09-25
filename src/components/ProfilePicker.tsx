import { useEffect, useRef } from "react";

import { useFocusTrap } from "../lib/useFocusTrap";
import type { AgentProfile, RoleVariant } from "../types";

interface ProfilePickerProps {
  profiles: AgentProfile[];
  /**
   * Curated roles offered alongside their base profile. Optional so a caller
   * with nothing to offer keeps the plain roster it has always shown.
   */
  variants?: RoleVariant[];
  loading: boolean;
  error: string | null;
  /** `variant` is absent for a plain profile pick — that is the old behaviour. */
  onPick: (profile: AgentProfile, variant?: RoleVariant) => void;
  onClose: () => void;
}

/**
 * A proposal is not a tool: only what the user has already accepted may be
 * spawned from here, and a first version needs no version in its label.
 */
export function variantLabel(profile: AgentProfile, variant: RoleVariant): string {
  const version = variant.version > 1 ? ` v${variant.version}` : "";
  return `${profile.name} · ${variant.name}${version}`;
}

export default function ProfilePicker({
  profiles,
  variants = [],
  loading,
  error,
  onPick,
  onClose,
}: ProfilePickerProps) {
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, [profiles]);

  const approved = variants.filter((variant) => variant.status === "approved");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Choose an agent profile"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">New session</div>
        {loading ? <div className="modal-note">Loading profiles…</div> : null}
        {error ? <div className="modal-note modal-error">{error}</div> : null}
        {!loading && !error && profiles.length === 0 ? (
          <div className="modal-note">No agent profiles configured.</div>
        ) : null}
        <ul className="profile-list">
          {profiles.map((profile, index) => {
            const command = [profile.command, ...profile.args].join(" ");
            const own = approved.filter((variant) => variant.baseProfileId === profile.id);
            return [
              <li key={profile.id}>
                <button
                  type="button"
                  className="profile-item"
                  ref={index === 0 ? firstItemRef : undefined}
                  onClick={() => onPick(profile)}
                >
                  <span className="profile-name">{profile.name}</span>
                  <span className="profile-command">{command}</span>
                </button>
              </li>,
              // Indented right under the profile they specialise, so the
              // relationship survives even in a long roster.
              ...own.map((variant) => (
                <li key={variant.id}>
                  <button
                    type="button"
                    className="profile-item profile-item-variant"
                    title={variant.patternLabel === "" ? undefined : variant.patternLabel}
                    onClick={() => onPick(profile, variant)}
                  >
                    <span className="profile-name">{variantLabel(profile, variant)}</span>
                    <span className="profile-command">{command}</span>
                  </button>
                </li>
              )),
            ];
          })}
        </ul>
        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
