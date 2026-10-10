import { listFeatureFlags, type FeatureFlag } from "../../flags/featureFlags";
import { useFeatureFlag } from "../../flags/useFeatureFlag";

/** The one switch for D1, shown in the old Settings › General. Off by default; persists via the flag registry. */
export default function PreviewToggle() {
  const flag = listFeatureFlags().find((f) => f.id === "d1_neue_oberflaeche");
  return flag ? <FlagSwitch flag={flag} /> : null;
}

function FlagSwitch({ flag }: { flag: FeatureFlag }) {
  const [enabled, setEnabled] = useFeatureFlag(flag.id);
  return (
    <>
      <label className="settings-check">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>{flag.label}</span>
      </label>
      <p className="settings-hint">{flag.description} Beim Umschalten lädt die Oberfläche neu.</p>
    </>
  );
}
