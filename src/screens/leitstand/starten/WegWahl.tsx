import { useEffect, useId, useRef, useState } from "react";
import "../../../design/glass.css";
import "../../../design/inputs/inputs.css";
import { HonestState } from "../../../design/data/HonestState";
import { DevNote } from "../../../design/data/DevNote";
import { Avatar } from "../../../design/inputs/Avatar";
import { Lamp, type LampState } from "../../../design/inputs/Lamp";
import { listAgentProfiles } from "../../../lib/ipc";
import { blockedLabel, isBlocked, useQuotaState } from "../../../lib/quota";
import type { AgentProfile, QuotaState } from "../../../types";
import { cliLabel, modelOf } from "../../team/personas";
import { initials, toneFor } from "../leitstand";
import { T } from "./texts";
import "./starten.css";

export interface WegWahlProps {
  /** Selected profile id, or `null` while nothing is chosen. */
  value: string | null;
  onChange: (profileId: string) => void;
}

/** Unknown stays "unbekannt": a missing or failed quota read is never shown as free. */
function quotaView(quota: QuotaState | undefined): { lamp: LampState; text: string } {
  if (quota?.state === "ok") return { lamp: "ok", text: T.quotaFree };
  if (quota?.state === "blocked") return { lamp: "bad", text: blockedLabel(quota) };
  return { lamp: "off", text: T.quotaUnknown };
}

/** Agent starten, first section: which persona and route. Read-only; nothing here starts anything; not mounted yet. */
export function WegWahl({ value, onChange }: WegWahlProps) {
  // `undefined` = not read yet, `null` = the read failed: neither may claim "no persona".
  const [profiles, setProfiles] = useState<readonly AgentProfile[] | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const reading = useRef(true);
  const quota = useQuotaState();
  const uid = useId();

  useEffect(() => {
    let live = true;
    const finish = (rows: readonly AgentProfile[] | null) => {
      if (!live) return;
      reading.current = false;
      setProfiles(rows);
    };
    listAgentProfiles().then(finish, () => finish(null));
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = () => {
    if (reading.current) return;
    reading.current = true;
    setProfiles(undefined);
    setAttempt((previous) => previous + 1);
  };

  const enabled = profiles?.filter((p) => p.enabled) ?? [];
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.name ?? id;

  const selectedProfile = value !== null ? profiles?.find((p) => p.id === value) : null;
  const isSelectedBlocked = selectedProfile ? isBlocked(quota.byProfile.get(selectedProfile.id)) : false;
  const isSelectedMissing = selectedProfile ? !enabled.some((p) => p.id === selectedProfile.id) : false;
  const showChoiceWarning = selectedProfile && (isSelectedBlocked || isSelectedMissing);
  const choiceWarningText = showChoiceWarning
    ? isSelectedBlocked
      ? T.choiceBlocked(selectedProfile.name)
      : T.choiceMissing(selectedProfile.name)
    : null;

  return (
    <div className="wg">
      {profiles === undefined ? <p className="wg-note">{T.loading}</p> : profiles === null ? (
        <HonestState kind="offline" title={T.profilesOffline} hint={T.profilesOfflineHint}
          action={{ label: T.retry, onClick: retry }} />
      ) : enabled.length === 0 ? (
        <HonestState kind="empty" title={T.profilesEmpty} hint={T.profilesEmptyHint} />
      ) : (
        <div role="radiogroup" aria-label={T.group} className="wg-list">
          {enabled.map((p) => {
            const q = quota.byProfile.get(p.id);
            const view = quotaView(q);
            const model = modelOf(p.args);
            const blocked = isBlocked(q);
            return (
              <label key={p.id} className={`wg-opt${blocked ? " wg-opt--blocked" : ""}`}>
                <input
                  type="radio"
                  className="wg-radio"
                  name={uid}
                  value={p.id}
                  checked={value === p.id}
                  disabled={blocked}
                  aria-labelledby={`${uid}-n-${p.id}`}
                  aria-describedby={`${uid}-d-${p.id}`}
                  onChange={() => !blocked && onChange(p.id)}
                />
                <Avatar initials={initials(p.name)} tone={toneFor(p.id)} />
                <span className="wg-body">
                  <span className="wg-name" id={`${uid}-n-${p.id}`}>{p.name}</span>
                  <span className="wg-meta" id={`${uid}-d-${p.id}`}>
                    <span>{cliLabel(p.command)}</span>
                    {model !== null && <span>{T.modelRequest(model)}</span>}
                    <span>{T.modelUnpinned}</span>
                    <span className="wg-quota"><Lamp state={view.lamp} />{view.text}</span>
                    {p.fallback !== null && <span>{T.failover(nameOf(p.fallback))}</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {showChoiceWarning && (
        <div className="wg-warning" role="status" aria-live="polite">
          {choiceWarningText}
        </div>
      )}
      <div className="wg-extras">
        <div className="wg-extra">
          <span className="wg-label">{T.place}</span>
          <HonestState kind="offline" title={T.placeOffline} />
          <DevNote className="wg-note">{T.placeNote}</DevNote>
        </div>
        <div className="wg-extra">
          <span className="wg-label">{T.effort}</span>
          <HonestState kind="offline" title={T.effortOffline} />
        </div>
        <div className="wg-extra">
          <span className="wg-label">{T.mcp}</span>
          <HonestState kind="offline" title={T.mcpOffline} />
          <DevNote className="wg-note">{T.mcpNote}</DevNote>
        </div>
      </div>
    </div>
  );
}
