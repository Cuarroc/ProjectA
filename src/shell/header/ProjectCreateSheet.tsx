import { useRef, useState, type FormEvent } from "react";
import { Button } from "../../design/controls/Button";
import { Field } from "../../design/forms/Field";
import { Input } from "../../design/inputs/Input";
import { Banner } from "../../design/layout/Banner";
import { Sheet } from "../../design/layout/Sheet";
import { createProject } from "../../lib/ipc/projects";
import { describeError } from "../../lib/ipc";
import type { Project } from "../../types";
import { CREATE_TEXT } from "../texts";
import "../../design/forms/forms.css";
import "../../design/inputs/inputs.css";

export function ProjectCreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !name.trim() || !repoPath.trim()) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      const project = await createProject(name.trim(), repoPath.trim());
      onCreated(project);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <Sheet open aria-label={CREATE_TEXT.title} onClose={() => { if (!inFlight.current) onClose(); }} dismissOnScrim={!pending} size="sm">
      <form className="g-confirm" onSubmit={(e) => void submit(e)}>
        <h2>{CREATE_TEXT.title}</h2>
        <Field label={CREATE_TEXT.name}>
          {(control) => <Input {...control} required value={name} disabled={pending} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={CREATE_TEXT.path} hint={CREATE_TEXT.hint}>
          {(control) => <Input {...control} required value={repoPath} disabled={pending} onChange={(e) => setRepoPath(e.target.value)} />}
        </Field>
        {error && <Banner kind="bad">{error}</Banner>}
        <div className="g-confirm__actions">
          <Button onClick={onClose} disabled={pending}>{CREATE_TEXT.cancel}</Button>
          <Button type="submit" variant="primary" loading={pending} disabled={!name.trim() || !repoPath.trim()}>{CREATE_TEXT.submit}</Button>
        </div>
      </form>
    </Sheet>
  );
}
