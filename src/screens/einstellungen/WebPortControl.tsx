import { useState, type FormEvent } from "react";

import { Button } from "../../design/controls/Button";
import { Field } from "../../design/forms/Field";
import { Input } from "../../design/inputs/Input";
import { loadWebPort, saveWebPort } from "../../lib/settings";
import { T } from "./texts";

const fromStore = () => loadWebPort()?.toString() ?? "";

/** Default port the next explicit web-interface start uses; saving never starts or restarts it. */
export function WebPortControl() {
  const [value, setValue] = useState(fromStore);
  const [error, setError] = useState<string | null>(null);
  // Read back, never assumed: the setter is void and a blocked storage stays unstored.
  const [stored, setStored] = useState(loadWebPort);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = value.trim();
    const port = raw === "" ? null : Number.parseInt(raw, 10);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError(T.portRange);
      return;
    }
    setError(null);
    saveWebPort(port);
    setStored(loadWebPort());
  };

  return (
    <form onSubmit={submit} className="es-port">
      <Field label={T.portLabel} hint={stored === null ? T.portHintNone : T.portHint(stored)} error={error}>
        {(control) => <Input {...control} inputMode="numeric" placeholder={T.portPlaceholder} value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <Button type="submit" size="sm" variant="primary">{T.portSave}</Button>
    </form>
  );
}
