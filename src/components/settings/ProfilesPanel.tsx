import "../../design/forms/forms.css";
import "../../design/glass.css";
import { SwitchField } from "../../design/forms/SwitchField";
import type { AgentProfile } from "../../types";
import ProfileBudgetFields, { type ProfileBudgetFieldsProps } from "./ProfileBudgetFields";
import { T } from "./profiles/texts";

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
      <span className="field-label">{T.title}</span>
      <p className="settings-hint">{T.hint}</p>
      <p className="settings-hint">{T.budgetHint}</p>
      {profileError ? <span role="alert" className="settings-error">{profileError}</span> : null}
      {budgetError ? <span role="alert" className="settings-error">{budgetError}</span> : null}
      {profileList.length === 0 ? (
        <span className="settings-hint">{T.empty}</span>
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
              <SwitchField
                className="profile-toggle"
                id={`profile-enabled-${profile.id}`}
                name={`profile-enabled-${profile.id}`}
                label={T.active(profile.name)}
                checked={profile.enabled}
                disabled={profileBusyId === profile.id}
                onCheckedChange={(enabled) => handleToggleProfile(profile, enabled)}
              />
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
