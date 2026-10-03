import type { AgentProfile } from "../../types";
import ProfileBudgetFields, { type ProfileBudgetFieldsProps } from "./ProfileBudgetFields";

/**
 * Renders the profile roster with its enable switch and budget fields. State,
 * handlers and validation stay in `SettingsView`.
 */
export interface ProfilesPanelProps {
  profileList: AgentProfile[];
  profileError: string | null;
  budgetError: string | null;
  profileBusyId: string | null;
  budgetBusyId: string | null;
  budgetOf: (profileId: string) => ProfileBudgetFieldsProps["budget"];
  handleToggleProfile: (profile: AgentProfile, enabled: boolean) => void;
  handleBudgetChange: ProfileBudgetFieldsProps["onChange"];
  handleSaveBudget: ProfileBudgetFieldsProps["onSave"];
}

export default function ProfilesPanel({
  profileList,
  profileError,
  budgetError,
  profileBusyId,
  budgetBusyId,
  budgetOf,
  handleToggleProfile,
  handleBudgetChange,
  handleSaveBudget,
}: ProfilesPanelProps) {
  return (
    <div className="settings-field profile-field">
      <span className="field-label">Profile</span>
      <p className="settings-hint">
        Ein deaktiviertes Profil bleibt gespeichert, wird aber keinem neuen
        Agenten mehr zugeteilt.
      </p>
      <p className="settings-hint">
        Budget: ab welchem Prozentsatz des 5-Stunden- bzw. 7-Tage-Fensters
        dieses Profil pausiert wird. Erreicht ein Fenster seine Schwelle,
        überspringt der Dispatcher das Profil und laufende Agenten werden
        gestoppt — die Worktrees bleiben liegen, ein Respawn holt sie
        zurück. Leeres Feld heißt „keine Schwelle“.
      </p>
      {profileError ? <span className="settings-error">{profileError}</span> : null}
      {budgetError ? <span className="settings-error">{budgetError}</span> : null}
      {profileList.length === 0 ? (
        <span className="settings-hint">Keine Profile vorhanden.</span>
      ) : (
        <ul className="profile-list">
          {profileList.map((profile) => (
            <li
              key={profile.id}
              className={`profile-row${profile.enabled ? "" : " profile-row-off"}`}
            >
              <div className="profile-main">
                <span className="profile-name">{profile.name}</span>
                <span className="profile-id">{profile.id}</span>
              </div>
              <label className="settings-check profile-toggle">
                <input
                  type="checkbox"
                  checked={profile.enabled}
                  disabled={profileBusyId === profile.id}
                  onChange={(event) => handleToggleProfile(profile, event.target.checked)}
                />
                <span>Aktiv</span>
              </label>
              <ProfileBudgetFields
                profile={profile}
                budget={budgetOf(profile.id)}
                busy={budgetBusyId === profile.id}
                onChange={handleBudgetChange}
                onSave={handleSaveBudget}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
