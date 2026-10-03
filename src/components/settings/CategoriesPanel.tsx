import { agentCategoryDescription } from "../../lib/settings";
import type { AgentCategoryConfig, AgentProfile } from "../../types";

const CATEGORY_LABELS: Record<AgentCategoryConfig["id"], string> = {
  worker: "Worker",
  queen: "Queen",
  employee: "Employee",
  scout: "Scout",
  orchestrator: "Orchestrator",
};

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
      {learningError ? <span className="settings-error">{learningError}</span> : null}
      <ul className="category-list">
        {categories
          .filter((category) => category.id !== "employee")
          .map((category) => {
            const historical = category.id === "queen";
            return (
              <li
                key={category.id}
                className={`category-row${
                  historical ? "" : category.active ? "" : " category-row-off"
                }`}
              >
                <div className="category-main">
                  <span className="category-name">{CATEGORY_LABELS[category.id]}</span>
                  <span className="category-desc">{agentCategoryDescription(category.id)}</span>
                </div>
                {historical ? (
                  <span
                    className="settings-check category-toggle"
                    aria-label="Queen historisch"
                  >
                    Historisch
                  </span>
                ) : (
                  <label className="settings-check category-toggle">
                    <input
                      type="checkbox"
                      checked={category.active}
                      onChange={(event) =>
                        handleCategoryChange(category.id, { active: event.target.checked })
                      }
                    />
                    <span>Aktiv</span>
                  </label>
                )}
                {/* A category without a critic keeps the column empty rather
                    than offering a switch that would control nothing. */}
                {LEARNING_CATEGORIES.has(category.id) ? (
                  <label className="settings-check category-toggle category-learning">
                    <input
                      type="checkbox"
                      checked={learning[category.id] ?? true}
                      onChange={(event) =>
                        handleToggleLearning(category.id, event.target.checked)
                      }
                    />
                    <span>Lernen</span>
                  </label>
                ) : (
                  <span className="category-learning category-learning-none" aria-hidden="true" />
                )}
                <select
                  className="field category-profile"
                  aria-label={`Default Profile für ${CATEGORY_LABELS[category.id]}`}
                  value={category.defaultProfileId ?? ""}
                  disabled={historical || !category.active || profiles.length === 0}
                  onChange={(event) =>
                    handleCategoryChange(category.id, {
                      defaultProfileId: event.target.value === "" ? null : event.target.value,
                    })
                  }
                >
                  <option value="">Default Profile …</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
      </ul>
    </>
  );
}
