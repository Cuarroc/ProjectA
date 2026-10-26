import "../../design/forms/forms.css";
import "../../design/glass.css";
import "../../design/inputs/inputs.css";

import { SwitchField } from "../../design/forms/SwitchField";
import { Select } from "../../design/inputs/Select";
import { agentCategoryDescription } from "../../lib/settings";
import type { AgentCategoryConfig, AgentProfile } from "../../types";
import { T } from "./categories/texts";

/**
 * The categories the core runs a learning critic for. `employee` is absent on
 * purpose: it has no critic, so it gets no switch to promise one.
 */
const LEARNING_CATEGORIES: ReadonlySet<AgentCategoryConfig["id"]> = new Set([
  "worker",
  "queen",
  "orchestrator",
  "scout",
]);

/**
 * State and the change/learning handlers stay in `SettingsView`; this panel
 * only renders the agent category list.
 */
export interface CategoriesPanelProps {
  categories: AgentCategoryConfig[];
  profiles: AgentProfile[];
  learning: Record<string, boolean>;
  learningError: string | null;
  handleCategoryChange: (
    id: AgentCategoryConfig["id"],
    patch: Partial<Omit<AgentCategoryConfig, "id">>,
  ) => void;
  handleToggleLearning: (id: AgentCategoryConfig["id"], enabled: boolean) => void;
}

export default function CategoriesPanel({
  categories,
  profiles,
  learning,
  learningError,
  handleCategoryChange,
  handleToggleLearning,
}: CategoriesPanelProps) {
  return (
    <>
      {learningError ? (
        <span role="alert" className="settings-error">
          {learningError}
        </span>
      ) : null}
      <ul className="category-list">
        {categories
          .filter((category) => category.id !== "employee")
          .map((category) => {
            const historical = category.id === "queen";
            const name = T.labels[category.id];
            return (
              <li
                key={category.id}
                className={`category-row${
                  historical ? "" : category.active ? "" : " category-row-off"
                }`}
              >
                <div className="category-main">
                  <span className="category-name">{name}</span>
                  <span className="category-desc">{agentCategoryDescription(category.id)}</span>
                </div>
                {historical ? (
                  <span
                    className="settings-check category-toggle"
                    aria-label={T.historicalName}
                  >
                    {T.historical}
                  </span>
                ) : (
                  <SwitchField
                    className="category-toggle"
                    name={`category-active-${category.id}`}
                    label={T.activeWord}
                    aria-label={T.active(name)}
                    checked={category.active}
                    onCheckedChange={(active) => handleCategoryChange(category.id, { active })}
                  />
                )}
                {/* A category without a critic keeps the column empty rather
                    than offering a switch that would control nothing. */}
                {LEARNING_CATEGORIES.has(category.id) ? (
                  <SwitchField
                    className="category-toggle category-learning"
                    name={`category-learning-${category.id}`}
                    label={T.learningWord}
                    aria-label={T.learning(name)}
                    checked={learning[category.id] ?? true}
                    onCheckedChange={(enabled) => handleToggleLearning(category.id, enabled)}
                  />
                ) : (
                  <span className="category-learning category-learning-none" aria-hidden="true" />
                )}
                <Select
                  name={`category-profile-${category.id}`}
                  className="category-profile"
                  aria-label={T.profile(name)}
                  value={category.defaultProfileId ?? ""}
                  disabled={historical || !category.active || profiles.length === 0}
                  onChange={(event) =>
                    handleCategoryChange(category.id, {
                      defaultProfileId: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">{T.profilePlaceholder}</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </Select>
              </li>
            );
          })}
      </ul>
    </>
  );
}
