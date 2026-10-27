# PLAN — der einzige Plan für ProjectA

Stand: 24.10.2026, Basis 05b6cf02ab9420f176507497fcf6a6c482a2a790; P4a/P4b1/P4b2/P4c sind gemergt; Gesamtmaster durch Root am 24.10. mit PLAN-v2.0-4d abgenommen (Ticket 5936). Dieser Master bleibt der einzige Plan; Unterpläne binden Verträge, Archive erteilen keinen Auftrag.

> **Für Agenten:** zuerst „Für den Nutzer“, „Statuswerte“ und die aktiven Restpflichten der eigenen Z-Tabelle lesen; `rg -n "<ID>" docs/PLAN.md`. Die kompakten historischen Registergruppen innerhalb von Z1–Z4 sind nur Leser-/Abhängigkeitsziele, **kein Dispatch**; [Originalzeilen P4a](archive/plan-2026-10/z-targets-2026-10-24.md), [früheres Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md). Offene oder mehrdeutige Restpflichten bleiben aktiv, auch bei „Erledigt“ als Lieferstatus.
> [Historie][historie] · [Paketoriginale][pakete] · [Archivschnitt Phase 1](archive/plan-2026-10/completed-z-2026-10-23.md) · [Kontext Phase 2](archive/plan-2026-10/context-2026-10-23.md). M1–M5 und DF bleiben im ausdrücklich nicht disponierenden Kompatibilitätsanhang.


## Für den Nutzer

- **Geliefert:** v1.6.0 und die dokumentierten Nachlieferungen; DS-U0/#1861 benennt die kanonische Designquelle, #1862 berichtigt die Abnahmeverweise. Das sind keine Glass- oder Nutzerabnahmen.
- **Jetzt:** „Nutzbar 1“ mit der aktuellen Glass-Oberfläche: Auftrag geben, beobachteten Zustand sehen, antworten und Ergebnis prüfen. Erst die genehmigte Bestandsaufnahme, dann belegte Funktionen und einheitliche UI; Pixel-Fabrik, DS-H/DS-WF, Exporte und Artefaktauffrischung bleiben v2.x. `styles.css` wird nicht pauschal entfernt.
- **Noch offen:** echte technische Glass-Abnahme und Nutzer-UAT, Beta-/Update-Drill und E14-Releasebeleg; D1-on/#1540 und Release-Sperre bleiben. Bestandsaufnahme/MOCK und Screenshots beweisen keinen nativen Backendbetrieb; die isolierte native Laufzeitoption ist noch nicht eingerichtet.
- **Weitere Restpflichten:** Denkraum DR-03/08/15/16b/17; v1.6-Nachbeobachtung; M4B-Test-/Audit-/Windows-Reste, DOC-Gesamtabnahme und Sicherheitsentscheidung zu SEC-01b. Continuous bleibt deaktiviert und eingefroren.
- **Nutzerentscheidungen:** GI02 (Classic): verbergen/hinter Schalter oder bauen ist offen. GI05 (13 Platzhalter) ist am 26.10.2026 beantwortet: standardmäßig verbergen, per sichtbarem Schalter wieder zeigen. Der Rest bis v2.0.0 steht im Abschnitt „V2-REST“. Weitere unbeantwortete Fragen stehen in der Inbox; beantwortete Fragen werden nicht erneut gestellt.
- **Release:** K5 erlaubt nur die dort benannten Patch-Ausnahmen; jede konkrete Freigabe bleibt erforderlich. Minor/Major, insbesondere v2.0.0, brauchen ein frisches abschließendes Ja. Kein Planabschluss erlaubt Tag, Installation oder Release.

Bestehender enger Vertrag: [v2-Unterplan §10](plan/v2.0/plan.md#101-restpakete-v20-eng). Root nimmt den fertigen Master ausdrücklich ab; der Dokumentenschnitt schließt weder das Elternziel vor dieser Abnahme noch Produkt- oder externe Gesamtakzeptanz.

## Statuswerte

Grundwerte je Paket: **Geplant**, **Bereit**, **In Arbeit**, **In Prüfung**,
**Erledigt**, **Blockiert**, **Verschoben**, **Entfallen**. „Bereit“ heißt: Vorgänger
erfüllt, kein offener PR, keine Dateikollision, Owner und Abnahme stehen fest.
„Angenommen, Mergify ausstehend“ und „Entwurf“ gehören zu „In Prüfung“;
„wartet“ gehört zu „Blockiert“. Angenommen heißt noch nicht gemergt.

Stufe A/B/C nach AGENTS.md Regel 5. Ort: **PC**, **Server** oder **egal**.
Jedes Paket ≤ 300 geänderte Zeilen einschließlich Tests und Hilfsdateien.

## Z1 — Denkraum release-fertig für v1.6.0

Abnahme Z1 (alles muss belegt sein):

- P1-Store angenommen (DR-02 bis DR-07 gemergt, Gates grün).
- Vollständige P2-Oberfläche mit Kategorie, Prioritäts-/Stationsfilter und Sortierung
  (DR-08 bis DR-14), einschließlich R1-Fix (`app.js:349`, Neuaufbau beim Polling) mit
  rotem Test zuerst.
- P3-Live-Schaltung mit Schreibpause, Sicherung und metadatensicherem Rückweg (DR-16).
  Rückweg = vollständige Pause, P1-Store und aktuelles Ledger bleiben; nie ein älteres
  Ledger nach angenommenen Schreibvorgängen zurückspielen.
- Start ohne manuelle Secret-Eingabe (DR-15).
- Alles gemergt mit grünen Gates und den Reviews der Stufe.
- Anleitung in 5 Schritten und Changelog-Eintrag (DR-17).
- Der Release v1.6.0 ist die Entscheidung des Nutzers (V16-RELEASE).

Root-Entscheide 07.10. 23:13 UTC: **D1** verhaltensgleicher Modul-Split, keine
Größenausnahme. **D2** keine interne Agenten-ID im öffentlichen Code oder in Tests;
`DECISION_DESK_ROOT_AGENT_ID` per ENV/Startparameter, fail-closed; Umsetzung in DR-06.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-03 | DeskStore-Kern im integrierten Ledger-Modell; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | Seniorentwickler-Profil, ein nativer Ausführungsowner `qfytpd`; Chief disponiert | DR-02 gemergt; eigene Goal-/Laufzeitbelege, frische Guards | eigener Worktree; schwere Gates Server | A | Erledigt: #661 gemergt; F01 und reale DR-04-Komposition offen | Offen bleiben F01-Grenzen und die Abnahme der realen DR-04-Komposition. | ee12d457, 8fa3ef8e, 55ea21ce |
| DR-08 | UI-Hülle und Stil nach Stand B1; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | UX-Architekt | FIT vorbereitet, Root-FIT-Abnahme; DR-01 | egal | B | Erledigt: #640 gemergt; benutzbare Gesamtlösung offen | Offen bleibt die Abnahme einer benutzbaren gesamten Oberfläche. | 55ea21ce, 6713479b |
| DR-09-WIN | Windows-Fixture: Ressourcen sicher schließen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | bestehender DR-01a-Owner; Chief disponiert, Root nimmt ab | Queue-656-Befund; frische Guards, Windows-Ort und freier Build-Slot | PC / vorhandener Windows-Ort | A | Erledigt: #660 gemergt | Historischer Lockhalter ungeklärt; Windows-Nachweis und Diagnose bleiben getrennt. | 1d708b0f, a6677e75, 8fa3ef8e, 55ea21ce |
| ARCH-D7-WIN | [Archiv][pakete] | bestehender DR-15a-Owner; Chief disponiert, Root nimmt ab | CI 37746602240 / Windowsjob 113209450490; Store-Lane frei, schwere Läufe nach DR-09-WIN | vorhandener Windows-Ort | A | Entfallen: aufgegangen in V16-KI30 #737 / Z4-ARCH-11 | siehe Archiv | c4d05a97, 782d9e58 |
| DR-10-WIRE | UI-Verdrahtung von ideas.js und app.js in DR-11/#718 enthalten | DR-11-Owner; kein separater Start | DR-11/#718 | eigener Worktree | B | Entfallen (Root 09.10.): Verdrahtung bleibt in #718 (DR-11) | rote Verdrahtungsregression, beide Skripte HTTP 200; inspiziertes Laufzeitbild, eigene prepush/Fremdreview/Root-Abnahme; ≤ 300 ALL | 4e0b5b37 |

**Historisches Register Z1 / 1 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z1-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-01 | Lieferbeleg | – | – | – | – | Erledigt: #635 | Originale oben; kein Dispatch | 55ea21ce |
| DR-01a | Lieferbeleg | – | DR-01 | – | – | Erledigt: #637 | Originale oben; kein Dispatch | 55ea21ce |
| DR-02 | Lieferbeleg | – | DR-01, DR-01a | – | – | Erledigt: #636 | Originale oben; kein Dispatch | 55ea21ce, b0e90b72 |
| DR-04c | Lieferbeleg | – | DR-04b-Stack `dc34cae` | – | – | Erledigt: #671, #674 | Originale oben; kein Dispatch | 1671ee11 |
| DR-06 | Lieferbeleg | – | DR-04c; getrennte Lieferung DR-06a → DR-06b | – | – | Erledigt: #676, #681 | Originale oben; kein Dispatch | 672767c8, 55ea21ce |
| DR-06a | Lieferbeleg | – | DR-04c | – | – | Erledigt: #676 | Originale oben; kein Dispatch | c044dc2b |
| DR-06b | Lieferbeleg | – | DR-06a | – | – | Erledigt: #681 | Originale oben; kein Dispatch | e4ad8296 |
| DR-07 | Lieferbeleg | – | DR-06b/#681 gemergt `85ab286` | – | – | Erledigt: #731, #732 | Originale oben; kein Dispatch | 55ea21ce |
| DR-09 | Lieferbeleg | – | DR-01 | – | – | Erledigt: #638 | Originale oben; kein Dispatch | 55ea21ce |
| DR-10 | Lieferbeleg | – | DR-09/#638 gemergt; Verdrahtung in DR-11/#718 | – | – | Erledigt: #665 | Originale oben; kein Dispatch | 08342807, 5945accc |
| HOTFIX-RF-PW | Lieferbeleg | – | –; Voraussetzung für DR-11 | – | – | Erledigt: #741 | Originale oben; kein Dispatch | – |
| DR-11 | Lieferbeleg | – | DR-10/#665 und HOTFIX-RF-PW/#741 | – | – | Erledigt: #718 | Originale oben; kein Dispatch | 55ea21ce |
| DR-12 | Lieferbeleg | – | DR-11 (Kategorie- und R1-Tests benötigen dessen Harness) | – | – | Erledigt: #740 | Originale oben; kein Dispatch | 98fa8267 |
| DR-13 | Lieferbeleg | – | DR-12 | – | – | Erledigt: #759 | Originale oben; kein Dispatch | 98fa8267 |
| DR-14 | Lieferbeleg | – | DR-13 | – | – | Erledigt: #774 | Originale oben; kein Dispatch | 98fa8267 |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-15 | Sicherer Start ohne manuelle Secret-Eingabe; 15a Basismodul und CLI-Korrektur getrennt, 15b Einbindung nach DR-06 (Secrets über den Secret-Manager von AgentsRoom) | Implementierer · Codex | DR-15a-BASE, DR-15a-CLI (15b: DR-06) | Server | A | In Prüfung: Code von 15a-BASE (`cd3bffac`), 15a-CLI (`7ac5985e`) und 15b (`86eeb68d`, 09.10.) gemergt; Start-/Nutzerabnahme („Start ohne Eingabe“) Unbekannt (zu prüfen); ersetzt: In Prüfung: G1-Teilung tatsächlich geliefert, #647 und #639 gemergt; begrenzte 15a-Source gemeinsam integriert, 15b und gesamte Start-/Nutzerabnahme offen | Basismodul und korrigierter CLI-Aufruf zusammen integriert; Start ohne Eingabe; kein Secret in Datei/Log/Commit; physische STATE-Pfadprüfung bleibt 15b | 55ea21ce |
| DR-SEC-01g-G2 | Core-Enforcement hinter Ownership; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | Root bindet einen Owner im Ticket | DR-SEC-01g-G1 | Server | A | Erledigt: #866 gemergt | Die Notification-Lücke bleibt ausdrücklich offen; G3 allein schließt diese Abnahme nicht. | b0221f4a |

**Historisches Register Z1 / 2 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z1-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-15a-BASE | Lieferbeleg | – | DR-01; gemeinsame Abnahme mit DR-15a-CLI | – | – | Erledigt: #647, #750 | Originale oben; kein Dispatch | 868dbc83 |
| DR-15a-CLI | Lieferbeleg | – | DR-15a-BASE | – | – | Erledigt: #639, #750 | Originale oben; kein Dispatch | f1a2ade9 |
| DR-SEC-01a | Lieferbeleg | – | Dateischnitt und Startvertrag aus Ticket b0221f4a vor Umsetzung | – | – | Erledigt | Originale oben; kein Dispatch | b0221f4a |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-SEC-01g-G4 | Server-Lifecycle / Admission | Root bindet einen Owner im Ticket | DR-SEC-01g-G3 | Server | A | Entfallen: aufgeteilt in bestehende G4a Signal-Stop / G4b Admission+Drain; ersetzt: Geplant (Design-Bericht) | zweiter Listener mutiert/sendet nicht; Drain vor Release; Interface für DR-16a | b0221f4a |
| DR-SEC-01g-G5 | DR-16-Adapter (G4-Lifecycle nutzen) | DR-16a-Owner | DR-SEC-01g-G4 | Server | A | Entfallen: in DR-16a gefaltet | Root-Disposition 09.10.: kein eigener Schnitt; Abnahme über DR-16a | b0221f4a |
| DR-SEC-01g-G6 | Recovery- und Portability-Abnahme; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | Root bindet einen Owner im Ticket | DR-SEC-01g-G4 | Server | A | Erledigt: #885 gemergt; Folge G6-FU separat auf claude/g6-fu-tests | G6-FU sowie reale Recovery- und Windows-Abnahme bleiben offen. | b0221f4a |
| DR-16a-H | Switch-Helfer-Härtung; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | Root bindet Owner | DR-16a/#863 | Server | A | Erledigt: #871 gemergt | Review-Runde 2 bleibt trotz gemergter Lieferung ausstehend. | – |
| DR-16b | Live-Drill auf dem PC: Schreibpause, Sicherung, Umschalten, metadatensicherer Rückweg | Stabschef Ausführung, ein Owner | DR-16a gemergt sowie alle dessen Vorgänger; G6; Root-Livefreigabe für exakten SHA und Zeitfenster | PC | A plus unabhängiges Nachlesen | Verschoben: Auslöser v1.6.0 seit 09.10. erreicht, Nutzer-Zeitfenster am PC offen, Nutzer 16.10. (K8, B; Root-Chat): warten, bis die Ablösung des Denkraums geplant wird; ursprünglich: Nach v1.6.0 verschoben (Nutzer 09.10. ~19:42Z: Schritte, die der Nutzer am PC braucht, nach dem Release); Runbook bleibt (pa-orch/wissen/06-anleitungen/2026-10-09_dr16b-pc-drill-runbook.md); ersetzt: Live-Freigabe Nutzer 09.10. ~17:25Z, Probelauf wartet auf G4b/G6 und Nutzer-Zeitfenster; ersetzt: Blockiert bis G0; Kandidat auf v1.6.0 (d2582ceb) neu exportiert; Fenster mit dem Nutzer offen | Gates G0–G7 im gebundenen Vertragsentwurf Ticket b0e90b72; G5 beide UI-Skripte HTTP 200; protokollierter Drill und unabhängige Prüfung; P1/aktuelles Ledger nach Writes erhalten, Root-Abnahme | b0e90b72 |
| DR-17 | Denkraum-Anleitung, README und Changelog; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z1-originals) | Technischer Autor | DR-17a-Entwurf laut Root 09.10. vorgezogen; Trockenlauf nach DR-16a-Merge und Root-Annahme des DR-16b-Protokolls | Server | C | Erledigt: Anleitung #785 gemergt, Trockenlauf der fünf Schritte auf frischer Wegwerf-Instanz im PR; Changelog final in V16-CHANGELOG | Gesamtabnahme und Root-Annahme des DR-16b-Protokolls bleiben offen. | 55ea21ce |

**Historisches Register Z1 / 3 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z1-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR-SEC-01g-G1 | Lieferbeleg | – | DR-SEC-01a Bericht; Design dr-sec-01g-design-49fd851ecbb6 | – | – | Erledigt: #811 | Originale oben; kein Dispatch | b0221f4a |
| DR-SEC-01g-G3 | Lieferbeleg | – | DR-SEC-01g-G2 | – | – | Erledigt: #873 | Originale oben; kein Dispatch | b0221f4a |
| DR-SEC-01h | Lieferbeleg | – | DR-11/#718 | – | – | Erledigt: #859, #718 | Originale oben; kein Dispatch | b0221f4a |
| DR-16a | Lieferbeleg | – | DR-SEC-01a/b gemergt; DR-SEC-01g-G4, DR-SEC-01h gemergt; DR-07 einschließlich 07c/d/e1/e2 (#752/#753/#751/#755), DR-14, DR-15 einschließlich 15b/#750 und UI-Verdrahtung #718 gemergt | – | – | Erledigt: #863 | Originale oben; kein Dispatch | b0e90b72 |



Root-Entscheide DR-16 D1–D3, 09.10. 01:16 CEST (Ticket b0e90b72):
D1 teilt Helfer und Live-Drill; D2 umfasst alle vier ergänzenden DR-07-Ports;
D3 belässt die UI-Verdrahtung (index.html lädt /app.js) bei DR-11/#718,
ein Eigentümer. DR-10-WIRE entfällt laut Root 09.10.; kein eigener Start.
G0 bindet Root-Livefreigabe an SHA/Zeitfenster; G1 erfasst alle Writer und pausiert
Ingress; G2 wartet auf nachgewiesenes Prozessende; G3 sichert erst das stabile
Ledger samt Metadaten; G4 prüft separate Staging-Dateien gegen den Manifest-SHA;
G5 schaltet bei gestoppten Writern und prüft beide UI-Skripte auf HTTP 200 nach
G6 (autorisierter Start, genau ein Writer/Listener); G7 prüft den begrenzten
Abnahmevertrag und Rückweg unabhängig. Vollständiger Vertrag im Ticket;
keine Produktionsmutation ohne separate begrenzte Freigabe. Nach neuen Writes
bleiben P1 und aktuelles Ledger erhalten; Fehlerfall ist vollständige Pause.

[Datierte Z1-Übergaben](archive/plan-2026-10/context-2026-10-23.md#z1-handover-on-8-october). DR-03 behält F01 und die reale DR-04-Komposition als offene Abnahme; DR-09-WIN trägt seinen Windows-Nachweis. Alte Endstatusdiagnose `5de5c4c9` bleibt separat offen. DEV-KNOW-01 bleibt verschoben, kein erneuter Pilotstart. D1 verlangt weiter den verhaltensgleichen Split ohne Größenausnahme; vor einem Start neu messen.

## Z2 — Setup und Entwicklung

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| PLAN-v2.0-3 | Verlustfreier Master-Zwischenschnitt | srv-plan-v2-3; Chief koordiniert, Root nimmt ab | PLAN-v2.0-2/#1863, DS-U0/#1861 und #1862 gemergt | Server | C | Erledigt: #1867 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch | srv-plan-v2-3 |
| PLAN-v2.0-4a | Abgeschlossene Z-Lieferungen kompakt mit erhaltenen Originalen | srv-plan-v2-4a; Stabschef koordiniert, Root nimmt ab | PLAN-v2.0-3 | Server | C | Erledigt: #1870 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch | 714f9fa1-8d5e-4fee-95b0-3d5e1969da40 |
| PLAN-v2.0-4b1 | Historische Abschnitte und gemischte geparkte Verträge | srv-plan-v2-4b1; Stabschef coordinates, Root accepts | PLAN-v2.0-4a | Server | C | Erledigt: #1873 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch | 21e92805-ee31-400b-8a5a-2eb58bd828e7 |
| PLAN-v2.0-4b2 | Unbeantwortete Inbox-Fragen, knappe Regeln und genaue Originale | srv-plan-v2-4b2; Stabschef coordinates, Root accepts | PLAN-v2.0-4b1 | Server | C | Erledigt: #1875 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch | b899138c-7148-4af9-8bdc-ea143d7c1134 |
| PLAN-v2.0-4c | Aktive Restpflichten kompakt mit erreichbaren Originalen | srv-plan-v2-4c; Stabschef koordiniert, Root nimmt ab | PLAN-v2.0-4b2 | Server | C | Erledigt: #1877 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch | ffbaa252-2c45-4705-b0e6-1b21e5316c46 |
| PLAN-v2.0-4d | Sechs Lieferzeilen auf den gemergten Stand berichtigen | srv-plan-v2-4d; Stabschef koordiniert, Root nimmt ab | PLAN-v2.0-4c | Server | C | Erledigt nach ausdrücklicher Root-Abnahme und Mergify-Merge dieses PRs | Begrenzte Statuskorrektur; Gesamtinhalt des Masters durch Root mit diesem Paket abgenommen (Ticket 5936); kein Dispatch | 358784ce-4a82-4bba-b06f-aa94b784fa7e |
| PLAN-STATUS-DOC5-Z4 | Zwei begrenzte Lieferstatus berichtigen | srv-plan-status-doc5-z4; Stabschef disponiert, Root nimmt ab | Z2-AGENTS-SLIM/#1832 S1 bereits gemergt | Server | C | Erledigt nach Root-Abnahme und Mergify-Merge dieses PRs | Nur Statuszellen DOC-5 und Z4-VERIFY; Restpflichten bleiben, kein Folge-Dispatch; AGENTS-Gesamtziel bleibt offen, Elternziel 5936 bleibt erledigt | 77a92de0-b16b-48be-943e-7b318ce3ffce |
| Z2-PLAN-COMMIT | Kanonischen Plan übernehmen und bereinigen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Stabschef | Root-Abnahme je Kandidat | egal | C | Erledigt: PLAN-C1 #643 gemergt, Statusnachtrag #646; #642 als überholt geschlossen (Nutzer 08.10.); weitere Schnitte durch PLAN-CLEAN-1 bis -3 ersetzt | Gesamtbereinigung mit PLAN-v2.0-3 bis -4d geliefert und durch Root abgenommen (Ticket 5936) | 55ea21ce |
| MAIN-PROTECT-01 | Main-Mergevertrag wirksam schützen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | vorhandener Git-/CI-Owner; Chief disponiert, Root nimmt ab | frische Schutz-/App-/Produkt-/Queuebelege; konkrete Root-Abnahme je Handlung; getrennt von GOALS-B | PC | A | Erledigt: Root-Finalabnahme 06:53:57 UTC; Rulesets A `24699347` und B `24700455` ACTIVE/exakt main, vier App-Checks ohne Checkbypass in A, nur App `10562` Update-Bypass in B; Chief-REST-Readback 10:20 bestätigt Konfiguration, Root-Beleg enthält tatsächliche geschützte Queue #635; keine erneute Produktivaktion | Vor jeder späteren Schutzänderung bleiben neue Akteur-, Queue- und Wirkungsbelege mit konkreter Root-Abnahme Pflicht; kein neuer Änderungsauftrag. | 52f46527 |
| GOALS-A | Aufträge, native Ziele und Owner abgleichen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Stabschef; Root nimmt ab | bestehende Übergaben und eigene Goal-Werkzeuge je Session | egal | C | Erledigt: begrenzter Ist-Abgleich und Native-Abschluss abgenommen; spätere Koordination eigenes aktives Ziel | Der aktuelle Goal-/Owner-/Laufzeitabgleich bleibt in DOC-CTRL1 offen; frühere begrenzte Abnahme ersetzt ihn nicht. | 52f46527 |
| GOALS-C | Drei vorhandene Praxisproben auswerten; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | ausführende Owner dokumentieren; Root bewertet | vorhandene Fix-, Review- und Runtimebelege | egal | C | Erledigt: genau drei Proben samt Messlücken abgenommen; selektive Nutzung, kein vierter Versuch | Es gelten genau drei Proben, Regressionen und gemessener Zusatzaufwand; kein vierter Versuch oder Wirksamkeitsbeweis. | 52f46527, 55ea21ce, b14492cb |
| DEV-KNOW-01 | P2: freigegebenen EIN-Thema-Wissenspilot begrenzt auswerten; Quellenindex gegen zwölf Karten, kein Ausbau ohne belegten Nutzen | einziger Messowner Implementierer · Codex `8qyt6d`; Chief übernimmt Bericht, Root nimmt ab | Vorbereitung #651 `1205081` angenommen; eingefrorene neun Quellen und fünf Fragen; Z1-Slots frei halten | private leichte Messroute | C | Verschoben: nach v1.6.0, Nutzer 08.10.; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): Rest Quellenindex nach „Später“ (v2.x), keine neue Messung; bisheriger begrenzter Messschnitt erledigt: 20+6-Originalübergabe samt Korrekturappend Root-ACCEPT 09:22:35 (`198949e8`); rationale-only-Nachtrag separat ACCEPT 10:10:29 (`1dbb4ebb`, operative REPORT `8f3f0796`, Input `20c2571d`, Assessment `71d3d6df`, Handover `b5c7a645`), Originale erhalten; eigene Mess-/Koordinationsgoals COMPLETE; kein konsistenter Nettoqualitätsgewinn, Quellenindex empfohlen; keine neue Messung/automatische Übernahme | getrennte Claude-/Codex-Vergleiche, gleiche Fragen/Revisionen und Parameter je Anbieter; Qualität/Kontext/Sucharbeit/Pflege mit Messlücken, sechs begrenzte Fälle; Nullbefund zulässig, keine automatische Übernahme | 57979887 |
| Z2-REGELN | Regelwerk 2.0: Lane-A-Korrekturen (6) abschließen, Anweisungsdateien entschlacken (Lane C, Commit 6918bea), Altlasten-Audit liefert „Deine Regeln: bestätigen oder ändern“ | Stabschef + Codebase Archäologe | – | egal | C | Geplant: Lane-C-Teil entfallen (Commit `6918bea` nur in #642, geschlossen 08.10., PR-ALT) → Z2-AGENTS-SLIM; Lane-A-Korrekturen: Unbekannt (zu prüfen), kein PR seit 08.10.; R1–R5 am 16.10. entschieden (Inbox), Root disponiert den Rest; ersetzt: In Arbeit | Lane-C-PR gemergt; `npm run dev:agent-check` Exit 0; Regel-Vorschläge R1–R5 in der Inbox entschieden | 77c993f3 |
| Z2-AGENTS-SLIM | AGENTS.md auf etwa ≤ 8 KB reduzieren: Kernregeln, Befehle und Merge-Kurzregel erhalten, Referenzdetails per eindeutigem Pfad auslagern | bestehender S1-Ausführungsowner `srv-agents-slim-s1`; Stabschef disponiert, Root nimmt ab; Chief pflegt PLAN | DR-12 gemergt/abgenommen; DOC-OPERATORS integriert; #642 geschlossen (Nutzer 08.10.); frischer Dateischnitt/Owner | Server | C | Erledigt nach Root-Abnahme und Mergify-Merge dieses PRs: S1 (#1832), S2 (#1885), S3 (#1887), S4 (#1889) und S5 (dieser PR); AGENTS.md 7719 Bytes <=8192; Byteziel ist kein Token-/Wirksamkeitsbeleg; kein Folge-Dispatch aus diesem Eintrag | AGENTS.md plus eindeutige docs/development/AGENTS_REFERENCE.md; bestehende Referenzen nur lesen; globale CLAUDE/MEMORY und Standard-Skills ausgenommen; Regel-für-Regel-Mapping, Linkcheck, dev:agent-check und eigene prepush Exit 0; ≤ 300 ALL, sonst vor Start serielle Schnitte; Byteziel ist kein Token-/Wirksamkeitsbeleg | 77c993f3 |
| Z2-RECHTE | Rechtekonzept V3 mit Herkunft und Disposition; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Konzeptowner lz0jwp; finale Konzeptabnahme Root | privates Bundle V3 `B368BB476E8E`; E1–E5 entschieden | bestehender Konzept-Arbeitsort | C | Erledigt: nur Konzept nach Fable-CONCUR durch Root abgenommen, E5 bestätigt; keine technische Aktivierung | Der E2-Schreibhost bleibt zu benennen; Konzeptabnahme erlaubt keine technische Aktivierung. | b2f36f8a |
| Z2-RECHTE-P1 | Ein privater Quellen-/Rechte-/Dispositionseintrag für den ausgewählten Werkzeugfall; Originaltexte und Ersetzungslinks erhalten | bestehender Konzeptowner lz0jwp; Ausführungskoordination beim neuen Stabschef | V3 + E5; konkreter privater Zielpfad und Ausgangsdigest vor Start festhalten | privater bestehender Wissensbereich | C | Geplant: geschnitten, noch nicht gestartet; Dokumentation, keine Settings-/Rechteaktivierung; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | ≤ 300 ALL; Quelle/Datum/Digest, ursprünglicher Scope, geltende Disposition, Projektion, Owner, fehlende Belege und nächster Schritt; Reset-, alte RH-C9- und Force-push-Ersetzungen getrennt; QA bleibt ausdrücklich beauftragt; kein privater Wortlaut in Git/PR | b2f36f8a |
| Z2-RECHTE-PILOT | Ein realer rust-analyzer/rust-src-Fall: manuelle Baseline gegen Shadow-Vorbereitung vergleichen | neuer Stabschef benennt bestehenden Werkzeugowner und genau einen tatsächlichen Schreibhost vor Zulassung; Root nimmt Shadow ab | P1; frischer Toolchain-/Client-/Komponenten-/PATH-/Home-Beleg, Quellenbindung und freie Eigentümerschaft | tatsächlicher Windows-Zielhost, noch ungebunden | C für Messbericht; technische Folgedeltas nach Dateien neu einstufen | Verschoben: nach v1.6.0, Nutzer 08.10.; Owner/Host fehlen weiter; keine technische Aktivierung; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“ (v2.x), Rechte werden in v2 als Code-Prüfung gebaut (ADR-V2-03) | ≤ 300 ALL je Schnitt; ein gepaarter Nicht-Z2-Fall, Zeit-/Aufrufbelege einschließlich Vorbereitung/Prüfung/Nacharbeit/Recovery; Netto-Nutzen > 0 und > gemessene Vergleichsunsicherheit, sonst nicht belegt; negative Shadow-Fälle keine Laufzeit-PASS; tatsächlicher Effekt erst separat nach Shadow-Abnahme, danach installiert/geladen/funktional getrennt belegen | b2f36f8a |
| Z2-AUTOSTART | Denkraum startet nach der Windows-Anmeldung von selbst, ohne Secret-Eingabe | Desktop-App-Entwickler | DR-15, DR-06 | PC | A | Geplant; seit 08.10. ohne PR oder Beleg; hängt an der offenen Start-/Nutzerabnahme von DR-15 | PC-Neustart → `127.0.0.1:4791` antwortet ohne Eingabe; kein Secret im Klartext | – |
| Z2-PACER | Pacer läuft: Trigger mit Werkzeugen, aber nur lesend; Bericht alle 20 min | Stabschef | Inbox R5 | PC | C | Verschoben: geparkt, Nutzer 16.10. (K10, B; Root-Chat); seit 08.10. ohne PR oder Beleg | drei Läufe nacheinander mit Bericht, keine Schreibaktion | – |
| Z2-REVIEW | Zwei feste Fremdanbieter-Wege für Stufe A: Gemini/Cursor auf dem Server (Workspace Trust), Ollama Kimi K3 + GLM, Codex; je Weg eine Probe mit beobachtetem Modell | Root disponiert Fremdvendor-Reviews; Git-/CI-Owner qualifiziert Wege | WT entschieden (F1, 08.10.); Modell-/Head-Belege weiter Pflicht | Server | C | In Arbeit: Root übernimmt Tier-A-Zweitanbieter über vorhandenen Ollama-GLM/Kimi-Weg laut Übergabe; kein Google-Folgelauf, Modell-/Head-Belege weiter Pflicht; Reviewerzahl und -familien jetzt durch `docs/decisions.md` „Reviewer count per tier“ (15.10.) geregelt, vorhandene Ollama-Route für glm-5.3, glm-5.3-flash und deepseek-v4.1-flash laut Nutzerfreigabe 20.10. zugelassen (AGENTS.md), kein Nachkauf; daraus folgt kein erfolgreicher Wegebeleg; Wegeprobe je Weg (Abnahme): Unbekannt (zu prüfen) | Probe je Weg mit Modellname und Zeit; Weg in `docs/setup/` beschrieben | c77f6955 |
| Z2-RAM | RAM-/Server-Standard: schwer = Server; PC nur leicht bei ≥ 1,5 GiB; idle Konsolen schließen; RAM-Wächter | Autonomer Optimierungsarchitekt | – | PC + Server | C | Geplant; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | 24 h ohne „local heavy STOP“, Messung im Ticket | – |
| Z2-ROUTE | Verteilung nach Verbrauchstempo über `usage_overview`; Quota-Regeln erneuern; Officer-Routine neu anmelden | Stabschef Ausführung beobachtet/routet; keine eigenmächtige Quota-Regeländerung | Nutzer: Re-Login | PC | C | Geplant: Routing-Regel steht in AGENTS.md „Routing“ (AP-6a, `2648f097`, 14.10.); Wochenbeleg und Abdeckung von Z2-ROUTE: Unbekannt (zu prüfen) | eine Woche ohne Anbieter am Limit; Routing-Beleg je Start | 492a9e36 |
| Z2-BOARD | Board aufräumen: erledigte/veraltete Tickets schließen (ef39c814, 2720b77f, 5945accc, 5de5c4c9, 7b66731d), Kurzstand-Block je Ticket, Ready-Queue ≥ 5 pflegen | Stabschef Ausführung: Ready-Reserve, Lane-/Blocker-Beobachtung; Chief nur PLAN | – | egal | – | Bereit; seit 08.10. ohne Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | `backlog_list`: keine erledigten Tickets mehr offen | – |

**Historisches Register Z2 / 4 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z2-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z2-RULE10 | Lieferbeleg | – | #643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); gemeinsam mit GOALS-B | – | – | Erledigt: #644, #643 | Originale oben; kein Dispatch | 52f46527 |
| HOOK-WIN | Lieferbeleg | – | vorhandene Runtime-/Rot-/Gate-/Vendor-Belege; finaler PR-Bericht vor Ready | – | – | Erledigt: #641 | Originale oben; kein Dispatch | b14492cb |
| GOALS-B | Lieferbeleg | – | #643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); Z2-RULE10 im selben Dokumentationspaket | – | – | Erledigt: #644 | Originale oben; kein Dispatch | 52f46527 |
| DOC-OPERATORS | Lieferbeleg | – | konkrete Disposition zu #642 erhalten | – | – | Erledigt: #683 | Originale oben; kein Dispatch | 77c993f3 |
| Z2-DOKSYNC | Lieferbeleg | – | – | – | – | Erledigt: #670 | Originale oben; kein Dispatch | 051bdfa0 |
| PLAN-V2-SUB-ACCEPTANCE-REFS | Lieferbeleg | – | #1858, #1863 und #1861 gemergt; eigener serieller PLAN-Schreibslot | – | – | Erledigt: #1540, #1544 | Originale oben; kein Dispatch | f4c26cab-d281-4b16-8cd3-1377fca8d696 |
| DS-T-02 | Lieferbeleg | – | DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | – | – | Erledigt: #1610 | Originale oben; kein Dispatch | – |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-T-01 | Hauptansicht: unbekannt und leer unterscheiden; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-X-01 (#1604); DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1623 (merged 2026-10-16); Haupt sagt „Agenten werden gelesen …“, „Nicht verbunden“ mit „Erneut lesen“ oder „Kein Projekt gewählt“ statt „Noch kein Agent“, behält die Karten bei fehlgeschlagenem Nachladen („Aktualisierung fehlgeschlagen“, ohne Alter des letzten Stands) und „Braucht dich“ zeigt die Leermeldung erst nach gelesener Liste | Das Alter der letzten gültigen Daten fehlt weiter; die übergeordnete Vertrauens- und UI-Abnahme bleibt offen. | – |
| DS-X-03 | Bewegungsmodus Ruhig, Lebendig und Aus; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-01; Entscheidung D2 (`docs/decisions.md`) | Server | B | Erledigt: #1606 gemergt, ersetzt DS-02; übrige Bewegungstoken folgen in DS-X-12/24 | Die Anwendung der Motion-Tokens in DS-X-12/24 bleibt separat offen. | – |
| DS-X-02 | Design-Skalen und Breakpoint-Konstante; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1601 gemergt; Tokens/Konstante geliefert, Ansichtsumstellung separat | Die Migration bestehender Ansichten bleibt separat und unbelegt. | – |
| DS-X-04 | Fabrik-Orb und sechs Zustandswort-Aliase; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Root | Entscheidung D4 vom 15.10. (`docs/decisions.md`) | Server | B | Erledigt: #1603; statischer Orb, Aliase und Kontrastprüfung geliefert; Einbindung/Bewegung bleiben DS-X-23/24 beziehungsweise DN-03 | Ansichtsintegration, Motion DS-X-23/24 und DN-03 bleiben offen. | – |
| DS-X-05 | Formular-Bausteine Field und Checkbox; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`); DS-Blueprint-Schnitt 16.10. (DS-X-05) | Server | B | Erledigt: #1678 gemergt; nur Register/Galerie-Navigation, keine Ansicht umgestellt; RadioGroup/SwitchField separat DS-X-06 | Die Komponenten sind noch in keine Ansicht migriert; bestehender Vertrag und Owner bleiben zuständig. | – |
| DS-X-06 | RadioGroup, SwitchField und Vorschau-Schalter; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-X-05 (#1678); DS-Blueprint-Schnitt 16.10. (DS-X-06) | Server | B | Erledigt: #1687 gemergt; WegWahl/KR-05a unberührt | WegWahl/KR-05a bleibt von der Lieferung ausgenommen und noch zu migrieren. | – |
| DS-X-14 | Komponenten-Register mit Abdeckungstest; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-14) | Server | B | Erledigt: #1656 gemergt; 25 Komponenten, hall-Scan noch ohne .tsx (DS-H-04 ergänzt seinen Eintrag); Galerie/Geschichten lesen später das Register (DS-X-15/16/17) | Vollständige Galerie-/Story-Abdeckung bleibt an DS-X-17 gebunden; keine Gesamtabnahme aus dem Register. | – |
| DS-X-15 | Designsystem-Galerie: Hülle und Grundlagen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-15) | Server | B | Erledigt: #1662 gemergt; Geschichten DS-X-16/17 separat, Werkzeugleiste und Übertrag aus #1656 nicht enthalten | DS-X-17-Storys, Toolbar und der Übertrag aus #1656 bleiben offen. | – |
| DS-X-16 | Galerie-Geschichten für controls und inputs; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Codex; Root nimmt ab | DS-X-15 (#1662); DS-Blueprint-Schnitt 16.10. (DS-X-16) | Server | B | Erledigt: #1712 gemergt; 13 Geschichten mit Abdeckungstest; weitere Familien DS-X-17, shot.mjs DS-H-07b | Weitere Familien DS-X-17 und die Aufnahmegrenze DS-H-07b bleiben separat gebunden. | – |
| DS-X-20 | IconButton, Ladezustand und Link-Reiter; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-20); DS-X-01, DS-X-02 | Server | B | Erledigt: #1706 gemergt; Leitstand-Reiter migriert, Shell/Verlauf/Steuerung noch altes Markup; Kopfzeile DS-X-10 und Symbole DS-X-21 separat | Die Migration von Shell, History und Control-Reiter bleibt offen. | – |
| DS-X-22 | Baukasten-Anleitung und Sprachregeln; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-22) | Server | C | Erledigt: #1699 gemergt; Anleitungen und Stylesheet-Kopfzeilen berichtigt; AGENTS-Verweis kommt von Root, kein Code-/CSS-Regelwechsel | Der AGENTS-Verweis bleibt Root-Nachlauf; Dokumentation ersetzt keine vollständige Ansichtsmigration. | – |
| DS-X-08 | Bestätigungsdialog und Sheet-Größen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-X-07 (#1683); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-08) | Server | B | Erledigt: #1700 gemergt; Reviews und Disposition im PR | Noch keine Ansicht angebunden; destruktive Integration erfordert Stufe A. | – |
| DS-X-09 | Tabelle mit Sortierung, Auswahl und Zustandsanzeige; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-X-05 (#1678); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-09) | Server | B | Erledigt: #1692 gemergt; keine Ansicht umgestellt, KR-07*/10e folgen | Noch keine Ansicht migriert; KR-07*/10e bleiben offen. | – |
| DS-X-21 | Einheitlicher Symbolsatz mit Lucide-Pfaden; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-21), Root-Entscheidung 17.10.: Pfade kopieren, kein Paket | Server | B + Lizenzprüfung | Erledigt: #1701 gemergt, Galerie zeigt Symbole; kein Aufrufer umgestellt, klassisches Icon bis KR-15 erhalten | Noch keine Aufrufer migriert; KR-15-Ersatz bleibt offen. | – |
| DS-X-33 | Diagramm-Bausteine mit Tabellenansicht; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Codex; Root nimmt ab | DS-X-32 (#1702, `4a9c8a5b`); DS-Blueprint-Schnitt 16.10. | Server | B | Erledigt: #1717 gemergt; drei Bausteine samt Tabellenansicht bereit | Unabhängiges Nicht-OpenAI-Review durch Root bleibt ausstehend; keine Ansichtsmigration ist nachgewiesen. | – |

**Historisches Register Z2 / 5 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z2-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-T-05 | Lieferbeleg | – | DS-T-01 (#1623); DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | – | – | Erledigt: #1629 | Originale oben; kein Dispatch | – |
| DS-T-04 | Lieferbeleg | – | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | – | – | Erledigt: #1609 | Originale oben; kein Dispatch | – |
| DS-X-11 | Lieferbeleg | – | DS-Blueprint-Schnitt 16.10. (DS-X-11) | – | – | Erledigt: #1673, #1680 | Originale oben; kein Dispatch | – |
| DS-U0 | Lieferbeleg | – | DS-X-22; unabhängige README-Korrektur freigegeben (Root 23.10.) | – | – | Erledigt: #1861 | Originale oben; kein Dispatch | 56e2f1e2-c6a8-48fa-86a3-a84000744a34 |
| DS-X-07 | Lieferbeleg | – | DS-X-03 (#1606); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-07) | – | – | Erledigt: #1683 | Originale oben; kein Dispatch | – |
| DS-X-32 | Lieferbeleg | – | DS-X-02; DS-Blueprint-Schnitt 16.10. (Zeile DS-X-32) | – | – | Erledigt: #1702 | Originale oben; kein Dispatch | – |
| DOC-1 | Lieferbeleg | – | – | – | – | Erledigt: #1760 | Originale oben; kein Dispatch | 148253cc |
| DOC-2 | Lieferbeleg | – | – | – | – | Erledigt: #1761 | Originale oben; kein Dispatch | 9f78f652 |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-T-03 | Kartenlampe zeigt den bewiesenen Zustand; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Implementierer · Claude; Root nimmt ab | Lampenform aus DS-T-02 (#1610) | Server | B | Erledigt: #1624 gemergt; Unbekannt-Lampe und Testalter geliefert, getestete Revision bleibt späteres Nahtpaket | Die Bindung des getesteten Zustands an eine Revision bleibt ein späteres Nahtpaket. | – |

Historische Routing-/Guthabenangaben stehen im [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context). Aktuelle Zulassung folgt AGENTS.md und dem konkreten Auftrag; kein Reset, Nachkauf oder Zen-Start aus diesem Plan.


### DOC und Hook-Pakete — Nachtrag 21.10.2026

[Datierter DOC-8-Teilstand](archive/plan-2026-10/context-2026-10-23.md#doc-snapshot-on-21-october). Root nimmt ab und integriert, Chief koordiniert; Planer bleibt gestoppt. Je Paket eigene Größen-, Gate-, Leser-/Link- und Reviewbelege; C2 sind Hook-Prüffälle, P9 der Folgeauftrag im ruhenden Terminal. Quellenbindung bleibt eigene externe A1-Abnahme.

Die frühere Pflicht „DOC-3 vor DOC-9-Bericht“ wurde verfehlt: #1783 war vor Roots Wahl von Option B gemergt. Das wird nicht rückwirkend erfüllt. Jetzt gilt: DOC-3-Lieferung samt Erhaltungs-/Leserbelegen und Root-Disposition → Endquellenabgleich/Berichtsaktualisierung → externe Nachprüfung. DOC-3 blockiert die externe Endabnahme, nicht den bereits gelieferten Bericht.
A1–A4 sind weiter getrennte offene Abnahmen. A3 ist nach tatsächlichem Merge dieses PLAN-Abgleichs und DOC-3B durch einen anderen GPT-6.1-Agenten am endgültigen main zu erneuern; der alte Nachweis an `213d29a3` gilt nur dort. Keine Bytezahl beweist Tokenersparnis, Laufzeit oder Nutzerabnahme.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-3 | v2-Rest vereinfachen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-doc3-b-history; Root nimmt ab | DOC-3a | Server | C | Erledigt: Option B #1791 gemergt | Externe DOC-3-Abnahme, A3 und Quellenabgleich bleiben offen. | f7e87a76 |

**Historisches Register Z2 / 6 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z2-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-3a | Lieferbeleg | – | – | – | – | Erledigt: #1762 | Originale oben; kein Dispatch | 3f7748a1 |
| DOC-4 | Lieferbeleg | – | – | – | – | Erledigt: #1759 | Originale oben; kein Dispatch | 90435bab |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-5 | Begrenztes Speicherpaket | Speicherowner; Root | – | egal | C | Erledigt: Speicherpaket (Nicht-Git) von Root am 20.10. abgenommen (D24) | gemeldet 31633 Bytes/178 Zeilen; Nutzerchat 20.10.: OpenAI 828400 Kontexttokens akzeptiert, andere Modelle weiter 1M; Laufzeit/automatische Kontext-/UI-/Tokenlimits separat durch Root zu belegen | 252b26ed |
| DOC-9 | Abschluss mit Lieferständen | Root berichtet; Chief belegt | DOC-1, DOC-2, DOC-3, DOC-3a, DOC-4, DOC-5, DOC-6, DOC-7, DOC-8, DOC-1b | egal | C | In Prüfung: Bericht #1783 `4681ddbc` geliefert und gemergt (`213d29a3`, 21.10. 17:27:24Z); externe Endabnahme offen | Root gleicht Gesamtquellen nach DOC-3-Lieferung #1791 und A1b #1793 mit verbleibenden Beleglücken ab; A1 Quellenbindung mit expliziten Grenzen, A2 DOC-3/PLAN, A3 nativer Leser am Endstand, A4 neustartfester Stopp noch extern abzunehmen; A3 erst nach Merge dieses PLAN-Abgleichs separat erneuern, Bericht aktualisieren und extern nachprüfen, keine zweite Roadmap | 566e3f2f |
| DOC-CTRL1 | Doku beaufsichtigen | Chief; Root nimmt ab | – | egal | C | In Arbeit: laut Auftrag; native Lage unbekannt | Aufträge/Überlappung/Restpflichten prüfen; danach belegte Übergabe an Root | b3d2f947 |
| PA-HOOKS-2a | Startdialog trotz Echo (C2-7/8) | srv-pa-hooks-2a | – | Server | A | Verschoben: #1756 `e0cacb41`, Root-Split 20.10.; Draft/keine Queue | Historie erhalten; ersetzt durch 2a-v2, nicht angenommen | e9f093c8 |
| PA-HOOKS-2b | Titel, Trust und Blockgrund erhalten; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-pa-hooks-2b-title-trust | PA-HOOKS-2a-v2 gemergt (#1766) | Server | A | Erledigt: #1804 gemergt | Echo-Zitat-Grenze und künftiger P9-Produzent bleiben getrennt; keine gesamte PTY-Abnahme. | 1539a734 |
| PA-HOOKS-2c | Blockade erhalten (C2-9) | srv-pa-hooks-2c | – | Server | A | Verschoben: #1757 `579b54f5`, Root-Split; Draft/keine Queue | Historie erhalten; ersetzt durch 2c-v2, nicht angenommen | 0bf0a005 |
| FU-2C-TYPED | Typisierte Startblockursache verdrahten; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-fu-2c-typed-startup | PA-HOOKS-2c-v2 | Server | A | Erledigt: #1803 gemergt | G2-Fixture-Nachlauf und echte P9-Abnahme bleiben offen. | 31771377 |
| PA-HOOKS-2d | Nur Folgeauftrag P9 | Root bindet Owner | PA-HOOKS-2b | Server | A | Blockiert: Fehlerzeit-Capture/Ursache fehlen; kein PR | Capture mit effektivem Marker, Rot→Grün/PTY, Busy-/Modal-Gegenfälle; danach Root prüft; entfällt falls 2b P9 belegt löst | unbekannt |

DOC-8 adressiert R1756-G2/A2 und R1757-A3/G2; Root belegt Integration vor `review-ok`.
Hook-Code/PR-Berichtskorrekturen bleiben bei ihren Ownern.

### Nutzbar-1 — Lieferstände und Nachläufer 22.10.2026

[Datierte Nutzbar-1-Übergaben](archive/plan-2026-10/context-2026-10-23.md#nutzbar-handovers-on-22-october); aktuelle Lieferstände und Nachläufer folgen in den Zeilen. EQ-1/P9 bleibt begrenzt, EQ-2 entfallen/ungemergt, Referenz-App gestoppt, externe DOC-Gesamtabnahme offen. DESIGN-R2 ist gemäß Entscheid 23.10. nach v2.x verschoben; kein Dispatch. Geparkte niedrige #1820-Reste nur bei ohnehin genehmigter Arbeit an red-first.sh; keine neue Gesamt-, PTY-/P9- oder Release-Abnahme.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| KR-03a-1-STATUS | Kernverbindung und Kontingent im bestehenden Tresorpanel getrennt vom Schlüsselzugang anzeigen | srv-kr03a1-status; Stabs pflegt, Root nimmt ab | 01a (#1547) gemergt; eigener serieller Metadatennachtrag nach P1/#1918 | Server | B: zwei fremde Modellfamilien; Metadaten C | Erledigt mit Merge von PR #1922: lesende Verbindungs-/Kontingentanzeige im bestehenden Tresorpanel | Keine neuen Zugangsdaten, API oder Abfrageschleife; Quellbelege an `448629da`; finale Metadaten-/Review-/Root-Abnahme getrennt, native V2-ACC1b/UAT und Glass-Gesamtabnahme offen; Elternziel KR-03a bleibt teilweise erfüllt/offen | 7364e03a-2d7a-4528-9ecb-551d3dbdf3d2 |
| KR-04b | Projektbezogene Chatentwürfe und echten Verlauf erhalten | srv-kr-04b-chat-state; Root nahm die gemergte Lieferung ab | #1569 gemergt | Server | B | Erledigt: #1894 am 25.10.2026 00:38:13Z gemergt (`ae9abb5f0b1388d317f7dfb81dd86e387bebf780`); Ticket DONE | Entwurf je Projekt nur im laufenden UI-Dokument; echter Verlauf neu gelesen. Browser-/Tauri-Mock-Belege, kein Neustart-/Datenträger-/nativer Nachweis, keine installierte/wirksame Lieferung oder Glass-Gesamt-/UAT-Abnahme. #1894-Nachläufer bleiben; kein neuer Folgeauftrag | 54a480e5-5c04-4387-b15b-ae60d7e62e6c |
| KR-07a-0a-MAIN-HEADROOM | Sieben bestehende Projektkonfigurationsbefehle unverändert aus main.rs verschieben und Platz für den Bridge-Schnitt schaffen | srv-kr07a0a-main-headroom; Root nimmt ab und integriert | Quellkopf `f9cb0e5a631f8ec817fdf39ee4e7b4016e0b4105`, PR #1934; beide Fremdreviews von Root bestätigt | Server | A: Quellreviews angenommen; Zeilennachtrag C | Erledigt mit Merge von PR #1934 (ceb309fa, 26.10.2026 12:54:42Z; Root-Abnahme 12:34Z) | Sieben Wrapper rein verschoben; main.rs 3976 Zeilen, netto 83 frei. Nur eigene Lieferzeile; Elternziel KR-07a, voller 1b-Schnitt, native Laufzeit, installiert/wirksam und UAT offen; Bridge: siehe KR-07a-0-BRIDGE (PR #1939) | 1341ad4b-2c13-441a-b6dc-7637c854f946 |
| KR-07a-0-BRIDGE | Nur lesender Adapter für Projekt-Entwicklungsdatensätze mit synthetischem Browser-Mock | srv-kr07a0-bridge; Root nimmt ab und integriert | KR-07a-0a-MAIN-HEADROOM (#1934 gemergt); PR #1939, Quellkopf `f2892ce0` | Server | A: zwei Quellreviews durch Root disponiert; Nachbesserung C+ | Erledigt nach Merge von PR #1939 (89838eec, 26.10.2026 15:47:21Z); Root-Abnahme offen | Öffentliche Reader-Core-Tests und synthetischer Tauri-Mock, kein echter Tauri-invoke-Beleg. K1 offen: Allowlist-DTO-Projektion ohne Pfade, policy_json oder Evidence-Payload-Durchleitung vor dem ersten Produktionskonsumenten und vor jeder Darstellung. Keine Ausführung, Freigabe oder Vertrauensaufwertung; native Laufzeit, installiert/wirksam, UAT, voller 07a-1b-Schnitt und Elternziel KR-07a offen | 6546cd4e-d037-4b3c-8fd3-2ebfb6dc0802 |
| KR-07a-1a-BEWEISE-SICHTBAR | Projektgebundene Beweise-Ansicht in der Standardnavigation mit stabiler Worker-Auswahl | srv-kr07a1a-beweise-sichtbar; Root nimmt ab und integriert | PR #1936; freigegebener Teilschnitt aus KR-07a; serielles PLAN-Fenster nach KR-09f-1 | Server | B | Erledigt nach Merge von PR #1936 (5bfd50de, 26.10.2026 14:49:38Z); Root-Abnahme offen | Nur öffentliche ShellMount-/Tauri-Mock-Belege: Worker und PR-Link gelesen, Gates/Reviews ausdrücklich ohne Messwert; stabile Feld-ID. Elternziel KR-07a bleibt offen; Bridge und voller KR-07a-1b-Schnitt ausstehend; native Laufzeit, installiert/wirksam, UAT und Glass-Gesamtabnahme offen | 81ad8227-d47a-4507-abae-fe6fd5ce3c0c |
| KR-07b-1-DIFF-FILES | Benannte Glass-Dateiauswahl im bestehenden DiffView | srv-kr07b1-diff-files; Root prüft und integriert | #1569 erfüllt; #1936/07a-1a gemergt (5bfd50de); PR #1947; eigener begrenzter Schnitt | Server | B | Erledigt nach Merge von PR #1947: nur Dateilisten-Teillieferung im bestehenden Konsumenten; Elternziel KR-07b bleibt offen | Umbenennung, Zählwerte, Prüfstufe und Kommentarmarker erhalten; öffentlicher Tauri-Mock-Test. Root-Abnahme ausstehend; full07b, neue Route, 07c–i, voller 07a/1b-Schnitt, native Laufzeit, installiert/wirksam, Glass und UAT offen; A3 (Accessible Name ohne Zählwerte) Follow-up | c54ea5ec-35f6-401a-b755-05d361b91a48 |
| KR-08b | Gemeinsame Sitzungswiederherstellung mit Glass-Neustartbedienung | srv-kr-08b-restore-glass; Root nimmt ab | #1547 gemergt (KR-01a) | Server | A | Erledigt nach Merge: gemeinsames Panel nutzt Glass-Button mit beständigem Namen und verknüpfter Worktree-Warnung | Scrollback/Entwurf, expliziter Neustart und Wechselisolation an Browser-/Tauri-Mock-Grenzen belegt; Classic bleibt erhalten. Root-Abnahme, native V2-ACC1b/UAT und Glass-Gesamtabnahme offen; installiert/wirksam nicht belegt | 7409db94-2cf9-4457-9c9e-41f2764a1b03 |
| KR-08c-1 | Sichtbaren Live-Terminaltab in Glass schließen | srv-kr-08c-1-close; Root nimmt ab | #1556 und KR-08b/#1904 gemergt | Server | A | Erledigt nach Merge: nur Close-Teilschnitt von KR-08c; Elternziel bleibt offen | Worker-Tab löst nur Ansicht, Ad-hoc-Tab nutzt bestehenden PTY-Close; Fokus und verspätete Routenergebnisse an Browser-/Tauri-Mock-Grenzen geprüft. Ad-hoc-Start (KR-08c), Split (KR-08d), native V2-ACC1b/UAT und Glass-Gesamtabnahme offen; installiert/wirksam nicht belegt | 05fc87d2-ba35-4c75-b8df-391589f54216; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 |
| KR-08c-2a | Expliziter Ad-hoc-Start aus dem leeren Glass-Terminal | srv-kr-08c-2a-launch; Chief disponiert, Root nimmt ab | KR-08c-1/#1906 gemergt | Server | A | Erledigt nach Merge: nur Start aus der generischen leeren Ansicht mit aktiviertem Profil | Bestehender SessionProvider, expliziter Start und Fehler-/Spätantwortschutz an Browser-/Tauri-Mock-Grenzen; Start neben Live-/Restore-Ansichten, Split, native V2-ACC1b/UAT und Elternabnahme bleiben offen | 5a2a38f9-d7b9-4964-8c24-93159fbb134e; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| FU-KR08C-LAUNCH-ERROR | Wahrheitsgemäße Startfehler nach Auswahlwechsel und Rückkehr zur leeren Glass-Ansicht | srv-fu-kr08c-launch-error; Stabs disponiert, Root prüft und nimmt ab | KR-08c-2a/#1908 gemergt `0583073a`; Vorgänger 5a2a38f9 | Server | A | Erledigt nach Merge: begrenzte Fehlerzustellung und bewusste Quittierung aus R1908-C2/K1/D2; laufende Startsperre bleibt getrennt | A1–A8: öffentliche App-/Tauri-Mock-Regressionen und inspizierte Browserbelege; unabhängige Reviews/Root-Abnahme ausstehend. D1, C3/D3/D4, weitere Kontexte/Split, native V2-ACC1b, installiert/wirksam, Glass/UAT und Elternabnahme offen | 725df5d4-5cd3-4adb-8217-33fb320eee60; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| FU-KR08C-LAUNCH-TESTS | Öffentliche Launch-Regressionen: überholte Profilantworten, Fehlerquittierung und Testisolation | srv-fu-kr08c-launch-tests; Stabs disponiert, Root nimmt ab | FU-KR08C-LAUNCH-ERROR/#1911 gemergt `64664930`; Vorgänger 725df5d4 | Server | C | Erledigt nach Merge: ausschließlich Testnachweise T1–T7 und diese Planzeile, kein Laufzeitwechsel | Öffentliche App-/Tauri-Mock-Belege und begrenzte Fehlerproben; Root-Inhaltsprüfung und Abnahme bleiben getrennt. Native, installiert/wirksam, Glass/UAT und Elternabnahme offen | b91adf60-7fa0-4e1f-bfc7-4535726caff9; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| KR-08c-2b-LIVE | Expliziter Profilstart neben einem laufenden Glass-Terminaltab | srv-kr-08c-2b-live; Stabs disponiert, Root prüft und nimmt ab | FU-KR08C-LAUNCH-TESTS/#1913 gemergt `f0603143`; Vorgänger b91adf60 | Server | A | Erledigt nach Merge: #1915 am 25.10.2026 17:09:55Z gemergt (`5c15cddeccf6e0ab8333f2c72326cc94223c263e`), Main-CI success; enthält Nachbesserung R1915-NB1 (LIVE-Menü als Overlay, laufender Neustart erhalten); Root nahm #1915 am Head `fbbcf1db` ab (25.10.2026 16:58Z, review-ok; Quelle: [PR-Kommentar](https://github.com/Cuarroc/ProjectA/pull/1915#issuecomment-6400493426)) | L1–L8: öffentliche App-/Tauri-Mock-Tests, begrenzte Browserbilder und Fokusbelege; unabhängige Reviews und Root-Abnahme getrennt. RESTORE, KR-08d/Split, D1, native/installiert/wirksam, Glass/UAT und Elternabnahme offen | 251d1fa7-961a-421a-b7ae-ffaacb425f6b; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| FU-KR08C-LIVE-PLACEMENT | Live-Profilwahl im Sichtbereich und außerhalb umgebrochener Tab-Steuerung halten | srv-fu-kr08c-live-placement; Root prüft und nimmt ab | KR-08c-2b-LIVE/#1915 gemergt `5c15cdde`; Vorgänger 251d1fa7 | Server | B | Erledigt nach Merge: #1917 am 26.10.2026 02:18:06Z gemergt (`be8b70356ac888bfafdad6a7250a9155cdd77063`), Main-CI success; terminal-lokale Overlay-Platzierung und öffentlicher Nachweis zum entschärften Launch-Snapshot ohne Einfügung | P1–P6: echte Chromium-Rechtecke/Bilder und Route-/Provider-Regression; am 26.10.2026 Reviews von Anthropic (Opus 5.5, Sonnet 5.5) und Moonshot (Kimi k3), Root nahm #1917 am Head `384eb4ed` ab (01:49Z, review-ok; Quelle: [PR-Kommentar](https://github.com/Cuarroc/ProjectA/pull/1917#issuecomment-6406438147)). RESTORE, Split, D1, beendete Tabs, native/installiert/wirksam, Glass/UAT und Elternabnahme offen | a476a3ad-787a-4b4f-a66f-9b71bf694c25; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| KR-08c-2b-RESTORE | Expliziter Profilstart neben der gespeicherten Glass-Restore-Ansicht | srv-kr08c-2b-restore; Stabs disponiert, Root prüft und nimmt ab | FU-KR08C-LIVE-PLACEMENT/#1917 und LIVE/#1915 gemergt; serielles Metadatenfenster nach #1926 | Server | A | In Prüfung: Draft #1924; mit dessen Merge ist nur der RESTORE-Teilschnitt geliefert | R1–R8: öffentliche Reducer-/Route-/Provider-Regressionen und begrenzte Browser-/Tauri-Mock-Belege für Startsperre, Anfragefehler, Restore-Auswahl und neueren expliziten Neustart; Root-Delta-Review/Abnahme ausstehend. Split/08d, D1, beendete Tabs, native V2-ACC1b, installiert/wirksam, Glass/UAT und Elternabnahme offen | 1e2a1504-a950-4671-8c91-864173352c11; Elternziel 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| KR-06b-1 | Gespeicherten Fragenverlauf und Herkunft anzeigen | srv-kr-06b-questions; Root nahm die gemergte Lieferung ab | #1569 gemergt; C1-Ersatz für #1893 | Server | B | Erledigt: #1896 am 25.10.2026 02:12:09Z gemergt (`19e8255342367ca3aa6926e8796816803c141335`); Ticket DONE | Abgerufener persistierter Verlauf/Herkunft; bestehende Frontend-Grenze 50, keine behauptete Backend-Grenze. #1893 geschlossen/ungemergt, alter C2-Branch erhalten; #1896-Nachläufer bleiben. Elternziel KR-06b nach #1900 durch Root im Zustand gemergt abgenommen (25.10. 06:16Z); nur Mock-Belege, native V2-ACC1b/UAT und Glass-Gesamtabnahme offen, installiert/wirksam nicht belegt | 50b01db1-881f-4919-9901-0a4faa8ac5cb |
| KR-06b-1b | Genau die gerade gespeicherte Antwort bestätigen | srv-kr-06b-1b-live-answer; Root nahm die gemergte Lieferung ab | KR-06b-1/#1896 gemergt | Server | B | Erledigt: #1898 am 25.10.2026 03:34:40Z gemergt (`6acaaf7802ec280a7d0ccf908969fb2577f5ac22`); Ticket DONE | Callback der konkreten gespeicherten Antwort mit Herkunft, keine Bestätigung aus dem Verlaufskopf. R1898-C1/C2/C3-K5/C4/K3/K4 bleiben nichtblockierende Nachläufer. Elternziel KR-06b nach #1900 durch Root im Zustand gemergt abgenommen (25.10. 06:16Z); nur Browser-/Tauri-Mock, keine assistive/native/Glass-Gesamt-/UAT-Abnahme oder installierte/wirksame Lieferung; native Nachweise bei V2-ACC1b/UAT | 2fc5073b-4e42-4f41-9c0f-9efe3b325493 |
| PLAN-KR-DELIVERY-CATCHUP | KR-Lieferbelege und Wellenstatus nachführen | srv-plan-kr-delivery-catchup; Stabschef koordiniert, Root nimmt ab | #1894/#1896/#1898 und Vorgänger #1900 (`a19bccb7`) gemergt; serielles PLAN-Schreibfenster | Server | C | Erledigt mit Root-Abnahme und Merge dieses Dokumentenschnitts | Vier neue Masterzeilen, ausschließlich freigegebener Elternsatz KR-06b-2 und zwei Wellenstatus 06b/04b; übriger Inhalt bytegleich. Nur Dokumentationsabschluss; keine neue Produkt-/native-/installierte-/wirksame-/Glass-Gesamt-/UAT-/Release-Abnahme | d87be838-da1c-43b9-a6ac-061c928566cb |
| KR-06b-2 | Projekt-/Flottenfragen in Glass zuordnen und Projektwechsel isolieren | srv-kr-06b-2-scope-r2; Root nimmt ab | Teilpakete #1896 und #1898 gemergt | Server | B; R1900-X1 C | Erledigt: #1900 liefert Fragenumfang, Zuordnung und Wechselisolation | Nur Browser-/Tauri-Mock-Belege; nativer Betrieb nicht belegt. Nachläufer R1900-D1/D2/C4/C5/C6/K4/K5 offen; Elternziel b5998181 im Zustand gemergt durch Root abgenommen (25.10. 06:16Z); native Nachweise bleiben bei V2-ACC1b/UAT | 6c247c5e-a94f-4f09-a3e7-ab1f50b3984f |
| GLASS-GI01-SETTINGS | Vier Einstellungs-Deep-Links mit Glass und Classic-Zugang abstimmen | bestehender Frontend-Owner srv-glass-gi01-settings; Root nimmt ab | begrenzter GI01-Auftrag; eigenes PLAN-Schreibfenster vor P4b1 | Server | B; dieser Zeilennachtrag C | Erledigt: #1869 gemergt | Teil von Elternziel 5936; Gesamtinhalt durch Root mit PLAN-v2.0-4d abgenommen; kein Dispatch; GI02/GI05 sowie Backend-/native/Glass-Gesamtabnahme bleiben offen | 8357b3ff-61b5-45d0-8d24-e6de737d4f9b |
| GLASS-GI05-HIDE | Ausgeblendete Glass-Deep-Links ehrlich anzeigen, konservativer Schnitt B | srv-glass-gi05-hide; Stabs disponiert, Root nimmt ab | Root-Entscheid GI05 (Option B); Basis `5c15cdde` | Server | B | Erledigt nach Merge: ausgeblendete Adresse bleibt erhalten und zeigt Bereichstitel, Hinweis und Einstellungs-Link; Schalter und Standard unverändert | G1–G8 im PR-Bericht: öffentliche App-/Tauri-Mock-Tests und inspizierte Browserbilder gegen Basis und Kopf. Beweise/Steuerung bleiben wie bisher ausgeblendet; 13 Platzhalter nicht umgesetzt; native, installiert/wirksam, Glass/UAT und Elternabnahme offen | 004c3d97-4739-4443-bef1-babe7f3ff518; Vorschlag-Eltern 128ff7bb; Produkt-Eltern 366c57e2-488c-48c1-9405-90b0cf28fab6 bleibt offen |
| DOC-KI24-H1 | KI-24, H1-Lieferung und B1-Schnitt nachführen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-doc-ki24-h1-merge (job75); Chief disponiert, Root nimmt ab | #1825 tatsächlich gemergt; Vorgängerticket 69c61ba2 bleibt Herkunft, keine laufende Sperre | Server | C | Erledigt mit Root-Abnahme/Merge dieses Dokumentenschnitts; KI-24 offen/beobachten, H1 erledigt, B1a/B1b getrennt | KI-24-Nachbeobachtung und B1a/B1b-Gesamtformat bleiben offen. | 2da280fe-e8de-4534-b17d-cbee14d40cf6 |
| FU-DG05-HEADER-HINT | Header-Hinweis und verwaisten Override korrigieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-fu-dg05-header-hint; Root integriert | DG-05, RED-FIRST-E2E-NAME | Server | B | Erledigt: #1810 gemergt | Breiten- und Testhärtungsbefunde bleiben Nachläufer. | de13bd7b |
| FU-1804-ECHO-QUOTE | EQ-1-Informationsgrenze festhalten; EQ-2 entfallen; falsche Trust-Überschrift zu P9 | Root: EQ-1/P9; EQ-2 entfallen, kein aktiver Owner | PA-HOOKS-2b (#1804) | Server | A (entfallenes EQ-2); C (Dokumentationsabgleich) | Entfallen: EQ-2; EQ-1 bewiesene Grenze → P9; EQ-2 entfallen (Meldung im Produkt unerreichbar, #1813 geschlossen 22.10.); falsche Überschrift bei zurückgehaltenem Trust (R1804-R2-4) gehört zu P9. | Root `msg-0mvizj71n-b8f8d1b7` (22.10. 03:32:15Z), Bericht `srv-fu-1804-echo-quote.md`: Zitat und mögliches aktives Menü haben identische vollständige öffentliche Observation-Verläufe (CR-/Lösch-/Cursoroperationen); synthetischer Informationsbeweis, keine reale CLI-Messung oder Implementierungskorrektur. Fail-closed bleibt richtig; vor künftiger Freigabe des vervollständigten Echos ist generationsgebundene Composer-/Modal-Evidenz nötig; kein neuer Screen-/Producer-/P9-Scope genehmigt. Finale Root-Disposition `msg-0mvj0m263-4b88f439` (22.10. 04:02:29Z) und öffentlicher Kommentar #1813 (04:02:27Z): DROPPED nach Fremdreviews und Roots Quellenprüfung an `d29c144a`; `StartupDialog(CodexTrust)` wird im Produkt nicht erzeugt, der Konstantentest belegt keinen nutzerseitigen Producer. Kandidat `c30f3123ca5e456b436f672d8ab0cd00bb9596c2` geschlossen/ungemergt (04:02:28Z, kein Merge-SHA); nicht angenommen oder installiert, tatsächlicher Branch `codex/fu-1804-echo-quote` bleibt erhalten. Keine weitere EQ-2-Arbeit/Abnahme offen; kein PTY-/P9-PASS oder vollständige Nutzbar-Abnahme | be30833a |
| FU-1806-PLAYWRIGHT-HYGIENE | Testkonfiguration, Ergebniszeile und Auswahlfälle absichern; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-fu-1806-playwright-hygiene; Root nahm ab | RED-FIRST-E2E-NAME (#1806) | Server | B | Erledigt: #1817 gemergt; R1806-G2/D1/G4 geliefert | R1806-D2-Erweiterungs-/Slash-Matrix bleibt zurückgestellt; kein Job. | 9f250383 |
| FU-1817-PLAYWRIGHT-EDGE | Trap-, Dauersuffix- und Fehlertitel-Grenzen absichern; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-fu-1817-playwright-edge (job71); Root nahm ab | FU-1806-PLAYWRIGHT-HYGIENE (#1817) gemergt | Server | B | Erledigt: #1820 gemergt | Benannte niedrige Befunde bleiben geparkt und nur bei unabhängig freigegebener Red-first-Arbeit erneut zu prüfen. | 57dd682d-b272-4489-82c2-4b08143d4c29 |

### V2-REST — Reihenfolge bis zur v2.0.0-Abnahme (Nachtrag 26.10.2026)

Quelle: Root-Aufträge vom 26.10.2026; enger Schnitt: [v2-Unterplan §10](plan/v2.0/plan.md#101-restpakete-v20-eng). Reihenfolge: Glass-Code (V2-REST-GLASS) → V2-ACC1b-NEW → V2-SHOT-BASE-PREP → V2-UAT-1a-NEW → V2-REL-PREP → Endkarte des Nutzers (Inbox V2-ENDKARTE). Parallel nur mit getrennten Dateien und PLAN-Zeilen; Nahtstellen und Routing seriell. Zeilen sind Reihenfolge, kein Dispatch: keine Laufzeit-, Installations-, Tag- oder Release-Freigabe, die Release-Sperre bleibt. Die alten IDs V2-ACC1b, V2-SHOT-BASE, V2-UAT-1a und V2-REL bleiben Kriterienreferenzen (#1540/#1544 geschlossen/ungemergt). Die Zeilen sind nicht als Erledigt zu lesen: Endkarten, native Laufzeit, Installation und Nutzer-UAT sind nicht erfolgt.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V2-REST-PLAN-PFLEGEN | Kurze kanonische Restreihenfolge mit Owner und Abhängigkeiten, GI05-Entscheid und Mergestatus von KR-08c-2b-LIVE nachführen | srv-v2-rest-plan-pflegen; Stabs delegiert, Root nimmt ab | KR-08c-2b-LIVE | Server | C | Erledigt mit Merge von PR #1918: ausschließlich Planpflege; Root-Abnahme und Produktabnahmen bleiben getrennt | Reine Dokumentation (No-Test). Vollständige KR-Inventur im PR-Report, nicht im Repo. Keine Produkt-, native, installiert/wirksam- oder UAT-Abnahme und keine neue Freigabe | f13918cc-fc43-409e-90c6-7ef235fa7132 |
| V2-REST-GLASS | Glass-Rest bis zur technischen Abnahme: jede offene Zeile aus [v2-Plan §10.2](plan/v2.0/plan.md#102-klassik-raus) als eigenes Paket ≤300, darunter RESTORE-Start (08c), Split (08d), D1-Entfernung (12a–12d), Startberechtigung neben beendeten Sitzungen („exited eligibility“, Umfang beim Zuschnitt zu klären) und GI05 (13 Platzhalter verbergen, umschaltbar) inline ohne eigenes Blatt | Root wählt je Paket; Chief dispatcht; ein Ausführungsowner je Paket | KR-08c-2b-LIVE; V2-REST-PLAN-PFLEGEN | Server | A (Terminal/Routing/Prozess), sonst B | Geplant: Elternzeile, kein Paket automatisch freigegeben; FU-KR08C-LIVE-PLACEMENT ist gemergt; Terminaldateien gehören dem jeweils gewählten Paketowner, seriell | Enge Kandidaten für Root in dieser Reihenfolge: (1) FU-KR08C-LIVE-PLACEMENT: erledigt, #1917 am 26.10.2026 02:18:06Z gemergt (`be8b70356ac888bfafdad6a7250a9155cdd77063`); (2) KR-08c RESTORE-Start als nächster Kandidat, mit frischer Basis ab diesem Merge; die Startberechtigung neben beendeten Sitzungen („exited eligibility“) bleibt ein getrennter ungeklärter Rest und ist keine Vorbedingung für RESTORE; (3) 08d Split; (4) Parken vom 24.10. 23:42Z durch Elias-Umfangsentscheidung 26.10. 06:07 Berlin (Root msg-0mvot2zkc-74a957ee, 05:18Z) aufgehoben für die Teilpakete 07a-0a (#1934), 07a-0-BRIDGE (#1939), 07a-1a (#1936); voller 07a-1b erst nach Bridge-DTO; 11c/11d erst nach 07a-1a und freiem App.tsx; Welle-2-Startpunkte 02a, 03a, 09a'/09b (warten auf DS-Bausteine, v2-Plan 10.3); (5) 12a–12d erst nach den Ports; (6) GI05-Verbergen mit Schalter läuft unabhängig von RESTORE und steht nicht am Ende der Terminalkette; das Umsetzungskind 004c3d97-4739-4443-bef1-babe7f3ff518 wurde am 26.10.2026 01:20:06Z gestartet (Claude Sonnet 5.5; mit PR #1919/Laufzeitkopf `dcc45032` und gezielten Test-/Browserbelegen geliefert; nach Root-Abnahme und zwei Fremdfamilien-Reviews sowie der e2e-Korrektur am Kopf `4a990a34` am 26.10.2026 04:42:36Z via Mergify gemergt (`9e3b8f044742d4c8de67962e3d4f18c386f02462`); native/Install/UAT bleiben offen), und die vorsichtige Wahl macht /beweise nicht zur sichtbaren Standardansicht. Ohne KR-PR oder KR-Commit auf main (Stand 26.10.2026 22:00Z): alle Zeilen außer 01a–c, 04a/b, 06b, 07b, 08a/b, 09m, den 08c-Teilen 1/2a/2b sowie dem 09j-Teilschnitt KR-09j-1-MAINTENANCE-LEAF/#1933; KR-09j und 09a' bleiben offen; ob einzelne davon (etwa 13a–d, 17) ohne eigene ID schon erfüllt sind, ist UNKNOWN. Nur Browser-/Tauri-Mock-Belege; native V2-ACC1b/UAT, installiert/wirksam und Glass-Gesamtabnahme offen | – |
| KR-09j-1-MAINTENANCE-LEAF | Wartungsbestätigung als benannter Glass-Dialog im bestehenden Panel | srv-kr09j1-maintenance-leaf; Root nimmt ab und integriert | Freigegebener früher Leaf aus KR-09j; bestehender Panel-/IPC-Vertrag bleibt | Server | A: Quellteil; eigener Zeilennachtrag C | Geliefert, Root-Abnahme/Mergify offen | #1933; geprüfter Quellstand `f7c63f1f`: öffentliche Tauri-Mock-Tests für benannten Dialog, Abbrechen/Escape, Fokus, ausstehende Anfrage und Fehler/Wiederholung. P1-Zeile und P2-Inventarnachtrag geliefert; Fremdprüfung durch Root offen. Eltern 09j/09a′, vollständige Einstellungen/Routing, native Laufzeit, installiert/wirksam, UAT und Glass-Gesamtabnahme bleiben offen | 3e719b37-c150-4f25-a9cb-34633a047446 |
| KR-09h-1-BUDGET-LEAF | Profilbudgets als benannte Glass-Gruppen mit stabilem Speichernamen | srv-kr09h1-budget-leaf; Root nimmt ab | Freigegebener enger Leaf aus KR-09h; bestehender Props-Vertrag bleibt | Server | B | Geliefert: #1930; Root-Abnahme/Mergify offen | Öffentliche Komponenten- und SettingsView-Tests: native Button-/Input-Struktur, Fokusfähigkeit, rohe Leer-/Nullwerte, genau ein Speichern und keine Wiederholung bei busy; echte Tab-/Enter-/Leertasten-Aktivierung nicht geprüft. Eltern 09h/09g/09a, native Laufzeit, UAT und Glass-Gesamtabnahme bleiben offen | #1930 |
| KR-09f-1-MASTERPROMPT-LEAF | Wiederverwendbares Masterprompt-Blatt mit vorhandenen Glass-Steuerelementen und benannter Vorschau | srv-kr09f1-masterprompt-leaf; Root nimmt ab | Freigegebener enger Leaf aus KR-09f; bestehender Props-Vertrag bleibt | Server | B; D1-Nachbesserung C+ | Geliefert, Root-Abnahme/Mergify offen: #1931; geprüfter Quellstand `358a6a60`, D1 und Planzeile folgen getrennt | Öffentliche Komponenten- und SettingsView-Tests: native aktivierte Textarea, Button und Switch, Fokusfähigkeit und bestehende Rückrufe; keine echte Tab-/Enter-/Leertasten-Aktivierung. Eltern 09f/09a′/09g, native Laufzeit, installiert/wirksam, UAT und Glass-Gesamtabnahme bleiben offen | fc27aab4-5b30-4c2d-a49e-c0d6175d4ff7 |
| KR-09g-1-CATEGORIES-LEAF | Wiederverwendbares Kategorien-Blatt mit Glass-Schaltern, eindeutigen zugänglichen Namen und Glass-Profilauswahl | srv-kr09g1-categories-leaf; Root nimmt ab und integriert | PR #1932; Quellstand `53effb02095f18e57ffbc06333ad49cf99cfb42d`; freigegebener enger Leaf aus KR-09g | Server | B: Quell- und C1-Reviews von Root bestätigt; Zeilennachtrag C | Geliefert, Root-Abnahme/Mergify offen | Bestehende öffentliche Komponenten-/SettingsView-Tests und von Root akzeptierter 720-px-Bildbeleg am Quellstand; kurze sichtbare Wörter, eindeutige Namen, Kategorie-/Queen-/Lernsemantik erhalten. P1-Zeilenreview offen; Eltern 09g/09a′, vollständige Einstellungen/Routing, native Laufzeit, installiert/wirksam, UAT und Glass-Gesamtabnahme bleiben offen | 69787162-b386-4702-8d7b-859e804150db |
| KR-09b-1-WEBPORT | Standard-Port der Web-Ansicht im bestehenden Glass-Allgemeinpanel bedienen | srv-kr09b1-webport; Root nimmt ab | Freigegebener enger Leaf aus KR-09b; bestehende Speicher-/Backend-Grenze bleibt | Server | B; eigener Zeilennachtrag C | Geliefert, Root-Abnahme/Mergify offen | #1928; Quellstand `7ba8fe8a`: vorhandenes loadWebPort/saveWebPort, benanntes Feld und Fehlerzuordnung; Speichern startet nichts, Portwahl erst beim ausdrücklichen Start an der Tauri-Mock-Grenze geprüft. P6-Zeile geliefert, Fremdreview des Nachtrags offen; Eltern 09b/09a, Digest/Stuck/Dichte/Schriften, vollständige Einstellungen/Routing, Classic-Entfernung, native Laufzeit, installiert/wirksam, UAT und Glass-Gesamtabnahme offen | 4704e6a1-2dbe-4426-8170-a3c1d363ee72 |
| KR-10e-1-RESOURCE-READ | Betrieb: vorhandene Leseanzeige für Prozess-CPU als Durchschnitt seit Start und freien Platz des App-Daten-Volumes | srv-kr10e1-resource-read; Root nimmt ab | KR-10e-Teilschnitt; Quellkandidat `ce7e00dc` in PR #1927 | Server | B (Code), C (R6-Planzeile) | Geliefert, Root-Abnahme/Mergify offen: PR #1927; geprüfter Quellstand `ce7e00dc`, spätere Dokumentationsrevision separat | Nur bestehender Snapshot; kein neuer Read, Poll oder Laufzeitbeleg. RAM-Prozess-/Gesamtwortlaut, Quoten/Kosten, AppData-Größentreue (`disk_app_partial`), native/Installations-/UAT-Abnahme sowie ganz KR-10e und Glass-Gesamtabnahme bleiben offen | e37ccd4d-0556-4f3f-b4c8-7c83947784c9 |
| V2-ACC1b-NEW | Technische Glass-Abnahme für Hülle + Leitstand (Neuzuschnitt des alten V2-ACC1b): Kriterium → Befehl → Exit-Code und ein Tab-Test je Route, D1 an | Agent nach Dispatch durch Chief; Root nimmt ab | V2-REST-GLASS (nach den Kern-Merges inklusive FU-KR08C-LIVE-PLACEMENT) | Server | B | Blockiert: wartet auf die Glass-Merges | Routenliste wählt Root aus Plan und Registry `src/shell/routes.ts` (Stand 5c15cdde: acht Pfade in Leitstand, Betrieb, Einstellungen, Start; ob `/leitstand/verlauf` und v2.1-Routen zählen, ist UNKNOWN und Root-Entscheid). Tabelle im PR; `npm run build` und prepush Exit 0; kein nativer/UAT-Beleg | – |
| V2-SHOT-BASE-PREP | Bildbasis vorbereiten: je Route der festgelegten Liste ein Bild hell und eines dunkel (1440×900) per `npm run dev:shot`, gegen die Boards in `docs/design/2026-10-ui-v2/glass` verglichen | Agent erzeugt und prüft; der Nutzer sieht an (Endkarte) | V2-ACC1b-NEW | Server | C | Blockiert: wartet auf die Routenliste | Bilder lokal, nicht im Repo; angesehen, Abweichungen im PR. Keine Pixel-Fabrik, keine Nutzerfreigabe | – |
| V2-UAT-1a-NEW | Klick-Checkliste für den Nutzer: höchstens 10 Punkte in einfachem Deutsch, „neu / bewiesen / nicht abgedeckt“, Glossar (Neuzuschnitt des alten V2-UAT-1a) | Agent schreibt das Dokument; Root nimmt ab | V2-ACC1b-NEW; V2-SHOT-BASE-PREP | Server | C | Blockiert: wartet auf Abnahme und Bilder | `npm run dev:agent-check` Exit 0; ≤10 Punkte. Nur Dokument: das Durchklicken (V2-UAT-1b) und der Update-Drill gehören dem Nutzer in der Endkarte | – |
| V2-REL-PREP | Release-Vorbereitung nur als Entwurf außerhalb des Repos: Changelog-Text und Dateiliste der Versionsänderung 2.0.0 | Agent (Entwurf); der Nutzer entscheidet | V2-UAT-1a-NEW | Server | C | Blockiert: wartet auf die Checkliste | Entwurf liegt außerhalb des Repos; kein Versions-PR, kein Tag. Der Versions-PR kommt erst nach frischem Ja in der Endkarte (AGENTS.md Regel 10, K5); Release-Sperre bleibt | – |

### DOC-1b — kanonischer Nachtrag 21.10.2026

DOC-1b ist geliefert; externe Gesamtakzeptanz und Quellenabgleich bleiben bei DOC-9.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| FU-1758-1 | Technisches Gate für Quellenbindung; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | srv-doc-a1b-fetch-binding (A1b); Root disponiert Rest | A1: ausdrückliche Root-Freigabe 21.10. 17:57Z statt DOC-9-Endabnahme | Server | B | Erledigt: A1b #1793 gemergt; #1789 nach Runde 2 geschlossen, ungemergt (Root SPLIT), Branch `codex/doc-a1-fetch-binding` bei `636c85e9` erhalten; übriger Scope bleibt verschoben | Externe A1-Abnahme und Grenzen der Rewrite-/Fetch-Quellenbindung bleiben offen. | FU1758-1 |

### CI und Durchlauf — Nachtrag 15.10.2026

Quelle: `opt-ci-merge-20261015.md` (pa-orch); Dispatch laut Root, Ereignisse 16:12 MESZ nachgeprüft. Root nimmt ab; kein Merge-Sicherheitsentscheid durch diesen Eintrag.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| OPT-PIPE-0 | Durchlauf ausschließlich lesend messen | srv-opt-pipeline; Root klärt Basis | korrekte Auftragsbasis | Server | C (Bericht) | Blockiert: geplant nach Basisklärung; Server-Auftrag srv-opt-pipeline endete 16:12 MESZ wegen HEAD-Abweichung | Messbericht mit Methode und Einheiten; keine Implementierung | OPT-PIPE-0 |
| CI-SEC-CODEQL-2 | CodeQL-Alarme 59 und 60 disponieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Root; `.github/` gehört laut CODEOWNERS dem Nutzer | Nutzerentscheid CODEQL-59-60 | – | B | Erledigt: Alarme 59/60 nach Owner-Entscheid K1 als Fehlalarme abgewiesen; bei Cache-/Event-Änderung neu prüfen | Änderungen an Cache oder Events verlangen weiterhin ein neues Review. | – |
| FU-1015 | Nachläufer aus den Reviews vom 15.10.: #1551 G3 (KR-09m), #1556 K4 und toter CSS-Rest (KR-08a), #1560 K2 (CI-SPLIT-LINUX), #1561 G2 (DS-01), #1568 Lows (FABRIK-TAB-1), #1569 B1/B3 (KR-04a), #1581 K1/K3–K5 (CI-SEC-CODEQL) | Root disponiert | jeweiliger Eltern-PR gemergt | – | je Punkt | In Arbeit: Teillieferung #1581 K1 durch #1835 gemergt (`5a07fc08`); K3 durch #1833 gemergt (`72ae3f75`); K4/K5 durch #1839 am 22.10.2026 um 21:22:50Z gemergt (`5ad970f2814ce251cf86077c4b4a686c1d7a9865`); R1839-G3 bleibt Nachläufer; #1551/#1556/#1560/#1561/#1568/#1569 bleiben offen | je Punkt eigenes Paket ≤ 300 Zeilen mit eigener Abnahme | – |
| OPS-CLOUD-PREFLIGHT | Vorabprüfung für den Codex-Cloud-Weg vor jedem Auftrag (laut Root 15.10.; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden: weder Auftrag noch Bericht noch Ereignislog des Server-Auftragsordners nennt die ID; Wortlaut und Zielort liefert Root, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |
| OPS-JOB-ENDZEILE | Endzeile jedes Auftrags nennt private Abrechnungs- und Token-Messwerte; keine Werte im öffentlichen Repo (laut Root 15.10.; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden; Wortlaut und Zielort liefert Root, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |
| OPS-AUTO-LOCK | Auto-Skript: doppelte Sperre (laut Root 15.10. „duplicate lock“; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden; Bedeutung bleibt Unbekannt, Root liefert Wortlaut und Zielort, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |

### Designziel Pixel-Fabrik (Nutzer 16.10.2026) — DS-FABRIK-ZIEL

Fabrik/DS-H/DS-WF sind seit dem Entscheid 23.10. v2.x, ohne Dispatch. Die [ursprünglichen Kunst-/Navigationsverträge](archive/plan-2026-10/final-2026-10-23.md#dated-context) bleiben als Kriterien erhalten; gemeinsames `--g-*`-System, Nutzerurteil über DS-H-07 und dessen Belegmatrix bleiben Voraussetzung.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-H-06 | Probe-Halle: Bewegungsmodi und Bewegungslimits; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z2-originals) | Root disponiert | DS-H-05; Bewegungsmodus aus DS-X-03 (#1606) | Server | B | Erledigt: #1690 (merged 2026-10-17); es bewegt sich in Ruhig und Lebendig nur die Arbeitsfigur (`run`), alle anderen Posen und Aus oder Betriebssystem-Bewegungsreduktion bleiben auf Bild 0, höchstens zwölf Figuren bewegen sich, ein verstecktes Dokument pausiert die Halle; die Gesten für `need`, `ok` und `bad` warten auf ein beobachtetes Wechselsignal | need/ok/bad-Gesten warten auf beobachtete Zustandsübergänge. | – |

**Historisches Register Z2 / 7 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z2-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-6 | Lieferbeleg | – | – | – | – | Erledigt: #1758 | Originale oben; kein Dispatch | e9df1aff |
| DOC-7 | Lieferbeleg | – | – | – | – | Erledigt: #1764 | Originale oben; kein Dispatch | 69c96921 |
| DOC-8 | Lieferbeleg | – | DOC-1 | – | – | Erledigt: #1763 | Originale oben; kein Dispatch | a40db352 |
| PA-HOOKS-2a-v2 | Lieferbeleg | – | – | – | – | Erledigt: #1766 | Originale oben; kein Dispatch | b91a51cd |
| PA-HOOKS-2c-v2 | Lieferbeleg | – | – | – | – | Erledigt: #1769 | Originale oben; kein Dispatch | 2f88e71e |
| FU-2A-SUFFIX | Lieferbeleg | – | PA-HOOKS-2a-v2 | – | – | Erledigt: #1785 | Originale oben; kein Dispatch | 70abe77b |
| FU-2C-CONCEAL | Lieferbeleg | – | PA-HOOKS-2c-v2 | – | – | Erledigt: #1786 | Originale oben; kein Dispatch | 81e33045 |
| RED-FIRST-E2E-NAME | Lieferbeleg | – | – | – | – | Erledigt: #1806 | Originale oben; kein Dispatch | #1806 |
| DOC-1b | Lieferbeleg | – | DOC-1 | – | – | Erledigt: #1778 | Originale oben; kein Dispatch | srv-doc-1b-plan-history |
| SIZE-BUDGET-GATE | Lieferbeleg | – | – | – | – | Erledigt: #1772 | Originale oben; kein Dispatch | 1af27d72 |
| DS-H-00 | Lieferbeleg | – | DS-T-01, DS-T-03, DS-T-05; die Zeilen DS-T-02 und DS-T-04 stehen in ihren PRs | – | – | Erledigt: #1633 | Originale oben; kein Dispatch | – |
| DS-H-01 | Lieferbeleg | – | DS-H-00 | – | – | Erledigt: #1637 | Originale oben; kein Dispatch | – |
| DS-H-02a | Lieferbeleg | – | DS-H-01 | – | – | Erledigt: #1642, #1637 | Originale oben; kein Dispatch | – |
| DS-H-02b | Lieferbeleg | – | DS-H-02a | – | – | Erledigt: #1648, #1642 | Originale oben; kein Dispatch | – |
| DS-H-03 | Lieferbeleg | – | DS-H-01 | – | – | Erledigt: #1646 | Originale oben; kein Dispatch | – |
| DS-H-04 | Lieferbeleg | – | DS-H-02b, DS-H-03; Zustandsaliase aus DS-X-04 (#1603) | – | – | Erledigt: #1663, #1696 | Originale oben; kein Dispatch | – |
| DS-H-05 | Lieferbeleg | – | DS-H-04; Listenzeile aus DS-X-11 (#1673) | – | – | Erledigt: #1680, #1663, #1696 | Originale oben; kein Dispatch | – |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-H-07 | Probe-Halle: Galerie-Seite und Messaufbau (`shot.mjs --dpr --motion`), danach Abnahme durch den Nutzer: zuerst Bilder und kurzes Video vom Server (3 Bewegungsmodi × hell/dunkel), dann nach seinem Ja in der App am PC mit Speichermessung | Root disponiert; Abnahme der Nutzer | DS-H-06; Galerie aus DS-X-14 und DS-X-15 (#1662) | Server | B | In Prüfung: Galerie DS-H-07a gemergt (2026-10-17), Messaufbau DS-H-07b gemergt (2026-10-18), beide PR-Nummern stehen in deren Zeilen; Belegsatz mit Bildern und Videos liegt beim Nutzer (18.10.), Urteil des Nutzers und PC-Speichermessung folgen, keine Gesamtabnahme | wie DS-H-01; Urteil des Nutzers | – |
| DS-WF-1 | Workflow-Ansicht, Bildvertrag (Doku): Objekte Verteiler, Sammelstelle, Weiche, Tor, Rückweg, „nicht nötig“, gruppiert, neu; Ehrlichkeitsregel „ohne Daten: noch nicht verbunden“; Bewegungs- und Tastaturregeln: `docs/design/hall/WORKFLOWS.md`; Entscheid DS-WF-0 (Band plus Fahrplan, keine Helferfiguren) | Root disponiert | DS-H-07 (Urteil des Nutzers über die Probe-Halle), DS-H-00 | Server | C | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | prepush Exit 0 | – |
| DS-WF-2 | Workflow-Ansicht, reine Projektion: Bänder aus `QueueEntry`, `BoardCard` und `spawnedBy`, Gruppe ab fünf Zweigen, Sammelstelle, Runde und Weiche bleiben `unknown`, solange kein Motor sie liefert: `src/design/hall/workflow/project.ts` | Root disponiert | DS-H-07; DS-WF-1; DS-T-03 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-3 | Workflow-Ansicht, Kunst: Bandkacheln (gerade, Ecke, Teilung, Zusammenführung, Rückweg) und Verteiler, Sammelstelle, Weiche im Spriteformat von DS-H-01 | Root disponiert | DS-H-07; DS-H-01; DS-H-02a | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-4 | Workflow-Ansicht statisch: Werkstücke als Knöpfe mit Name und Zustandswort, Umschalter Band/Fahrplan, Fahrplan als Tabelle mit denselben Ids und Zuständen (beide Ansichten gleichberechtigt) | Root disponiert | DS-H-07; DS-WF-2; DS-WF-3; DS-H-04; DS-H-05 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |

**Historisches Register Z2 / 8 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z2-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| NAV-0 | Lieferbeleg | – | – | – | – | Erledigt: #1630 | Originale oben; kein Dispatch | – |
| NAV-1a | Lieferbeleg | – | NAV-0; #1606 (`Shell.tsx`) und #1604 gemergt oder `main` eingemergt | – | – | Erledigt: #1636 | Originale oben; kein Dispatch | – |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-WF-5 | Workflow-Ansicht, Bewegung: Ruhig/Lebendig/Aus, Übergabe nur bei beobachtetem Wechsel, Pause bei verstecktem Fenster, höchstens zwölf bewegte Figuren: `workflow/motion.css`, `useBeltMotion.ts` | Root disponiert | DS-H-07; DS-WF-4; DS-H-06; #1606 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-6 | Workflow-Ansicht einhängen: im Reiter „Linie“ (später „Halle“) der Fabrik anstelle des Fluss-Inhalts; Screenshots hell und dunkel, Messprotokoll; ersetzt den Neuschnitt von DS-X-23 bis 25 | Root disponiert | DS-H-07; DS-WF-5; NAV-1a | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannter Test rot→grün; prepush; zwei Reviews; Urteil des Nutzers | – |

<a id="serverreserve-3--begrenzte-werkzeug-härtung-historisch-erledigt"></a> [Historischer Abschnitt](archive/plan-2026-10/contracts-2026-10-24.md#reserve-3); kein Dispatch.

## Z3 — Rest von v1.6.0

Historische Nahtmessungen: [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context); vor einer Nahtentscheidung neu messen. Offene Nachläufer und Abnahmen folgen unten.
| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-06 | Update-Start ohne Journal sicher stoppen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | MCP-Integrationsentwickler | E2/V16-F3 beantwortet 09.10.; mn nach D5-GUARD → V16-UPD-CANCEL; Update-Drill | PC | A | Erledigt: #832 und Folgepaket #845 | Die reale Update-Drill-Abnahme bleibt von gemergtem Code getrennt. | 2557db66 |
| V16-UPD-CANCEL | Update-Download abbrechen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | Desktop-App-Entwickler; Startzuweisung durch Ausführungs-Stabschef | V16-ARCH-D5b/#728 gemergt → D5-GUARD; mn danach neu zuweisen | PC-Drill; Gates Server möglich | A | Erledigt: #813, #828, #830 (Neuschnitt von #821), #833, #834 und #851 (Freeze-Test) gemergt | Reale Abbruch-/Fehler-/Erfolgsdrills und installiertes Verhalten bleiben separat nachzuweisen. | – |
| V16-ARCH-D8c | Ereignisnamen im Frontend vereinheitlichen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | Implementierer · Codex | V16-ARCH-D8b | egal | B | Erledigt: #960; vier Kommentar-Treffer, kein Code-Treffer; Root-Abnahme unbekannt (zu prüfen) | Root-Abnahme bleibt unbekannt und ist ausdrücklich zu prüfen. | – |
| V16-ADR-A7 | ADR A7 (st-Lane teilen) | Architekturberater Fable + Architekturberater Astra | V16-NACHBEOB (zwei Wochenmessungen) | egal | C | Verschoben | Eintrag in `docs/decisions.md` | – |

**Historisches Register Z3 / 9 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z3-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-ARCH-D2 | Lieferbeleg | – | vor V16-06 freigegeben (Inbox V16-D2) | – | – | Erledigt: #664 | Originale oben; kein Dispatch | 257e3a7b |
| V16-ARCH-D5a | Lieferbeleg | – | V16-ARCH-D2 | – | – | Erledigt: #704 | Originale oben; kein Dispatch | – |
| V16-ARCH-D5b | Lieferbeleg | – | V16-ARCH-D5a | – | – | Erledigt: #728 | Originale oben; kein Dispatch | – |
| D5-GUARD | Lieferbeleg | – | V16-ARCH-D5b/#728 gemergt; vor V16-UPD-CANCEL | – | – | Erledigt: #792 | Originale oben; kein Dispatch | 5e18c3e8 |

**Aktive Restpflichten (Fortsetzung).**

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-KI30 | Restursache der KI-30-Windows-Flake beheben; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | Performance- und Benchmark-Spezialist | st exklusiv für #737 bis zum Tag v1.6.0 | Server | A | Erledigt: #874 gemergt | Widersprüchliche Messfenster und unveränderte Nachbeobachtung bleiben offen. | – |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, Grenzen | Implementierer · Codex | Inbox E16; kein Pflichtkonto | PC / erster externer Tester | C | Geplant: Konto entfällt laut Nutzerentscheid vom 08.10.; kein Release-Vorgänger | Trockenlauf in Windows Sandbox ODER beim ersten externen Tester; Sandbox-Aktivierung nicht freigegeben | – |
| V16-RELEASE | Tag v1.6.0 nach Beta-Regel; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | Nutzer | Z1 (bis DR-17), V16-KI30 (Fix-Abnahme), D5-GUARD, V16-UPD-CANCEL, V16-06, V16-CHANGELOG; #728 gemergt | PC | – | Erledigt: Tag v1.6.0 = d2582ceb (09.10. 23:22Z), release.yml 38004103979 grün, latest.json anonym 1.6.0, PC installiert | Konkrete Nutzerfreigabe und grüne Release-Pipeline bleiben für jeden Release Pflicht. | – |
| V16-FU | Nachläufer aus v1.6.0-Reviews und Release-Prüfung; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z3-originals) | Stabschef | v1.6.0 veröffentlicht (V16-RELEASE) | Server | B/C je Punkt | Erledigt 10.10.: SRV-2/SRV-5-Portschutz #931, SRV-3 #952, OWN-3 #930, NOT-1 und R912-FU-1 #941, NOT-2/NOT-3 #928, SRV-4 #927, REL-3 #926, REL-4 #929, R910-FU #937, R889-FU #899 (09.10.); Rest verschoben nach V16-FU-2 | Der nicht vollständig abgenommene Nachfolger V16-FU-2 bleibt gebunden. | – |
| V16-FU-2 | Rest aus V16-FU: SRV-5 gegenseitige Authentifizierung (laut #931 weiterhin geparkt), R908-FU-1 (Wiring-Test stop→limitDrainForSignal), R908-FU-2 (Drain-Kommentar/Idempotenz), R896-FU, R899-FU K2 | Stabschef | V16-FU | Server | B/C je Punkt | In Arbeit: Teillieferung R908-FU-1 durch #1838 am 22.10.2026 um 22:28:00Z gemergt (`4934e32e35f8ab1dd5e58229038694be65a04078`): Wiring-Test am echten CLI-Einstieg für Linux-SIGTERM/SIGHUP und prozessseitig emittiertes SIGBREAK; kein nativer Windows-Signalnachweis. SRV-5 gegenseitige Authentifizierung bleibt geparkt; R908-FU-2, R896-FU und R899-FU K2 bleiben offen | je Punkt eigenes Paket mit eigener Abnahme | – |
| V16-NACHBEOB | Zwei Wochenmessungen und 40 Queue-Läufe; Messgrößen-Leitfaden | Stabschef | v1.6.0 | Server | C | Verschoben; KI-30-Schluss (#874: 42 Queue-Läufe ab 09.10., 0 KI-30) liegt vor, sein Fenster weicht vom Originalkriterium (Fenster ab #518, 05.10.) ab — Abgleich: Unbekannt (zu prüfen); zwei Wochenmessungen ohne vollständigen Fensterbeleg | Wochenberichte BENCH-01/02 im Ticket | b8b16ec8 |

**Historisches Register Z3 / 10 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z3-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-ARCH-D8a | Lieferbeleg | – | V16-ARCH-D5b | – | – | Erledigt: #960 | Originale oben; kein Dispatch | – |
| V16-ARCH-D8b | Lieferbeleg | – | V16-ARCH-D8a | – | – | Erledigt: #960 | Originale oben; kein Dispatch | – |
| V16-CHANGELOG | Lieferbeleg | – | DR-17 und die release-blockierenden Pakete aus V16-RELEASE (ohne diesen CHANGELOG selbst) | – | – | Erledigt: #922, #861, #894 | Originale oben; kein Dispatch | – |


KI-30-Quellenkonflikt (Basis `03542ef`, geprüft 09.10.):
- `KNOWN_ISSUES.md:231–233`: „Geschlossen wird KI-30 erst nach 0 Fehlschlägen in den nächsten 40 Queue-Läufen“; Quelle dort: V16-01 im Unterplan.
- `docs/PLAN.md:268` an derselben Basis: „neuer Beleg (Queue-Lauf-ID) vor Fix; danach 10 Queue-Läufe ohne KI-30“.
- `git log -p -G '10 Queue|40 Queue' -- docs/PLAN.md docs/decisions.md`: 10 seit `e7f7a56` (08.10.), ohne datierten Absenkungsentscheid in der geprüften Historie.
Daher hier der strengere Wert 40. Die Nutzerentscheidung vom 06.10. in
`docs/plan/v1.6.0/plan.md:11,50,182` bleibt erhalten: offene Nachbeobachtung nach
v1.6.0, kein Vorab-Wartegate; das bestehende Beobachtungsfenster nicht neu starten.
Fix-/Review-/Queue-Abnahme bleibt Release-Vorgänger; KI-30 wird nicht vorzeitig geschlossen.

## Z4 — Wichtig, aber liegen geblieben

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| Z4-ARCH-D1-REST | Vierten HTTP-Fehlerklassifizierer zusammenführen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | Implementierer; abgeschlossene api-Arbeit | – | Server | A | Erledigt: #663 gemergt | ARCH-D1 bleibt ausdrücklich offen. | 7810a005 |
| Z4-ARCH-11 | KI-24b: Test-DB-Wettlauf auf Windows reproduzieren und absichern; zusätzlich KI-30-Queue-Befund im Native-Receipt-Test | Implementierer · Claude; Ausführungs-Stabschef weist Lane zu | V16-KI30/#737 und anschließender Queue-Beleg; st bis Tag v1.6.0 exklusiv für #737 | Windows-PC für RED | A | Blockiert: Start nur, wenn Queue-Belege nach #737 den Defekt weiter zeigen; keine gemeinsame Ursache unterstellen; Queue-Belege nach #737 liegen vor (KI-30-Schluss #874: 42 Läufe, kein `real_native_`-Treffer, Beleg statistisch); KI-24-Teilfix #1463 (`13ef8a41`) und #1468 (`4f74b8f8`) gemergt; KI-24b-Rest: Unbekannt (zu prüfen), Root entscheidet Start oder Entfallen | Dateien `testutil.rs`, `store/development_launches.rs`, `store.rs` vor Start binden; 180–280 ALL nur Prognose; kompilierende Windows-REDs für Launch-Drop/Reopen und getrennt Migration-Reopen; zusätzlich `real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout` (Queue-Runs 37810056116/37814405700) eingrenzen; Zuordnung zur Windows-Flake-Klasse ist keine bewiesene gemeinsame Ursache; API-Ursache offen, keine Blanket-Retries; Fix nur nach Beleg, >300 ALL trennen; eigene prepush + zwei Fremdvendor-Reviews | 0e7793b4 |
| Z4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19); ausschließlich mn | Implementierer · Codex | nach v1.6.0; mn frei und neu zugewiesen | Server | A | Verschoben nach v1.6.0; nur mn, keine st-Naht; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“, zusammen mit dem eingefrorenen Dauerbetrieb | roter Test zuerst; prepush Exit 0 | – |
| Z4-R19-ST | Audit-Envelopes Ziel/Task, Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review (M4-R19-02/03/04/07) | Chief weist verbleibende Schnitte nach v1.6.0 zu | nach v1.6.0; st bis zum Tag exklusiv für #737 | Server | A | Verschoben: Rest 04/07, fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“, zusammen mit dem eingefrorenen Dauerbetrieb; 03 mit 03a #705 und 03b #956 (merged 2026-10-10T04:29:58Z, `2e1de0bb`) erledigt; #702/#705/#717 gemergt, keine Gesamt-Abnahme; ursprünglich: Verschoben nach v1.6.0: Rest 03/04/07 | ≤ 300 ALL je Schnitt; vorhandene Envelopes wiederverwenden, übrige Pfade getrennt belegen; Rot/grün, eigene prepush, zwei Fremdvendor-Reviews/Disposition und Root-Abnahme | – |
| Z4-VERIFY | Fünf Altzeilen gegen aktuelle Quellen prüfen und begrenzt schneiden | Root-Job `srv-z4-verify`; Chief integriert | Quelle `a167486` | Server | C | Erledigt: Prüfbericht 08.10. als datierte Bestandsaufnahme von Root am 24.10. angenommen; Folgepunkte nur über eigene aktuelle Pakete | Belege/Teilpässe erhalten; konkrete Reste und NICHT ABGEDECKT statt Altzeilen pauschal schließen | 77c993f3 |
| Z4-W103F-WIRE | Produktionsadapter `agent_record_delivery` anbinden; `main.rs`, ggf. API-Integrationstest und notwendige Adapter-Allowlist; 120–220 ALL | Chief weist einen Codex-Implementierer zu | #664 gemergt; mn frei; bestehende #301/#337/#352 erhalten | eigener Worktree | A | Verschoben: seit 08.10. ohne Start (M4-Freeze, Continuous eingefroren), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; PM prüft Startvertrag, kein neuer Worker | kompilierendes Produktionsadapter-Rot; danach done/blocked persistiert, wiederholtes done unverändert, falsche/veraltete Credentials abgewiesen; eigene prepush, zwei Fremdvendor-Reviews | 8e7b877f |
| Z4-W103F-Z1 | Originaler PC-Zustellbeleg mit 20 Versuchen, nur bereinigter Bericht ≤ 120 Zeilen | Chief weist einen Messowner zu | WIRE integriert; PC/App/Default-opencode und MCP-Start > 30 s belegt | PC | C | Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; reale Voraussetzungen und Zeitpunkt offen | je Versuch Version/Latenz/Marker/terminalbestätigter Empfang; 20/20 bzw. < 20/20 bestimmt Queue-Rest; keine erfundenen Pässe | 1c6d9ed8 |
| Z4-W303-PC-REST | Fehlende Crash-/Kapazitäts-/Provider-Belege aus bestehenden Drills, nur Bericht ≤ 180 Zeilen | Chief weist einen Messowner zu | gültige M4-Aktivierung, PC-Rechte und HQ-Läufe | PC | C | Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; M4-Freeze erhalten; #500-Teilpässe nicht wiederholen | Crash je spezifiziertem Übergang plus Kapazität/Provider mit Version/Befehl/Exit/Manifest; Singleton/Estop/Backup aus #500 erhalten | abf51cef |
| Z4-W307-PC-UPDATE | Signiertes installiertes Client-Update und Neustart, nur Bericht ≤ 150 Zeilen | Chief weist einen Messowner zu | autorisierter Windows-PC, Backup/Rückweg, neuere veröffentlichte Version und Abbruchpfad | PC | C | Verschoben: seit 08.10. ohne Start, Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; Release-Build ist kein Client-Laufbeleg | cancel/fail/success in dieser Reihenfolge; alte/neue Version, echte Signaturprüfung/Neustart, Fall-Manifeste/Exits; kein neuer Schlüssel/Release | c58c630b |
| Z4-M4B-0-AUTH | Transaktionslokale Run- und Owner-Autorisierung; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | Chief weist einen Nahtowner zu | st nach #632 frei; freigegebene Sicherheitskorrektur bei deaktiviertem Continuous Mode | eigener Worktree | A | Erledigt: #1607 (merged 2026-10-16); nur die Prüffunktion, kein Schreiber angebunden; Source-Ladebefund mit Z4-M4B-4-IMPORT/#1855 geschlossen; übrige Pflichten siehe IMPORT; Continuous bleibt deaktiviert und eingefroren. | GOAL-/Import-Testnachlauf, nicht angebundene Schreiber und Audit-/Windows-Belege bleiben offen; Continuous bleibt eingefroren. | fea04970 |
| Z4-M4B-1a-PLUMB | Autorität bis zu den vier Schreibern durchreichen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | ein serieller st/api/mn-Owner; Chief weist zu | Z4-M4B-0-AUTH (#1607); Nähte `api.rs` und `main.rs` frei | eigener Worktree | A | Erledigt: reine Durchreichung #1836 gemergt | Deterministischer 403/refused-Nachweis und GOAL-/IMPORT-Reste bleiben offen; Continuous bleibt eingefroren (Belege: #1855). | – |
| Z4-M4B-1-GOAL | Goal/Replan atomar autorisieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | ein serieller st/api/mn-Owner | Z4-M4B-1a-PLUMB; freigegebene Sicherheitskorrektur ohne Continuous-Aktivierung | eigener Worktree | A | Erledigt: #1842 (merged 2026-10-22T18:35:12Z, fa4f2d9a). Source-Ladebefund mit Z4-M4B-4-IMPORT/#1855 geschlossen; GOAL-Reste im bestehenden Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310 bleiben offen; Continuous bleibt eingefroren. | GOAL-Nachlauf 2dbc396c-9b74-4556-9c28-d9e00f5c6310 sowie Audit-/Windows-Belege bleiben offen; Continuous bleibt eingefroren. | 2be81e2e |
| Z4-M4B-2-TASK | Tasks atomar autorisieren und anlegen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | ein serieller st/api/mn-Owner | Z4-M4B-1-GOAL (Nahtübergabe) | eigener Worktree | A | Erledigt: #1849 (merged 2026-10-22T21:03:34Z, `8c86bfc44c50e55209da7de48fdc7e3cb692a750`); TASK prüft Run/Owner/Fence/Rolle/Zielprojekt atomar in seiner SQLite-Schreibtransaktion; erforderliche API-Weiterleitung, Operator None erhalten. IMPORT-Source-Ladebefund mit #1855 geschlossen; GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), Import-Testnachlauf c91a08d0, Audit-/Windows-Belege bleiben offen, Continuous bleibt eingefroren. | GOAL-Reste, Import-Testnachlauf c91a08d0 und Audit-/Windows-Belege bleiben offen; Continuous bleibt eingefroren. | 8dbd5dc7 |
| Z4-M4B-3-ASSIGN | Zuweisungen atomar autorisieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | ein serieller st/api/mn-Owner | Z4-M4B-2-TASK (Nahtübergabe) | eigener Worktree | A | Erledigt: #1852 am 22.10.2026 um 23:04:03Z gemergt (`88ef0b777994fb932d3dba23de456e4d6e264eb6`, Kopf `e341b6f5`); ASSIGN prüft Run/Owner/Fence/Rolle/Task-Projekt unter derselben SQLite-Schreibsperre wie Zuweisung/Revision/Event; getrimmte Coordinator-Selbsteskalation wird verweigert, gültige Zuweisung und Operator None bleiben erhalten. IMPORT-Source-Ladebefund mit #1855 geschlossen; GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), Import-Testnachlauf c91a08d0, Audit-/Windows-Belege bleiben offen, Continuous bleibt eingefroren. | GOAL-Reste, Import-Testnachlauf c91a08d0 und Audit-/Windows-Belege bleiben offen; Continuous bleibt eingefroren. | 15d92066 |
| Z4-M4B-4-IMPORT | Import nach Source-Laden atomar autorisieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | ein serieller st/api/mn-Owner | Z4-M4B-3-ASSIGN (Nahtübergabe) | eigener Worktree | A | Erledigt: #1855 am 23.10.2026 um 02:42:19Z gemergt (`d39a03f1cffe52359516f8cfc1ebfa485e791ef4`); IMPORT prüft Run/Owner/Fence/Rolle/Projekt nach dem echten Source-Laden unter derselben SQLite-Schreibsperre wie Projektion und Revision; Operator None, CAS und Sourceprüfung bleiben erhalten. Root schließt damit den Source-Lade-/Autorisierungsbefund; Import-Testnachlauf c91a08d0, GOAL-/M4B-Reste (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310) und separate Audit-Transaktion bleiben offen. Windows-Nachweis separat, Continuous bleibt deaktiviert und eingefroren. | Nur der Source-Ladebefund ist geschlossen; c91a08d0, GOAL-/M4B-Reste, separate Audit-Transaktion und Windows-Nachweis bleiben offen, Continuous eingefroren. | e7c9e018 |
| F8-UNPROVEN-CHECK | PRÜFEN (nur lesend): ob `allow_unproven_project_create` (`src-tauri/src/api.rs`, abgeleitet aus einem gesetzten `PROJECTA_APP_DATA`) die Verdict-Prüfung der Projektregistrierung außerhalb des isolierten F8-Laufs aushebeln kann; Befund aus der README-Architekturanalyse vom 16.10. | Root disponiert | – | Server | A | Geplant: nicht disponiert (16.10.), zuerst nur lesend; ein Fix nur bei Befund als eigenes Stufe-A-Paket (Nahtdateien seriell) | Bericht mit `file:line` und rotem Test oder „gilt nicht“; keine Aktivierung | – |
| Z4-SERVER-DISK | Server-Platte: alte Worktrees (~151 GB) aufräumen; erst Backup | Root disponiert, Stabschef führt aus | Inbox E17 | Server | – | Geplant: E17/K6 ist beantwortet; Root darf nur saubere alte Arbeitsbäume mit Kopf auf Remote und nach Backup-Liste aufräumen. Zielerreichung nicht belegt. | Platte < 60 %, Backup-Beleg | – |
| Z4-RCLONE | Eigene rclone-`client_id` vor Ende 2026 | Nutzer | – | PC | – | Geplant (Nutzer, Frist Ende 2026); seit 08.10. ohne Beleg | Backup läuft mit eigener ID | – |
| Z4-SETUP-14 | Rest SETUP-14: tote Keys, Permission-Regeln | Nutzer | – | PC | – | Geplant (Nutzer); seit 08.10. ohne Beleg | Liste abgehakt | – |
| Z4-M5-01 | Testerrunde mit 3–5 externen Testern | Nutzer | V16-03, E16 | egal | – | Verschoben | Rückmeldungen festgehalten | – |
| Z4-M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um | Root | Z1 | egal | – | Verschoben | Umfang festgelegt | – |
| SEC-01b | Audit-Abhängigkeiten rustls und Updater aktualisieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | Implementierer; Root nimmt ab | – | Server | A | Erledigt: #1728 gemergt; vier rustls-Meldungen behoben, zip 4.6.1 mit drei Meldungen/Audit Exit 1 offen, Nutzer-Sicherheitsentscheidung ausstehend | zip-Sicherheitsentscheidung durch den Nutzer und die verbleibenden Audit-Meldungen bleiben offen. | PR #1728 |


### Flake-Nachtrag 15.10.2026 (KNOWN_ISSUES / Z4)

Quelle: `flake-hunt-20261015.md`, Root-Auftrag und pa-orch-Ereignisse (15:28/15:44 MESZ); Root besitzt Wiederaufnahme/Abnahme. Keine Retry- oder Timeout-Erhöhung freigegeben.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| FLK-NATIVE-EXIT | Nativen Exit-Fehler rot belegen und beheben | srv-flk-native-exit; Root klärt Windows-Ort | deterministischer Windows-Rotnachweis | Server / Windows-Beleg | A | Blockiert: geplant nach Rotnachweis; Server-Auftrag srv-flk-native-exit endete 15:28 MESZ ohne Rotnachweis; ursprüngliches „läuft“ überholt | Rot/Grün, prepush, Reviews, Root | FLK-NATIVE-EXIT |
| FLK-SQLITE-LOCK | SQLite-Lock-Befunde kausal abgrenzen | srv-flk-sqlite-lock; Root | Windows-Messung, neuer Defektbeleg | Server / Windows-Beleg | A bei Fix | Blockiert: Befunde vor #1463; Server-Auftrag srv-flk-sqlite-lock ohne neuen gemeinsamen Rotnachweis beendet; keine Aktion | Neuer kausaler Befund vor jedem Fix | FLK-SQLITE-LOCK |
| FLK-TEMPDIR | Tests hinterlassen wieder temporäre Ordner; Quelle belegen und beheben (Nachfolger von KI-TMP #1036, `1953b010`) | Root disponiert | Rotnachweis, welcher Test leckt | – | – | Geplant: nicht disponiert (laut Root 15.10.) | Testlauf hinterlässt keinen neuen Ordner im Temp-Verzeichnis; Rot/Grün | – |

### Nachtrag 15.10.2026: erledigt ohne frühere Planzeile

Gemergte Arbeit seit 10.10., die keine eigene Planzeile hatte. Je Zeile PR-Nummer und Merge-SHA aus der GitHub-API (erneut geprüft 16.10.); keine neue Arbeit daraus.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-PATCH | Patch-Releases und weitere Freigabegrenzen; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | – | V16-RELEASE | – | – | Erledigt: v1.6.1–v1.6.6 dokumentiert; v1.6.2 ohne erfolgreichen GitHub-Release, durch v1.6.3 ersetzt; weitere Releases nur nach K5/konkreter Freigabe | Weitere Releases bleiben an aktuelle K5-/RELEASE-PAUSE-Grenzen und konkrete Freigaben gebunden. | – |
| DR2-2a | Versionierte Ideendialoge speichern; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | – | DR2-0 | – | – | Erledigt: DR2-2a #1334, DR2-0 #1332 und DR2-1 #1336 geliefert; DR2-2b/3/4/5/6 ohne PR/Auftrag/Disposition, vor Dispatch mit DN-03 bis DN-05 abgleichen | DR2-2b/3/4/5/6 bleiben ohne Disposition; vor weiterem Dispatch mit DN-03 bis DN-05 abgleichen. | – |
| AP-9 | IPC-Befehlsnamen zwischen `generate_handler!` und Aufrufern abgleichen | – | – | – | – | In Arbeit: nur S0 erledigt, #1413 (`032f1529`, 14.10.); weitere Schnitte: Unbekannt (zu prüfen) | – | – |
| DS-X-01 | Einstellungen, Leerzustand und Headerumbruch korrigieren; [Vollvertrag](archive/plan-2026-10/residuals-2026-10-24.md#z4-originals) | – | – | – | B | Erledigt: #1604 gemergt, ersetzt DS-06 | Root-Abnahme und V2-FU-HEADER-SPACE bleiben separat offen. | – |

**Historisches Register Z4 / 11 — kein Dispatch.** [Originale](archive/plan-2026-10/z-targets-2026-10-24.md#z4-originals).

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DR2-0 | Lieferbeleg | – | – | – | – | Erledigt: #1332 | Originale oben; kein Dispatch | – |


Historische PR-Zuordnung einschließlich #488: [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context); keine neue Arbeit oder vollständige Zuordnungsbehauptung.

<a id="release-reihenfolge--nutzer-entscheid-0810-root-2204z-historisch-v160-am-0910-erschienen"></a> [Historischer Abschnitt](archive/plan-2026-10/contracts-2026-10-24.md#release-order); kein Dispatch.

Weiter bindend: V16-NACHBEOB/ADR-A7/03/D8a–c sind keine Release-Vorgänger; Tester-Kit und E16 bleiben offen, keine Sandbox-Aktivierung. DEV-KNOW-01 und Z2-RECHTE-PILOT bleiben verschoben; kein Wiederholen des Messschnitts und kein Auftrag aus „Lernende Entwicklungskoordination“. M4B-Reste stehen in GOAL/IMPORT; Continuous bleibt eingefroren.

### Z2-AGENTS-SLIM — begrenzter Server-Startvertrag (C)

- Ziel: AGENTS.md am Gesamtabschluss ≤ 8192 UTF-8-Bytes; die zehn Kernregeln wortgleich erhalten. Aktuelle Basis `072b4af16a9b265882665fbf881ce780552f4bec`: AGENTS.md 22274 Bytes/376 Zeilen (Stand 09.10.; am 15.10. auf `c9d4ca35`: 28903 Bytes, vor Start neu messen); vor jedem Schnitt den wirklichen main-SHA pinnen.
- Owner: bestehende Tabellenzuständigkeit, Ausführungs-Stabschef benennt EINEN vorhandenen Doku-Owner nach DR-12; Root pflegt PLAN interim gemäß Auftrag 09.10.
- Exklusiv: AGENTS.md und `docs/development/AGENTS_REFERENCE.md` als eindeutig verlinkte Referenz; bestehende Referenzdateien nur lesen. Keine Skills, globale CLAUDE/MEMORY, PLAN, Hooks/Gates, Quota/Rechte oder Runtime ändern.
- Vorbereitung im selben Worktree: Regeln/Abschnitte gegen bestehenden Reference-Stand mappen, jede ausgelagerte Pflicht per eindeutigem relativen Pfad/Anker erhalten. Vor Dispatch tatsächliche Diffprognose ≤ 300 ALL inklusive Referenz; kein 8-KB-Ziel als Größenausnahme. Falls nötig zwei serielle Doku-Schnitte S1/S2: S1 höchstens 130 bestehende Referenzzeilen bewegen plus Links, S2 nur nach dessen Root-Abnahme/Merge, jeweils ≤ 300 ALL. Reicht dies nicht, vor Start neu schneiden. Nie Referenz vor erfolgreicher Übertragung streichen; keine Regelabschaffung.
- Nichtziele: Änderungen der GOALS-/Operator-/Freigabe-/Review-/Merge-Semantik, Aktivierung von Teams/Workern/Sandbox, Wirksamkeits-/Tokenersparnisbehauptungen.
- Doku-Probe statt künstlichem RED: vorher/nachher UTF-8-Bytes, zehn Kernregeln bytegleich, vollständige Abschnitt→Pfad/Anker-Matrix im PR, Links existieren; `npm run dev:agent-check` und eigene volle `bash scripts/ci/gates.sh lane prepush` Exit 0. „AGENTS-check“ ist hier diese dokumentierte Prüfung plus vorhandener agent-check; kein zusätzlicher gleichnamiger Gate im geprüften gates.sh-Katalog.
- Abnahme je S1/S2: normaler Secret-/Commit-/Pushhook, Remote-SHA bestätigt, eigener Draft-PR ≤ 300 ALL mit Report/NICHT ABGEDECKT, Tier C, Root-Kopfannahme vor Ready/Mergify. Endziel ≤ 8192 Bytes erst am letzten integrierten Schnitt.
- Startgates: DR-12-Beleg, aktuelle Owner/Dateisperren, beobachtetes Modell/Quota, RAM ≥ 1,5 GiB, Cargo/Slot prüfen. Vorhandene Doku→Gate→Root-Kette wiederverwenden; kein neues Team/Agent/QA. Abbruch: fehlendes Mapping, Link oder Size-Cap stoppt den Schnitt. NICHT ABGEDECKT: allgemeine Adoption oder gemessene Tokenersparnis.

<a id="lanes-5-parallel--historisch-v160-erledigt-0910"></a><a id="dr-07cde1e2-vier-weitere-p1-testports-historischer-startvertrag-erledigt-07c-752-07d-753-07e1-751-07e2-755"></a><a id="serverreserve-drei-disjunkte-startverträge-root-0810-2045z-historisch-erledigt-725726727"></a><a id="serverreserve-2-fünf-zusätzliche-startverträge-root-0810-2127z-historisch-erledigt-738739742745746"></a><a id="anpassungsnachweis-dr-15a-und-übergaben-0810-0440-utc-historisch"></a><a id="anpassungsnachweis-plan-c1-historisch"></a> [Historischer Abschnitt](archive/plan-2026-10/contracts-2026-10-24.md#lanes); kein Dispatch.

## Entscheidungs-Inbox

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| DR03-F01 | Gesamtgröße des Ledgers begrenzen: WRITE-/Listenlimits getrennt von harter SAFE-READ-/Vor-Parse-Bytegrenze, alle Top-Level-/Nested-Listen, Bestandslesen/503 und spätere Konfigänderungen disponieren | neue übergroße Writes nichtdestruktiv ablehnen; keine Trunkierung/Archivierung/Retention; keine Lesbarkeitszusage jenseits sicherer Lesegrenze; erst repräsentative reale Ledgerform/-größe/-kosten, keine erfundenen Grenzwerte | offen; Interview-Vorbereitung im bestehenden Ticket, Empfehlungen keine Entscheidung; zwei Nutzerfragen bis Belegbasis bei Root geparkt, gesamte DR-03-Abnahme offen |
| OPT-CI-0 / Vorschlag 3 (15.10.) | Windows in der Queue ohne geänderte WINDOWS_INPUTS überspringen? | Offen abwägen: weniger Läufe; Fehler außerhalb der Eingabeliste erst im Wochenlauf erkennbar | offen, Prüfschritt entschieden: Nutzer 16.10. (K3, C; Root-Chat): erst lesend prüfen, ob die WINDOWS_INPUTS-Liste die letzten Windows-Fehler abgedeckt hätte, dann erneut fragen; Prüfung nicht disponiert; keine Umsetzung freigegeben |
| V2-OFFEN | v2.0-Fragen 5–9 und 11 | nach Z1 | offen, fällig seit v1.6.0 (09.10.); Frage 7 = E15 und Frage 11 = E17 (nicht doppelt fragen); bis zur Antwort gilt je Frage „Ohne Antwort“ (v2-Plan Abschnitt 7) |
| GI02 / GI05 | Classic und 13 Platzhalter verbergen/hinter Schalter oder bauen? | Root legt den begrenzten Umfang anhand der aktuellen Glass-Bestandsaufnahme vor | GI02 offen; keine Implementierungsfreigabe aus der Frage. GI05 beantwortet 26.10.2026 (Wortlaut unter „Gültige Regeln und Antworten“): 13 Platzhalter standardmäßig verbergen, sichtbarer dauerhafter Schalter zeigt sie wieder; der anschließend von Root angenommene konservative Schnitt ist dort getrennt vermerkt |
| V2-ENDKARTE | Endkarte v2.0.0: Bilder ansehen (SHOT), Klick-Checkliste durchklicken (UAT-1b), Update-Drill (V2-DRILL), genügt der Dev-Installer als Beta-Kanal (BETA-0), Release-Sperre lösen (D1-on, #1540 neu geschnitten) und frisches v2.0.0-Ja? | Erst nach V2-REL-PREP, einzeln und in dieser Reihenfolge vorlegen; der BETA-0-Bericht empfiehlt den Dev-Installer ([v2-Plan 10.1a](plan/v2.0/plan.md#101a-pakete-für-die-kriterien-v20)), die Bestätigung steht aus | offen; keine Freigabe aus dieser Zeile, eine unbekannte oder fehlende Antwort ist kein Release-Ja |
| SEC-01b | Verbleibende zip-Meldungen disponieren? | Bestehenden Auditbefund und Sicherheitsfolgen entscheiden | offen; bei Root zur Nutzerentscheidung |
| E15 / E16 | Server-Zukunft bzw. Lizenz/Geschäftsmodell entscheiden | Nach erster V2-CAP-1-Auslastungszahl bzw. vor erster Testerrunde wieder vorlegen | offen zum beschlossenen späteren Zeitpunkt; Server bleibt, MIT bleibt |


## Gültige Regeln und Antworten

Spätere Antworten gehen vor; Quellen erteilen keine neue Erlaubnis.

- **GI05 (Nutzer 26.10.2026, ca. 00:23Z; Root `msg-0mvoiks7e-9f5929ea`, nativ 00:24:13.514Z):** Wortlaut: „Fragen von dir: ja du darfst die verirrten prozesse beenden 2. ja aber umschaltbar“. Angewendet wird nur der GI05-Teil (2.): die 13 nicht angeschlossenen Glass-Bereiche standardmäßig verbergen, ein sichtbarer, dauerhaft gespeicherter Schalter zeigt sie wieder. Davon getrennt: Root nahm danach den konservativen Schnitt B an (`msg-0mvokawt4-326798eb`, nativ 26.10.2026 01:12:32.152Z; macht /beweise nicht zur sichtbaren Standardansicht), und das Umsetzungskind 004c3d97-4739-4443-bef1-babe7f3ff518 startete am 26.10.2026 01:20:06Z (Claude Sonnet 5.5); die Umsetzung läuft unabhängig von RESTORE unter V2-REST-GLASS (kein eigenes Blatt hier) und wurde mit PR #1919/Laufzeitkopf `dcc45032` und gezielten Test-/Browserbelegen geliefert; nach Root-Abnahme und zwei Fremdfamilien-Reviews sowie der e2e-Korrektur am Kopf `4a990a34` am 26.10.2026 04:42:36Z via Mergify gemergt (`9e3b8f044742d4c8de67962e3d4f18c386f02462`); native/Install/UAT bleiben offen. Die Antwort ist keine Implementierungs-, Installations- oder Release-Freigabe. Die Prozessbereinigung (Teil 1) ist erledigte Root-Historie und keine Worker-Berechtigung; die Ausnahmenliste für neue native Admission-Prozesse bleibt leer. GI02 bleibt offen.
- **Archiv-Ausnahme:** nur dieses PLAN-v2-Ziel; bytegleiche Archivzüge mit Quell-/Ziel-SHA und voller Inverse dürfen 300 RAW überschreiten; beide semantischen Seiten/Kopien/Hüllen ≤300, Gates/Reviews/Root-Abnahme bleiben. [Quelle][a23].
- **Glass zuerst:** v2.0.0 erst mit funktionierenden Funktionen, einheitlicher UI und sauberem Release; ACC1b/#1540 und UAT1a/#1544 geschlossen/ungemergt, aktuelle Glass-Abnahmen neu schneiden. [Quelle][a23].
- **Begrenzte Entparkung:** nur Glass nach lesender Bestandsaufnahme/belegtem DS-U-Schnitt; DS-U0-README unabhängig erlaubt, keine pauschale `styles.css`-Entfernung. [Quelle][a23].
- **Fabrik v2.x:** DS-H/DS-WF später mit gemeinsamen `--g-*`-Tokens/Schnittstellen; jetzt keine Implementierung, Tokens, Exporte, Artefaktauffrischung oder Pixelarbeit; alte Meisterbüro-/Probe-Halle-Reihenfolge im Glass-Schnitt überholt. [Quelle][a23].
- **Release/K5:** nur benannte Patchklassen (Sicherheit, Abstürze, Datenverlust, größere Umstrukturierungen, UI-Updates), konkrete Freigabe bleibt nötig; Minor/Major frisches abschließendes Nutzer-Ja. D1-on/#1540/externe Abnahme offen, kein Tag aus dem Planschnitt. [Quelle][a16].
- **Nutzbar 1** vor neuen Funktionen; Designsperre nur für Glass aufgehoben, DESIGN-R2 v2.x/geparkt; Gratisreviews zählen nicht nach Regel 5, alte Modelle/Quoten erlauben keinen Start. [Quelle][design].
- **DG/KI-24:** offen, H1-Hängerursache unbelegt; manuelle scripts/dev-Tests außerhalb der Gates; C1/P3 geschützt; H1 D1/G2, D2, D3, G4 geparkt. [Übergabe][dg], [KI-24][ki24].
- **B1a/B1b:** 396 Schlüssel/Werte/Reihenfolge erhalten; B1b erst nach B1a-Merge, Prozessende, freier Datei; kein `--update`, Messlauf, neue Metrik/Grenze/CI-Verdrahtung. [Quelle][db].
- **EQ-2/P9:** EQ-2 entfallen, P9 begrenzt, Referenz-App gestoppt; kein neuer Screen-/Producer-/P9-Scope. [Quelle][db].
- **[OWNER-KARTEN-1016: cards K1-K15, release amendment, review route and routing](decisions.md#2026-10-16---owner-karten-1016-cards-k1-k15-release-amendment-review-route-and-routing):** K1 CodeQL bei Cache/Event-Änderung neu prüfen; K2 keine frühe Queue; K3 WINDOWS_INPUTS erst lesend prüfen, dann fragen; K4 Ursache statt Retry; K5 siehe Release; K6 Cleanup nur Root, sauber/Remote-Kopf/Backupliste; K7 IMPORT-Ladebefund geschlossen, M4B-Reste/Freeze bleiben; K8 DR-16b wartet; K9 RAM prüfen; K10 Pacer geparkt; K11 Continuous/resume gesperrt ohne Nutzer-Ja; K12 reale V2-CAP-1-Läufe statt Benchmark; K13 gestrichene Anbieter/Geldmodi bleiben gestrichen, heutige AGENTS-Guthabenwege ohne Nachkauf; K14/E15 nach erster Auslastungszahl, Server bleibt; K15/E16 vor Testern, MIT bleibt. [Vollverträge][a16].
- **ROADMAP-HOST:** nur lokale `.pa/roadmap.html`/Dev-HQ; keine GitHub-Veröffentlichung, Pages oder eingechecktes HTML. [Quelle][a16].
- **PLAN-1/PLAN-L0-SINGLE:** ein Master/v2-Unterplan; Q10 ersetzt, alte V2-FREEZE-1a/1b entfallen, Parser-Pflege Z2-PLANPARSER. [Quelle][settled].
- **Beantwortete Karten:** nicht erneut fragen; gültige Grenzen/spätere Ersetzungen bleiben, R1/R2/R3/R5 heutige Regeln, R4 Root. [Karten][cards], [13.10.][historie], [weitere Antworten][a16].
- **Infrastruktur entschieden:** öffentlicher Repo-Neustart, CI-QUEUE-02 (`max_parallel_checks` 2), CI-HARDEN-02 (`review-ok`), enge AGENTS-API-CREDITS-Ausnahme umgesetzt. [Quelle][settled].

- **[The user answers seven questions (v2.0 eng)](decisions.md#2026-10-15---the-user-answers-seven-questions-v20-eng):** PA_SEAM_ALLOW je Root-Auftrag; Zustandswörter/Farben, ruhige umstellbare Orbs; fremde Agentenkonfiguration nur nach Backup, eigene ausgenommen. Navigation durch NAV-0/Glass fortgeschrieben; kein Umsetzungsbeleg.
- **[NAV-0: six navigation areas, three visible in v2.0, tab "Linie"](decisions.md#2026-10-16---nav-0-six-navigation-areas-three-visible-in-v20-tab-linie):** sechs Bereiche, damals Fabrik/Betrieb/Einstellungen sichtbar; IDs stabil, Halle erst nach DS-H-07-Abnahme. Fabrik nun v2.x; GI02/GI05 und Glass-Abnahme offen, keine Fabrik-Entparkung.

<a id="entscheidungen-23102026--plan-v2-und-aktuelle-glass-oberfläche"></a><a id="entscheidungen-18102026-elias"></a><a id="entscheidungen-vom-16102026--owner-karten-1016"></a><a id="entscheidungen-vom-18102026"></a><a id="beantwortete-karten-vom-13102026--zwei-modi-und-anbieter"></a><a id="entschiedene-fragen"></a> [Antwortoriginale](archive/plan-2026-10/inbox-2026-10-24.md); offene Fragen in der Inbox.

[a23]: archive/plan-2026-10/inbox-2026-10-24.md#answers-23-october
[db]: archive/plan-2026-10/inbox-2026-10-24.md#design-and-dg-bindings
[settled]: archive/plan-2026-10/inbox-2026-10-24.md#owner-and-settled-answers
[a16]: archive/plan-2026-10/final-2026-10-23.md#owner-decisions
[cards]: archive/plan-2026-10/final-2026-10-23.md#answered-cards
[design]: archive/plan-2026-10/final-2026-10-23.md#design-decisions
[dg]: archive/plan-2026-10/context-2026-10-23.md#dg-handover-on-22-october
[ki24]: ../KNOWN_ISSUES.md#ki-24-windows-wiederauftreten-und-erfolgreicher-wiederanlauf-22102026

## DG-Verträge und offene Restpflichten

Kompakte Verträge, kein Dispatch; Restpflichten und verlinkte Vollverträge gelten mit den Regeln oben.

#### Nachtrag 19.10.2026, 02:10 MESZ (Root, Stand nach #1714 und #1724)

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DG-00 | Design gate; B1/C1/P3 bleiben getrennt | Root disponiert; Autor Codex | – | Server | B | Erledigt: #1723; Gesamtziel weiter offen | Ratchet/0–2–12-Fälle und Reviewpflicht bleiben; keine CI-Verdrahtung; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-dg-00) | – |
| DG00-H1-CLI-HELP | design:gate --help/-h ohne Mess-/Baseline-Nebenwirkung; R1723-H1 aus #1723 | srv-dg00-h1-cli-help (job72), fortgesetzt als srv-dg00-h1-cli-help-r2 (job74), Branch codex/dg00-h1-cli-help; Chief disponierte, Root nahm ab | DG-00 | Server | B | Erledigt: #1825, Queue #1827 | Originale Mess-/Ratchet-Tests erhalten; kein neuer Designbau; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-dg00-h1-cli-help) | 69c61ba2-957f-4f60-9488-d3da87ccd37d |
| R1723-B1a | Baseline-Schreiber; 132 Fälle formatiert, 264 Restfälle | srv-dg00-b1-baseline-writer (job76), Branch codex/dg00-b1-baseline-writer; Chief disponiert, Root nimmt ab | DG-00, DG00-H1-CLI-HELP gemergt; exklusiver Baseline-Schreiber | Server | B | Erledigt: #1828; B1-Gesamtziel/B1b getrennt | 396 Schlüssel/Werte/Reihenfolge unverändert; nur Serialisierung; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-r1723-b1a) | d10b1459-57e4-45b8-bc4f-865ceb2ff205 |
| R1723-B1b | 264 Baseline-Restfälle nur JSON-formatieren | Noch kein Ausführungsowner; Chief disponiert nach Freigabe, Root nimmt ab | Tatsächlicher B1a-Merge UND Prozessende UND freier exklusiver Baseline-Schreiber; gemeinsamer Dateipfad nur seriell | Server | C | Blockiert: serieller Nachfolger, kein Start oder Lieferbeleg | ≤300 RAW; 396 Schlüssel/Werte/Reihenfolge; eigene prepush/Root/Mergify; B1 erst mit beiden Schnitten erfüllt; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-r1723-b1b) | bce93908-1192-438a-8dd8-2ec939b89eec |
| DG-05 | Not-Aus einmal im Header; Bestätigung, Abbrechen wirkungslos, Fokus zurück | Root disponiert; Autor Codex, Fix-Runden Kimi | – | Server | A | Erledigt: #1722; R2-L1/Override separat #1810 | Ursprüngliche Lieferung erledigt; Nachläufer separat; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-dg-05) | – |
| DESIGN-R2 | Meisterbüro-Prototyp: Astra Runde 2, danach zwei unabhängige Kritiker | Elias (TasteCode), Root prüft | Elias' decision 19.10. | PC | C | Verschoben: v2.x/geparkt; kein Dispatch | Designqualitätsgate PASS bleibt Kriterium; [Vollvertrag](archive/plan-2026-10/inbox-2026-10-24.md#dg-contract-design-r2) | – |

## Historischer Vertrags- und Parserbestand (Übergang)

Die folgenden Bestände bleiben wegen offener Restpflichten oder ihrer Leser im Plan.
Abgeschlossene Übergaben, frühere Modellzuordnungen und die alte Inbox stehen im
[Archiv](archive/plan-2026-10/history.md); sie begründen keine neuen Aufträge.
Bestehende Antworten und Verträge gelten mit ihren späteren Änderungen weiter und ersetzen keine oben bestätigte Entscheidung.
Dies ist der ausdrücklich NICHT DISPATCHENDE Kompatibilitätsanhang: M1–M5 und alle DF-Zeilen bleiben als Parserquelle wortgleich, einschließlich ihrer historischen Überschriften und Abnahmen. Aktuell gültige Restverträge und spätere Entscheidungen bleiben verbindlich; nur die Z-Tabellen oben disponieren, niemals diese alten Startformulierungen.

### Historisches Abhängigkeitsregister

Abgeschlossene Z-Lieferungen, kein Dispatch. Vollständige Originalzellen und Reihenfolge: [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md). Offene Elternabnahmen stehen in den aktiven Zeilen.

| ID | Status |
|---|---|
| PLAN-v2.0-2 | Erledigt |

<a id="ideas-l0-v1-0"></a>
<a id="ehemals-aktive-ziele-und-l0-schnitt-0710-historisch"></a><a id="l0-mapping-auf-vorhandene-arbeit"></a><a id="modellzuordnung-geplant-konfiguriert-wirksam-erfolgreich-benutzt"></a><a id="minimaler-additiver-ideenmetadatenvertrag-root-disposition-07101520-utc"></a> [Historischer Abschnitt](archive/plan-2026-10/contracts-2026-10-24.md#l0); kein Dispatch.

Weiter bindend: L0-Nutzerabnahme (drei Ideen, eine samt Kategorie/Priorität bearbeiten, suchen/sortieren, neu laden; Fehler erhält Entwurf; CAS/Replay/Neustart ohne Verlust) und echter Nutzerzugang bleiben offen bei Root. P1/P2-Verträge einschließlich Metadaten-/Replay-Kompatibilität, DD-RECEIPT/Teil02-A samt Pins/23 Fällen und der ausgeschlossene Studio-/Pilot-Scope bleiben im [Vollvertrag](archive/plan-2026-10/contracts-2026-10-24.md#l0) verbindlich; kein Start aus alten Zuweisungen.

<a id="ideenfließband-anforderungen-und-historischer-übergabestand-v10"></a><a id="projecta-ideenfließband--umsetzungsplan"></a><a id="1-verbindlicher-auftrag-und-erste-lieferung"></a><a id="2-ausgangslage-und-evidenzgrenze"></a><a id="3-produktmodell-zwei-miteinander-verbundene-bereiche"></a><a id="stationen-und-eindeutige-austrittskriterien"></a><a id="4-freigabe-und-priorisierung"></a><a id="5-ui-und-ux-schnell-erfassen-gut-überblicken-gezielt-vertiefen"></a><a id="6-anlagen-recherche-und-planentwurf"></a><a id="7-daten-und-technische-leitplanken"></a><a id="9-blocker-bestätigungen-und-cloud-dokument"></a><a id="10-die-stärksten-einwände-und-ihre-behebung"></a><a id="11-abnahme-erfolg-und-sofortiger-arbeitsauftrag"></a><a id="lieferprotokoll"></a> [Historischer Abschnitt](archive/plan-2026-10/contracts-2026-10-24.md#ideas); kein Dispatch.

**Historische Ideen-Vertragsziele — kein Dispatch.** Alle P0–P10-Kriterien, Zuständigkeiten und Grenzen bleiben im [Vollvertrag](archive/plan-2026-10/contracts-2026-10-24.md#ideas).

## 8. Umsetzungspakete und Parallelisierung
| Paket | Inhalt / Ownerrolle | Voraussetzung | Abnahme |
| --- | --- | --- | --- |
| P0 | [Root + PM P0](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | aktueller Auftrag | [Unveränderte Abnahme P0](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P1 | [Backend P1](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P0 | [Unveränderte Abnahme P1](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P2 | [Frontend P2](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P0, abgestimmter P1-Vertrag | [Unveränderte Abnahme P2](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P3 | [Betrieb/Integration P3](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P1/P2 | [Unveränderte Abnahme P3](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P4 | [Backend + Frontend P4](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | L0, Uploadvertrag | [Unveränderte Abnahme P4](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P5 | [Vorbereitung P5](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P1, Jobvertrag | [Unveränderte Abnahme P5](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P6 | [Pipeline P6](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P5, bestehende PlanDraft-Verträge | [Unveränderte Abnahme P6](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P7 | [Freigabe + Roadmap + Orchestrator-Handoff P7](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | P6 | [Unveränderte Abnahme P7](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P8 | [Board, fokussierter Graph, Langfristansichten P8](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | stabile Beziehungen aus P5/P7 | [Unveränderte Abnahme P8](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P9 | [Last, Mobilpolitur, Export/Wiederherstellung P9](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | inkrementell nach L0 | [Unveränderte Abnahme P9](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |
| P10 | [Arbeitsregeln, Skills/Prompts/Trigger und begrenzter Kritikerpilot P10](archive/plan-2026-10/contracts-2026-10-24.md#ideas) | bestehender Pilotauftrag | [Unveränderte Abnahme P10](archive/plan-2026-10/contracts-2026-10-24.md#ideas) |

## Meilensteine

| M | Titel | Abnahme in Alltagssprache |
|---|---|---|
| M1 | Alles Laufende gelandet, App startbar | Keine offenen Paket-PRs aus M1, `main` grün. Die App startet vom aktuellen `main`, ohne dass alte Queue-Einträge Agenten losschicken; tote Einträge lassen sich gezielt verwerfen (W1-05b). |
| M2 | Überblick und Setup | Du fragst Claude „Was heißt das?“ und bekommst eine einfache Antwort. Ein Skript schreibt Status und Tagesbericht. Ein Plan, zehn Regeln, gestufte Reviews. Ein roter `main` hält die Queue an. Limits und RAM werden vor jedem Worker-Start geprüft. Backup läuft. |
| M3 | App im Alltag + Zwischenrelease v1.5.0 (Beta) | Du installierst v1.5.0 (Beta) über den Updater. In der installierten App gibst du drei echte kleine Aufgaben an Agenten, verfolgst sie im HQ, prüfst den Diff in der App, und der PR landet über die Queue. Das HQ ist hell und dunkel lesbar (Screenshots angesehen, auch die DF-07-Dichte). |
| M4 | Dauerbetrieb abgenommen, v1.5.1 | Du schaltest den Continuous Mode selbst ein. Ein Not-Aus stoppt alles in 10 Sekunden. Alle 27 Zeilen der Abnahmematrix haben einen Beleg oder ein Nutzer-Gate. Update-Drills sind am PC durchgespielt. Du installierst v1.5.1. |
| M5 | Aufräumen und erste Tester (nach v1.5.1) | 3–5 externe Tester haben v1.5.1 benutzt, ihre Rückmeldungen sind festgehalten. Die Architektur-Befunde sind abgearbeitet, `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI. Die vier Nahtstellen sind kleiner als bei v1.5.0. ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt. |

Lane-Schlüssel: `st` store.rs + store/ · `api` api.rs · `mn` main.rs · `pa`
bin/pa.rs (diese vier sind Nahtstellen, je ein aktives Paket) · `pty` pty.rs ·
`wk` workers.rs/profiles.rs · `sup` supervisor.rs · `ci` .github/ + scripts/ci/ ·
`hqL` Legacy-HQ (hq.js, hq.css, hq-parse.mjs, hq-live.mjs) · `hqS`
docs/dev-hq/concepts/ · `fe` src/ · `fR` nahtstellenfreies Rust · `doc` Doku und
scripts/dev · `N` Nutzer/PC. Welches Modell welches Paket nimmt:
`docs/setup/providers.md`. Stand-Spalte: `✓ #n` = gemergt, sonst offener PR
oder „offen“ (Momentaufnahme; den Live-Stand liefert OPS-01). **`alt-#n`** ist
eine Nummer aus der Zählung vor dem öffentlichen Import; sie ist nicht prüfbar und
kollidiert mit heutigen PRs (Beispiel: alt-#124 in W2-01b, heute #124 = W5-04c).
Nummern ohne Präfix in den Zeilen ab alt-#128 abwärts sind nicht einzeln nachgeprüft.

### M1 — Alles Laufende gelandet, App startbar ✓ erreicht

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W2-03 | Usage-/Billing-Collectors je Adapter | M | st | ✓ alt-#140 |
| W2-06 | Supervisor: Producer-Audit und Runtime-Notifications | M | mn + sup | ✓ alt-#152 |
| W2-08a | Ressourcendruck- und Streaming-Enforcement | M | fR | ✓ alt-#134 |
| W2-04f | Planungsendpunkte nur für den Koordinator | S | api | ✓ alt-#135 |
| W2-01b | Review-Route nimmt `reviewerRunId` aus dem Credential | S | api | ✓ alt-#124 |
| W2-01c | `approvalAuthority` in agent_access.rs angleichen | S | fR | ✓ alt-#150 |
| W1-15c | Übrige Mutex-Stellen in pty.rs | S | pty | ✓ alt-#137 |
| W1-23c | „-0 Tokens“-Anzeige, MSRV gemessen | S | fR | ✓ alt-#136 |
| W1-29 | Linux-Flake im Prozessgruppen-Test | S | fR | ✓ alt-#138 |
| W1-21c | xterm-`pageerror` beim Mount | S | fe | ✓ alt-#151 |
| SETUP-04 | AGENTS.md: Mergify, Reviews, Build-Slots | M | doc | ✓ alt-#132 |
| HOOK-01 | Hook-ROOT-Fix einzeln vor CI-02 (Nutzer 25.09.) | S | ci | ✓ alt-#156 |
| W1-05b | Sichere Cancel-Regel für `dispatched`, Dedup der toten Tasks; erst st-Kind, dann api-Kind; Zahl der toten Einträge read-only nachzählen | M | st → api | ✓ #19, README-Nachzug #498 |
| W1-03e | `MSG_USER` erst nach bewiesener Zustellung (F-CORE-3 B.3) | S | wk | ✓ alt-#171 |
| W1-20 | Zweites Setup reproduzieren (Node 24, `npm ci`, `dev:setup`, `dev:doctor`) | S | N | ✓ alt-#166 |
| CI-02 | Leichter main-Push, Docs-only, Dependabot im red-first (enthält W1-19b) | S | ci | ✓ alt-#133 |
| CI-03 | Actions-Kosten senken: CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf, Budgetstopp ab 80 % | M | ci | ✓ alt-#149 |
| SETUP-08 | Git-/PR- und Plan-Helfer unter `scripts/dev` (08a + 08b) | M | doc | ✓ #22 |
| SEC-01 | Geheimnis-Scan (gitleaks) als precommit-Gate | S | ci | ✓ #20 |

### M2 — Überblick und Setup

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M2-FRAG | Frag-mich-Skill für Einsteiger-Erklärungen | S | doc | ✓ alt-#161 |
| PLAN-01 | Ein Plan, zehn Regeln, gestufte Reviews, PR-Text ist der Bericht, Archiv | M | doc | ✓ #26 |
| PLAN-SYNC | Gemergte Pakete seit 25.09.2026 und M1-Status im Plan nachführen | S | doc | ✓ #45 |
| OPS-01 | Status und Tagesbericht per Skript aus GitHub und git (was läuft, was fertig ist, was du entscheidest) | M | doc | ✓ alt-#164 |
| OPS-02 | Startcheck vor jedem Worker: Modell beobachtet, Limit, freier RAM, laufende Cargo-Builds; harte Stopps | S | doc | ✓ #35, Doku-Nachzug #270 |
| CI-04 | Roter `main` stoppt die Queue: Issue mit Run-ID, Label, Queue-Pause | S | ci | ✓ #28 |
| W1-21d | Suchschalter im Scrollback (Groß-/Kleinschreibung, Regex) | S | fe | ✓ #27 |
| W1-30 | Flake `omniroute::…management_failures_keep_their_http_and_network_classes` (100-ms-Timeout) | S | fR | ✓ #32 |
| CLEAN-01 | Toten Code löschen: npm `@tauri-apps/plugin-process`, drei ungenutzte TS-Funktionen und Exporte (Prüfung B, S6) | S | fe | ✓ #31 |
| CLEAN-02 | Stillgelegten Queen-Anlegepfad löschen (Trait-Methode in api.rs, Umsetzung in main.rs, drei Funktionen in workers.rs) | S | api → mn → wk | ✓ #25 |
| W1-17 | HQ-Parser: prüfen, ob OPS-01 oder DF-06a ihn überholt haben; sonst auf die Meilenstein-Tabellen umstellen. Bis dahin zeigt der eingecheckte HQ-Snapshot (`docs/dev-hq/data.js`/`data.json`) die alten F-Meilensteine als „waiting“ — bekannter Zwischenstand, kein Datenfehler | S | hqL | ✓ #38, Folgefix #274 |
| SETUP-09 | Lokaler Review-Lauf `scripts/review/run-local.sh` | S | doc | ✓ #39, Folgefix #273 |
| SETUP-12 | Rest des Docs-only-Pfadfilters, soweit CI-02/CI-03 ihn nicht abdecken | S | ci | ✓ #36, Rest #282 |
| SETUP-14 | Nutzer: tote Keys, OpenCode-Modelle, `ollama signin`, Permission-Regeln | S | N | teilweise: `ollama signin` und OpenCode-Modelle geprüft (02.10.); offen: tote Keys, Permission-Regeln |
| SETUP-15 | Abschlussreview der Setup-Doku, verkleinert | S | doc | ✓ #51, Folgekorrektur #275 |

PC-Setup außerhalb des Repos (Orchestrator, Nutzerentscheidungen 25.09.):
Backup mit Kopia nach Google Drive, TypeScript-Sprachserver und PowerShell-Profil,
Statuszeile mit Limits, Lernpfad in Häppchen, ruflo/oh-my-claudecode aus,
Gedächtnis = eingebautes Claude-Gedächtnis plus memorix.

### M3 — App im Alltag + Zwischenrelease v1.5.0 (Beta)

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| HQ2-02 | Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest | M | hqS + N | ✓ entschieden (Nutzer 04.10., E1: Mix) |
| HQ2-03 | Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02 | M | hqS | ✓ #311 |
| W1-10 | HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, `prefers-contrast` | M | hqL | ✓ #33 |
| M3-01 | Drei deutschsprachige Aufgaben-Vorlagen mit eingebautem Abnahmekriterium (nur Doku) | S | doc | ✓ #144 |
| W2-10 | Live-HQ-Views (vor Dispatch teilen: 10a Ziele/Teams, 10b Routing/Budget, 10c Review/Delivery) | M | hqL | 10a ✓ #13, 10b ✓ #21, 10c ✓ #62 |
| W5-02b7 | HQ-Profilansicht zeigt `envPolicy` | S | hqL | ✓ #58 |
| W5-02a | Koordinator ohne Schreibpfad | M | wk | ✓ #24 |
| W5-22 | Konfliktvorhersage und Lane-Guard | M | fR | ✓ #9 |
| W5-28 | Automatischer Laufzeitbeleg (Sandbox, Queue aus) | M | fR | ✓ #11 |
| W5-00b | Fremden Text in workers.rs-Prompts suchen und einhüllen | S | wk | ✓ #18 |
| W2-04e | `dispatch.role` ins Agenten-Briefing | S | wk | ✓ #50 |
| W2-01d | CLI-Befehl `pa hq agent review` | S | pa | ✓ #46 |
| W1-18b | Probe, ob Codex/OpenCode `.agents/skills` lesen | S | wk + N | OpenCode ✓ #30, Codex △ headless-Probe 02.10.2026 (Doku #60): `projecta-workflow` gemeldet, direkte Dateisystemabfrage durch Read-only-Policy blockiert |
| W1-01b | Kimi-Re-Smoke mit `PROJECTA_PTY_TRACE_DIR` | S | pty | gestrichen (Nutzer 04.10.: Kimi-Abo abgelaufen; Smoke ✓ #192) |
| W1-27 | KI-20, doppelte `ESC[6n`-Antwort; welche Seite antwortet, entscheidet der Advisor (Nutzer 25.09.) | S | pty + fe | ✓ #140 (ersetzt das geschlossene #112; gemergt 03.10.) |
| W3-08 | Paketierter HQ-v1-Beleg | S | N | ✓ #381; Drill 8 PASS am 05.10. (Beleg: Datum aus `events.log`, lokal) |
| ARCH-11 | KI-24b auf Windows reproduzieren, Test-DB-Wettlauf absichern (siehe Tabelle Architektur-Pakete) | S | fR + N | Verschoben nach Z4-ARCH-11; früher: angenommener M3-Kandidat (Nutzer 04.10., F6), Windows-Lauf am PC des Nutzers erlaubt; verwandt #1463 (`13ef8a41`), #1468 (`4f74b8f8`); Abschluss: Unbekannt (zu prüfen) |
| R-1 | Zwischenrelease v1.5.0 (Beta) als Abschluss von M3; Tag und Veröffentlichung darf der Orchestrator selbst, sobald alle Gates und die 27 Matrixzeilen in der Fassung vom 04.10. belegt sind (Nutzer 04.10.) | S | N + doc | ✓ v1.5.0 (05.10.) |

**R-1 Voraussetzungen (Stand 05.10.):** Der Tag `v1.5.0` (Beta; E24: A) setzt voraus:

- W3-02 vollständig, einschließlich W3-02f bis W3-02i. Die vier Release-Blocker sind W3-02g (Journal-Erzeuger), W3-02h (Bytes und Version ans Journal, #411-Befund C1), W3-02j (Handshake-Identität nach dem Update) und W3-02i (Wartungs-Lease, #411-Befund C2). W3-02j, weil nach jedem echten Update die App heute nicht mehr startet: die Startprüfung vergleicht den Hash der laufenden exe mit dem Hash des Update-Pakets, dazu den Datenbank-Snapshot-Hash mit der Live-Datenbank (Befund aus PR #457 und Berater Fable 5.1, 05.10.).
- Die PC-Drills 1-6 und 8 aus W3-03 (paketierte Drills) sowie der Beleg W3-08 (paketierter HQ-v1-Beleg). Sie laufen auf einem lokal signierten Installer: `node scripts/build-signed-windows.mjs` (`scripts/build-signed-windows.mjs:12` verlangt `TAURI_SIGNING_PRIVATE_KEY`, `:22-24` einen sauberen Checkout). Der Signierschlüssel steht nur in der eigenen PowerShell-Sitzung des Nutzers, vorher Backup, Installation über v1.4.1 (E25: A).
- Alle Gates und die 27 Matrixzeilen (Fassung vom 04.10.).

**Abnahme der Beta (nach dem Tag, E25: A):** Der Updater-Drill (W3-03e) und W3-07 (Produktionsschlüssel-Build, Signed-Updater-Relaunch) sind keine Voraussetzung des Tags mehr, denn sie brauchen ein echtes veröffentlichtes Update (fester Endpoint `src-tauri/tauri.conf.json:54-56`). Sie gehören zur Abnahme der Beta: Der Nutzer aktualisiert v1.4.1 bzw. v1.5.0 über den Updater. Reihenfolge der Updater-Fälle: `cancel`, `fail`, `success`.

**Versionsnamen (E24: A, 05.10.):** Die Beta trägt den Tag `v1.5.0`, das Endrelease ist `v1.5.1`, weil die Release-Pipeline nur x.y.z annimmt (`scripts/verify-windows-package.ps1:5`, `scripts/release.cmd:16`). In den Entscheidungszeilen und Notizen vom 04.10. meint „v1.5.0“ noch das Endrelease; gelesen als v1.5.1.

### M4 — Dauerbetrieb abgenommen, v1.5.1

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| W5-05 | Prüfpfad (append-only, Trigger gegen UPDATE/DELETE) | S | st | ✓ #44 |
| W5-04a | Not-Aus im Store, **global ohne Projektrahmen** (Schnitt 25.09., W5-01a bleibt geparkt) | S | st | ✓ #69 |
| W5-04b | Not-Aus in der App (10 s Frist) | S | mn | ✓ #125 (Backend W5-04d ✓ #157, Release-Auth W5-04e ✓ #158) |
| W5-04c | Not-Aus in `pa` | S | pa | ✓ #124 |
| W2-02b | Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle (Rest „Merge-Ergebnis als Kandidat“ siehe „Später“) | M | st | Gleichstand ✓ #82, Testquelle ✓ #122; Rest „Merge-Ergebnis als Kandidat“ auf später verschoben (Nutzer 04.10.) |
| W2-04c | Rollenbewusste Routen und Credentials beim Launch | M | st | ✓ #222 (Teil 2, gemergt 03.10.); Teil 1 ✓ #178 (ersetzt #147; gemergt 03.10.) |
| W2-04d | Rollen auf Budget-Zwecke abbilden | S | st | ✓ #15 |
| W2-04g | Optional: Versionsspalte für die Attestierungsregel | S | st | gestrichen (Nutzer 04.10.) |
| DF-15b | Reservierung und Delivery bei `exited_undelivered` freigeben (KI-27; Nutzer 25.09.: ja) | S | st | ✓ #16 |
| W2-07b | Windows-ACL für `projecta-api.json` und `agent-access/` | S | api | ✓ #12 |
| W2-08b | Speicher-/CPU-Grenzen je Job (Nutzer 25.09.: ja); Stillstand früh erkennen (Denk- und Fortschrittszeichen prüfen, sonst nach 15 min) | M | fR | ✓ #53 |
| W2-09b | DeepSeek-V4-Flash-Worker über OpenCode | M | wk | ✓ #78 |
| HQ2-05b | Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt; echte Proben mit Claude/Codex/OpenCode dürfen Abo-Kontingent verbrauchen (Nutzer 04.10.) | M | fR + N | ✓ #289, #299, #318, #341 (p1–p4) |
| W5-02b3 | Env-Stufe als globale Einstellung (st → api → fe); Produktfrage entschieden (Nutzer 04.10.): die globale Stufe ersetzt die Isolation je Profil für gewöhnliche Agenten, Koordinatoren bleiben immer `strict`, profilspezifisches `passthrough` bleibt | M | st → api → fe | ✓ #336, #438, #442 (st → api → fe) |
| W5-02b4 | Push aus dem Worker über den Runner-Host, danach `strict` als Voreinstellung | M | pty + wk | ✓ #65 |
| W5-02b5 | Test für den `http.extraHeader`-Reset; GPG unter `strict` | S | fR | ✓ #17 |
| W1-03f | F-CORE-3 Baustein C: Zustell-Queue, `pa worker done/blocked` (braucht das Z-1-Protokoll am PC) | M | wk + pa | Teilpakete gemergt (#301 W1-03f-a, #337 W1-03f-api, #352 W1-03f-b); Rest (Produktionsadapter) in Z4-W103F-WIRE: Unbekannt (zu prüfen) |
| W3-01 | Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind) | M | st → mn | ✓ #285, #335, #402 |
| W3-02 | Windows-Recovery-Helper | M | fR + N | ✓ (Teilpakete W3-02a bis W3-02k gemergt, zuletzt #475) |
| W3-02a | Journal-Treiber, eine Aktion je Schritt | S | fR | ✓ #291 |
| W3-02b | Staged-Update-Identitäten binden | S | fR | ✓ #321 |
| W3-02c | Datenbank-Wiederherstellung ans Journal binden | S | fR | ✓ #357 |
| W3-02d | Installer-Adapter (Exit-/UAC-/Sharing-Klassifikation, kein Retry) | S | fR | ✓ #348 |
| W3-02e | Installation nur über das Wiederherstellungs-Journal | S | fR | ✓ #411 (gemergt 05.10.; Befunde C1/C2 zurückgestellt, siehe W3-02h/i) |
| W3-02f | Wiederherstellung beim Start | M | fR | ✓ #425 |
| W3-02g | Release-Blocker R-1 (Beta): Journal-Erzeuger. `update-recovery.json` legt heute nichts an, daher lehnt das Selbst-Update in der App immer ab (offener Punkt aus #411). Stufe A | M | mn | ✓ #446 |
| W3-02h | Release-Blocker R-1 (Beta): #411-Befund C1, die installierten Bytes und die Version an das Journal binden (`signed_artifact_sha256`, `candidate_version`; heute verwirft `InstallOnly` beide). Stufe A | M | mn | ✓ #457 |
| W3-02j | Release-Blocker R-1 (Beta): Handshake-Identität nach dem Update. Die Startprüfung muss die laufende exe und die Live-Datenbank nach einem echten Update als Erbe des Journals anerkennen (Vertrauen beim ersten Start, siehe `docs/decisions.md`), sonst blockiert `IdentityMismatch` den Start. Befund aus #457. Stufe A | M | mn | ✓ #462 |
| W3-02i | Release-Blocker R-1 (Beta): #411-Befund C2, Wartungs-Lease statt Momentaufnahme von `is_maintenance_active()`; berührt auch `store.rs` (Naht, nur seriell). Stufe A | M | mn | ✓ #471 |
| W3-03 | Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S) | S | N | ✓ Drill-Kits #364, #376, #379, #382, #377, #380, #384 gemergt; die Läufe am PC stehen laut R-1-Voraussetzungen noch aus |
| W3-04 | Updater-Zustände in App und HQ | S | fe + hqL | ✓ #119 |
| W3-07 | Produktionsschlüssel-Build + Signed-Updater-Relaunch; der bestehende Schlüssel bleibt (E4) | S | N | offen; Client-Relaunch-Beleg fehlt (siehe Z4-W307-PC-UPDATE) |
| W4-01 | Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.) | M | fR | ✓ #73 |
| W4-02 | Abnahmematrix final (27 Zeilen) | S | doc | ✓ #48 |
| W4-03 | Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers; der Schalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); einschalten tut der Nutzer selbst am Ende (Zeile 2) (Nutzer 04.10., E5) | S | mn | ✓ #481 |
| W4-04 | Release v1.5.1 (Endrelease) | S | N | ✓ v1.5.1 (06.10.) |
| M4-R7-01 | Scheduler-`dispatch_once` hinter einem Nur-Test-Permit (Matrixzeile 7) | S | wk | ✓ #340 |
| M4-R7-02 | Negative Fake-Adapter-Matrix (Matrixzeile 7): Tests, die Starts ohne akzeptierte Gates ablehnen, plus Matrixzeilen 5 und 9: zwei gleichzeitige `dispatch_once` auf eine Aufgabe starten genau einen Worker, der veraltete Schreiber wird abgewiesen; Abhängigkeiten erfüllt/offen/fehlend/projektfremd/65 Einträge -> genau ein Start nur im erfüllten Fall | S | wk | ✓ #412 (ersetzt #407) |
| M4-ROW15-PROOF | HTTP-Beleg Zeile 15 (eingeengt): Bindung/Idempotenz Kandidat und Evidenz, Lesen nur im eigenen Run, fremde/stale Evidenz abgewiesen, veränderte Root-Policy ändert `policy_json` nicht und meldet fail-closed | S | api-Tests | ✓ #360 |
| M4-ROW17-PROOF | HTTP-Beleg Zeile 17 (eingeengt): Kandidat-Delta macht Evidenz und Reviews sichtbar ungültig, auch nach Neustart; Freigabe bleibt per Schema unmöglich | S | api-Tests | ✓ #374 |
| M4-E2E-14 | Echter HTTP-Router + Store + Fake-Agentenprozess: Checkpoint -> Abbruch -> Fortsetzen (Zeile 14) | S | api | ✓ #365 |
| M4-R19-01 | Typisierter Audit-Envelope: Einträge ohne project/run/result/sourceRef werden abgewiesen (Matrixzeile 19) | S | st | ✓ #358 |
| M4-R19-05 | Vollständige Audit-Envelopes für Delivery-Start/-Enqueue und W1-03f done/blocked mit Erfolg und Ablehnung (Matrixzeile 19) | S | st | ✓ #408 |
| M4-R19-06 | Vollständige Audit-Envelopes für Not-Aus an/aus und Barrier-/Store-Fehler (Matrixzeile 19) | S | st | ✓ #423 |
| M4-R19-08 | Vollständige Audit-Envelopes für Planungs-Autorisierungsablehnungen und Planungs-Schreibvorgänge (Matrixzeile 19) | S | api | ✓ #444 |
| M4-R27-01 | Readiness für App-Release und Continuous-Release getrennt ausweisen (E20) | S | scripts | ✓ #372 |
| M4-R27-02 | Release-Attestierung für den App-Release prüfen, ohne Continuous freizugeben (E20) | S | scripts | ✓ #398 |
| M4-R27-03 | Matrixzeilen 18 und 27 an den menschlich kontrollierten App-Release-Pfad anpassen (E20) | S | doc | ✓ #413 |
| M4-R27-04 | Store-Test: Continuous-Integrationsstufe wird bei `approval_eligible = 0` abgewiesen | S | st | ✓ #448 |

### M5 — Aufräumen und erste Tester (nach v1.5.1)

Nutzerentscheidung 04.10. (Empfehlungen des Orchestrators angenommen). Abnahme in
Alltagssprache:

- 3–5 externe Tester haben v1.5.1 benutzt und ihre Rückmeldungen sind festgehalten.
- Die Architektur-Befunde (Pakete ARCH-D*/STATE-* aus der Drift-Karte und dem
  Zustands-Audit; die STATE-Zeilen kommen dazu, sobald sie existieren) sind
  abgearbeitet.
- `docs/architecture-rules.md` gibt es und ein Drift-Gate läuft in der CI.
- Die vier Nahtstellen sind kleiner als bei v1.5.1 (Zeilen messen und vergleichen).
- ProjectA ersetzt die externen Orchestrierungs-Skripte Schritt für Schritt
  (Dogfooding, laut Vision).

Die ARCH-D-Pakete ändern kein Verhalten. Sie laufen erst nach v1.5.1, weil sie die
seriellen Nahtstellen des Release-Wegs belegen; jedes nutzt den Prompt „ProjectA
refactoring package“.

| ID | Paket | Gr. | Lane | Stand |
|---|---|---|---|---|
| M5-01 | Testerrunde mit 3–5 externen Testern (N = Zahl noch offen) | S | N | offen, nach v1.5.1 |
| M5-02 | Produktfokus als Aussage im README: „sicherer Dauerbetrieb für KI-Agenten: Not-Aus, Kostenkontrolle, Protokoll“ | S | doc | ✓ #576 |
| M5-03 | ARCH-G1 Regeldokument `docs/architecture-rules.md` + ARCH-G2 Drift-Gate in der CI | M | ci + doc | ✓ G1 #316, G2 #304 (04.10.) |
| M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um (Umfang später festlegen) | M | später | offen, nach v1.5.1 |
| ARCH-D1 | Vier HTTP-Fehlertext-Klassifizierer zu einem | S | api | ✓ #596, Rest #663 |
| ARCH-D2 | Projektanlage ist in `main.rs` doppelt umgesetzt | S | mn | ✓ #664 |
| ARCH-D3 | Elf direkte `BEGIN IMMEDIATE` zu einem Store-Helfer | M | st | ✓ #577, #587 |
| ARCH-D4 | Restlicher API-Router mit 51 Zweigen: kleinere serielle Teil-PRs, insgesamt ≥ 300 Zeilen Netto-Abbau in `api.rs`; je PR ≤ 300 Gesamtdiffzeilen einschließlich Tests (ARCH-D4-PLAN) | M | api | ✓ #623, #625, #627, #629, #631 (Vertrag #621) |
| ARCH-D5 | Diagnose- und Einstellungsbefehle aus dem Befehls-Monolithen in `main.rs` herauslösen | M | mn | ✓ #704, #728 |
| ARCH-D6 | `pa::run` vermischt Verteilung und Darstellung | M | pa | ✓ #579, #589 |
| ARCH-D7 | Einstellungs-Speicherung in ein Untermodul unter `store/` | M | st | ✓ #632 |
| ARCH-D8 | Ereignisnamen als gemeinsame Konstanten in Rust und TypeScript | M | mn → pty → fe | ✓ #960 (V16-ARCH-D8a–c) |
| M4-R19-02 | Vollständige Audit-Envelopes für die Pfade Ziel/Task (Matrixzeile 19); zugeschnitten in 02a #702 und 02b/03a #705, #698 Referenz | S | st | Erledigt: #702/#705/#717 gemergt; R19-Reste separat |
| M4-R19-03 | Vollständige Audit-Envelopes für die Pfade Claim/Checkpoint (Matrixzeile 19); 03a bereits im #705-Zuschnitt, vorhandene Envelopes wiederverwenden, Restumfang vor Dispatch prüfen | S | st | ✓ #705 (03a), #956 (03b, `2e1de0bb`, 10.10.) |
| M4-R19-04 | Vollständige Audit-Envelopes für die Pfade Intent/Launch (Matrixzeile 19) | S | st | Verschoben nach v1.6.0 |
| M4-R19-07 | Vollständige Audit-Envelopes für die Pfade Kandidat/Evidence/Review (Matrixzeile 19) | S | st | Verschoben nach v1.6.0 |
| M4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19) | S | mn | Verschoben nach v1.6.0 |

### Reihenfolge der seriellen Lanes (nach Meilensteinen)
[Originaltext][historie]

## Regeln für diesen Plan (historisch, M1–M5; geltende Regeln: AGENTS.md und „Statuswerte“ oben)
[Originaltext](archive/plan-2026-10/history.md#regeln-für-diesen-plan-historisch-m1m5-geltende-regeln-agentsmd-und-statuswerte-oben)

## Vision (Nutzer 25.09., historisch)
[Originaltext][historie]

## Gestrichen/Geparkt (25.09.)

**Nicht disponierendes Vertragsregister:** Originalstatus und Abhängigkeiten bleiben erhalten; geplant/geparkt ist nicht erledigt. Ergebnis, Abnahme, Owner und Grenzen gelten über die direkten Vollverträge weiter. Noch unbenannte Owner bleiben unbenannt; Chief disponiert, Root nimmt ab.

[Vollständiger gemischter Bestand](archive/plan-2026-10/contracts-2026-10-24.md#parked): gestrichene/geparkte W5/DEVFLOW/HQ2, sämtliche „Später“-Vorschläge einschließlich sicherem Aktionsmuster, Werkbank und Nachbeobachtung bleiben in ihrer bisherigen Disposition. Keine Aktivierung oder neue Installation.

[Werkbank je Projekt und Bewährte Wege (E1–E4)](decisions.md#2026-10-11---werkbank-je-projekt-und-bewährte-wege-e1e4) bleibt als geparkter Vertrag gebunden: V2-WEG/TRES/CMD/SKL/DB gemäß [Vollvertrag](plan/v2.0/werkbank.md) und [Originalumfang](archive/plan-2026-10/contracts-2026-10-24.md#parked). Wege-Pilot ohne App-Code bei DEV-KNOW-01; Tresor vor V2-B6a-2/V2-B19, Rest nach v2.0 hinter Schaltern, außerhalb M1–M4. Konfiguration statt Training, eigene DB nur lesend und E4 größere Glass-Entwürfe bleiben Kriterien des Beschlusses; Owner-/Abnahmebindung und weitere Grenzen des Registers gelten weiter, kein neuer Dispatch.

#### LUMIO — Rückfragen und Freigaben ohne Fensterwechsel (Nutzer 18.10.2026)

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| LUMIO-0 | [Recherche und Vertrag](archive/plan-2026-10/contracts-2026-10-24.md#parked) | DS-H-07 (Urteil des Nutzers über die Probe-Halle) | C | Geplant: nicht disponiert (18.10.) |
| LUMIO-1 | [Rückfrage in der Halle](archive/plan-2026-10/contracts-2026-10-24.md#parked) | LUMIO-0, DS-H-06, DS-H-07 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-2 | Antwortkarte: Frage, nummerierte Optionen mit Kurzbeschreibung, „Andere …“ als Freitext; Zahlentasten 1–9 wählen, Enter sendet, Escape schließt, „Im Terminal öffnen“ als Ausweg; voll per Tastatur und Screenreader bedienbar; Texte über `src/i18n/de.ts` | LUMIO-0; Popover DS-X-26 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-3 | Befehlsfreigabe in der Antwortkarte: Befehl wörtlich, Arbeitsordner, Agent; „Erlauben“/„Ablehnen“ nur ausdrücklich, keine Vorauswahl; Weitergabe an den Agenten nur über seinen eigenen Freigabeweg | LUMIO-2 | A (Sicherheit, PTY) | Geplant: nicht disponiert (18.10.) |
| LUMIO-4 | [Melden ohne Fensterwechsel unter Windows](archive/plan-2026-10/contracts-2026-10-24.md#parked) | LUMIO-2; Tauri-Plugin `notification` (Zeile oben) | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-5 | Zähler in Halle und Kopf: „Arbeiten · Ruhen · Braucht dich · Unbekannt“ aus beobachteten Zuständen, jede Zahl führt zur gefilterten Liste | LUMIO-0, DS-H-05 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-6 | Ruhezone in der Halle: Untätige Agenten sitzen in einer Ruhe-Ecke statt an ihrer Station, damit „arbeitet“ und „ruht“ auf einen Blick verschieden aussehen; neue Kacheln als Code (E-2) | DS-H-07; DS-H-02b | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-7 | Wartezeit statt Countdown: Antwortkarte und Liste zeigen „wartet seit …“ und sortieren danach; keine automatische Antwort, kein stiller Ablauf | LUMIO-2 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-8 | Laufliste kompakt: eine Zeile je Agent mit Aufgabe, Agent, Anbieter, Tätigkeit in Worten, Kontextbalken, Laufzeit; „Braucht dich“ zuerst, dann nach Wartezeit; Klick öffnet Antwortkarte oder Terminal; dieselben Daten wie Halle und Zähler (eine Quelle) | LUMIO-0, LUMIO-5 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-9 | Kontext-Füllstand je Agent: Balken nur aus beobachteten Zahlen des Anbieters; ab 80 % Warnfarbe plus Text „bald übergeben“, nie nur Farbe; keine automatische Aktion | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-10 | [Tätigkeit in Worten](archive/plan-2026-10/contracts-2026-10-24.md#parked) | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-11 | Erinnerung statt Vergessen: wartet eine Freigabe oder Frage länger als eine einstellbare Zeit (Vorschlag 5 min), einmal eine Windows-Benachrichtigung; keine Wiederholungsflut, keine automatische Antwort | LUMIO-4, LUMIO-7 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-12 | Schnellblick per Tastenkürzel: ein globales Kürzel (Tauri-Plugin `global-shortcut`, Nutzerentscheid über die Taste) zeigt Halle und Laufliste als schwebende Übersicht und schließt mit Escape; kein Fokusdiebstahl ohne Tastendruck | LUMIO-8; Plugin-Installation braucht ein Nutzer-Ja | B | Geplant: nicht disponiert (18.10.) |
#### AGENT-WERKZEUGE — Werkzeuge für weniger Tokens und besseren Kontext (Nutzer 18.10.2026)

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| AGENT-TOOLS-1 | [RTK messen](archive/plan-2026-10/contracts-2026-10-24.md#parked) | Nutzer-Ja zur Installation auf dem Server (Server-Änderung außerhalb der Jobqueue) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-2 | [Repomix für den kostenlosen Review-Weg prüfen](archive/plan-2026-10/contracts-2026-10-24.md#parked) | Nutzer-Ja zur Nutzung (neue Abhängigkeit oder `npx`-Download) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-3 | Eigene Log-Kürzung für Worker-Berichte nach dem Headroom-Prinzip: lange Gate-Ausgaben gekürzt zeigen, Original immer als Datei verlinkt, Exit-Code und erste Fehlzeile immer oben; ohne Proxy, ohne neue Abhängigkeit | AGENT-TOOLS-1 (Ergebnis) | B | Geplant: nicht disponiert (18.10.) |
#### v2 — VERBUND / DevHQ und Denkraum (Beschluss 15.10.2026)

| ID | Ziel | Abhängigkeit / Status |
|---|---|---|
| V-01 | Quellen- und Befugnisvertrag | Erledigt: DOC-SYNC-2 / #1557 (merged 2026-10-15T15:12:57Z, `3853bbbe`); Stufe C |
| V-02 | Begrenzte lesende Denkraum-Projektion | Geplant nach V-01; Stufe A, kein Schreibpfad |
| V-03 | Nativer Leseadapter | Geplant nach V-02; Stufe A, `main.rs` seriell, Hostweg belegen |
| DN-01 | Kanonisches Designsystem-CSS bündeln | Erledigt: #1549 gemergt; `gh pr view 1549 --json state`, 15.10.2026 |
| DN-02 | Gemeinsame Spur-/Kugel-Bausteine | Geplant, als Nächstes nach DN-01 |
| DN-03 | Denkraum-Hülle und Jetzt im Designsystem | Geplant nach DN-02 |
| DN-04 | Fragenliste, Details und Bestätigung | Geplant nach DN-03 |
| DN-05 | Ideenerfassung, Liste und Details | Geplant nach DN-04; Entwürfe und Verlauf erhalten |
| DN-06 | Werkbank und Geplant gestalten | Geplant nach DN-05; fehlendes Speichern ehrlich anzeigen |
| DN-07 | Belege in Stationsanzeige übersetzen | Geplant nach DN-06 und V-01; unbekannt bleibt unbekannt |
| DN-08 | Zugängliche Spur-/Listenansicht | Geplant nach DN-07; Auswahl beim Aktualisieren erhalten |
| IDEEN-HANDY-1 | Ideen vom Handy erfassen | Geplant, scope TBD; vor jeder Denkraum-Ablösung |
#### PLAN-AUTO / ROADMAP (Auftrag 15.10.2026)

| ID | Ziel | Abhängigkeit | Status |
|---|---|---|---|
| PLAN-AUTO-1 | PLAN-Modell + `npm run plan:check` (Befunde: PR ohne Planzeile, Status widerspricht GitHub, unbekannte Abhängigkeit, Job ohne Zeile, Entscheidung ohne Zeile, Plan veraltet) | – | Erledigt: #1564 (merged 2026-10-15T16:44:07Z, `244c4775`); Planzeilen #1570 (merged 2026-10-15T16:07:25Z, `d1def61a`); Nachläufer → PLAN-AUTO-1b |
| PLAN-AUTO-1b | [Nachläufer zu PLAN-AUTO-1 und ROADMAP-1a, geteilt in 1b-a](archive/plan-2026-10/contracts-2026-10-24.md#parked) | PLAN-AUTO-1, ROADMAP-1a | Erledigt: 1b-a mit #1594 (merged 2026-10-16T00:59:37Z, `e21710de`) und 1b-c mit #1598 (merged 2026-10-16T02:11:54Z, `c8b613ea`); der Rest steht in PLAN-AUTO-1b-b |
| AGENTS-PLAN-REVIEW | Reviews prüfen, ob `docs/PLAN.md` aktuell ist: Paketzeile per `Plan-ID:`, übrige Zeilen, „Für den Nutzer“ und Entscheidungs-Inbox gegen `gh`; Abweichungen vor `review-ok` im selben PR korrigieren | PLAN-AUTO-1 | Erledigt: #1588 (merged 2026-10-15T19:54:21Z, `c7a43fbd`); Stufe C |
| PLAN-AUTO-1b-c | Roadmap-Nachläufer: R1580-B1–B4/C1 und REFS-07 | PLAN-AUTO-1 | Erledigt mit Merge von PR #1598; Alias-Teil #1594 (PLAN-AUTO-1b-a) bleibt separat |
| PLAN-AUTO-1b-b | Bekannte Grenzen aus #1564, vor jeder `--strict`- oder Gate-Nutzung zu beheben (PLAN-GATE wartet darauf) | PLAN-AUTO-1 | Geplant: nicht disponiert (16.10.) |
| PLAN-AUTO-2 | [Statusabgleich mit `npm run plan:sync`](archive/plan-2026-10/contracts-2026-10-24.md#parked) | PLAN-AUTO-1 | Erledigt: #1711 (merged 2026-10-20); ursprünglich: In Prüfung: Branch `codex/plan-auto-2`, Stufe B; nach Merge sind Skript, Offline-Regressionstests und Ablauf dokumentiert; kein automatischer Commit oder Push |
| PLAN-AUTO-3 | Status-Abgleich als Skript statt LLM: stündlich, Docs-PR, automatisch eingereiht | PLAN-AUTO-1 | geplant |
| PLAN-NORM-n | Pakettabellen auf feste Spalten (ID, Ziel, Richtung, Version, Abhängigkeit, Status, Owner), je ≤300 Zeilen | PLAN-AUTO-1 | geplant |
| PLAN-CLEAN-1 | Plan bereinigen, Schnitt 1: Status gegen GitHub, „Für den Nutzer“, Entscheidungs-Inbox, fehlende Zeilen und gemergte Arbeit ohne frühere Planzeile; übernimmt die gültigen Inhalte von #1586 und #1587 | PLAN-AUTO-1 | Erledigt: #1591 (merged 2026-10-15T23:52:32Z, `23d0c91e`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-2 | Plan bereinigen, Schnitt 2: v2.0- und v1.6.0-Unterplan und `STAND.md` abgleichen | PLAN-CLEAN-1 | Erledigt: #1592 (merged 2026-10-16T00:04:20Z, `a3b61066`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-3 | Plan bereinigen, Schnitt 3: historische Abschnitte von `docs/PLAN.md` kennzeichnen, tote Verweise und Dubletten bereinigen | PLAN-CLEAN-2 | Erledigt: #1596; historische Abschnitte gekennzeichnet, tote Verweise und Dubletten dieses Schnitts bereinigt; Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-4 | Plan bereinigen, Schnitt 4: Entscheidungen vom 16.10. buchen, Designziel und neue Paketzeilen eintragen, gemergte PRs ohne Planzeile zuordnen (Sammelzeilen und v2-Zuordnung), Herkunft von COMP, DR2, OPS-* und DS-KONTRAST-FU festhalten | PLAN-CLEAN-3 | Erledigt: #1616 (16.10.) |
| PLAN-GATE | [Planprüfung als Pflicht-Gate](archive/plan-2026-10/contracts-2026-10-24.md#parked) | PLAN-CLEAN-4, PLAN-AUTO-1b-b, PLAN-AUTO-2 | Erledigt: #1625 (merged 2026-10-16); plan check runs as gate `plan-check` (`node scripts/plan-check.mjs --offline`) in lanes precommit, prepush, branchpush, linux, linux_1; `docs/decisions.md` jetzt schwer (`lane-plan.sh`); Nutzer-Ja 16.10. (Root-Chat ~02:22 MESZ), Vorbedingung `plan:check` auf `main` 0 Befunde (Root 16.10.) |
| ROADMAP-0 | Konzept (Root + Rechte Hand) und UX/UI-Entwurf mit dem Designsystem | – | Erledigt: Konzept und UX-/UI-Entwurf am 15.10. angenommen (laut Root, kein PR); Umsetzung in ROADMAP-1a und ROADMAP-1b |
| ROADMAP-1 | Generator: Roadmap-Seite aus PLAN.md, bei jedem Merge neu | PLAN-AUTO-1, ROADMAP-0 | Verschoben nach ROADMAP-1a, ROADMAP-1b und ROADMAP-1c (15.10.): #1580 trägt die Plan-ID ROADMAP-1, liefert aber nur die Datenschicht, keine Seite; der Renderer kam mit #1597 (ROADMAP-1b), Aufrufer und Neuerzeugung bei jedem Merge sind ROADMAP-1c |
| ROADMAP-1a | Erster Generator-Schnitt: Roadmap-Daten aus `docs/PLAN.md` und GitHub ableiten | PLAN-AUTO-1, ROADMAP-0 | Erledigt: #1580 (merged 2026-10-15T18:37:52Z, `c9d4ca35`) |
| ROADMAP-1b | [Angenommenen Roadmap-Entwurf in Pakete ≤ 300 Zeilen schneiden und die Seite aus …](archive/plan-2026-10/contracts-2026-10-24.md#parked) | ROADMAP-1a, ROADMAP-0 | Erledigt: eigenständiger HTML-Renderer `scripts/lib/roadmap-page.mjs` mit #1597 (merged 2026-10-16T02:19:17Z, `648fba44`); Aufrufer, Neuerzeugung bei jedem Merge, Hosting und Root-Browserabnahme: ROADMAP-1c |
| ROADMAP-1c-1 | Aufrufer: `npm run roadmap:page` schreibt die Roadmap-Seite `.pa/roadmap.html` aus denselben origin/main-Daten wie `roadmap:data`; Root-Browserabnahme | ROADMAP-1b | Erledigt: #1652 (merged 2026-10-16), Branch `claude/roadmap-1c-1` |
| ROADMAP-1c-2 | Neuerzeugung bei jedem Merge, Anzeige im HQ, kein Hosting auf GitHub (Nutzer 18.10.) | ROADMAP-1c-1 | Erledigt: #1659 (merged 2026-10-16), Branch `claude/roadmap-1c-2`; `post-merge` erzeugt `.pa/roadmap.html` auf main neu, `npm run hq:live` zeigt sie unter `/roadmap.html`; Hosting-Entscheid gebucht: ROADMAP-HOST (18.10.) |
| ROADMAP-1d | Roadmap-Seite härten (Review-Nachträge R1659-K1, K2, K4): Änderungszeilen nur mit ISO-Datum, eine Diagnosezeile auf stderr bei unlesbarer Plan-Prüfung, Tests für die Überspringpfade des `post-merge`-Schritts | ROADMAP-1c-2 | Erledigt: #1674 (merged 2026-10-17), Branch `claude/roadmap-1d` (Plan-ID ROADMAP-1d), Stufe B |
| README-ARCH-1 | README-Architekturgrafik präzisieren (Status vs. Freigabe, Startsperre, Sandbox-Grenze, Steuerungsclient) | – | Erledigt: README und Architekturgrafik mit PR #1605 präzisiert (Stufe C; Owner Root) |
| NAME-NUTZER | Persönliche Namensnennung durch neutrale Nutzerformulierung ersetzen | – | Erledigt: #1582 (merged 2026-10-15T18:33:45Z, `0f2cd8de`) |
| KONZEPT-0 | Gliederung für ein neues `docs/KONZEPT.md` (nur lesend): wie ProjectA arbeitet, Regeln, GitHub-Verhalten, Rechte, Ziel, Funktionen, Konfiguration; später von Orchestrator/Wächter aktuell gehalten | – | läuft: nur lesender Gliederungsauftrag, kein PR (laut Root 15.10.); Abnahme Root |
| KONZEPT-n | `docs/KONZEPT.md` nach angenommener Gliederung in Paketen ≤ 300 Zeilen schreiben | KONZEPT-0 | Geplant: erst nach Annahme der Gliederung |
### Architektur-Pakete aus dem Architektur-Rat (03.10.2026, historisch)

| ID | Ziel | Dateien | Lane | Naht | Tier | Test-Trailer | Stand / Reihenfolge |
|---|---|---|---|---|---|---|---|---|
| ARCH-01 | [ARCH-01 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fe + hqL | nein | B | siehe Archiv | Erledigt #166/#167; Reihenfolge: jetzt; Löschung mit Nutzer-Ja (F5) |
| ARCH-02 | [ARCH-02 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #191; Reihenfolge: nach Merge von PR #130 |
| ARCH-03 | [ARCH-03 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fR | nein | A (Vault) | siehe Archiv | Erledigt #214/#217/#256; Reihenfolge: jetzt |
| ARCH-04 | [ARCH-04 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #169; Reihenfolge: nach Inbox-Antwort F2 |
| ARCH-05 | [ARCH-05 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | mn | ja | A (Naht) | siehe Archiv | Erledigt #182; Reihenfolge: jetzt |
| ARCH-06 | [ARCH-06 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | mn | ja | A | siehe Archiv | Erledigt #219; Reihenfolge: nach ARCH-05, vor W5-04b |
| ARCH-07 | [ARCH-07 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | st | ja | A | siehe Archiv | Erledigt #202; Reihenfolge: nach #147/#44, gemäß st-Reihenfolge |
| ARCH-08 | [ARCH-08 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #181/#221/#229/#244/#247/#252; Reihenfolge: nach PR #154 |
| ARCH-09 | [ARCH-09 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #260/#264/#269; Reihenfolge: nach ARCH-08, niedrige Priorität |
| ARCH-10 | [ARCH-10 — historischer Beleg](archive/plan-2026-10/contracts-2026-10-24.md#parked) | siehe Archiv | api | ja | A | siehe Archiv | Erledigt #220/#236/#246/#250; Reihenfolge: vor W5-02b3 (api) |
| ARCH-11 | [M3-Kandidat ARCH-11: Windows-DB-Wettlauf](archive/plan-2026-10/contracts-2026-10-24.md#parked) | `testutil.rs` + betroffene Tests | fR + N | nein | A (DB) | Regression-For: KI-24-Läufe 36165944208/36215024767; 20× close→reopen auf Windows | Verschoben nach Z4-ARCH-11; Reihenfolge: M3-Kandidat angenommen (Nutzer 04.10.); Windows-Lauf nötig, der PC des Nutzers darf dafür genutzt werden |
| ARCH-12 | `impl ControlBackend for ApiBackend` aus `main.rs` auslagern. Das Paket bleibt gesperrt, weil der Trait-Block als reine Verschiebung mehr als 300 Diffzeilen erzeugt. | `main.rs`, `api/backend.rs`, ~715 Z. | mn + api | ja | A | No-Test: mechanische Verschiebung erst nach ADR A1 | nach ADR A1; gesperrt |
#### Später: getrennte Security-Kandidaten (neu zu prüfen, kein M4-Code)

| Kandidat | Quellenbefund | Voraussetzung |
|---|---|---|
| INV-SEC-VAULT-TEMP | [Archiv: Historie][historie] | ✓ #200 gemergt (03.10.); vorher roter Symlink-Test |
| INV-SEC-VAULT-ARCHIVE | [Archiv: Historie][historie] | ✓ #225 gemergt (03.10.); vorher roter Zwei-Reparaturen-Test |
| INV-SEC-CSP-SPLIT | [Archiv: Historie][historie] | ✓ #288 gemergt (04.10.): `devCsp` getrennt, Release-CSP ohne `ws://localhost` |
| API-Descriptor | Private Erstellung/Ersetzung der Descriptor-Datei unter Unix prüfen. | nach #158 prüfen |
| INV-SEC-PRIVATE-PATHS | Einheitliche no-follow-Erstellung privater Dateien (Idee). | nach M4 |

<a id="gestrichen"></a><a id="geparkt"></a><a id="später-neue-ideen-und-zurückgestellte-themen"></a><a id="paperclip-kandidaten-nutzer-1110-0430z-einreihen-erlaubt"></a><a id="synthese-der-bestandsaufnahmen-inv-0108-und-des-architektur-rats-03102026"></a><a id="später-weitere-quellenbefunde-nach-bereich"></a>[Weitere Vertragsabschnitte](archive/plan-2026-10/contracts-2026-10-24.md#parked). LUMIO erst nach DS-H-07-Nutzerurteil, nie automatische Antwort/Vorauswahl; AGENT-WERKZEUGE nur nach Nutzer-Ja, keine fremden Proxy-/Sitzungswege. VERBUND bleibt ein DevHQ-Pfad, PLAN-AUTO die einzige Planquelle; Paperclip nur Kandidaten mit erneuter Root-Prüfung. Security-/Quellenbefunde zuerst bestätigen, Rot vor Fix; M4B-/Windows-/Audit-Reste und Continuous-Freeze bleiben wie GOAL/IMPORT offen.

## Entscheidungs-Inbox (historisch 04.10., nicht maßgeblich)
[Originaltext][historie]

## Belege und Verträge, die weiter gelten

- `docs/development/CONTINUOUS.md` — nutzerfreigegebener Vertrag für den Continuous Mode; die frühere Spezifikation `.pa/task_continuous_devhq.md` liegt nicht im öffentlichen Repo.
- `.pa/continuous_acceptance_matrix.md` — Abnahmematrix, 27 Zeilen.
- Konzept der Welle W5 (Pakete außerhalb des Kerns geparkt): `.pa/plan_projects_w5.md` liegt nicht im öffentlichen Repo.
- `docs/development/HQ2_CONTRACT.md` — Verträge von HQ, App und CLI (DF-03).
- `docs/ERLEDIGT.md` — erledigte Pakete mit PR, Merge-SHA und Bericht.
- `.pa/archiv/` — alte Plan- und Standfassungen, historische Specs, Review-Prompts.

## DEVFLOW-Tabelle (Quelle des Planimports DF-04)

Der Planimport (`src-tauri/src/development_plan.rs`) liest genau diese Tabelle
und erwartet alle 38 Zeilen DF-00 bis DF-37. Deshalb bleibt sie vollständig;
der Status steht am Anfang der letzten Spalte. Die Zeilen sind nicht Teil der
Meilensteine (DF-15b ist erledigt, PR #16).

PR-Nummern #70, #100 und #103 in dieser Tabelle sind `alt-#`-Nummern aus der Zählung vor dem öffentlichen Import (`c60f2679`) und hier nicht prüfbar; #16 ist ein PR dieses Repos.

| ID | Paket / Agent / Scope | Nach | Konkretes Ergebnis und Abnahme |
|---|---|---|---|
| DF-00 | Bestandsabgleich · Architekt · DOC · S | — | Erledigt (PR #70). Live-Git, PR, offene HQ2/W-Gates, vorhandene Implementierungen und Fähigkeiten abgleichen; Pfad-Allowlist und Überlappungsmatrix für alle Pakete, keine doppelte Implementierung. |
| DF-01 | Autonomie-Interview · Koordinator · DOC · S | DF-00 | Erledigt (PR #70). Entscheidungen zu Repo-Schreiben, Commit/Push, Merge/Release, Netzwerk/Installation, Secrets, destruktiven Aktionen, Isolation und Eskalation erfassen. |
| DF-02 | Gemeinsame Desktop-Richtung · design-director · DOC · S | DF-00 | Erledigt (PR #70). Bestehende PC-Ansichten kritisch prüfen, Designvertrag mit Navigationshierarchie, Zuständen, Dichte und Live-Vorschau; Impeccable anwenden, Screenshots als Ausgangsevidenz. |
| DF-03 | Domain-/Eventvertrag · Architekt · DOC · M | DF-00 | Erledigt (PR #70). Obige Verträge mit vorhandenen APIs abgleichen; Übergangstabelle, Fehlerfälle, Migration/Versionsstrategie und App/HQ-Parität festlegen; zwei unabhängige Reviews vor Integration der gemeinsamen Nahtstelle. |
| DF-04 | Planimport · Backend · CORE · M | DF-03 | Erledigt (PR #70, DF-04a/b/c). Markdown-Pakete mit stabilen IDs und Quellenrevision projizieren; Tests für fehlende IDs, Zyklen, geänderte Quelle, Wiederimport ohne Duplikate. |
| DF-05 | Plan-Lesezugriff · Integrator · SEAM/HOST · M | DF-04 | Erledigt (PR #70, DF-05a/b). Gemeinsamen lesenden App/HQ/CLI-Vertrag anbinden; identische Paketdaten und explizite Fehler statt leeren Erfolgs prüfen. |
| DF-06 | Grafische Roadmap · Frontend · HQ · M | DF-02, DF-05 | **Geparkt (25.09.)** DF-06b hängt am Workflow-Motor (DF-11/16). DF-06a erledigt (PR #70). Ursprünglich: DF-06a erledigt (PR #70). Offen DF-06b: Ausführungszustände bereit/aktiv/erledigt nach DF-11/DF-16 mit belegter Paket-/Run-Bindung; bis dahin bleibt der Ausführungsstatus unbekannt. Hierarchie, Abhängigkeiten, kritischer Pfad, Quellenklick und Prioritätsgrund mit echtem Plan und leeren/fehlerhaften Daten prüfen. |
| DF-07 | Desktop-Dichte · Frontend · HQ/APP · M | DF-02 | **Erledigt.** DF-07a–c über PR #70; DF-07d hat der Nutzer am 25.09. als erledigt bestätigt, die Sichtprüfung gehört zur M3-Abnahme. Ursprünglich: DF-07a–c erledigt (PR #70). Offen DF-07d: visueller PASS der React-Dichte (Code über PR #70 gemergt, `.pa/report_df07d_native_density.md`); DF-07 ist erst danach abgenommen. Komfortabel/Kompakt ändern messbar Zeilenhöhe, Abstand, Paneelgrößen und sichtbare Informationsmenge; Screenshots bei 1280×800 und 1920×1080, Tastatur und Zoom prüfen. |
| DF-08 | Ausführungsidentität · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DF-08d hängt an DF-11. DF-08a–c erledigt (PR #70). Ursprünglich: DF-08a–c erledigt (PR #70). Offen DF-08d: native Modellbeobachtung, Adapter-/Profilbelege, Workflow-Anbindung nach DF-11. Provider, Modell/Familie, Adapter und Erscheinungsprofil getrennt führen; konfiguriert ist nicht beobachtet; Alias-/Unbekannt-Fälle testen. |
| DF-09 | Profilwahl im Chat · Frontend · HQ/APP · M | DF-02, DF-08 | **Geparkt (25.09.)** DF-09b wäre ein Doppelbau (React neben HQ); erst nach der Entscheidung „HQ als Hauptbereich der App“. DF-09a erledigt (PR #100). Ursprünglich: DF-09a erledigt (PR #100, lokale Chat-Erscheinungen). Offen DF-09b: React-Parität und Admission-Kompatibilität. UI-Profil Codex/Claude/DeepSeek unabhängig vom belegten Modell wählen; unterstützte native Kombinationen von reiner Darstellung unterscheiden, inkompatible Starts verweigern. |
| DF-10 | Chat-Modi und Interview · Integrator · CORE/SEAM/HQ/APP · M | DF-01, DF-03, DF-09 | **Geparkt (25.09.)** Zusammen mit HQ2-04; kommt mit der einen Oberfläche nach M4 zurück. Ursprünglich: Übernimmt HQ2-04 (beratende und aktive Sitzung getrennt sichtbar, manueller Providerwechsel mit Übergabe). Plan/Interview/aktive Ausführung mit konkreten Rückfragen und Projektkontext; Planmodus darf keine Schreibbefugnis erzeugen. Reale Sitzung mit Antwort belegen; Integration bei Bedarf in Kinder teilen. |
| DF-11 | Workflow-Zustand · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** Workflow-Motor: zweite Steuerung neben dem fertigen Continuous-Kern. Ursprünglich: Persistente Stage-Zustände und append-only Übergangsereignisse auf vorhandener Queue; ungültige Übergänge und Neustart testen. |
| DF-12 | Unabhängigkeitsgate · Backend · CORE · M | DF-08, DF-11 | **Gestrichen (25.09.)** Doppelung: die Autor-Familiensperre steckt in W2-01 ✓ und W5-02d. Ursprünglich: Kandidatenweite Autor-Familienmenge sperrt eigene Review-/Testbewertung, auch nach Handoff/Alias/Review-Fix; unbekannte Identität blockiert Attestation. Negativtests zwingend. |
| DF-13 | Berechtigungsteam · Backend · CORE · M | DF-01, DF-11 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Versionierte, vom Nutzer festgelegte Policy auswerten; erlauben/ablehnen/eskalieren mit Gründen. Keine Selbst-Erweiterung, kein gefälschter Human-Verdict; Replay und Scopewechsel testen. |
| DF-14 | Stationsübergabe · Backend · CORE · M | DF-12, DF-13 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Bestehende Admission/Claims für nächste Station nutzen; atomare Übergabe, Idempotenz, Fencing, Budget aller Nachfahren. Doppelzustellung und Crash vor/nach Spawn testen. |
| DF-15 | Rücklauf und Recovery · Backend · CORE · M | DF-14 | **Geparkt (25.09.)** Workflow-Motor; DF-15a erledigt (PR #103), DF-15b erledigt (PR #16). Ursprünglich: Review→Fix→neuer Review, Pause/Cancel, Quota/Auth-Ausfall, begrenzte Wiederholung und Wiederaufnahme; Leaseablauf nie als Prozessende werten. Der frühe Provider-Exit vor dem Lesen des Task-Inputs ist als DF-15a erledigt (PR #103, Endzustand `exited_undelivered`, Migration 22); die dabei offen gebliebene Freigabe von Reservierung und Delivery ist als DF-15b erledigt (KNOWN_ISSUES KI-27: Reservierung `cancelled` und Delivery-Freigabe journalisiert, atomar im bewiesenen Exit-Commit, ohne neue Migration). |
| DF-16 | Workflow-API · Integrator · SEAM/HOST · M | DF-15 | **Geparkt (25.09.)** Workflow-Motor. Ursprünglich: Start/Pause/Status/Decision über denselben Kern für App/HQ/CLI; Autorisierung, Konflikt und Event-Replay prüfen, kein Scheduler im Host. |
| DF-17 | Team-/Stationsgraph · Frontend · HQ · M | DF-02, DF-16 | **Geparkt (25.09.)** hängt an DF-16. Ursprünglich: Ideen→Interview→Plan→Koordination→Architektur→Code/Design→Review→Test→Kritik mit konfigurierbaren Stationen, Rollen, Zuständen und Übergabegründen; native Teams/Lessons erhalten. |
| DF-18 | Entscheidungs-Inbox · Frontend · HQ/APP · M | DF-16 | **Gestrichen (25.09.)** Doppelung mit W5-06/06b/08a/08b (die selbst geparkt sind). Ursprünglich: Nur echte Nutzerfragen/Freigaben, Kontext/Optionen/Auswirkung, Zielprojekt und Version sichtbar; doppelte/veraltete Entscheidung abweisen und auflösen. |
| DF-19 | Prioritäten und Advisor · Backend · CORE · M | DF-08, DF-12, DF-03 | **Gestrichen (25.09.)** Routing ist dreifach geplant (DF-19/20, W5-30b/33, HQ2-07); später eine gemeinsame Fassung. Ursprünglich: Taskklasse, Abhängigkeiten, Evidenz, Benchmark/Erfahrung, Quota und Policy in erklärbare Empfehlungen für Priorität/Modell/Effort übersetzen; fehlende Daten und manuelle Overrides testen. |
| DF-20 | Routing-Editor · Frontend · HQ/APP · M | DF-19 | **Gestrichen (25.09.)** wie DF-19. Ursprünglich: Anbieterreihenfolge, Regeln, Taskklassen, Reserven, Ausschlüsse, Fallbacks und Override editieren; Simulation erklärt Auswahl/Ablehnung, Revision verhindert verlorene Änderungen. |
| DF-21 | Erweiterungskatalog · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: GitHub-Quellen zu Plugins/Skills auf feste Revision auflösen, Quelle/Kompatibilität/Rechte/Scope anzeigen; bestehende Installer wiederverwenden, untrusted Metadaten nicht ausführen. |
| DF-22 | Installation und Rücknahme · Backend · CORE · M | DF-13, DF-21 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Kontrollierte Installation, Update, Deaktivierung und Rollback über geprüften Pfad; Traversal/Symlink, abgebrochenen Download und Versionswechsel testen; globale Änderungen nach Policy. |
| DF-23 | Katalog-Bedienung · Frontend · HQ/APP · M | DF-22 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: GitHub-Link hinzufügen und ein Klick installieren, soweit Policy erlaubt; sonst begründete Entscheidung. Realer Installationszustand statt bloßer Prompt-Auswahl. |
| DF-24 | Task-Preflight · Backend · CORE · M | DF-14, DF-22 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Vor Task und Scopewechsel erforderliche/hilfreiche Skills/Plugins auswählen; nur relevante laden, Auswahlgrund/Version/tatsächliche Verwendung protokollieren; fehlende Pflichtfähigkeit blockiert. |
| DF-25 | Schneller Entwurfsbereich · Backend · CORE · M | DF-13, DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Worktree, isolierte Projektdaten und Live-Preview-Lebenszyklus; Start/Stop/Recovery, keine fremden Prozesse beenden. Klar als Arbeitsisolation kennzeichnen. |
| DF-26 | Stärkere Sandbox · Backend · CORE · M | DF-25 | **Gestrichen (25.09.)** Container/VM ist auf 16 GB RAM unter Windows fraglich. Ursprünglich: Einen belegbar verfügbaren Container- oder VM-Adapter mit Filesystem-/Netzwerk-/Ressourcengrenzen integrieren; fehlende Voraussetzungen anzeigen, kein stiller schwacher Fallback. |
| DF-27 | Architekturansicht · Frontend · HQ · M | DF-05, DF-25 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Reale Modul-/Abhängigkeitsdaten mit Quellen und Abdeckung visualisieren; Änderungsvorschlag→Diff→Test→Übernahme, unbekannte Analysebereiche sichtbar. |
| DF-28 | Gemeinsames Design-Livebild · Frontend · HQ/APP · M | DF-17, DF-25 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Laufende echte App/Website, gewählter Schritt, Agentendelta und Feedback nebeneinander; Änderungen fortlaufend nachvollziehbar, Wiederverbindung/Fehler testen. |
| DF-29 | Messereignisse · Backend · CORE · M | DF-11, DF-08 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Zyklus-/Wartezeit, Rework, Review/Test, Recovery, Routing und beobachtete Usage mit Quelle erfassen; Deduplikation, Einheit, fehlende Werte, Retention/Redaktion prüfen. |
| DF-30 | Statistikprojektionen · Backend · CORE · M | DF-29, DF-24 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Filterbare Task-/Modell-/Provider-/Skill-Vergleiche, Stichproben und Qualitätsmetriken, API/Export; keine Gleichsetzung von Korrelation und Ursache oder Abo-Quoten. |
| DF-31 | Statistik-Cockpit · Frontend · HQ/APP · M | DF-02, DF-30 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Große Analysefläche mit Trends, Verteilungen, Engpässen, Rework, Teststabilität, Kapazität, Quellen-Drilldown und Einstellungen; echte Daten plus kenntliche Fixture-Tests. |
| DF-32 | Releaseprognose · Backend/Frontend · CORE/HQ · M | DF-06, DF-30 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Kritischen Pfad und beobachteten Durchsatz mit Unsicherheitsintervall verbinden; ohne ausreichende Daten kein Datum. Readiness separat aus offenen Gates, Reviews/Tests und Blockern anzeigen. |
| DF-33 | Vorlagenkatalog · Backend · CORE · M | DF-03 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Versionierte editierbare Templates für Idee/Projekt/Plan/Team/Harness/Review/Test/Policy/Release; Kontextvorschlag mit Vorschau, kein stilles Überschreiben. |
| DF-34 | Vorlagen im Arbeitsfluss · Frontend · HQ/APP · M | DF-10, DF-18, DF-23, DF-33 | **Geparkt (25.09.)** DEVFLOW-Ausbau, hilft dem Ziel nicht. Ursprünglich: Passende Vorlagen an Eingabestellen anbieten; übernehmen/anpassen/verwerfen, Entwürfe bei Navigation erhalten und gleiche Semantik in App/HQ prüfen. |
| DF-35 | Durchgängiger Runtime-Nachweis · Tester · DOC/Tests · M | DF-20, DF-24, DF-26, DF-27, DF-28, DF-31, DF-32, DF-34 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Isoliertes Projekt vom Plan bis zu modellunabhängigem Review/Test; reale Modellantwort, Übergaben, Rückfrage, Neustart und Datenparität messen; negative Gates mitprüfen. |
| DF-36 | PC-Politur und Designabnahme · design-director · HQ/APP · M | DF-35, DF-07 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Impeccable-Kritik anhand echter Screenshots; leere/ladende/fehlerhafte/dichte Ansichten, Fokus, Zoom, Kontrast und Hell/Dunkel prüfen; Befunde nachvollziehbar schließen. |
| DF-37 | Abschluss und Releaseentscheidung · Integrator/Reviewer · DOC · S | DF-36 | **Gestrichen (25.09.)** ersetzt durch die Abnahme je Meilenstein. Ursprünglich: Zwei unabhängige Reviews für große/Shared-Seam-Änderungen, Dispositionen, aktuelle Gates und NICHT ABGEDECKT; Readinessbericht. Merge/Release/Continuous nur mit geltender menschlicher Freigabe. |

Größen und Abschlussprotokoll der DEVFLOW-Pakete, Verträge und Scopes stehen in
`.pa/archiv/PLAN_2026-09-24.md` (Abschnitt DEVFLOW).

[historie]: archive/plan-2026-10/history.md
[pakete]: archive/plan-2026-10/completed.md
