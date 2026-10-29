import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { OrchestratorMessage, type OrchestratorMessageProps } from "./OrchestratorMessage";
import { Gallery } from "../gallery/Gallery";

vi.hoisted(() => {
  const NativeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation((locale, options) => new NativeFormat(locale, { ...options, timeZone: "Europe/Berlin" }));
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("renders message kind source status and time and announces only completed paragraphs", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  const network = vi.spyOn(globalThis, "fetch"), hostile = vi.fn();
  const props: OrchestratorMessageProps = { id: "m1", kind: "question", role: "agent", source: "tab",
    status: { operatingStatus: "running", evidenceStatus: "gemeldet", boardForm: "run" },
    observedAtSeconds: 1793274600, text: "Die Prüfung be", nextStep: "Absatz abwarten.", loading: true };
  const draw = (p: OrchestratorMessageProps) => <StrictMode><OrchestratorMessage {...p} {...{ onClick: hostile, tabIndex: 0, "data-hostile": "yes" }} /></StrictMode>;
  const view = render(draw(props));
  const article = screen.getByRole("article", { name: "Frage. Orchestrator. Läuft." });
  expect(article).toHaveTextContent("Quelle: Tab"); expect(article).toHaveTextContent("Nachweis: gemeldet");
  expect(article.querySelector("time")).toHaveAttribute("datetime", "2026-10-29T11:50:00.000Z");
  expect(article.querySelector("time")).toHaveTextContent("12:50");
  expect(article).toHaveTextContent("Die Prüfung be");
  const live = screen.getByRole("log"); expect(live).toHaveAttribute("aria-live", "polite"); expect(live).toBeEmptyDOMElement();
  const draft = document.createElement("textarea"); draft.value = "Entwurf behalten"; document.body.append(draft); draft.focus();
  view.rerender(draw({ ...props, text: "Die Prüfung beg" })); expect(live).toBeEmptyDOMElement(); expect(draft).toHaveFocus();
  const completed = { ...props, loading: false, text: "Die Prüfung beginnt.", completedParagraphs: [{ id: "p1", text: "Die Prüfung beginnt." }] };
  view.rerender(draw(completed)); expect(live).toHaveTextContent("Die Prüfung beginnt."); expect(live.children).toHaveLength(1);
  const announcement = live.firstChild;
  view.rerender(draw({ ...completed, completedParagraphs: [{ ...completed.completedParagraphs[0] }], text: "Die Prüfung beginnt. Neu" }));
  expect(live.firstChild).toBe(announcement); expect(live.children).toHaveLength(1);
  view.rerender(draw({ ...completed, completedParagraphs: [...completed.completedParagraphs, { id: "p2", text: "Zweiter Absatz." }] }));
  expect(live.children).toHaveLength(2); expect(live.lastChild).toHaveTextContent("Zweiter Absatz.");
  const kinds = ["question", "order", "idea", "approval-request", "system"] as const;
  const labels = ["Frage", "Auftrag", "Idee", "Freigabe-Anfrage", "System"];
  for (const [i, kind] of kinds.entries()) {
    view.rerender(draw({ ...props, kind })); expect(screen.getByRole("heading", { name: labels[i] })).toBeVisible();
    expect(article.querySelector(`.kind-${kind}`)).toHaveAttribute("aria-hidden", "true");
  }
  for (const [source, word] of [["tab", "Tab"], ["voice", "Stimme"], ["file", "Datei"]] as const) {
    view.rerender(draw({ ...props, source })); expect(article).toHaveTextContent(`Quelle: ${word}`);
  }
  for (const observedAtSeconds of [undefined, null, NaN, Infinity, -1, 0, 1e20]) {
    view.rerender(draw({ ...props, observedAtSeconds })); expect(article.querySelector("time")).toHaveTextContent("Zeit unbekannt");
    expect(article.querySelector("time")).not.toHaveAttribute("datetime");
  }
  const proof = { sourceId: "demo", identity: "revision-1", observedAt: "2026-10-29T11:50:00Z", freshness: "fresh" as const };
  const status = { operatingStatus: "completed", evidenceStatus: "bewiesen", boardForm: "ok" as const,
    source: { id: "demo", identity: "revision-1", checkedAt: "2026-10-29T11:51:00Z" }, beleg: proof };
  view.rerender(draw({ ...props, status })); expect(article).toHaveTextContent("Fertig mit Beleg"); expect(article).toHaveTextContent("Beispielbeleg: frisch");
  for (const beleg of [{ ...proof, freshness: "stale" as const }, { ...proof, freshness: "unknown" as const }, { ...proof, identity: "other" }, undefined]) {
    view.rerender(draw({ ...props, status: { ...status, beleg } })); expect(article).toHaveTextContent("Unbelegt");
    expect(article).toHaveTextContent("Kein aktueller Beleg"); expect(article).not.toHaveTextContent("Fertig mit Beleg");
  }
  view.rerender(draw({ ...props, status: { operatingStatus: "unknown", evidenceStatus: "unbekannt", boardForm: "unknown" } }));
  expect(article).toHaveTextContent("Stand wird geprüft");
  const text = 'Nachrichtenherkunftsüberprüfungsauftrag <img src=x onerror="alert(1)"> javascript:alert(1) $(touch demo)';
  view.rerender(draw({ ...props, text, error: "Verlauf konnte nicht gelesen werden.", nextStep: "Quelle prüfen; keinen zweiten Auftrag starten." }));
  expect(article).toHaveTextContent(text); expect(article).toHaveTextContent("Verlauf konnte nicht gelesen werden.");
  expect(article).toHaveTextContent("Quelle prüfen; keinen zweiten Auftrag starten.");
  expect(article.querySelector("img, a, script, [data-hostile]")).toBeNull(); expect(draft).toHaveFocus(); expect(draft).not.toBeDisabled();
  const summary = screen.getByText("Herkunft und Beleg"); summary.focus(); expect(summary).toHaveFocus(); fireEvent.click(summary);
  expect(article).toHaveTextContent("Nachrichtenkennung: m1"); expect(article).toHaveTextContent("Beobachtet:");
  expect(network).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled(); expect(hostile).not.toHaveBeenCalled(); draft.remove();
  cleanup(); render(<Gallery />); fireEvent.click(screen.getByRole("button", { name: "Wirkungsvorschau" }));
  expect(within(screen.getByRole("article", { name: "OrchestratorMessage" })).getAllByRole("article")).toHaveLength(3);
});
