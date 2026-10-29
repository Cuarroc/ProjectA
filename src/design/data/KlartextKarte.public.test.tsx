import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { KlartextKarte, type KlartextKarteProps } from "./KlartextKarte";
import { projectKlartext, type KlartextInput } from "./klartext";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const identity = "0123456789abcdef0123456789abcdef01234567";
const source = { id: "gate-local", identity, checkedAt: "2026-10-29T12:00:00Z" };
const beleg = { sourceId: "gate-local", identity, observedAt: "2026-10-29T11:59:00Z", freshness: "fresh" as const };
const raw: KlartextInput = { operatingStatus: "completed", evidenceStatus: "bewiesen", boardForm: "done", source, beleg };

it("composes five Klartext lines one action and remembered keyboard details without product effects", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch"), inspect = vi.fn();
  const props: Omit<KlartextKarteProps, "detailsOpen" | "onDetailsChange"> = {
    id: "A", satz: "Der Agent prüft den Entwurf.", projection: projectKlartext(raw), naechstes: "Beleg prüfen.",
    vonDir: "Empfohlen: Bericht ansehen.", level: 3, onInspect: inspect, technical: "Gehört zu: MS-1; Log: sample.log",
    proofMeta: { ...beleg, gates: ["pass", "fail"], href: "#system-proof" },
    facts: { scope: "Ein Bericht", target: "berichte/entwurf.md", project: "Demo-Projekt", count: 2, recipient: "Lokale Ansicht",
      effect: "Öffnet nur die Ansicht", authority: "Wartet auf dein Ja im Chat", return: "Ansicht schließen", progress: "1 von 2 Schritten", quota: "2 Schritte nötig" },
  };
  function Host(p: typeof props) {
    const [memory, setMemory] = useState<Record<string, boolean>>({});
    return <KlartextKarte {...p} detailsOpen={memory[p.id] ?? false} onDetailsChange={(id, open) => setMemory(m => ({ ...m, [id]: open }))} />;
  }
  const view = render(<Host {...props} />);
  const card = screen.getByRole("article");
  expect([...card.querySelectorAll(".g-kl__facts dt")].filter(el => el.textContent === "Befugnis")).toHaveLength(1);
  expect(screen.getByText("Rechtestufe", { exact: true })).toBeVisible();
  const clockSource = { ...source, checkedAt: new Date(2026, 9, 29, 12, 0).toISOString() };
  const clockProof = { ...beleg, observedAt: new Date(2026, 9, 29, 11, 59).toISOString() };
  view.rerender(<Host {...props} projection={projectKlartext({ ...raw, source: clockSource, beleg: clockProof })} />);
  expect(card.querySelector('[data-field="zustand"] time')).toHaveTextContent(/^29\.10\. 12:00$/);
  expect(card.querySelector('[data-field="beleg"] time')).toHaveTextContent(/^29\.10\. 11:59$/);
  for (const checkedAt of ["", "invalid-date"]) {
    view.rerender(<Host {...props} projection={projectKlartext({ ...raw, source: { ...source, checkedAt } })} />);
    expect(card.querySelectorAll("time")).toHaveLength(0);
    expect(card.querySelector('[data-field="beleg"]')).toHaveTextContent("Frische unbekannt");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  }
  const unknown = { scope: "Unbekannt", target: "Unbekannt", project: "Unbekannt", count: null,
    recipient: "Unbekannt", effect: "Unbekannt", authority: "Unbekannt", return: "Unbekannt", progress: "Unbekannt", quota: null };
  view.rerender(<Host {...props} projection={projectKlartext({ operatingStatus: "quiet", evidenceStatus: "gemeldet", boardForm: "rev" })} facts={unknown} />);
  expect(card.querySelectorAll(".g-kl__facts > div")).toHaveLength(3);
  expect(screen.getByText("Umfang, Ziel, Projekt, Wie viele, Empfänger, Was passiert, Befugnis, Rückweg, Fortschritt, Kontingent")).toBeVisible();
  expect(card.querySelectorAll("time")).toHaveLength(0);
  expect(card.querySelector('[data-field="beleg"]')).not.toHaveTextContent("Frische unbekannt Unbekannt");
  expect(screen.getByText("Prüfstand unbekannt")).toBeVisible();
  view.rerender(<Host {...props} facts={{ ...unknown, count: 0, quota: "0 Schritte nötig" }} />);
  expect(screen.getByText("0", { exact: true })).toBeVisible();
  expect(screen.getByText("0 Schritte nötig", { exact: true })).toBeVisible();
  view.rerender(<Host {...props} />);
  expect(card.querySelector('[data-field="zustand"] time')).toHaveAttribute("datetime", "2026-10-29T12:00:00Z");
  expect(card.querySelector('[data-field="beleg"] time')).toHaveAttribute("datetime", "2026-10-29T11:59:00Z");
  expect(card).toHaveAccessibleName("Fertig mit Beleg. Der Agent prüft den Entwurf. Beleg vorhanden. Von dir: Empfohlen: Bericht ansehen.");
  expect([...card.querySelectorAll("[data-field]")].map(el => el.getAttribute("data-field"))).toEqual(["satz", "zustand", "beleg", "naechstes", "vonDir"]);
  expect(screen.getByText("Fertig mit Beleg")).toBeVisible();
  expect(screen.getByRole("link", { name: "Gates 1/2" })).toHaveAttribute("href", "#system-proof");
  for (const compact of [false, true]) {
    view.rerender(<Host {...props} compact={compact} />);
    for (const text of ["Ein Bericht", "berichte/entwurf.md", "Demo-Projekt", "2", "Lokale Ansicht", "Öffnet nur die Ansicht",
      "Wartet auf dein Ja im Chat", "Ansicht schließen", "1 von 2 Schritten", "2 Schritte nötig", "Rechtestufe 3, nur Ansicht",
      "gate-local", "Aktuell", identity]) {
      const el = screen.getAllByText(text, { exact: false }).find(el => !el.closest("details"));
      expect(el, text).toBeVisible();
    }
    expect(card.querySelectorAll(".g-btn--primary")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Ansehen" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Freigeben|Zustimmen/ })).not.toBeInTheDocument();
  }
  const details = () => screen.getByText("Technische Details");
  expect(details()).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(details());
  expect(details()).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Gehört zu: MS-1; Log: sample.log")).toBeVisible();
  view.rerender(<Host {...props} id="B" />);
  expect(details()).toHaveAttribute("aria-expanded", "false");
  view.rerender(<Host {...props} compact />);
  expect(details()).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(details());
  expect(details()).toHaveAttribute("aria-expanded", "false");
  const explain = screen.getByRole("button", { name: "Erklär mir das" });
  explain.focus();
  fireEvent.click(explain);
  expect(explain).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Was ist das?", "Warum ist das für dich wichtig?", "Was musst du tun?"]) expect(screen.getByRole("heading", { name })).toBeVisible();
  expect(screen.getByText("Diese Karte zeigt den belegten Stand einer Arbeit. Unbekanntes bleibt unbekannt.")).toBeVisible();
  expect(screen.getByText("Nur ein passender aktueller Beleg bestätigt ein Ergebnis. Die Anzeige erteilt keine Befugnis.")).toBeVisible();
  expect(screen.getByText("Lies „Von dir“. Ansehen öffnet nur eine Ansicht; eine Zustimmung gibst du im Chat.")).toBeVisible();
  expect(screen.getByText("Quelle: Klartext-Vertrag 9.2, 9.3, 9.5–9.7 · 28.10.2026")).toBeVisible();
  const close = () => screen.getByRole("button", { name: "Schließen" });
  close().focus();
  fireEvent.keyDown(close(), { key: "Escape" });
  expect(explain).toHaveAttribute("aria-expanded", "false");
  expect(explain).toHaveFocus();
  fireEvent.click(explain);
  close().focus();
  fireEvent.click(close());
  expect(explain).toHaveAttribute("aria-expanded", "false");
  expect(explain).toHaveFocus();
  const action = screen.getByRole("button", { name: "Ansehen" });
  action.focus();
  fireEvent.click(action);
  expect(inspect).toHaveBeenCalledExactlyOnceWith("A");
  view.rerender(<Host {...props} loading />);
  expect(action).toHaveFocus();
  expect(action).toHaveAttribute("aria-busy", "true");
  fireEvent.click(action);
  expect(inspect).toHaveBeenCalledTimes(1);
  for (const bad of [undefined, { ...beleg, freshness: "stale" as const }, { ...beleg, identity: "another-identity" }, { ...beleg, freshness: "unknown" as const }]) {
    view.rerender(<Host {...props} projection={projectKlartext({ ...raw, beleg: bad, modelClaim: "Fertig" })} />);
    if (bad?.identity === "another-identity") {
      expect(card.querySelector('[data-field="beleg"]')).not.toHaveTextContent("Aktuell");
      expect(card.querySelector(".g-kl__facts")).not.toHaveTextContent("another-identity");
    }
    expect(screen.getByText("Unbelegt")).toBeVisible();
    expect(screen.getAllByText("Kein nutzbarer Beleg.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Fertig mit Beleg")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // projection contract: stale proof is not usable
    expect(card.querySelector('[data-field="beleg"] > span:last-child')).toHaveTextContent(/^Frische unbekannt$/);
    expect(card.querySelector('[data-field="beleg"] time')).not.toBeInTheDocument();
    expect(card.querySelector(".g-kl__facts code")).toHaveTextContent(identity);
  }
  view.rerender(<Host {...props} proofMeta={{ ...beleg, gates: null }} facts={{ ...props.facts, count: null }} />);
  expect(screen.getByText("Prüfstand unbekannt")).toBeVisible();
  expect(screen.getAllByText("Unbekannt").length).toBeGreaterThan(0);
  expect(screen.queryByText("Gates 0/0")).not.toBeInTheDocument();
  expect(screen.getByText(identity)).toBeVisible();
  view.rerender(<Host {...props} proofMeta={{ ...beleg, gates: [] }} facts={{ ...props.facts, count: 0 }} />);
  expect(screen.getByText("Gates 0/0")).toBeVisible();
  expect(screen.getByText("0", { exact: true })).toBeVisible();
  const live = screen.getByRole("status"), mutations: MutationRecord[] = [];
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(live).toHaveAttribute("aria-live", "polite");
  expect(live).toHaveAttribute("aria-atomic", "true");
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(live, { childList: true, characterData: true, subtree: true });
  for (const [operatingStatus, evidenceStatus, state] of [["quiet", "vorgeschlagen", "Wartet auf dich"], ["error", "gemeldet", "Problem"]]) {
    const projection = projectKlartext({ operatingStatus, evidenceStatus, boardForm: "done", needsUser: true });
    view.rerender(<Host {...props} projection={projection} />);
    expect(live).toHaveTextContent(`${state}. Der Agent prüft den Entwurf. Kein nutzbarer Beleg. Von dir: Empfohlen: Bericht ansehen. Nächstes: Beleg prüfen.`);
    await act(async () => { await Promise.resolve(); });
    mutations.length = 0;
    view.rerender(<Host {...props} projection={projection} satz="Der Agent liest den Bericht." />);
    await act(async () => { await Promise.resolve(); });
    expect(mutations).toHaveLength(0);
  }
  observer.disconnect();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
