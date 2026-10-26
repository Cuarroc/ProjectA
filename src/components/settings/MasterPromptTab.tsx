import { useId } from "react";

import "../../design/controls/controls.css";
import "../../design/forms/forms.css";
import "../../design/inputs/inputs.css";
import { Button } from "../../design/controls/Button";
import { Field } from "../../design/forms/Field";
import { SwitchField } from "../../design/forms/SwitchField";
import { Textarea } from "../../design/inputs/Input";
import { masterPromptTexts as t } from "./masterprompt/texts";

/**
 * State and handlers stay in `SettingsView`; this tab only renders the
 * "Masterprompt" panel.
 */
export interface MasterPromptTabProps {
  masterPrompt: string;
  setMasterPrompt: (value: string) => void;
  masterEnabled: boolean;
  handleToggleMaster: (enabled: boolean) => void;
  handleSaveMasterPrompt: () => void;
}

export default function MasterPromptTab({
  masterPrompt,
  setMasterPrompt,
  masterEnabled,
  handleToggleMaster,
  handleSaveMasterPrompt,
}: MasterPromptTabProps) {
  const previewId = useId();
  return (
    <>
      <SwitchField name="master-enabled" label={t.enable} checked={masterEnabled} onCheckedChange={handleToggleMaster} />

      <div className="settings-field">
        <Field label={t.label}>
          {(control) => (
            <Textarea
              {...control}
              rows={10}
              placeholder={t.placeholder}
              value={masterPrompt}
              onChange={(event) => setMasterPrompt(event.target.value)}
            />
          )}
        </Field>
        <div>
          <Button variant="primary" onClick={handleSaveMasterPrompt}>
            {t.save}
          </Button>
        </div>
      </div>

      <section className="settings-field" aria-labelledby={previewId}>
        <span className="field-label" id={previewId}>{t.preview}</span>
        <pre className="masterprompt-preview">
          {masterPrompt.trim() === "" ? t.previewEmpty : `${masterPrompt}\n\n---\n\n${t.previewTask}`}
        </pre>
      </section>
    </>
  );
}
