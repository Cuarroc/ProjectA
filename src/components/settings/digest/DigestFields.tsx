import { useId } from "react";
import { Switch } from "../../../design/controls/Switch";
import "../../../design/controls/controls.css";
import { T } from "./texts";

interface DigestFieldsProps {
  digestEnabled: boolean;
  handleToggleDigest: (enabled: boolean) => void;
  digestError: string | null;
}

/** The global value and persistence remain controlled by SettingsView. */
export default function DigestFields({ digestEnabled, handleToggleDigest, digestError }: DigestFieldsProps) {
  const id = useId();
  return (
    <div className="settings-field">
      <div className="settings-check">
        <Switch
          id={id}
          name="digest-enabled"
          checked={digestEnabled}
          onCheckedChange={handleToggleDigest}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint${digestError ? ` ${id}-error` : ""}`}
        />
        <label id={`${id}-label`} htmlFor={id}>{T.label}</label>
      </div>
      <p className="settings-hint" id={`${id}-hint`}>
        {T.cadence} <code>{T.path}</code> {T.sources} <code>{T.ignoredPath}</code> {T.vault}
      </p>
      {digestError ? <span className="settings-error" id={`${id}-error`} role="alert">{digestError}</span> : null}
    </div>
  );
}
