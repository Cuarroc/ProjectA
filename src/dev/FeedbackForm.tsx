import { useId, useState } from "react";
import { Button } from "../design/controls/Button";
import { reportFrontendFeedback } from "../errors/reportFrontendError";
import { DEV_TEXT } from "../shell/header/texts";

export function FeedbackForm() {
  const [what, setWhat] = useState("");
  const [expected, setExpected] = useState("");
  const [saved, setSaved] = useState(false);
  const whatId = useId(), expectedId = useId();
  if (saved) return <p role="status">{DEV_TEXT.feedbackSaved}</p>;
  return (
    <form className="g-dev-experiment" onSubmit={(event) => {
      event.preventDefault();
      if (!what.trim()) return;
      reportFrontendFeedback(what.trim(), expected.trim());
      setSaved(true);
    }}>
      <div>
        <p><label className="field-label" htmlFor={whatId}>{DEV_TEXT.feedbackWhat}</label></p>
        <p><textarea id={whatId} className="field field-textarea" value={what} onChange={(event) => setWhat(event.target.value)} required rows={3} /></p>
        <p><label className="field-label" htmlFor={expectedId}>{DEV_TEXT.feedbackExpected}</label></p>
        <p><textarea id={expectedId} className="field field-textarea" value={expected} onChange={(event) => setExpected(event.target.value)} rows={2} /></p>
        <p><Button type="submit" variant="primary" size="sm">{DEV_TEXT.feedbackSubmit}</Button></p>
      </div>
    </form>
  );
}
