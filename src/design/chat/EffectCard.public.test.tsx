import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { EffectCard, type EffectCardProps, type ProposedEffect } from "./EffectCard";
import { Gallery } from "../gallery/Gallery";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows six effect lines and never grants or dispatches from prepare or reject", () => {
  const fetchCall = vi.spyOn(globalThis, "fetch");
  const prepare = vi.fn(), reject = vi.fn(), forbidden = vi.fn();
  const effects: readonly ProposedEffect[] = [
    { id: "file", action: "Bericht entfernen", target: "berichte/bericht-demo.md", project: "Demo", recipient: "Projektablage", count: 0,
      returnPath: { kind: "unproven", description: "Sicherung nicht geprüft" }, noConsequence: "bericht-demo.md bleibt erhalten." },
    { id: "send", action: "Demo-Nachricht senden", returnPath: { kind: "irreversible" },
      authority: { state: "stale", label: "Demo-Auftrag", scope: "Nur Demo-Projekt" }, noConsequence: "Diese Nachricht wird nicht gesendet." },
  ];
  const hostile = { onGrant: forbidden, onClick: forbidden, onKeyDown: forbidden, disabled: false, tabIndex: 0, "data-hostile": "yes" };
  const props: EffectCardProps = { effects, onPrepare: prepare, onReject: reject };
  const view = render(<EffectCard {...props} {...hostile} />);
  expect(screen.getByRole("region", { name: "Wirkungsvorschau" })).toBeVisible();
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect([...row.querySelectorAll("dt")].map((e) => e.textContent)).toEqual(["Was", "Wo", "Wie viele", "Rückweg", "Befugnis", "Bei Nein"]);
    expect(row.querySelectorAll("dd")).toHaveLength(6);
  }
  expect(within(rows[0]).getByText("0", { exact: true })).toBeVisible();
  expect(rows[0]).toHaveTextContent("berichte/bericht-demo.md");
  expect(rows[0]).toHaveTextContent("Demo");
  expect(rows[0]).toHaveTextContent("Projektablage");
  expect(rows[0]).toHaveTextContent("Nicht belegt");
  expect(rows[0]).toHaveTextContent("Sicherung nicht geprüft");
  expect(rows[0]).toHaveTextContent("Befugnis unbekannt");
  expect(rows[1]).toHaveTextContent("Unbekannt");
  expect(rows[1]).toHaveTextContent("Nicht rückgängig");
  expect(rows[1]).toHaveTextContent("Veraltet");
  expect(rows[1]).toHaveTextContent("Demo-Auftrag");
  expect(rows[1]).toHaveTextContent("Nur Demo-Projekt");
  expect(rows[1]).toHaveTextContent("Diese Nachricht wird nicht gesendet.");
  expect(screen.queryByText(/nichts (ändert|verändert)|alles (stoppt|angehalten)/i)).toBeNull();
  const grant = screen.getByRole("button", { name: "Freigeben" });
  expect(grant).toBeDisabled();
  expect(view.container.querySelector("[data-hostile]")).toBeNull();
  expect(screen.getByText("Freigabe ist hier technisch gesperrt. Vorbereiten erteilt keine Befugnis.")).toBeVisible();
  fireEvent.click(grant); fireEvent.keyDown(grant, { key: "Enter" }); fireEvent.keyUp(grant, { key: " " });
  const prep = screen.getByRole("button", { name: "Anfrage vorbereiten" });
  prep.focus(); expect(prep).toHaveFocus(); fireEvent.click(prep);
  const no = screen.getByRole("button", { name: "Nein, diese Aktionen ablehnen" });
  no.focus(); expect(no).toHaveFocus(); fireEvent.click(no);
  expect(prepare.mock.calls).toEqual([[{ effectIds: ["file", "send"] }]]);
  expect(reject.mock.calls).toEqual([[{ effectIds: ["file", "send"] }]]);
  view.rerender(<EffectCard {...props} {...hostile} mode="grant" />);
  expect(screen.queryByRole("button", { name: "Anfrage vorbereiten" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Freigeben" }));
  for (const state of ["loading", "error"] as const) {
    view.rerender(<EffectCard {...props} state={state} />);
    expect(screen.getByRole("button", { name: "Anfrage vorbereiten" })).toBeDisabled();
    expect(screen.getByText(state === "loading" ? "Wirkungen werden gelesen." : "Wirkungen konnten nicht gelesen werden. Quelle prüfen.")).toBeVisible();
  }
  view.rerender(<EffectCard {...props} state="needs-user" />);
  expect(screen.getByText("Deine Entscheidung fehlt. Hier wird nichts ausgeführt.")).toBeVisible();
  view.rerender(<EffectCard {...props} effects={[]} />);
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByText("Keine Wirkungen vorgeschlagen.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Anfrage vorbereiten" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Nein, diese Aktionen ablehnen" })).toBeDisabled();
  view.rerender(<EffectCard {...props} effects={Array.from({ length: 12 }, (_, i) => ({ ...effects[0], id: String(i), count: i === 0 ? NaN : -1 }))} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(12);
  expect(screen.getAllByText("Unbekannt", { exact: true })).toHaveLength(12);
  view.rerender(<EffectCard effects={[{ ...effects[0], count: 1, returnPath: { kind: "proven", description: "Demo-Sicherung geprüft" }, authority: { state: "current", label: "Nur lesen", scope: "Demo-Datei" } }]} />);
  expect(screen.getByText(/Belegt: Demo-Sicherung geprüft/)).toBeVisible();
  expect(screen.getByText(/Nur lesen.*Demo-Datei/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Anfrage vorbereiten" })).toBeDisabled();
  expect(prepare).toHaveBeenCalledTimes(1); expect(reject).toHaveBeenCalledTimes(1);
  expect(forbidden).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled(); expect(fetchCall).not.toHaveBeenCalled();
  cleanup();
  render(<Gallery />);
  fireEvent.click(screen.getByRole("button", { name: "Wirkungsvorschau" }));
  expect(screen.getByRole("article", { name: "EffectCard" })).toBeVisible();
  expect(within(screen.getByRole("article", { name: "EffectCard" })).getAllByRole("region", { name: "Wirkungsvorschau" })).toHaveLength(3);
  expect(screen.getByText("Beispieldaten")).toBeVisible();
});
