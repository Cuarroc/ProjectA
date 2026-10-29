import { OrchestratorMessage } from "../chat/OrchestratorMessage";
import type { ReactNode } from "react";
import { EffectCard } from "../chat/EffectCard";
import { de } from "../../i18n/de";
import { Button, ButtonGroup } from "../controls/Button";
import { Chip } from "../controls/Chip";
import { FilterChip } from "../controls/FilterChip";
import { IconButton } from "../controls/IconButton";
import { Segmented } from "../controls/Segmented";
import { Switch } from "../controls/Switch";
import { Avatar } from "../inputs/Avatar";
import { Input, Textarea } from "../inputs/Input";
import { Kbd } from "../inputs/Kbd";
import { Lamp } from "../inputs/Lamp";
import { Meter } from "../inputs/Meter";
import { Select } from "../inputs/Select";
import { Icon } from "../icons/Icon";
import { COMPONENT_REGISTRY, type ComponentFamily } from "../registry";

const STATES = ["default", "hover", "focus", "active", "disabled", "loading", "error"] as const;
type State = typeof STATES[number];
interface Story { states: readonly State[]; render: (state: State, name: string) => ReactNode }
const STATIC = ["default"] as const;
const PRESS = ["default", "hover", "focus", "active", "disabled"] as const;
const INPUT = ["default", "focus", "disabled", "error"] as const;
const sample = de["gallery.example"];
const options = ["a", "b"].map((value) => ({ value, label: de[value === "a" ? "gallery.optionA" : "gallery.optionB"] }));
const buttonVariants = ["primary", "secondary", "tint", "ghost", "danger"] as const;
const lampShapes = ["ok", "off", "warn", "unknown"] as const;
const sampleProps = (state: State, name: string) => ({ "aria-labelledby": `story-${name} ${name}-${state}-caption` });
const inputProps = (state: State, name: string) => ({ ...sampleProps(state, name), "aria-describedby": state === "error" ? `${name}-error-caption` : undefined, disabled: state === "disabled", "aria-invalid": state === "error" ? true : undefined });

// Only the components' existing states are shown; this is fixture data, never app state.
const stories: Record<string, Story> = {
  OrchestratorMessage: { states: ["default", "loading", "error"], render: (s) => <OrchestratorMessage
    id={`demo-${s}`} kind={s === "error" ? "system" : "question"} role="agent" source="tab" example
    status={{ operatingStatus: s === "error" ? "error" : "unknown", evidenceStatus: "gemeldet", boardForm: "unknown" }}
    observedAtSeconds={null} text={de["orchestratorMessage.sampleText"]} nextStep={de["orchestratorMessage.sampleNext"]}
    loading={s === "loading"} error={s === "error" ? de["orchestratorMessage.sampleError"] : undefined} /> },
  EffectCard: { states: ["default", "loading", "error"], render: (s) => <EffectCard state={s === "default" ? "ready" : s === "loading" ? "loading" : "error"} effects={[{ id: "demo", action: de["effect.sampleAction"], target: de["effect.sampleTarget"], project: sample, count: null, returnPath: { kind: "unproven" }, noConsequence: de["effect.sampleNo"] }]} /> },
  Button: { states: PRESS, render: (s, name) => (s === "default" ? buttonVariants : buttonVariants.slice(0, 1)).map((variant) => <Button key={variant} {...sampleProps(s, name)} variant={variant} disabled={s === "disabled"}>{sample}</Button>) },
  IconButton: { states: [...PRESS, "loading"], render: (s, name) => <IconButton {...sampleProps(s, name)} aria-label={`${name} ${de[`gallery.state.${s}`]}`} disabled={s === "disabled"} loading={s === "loading"}><Icon name="check" /></IconButton> },
  ButtonGroup: { states: STATIC, render: (s, name) => <ButtonGroup {...sampleProps(s, name)}><Button>{options[0].label}</Button><Button>{options[1].label}</Button></ButtonGroup> },
  Chip: { states: STATIC, render: (s, name) => <Chip {...sampleProps(s, name)}>{sample}</Chip> },
  FilterChip: { states: PRESS, render: (s, name) => (s === "default" ? [false, true] : [false]).map((pressed) => <FilterChip key={String(pressed)} {...sampleProps(s, name)} pressed={pressed} count={2} disabled={s === "disabled"}>{sample}</FilterChip>) },
  Segmented: { states: ["default", "hover", "focus", "active"], render: (s, name) => <Segmented aria-label={`${name} ${de[`gallery.state.${s}`]}`} options={options} value="a" onChange={() => {}} /> },
  Switch: { states: ["default", "focus", "disabled"], render: (s, name) => (s === "default" ? [false, true] : [false]).map((checked) => <Switch key={String(checked)} {...sampleProps(s, name)} checked={checked} disabled={s === "disabled"} />) },
  Avatar: { states: STATIC, render: (s, name) => <Avatar {...sampleProps(s, name)} initials={de["gallery.initials"]} label={sample} /> },
  Input: { states: INPUT, render: (s, name) => <Input {...inputProps(s, name)} defaultValue={sample} /> },
  Textarea: { states: INPUT, render: (s, name) => <Textarea {...inputProps(s, name)} defaultValue={sample} /> },
  Kbd: { states: STATIC, render: (s, name) => <Kbd {...sampleProps(s, name)}>{de["gallery.key"]}</Kbd> },
  Lamp: { states: ["default", "loading", "error"], render: (s, name) => (s === "default" ? lampShapes : [s === "loading" ? "busy" as const : "bad" as const]).map((state) => <Lamp key={state} {...sampleProps(s, name)} state={state} label={de[`gallery.state.${s}`]} />) },
  Meter: { states: STATIC, render: (s, name) => <Meter {...sampleProps(s, name)} aria-label={sample} value={60} /> },
  Select: { states: INPUT, render: (s, name) => <Select {...inputProps(s, name)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select> },
};

export function renderStories(family: ComponentFamily) {
  return <>
    <p className="g-gal-sample">{de["gallery.sample"]}</p>
    {COMPONENT_REGISTRY.filter((e) => e.family === family).map((entry) => {
      const story = stories[entry.name];
      if (!story) return null;
      return <article key={entry.name} aria-labelledby={`story-${entry.name}`} className="g-gal-story">
        <h3 id={`story-${entry.name}`}><code>{entry.name}</code></h3>
        <div className="g-gal-matrix">{story.states.map((state) => <div key={state} data-force-state={state} className="g-gal-cell">
          <span id={`${entry.name}-${state}-caption`} className="g-gal-note">{de[`gallery.state.${state}`]}</span>
          {story.render(state, entry.name)}
        </div>)}</div>
        <p className="g-gal-note">{de["gallery.notApplicable"]}{" "}{STATES.filter((s) => !story.states.includes(s)).map((s) => de[`gallery.state.${s}`]).join(de["gallery.stateSeparator"])}</p>
      </article>;
    })}
  </>;
}
