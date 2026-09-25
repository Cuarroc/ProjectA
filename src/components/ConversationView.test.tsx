import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OrchestratorChat } from "../lib/orchestratorChat";
import ConversationView from "./ConversationView";

vi.mock("../lib/useSharpening", () => ({
  useSharpening: () => ({
    active: false,
    phase: "idle",
    error: null,
    open: [],
    start: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const chat: OrchestratorChat = {
  orchestratorId: "orchestrator-a",
  messages: [],
  loading: false,
  sending: false,
  error: null,
  disabled: false,
  send: vi.fn(async () => true),
  clearError: vi.fn(),
};

const props = {
  chat,
  projectId: "project-a",
  projectName: "Project A",
  onOpenOrchestrator: vi.fn(),
  onOpenQuestions: vi.fn(),
};

/**
 * Der Dialog rendert den Attention-Eintrag des aktiven Orchestrators - er
 * erfindet ihn nicht, er formuliert ihn nicht um, und er kann ihn nicht
 * wegklicken.
 *
 * Die Vorarbeit (27c6799) hatte hier einen lokalen `dismissedAttention`-State
 * und einen Ausblenden-Knopf. Das war die zweite Zustandsmaschine, die dieses
 * Paket abschafft: ein Blocker, den die Oberflaeche allein verschwinden lassen
 * kann, ist keine Wahrheit mehr. Ein Bestaetigen ("gesehen") waere Zustand am
 * Eintrag und gehoert damit an den Eintrag, nicht in den Dialog - siehe F3.
 */
describe("ConversationView und der Attention-Eintrag des Orchestrators", () => {
  it("zeigt den Eintrag genau so, wie der Kern ihn geschrieben hat", () => {
    const entry =
      "Kontingent oder Rate-Limit erreicht — warte auf das nächste Zeitfenster " +
      "oder wechsle das Agentenprofil";

    render(<ConversationView {...props} runtimeAttention={entry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(entry);
    // Kein Zusatz aus der Oberflaeche: der naechste Schritt steht im Eintrag.
    expect(alert.textContent?.trim()).toBe(entry);
  });

  it("bietet kein Ausblenden an — ein Dismiss löscht keinen Blocker", () => {
    render(<ConversationView {...props} runtimeAttention="Der Agent ist beendet — neu starten" />);

    expect(screen.queryByRole("button", { name: "Ausblenden" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("blendet den Eintrag erst aus, wenn der Kern ihn zurücknimmt", () => {
    const { rerender } = render(
      <ConversationView {...props} runtimeAttention="Der Agent ist beendet — neu starten" />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ConversationView {...props} runtimeAttention={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("zeigt ohne Eintrag nichts an", () => {
    render(<ConversationView {...props} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ConversationView accessibility (ui-ux-pro-max audit)", () => {
  it("APP-6: the composer has an accessible name beyond its placeholder", () => {
    render(<ConversationView {...props} />);
    expect(screen.getByLabelText("Nachricht an den Orchestrator")).toBeInTheDocument();
  });

  it("APP-12: a chat error is announced and its dismiss says what it does", () => {
    render(<ConversationView {...props} chat={{ ...chat, error: "Senden fehlgeschlagen" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Senden fehlgeschlagen");
    expect(
      screen.getByRole("button", { name: "Fehler ausblenden: Senden fehlgeschlagen" }),
    ).toBeInTheDocument();
  });
});
