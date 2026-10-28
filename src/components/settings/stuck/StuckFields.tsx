import { Button } from "../../../design/controls/Button";
import { Field } from "../../../design/forms/Field";
import { Input } from "../../../design/inputs/Input";
import "../../../design/controls/controls.css";
import "../../../design/forms/forms.css";
import "../../../design/inputs/inputs.css";
import { T } from "./texts";

interface StuckFieldsProps {
  stuckInput: string;
  setStuckInput: (value: string) => void;
  savingStuck: boolean;
  handleSaveStuck: () => void;
  stuckError: string | null;
}

export default function StuckFields({ stuckInput, setStuckInput, savingStuck, handleSaveStuck, stuckError }: StuckFieldsProps) {
  return (
    <div className="settings-field" role="group" title={T.label}>
      <Field
        label={T.label}
        hint={<>{T.hintStart} <em>{T.simultaneous}</em> {T.hintEnd}</>}
        error={stuckError}
      >
        {(control) => (
          <div className="settings-port-row">
            <Input
              {...control}
              inputMode="numeric"
              placeholder={T.placeholder}
              value={stuckInput}
              onChange={(event) => setStuckInput(event.target.value)}
            />
            <Button variant="primary" loading={savingStuck} disabled={savingStuck} onClick={handleSaveStuck}>
              {T.save}
            </Button>
          </div>
        )}
      </Field>
    </div>
  );
}
