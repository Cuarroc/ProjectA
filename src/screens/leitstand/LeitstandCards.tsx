import { useState } from "react";
import "../../design/controls/controls.css";
import "../../design/glass.css";
import { FilterChip } from "../../design/controls/FilterChip";
import { HonestState } from "../../design/data/HonestState";
import { Button } from "../../design/controls/Button";
import { StateGlyph } from "../../design/state/StateMark";
import { useT } from "../../i18n/useT";
import { STATE_FORMS, STATE_WORDS } from "../../design/state/states";
import type { AgentProfile, BoardCard } from "../../types";
import { AgentCard } from "./AgentCard";
import { agentCards, cardForm, countByFilter, type Filter } from "./leitstand";
import "./leitstand.css";

export interface LeitstandCardsProps {
  /** `cards` of `useBoard` / `get_board_state`, coordinators included. */
  cards: readonly BoardCard[];
  profiles: readonly AgentProfile[];
  now: number;
  onOpen: (card: BoardCard) => void;
}

/** Filter chips and one card per agent. Not mounted yet: the route comes with V2-F9. */
export function LeitstandCards({ cards, profiles, now, onOpen }: LeitstandCardsProps) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const agents = agentCards(cards);
  const counts = countByFilter(agents);
  const shown = agents.filter((c) => filter === "all" || cardForm(c) === filter);
  const nameOf = (c: BoardCard) => profiles.find((p) => p.id === c.worker.profileId)?.name ?? c.worker.profileId;
  if (agents.length === 0) return <HonestState kind="empty" title={t("leitstand.emptyTitle")} hint={t("leitstand.emptyHint")} />;
  return (
    <>
      <div className="ls-filters" role="group" aria-label={t("leitstand.filterGroup")}>
        <FilterChip pressed={filter === "all"} count={counts.all} onPressedChange={() => setFilter("all")}>{t("state.all")}</FilterChip>
        {STATE_FORMS.map((form) => (
          <FilterChip key={form} pressed={filter === form} count={counts[form]} onPressedChange={() => setFilter(form)}>
            <StateGlyph form={form} />{STATE_WORDS[form]}
          </FilterChip>
        ))}
      </div>
      <section className="ls-agents" aria-label={t("leitstand.agents")}>
        {shown.map((c) => <AgentCard key={c.worker.id} card={c} name={nameOf(c)} now={now} onOpen={onOpen} />)}
        {shown.length === 0 && (
          <div className="ls-none"><p>{t("leitstand.none")}</p><Button size="sm" variant="tint" onClick={() => setFilter("all")}>{t("leitstand.showAll")}</Button></div>
        )}
      </section>
    </>
  );
}
