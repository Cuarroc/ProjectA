import { useEffect, useId, useRef, useState } from "react";
import { Switch } from "../design/controls/Switch";
import { listFeatureFlags, type FeatureFlag } from "../flags/featureFlags";
import { useFeatureFlag } from "../flags/useFeatureFlag";
import { DEV_TEXT } from "../shell/header/texts";
import { useIsDevBuild } from "./useIsDevBuild";
import { buildInfo } from "./buildInfo";
import { FeedbackForm } from "./FeedbackForm";
import "../design/controls/controls.css";
import "./dev.css";

function Experiment({ flag }: { flag: FeatureFlag }) {
  const [enabled, setEnabled] = useFeatureFlag(flag.id);
  const description = useId();
  return (
    <div className="g-dev-experiment">
      <div><strong>{flag.label}</strong><p id={description}>{flag.description}</p></div>
      <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={flag.label} aria-describedby={description} />
    </div>
  );
}

export function DevBadge() {
  const isDevBuild = useIsDevBuild();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  if (!isDevBuild) return null;
  const { sha, time } = buildInfo();
  const commit = sha === "local" ? DEV_TEXT.local : sha;
  return (
    <div className="g-dev" ref={root} onKeyDown={(e) => {
      if (e.key === "Escape") { setOpen(false); button.current?.focus(); e.stopPropagation(); }
    }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button className="g-dev-badge" type="button" ref={button} aria-expanded={open}
        aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
        {DEV_TEXT.badge(commit)}
      </button>
      {open && <section id={panelId} className="g-dev-panel" aria-label={DEV_TEXT.experiments}>
        <dl><dt>{DEV_TEXT.commit}</dt><dd>{commit}</dd>
          <dt>{DEV_TEXT.time}</dt><dd><time dateTime={time}>{time}</time></dd></dl>
        <h2>{DEV_TEXT.experiments}</h2>
        {listFeatureFlags().map((flag) => <Experiment key={flag.id} flag={flag} />)}
        <div className="g-dev-experiment">
          <button className="g-dev-badge" type="button" aria-expanded={feedback}
            onClick={() => setFeedback(!feedback)}>{DEV_TEXT.feedback}</button>
        </div>
        {feedback && <FeedbackForm />}
      </section>}
    </div>
  );
}
