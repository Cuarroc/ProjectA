import "../../design/controls/controls.css";
import "../../design/forms/forms.css";
import "../../design/glass.css";
import "../../design/inputs/inputs.css";
import { Button } from "../../design/controls/Button";
import { Field } from "../../design/forms/Field";
import { Input } from "../../design/inputs/Input";
import type { AgentProfile } from "../../types";
import { T } from "./profilebudget/texts";

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
    <div className="profile-budget" role="group" aria-label={T.group(profile.name)}>
      <Field label={T.five}>
        {(control) => (
          <Input
            {...control}
            compact
            className="profile-budget-input"
            inputMode="numeric"
            placeholder={T.empty}
            value={budget.five}
            onChange={(event) => onChange(profile.id, { five: event.target.value })}
          />
        )}
      </Field>
      <Field label={T.seven}>
        {(control) => (
          <Input
            {...control}
            compact
            className="profile-budget-input"
            inputMode="numeric"
            placeholder={T.empty}
            value={budget.seven}
            onChange={(event) => onChange(profile.id, { seven: event.target.value })}
          />
        )}
      </Field>
      <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={() => onSave(profile)}>
        {T.save}
      </Button>
    </div>
  );
}
