import { useId } from "react";
import { de } from "../../i18n/de";
import { Button } from "../controls/Button";
import { Chip } from "../controls/Chip";
import "./effect-card.css";

export interface ProposedEffect {
  readonly id: string;
  readonly action: string;
  readonly target?: string | null;
  readonly project?: string | null;
  readonly recipient?: string | null;
  readonly count?: number | null;
  readonly returnPath: { readonly kind: "proven" | "unproven" | "irreversible"; readonly description?: string };
  readonly authority?: { readonly state: "current" | "stale"; readonly label: string; readonly scope: string };
  readonly noConsequence: string;
}

export interface EffectCardProps {
  readonly effects: readonly ProposedEffect[];
  readonly mode?: "prepare" | "grant";
  readonly state?: "ready" | "loading" | "error" | "needs-user";
  readonly onPrepare?: (request: { readonly effectIds: readonly string[] }) => void;
  readonly onReject?: (request: { readonly effectIds: readonly string[] }) => void;
}

const known = (value?: string | null) => value?.trim() || de["effect.unknown"];

/** Presentation only: callbacks request a local draft or decline, never authority. */
export function EffectCard({ effects, mode = "prepare", state = "ready", onPrepare, onReject }: EffectCardProps) {
  const hint = useId();
  const request = () => ({ effectIds: effects.map((effect) => effect.id) });
  const available = effects.length > 0 && (state === "ready" || state === "needs-user");
  const risks = effects.filter((effect) => effect.returnPath.kind !== "proven" || !effect.returnPath.description?.trim()).length;
  return <section className="g-effect" aria-label={de["effect.title"]}>
    <h3>{de["effect.title"]}</h3>
    {effects.length > 1 && <p>{de["effect.summary"].replace("{total}", String(effects.length)).replace("{risk}", String(risks))}</p>}
    {state !== "ready" && <p className={state === "error" ? "g-effect-error" : undefined} role={state === "error" ? "alert" : "status"}>{de[`effect.${state}`]}</p>}
    {effects.length === 0 ? <p>{de["effect.empty"]}</p> : <ol>{effects.map((effect) => {
      const count = typeof effect.count === "number" && Number.isSafeInteger(effect.count) && effect.count >= 0 ? effect.count : de["effect.unknown"];
      const proven = effect.returnPath.kind === "proven" && !!effect.returnPath.description?.trim();
      const authority = effect.authority;
      return <li key={effect.id}><dl>
        <div><dt>{de["effect.what"]}</dt><dd>{known(effect.action)}</dd></div>
        <div><dt>{de["effect.where"]}</dt><dd>{known(effect.target).split("/").map((part, i, parts) => <span className="g-effect-token" key={i}>{part}{i < parts.length - 1 ? "/" : ""}</span>)}; {de["effect.project"]}: {known(effect.project)}; {de["effect.recipient"]}: {known(effect.recipient)}</dd></div>
        <div><dt>{de["effect.count"]}</dt><dd className={typeof count === "string" ? "g-effect-risk" : undefined}>{count}</dd></div>
        <div><dt>{de["effect.return"]}</dt><dd className={!proven ? "g-effect-risk" : undefined}>{de[proven ? "effect.proven" : effect.returnPath.kind === "irreversible" ? "effect.irreversible" : "effect.unproven"]}{effect.returnPath.description ? <>: {effect.returnPath.description}</> : ""}</dd></div>
        <div><dt>{de["effect.authority"]}</dt><dd><Chip className="g-effect-authority"><span aria-hidden="true">□</span>{authority ? <>{authority.state === "current" ? de["effect.readonly"] : de["effect.stale"]}: {known(authority.label)}; {known(authority.scope)}</> : de["effect.noAuthority"]}</Chip></dd></div>
        <div><dt>{de["effect.no"]}</dt><dd>{known(effect.noConsequence)}</dd></div>
      </dl></li>;
    })}</ol>}
    <p id={hint}>{de["effect.locked"]}</p>
    <div className="g-effect-actions">
      {mode === "prepare" && <Button variant="primary" disabled={!available || !onPrepare} onClick={() => onPrepare?.(request())}>{de["effect.prepare"]}</Button>}
      <Button disabled={!effects.length || !onReject} onClick={() => onReject?.(request())}>{de["effect.reject"]}</Button>
      <Button disabled aria-describedby={hint}>{de["effect.grant"]}</Button>
    </div>
  </section>;
}
