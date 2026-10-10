import { useCallback, useEffect, useState } from "react";

import "../../design/controls/controls.css";
import "../../design/glass.css";
import "../../design/inputs/inputs.css";
import { Chip } from "../../design/controls/Chip";
import { FilterChip } from "../../design/controls/FilterChip";
import { HonestState } from "../../design/data/HonestState";
import { Avatar } from "../../design/inputs/Avatar";
import { listAgentProfiles } from "../../lib/ipc";
import type { AgentProfile } from "../../types";
import { initials, toneFor } from "../leitstand/leitstand";
import { cliKey, cliLabel, modelOf, providerCounts } from "./personas";
import { T } from "./texts";
import "./personas.css";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; profiles: AgentProfile[] };

function Fact({ label, children }: { label: string; children?: string }) {
  return (
    <div className="ps-fact">
      <span className="ps-k">{label}</span>
      {children ? <span className="ps-v">{children}</span> : <HonestState kind="offline" title={T.notConnected} />}
    </div>
  );
}

function PersonaCard({ profile, profiles }: { profile: AgentProfile; profiles: AgentProfile[] }) {
  const model = modelOf(profile.args);
  const target = profile.fallback ? (profiles.find((p) => p.id === profile.fallback)?.name ?? profile.fallback) : undefined;
  return (
    <article className="g-glass ps-card" aria-label={profile.name}>
      <div className="ps-head">
        <Avatar initials={initials(profile.name)} tone={toneFor(profile.id)} />
        <div className="ps-who">
          <h3 title={profile.name}>{profile.name}</h3>
          <p>{cliLabel(profile.command)}</p>
        </div>
        {!profile.enabled && <Chip>{T.disabled}</Chip>}
      </div>
      <p className={model ? "ps-model" : "ps-model ps-model--none"}>{model ?? T.noModel}</p>
      <div className="ps-facts">
        <Fact label={T.facts.failover}>{target}</Fact>
        <Fact label={T.facts.rights} />
        <Fact label={T.facts.autonomy} />
        <Fact label={T.facts.mcp} />
      </div>
    </article>
  );
}

/** Team › Personas: one Glass card per agent profile, read-only. Not mounted yet (V2-S07b-1). */
export function PersonasScreen() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [filter, setFilter] = useState<string | null>(null);
  const fetchProfiles = useCallback(() => {
    setLoad({ status: "loading" });
    listAgentProfiles().then(
      (profiles) => setLoad({ status: "ready", profiles }),
      () => setLoad({ status: "error" }),
    );
  }, []);
  useEffect(fetchProfiles, [fetchProfiles]);

  const profiles = load.status === "ready" ? load.profiles : [];
  const shown = filter ? profiles.filter((p) => cliKey(p.command) === filter) : profiles;
  return (
    <div className="ps-screen">
      <header className="ps-top">
        <h1>{T.title}</h1>
        <p>{T.lead}</p>
      </header>
      {profiles.length > 0 && (
        <div className="ps-chips" role="group" aria-label={T.filterGroup}>
          <FilterChip pressed={filter === null} count={profiles.length} onPressedChange={() => setFilter(null)}>{T.all}</FilterChip>
          {providerCounts(profiles).map((row) => (
            <FilterChip key={row.key} pressed={filter === row.key} count={row.count} onPressedChange={() => setFilter(row.key)}>{row.label}</FilterChip>
          ))}
        </div>
      )}
      {load.status === "error" && <HonestState kind="offline" title={T.errorTitle} action={{ label: T.retry, onClick: fetchProfiles }} />}
      {load.status === "loading" && <HonestState kind="empty" title={T.loading} />}
      {load.status === "ready" && profiles.length === 0 && <HonestState kind="empty" title={T.emptyTitle} hint={T.emptyHint} />}
      {shown.length > 0 && (
        <section className="ps-gallery" aria-label={T.gallery}>
          {shown.map((p) => <PersonaCard key={p.id} profile={p} profiles={profiles} />)}
        </section>
      )}
    </div>
  );
}
