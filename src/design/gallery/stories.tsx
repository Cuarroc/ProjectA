import type { ReactNode } from "react";
import { de } from "../../i18n/de";
import { Button, ButtonGroup } from "../controls/Button";
import { Chip } from "../controls/Chip";
import { FilterChip } from "../controls/FilterChip";
import { Segmented } from "../controls/Segmented";
import { Switch } from "../controls/Switch";
import { Avatar } from "../inputs/Avatar";
import { Input, Textarea } from "../inputs/Input";
import { Kbd } from "../inputs/Kbd";
import { Lamp } from "../inputs/Lamp";
import { Meter } from "../inputs/Meter";
import { Select } from "../inputs/Select";
import { COMPONENT_REGISTRY, type ComponentFamily } from "../registry";

const STATES = ["default", "hover", "focus", "active", "disabled", "loading", "error"] as const;
type State = typeof STATES[number];
interface Story { states: readonly State[]; render: (state: State, name: string) => ReactNode }
const STATIC = ["default"] as const;
const PRESS = ["default", "hover", "focus", "active", "disabled"] as const;
const INPUT = ["default", "focus", "disabled", "error"] as const;
const sample = de["gallery.example"];
const options = ["a", "b"].map((value) => ({ value, label: de[value === "a" ? "gallery.optionA" : "gallery.optionB"] }));
const inputProps = (state: State, name: string) => ({ "aria-describedby": state === "error" ? `${name}-error` : undefined, "aria-label": sample, disabled: state === "disabled", "aria-invalid": state === "error" ? true : undefined });

// Only the components' existing states are shown; this is fixture data, never app state.
const stories: Record<string, Story> = {
  Button: { states: PRESS, render: (s) => <Button variant="primary" disabled={s === "disabled"}>{sample}</Button> },
  ButtonGroup: { states: STATIC, render: () => <ButtonGroup aria-label={sample}><Button>{options[0].label}</Button><Button>{options[1].label}</Button></ButtonGroup> },
  Chip: { states: STATIC, render: () => <Chip>{sample}</Chip> },
  FilterChip: { states: PRESS, render: (s) => <FilterChip pressed={false} count={2} disabled={s === "disabled"}>{sample}</FilterChip> },
  Segmented: { states: ["default", "hover", "focus", "active"], render: () => <Segmented aria-label={sample} options={options} value="a" onChange={() => {}} /> },
  Switch: { states: ["default", "focus", "disabled"], render: (s) => <Switch aria-label={sample} checked={false} disabled={s === "disabled"} /> },
  Avatar: { states: STATIC, render: () => <Avatar initials={de["gallery.initials"]} label={sample} /> },
  Input: { states: INPUT, render: (s, name) => <Input {...inputProps(s, name)} defaultValue={sample} /> },
  Textarea: { states: INPUT, render: (s, name) => <Textarea {...inputProps(s, name)} defaultValue={sample} /> },
  Kbd: { states: STATIC, render: () => <Kbd>{de["gallery.key"]}</Kbd> },
  Lamp: { states: ["default", "loading", "error"], render: (s) => <Lamp state={s === "loading" ? "busy" : s === "error" ? "bad" : "ok"} label={de[`gallery.state.${s}`]} /> },
  Meter: { states: STATIC, render: () => <Meter aria-label={sample} value={60} /> },
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
          <span id={state === "error" ? `${entry.name}-error` : undefined} className="g-gal-note">{de[`gallery.state.${state}`]}</span>
          {story.render(state, entry.name)}
        </div>)}</div>
        <p className="g-gal-note">{de["gallery.notApplicable"]}{" "}{STATES.filter((s) => !story.states.includes(s)).map((s) => de[`gallery.state.${s}`]).join(de["gallery.stateSeparator"])}</p>
      </article>;
    })}
  </>;
}
