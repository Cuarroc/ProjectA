/**
 * F0-Abnahme, localStorage-Hälfte: "Legacy-Fixtures öffnen ohne Datenverlust."
 *
 * Bis F0 hat kein einziger Test je einen localStorage-Wert gesetzt — die drei
 * vorhandenen Fundstellen rufen nur `localStorage.clear()`. Damit war unbelegt,
 * was beim Lesen eines Altbestands passiert. Keiner der acht Keys trägt ein
 * Versionsfeld, und jeder Lesepfad fällt bei Fremdinhalt still auf seinen
 * Default zurück. Das ist heute harmlos (alles Bequemlichkeit), wird aber in
 * dem Moment zur sichtbaren Lüge, in dem F2 dieselben Keys zu benannten
 * Overlays mit echtem Verhalten macht.
 *
 * Diese Tests frieren das heutige Verhalten ein — auch dort, wo es eine Lücke
 * ist. Ein Test, der eine Lücke behauptet statt sie zu verschweigen, ist der
 * Anker, an dem F2 merkt, dass es etwas kaputt macht.
 *
 * Belege und Herleitung: `.pa/report_f0.md` §3 und §5.
 */
import { beforeEach, describe, expect, it } from "vitest";

import fixture from "../test/fixtures/localStorage-v1.2.4.json";
import {
  composeWithMasterPrompt,
  isCategoryActive,
  isMasterPromptEnabled,
  loadAgentCategories,
  loadMasterPrompt,
  loadOnboardingHints,
  loadWebPort,
  pickSpawnProfile,
  saveAgentCategories,
} from "./settings";

/** Der eingefrorene Bestand ohne den Kommentarblock. */
const LEGACY: Record<string, string> = Object.fromEntries(
  Object.entries(fixture).filter(
    (entry): entry is [string, string] => entry[0] !== "_comment",
  ),
);

function seed(overrides: Record<string, string | null> = {}): void {
  localStorage.clear();
  for (const [key, value] of Object.entries({ ...LEGACY, ...overrides })) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe("v1.2.4-Vollbestand", () => {
  it("liest jeden Key unverändert zurück", () => {
    seed();

    expect(loadOnboardingHints()).toBe(false);
    expect(loadWebPort()).toBe(9123);
    expect(isMasterPromptEnabled()).toBe(true);
    // Byte-genau: Zeilenumbrüche und Umlaute überleben die Runde.
    expect(loadMasterPrompt()).toBe(LEGACY["projecta.settings.masterPrompt"]);
    expect(loadMasterPrompt()).toContain("\n");
    expect(loadMasterPrompt()).toContain("Antworte auf Deutsch.");
  });

  it("fasst die app-eigenen Keys nicht an", () => {
    seed();

    // `projecta.activeProjectId` und `projecta.railOpen` liegen in App.tsx,
    // nicht in settings.ts. Ein Lesevorgang dort darf sie nicht anfassen.
    loadOnboardingHints();
    loadWebPort();
    loadAgentCategories();
    loadMasterPrompt();

    expect(localStorage.getItem("projecta.activeProjectId")).toBe("pr-legacy-0001");
    expect(localStorage.getItem("projecta.railOpen")).toBe("false");
  });

  it("bewahrt den Legacy-Updater-Token, bis die Settings-Ansicht ihn löscht", () => {
    seed();

    loadAgentCategories();

    // Der löschende Pfad sitzt in SettingsView (Mount), nicht hier. Er ist die
    // benannte Ausnahme vom "ohne Datenverlust" — siehe report_f0.md §5.
    expect(localStorage.getItem("projecta.settings.updater.github_token")).toBe(
      LEGACY["projecta.settings.updater.github_token"],
    );
  });
});

describe("Agent-Kategorien", () => {
  it("übernimmt gespeicherte Kategorien samt defaultProfileId", () => {
    seed();

    const categories = loadAgentCategories();
    const byId = Object.fromEntries(categories.map((c) => [c.id, c]));

    expect(byId.worker).toMatchObject({ active: true, defaultProfileId: "claude" });
    expect(byId.queen).toMatchObject({ active: false, defaultProfileId: "codex" });
    expect(byId.employee).toMatchObject({ active: true, defaultProfileId: "kimi" });
  });

  it("verwirft eine unbekannte Kategorie-ID wortlos", () => {
    // Der konkrete Verlustpfad, den F2 auslöst, sobald es `employee` und die
    // Queen-Neuanlage aus der Default-Liste nimmt: der gespeicherte Wert
    // verschwindet ohne Meldung. Hier mit einer synthetischen ID belegt, damit
    // der Test nicht davon abhängt, welche Kategorien gerade existieren.
    seed({
      "projecta.settings.agentCategories": JSON.stringify({
        worker: { active: true, defaultProfileId: "claude" },
        wegrationalisiert: { active: true, defaultProfileId: "kimi" },
      }),
    });

    const ids = loadAgentCategories().map((c) => c.id);

    expect(ids).not.toContain("wegrationalisiert");
    expect(ids).toContain("worker");
  });

  it("ergänzt eine fehlende Kategorie mit ihrem Default", () => {
    seed({
      "projecta.settings.agentCategories": JSON.stringify({
        worker: { active: false, defaultProfileId: null },
      }),
    });

    const byId = Object.fromEntries(loadAgentCategories().map((c) => [c.id, c]));

    expect(byId.worker.active).toBe(false);
    expect(byId.scout).toMatchObject({ active: true, defaultProfileId: null });
  });

  it.each([
    ["leeres Array", "[]"],
    ["null", "null"],
    ["abgeschnittenes JSON", '{"worker":'],
    ["Fremdtext", "kaputt"],
  ])("fällt bei %s auf die Defaults zurück, ohne zu werfen", (_label, payload) => {
    seed({ "projecta.settings.agentCategories": payload });

    const categories = loadAgentCategories();

    expect(categories.length).toBeGreaterThan(0);
    expect(categories.every((c) => c.active)).toBe(true);
    expect(categories.every((c) => c.defaultProfileId === null)).toBe(true);
  });
});

describe("Masterprompt", () => {
  it("entschärft die Playbook-Marker eines Altbestands (C-6)", () => {
    seed();

    const composed = composeWithMasterPrompt("Baue Feature X.");

    // Bis F1 stand hier das Gegenteil: der Altbestand reichte die Marker
    // ungeprüft durch, und `FORBIDDEN_MARKERS` (learnings.rs:112) sperrte sie
    // nur auf dem Approve-Pfad. Ein Masterprompt konnte damit die
    // Playbook-Grenze im fertigen Agenten-Prompt fälschen. Jetzt gilt derselbe
    // Marker-Satz auch hier.
    expect(composed).not.toContain("--- TASK ---");
    expect(composed).not.toContain("--- PROJEKT-PLAYBOOK ---");
    // Der Rest des Altbestands überlebt: gesperrt wird die gefälschte Grenze,
    // nicht die Anweisung des Nutzers.
    expect(composed).toContain("Antworte auf Deutsch.");
    expect(composed).toContain("Halte dich an AGENTS.md.");
    expect(composed).toContain("Baue Feature X.");
  });

  it.each([
    ["--- TASK ---"],
    ["--- PROJEKT-PLAYBOOK ---"],
    ["  --- TASK ---  "],
    ["Vorher --- TASK --- nachher"],
  ])("entfernt die Zeile, die %s trägt", (line) => {
    seed({ "projecta.settings.masterPrompt": `Zeile eins.\n${line}\nZeile drei.` });

    const composed = composeWithMasterPrompt("Baue Feature X.");

    expect(composed).not.toContain("--- TASK ---");
    expect(composed).not.toContain("--- PROJEKT-PLAYBOOK ---");
    expect(composed).toContain("Zeile eins.");
    expect(composed).toContain("Zeile drei.");
  });

  it("hängt nichts an, wenn vom Masterprompt nur Marker übrig bleiben", () => {
    seed({ "projecta.settings.masterPrompt": "--- TASK ---\n--- PROJEKT-PLAYBOOK ---" });

    expect(composeWithMasterPrompt("Baue Feature X.")).toBe("Baue Feature X.");
  });

  it("lässt einen markerfreien Masterprompt byte-genau in Ruhe", () => {
    seed({ "projecta.settings.masterPrompt": "Antworte auf Deutsch.\nSei kurz." });

    expect(composeWithMasterPrompt("Baue Feature X.")).toBe(
      "Antworte auf Deutsch.\nSei kurz.\n\n---\n\nBaue Feature X.",
    );
  });

  it("hängt bei leerem Masterprompt nichts an, obwohl der Schalter an ist", () => {
    seed({ "projecta.settings.masterPrompt": null });

    expect(isMasterPromptEnabled()).toBe(true);
    expect(composeWithMasterPrompt("Baue Feature X.")).toBe("Baue Feature X.");
  });
});

describe("Web-Port", () => {
  it.each([
    ["0", null],
    ["65536", null],
    ["-1", null],
    ["achttausend", null],
    ["8787", 8787],
  ])("liest %s als %s statt es zu reparieren", (raw, expected) => {
    seed({ "projecta.settings.webPort": raw });

    expect(loadWebPort()).toBe(expected);
  });
});

describe("F0-5 spawn overlays", () => {
  const profiles = [{ id: "claude" }, { id: "codex" }, { id: "kimi" }];

  it("picks the worker defaultProfileId when it is still on the roster", () => {
    seed();
    expect(pickSpawnProfile("worker", profiles)).toBe("claude");
  });

  it("returns null when the worker category is switched off", () => {
    seed();
    const categories = loadAgentCategories().map((category) =>
      category.id === "worker" ? { ...category, active: false } : category,
    );
    saveAgentCategories(categories);
    expect(isCategoryActive("worker")).toBe(false);
    expect(pickSpawnProfile("worker", profiles)).toBeNull();
  });

  it("skips a blocked default and takes the next usable profile", () => {
    seed();
    expect(pickSpawnProfile("worker", profiles, new Set(["claude"]))).toBe("codex");
  });
});
