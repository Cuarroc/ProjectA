import type { AgentProfile } from "../../types";

/**
 * State, validation and saving stay in `SettingsView`; this block only renders
 * the two budget fields and the save button of one profile row.
 */
export interface ProfileBudgetFieldsProps {
  profile: AgentProfile;
  budget: { five: string; seven: string };
  busy: boolean;
  onChange: (profileId: string, patch: { five?: string; seven?: string }) => void;
  onSave: (profile: AgentProfile) => void;
}

export default function ProfileBudgetFields({
  profile,
  budget,
  busy,
  onChange,
  onSave,
}: ProfileBudgetFieldsProps) {
  return (
    <div className="profile-budget">
      <label htmlFor={`budget-5h-${profile.id}`}>5 h</label>
      <input
        id={`budget-5h-${profile.id}`}
        className="field profile-budget-input"
        inputMode="numeric"
        placeholder="—"
        value={budget.five}
        onChange={(event) => onChange(profile.id, { five: event.target.value })}
      />
      <label htmlFor={`budget-7d-${profile.id}`}>7 T.</label>
      <input
        id={`budget-7d-${profile.id}`}
        className="field profile-budget-input"
        inputMode="numeric"
        placeholder="—"
        value={budget.seven}
        onChange={(event) => onChange(profile.id, { seven: event.target.value })}
      />
      <button
        type="button"
        className="button-primary"
        disabled={busy}
        onClick={() => onSave(profile)}
      >
        {busy ? "…" : "Budget"}
      </button>
    </div>
  );
}
