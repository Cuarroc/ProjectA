import { useId, useState } from "react";
import { Button } from "../design/controls/Button";
import { Textarea } from "../design/inputs/Input";
import "../design/inputs/inputs.css";
import { reportFrontendFeedback } from "../errors/reportFrontendError";
import { DEV_TEXT } from "../shell/header/texts";

export function FeedbackForm() {
  const [what, setWhat] = useState("");
  const [expected, setExpected] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const whatId = useId(), expectedId = useId();
  if (saved) return <p role="status">{DEV_TEXT.feedbackSaved}</p>;
  return (
    <form className="g-dev-experiment" onSubmit={async (event) => {
      event.preventDefault();
      if (!what.trim() || pending) return;
      setPending(true); setFailed(false);
      const accepted = await reportFrontendFeedback(what.trim(), expected.trim());
      setSaved(accepted); setFailed(!accepted); setPending(false);
    }}>
      <div>
        <p><label className="g-inp-label" htmlFor={whatId}>{DEV_TEXT.feedbackWhat}</label></p>
        <p><Textarea id={whatId} value={what} onChange={(event) => setWhat(event.target.value)} required rows={3} /></p>
        <p><label className="g-inp-label" htmlFor={expectedId}>{DEV_TEXT.feedbackExpected}</label></p>
        <p><Textarea id={expectedId} value={expected} onChange={(event) => setExpected(event.target.value)} rows={2} /></p>
        {failed && <p role="alert">{DEV_TEXT.feedbackFailed}</p>}
        <p><Button type="submit" variant="primary" size="sm" disabled={pending}>{DEV_TEXT.feedbackSubmit}</Button></p>
      </div>
    </form>
  );
}
