import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BetriebPanel } from "./BetriebPanel";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

beforeEach(() => { mocks.invoke.mockReset(); });

function backend(resources: unknown) {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "list_queue" || command === "watchdog_report") return [];
    if (command === "get_emergency_stop") return false;
    if (command === "get_resource_snapshot") {
      if (resources instanceof Error) throw resources;
      return resources;
    }
    throw new Error(`unexpected command: ${command}`);
  });
}

it("labels partial app data as a lower bound and never assumes missing quality is complete", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ diskAppBytes: 1610612736, diskAppPartial: true }, "mindestens 1,5 GiB"],
    [{ diskAppBytes: 1610612736, diskAppPartial: false }, "1,5 GiB"],
    [{ diskAppBytes: 1610612736 }, "1,5 GiB (Vollständigkeit unbekannt)"],
    [{ diskAppBytes: 1610612736, diskAppPartial: null }, "1,5 GiB (Vollständigkeit unbekannt)"],
    [{ diskAppBytes: 1610612736, diskAppPartial: "false" }, "1,5 GiB (Vollständigkeit unbekannt)"],
    [{ diskAppBytes: 0, diskAppPartial: false }, "0 GiB"],
    [{ diskAppBytes: 0, diskAppPartial: true }, "mindestens 0 GiB"],
    [{ diskAppBytes: 0 }, "0 GiB (Vollständigkeit unbekannt)"],
  ];
  for (const [appData, expected] of cases) {
    mocks.invoke.mockClear();
    backend({
      observedAt: 1, cpuPermille: 125, ramProcessBytes: 2147483648, ramTotalBytes: 17179869184,
      diskFreeBytes: 10737418240, tokensIn: 0, tokensOut: 0, ...appData,
    });
    const { rerender, unmount } = render(<BetriebPanel projectId="p1" profiles={[]} />);
    await act(async () => {});
    const check = within(screen.getByRole("region", { name: "Startprüfung" }));
    const value = check.getByText("App-Daten-Verzeichnis").nextElementSibling;
    expect(value?.textContent).toBe(expected);
    expect(check.getByText("CPU der App, Durchschnitt seit Start").nextElementSibling?.textContent).toBe("12,5 %");
    expect(check.getByText("Freier Platz auf dem Datenträger der App-Daten").nextElementSibling?.textContent).toBe("10 GiB");
    expect(check.getByText("Arbeitsspeicher der App").nextElementSibling?.textContent).toBe("2 GB von 16 GB");
    rerender(<BetriebPanel projectId="p1" profiles={[]} />);
    await act(async () => {});
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "list_queue", "get_resource_snapshot", "watchdog_report", "get_emergency_stop",
    ]);
    unmount();
  }
});

it("keeps absent and invalid app data sizes unknown instead of inventing zero", async () => {
  for (const bytes of [undefined, null, -1, NaN, Infinity, "0"]) {
    backend({ diskAppBytes: bytes, diskAppPartial: false });
    const { unmount } = render(<BetriebPanel projectId="p1" profiles={[]} />);
    await act(async () => {});
    const check = within(screen.getByRole("region", { name: "Startprüfung" }));
    expect(check.getByText("App-Daten-Verzeichnis").nextElementSibling?.textContent).toBe("Der Kern liefert gerade keinen Wert");
    expect(check.queryByText(/GiB/)).toBeNull();
    unmount();
  }
});

it("keeps a rejected resource read unknown while preserving queue and RAM error states", async () => {
  backend(new Error("resource read failed"));
  render(<BetriebPanel projectId="p1" profiles={[]} />);
  await act(async () => {});
  const check = within(screen.getByRole("region", { name: "Startprüfung" }));
  expect(check.getByText("App-Daten-Verzeichnis").nextElementSibling?.textContent).toBe("Der Kern liefert gerade keinen Wert");
  expect(check.getByText("Arbeitsspeicher noch nicht verbunden")).toBeVisible();
  expect(check.getByText("Freie Worker-Slots noch nicht verbunden")).toBeVisible();
  expect(check.queryByText(/GiB/)).toBeNull();
  expect(screen.getByText("Warteschlange leer")).toBeVisible();
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_resource_snapshot")).toHaveLength(1);
});

it("keeps AppData in its original unboxed description list", async () => {
  backend({ cpuPermille: 0, diskFreeBytes: 0, diskAppBytes: 0, diskAppPartial: true });
  render(<BetriebPanel projectId="p1" profiles={[]} />);
  await act(async () => {});
  const check = within(screen.getByRole("region", { name: "Startprüfung" }));
  const appData = check.getByText("App-Daten-Verzeichnis").closest("dl");
  const cpu = check.getByText("CPU der App, Durchschnitt seit Start").closest("dl");
  expect(appData).not.toBe(cpu);
  expect(appData).toHaveClass("g-kv");
  expect(appData).not.toHaveClass("g-kv--box");
  expect(within(appData!).getAllByRole("term").map((term) => term.textContent)).toEqual(["App-Daten-Verzeichnis"]);
  expect(within(appData!).getAllByRole("definition").map((definition) => definition.textContent)).toEqual(["mindestens 0 GiB"]);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_resource_snapshot")).toHaveLength(1);
});
