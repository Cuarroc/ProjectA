import { listFeatureFlags } from "../../flags/featureFlags";
import { useFeatureFlag } from "../../flags/useFeatureFlag";

const D1 = listFeatureFlags().find((flag) => flag.id === "d1_neue_oberflaeche")!;

/** The one switch for D1, shown in the old Settings › General. Off by default; persists via the flag registry. */
export default function PreviewToggle() {
  const [enabled, setEnabled] = useFeatureFlag(D1.id);
  return (
    <>
      <label className="settings-check">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>{D1.label}</span>
      </label>
      <p className="settings-hint">{D1.description} Beim Umschalten lädt die Oberfläche neu.</p>
    </>
  );
}
