# PLAN — der einzige Plan für ProjectA

Stand dieses Dokumentenschnitts: 23.10.2026, Basis `17384f877bd02e3472f5a74669525e7e09bc1cfe`; Abnahme bei Root. Dieses Dokument bleibt der **einzige Plan**; Unterpläne sind Verträge, Archive sind Herkunft und erteilen keinen Auftrag.

> **Für Agenten:** zuerst „Für den Nutzer“, „Statuswerte“ und die eigene Z-Tabelle lesen; `rg -n "<ID>" docs/PLAN.md`. Abgeschlossene Kennungen stehen im historischen Abhängigkeitsregister, ihre Originalzeilen im [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md). Offene und mehrdeutige Restpflichten bleiben aktiv, auch bei „Erledigt“ als Lieferstatus.
> [Historie][historie] · [Paketoriginale][pakete] · [Archivschnitt Phase 1](archive/plan-2026-10/completed-z-2026-10-23.md) · [Kontext Phase 2](archive/plan-2026-10/context-2026-10-23.md). M1–M5 und DF bleiben im ausdrücklich nicht disponierenden Kompatibilitätsanhang.


## Für den Nutzer

- **Geliefert:** v1.6.0 und die dokumentierten Nachlieferungen; DS-U0/#1861 benennt die kanonische Designquelle, #1862 berichtigt die Abnahmeverweise. Das sind keine Glass- oder Nutzerabnahmen.
- **Jetzt:** „Nutzbar 1“ mit der aktuellen Glass-Oberfläche: Auftrag geben, beobachteten Zustand sehen, antworten und Ergebnis prüfen. Erst die genehmigte Bestandsaufnahme, dann belegte Funktionen und einheitliche UI; Pixel-Fabrik, DS-H/DS-WF, Exporte und Artefaktauffrischung bleiben v2.x. `styles.css` wird nicht pauschal entfernt.
- **Noch offen:** echte technische Glass-Abnahme und Nutzer-UAT, Beta-/Update-Drill und E14-Releasebeleg; D1-on/#1540 und Release-Sperre bleiben. Bestandsaufnahme/MOCK und Screenshots beweisen keinen nativen Backendbetrieb; die isolierte native Laufzeitoption ist noch nicht eingerichtet.
- **Weitere Restpflichten:** Denkraum DR-03/08/15/16b/17; v1.6-Nachbeobachtung; M4B-Test-/Audit-/Windows-Reste, DOC-Gesamtabnahme und Sicherheitsentscheidung zu SEC-01b. Continuous bleibt deaktiviert und eingefroren.
- **Nutzerentscheidungen:** GI02 (Classic) und GI05 (13 Platzhalter): verbergen/hinter Schalter oder bauen ist offen. Weitere unbeantwortete Fragen stehen in der Inbox; beantwortete Fragen werden nicht erneut gestellt.
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
| DR-01 | [Archiv][pakete] | Seniorentwickler | – | PC | B | Erledigt: #635 `e9f8ce8` durch Mergify am 08.10. 06:44:21 UTC gemergt (`0b56f1a`); keine erneute Source-Abnahme | siehe Archiv | 55ea21ce |
| DR-01a | [Archiv][pakete] | Seniorentwickler | DR-01 | Server | A | Erledigt: #637 `a2dbf09` durch Mergify am 08.10. 07:56:31 UTC gemergt (`8f7c499`); Queue 655 / CI 37745165188 mit echtem Windows-PASS | siehe Archiv | 55ea21ce |
| DR-02 | [Archiv: Historie][historie] | Seniorentwickler | DR-01, DR-01a | Server | A | Erledigt: #636 `4ef2ac2` durch Mergify am 08.10. 08:33:02 UTC gemergt (`7e3a7af`); Batch 659 / CI 37748898151 volle Windows-, Linux- und red-first-Gates grün; DR-03 folgt | siehe Archiv | 55ea21ce, b0e90b72 |
| DR-03 | DeskStore-Kern; P1/Z1 nach integriertem Ledger-Modell | Seniorentwickler-Profil, ein nativer Ausführungsowner `qfytpd`; Chief disponiert | DR-02 gemergt; eigene Goal-/Laufzeitbelege, frische Guards | eigener Worktree; schwere Gates Server | A | Erledigt: #661 `c80456a` am 08.10. 14:22:17Z durch Mergify gemergt (`3003748`); F01 und reale DR-04-Komposition bleiben offen | Store-Tests grün, Revision/Konflikt verlieren keine Daten; Folgepunkte aus DR-02: Längenlimit für Ledger-Listen, Antwort-Elemente prüfen (DeskError statt TypeError); eigene prepush und zwei Fremdvendor-Reviews am Kandidaten, Root-Abnahme | ee12d457, 8fa3ef8e, 55ea21ce |
| DR-04c | [Archiv][pakete] | bestehender qfytpd, Root-Option A/D1 | DR-04b-Stack `dc34cae` | eigener Worktree; Gates Server | A | Erledigt #671 (merged 2026-10-08T17:43:49Z); Erledigt #674 (merged 2026-10-08T19:45:55Z) | siehe Archiv | 1671ee11 |
| DR-06 | [Archiv][pakete] | bestehender qfytpd; Root disponiert | DR-04c; getrennte Lieferung DR-06a → DR-06b | PC; Gates Server | A | Erledigt #676 (merged 2026-10-08T20:56:05Z); Erledigt #681 (merged 2026-10-08T21:42:27Z) | siehe Archiv | 672767c8, 55ea21ce |
| DR-06a | [Archiv][pakete] | bestehender qfytpd | DR-04c | eigener Worktree; Gates Server | A | Erledigt #676 (merged 2026-10-08T20:56:05Z) | siehe Archiv | c044dc2b |
| DR-06b | [Archiv][pakete] | bestehender Root-Serverjob, Claude Sonnet laut Root; qfytpd nur Fixrunde | DR-06a | Server | A | Erledigt #681 (merged 2026-10-08T21:42:27Z) | siehe Archiv | e4ad8296 |
| DR-07 | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd; Root dispatcht/nimmt ab | DR-06b/#681 gemergt `85ab286` | Server | C, Root kann B verlangen | Erledigt #731 (merged 2026-10-08T23:14:56Z) (07a); Erledigt #732 (merged 2026-10-08T23:14:31Z) (07b); 07c/d/e1/e2 separat | siehe Archiv | 55ea21ce |
| DR-08 | UI-Hülle `index.html` + Style, byte-genau auf Stand B1 | UX-Architekt | FIT vorbereitet, Root-FIT-Abnahme; DR-01 | egal | B | Erledigt: #640 `2c57bd3` durch Mergify am 08.10. 08:09:51 UTC gemergt (`cd64c1c`); benutzbare Gesamtlösung weiter offen | Byte-Vergleich mit B1-Kandidat; prepush Exit 0 | 55ea21ce, 6713479b |
| DR-09 | [Archiv][pakete] | Implementierer · Codex | DR-01 | Server | B | Erledigt #638 (merged 2026-10-08T14:46:25Z) | siehe Archiv | 55ea21ce |
| DR-09-WIN | P1/Z1: Windows-Fixture schließt Ressourcen nachvollziehbar vor temporärer Verzeichnisentfernung; sicherer Queue-Beleg statt Zeitfenster-Vergrößerung | bestehender DR-01a-Owner; Chief disponiert, Root nimmt ab | Queue-656-Befund; frische Guards, Windows-Ort und freier Build-Slot | PC / vorhandener Windows-Ort | A | Erledigt #660 (merged 2026-10-08T14:21:03Z) | ≤ 300 ALL; kompilierendes deterministisches Rot auf Basis und Grün am Kandidaten; originaler Cleanup-Test und eigene prepush Exit 0 auf Windows; zwei Fremdvendor-Reviews am Head; Root vor Ready, Mergify; historischer Lockhalter ungeklärt | 1d708b0f, a6677e75, 8fa3ef8e, 55ea21ce |
| ARCH-D7-WIN | [Archiv][pakete] | bestehender DR-15a-Owner; Chief disponiert, Root nimmt ab | CI 37746602240 / Windowsjob 113209450490; Store-Lane frei, schwere Läufe nach DR-09-WIN | vorhandener Windows-Ort | A | Entfallen: aufgegangen in V16-KI30 #737 / Z4-ARCH-11 | siehe Archiv | c4d05a97, 782d9e58 |
| DR-10 | [Archiv][pakete] | Root-Job `srv-dr-10-opus`; kein zweiter UI-Owner | DR-09/#638 gemergt; Verdrahtung in DR-11/#718 | Server | B | Erledigt #665 (merged 2026-10-08T19:59:10Z) | siehe Archiv | 08342807, 5945accc |
| DR-10-WIRE | UI-Verdrahtung von ideas.js und app.js in DR-11/#718 enthalten | DR-11-Owner; kein separater Start | DR-11/#718 | eigener Worktree | B | Entfallen (Root 09.10.): Verdrahtung bleibt in #718 (DR-11) | rote Verdrahtungsregression, beide Skripte HTTP 200; inspiziertes Laufzeitbild, eigene prepush/Fremdreview/Root-Abnahme; ≤ 300 ALL | 4e0b5b37 |
| HOTFIX-RF-PW | [Archiv][pakete] | bestehender Owner; Root disponiert die freigegebene Runde | –; Voraussetzung für DR-11 | Server | B | Erledigt #741 (merged 2026-10-09T12:27:43Z); ersetzt: In Prüfung: Ready #741; E1 vom 09.10. erlaubte genau eine dritte Runde nur zum Delta | siehe Archiv | – |
| DR-11 | [Archiv][pakete] | UX-Architekt | DR-10/#665 und HOTFIX-RF-PW/#741 | Server | C bei reinem Testdiff; höhere Risiken nach Regel 5 | Erledigt #718 (merged 2026-10-09T13:38:46Z); ersetzt: In Prüfung: Draft #718 | siehe Archiv | 55ea21ce |
| DR-12 | [Archiv][pakete] | UX-Architekt | DR-11 (Kategorie- und R1-Tests benötigen dessen Harness) | egal | B | Erledigt #740 (merged 2026-10-09T14:45:16Z); ersetzt: In Prüfung: Draft #740 | siehe Archiv | 98fa8267 |
| DR-13 | [Archiv][pakete] | UX-Architekt | DR-12 | Server | B | Erledigt #759 (merged 2026-10-09T15:35:05Z); ersetzt: In Prüfung: Draft #759 | siehe Archiv | 98fa8267 |
| DR-14 | [Archiv][pakete] | UX-Architekt | DR-13 | Server | B | Erledigt #774 (merged 2026-10-09T16:26:29Z); ersetzt: In Prüfung: Draft #774 | siehe Archiv | 98fa8267 |
| DR-15 | Sicherer Start ohne manuelle Secret-Eingabe; 15a Basismodul und CLI-Korrektur getrennt, 15b Einbindung nach DR-06 (Secrets über den Secret-Manager von AgentsRoom) | Implementierer · Codex | DR-15a-BASE, DR-15a-CLI (15b: DR-06) | Server | A | In Prüfung: Code von 15a-BASE (`cd3bffac`), 15a-CLI (`7ac5985e`) und 15b (`86eeb68d`, 09.10.) gemergt; Start-/Nutzerabnahme („Start ohne Eingabe“) Unbekannt (zu prüfen); ersetzt: In Prüfung: G1-Teilung tatsächlich geliefert, #647 und #639 gemergt; begrenzte 15a-Source gemeinsam integriert, 15b und gesamte Start-/Nutzerabnahme offen | Basismodul und korrigierter CLI-Aufruf zusammen integriert; Start ohne Eingabe; kein Secret in Datei/Log/Commit; physische STATE-Pfadprüfung bleibt 15b | 55ea21ce |
| DR-15a-BASE | [Archiv][pakete] | vorhandener Implementierer · Codex | DR-01; gemeinsame Abnahme mit DR-15a-CLI | Server | A | Erledigt: #647 `5f501f1` durch Mergify am 08.10. 07:26:49 UTC gemergt (`cd3bffa`); Lieferung zusammen mit CLI, DR-15b Erledigt #750 (`86eeb68d`) | siehe Archiv | 868dbc83 |
| DR-15a-CLI | [Archiv][pakete] | derselbe Implementierer · Codex | DR-15a-BASE | Server | A | Erledigt: #639 `3bf5a8b` durch Mergify am 08.10. 08:09:55 UTC gemergt (`7ac5985`); kombinierte Source-Abnahme erhalten, DR-15b Erledigt #750 (`86eeb68d`) | siehe Archiv | f1a2ade9 |
| DR-SEC-01a | [Archiv][pakete] | Root bindet einen Owner im Ticket | Dateischnitt und Startvertrag aus Ticket b0221f4a vor Umsetzung | Server | A | Erledigt als Bericht: Bedrohungsmodell + Testlückenkarte (Server-Job srv-dr-sec-01a 09.10. 02:30Z, Bericht `~/pa-orch/reports/dr-sec-01a-a1d9a5fba38d.md`); Folgeschnitte 01b–01i | siehe Archiv | b0221f4a |
| DR-SEC-01g-G1 | [Archiv][pakete] | Root bindet einen Owner im Ticket | DR-SEC-01a Bericht; Design dr-sec-01g-design-49fd851ecbb6 | Server | A | Erledigt #811 (merged 2026-10-09T13:37:17Z); ersetzt: In Prüfung: Open #811 | siehe Archiv | b0221f4a |
| DR-SEC-01g-G2 | Core-Enforcement hinter Ownership | Root bindet einen Owner im Ticket | DR-SEC-01g-G1 | Server | A | Erledigt #866 (merged 2026-10-09T17:10:31Z); ersetzt: Geplant (Design-Bericht) | P9 Rot→Grün; Mutationen/Migration geschützt; Notification-Lücke bleibt explizit | b0221f4a |
| DR-SEC-01g-G3 | [Archiv][pakete] | Root bindet einen Owner im Ticket | DR-SEC-01g-G2 | Server | A | Erledigt #873 (merged 2026-10-09T18:24:46Z); ersetzt: In Prüfung: Draft #873 | siehe Archiv | b0221f4a |
| DR-SEC-01g-G4 | Server-Lifecycle / Admission | Root bindet einen Owner im Ticket | DR-SEC-01g-G3 | Server | A | Entfallen: aufgeteilt in bestehende G4a Signal-Stop / G4b Admission+Drain; ersetzt: Geplant (Design-Bericht) | zweiter Listener mutiert/sendet nicht; Drain vor Release; Interface für DR-16a | b0221f4a |
| DR-SEC-01g-G5 | DR-16-Adapter (G4-Lifecycle nutzen) | DR-16a-Owner | DR-SEC-01g-G4 | Server | A | Entfallen: in DR-16a gefaltet | Root-Disposition 09.10.: kein eigener Schnitt; Abnahme über DR-16a | b0221f4a |
| DR-SEC-01g-G6 | Recovery-/Portability-Abnahme | Root bindet einen Owner im Ticket | DR-SEC-01g-G4 | Server | A | Erledigt #885 (merged 2026-10-09T19:22:15Z); Folge G6-FU Branch claude/g6-fu-tests; ersetzt: Geplant, Spec in Arbeit | beobachteter Exit/Alias; Windows-Beleg; fehlender Heartbeat ≠ Exit | b0221f4a |
| DR-SEC-01h | [Archiv][pakete] | Root bindet einen Owner im Ticket | DR-11/#718 | Server | B | Erledigt #859 (merged 2026-10-09T14:40:42Z); ersetzt: Geplant; nach #718 | siehe Archiv | b0221f4a |
| DR-16a | [Archiv][pakete] | Root benennt einen vorhandenen Serverowner | DR-SEC-01a/b gemergt; DR-SEC-01g-G4, DR-SEC-01h gemergt; DR-07 einschließlich 07c/d/e1/e2 (#752/#753/#751/#755), DR-14, DR-15 einschließlich 15b/#750 und UI-Verdrahtung #718 gemergt | Server | A, zwei Fremdanbieter | Erledigt #863 (merged 2026-10-09T16:34:47Z); ersetzt: Geplant; kein Start aus PLAN-Pflege | siehe Archiv | b0e90b72 |
| DR-16a-H | Switch-Helfer-Härtung (Review-Nachbesserungen) | Root bindet Owner | DR-16a/#863 | Server | A | Erledigt #871 (merged 2026-10-09T18:24:31Z); ersetzt: In Prüfung: Draft #871 (Review-Runde 2) | Tier A; Review-Runde 2 ausstehend | – |
| DR-16b | Live-Drill auf dem PC: Schreibpause, Sicherung, Umschalten, metadatensicherer Rückweg | Stabschef Ausführung, ein Owner | DR-16a gemergt sowie alle dessen Vorgänger; G6; Root-Livefreigabe für exakten SHA und Zeitfenster | PC | A plus unabhängiges Nachlesen | Verschoben: Auslöser v1.6.0 seit 09.10. erreicht, Nutzer-Zeitfenster am PC offen, Nutzer 16.10. (K8, B; Root-Chat): warten, bis die Ablösung des Denkraums geplant wird; ursprünglich: Nach v1.6.0 verschoben (Nutzer 09.10. ~19:42Z: Schritte, die der Nutzer am PC braucht, nach dem Release); Runbook bleibt (pa-orch/wissen/06-anleitungen/2026-10-09_dr16b-pc-drill-runbook.md); ersetzt: Live-Freigabe Nutzer 09.10. ~17:25Z, Probelauf wartet auf G4b/G6 und Nutzer-Zeitfenster; ersetzt: Blockiert bis G0; Kandidat auf v1.6.0 (d2582ceb) neu exportiert; Fenster mit dem Nutzer offen | Gates G0–G7 im gebundenen Vertragsentwurf Ticket b0e90b72; G5 beide UI-Skripte HTTP 200; protokollierter Drill und unabhängige Prüfung; P1/aktuelles Ledger nach Writes erhalten, Root-Abnahme | b0e90b72 |
| DR-17 | Öffentliche README, Anleitung in 5 Schritten, CHANGELOG-Abschnitt Denkraum | Technischer Autor | DR-17a-Entwurf laut Root 09.10. vorgezogen; Trockenlauf nach DR-16a-Merge und Root-Annahme des DR-16b-Protokolls | Server | C | Erledigt #785 (merged 2026-10-09T20:37:12Z): Anleitung gemergt: #785 (gemergt 2026-10-09T20:37:12Z, Trockenlauf der fünf Schritte auf frischer Wegwerf-Instanz im PR-Text); CHANGELOG-Abschnitt final in V16-CHANGELOG; ersetzt: In Prüfung: Entwurf separat #785; Trockenlauf und Gesamt-Abnahme offen | Trockenlauf der 5 Schritte im PR-Text; beide UI-Skripte HTTP 200; eigene prepush; No-Test: documentation only | 55ea21ce |


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
| PLAN-v2.0-3 | Fertiger kurzer kanonischer Master mit verlustfreiem Archiv und finalen Leserbelegen | srv-plan-v2-3; Chief koordiniert, Root nimmt ab | PLAN-v2.0-2/#1863, DS-U0/#1861 und #1862 gemergt | Server | C | Erledigt mit ausdrücklicher Root-Abnahme des fertigen Masters und Merge dieses Dokumentenschnitts; bis dahin Ergebnis zur Prüfung, Elternziel 5936ab8e offen | ≤300 konservative NONMOVE-Zeilen; Spannen-SHA/inverse Rekonstruktion, Restpflichten/Links/Parser, echter nativer Endquellenbeleg und eigene prepush 0; keine Produkt-, externe Gesamt- oder Releaseabnahme | srv-plan-v2-3 |
| Z2-PLAN-COMMIT | P2: v3 in kohärenten Paketen übernehmen; PLAN-C1 stellt Z1–Z4 vor den unveränderten historischen Parserbestand, danach getrennte Archiv-/Bereinigungsschnitte ≤ 300 ALL | Stabschef | Root-Abnahme je Kandidat | egal | C | Erledigt: PLAN-C1 #643 (merged 2026-10-08T05:46:58Z, `0a9a981d`, Kopf `1088909`), Statusnachtrag #646 (`a167486c`); #642 geschlossen als überholt (Nutzer 08.10.); weitere Bereinigungsschnitte ersetzt durch PLAN-CLEAN-1 bis -3 (15.10.); ersetzt: In Prüfung: PLAN-C1 #643 `1088909` tatsächlich 05:46:58 UTC gemergt; #642 geschlossen als überholt (Nutzer 08.10.), Originaldelta bleibt Historie, #646 ist bestehender Statusnachtrag; weitere Archiv-/Bereinigungsschnitte offen | ein kanonischer Plan; DF-Zeilen bytegleich; M1–M5 parsebar; eigene prepush-Lane Exit 0; Archiv erst nach vollständigem Quellenvergleich bereinigen | 55ea21ce |
| MAIN-PROTECT-01 | P0 Sicherheit: geltenden Main-Mergevertrag mit effektivem GitHub-Schutz verankern; tatsächliche Wirkung abgenommen | vorhandener Git-/CI-Owner; Chief disponiert, Root nimmt ab | frische Schutz-/App-/Produkt-/Queuebelege; konkrete Root-Abnahme je Handlung; getrennt von GOALS-B | PC | A | Erledigt: Root-Finalabnahme 06:53:57 UTC; Rulesets A `24699347` und B `24700455` ACTIVE/exakt main, vier App-Checks ohne Checkbypass in A, nur App `10562` Update-Bypass in B; Chief-REST-Readback 10:20 bestätigt Konfiguration, Root-Beleg enthält tatsächliche geschützte Queue #635; keine erneute Produktivaktion | vor jeder Einstellung leere Queue und echte Akteur-/Label-/Dispatch-Pause; vorhandene Produkte erhalten; exakter vierter App-Kontext (nichtpassendes Doku-Paket nur belegtes NEUTRAL); voller Windows-Batch und getrennte Root-A/B-Abnahme | 52f46527 |
| Z2-RULE10 | [Archiv: Historie][historie] | Stabschef | #643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); gemeinsam mit GOALS-B | egal | C | Erledigt: Root-abgenommener #644 `4032800` am 08.10. 07:12:55 UTC gemergt, nach #643; allgemeine Sitzungsadoption nicht daraus abgeleitet | siehe Archiv | 52f46527 |
| HOOK-WIN | [Archiv][pakete] | vorhandener Implementierer · Claude; Chief koordiniert | vorhandene Runtime-/Rot-/Gate-/Vendor-Belege; finaler PR-Bericht vor Ready | PC | A | Erledigt: Root-abgenommene Source #641 `bf89c435`/292 ALL am 08.10. 06:10:42 UTC gemergt; Home-Wirksamkeit nur durch separate jeweilige Runtimebelege, keine neue pauschale Behauptung | siehe Archiv | b14492cb |
| GOALS-A | P1 jetzt: Ist-Abgleich früherer Aufträge, realer Native-Goals, laufender Owner und PLAN; verhindert Doppelstarts und unbelegte Abschlüsse | Stabschef; Root nimmt ab | bestehende Übergaben und eigene Goal-Werkzeuge je Session | egal | C | Erledigt: begrenztes Ist-Abgleich-Handover von Root 02:56 UTC angenommen; Chief-Native-Abschluss 02:57:37 belegt, spätere Koordination hat eigenes aktives Ziel | eine Zeile je Live-Agent: Ziel, eigener get/create-Beleg oder belegte Nichtverfügbarkeit plus Ticketziel, Meilenstein und Grenze; kein Plantext als Goal-Beleg | 52f46527 |
| GOALS-B | [Archiv: Historie][historie] | Stabschef als Editor; Root nimmt ab | #643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); Z2-RULE10 im selben Dokumentationspaket | egal | C | Erledigt: Root-abgenommenes Dokumentationspaket #644 `4032800` tatsächlich 07:12:55 UTC gemergt; vier bestehende Skills gespeichert/zurückgelesen; Adoption bleibt ausschließlich sitzungsweise belegt, keine allgemeine Wirksamkeitsbehauptung | siehe Archiv | 52f46527 |
| GOALS-C | P2 begleitend: drei vorhandene Praxisproben Lane F, DR-02 und HOOK-WIN auswerten; Stichprobe, kein Wirksamkeitsbeweis; keine neuen Jobs/QA/Benchmarks | ausführende Owner dokumentieren; Root bewertet | vorhandene Fix-, Review- und Runtimebelege | egal | C | Erledigt: genau drei Proben samt Messlücken von Root 02:56 UTC angenommen; selektive Nutzung, kein vierter Versuch aus späteren Fixes | je Ticket Mangel/kein Mangel, Bestätigung, beobachtete Regressionen, nur gemessener Zusatzaufwand; bei überwiegendem Aufwand Anwendung begrenzen | 52f46527, 55ea21ce, b14492cb |
| DEV-KNOW-01 | P2: freigegebenen EIN-Thema-Wissenspilot begrenzt auswerten; Quellenindex gegen zwölf Karten, kein Ausbau ohne belegten Nutzen | einziger Messowner Implementierer · Codex `8qyt6d`; Chief übernimmt Bericht, Root nimmt ab | Vorbereitung #651 `1205081` angenommen; eingefrorene neun Quellen und fünf Fragen; Z1-Slots frei halten | private leichte Messroute | C | Verschoben: nach v1.6.0, Nutzer 08.10.; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): Rest Quellenindex nach „Später“ (v2.x), keine neue Messung; bisheriger begrenzter Messschnitt erledigt: 20+6-Originalübergabe samt Korrekturappend Root-ACCEPT 09:22:35 (`198949e8`); rationale-only-Nachtrag separat ACCEPT 10:10:29 (`1dbb4ebb`, operative REPORT `8f3f0796`, Input `20c2571d`, Assessment `71d3d6df`, Handover `b5c7a645`), Originale erhalten; eigene Mess-/Koordinationsgoals COMPLETE; kein konsistenter Nettoqualitätsgewinn, Quellenindex empfohlen; keine neue Messung/automatische Übernahme | getrennte Claude-/Codex-Vergleiche, gleiche Fragen/Revisionen und Parameter je Anbieter; Qualität/Kontext/Sucharbeit/Pflege mit Messlücken, sechs begrenzte Fälle; Nullbefund zulässig, keine automatische Übernahme | 57979887 |
| Z2-REGELN | Regelwerk 2.0: Lane-A-Korrekturen (6) abschließen, Anweisungsdateien entschlacken (Lane C, Commit 6918bea), Altlasten-Audit liefert „Deine Regeln: bestätigen oder ändern“ | Stabschef + Codebase Archäologe | – | egal | C | Geplant: Lane-C-Teil entfallen (Commit `6918bea` nur in #642, geschlossen 08.10., PR-ALT) → Z2-AGENTS-SLIM; Lane-A-Korrekturen: Unbekannt (zu prüfen), kein PR seit 08.10.; R1–R5 am 16.10. entschieden (Inbox), Root disponiert den Rest; ersetzt: In Arbeit | Lane-C-PR gemergt; `npm run dev:agent-check` Exit 0; Regel-Vorschläge R1–R5 in der Inbox entschieden | 77c993f3 |
| DOC-OPERATORS | [Archiv][pakete] | bestehender Root-Serverjob; kein zweiter Anweisungseditor | konkrete Disposition zu #642 erhalten | Server | C | Erledigt #683 (merged 2026-10-08T15:42:28Z) | siehe Archiv | 77c993f3 |
| Z2-AGENTS-SLIM | AGENTS.md auf etwa ≤ 8 KB reduzieren: Kernregeln, Befehle und Merge-Kurzregel erhalten, Referenzdetails per eindeutigem Pfad auslagern | ein von Stabschef Ausführung benannter Doku-Owner; Chief pflegt nur PLAN | DR-12 gemergt/abgenommen; DOC-OPERATORS integriert; #642 geschlossen (Nutzer 08.10.); frischer Dateischnitt/Owner | Server | C | In Prüfung: Draft #1832, Kopf `1e1b068b1c51f2261027ed25ee0b50d8fbd12882`; S1 samt Nachbesserung geliefert, Root-Abnahme offen; laut PR 25797 Bytes, Gesamtziel ≤8192 Bytes bleibt offen; keine zweite Ausführung aus diesem Eintrag; weitere Schnitte gegen KONZEPT-0 abgrenzen; ersetzt: Bereit nach DR-12; Owner/Guard und Root-Zuweisung vor Ausführung | AGENTS.md plus eindeutige docs/development/AGENTS_REFERENCE.md; bestehende Referenzen nur lesen; globale CLAUDE/MEMORY und Standard-Skills ausgenommen; Regel-für-Regel-Mapping, Linkcheck, dev:agent-check und eigene prepush Exit 0; ≤ 300 ALL, sonst vor Start serielle Schnitte; Byteziel ist kein Token-/Wirksamkeitsbeleg | 77c993f3 |
| Z2-RECHTE | Konsolidiertes Rechtekonzept V3, Herkunft und Disposition erhalten | Konzeptowner lz0jwp; finale Konzeptabnahme Root | privates Bundle V3 `B368BB476E8E`; E1–E5 entschieden | bestehender Konzept-Arbeitsort | C | Erledigt: nur Konzept von Root nach Fable-CONCUR abgenommen (08.10., 15:23Z); E5 bestätigt 15:26Z; keine technische Aktivierung | vier Original-/Kopie-Paare gegen Manifest geprüft; Umsetzung nur über folgende getrennte Schnitte; E2-Schreibhost noch zu benennen | b2f36f8a |
| Z2-RECHTE-P1 | Ein privater Quellen-/Rechte-/Dispositionseintrag für den ausgewählten Werkzeugfall; Originaltexte und Ersetzungslinks erhalten | bestehender Konzeptowner lz0jwp; Ausführungskoordination beim neuen Stabschef | V3 + E5; konkreter privater Zielpfad und Ausgangsdigest vor Start festhalten | privater bestehender Wissensbereich | C | Geplant: geschnitten, noch nicht gestartet; Dokumentation, keine Settings-/Rechteaktivierung; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | ≤ 300 ALL; Quelle/Datum/Digest, ursprünglicher Scope, geltende Disposition, Projektion, Owner, fehlende Belege und nächster Schritt; Reset-, alte RH-C9- und Force-push-Ersetzungen getrennt; QA bleibt ausdrücklich beauftragt; kein privater Wortlaut in Git/PR | b2f36f8a |
| Z2-RECHTE-PILOT | Ein realer rust-analyzer/rust-src-Fall: manuelle Baseline gegen Shadow-Vorbereitung vergleichen | neuer Stabschef benennt bestehenden Werkzeugowner und genau einen tatsächlichen Schreibhost vor Zulassung; Root nimmt Shadow ab | P1; frischer Toolchain-/Client-/Komponenten-/PATH-/Home-Beleg, Quellenbindung und freie Eigentümerschaft | tatsächlicher Windows-Zielhost, noch ungebunden | C für Messbericht; technische Folgedeltas nach Dateien neu einstufen | Verschoben: nach v1.6.0, Nutzer 08.10.; Owner/Host fehlen weiter; keine technische Aktivierung; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“ (v2.x), Rechte werden in v2 als Code-Prüfung gebaut (ADR-V2-03) | ≤ 300 ALL je Schnitt; ein gepaarter Nicht-Z2-Fall, Zeit-/Aufrufbelege einschließlich Vorbereitung/Prüfung/Nacharbeit/Recovery; Netto-Nutzen > 0 und > gemessene Vergleichsunsicherheit, sonst nicht belegt; negative Shadow-Fälle keine Laufzeit-PASS; tatsächlicher Effekt erst separat nach Shadow-Abnahme, danach installiert/geladen/funktional getrennt belegen | b2f36f8a |
| Z2-DOKSYNC | `KNOWN_ISSUES.md` „Offen“ bereinigen: KI-15, KI-16, KI-20 mit PR-Beleg; KI-33 bleibt „Kandidat“, bis ein Windows-Queue-Lauf mit der Änderung beobachtet ist | bestehender Root-Serverjob, kein zweiter Owner | – | Server | C | Erledigt #670 (merged 2026-10-08T14:34:08Z) | Jede verschobene Zeile nennt PR und Merge; KI-33 nur mit Windows-Queue-Lauf-ID und Dauer nach „Behoben“; precommit-Lane Exit 0 | 051bdfa0 |
| PLAN-V2-SUB-ACCEPTANCE-REFS | Abnahmeverweise im [v2-Unterplan](plan/v2.0/plan.md#101-restpakete-v20-eng) berichtigen | srv-sub-plan-r1862-1-astra; Stabschef koordiniert, Root nimmt ab | #1858, #1863 und #1861 gemergt; eigener serieller PLAN-Schreibslot | Server | C | Erledigt mit Root-Abnahme und Merge dieses Dokumentenschnitts: Unterplan kennzeichnet #1540/#1544 als geschlossene, nicht gemergte Kriterienreferenzen; technische Glass-Abnahme und Klick-Checkliste warten auf Neuzuschnitt | Eigene eindeutige Zeile, unveränderte Kriterien und 844 Unterplan-Zeilen; Parser, Plancheck, Links/Fragmente und aktive Verträge am Kandidaten und integrierten Master erhalten; eigene prepush Exit 0; D1-on, echte Nutzer-UAT, Beta-/Update-Drill, E14-Releasebeleg, Release-Sperre und frisches Major-Ja bleiben erforderlich; keine Produktabnahme oder Erledigung des Gesamtplans | f4c26cab-d281-4b16-8cd3-1377fca8d696 |
| Z2-AUTOSTART | Denkraum startet nach der Windows-Anmeldung von selbst, ohne Secret-Eingabe | Desktop-App-Entwickler | DR-15, DR-06 | PC | A | Geplant; seit 08.10. ohne PR oder Beleg; hängt an der offenen Start-/Nutzerabnahme von DR-15 | PC-Neustart → `127.0.0.1:4791` antwortet ohne Eingabe; kein Secret im Klartext | – |
| Z2-PACER | Pacer läuft: Trigger mit Werkzeugen, aber nur lesend; Bericht alle 20 min | Stabschef | Inbox R5 | PC | C | Verschoben: geparkt, Nutzer 16.10. (K10, B; Root-Chat); seit 08.10. ohne PR oder Beleg | drei Läufe nacheinander mit Bericht, keine Schreibaktion | – |
| Z2-REVIEW | Zwei feste Fremdanbieter-Wege für Stufe A: Gemini/Cursor auf dem Server (Workspace Trust), Ollama Kimi K3 + GLM, Codex; je Weg eine Probe mit beobachtetem Modell | Root disponiert Fremdvendor-Reviews; Git-/CI-Owner qualifiziert Wege | WT entschieden (F1, 08.10.); Modell-/Head-Belege weiter Pflicht | Server | C | In Arbeit: Root übernimmt Tier-A-Zweitanbieter über vorhandenen Ollama-GLM/Kimi-Weg laut Übergabe; kein Google-Folgelauf, Modell-/Head-Belege weiter Pflicht; Reviewerzahl und -familien jetzt durch `docs/decisions.md` „Reviewer count per tier“ (15.10.) geregelt, vorhandene Ollama-Route für glm-5.3, glm-5.3-flash und deepseek-v4.1-flash laut Nutzerfreigabe 20.10. zugelassen (AGENTS.md), kein Nachkauf; daraus folgt kein erfolgreicher Wegebeleg; Wegeprobe je Weg (Abnahme): Unbekannt (zu prüfen) | Probe je Weg mit Modellname und Zeit; Weg in `docs/setup/` beschrieben | c77f6955 |
| Z2-RAM | RAM-/Server-Standard: schwer = Server; PC nur leicht bei ≥ 1,5 GiB; idle Konsolen schließen; RAM-Wächter | Autonomer Optimierungsarchitekt | – | PC + Server | C | Geplant; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | 24 h ohne „local heavy STOP“, Messung im Ticket | – |
| Z2-ROUTE | Verteilung nach Verbrauchstempo über `usage_overview`; Quota-Regeln erneuern; Officer-Routine neu anmelden | Stabschef Ausführung beobachtet/routet; keine eigenmächtige Quota-Regeländerung | Nutzer: Re-Login | PC | C | Geplant: Routing-Regel steht in AGENTS.md „Routing“ (AP-6a, `2648f097`, 14.10.); Wochenbeleg und Abdeckung von Z2-ROUTE: Unbekannt (zu prüfen) | eine Woche ohne Anbieter am Limit; Routing-Beleg je Start | 492a9e36 |
| Z2-BOARD | Board aufräumen: erledigte/veraltete Tickets schließen (ef39c814, 2720b77f, 5945accc, 5de5c4c9, 7b66731d), Kurzstand-Block je Ticket, Ready-Queue ≥ 5 pflegen | Stabschef Ausführung: Ready-Reserve, Lane-/Blocker-Beobachtung; Chief nur PLAN | – | egal | – | Bereit; seit 08.10. ohne Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen) | `backlog_list`: keine erledigten Tickets mehr offen | – |
| DS-T-02 | [Archiv: Historie][historie] | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1610 (merged 2026-10-16); unbekannte Lampe ist ein grauer geschlossener Ring, Balken ohne Messwert hat keinen Wert, Kontingente zeigen „Unbekannt“; Kartenlampe (`lampFor`) bleibt DS-T-03 | siehe Archiv | – |
| DS-T-01 | Vertrauensfehler P1-a: die Hauptansicht unterscheidet „unbekannt“ von „leer“ (`LeitstandRoute.tsx`, `NeedsYou.tsx`, `de.ts`) | Implementierer · Claude; Root nimmt ab | DS-X-01 (#1604); DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1623 (merged 2026-10-16); Haupt sagt „Agenten werden gelesen …“, „Nicht verbunden“ mit „Erneut lesen“ oder „Kein Projekt gewählt“ statt „Noch kein Agent“, behält die Karten bei fehlgeschlagenem Nachladen („Aktualisierung fehlgeschlagen“, ohne Alter des letzten Stands) und „Braucht dich“ zeigt die Leermeldung erst nach gelesener Liste | fünf Test-First-Tests rot an der Merge-Base, grün am Kopf (`red-first.sh` Exit 0); typecheck, `node scripts/contrast-check.mjs` und prepush Exit 0; zwei Stufe-B-Reviews verschiedener Nicht-Autor-Familien: Subscription + OpenRouter; Root-Abnahme | – |
| DS-T-05 | [Archiv: Historie][historie] | Implementierer · Claude; Root nimmt ab | DS-T-01 (#1623); DS-Blueprint-Schnitt 16.10. (§2.2), Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1629 (merged 2026-10-16); leere Hauptansicht bietet „Auftrag einreihen“ (öffnet Betrieb mit dem Einreih-Formular), ohne Projekt „Projekt anlegen“ (öffnet Werkzeuge, dort steht „Projekt hinzufügen“); beide Knöpfe navigieren nur, der Direktstart bleibt KR-05a | siehe Archiv | – |
| DS-X-03 | Bewegungsmodus Ruhig/Lebendig/Aus und useMotion, OS-Vorrang: Einstellung unter Einstellungen › Darstellung, `<html data-motion>`, `useMotion()` in `src/design/motion/motionMode.ts`; Fluss-Kanten bewegen sich nur in Lebendig | Implementierer · Claude; Root nimmt ab | DS-01; Entscheidung D2 (`docs/decisions.md`) | Server | B | Erledigt: #1606 (merged 2026-10-16); Anwendung der übrigen Bewegungstoken folgt in DS-X-12/24; ersetzt DS-02 ([v2-Unterplan §10.3](plan/v2.0/plan.md#103-designsystem-feinschliff)) | red-first Vitest-Tests; typecheck, contrast-check und prepush Exit 0; zwei Stufe-B-Reviews fremder Familien | – |
| DS-T-04 | [Archiv][pakete] | Implementierer · Claude; Root nimmt ab | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1609 (merged 2026-10-16); der Suchknopf heißt immer „Seiten und Befehle suchen“, auch wenn Text und Kürzel ausgeblendet sind | siehe Archiv | – |
| DS-X-02 | Additive Design-Skalen und Breakpoint-Konstante (Fabrik-Designsystem, Welle 0): Schrift-, Abstands-, Radius-, Höhen-, Ebenen- und Fokus-Token in `src/design/tokens.css`, `BREAKPOINTS` in `src/design/breakpoints.ts` | Implementierer · Claude; Root nimmt ab | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`) | Server | B | Erledigt: #1601 (merged 2026-10-16); Tokens und Breakpoint-Konstante geliefert, Umstellung der Ansichten separat | `vitest run src/design` Exit 0; contrast-check grün; prepush Exit 0; zwei Stufe-B-Reviews fremder Familien | – |
| DS-X-04 | [Archiv: Historie][historie] | Root | Entscheidung D4 vom 15.10. (`docs/decisions.md`) | Server | B | Erledigt: PR #1603; statischer Orb, Aliase und Kontrastprüfung geliefert; Bildschirmeinbindung und Bewegung bleiben DS-X-23/24 beziehungsweise DN-03. | siehe Archiv | – |
| DS-X-05 | Formular-Bausteine `Field` und `Checkbox` (Fabrik-Designsystem, Welle 1): `src/design/forms/{Field,Checkbox}.tsx` und `forms.css`; Beschriftung, Hinweis und Fehlertext hängen per Kennung am Steuerelement, das Ankreuzfeld kennt „teils“ | Implementierer · Claude; Root nimmt ab | Designsystem-Entscheidungen D1–D7 (`docs/decisions.md`); DS-Blueprint-Schnitt 16.10. (DS-X-05) | Server | B | Erledigt: #1678 (merged 2026-10-17); Bausteine nur im Register und in der Galerie-Navigation, keine Ansicht umgestellt (RadioGroup und SwitchField folgen in DS-X-06) | Tests rot→grün (`red-first.sh` Exit 0); `vitest run src/design`, typecheck, `contrast-check`, `plan-check --offline` und prepush Exit 0; Bildschirmfotos hell/dunkel; ein Stufe-B-Review einer Nicht-Anthropic-Familie, Root kommissioniert | – |
| DS-X-06 | Formular-Bausteine `RadioGroup` (ein Tabstopp, Pfeiltasten wählen, Pos1/Ende springen) und `SwitchField` (Beschriftung und Zustandswort „An“/„Aus“ sind ein Steuerelement) in `src/design/forms/`; die Vorschau-Schalter unter Einstellungen › Allgemein und `PreviewToggle` sind jetzt Schalter; was die Schalter bewirken, bleibt gleich | Implementierer · Claude; Root nimmt ab | DS-X-05 (#1678); DS-Blueprint-Schnitt 16.10. (DS-X-06) | Server | B | Erledigt: #1687 (merged 2026-10-17); `WegWahl.tsx` bleibt unberührt (KR-05a) | Tests rot→grün (`red-first.sh` Exit 0); `vitest run`, typecheck, `contrast-check`, `plan-check --offline` und prepush Exit 0; Bildschirmfotos hell/dunkel; ein Stufe-B-Review einer Nicht-Anthropic-Familie, Root kommissioniert | – |
| DS-X-11 | [Archiv][pakete] | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-11) | Server | B | Erledigt: #1673 (merged 2026-10-17); keine Bildschirmmigration, die Halle (DS-H-05) bindet die Zeile seit #1680 ein | siehe Archiv | – |
| DS-X-14 | Komponenten-Register und Abdeckungstest: `src/design/registry.ts` führt jede exportierte Designkomponente einmal (Familie, Varianten, Zustände, Bedienhilfe, Textquelle), `registry.coverage.test.ts` wird rot, wenn eine fehlt oder ein Eintrag keine Komponente mehr trifft | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-14) | Server | B | Erledigt: #1656 (merged 2026-10-16); 25 Komponenten gelistet, auch `hall/` wird gescannt (dort noch keine .tsx, DS-H-04 trägt seinen Eintrag selbst ein); Galerie DS-X-15 und Geschichten DS-X-16/17 lesen später dieses Register | Abdeckungstest rot→grün; `vitest run src/design`, typecheck, `plan-check --offline` und prepush Exit 0; zwei Stufe-B-Reviews fremder Nicht-Anthropic-Familien | – |
| DS-X-15 | Designsystem-Galerie, Hülle und Grundlagen (D6): Einstellungen › Version › „Designsystem ansehen“ öffnet `#/designsystem` (eigener `React.lazy`-Chunk, außerhalb von `ROUTES`, also nicht in Seitenleiste oder Palette); Navigation über die Register-Familien, Seiten Farben (Kontrast zur Grundfläche), Schrift, Abstand, Radius, Glas, Bewegung (ruht bei reduzierter Bewegung); keine echten Daten, Beispielinhalt trägt „Beispieldaten“ | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-15) | Server | B | Erledigt: #1662 (merged 2026-10-16); Geschichten je Baustein kommen mit DS-X-16/17, Werkzeugleiste und Übertrag aus #1656 (DS-X-14b) nicht enthalten | Tests rot→grün; `vitest run`, typecheck, `contrast-check`, `plan-check --offline` und prepush Exit 0; Bildschirmfotos hell/dunkel; zwei Stufe-B-Reviews fremder Nicht-Anthropic-Familien | – |
| DS-X-16 | Galerie-Geschichten für alle Registereinträge der Familien controls und inputs: Zustandsmatrix über data-force-state und die echten CSS-Regeln, nicht anwendbare Zustände benannt, sichtbare Beispieldaten, Texte aus de.ts | Implementierer · Codex; Root nimmt ab | DS-X-15 (#1662); DS-Blueprint-Schnitt 16.10. (DS-X-16) | Server | B | Erledigt: #1712 (merged 2026-10-20); ursprünglich: In Prüfung: Entwurfs-PR auf codex/ds-x-16; nach Merge sind 13 Geschichten mit Abdeckungstest vorhanden; weitere Familien bleiben DS-X-17, shot.mjs bleibt DS-H-07b | Tests rot→grün; Design-Tests, typecheck, contrast-check, plan-check --offline und eigene prepush Exit 0; Bilder beider Familien hell/dunkel geprüft; ein unabhängiger Stufe-B-Review, Root beauftragt | – |
| DS-X-20 | Bedienelemente: `controls/IconButton.tsx` (quadratischer Button, `aria-label` per Typ Pflicht und in der Entwicklung per Fehler), `Button loading` (`aria-busy`, Beschriftung und Breite bleiben, ein zweiter Klick wird verschluckt, kleiner Ring ohne neue Spinner-Komponente), ein einziger Sperrzustand (`--g-disabled-opacity`) für alle Design-Bausteine, und `layout/Tabs.tsx` `TabLinks` (Link-Reiter mit der Tastenführung von `Tabs`); die Leitstand-Reiter (`LeitstandTabs`) nutzen `TabLinks` statt eigenem `.g-shell-tabs`-Markup | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-20); DS-X-01, DS-X-02 | Server | B | Erledigt: #1706 (merged 2026-10-20); ursprünglich: Entwurfs-PR offen (18.10.): Plan-ID DS-X-20; nach Merge sehen die Leitstand-Reiter unverändert aus, Pfeiltasten, Pos1 und Ende bewegen den Fokus zwischen den Links; keine Kopfzeilen-Änderung (DS-X-10 wartet), kein Symbolsatz (DS-X-21); die Reiter von Shell, Verlauf und Steuerung bleiben bis zu ihrer Migration beim alten Markup | Tests rot→grün; `vitest run src/design`, typecheck, `contrast-check`, `plan-check --offline` und prepush Exit 0; Bilder der Leitstand-Reiter vorher/nachher und von IconButton und ladendem Button, hell und dunkel; ein Stufe-B-Review einer Nicht-Anthropic-Familie | – |
| DS-X-22 | Baukasten-Anleitung und Sprachregeln: `docs/design/BUILDING.md` (welcher Baustein für welche Aufgabe, nur Token, Texte über `src/i18n/de.ts`, Zustandswörter aus `states.ts`, Bewegungsregeln, „Muster kopieren, nicht installieren“, Lizenzliste) und `docs/design/voice.md` (acht Sprachregeln); die veralteten Kopfzeilen „Not imported by the app“ in den Design-Stylesheets entfallen | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-22) | Server | C | Erledigt: #1699 (merged 2026-10-17); es gibt die beiden Anleitungen und kein Stylesheet unter `src/design/` behauptet mehr, nicht eingebunden zu sein; der Verweis aus `AGENTS.md` kommt von Root, kein Code und keine CSS-Regel ändert sich | `plan-check --offline` und prepush Exit 0; Stufe C, die Gates genügen | – |
| DS-U0 | Kanonische Designquelle in der [Fabrik-README](design/2026-10-fabrik/README.md) benennen | srv-ds-u0-r1861-1; Stabschef koordiniert, Root nimmt ab | DS-X-22; unabhängige README-Korrektur freigegeben (Root 23.10.) | Server | C | Erledigt mit Root-Abnahme und Merge von #1861: README nennt `src/design/` als kanonische Quelle, verlinkt [BUILDING](design/BUILDING.md) und kennzeichnet Artefakte als Anzeige-/Referenzkopien; Fabrik folgt später als Familie auf gemeinsamen `--g-*`-Tokens und Schnittstellen | README unverändert erhalten; eigene PLAN-Zeile, Parser/Plancheck/Links und prepush Exit 0; keine Laufzeit-, UI-, Schrift-, Vereinheitlichungs-, Nutzer- oder Release-Abnahme | 56e2f1e2-c6a8-48fa-86a3-a84000744a34 |
| DS-X-07 | [Archiv: Historie][historie] | Implementierer · Claude; Root nimmt ab | DS-X-03 (#1606); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-07) | Server | B | Erledigt: #1683 (merged 2026-10-17) | siehe Archiv | – |
| DS-X-08 | [Archiv: Historie][historie]; noch an keine Ansicht angeschlossen (jedes Paket, das ihn an Löschen, Zusammenführen oder Überschreiben hängt, ist Stufe A) | Implementierer · Claude; Root nimmt ab | DS-X-07 (#1683); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-08) | Server | B | Erledigt: #1700 gemergt 2026-10-20 (`a4ef7057`, Kopf `414001b4`); Reviews und Disposition im PR | siehe Archiv | – |
| DS-X-09 | [Archiv: Historie][historie] | Implementierer · Claude; Root nimmt ab | DS-X-05 (#1678); DS-Blueprint-Schnitt 16.10. (Zeile DS-X-09) | Server | B | Erledigt: #1692 (merged 2026-10-17); keine Ansicht umgestellt (KR-07*, 10e folgen) | siehe Archiv | – |
| DS-X-21 | Ein Symbolsatz auf 20-px-Raster: `Icon` in `src/design/icons/` (ohne Beschriftung für Hilfstechnik verborgen, mit `label` als `role="img"`, Farbe über `currentColor`) und 24 Lucide-Pfade als Daten (`glyphs.ts`), dazu Entsprechungen für die 14 klassischen Symbole, die Seitenleisten-Symbole und den Auswahl-Pfeil; Lizenztext `LUCIDE-LIZENZ.txt` neben den Symbolen und Eintrag in `docs/THIRD_PARTY_NOTICES.md` | Implementierer · Claude; Root nimmt ab | DS-Blueprint-Schnitt 16.10. (DS-X-21), Root-Entscheidung 17.10.: Pfade kopieren, kein Paket | Server | B + Lizenzprüfung | Erledigt: #1701 (merged 2026-10-20); ursprünglich: Entwurfs-PR offen (17.10.): kein Aufrufer umgestellt, `src/components/Icon.tsx` bleibt bis KR-15; Galerie zeigt den Satz unter „Symbole“ | Tests rot→grün; `vitest run src/design`, typecheck, `contrast-check`, `plan-check --offline` und prepush Exit 0; Bilder der Galerie hell und dunkel; ein Stufe-B-Review einer Nicht-Anthropic-Familie, Root prüft den Lizenzhinweis | – |
| DS-X-32 | [Archiv: Historie][historie] | Implementierer · Claude; Root nimmt ab | DS-X-02; DS-Blueprint-Schnitt 16.10. (Zeile DS-X-32) | Server | B | Erledigt: #1702 (merged 2026-10-18), Branch `claude/ds-x-32`; die sechs Datenfarben stehen in `tokens.css`, `contrast-check` prüft sie und die Galerie-Seite Farben zeigt sie, Diagramm-Bausteine folgen mit DS-X-33 | siehe Archiv | – |
| DS-X-33 | Diagramm-Bausteine in `src/design/data/`: `Sparkline`, beschriftete `BarList` und `ChartFrame` mit Titel, Beschreibung, Legende und verpflichtender Tabellenansicht aus denselben Daten; ausschließlich Datenfarben, leere und unbekannte Werte als Wörter, statisch; Register und deutsche Texte ergänzt; keine bestehenden Ansichten umgestellt | Implementierer · Codex; Root nimmt ab | DS-X-32 (#1702, `4a9c8a5b`); DS-Blueprint-Schnitt 16.10. | Server | B | Erledigt: #1717 (merged 2026-10-20); ursprünglich: In Prüfung: Entwurfs-PR `codex/ds-x-33`; nach Merge stehen die drei Bausteine samt Tabellenansicht bereit | vier benannte Tests rot→grün; Registerabdeckung, typecheck, contrast-check, `plan-check --offline` und eigene prepush Exit 0; betrachtete Bilder hell/dunkel mit offener Tabelle; unabhängiger Nicht-OpenAI-Review durch Root ausstehend | – |
| DS-T-03 | Vertrauensfehler P1-b/e: die Kartenlampe sagt, was bewiesen ist (`lampFor.ts`, `lamps/texts.ts`, `AgentCard.tsx`, `FlowTab.tsx`) | Implementierer · Claude; Root nimmt ab | Lampenform aus DS-T-02 (#1610) | Server | B | Erledigt: #1624 (merged 2026-10-16); unbekannte Spalte oder unbekannter Worker-Status zeigt auf Karte und Fabrik-Knoten die graue Unbekannt-Lampe statt „Läuft“, die grüne Lampe heißt „Test bestanden“ mit dem Alter des Testlaufs; welcher Stand getestet wurde, bleibt ein späteres Nahtpaket | fünf Test-First-Tests rot an der Merge-Base, grün am Kopf (`red-first.sh` Exit 0); typecheck, `node scripts/contrast-check.mjs` und prepush Exit 0; zwei Stufe-B-Reviews verschiedener Nicht-Autor-Familien: Subscription + OpenRouter; Root-Abnahme | – |

Historische Routing-/Guthabenangaben stehen im [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context). Aktuelle Zulassung folgt AGENTS.md und dem konkreten Auftrag; kein Reset, Nachkauf oder Zen-Start aus diesem Plan.


### DOC und Hook-Pakete — Nachtrag 21.10.2026

[Datierter DOC-8-Teilstand](archive/plan-2026-10/context-2026-10-23.md#doc-snapshot-on-21-october). Root nimmt ab und integriert, Chief koordiniert; Planer bleibt gestoppt. Je Paket eigene Größen-, Gate-, Leser-/Link- und Reviewbelege; C2 sind Hook-Prüffälle, P9 der Folgeauftrag im ruhenden Terminal. Quellenbindung bleibt eigene externe A1-Abnahme.

Die frühere Pflicht „DOC-3 vor DOC-9-Bericht“ wurde verfehlt: #1783 war vor Roots Wahl von Option B gemergt. Das wird nicht rückwirkend erfüllt. Jetzt gilt: DOC-3-Lieferung samt Erhaltungs-/Leserbelegen und Root-Disposition → Endquellenabgleich/Berichtsaktualisierung → externe Nachprüfung. DOC-3 blockiert die externe Endabnahme, nicht den bereits gelieferten Bericht.
A1–A4 sind weiter getrennte offene Abnahmen. A3 ist nach tatsächlichem Merge dieses PLAN-Abgleichs und DOC-3B durch einen anderen GPT-6.1-Agenten am endgültigen main zu erneuern; der alte Nachweis an `213d29a3` gilt nur dort. Keine Bytezahl beweist Tokenersparnis, Laufzeit oder Nutzerabnahme.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-1 | Historie mit Leserbelegen archivieren | srv-doc-1-plan-archive | – | Server | C | Erledigt: #1760 `a226b995`, Merge `f3a156fe` 21.10. 01:28:41Z | Root entschied MERGE; DOC-1b und DOC-9 bleiben getrennt | 148253cc |
| DOC-2 | Entscheidungsindex mit Journal | srv-doc-2-decisions-index | – | Server | C | Erledigt: #1761 `67a63f11`, Merge `a19aa18e` 21.10. 01:46:07Z | Quellen/Anker/Journal erhalten; Verweis/Kosmetik hier angewandt | 9f78f652 |
| DOC-3 | v2-Rest vereinfachen | srv-doc3-b-history; Root nimmt ab | DOC-3a | Server | C | Erledigt: Option B #1791 `57dd2ae8`, Merge `b375265b` 21.10. 19:43:47Z | Root nahm den Kopf nach Runde 1 an; §3.14, §4.1, §§8–9, §10.4 verlustfrei ausgelagert, Zellen/Leser/Anker laut Belegen erhalten; §4/4b und weitere datierte Inhalte bleiben Option-B-Grenze; externe DOC-3-Abnahme OFFEN, Endquellenabgleich/A3 und externe Nachprüfung folgen; verfehlte DOC-3-vor-DOC-9-Reihenfolge bleibt Historie | f7e87a76 |
| DOC-3a | Größenentwurf bytegleich auslagern | srv-doc-3a-v2-slice | – | Server | C | Erledigt: #1762 `8ac7fb23`, Merge `b24cb498` 21.10. 02:01:05Z | v2-Zellen/Versatz/native Tests erhalten; DOC-3-Rest bleibt offen | 3f7748a1 |
| DOC-4 | Betriebsregeln abgleichen | srv-doc-4-rules-reconcile | – | Server | C | Erledigt: #1759 `729a41ae`, Merge `a341e968` 21.10. 01:46:21Z | Kernregeln/Rechte/Limits erhalten; integriert | 90435bab |
| DOC-5 | Begrenztes Speicherpaket | Speicherowner; Root | – | egal | C | In Prüfung: Root angenommen laut Auftrag 20.10. 23:07:57Z, Entscheid D24, Nicht-Git | gemeldet 31633 Bytes/178 Zeilen; Nutzerchat 20.10.: OpenAI 828400 Kontexttokens akzeptiert, andere Modelle weiter 1M; Laufzeit/automatische Kontext-/UI-/Tokenlimits separat durch Root zu belegen | 252b26ed |
| DOC-6 | Quellenalter/Prüflücken zeigen | srv-doc-6-roadmap-honest | – | Server | B | Erledigt: #1758 `3874d77d`, Merge `4cb2622d` 21.10. 00:45:42Z | unbekannte/alte Quellen sichtbar; integriert, keine App-Laufzeitabnahme | e9df1aff |
| DOC-7 | Issue-/Stand-Archiv validieren | Codebase-Archäologe (Agent) | – | PC/Server | C | Erledigt: #1764 `91f6b024`, Merge `b02f64af` 21.10. 01:57:39Z | Autor meldet Windows-prepush 0; Beobachter prüfte Inhalt/Leser, nicht volle Gates; ROOT-R2-1-Pointer hier angewandt | 69c96921 |
| DOC-8 | Kanonische DOC-/Hook-Zeilen | srv-doc-8-plan-rows | DOC-1 | Server | C | Erledigt: #1763 `18fa7510`, Merge `fd66e121` 21.10. 01:57:32Z | Leser/Plancheck/HQ/Links/prepush laut Report; DOC-1b separat | a40db352 |
| DOC-9 | Abschluss mit Lieferständen | Root berichtet; Chief belegt | DOC-1, DOC-2, DOC-3, DOC-3a, DOC-4, DOC-5, DOC-6, DOC-7, DOC-8, DOC-1b | egal | C | In Prüfung: Bericht #1783 `4681ddbc` geliefert und gemergt (`213d29a3`, 21.10. 17:27:24Z); externe Endabnahme offen | Root gleicht Gesamtquellen nach DOC-3-Lieferung #1791 und A1b #1793 mit verbleibenden Beleglücken ab; A1 Quellenbindung mit expliziten Grenzen, A2 DOC-3/PLAN, A3 nativer Leser am Endstand, A4 neustartfester Stopp noch extern abzunehmen; A3 erst nach Merge dieses PLAN-Abgleichs separat erneuern, Bericht aktualisieren und extern nachprüfen, keine zweite Roadmap | 566e3f2f |
| DOC-CTRL1 | Doku beaufsichtigen | Chief; Root nimmt ab | – | egal | C | In Arbeit: laut Auftrag; native Lage unbekannt | Aufträge/Überlappung/Restpflichten prüfen; danach belegte Übergabe an Root | b3d2f947 |
| PA-HOOKS-2a | Startdialog trotz Echo (C2-7/8) | srv-pa-hooks-2a | – | Server | A | Verschoben: #1756 `e0cacb41`, Root-Split 20.10.; Draft/keine Queue | Historie erhalten; ersetzt durch 2a-v2, nicht angenommen | e9f093c8 |
| PA-HOOKS-2a-v2 | Mehrdeutige Startmenüs sperren | srv-pa-hooks-2a-v2 | – | Server | A | Erledigt: #1766 `08fd9b08`, Merge `a92da08f` 21.10. 16:54:44Z | Root nahm den festen Kopf nach Runde 2 an; Rot→Grün/prepush und Review-Disposition im PR; R1766-R2-G1/DS-R2-F1 durch separates FU-2A-SUFFIX geschlossen; keine gesamte PTY-/P9-Abnahme; Nutzerchat 21.10. 00:22Z: bei Zweifel/Schadcodeverdacht fragen, kein pauschales Hook-Vertrauen | b91a51cd |
| PA-HOOKS-2b | Titel/Trust/Blockgrund (C2-6/10) | srv-pa-hooks-2b-title-trust | PA-HOOKS-2a-v2 gemergt (#1766) | Server | A | Erledigt: #1804 `21bbf5fb`, Merge `265024a19b960df0ca746f1eb02153d5e2c6e441` 22.10. 03:08:16Z | Root nahm nach letzter Runde 2 an: D1/D2 mit Konstruktor-/Offset-Helferbeleg zurückgenommen, G1 behoben; legitimen Trust/Blockgrund erhalten; FU-2C-TYPED geliefert; Echo-Zitat-Nachläufer separat FU-1804-ECHO-QUOTE; keine vollständige PTY-/P9-Abnahme | 1539a734 |
| PA-HOOKS-2c | Blockade erhalten (C2-9) | srv-pa-hooks-2c | – | Server | A | Verschoben: #1757 `579b54f5`, Root-Split; Draft/keine Queue | Historie erhalten; ersetzt durch 2c-v2, nicht angenommen | 0bf0a005 |
| PA-HOOKS-2c-v2 | Startblockade nur belegt aufheben | srv-pa-hooks-2c-v2 | – | Server | A | Erledigt: #1769 `8addb7e9`, Merge `1fd743c9` 21.10. 16:54:50Z | Root nahm den festen Kopf nach Runde 2 mit protokolliertem DeepSeek-Reject (keine hohen Befunde) an; Rot→Grün/prepush laut Report; damalige Restbefunde durch FU-2C-CONCEAL geschlossen; typisierte Ursache später durch FU-2C-TYPED geliefert; Capture und echtes Terminal/P9 weiter nicht abgenommen | 2f88e71e |
| FU-2A-SUFFIX | Vollständigen Dialog außerhalb des sichtbaren Echo-Suffixes erhalten (NEWFU2A-SUFFIX) | srv-fu-2a-suffix | PA-HOOKS-2a-v2 | Server | A | Erledigt: #1785 `2259d337`, Merge `b07bc2a6` 21.10. 18:19:09Z | Root schloss R1766-R2-G1/DS-R2-F1 nach kopfgebundenen Fremdreviews; konservative Eskalation/8192-Zeichen-Grenze dokumentiert; P9/echte PTY-Schreibvorgänge nicht belegt | 70abe77b |
| FU-2C-CONCEAL | Unklare Verbergung beibehalten (NEWFU2C-CONCEAL) | srv-fu-2c-conceal | PA-HOOKS-2c-v2 | Server | A | Erledigt: #1786 `60750a9f`, Merge `4ccc4a05` 21.10. 18:12:05Z | Root schloss A1769-2-R2/R2-G1769-1/DS-R2-F1/F2 nach kopfgebundenen Fremdreviews; keine vollständige ANSI-, Capture-, Terminal- oder P9-Abnahme | 81e33045 |
| FU-2C-TYPED | Typisierte Startblockursache verdrahten | srv-fu-2c-typed-startup | PA-HOOKS-2c-v2 | Server | A | Erledigt: #1803 `f7c6acaa`, Merge `69c67f87215d070be48ffe21be3cb7067afdc2e1` 22.10. 01:59:55Z | Root nahm den Kopf nach Fremdreviews an; typisierte Ursache angebunden, unbekannte/untypisierte Details (auch bekannte Meldungstexte) erlauben keine Freigabe; Zustellfehler bleiben erhalten; frühere Textautorität überholt; G2-Testdaten separat FU-1803-G2-FIXTURES; keine echte PTY-/P9-Abnahme | 31771377 |
| PA-HOOKS-2d | Nur Folgeauftrag P9 | Root bindet Owner | PA-HOOKS-2b | Server | A | Blockiert: Fehlerzeit-Capture/Ursache fehlen; kein PR | Capture mit effektivem Marker, Rot→Grün/PTY, Busy-/Modal-Gegenfälle; danach Root prüft; entfällt falls 2b P9 belegt löst | unbekannt |

DOC-8 adressiert R1756-G2/A2 und R1757-A3/G2; Root belegt Integration vor `review-ok`.
Hook-Code/PR-Berichtskorrekturen bleiben bei ihren Ownern.

### Nutzbar-1 — Lieferstände und Nachläufer 22.10.2026

[Datierte Nutzbar-1-Übergaben](archive/plan-2026-10/context-2026-10-23.md#nutzbar-handovers-on-22-october); aktuelle Lieferstände und Nachläufer folgen in den Zeilen. EQ-1/P9 bleibt begrenzt, EQ-2 entfallen/ungemergt, Referenz-App gestoppt, externe DOC-Gesamtabnahme offen. DESIGN-R2 ist gemäß Entscheid 23.10. nach v2.x verschoben; kein Dispatch. Geparkte niedrige #1820-Reste nur bei ohnehin genehmigter Arbeit an red-first.sh; keine neue Gesamt-, PTY-/P9- oder Release-Abnahme.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-KI24-H1 | KI-24-Wiederauftreten samt Requeue-PASS, tatsächliche H1-Lieferung und genehmigten B1-Größenschnitt kanonisch nachführen | srv-doc-ki24-h1-merge (job75); Chief disponiert, Root nimmt ab | #1825 tatsächlich gemergt; Vorgängerticket 69c61ba2 bleibt Herkunft, keine laufende Sperre | Server | C | Erledigt mit Root-Abnahme und Merge dieses Dokumentenschnitts: KI-24 bleibt offen/beobachten, H1 erledigt, B1a/B1b getrennt registriert | Root-Auftrag msg-0mvjdh1kc-f1d8d335 (22.10. 10:02:30Z); nur KNOWN_ISSUES.md und docs/PLAN.md, ≤300 rohe Diffzeilen; eigene volle prepush, fester Kopf und Draft-PR; keine neue Windows-Messung, Produktänderung oder Gesamtabnahme | 2da280fe-e8de-4534-b17d-cbee14d40cf6 |
| RED-FIRST-E2E-NAME | Exakten benannten Root-Playwright-Test als Beleg prüfen | srv-red-first-e2e-name | – | Server | B | Erledigt: #1806 `c7f3f314`, Merge `52eb5453bd0b8a37791a0a993f3f0b5fbf6bf52e` 22.10. 02:17:33Z | Root nahm den Kopf nach Fremdreviews an; verbleibende Gate-Hygiene separat FU-1806-PLAYWRIGHT-HYGIENE | #1806 |
| FU-DG05-HEADER-HINT | R1722-R2-L1: Hinweis im Header bei 900 px und verwaisten Override korrigieren | srv-fu-dg05-header-hint; Root integriert | DG-05, RED-FIRST-E2E-NAME | Server | B | Erledigt: #1810 `4c6c7381b4c9217bb1a55f5560dceed9cd988004`, Merge `d29c144a51e06b0fe7d20afaf3579fd6a918fa69` 22.10. 03:32:36Z | Zwei Fremdfamilien, Root-Abnahme und Queue-Merge belegt; Installation nicht behauptet; weitere Breiten-/Testhärtungsbefunde im PR bleiben Nachläufer | de13bd7b |
| FU-1804-ECHO-QUOTE | EQ-1-Informationsgrenze festhalten; EQ-2 entfallen; falsche Trust-Überschrift zu P9 | Root: EQ-1/P9; EQ-2 entfallen, kein aktiver Owner | PA-HOOKS-2b (#1804) | Server | A (entfallenes EQ-2); C (Dokumentationsabgleich) | Entfallen: EQ-2; EQ-1 bewiesene Grenze → P9; EQ-2 entfallen (Meldung im Produkt unerreichbar, #1813 geschlossen 22.10.); falsche Überschrift bei zurückgehaltenem Trust (R1804-R2-4) gehört zu P9. | Root `msg-0mvizj71n-b8f8d1b7` (22.10. 03:32:15Z), Bericht `srv-fu-1804-echo-quote.md`: Zitat und mögliches aktives Menü haben identische vollständige öffentliche Observation-Verläufe (CR-/Lösch-/Cursoroperationen); synthetischer Informationsbeweis, keine reale CLI-Messung oder Implementierungskorrektur. Fail-closed bleibt richtig; vor künftiger Freigabe des vervollständigten Echos ist generationsgebundene Composer-/Modal-Evidenz nötig; kein neuer Screen-/Producer-/P9-Scope genehmigt. Finale Root-Disposition `msg-0mvj0m263-4b88f439` (22.10. 04:02:29Z) und öffentlicher Kommentar #1813 (04:02:27Z): DROPPED nach Fremdreviews und Roots Quellenprüfung an `d29c144a`; `StartupDialog(CodexTrust)` wird im Produkt nicht erzeugt, der Konstantentest belegt keinen nutzerseitigen Producer. Kandidat `c30f3123ca5e456b436f672d8ab0cd00bb9596c2` geschlossen/ungemergt (04:02:28Z, kein Merge-SHA); nicht angenommen oder installiert, tatsächlicher Branch `codex/fu-1804-echo-quote` bleibt erhalten. Keine weitere EQ-2-Arbeit/Abnahme offen; kein PTY-/P9-PASS oder vollständige Nutzbar-Abnahme | be30833a |
| FU-1806-PLAYWRIGHT-HYGIENE | Temporäre Konfiguration aufräumen, Ergebniszeile verankern und fehlende Auswahlfälle absichern | srv-fu-1806-playwright-hygiene; Root nahm ab | RED-FIRST-E2E-NAME (#1806) | Server | B | Erledigt: #1817 `544963eac7464a72953ff41d226ee7f233aff3a5`, Merge `3f355d5254c15f7b088f30e5c5a0d5a71b5709fa` 22.10. 06:18:46Z; R1806-G2/D1/G4 geliefert | 124 rohe Diffzeilen, nur zwei Skripte; prepush Exit 0 laut Report. GLM und DeepSeek: Zustimmung mit Bedingungen; Root verwarf R1817-G1/D1 (Statuszeilen einzeln statt kommaverknüpft) und R1817-D2 (Reporter erzeugt einzelne Dauereinheiten) mit tatsächlichem Playwright-Quellbeleg im PR. Rest G4/D3, G3, G2 separat FU-1817-PLAYWRIGHT-EDGE. R1806-D2 (Erweiterungs-/Slash-Matrix) ausdrücklich NICHT geliefert: bleibt verschoben bei Root, ohne Job und außerhalb des neuen Nachläufers; Guard/P9 unverändert | 9f250383 |
| FU-1817-PLAYWRIGHT-EDGE | Drei verbliebene Beleggrenzen schließen: R1817-G4/D3 Trap vor mktemp, G3 Minuten-Dauersuffix, G2 Fehlermeldung als Testtitel verursacht falsches Rot | srv-fu-1817-playwright-edge (job71); Root nahm ab | FU-1806-PLAYWRIGHT-HYGIENE (#1817) gemergt | Server | B | Erledigt: #1820 `d6cc2cd6d6d3cf5163d18f54404c8f0c2d00ec89`, Merge `dcd4f29408f479db8e8b94eb66006950d2c264e3` 22.10. 07:48:36Z | 48 rohe Diffzeilen innerhalb 60, nur scripts/ci/red-first.sh und scripts/test-red-first-playwright-filter.sh; Rot→Grün und volle prepush Exit 0 laut Report. GLM + DeepSeek Zustimmung mit Bedingungen, Root nahm festen Kopf an; kein hoher Befund/keine zweite Runde. Niedrig GEPARKT: R1820-G1 hartcodiertes mktemp im Test, D1 falsches Rot bei bestandenem Titel „Datei fehlt: …“, D2 defensiver allocation-error-Zweig; kein separates Paket. Signalbeleg nur direktes INT/TERM an wartende Shell an kontrollierter mktemp-Grenze mit anschließend zurückgegebenem Pfad sowie bisherige npx-Grenze; lange Dauern synthetisch, keine universelle Race-/SIGKILL-/Prozessgruppen-Aufräumzusage. R1806-D2/Guard/P9 bleiben außerhalb | 57dd682d-b272-4489-82c2-4b08143d4c29 |

### DOC-1b — kanonischer Nachtrag 21.10.2026

DOC-1b ist geliefert; externe Gesamtakzeptanz und Quellenabgleich bleiben bei DOC-9.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DOC-1b | Historie verlustfrei auslagern | srv-doc-1b-plan-history | DOC-1 | Server | C | Erledigt: #1778 `baff18f9`, Merge `a8357d0c` 21.10. 15:45:09Z | Root-Disposition Runde 1: MERGE; an `baff18f9` PLAN/DOC-8-Komposition 241440 ≤241664 Bytes, 51 bytegleiche Belege, Leser/prepush 0; DeepSeek bedingt positiv, GLM ohne Antwort (keine Prüfung); keine Gesamtmissions-/Laufzeitabnahme | srv-doc-1b-plan-history |
| SIZE-BUDGET-GATE | Gekoppelte Größenprüfung | Implementierer2 | – | Server | B | Erledigt: #1772 `d320013e`, Merge `3cbdff71` 21.10. 03:31:43Z | Root nahm den Kopf nach Runde 2 zum Merge an; Grenzen/rohe Diffzählung fail-closed; Glob-/Tokenisierungsbeschränkung bleibt beabsichtigt, FU-1772-GLOB nur bei Bedarf eines echten Briefs; keine neue Ausnahme | 1af27d72 |
| FU-1758-1 | Technisches Gate für Quellenbindung | srv-doc-a1b-fetch-binding (A1b); Root disponiert Rest | A1: ausdrückliche Root-Freigabe 21.10. 17:57Z statt DOC-9-Endabnahme | Server | B | Erledigt: A1b #1793 `8ca2d9b2`, Merge `0f3e2ea9` 21.10. 21:48:39Z; #1789 nach Runde 2 CLOSED, ungemergt (Root SPLIT), Branch `codex/doc-a1-fetch-binding` bei `636c85e9` erhalten; übriger Scope bleibt verschoben | Root entschied nach Runde 2 „Merge mit expliziter Grenze“: transienter insteadOf-Rewrite auf ein anderes Repository mit nur um `.git` verschiedenem Pfad hinterlässt bytegleiche lokale Git-Belege und kann fälschlich frisch datiert werden; teilweise fehlgeschlagener Rewrite-Fetch bleibt bekannte Lücke. Keine universelle Nie-falsch-frisch-Zusage; externe A1-Abnahme bis externer Nachprüfung OFFEN; optionale Nachläufer bleiben geparkt | FU1758-1 |

### CI und Durchlauf — Nachtrag 15.10.2026

Quelle: `opt-ci-merge-20261015.md` (pa-orch); Dispatch laut Root, Ereignisse 16:12 MESZ nachgeprüft. Root nimmt ab; kein Merge-Sicherheitsentscheid durch diesen Eintrag.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| OPT-PIPE-0 | Durchlauf ausschließlich lesend messen | srv-opt-pipeline; Root klärt Basis | korrekte Auftragsbasis | Server | C (Bericht) | Blockiert: geplant nach Basisklärung; Server-Auftrag srv-opt-pipeline endete 16:12 MESZ wegen HEAD-Abweichung | Messbericht mit Methode und Einheiten; keine Implementierung | OPT-PIPE-0 |
| CI-SEC-CODEQL-2 | [Archiv][pakete] | Root; `.github/` gehört laut CODEOWNERS dem Nutzer | Nutzerentscheid CODEQL-59-60 | – | B | Erledigt: CodeQL-Alarme 59/60 am 16.10.2026 nach Owner-Entscheid K1 (A: als Fehlalarm abweisen) als false positive abgewiesen (GitHub: `dismissed`, 00:08:30/31 UTC); neu prüfen bei Änderungen an Cache/Event-Konfiguration in `ci.yml` | siehe Archiv | – |
| FU-1015 | Nachläufer aus den Reviews vom 15.10.: #1551 G3 (KR-09m), #1556 K4 und toter CSS-Rest (KR-08a), #1560 K2 (CI-SPLIT-LINUX), #1561 G2 (DS-01), #1568 Lows (FABRIK-TAB-1), #1569 B1/B3 (KR-04a), #1581 K1/K3–K5 (CI-SEC-CODEQL) | Root disponiert | jeweiliger Eltern-PR gemergt | – | je Punkt | In Arbeit: Teillieferung #1581 K1 durch #1835 gemergt (`5a07fc08`); K3 durch #1833 gemergt (`72ae3f75`); K4/K5 durch #1839 am 22.10.2026 um 21:22:50Z gemergt (`5ad970f2814ce251cf86077c4b4a686c1d7a9865`); R1839-G3 bleibt Nachläufer; #1551/#1556/#1560/#1561/#1568/#1569 bleiben offen | je Punkt eigenes Paket ≤ 300 Zeilen mit eigener Abnahme | – |
| OPS-CLOUD-PREFLIGHT | Vorabprüfung für den Codex-Cloud-Weg vor jedem Auftrag (laut Root 15.10.; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden: weder Auftrag noch Bericht noch Ereignislog des Server-Auftragsordners nennt die ID; Wortlaut und Zielort liefert Root, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |
| OPS-JOB-ENDZEILE | Endzeile jedes Auftrags nennt private Abrechnungs- und Token-Messwerte; keine Werte im öffentlichen Repo (laut Root 15.10.; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden; Wortlaut und Zielort liefert Root, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |
| OPS-AUTO-LOCK | Auto-Skript: doppelte Sperre (laut Root 15.10. „duplicate lock“; Quelle: nur diese Mitteilung belegt, Datei geprüft 16.10. und nicht gefunden; Bedeutung bleibt Unbekannt, Root liefert Wortlaut und Zielort, sonst Zeile streichen) | Root disponiert | – | – | – | Geplant: nicht disponiert (15.10.) | Abnahme vor Dispatch festlegen | – |

### Designziel Pixel-Fabrik (Nutzer 16.10.2026) — DS-FABRIK-ZIEL

Fabrik/DS-H/DS-WF sind seit dem Entscheid 23.10. v2.x, ohne Dispatch. Die [ursprünglichen Kunst-/Navigationsverträge](archive/plan-2026-10/final-2026-10-23.md#dated-context) bleiben als Kriterien erhalten; gemeinsames `--g-*`-System, Nutzerurteil über DS-H-07 und dessen Belegmatrix bleiben Voraussetzung.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DS-H-00 | [Archiv][pakete] | Root disponiert | DS-T-01, DS-T-03, DS-T-05; die Zeilen DS-T-02 und DS-T-04 stehen in ihren PRs | Server | C | Erledigt: #1633 (merged 2026-10-16); verbindlicher Stil- und Kunstvertrag `docs/design/hall/ASSETS.md` (Raster, Token-Palette, Herkunft/MIT, Namen, Größenbudget, Rollen und Posen je Zustandsform, Bewegung, Ehrlichkeit, Abnahmefälle DS-H-07) | siehe Archiv | – |
| DS-H-01 | [Archiv][pakete] | Root disponiert | DS-H-00 | Server | B | Erledigt: #1637 (merged 2026-10-16); Textraster `src/design/hall/<sheet>/*.px.ts` mit Delta-Posen, Generator schreibt je Thema ein indiziertes PNG aus den Tokens plus Frame-Map, `usePixelScale` wählt ganze Gerätepixel (Platzhalterfigur, echte Kunst DS-H-02a/03) | siehe Archiv | – |
| DS-H-02a | [Archiv][pakete] | Root disponiert | DS-H-01 | Server | B | Erledigt: #1642 (merged 2026-10-16); sieben Kacheln (Boden, Wand, Tür, Band, Rückweg, zwei Kurven) als Textraster plus Hallen-Raster `tiles/layout.ts`; Generator weist fehlerhafte Eingaben mit klarer Meldung ab (Nacharbeit aus #1637) | siehe Archiv | – |
| DS-H-02b | [Archiv][pakete] | Root disponiert | DS-H-02a | Server | B | Erledigt: #1648 (merged 2026-10-16); vier Rollenstationen (Planungstisch, Werkbank, Prüfstand, Betriebspult), Tor, Übergabeablage und Stempel als Textraster `tiles/stations.px.ts`, deutsche Textnamen im Wörterbuch `src/i18n/de.ts` (Zuordnung Sprite → Schlüssel in `tiles/names.ts`); Nacharbeit aus #1642 (R1642-G1/K1, K2, K3) | siehe Archiv | – |
| DS-H-03 | [Archiv][pakete] | Root disponiert | DS-H-01 | Server | B | Erledigt: #1646 (merged 2026-10-16); vier Rollenfiguren (Planung, Umsetzung, Prüfung, Betrieb) mit eigener Kopfform, je zwölf Bilder in acht Posen als Delta zur Grundhaltung; `poseFor` ordnet jede `StateForm` genau einer Pose zu, alles andere `unknown`, ohne Lauf `ready` | siehe Archiv | – |
| DS-H-04 | [Archiv][pakete] | Implementierer · Claude; Root nimmt ab | DS-H-02b, DS-H-03; Zustandsaliase aus DS-X-04 (#1603) | Server | B | Erledigt: #1663 (merged 2026-10-16); `Hall` zeigt gefüllt, leer und ungelesen mit Schild „Beispieldaten“, Werkstück-Kachel `piece-crate-0` neu, im Register eingetragen; seit DS-H-07a (#1696, merged 2026-10-17) in der Galerie eingebunden | siehe Archiv | – |
| DS-H-05 | [Archiv][pakete] | Root disponiert | DS-H-04; Listenzeile aus DS-X-11 (#1673) | Server | B | Erledigt: #1680 (merged 2026-10-17); die Halle zeigt neben der Szene eine Werkstück-Liste (`ListRow`) und einen Inspektor mit der Aufgabe zuerst, eine gemeinsame Auswahl in Liste und Szene (Form und Text, nicht nur Farbe), jedes Werkstück einmal per Tastatur erreichbar; dazu die Übernahmen aus #1663 (Zustandstyp, Atlas-Schutz, Schlüssel, Tests); Galerie mit DS-H-07a (#1696) eingebunden | siehe Archiv | – |
| DS-H-06 | Probe-Halle: drei Bewegungsmodi Ruhig/Lebendig/Aus, höchstens zwölf bewegte Figuren, Pause bei verstecktem Dokument: `hall/motion.css` | Root disponiert | DS-H-05; Bewegungsmodus aus DS-X-03 (#1606) | Server | B | Erledigt: #1690 (merged 2026-10-17); es bewegt sich in Ruhig und Lebendig nur die Arbeitsfigur (`run`), alle anderen Posen und Aus oder Betriebssystem-Bewegungsreduktion bleiben auf Bild 0, höchstens zwölf Figuren bewegen sich, ein verstecktes Dokument pausiert die Halle; die Gesten für `need`, `ok` und `bad` warten auf ein beobachtetes Wechselsignal | wie DS-H-01 | – |
| DS-H-07 | Probe-Halle: Galerie-Seite und Messaufbau (`shot.mjs --dpr --motion`), danach Abnahme durch den Nutzer: zuerst Bilder und kurzes Video vom Server (3 Bewegungsmodi × hell/dunkel), dann nach seinem Ja in der App am PC mit Speichermessung | Root disponiert; Abnahme der Nutzer | DS-H-06; Galerie aus DS-X-14 und DS-X-15 (#1662) | Server | B | In Prüfung: Galerie DS-H-07a gemergt (2026-10-17), Messaufbau DS-H-07b gemergt (2026-10-18), beide PR-Nummern stehen in deren Zeilen; Belegsatz mit Bildern und Videos liegt beim Nutzer (18.10.), Urteil des Nutzers und PC-Speichermessung folgen, keine Gesamtabnahme | wie DS-H-01; Urteil des Nutzers | – |
| NAV-0 | [Archiv][pakete] | Root disponiert | – | Server | C | Erledigt: #1630 (Doku, (merged 2026-10-16)) | siehe Archiv | – |
| NAV-1a | [Archiv: Historie][historie] | Root disponiert | NAV-0; #1606 (`Shell.tsx`) und #1604 gemergt oder `main` eingemergt | Server | B | Erledigt: #1636 (merged 2026-10-16); die Seitenleiste zeigt einen Link je Bereich (Schalter aus: Fabrik und Einstellungen, Betrieb ab NAV-2a), der Fluss-Reiter heißt „Linie“ | siehe Archiv | – |
| DS-WF-1 | Workflow-Ansicht, Bildvertrag (Doku): Objekte Verteiler, Sammelstelle, Weiche, Tor, Rückweg, „nicht nötig“, gruppiert, neu; Ehrlichkeitsregel „ohne Daten: noch nicht verbunden“; Bewegungs- und Tastaturregeln: `docs/design/hall/WORKFLOWS.md`; Entscheid DS-WF-0 (Band plus Fahrplan, keine Helferfiguren) | Root disponiert | DS-H-07 (Urteil des Nutzers über die Probe-Halle), DS-H-00 | Server | C | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | prepush Exit 0 | – |
| DS-WF-2 | Workflow-Ansicht, reine Projektion: Bänder aus `QueueEntry`, `BoardCard` und `spawnedBy`, Gruppe ab fünf Zweigen, Sammelstelle, Runde und Weiche bleiben `unknown`, solange kein Motor sie liefert: `src/design/hall/workflow/project.ts` | Root disponiert | DS-H-07; DS-WF-1; DS-T-03 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-3 | Workflow-Ansicht, Kunst: Bandkacheln (gerade, Ecke, Teilung, Zusammenführung, Rückweg) und Verteiler, Sammelstelle, Weiche im Spriteformat von DS-H-01 | Root disponiert | DS-H-07; DS-H-01; DS-H-02a | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-4 | Workflow-Ansicht statisch: Werkstücke als Knöpfe mit Name und Zustandswort, Umschalter Band/Fahrplan, Fahrplan als Tabelle mit denselben Ids und Zuständen (beide Ansichten gleichberechtigt) | Root disponiert | DS-H-07; DS-WF-2; DS-WF-3; DS-H-04; DS-H-05 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-5 | Workflow-Ansicht, Bewegung: Ruhig/Lebendig/Aus, Übergabe nur bei beobachtetem Wechsel, Pause bei verstecktem Fenster, höchstens zwölf bewegte Figuren: `workflow/motion.css`, `useBeltMotion.ts` | Root disponiert | DS-H-07; DS-WF-4; DS-H-06; #1606 | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannte Tests rot→grün; prepush; zwei Reviews | – |
| DS-WF-6 | Workflow-Ansicht einhängen: im Reiter „Linie“ (später „Halle“) der Fabrik anstelle des Fluss-Inhalts; Screenshots hell und dunkel, Messprotokoll; ersetzt den Neuschnitt von DS-X-23 bis 25 | Root disponiert | DS-H-07; DS-WF-5; NAV-1a | Server | B | Geplant: wartet auf die Abnahme der Probe-Halle (Nutzer 16.10., Q3) | benannter Test rot→grün; prepush; zwei Reviews; Urteil des Nutzers | – |

### Serverreserve 3 — begrenzte Werkzeug-Härtung (historisch, erledigt)
[Originaltext][historie]

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
## Z3 — Rest von v1.6.0

Historische Nahtmessungen: [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context); vor einer Nahtentscheidung neu messen. Offene Nachläufer und Abnahmen folgen unten.
| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| V16-06 | [Archiv][pakete] | MCP-Integrationsentwickler | E2/V16-F3 beantwortet 09.10.; mn nach D5-GUARD → V16-UPD-CANCEL; Update-Drill | PC | A | Erledigt #832 + Folgepaket #845 | siehe Archiv | 2557db66 |
| V16-UPD-CANCEL | [Archiv][pakete] | Desktop-App-Entwickler; Startzuweisung durch Ausführungs-Stabschef | V16-ARCH-D5b/#728 gemergt → D5-GUARD; mn danach neu zuweisen | PC-Drill; Gates Server möglich | A | Erledigt: #813 (78415d74), #828 (d0dc06d5), #830 (55c22381, re-cut von #821), #833 (9735583), #834 (34f2b0b), #851 (Freeze-Test) gemergt am 09.10. | siehe Archiv | – |
| V16-ARCH-D2 | [Archiv][pakete] | Implementierer; mn-Nachfolge gemäß L3 | vor V16-06 freigegeben (Inbox V16-D2) | Server | A | Erledigt #664 (merged 2026-10-08T16:13:04Z) | siehe Archiv | 257e3a7b |
| V16-ARCH-D5a | [Archiv][pakete] | Implementierer · Claude | V16-ARCH-D2 | Server | A | Erledigt #704 (merged 2026-10-08T20:27:48Z) | siehe Archiv | – |
| V16-ARCH-D5b | [Archiv][pakete] | Implementierer · Claude | V16-ARCH-D5a | Server | A | Erledigt #728 (merged 2026-10-09T00:33:32Z) | siehe Archiv | – |
| D5-GUARD | [Archiv][pakete] | Root weist einen exklusiven mn-Owner zu | V16-ARCH-D5b/#728 gemergt; vor V16-UPD-CANCEL | Server | A | Erledigt #792 (merged 2026-10-09T02:00:10Z); ersetzt: Geplant; konkreter Startvertrag in Ticket 5e18c3e8 | siehe Archiv | 5e18c3e8 |
| V16-ARCH-D8a | [Archiv][pakete] | Implementierer · Claude | V16-ARCH-D5b | Server | A | Erledigt #960 (merged 2026-10-10T06:01:09Z, `2bc9b884`; D8a–c in einem PR); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.) | siehe Archiv | – |
| V16-ARCH-D8b | [Archiv][pakete] | Implementierer · Claude | V16-ARCH-D8a | Server | A | Erledigt #960 (`2bc9b884`, zusammen mit D8a und D8c); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.) | siehe Archiv | – |
| V16-ARCH-D8c | Ereignisnamen im Frontend | Implementierer · Codex | V16-ARCH-D8b | egal | B | Erledigt #960 (`2bc9b884`); der Abnahme-Grep findet 4 Kommentar-Treffer (`App.tsx:244`, `types.ts:160/567`, `useBoard.ts:35`), keinen Code; Abnahme durch Root: Unbekannt (zu prüfen); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.) | `rg -n -e '["\x27\x60]worker:status' -e '["\x27\x60]supervisor:notification' -e '["\x27\x60]pty:output:' -e '["\x27\x60]pty:exit:' src` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `npm run typecheck` und `npm run test:unit` Exit 0 | – |
| V16-ADR-A7 | ADR A7 (st-Lane teilen) | Architekturberater Fable + Architekturberater Astra | V16-NACHBEOB (zwei Wochenmessungen) | egal | C | Verschoben | Eintrag in `docs/decisions.md` | – |
| V16-KI30 | KI-30 Windows-Flake: Restursache nach V16-01 | Performance- und Benchmark-Spezialist | st exklusiv für #737 bis zum Tag v1.6.0 | Server | A | Erledigt #874 (merged 2026-10-09T18:03:26Z); ersetzt: Abschluss-Doku Open #874 (Ready, nicht gemergt) | neuer Beleg (Queue-Lauf-ID) vor Fix; 0 KI-30-Fehlschläge in 40 Queue-Läufen; Quellenkonflikt und unveränderte Nachbeobachtung siehe unten | – |
| V16-03 | Tester-Kit: Installation, Rückmeldeformular, Grenzen | Implementierer · Codex | Inbox E16; kein Pflichtkonto | PC / erster externer Tester | C | Geplant: Konto entfällt laut Nutzerentscheid vom 08.10.; kein Release-Vorgänger | Trockenlauf in Windows Sandbox ODER beim ersten externen Tester; Sandbox-Aktivierung nicht freigegeben | – |
| V16-CHANGELOG | [Archiv][pakete] | Stabschef | DR-17 und die release-blockierenden Pakete aus V16-RELEASE (ohne diesen CHANGELOG selbst) | egal | C | Erledigt #922 (merged 2026-10-09T23:08:04Z): b erledigt #861; c erledigt #894; final in diesem PR (V16-RELEASE-PREP); ersetzt: c (Nachtrag 09.10. Abend) in Arbeit, final nach DR-17, Geplant | siehe Archiv | – |
| V16-RELEASE | Tag v1.6.0 (Beta-Regel x.y.0) | Nutzer | Z1 (bis DR-17), V16-KI30 (Fix-Abnahme), D5-GUARD, V16-UPD-CANCEL, V16-06, V16-CHANGELOG; #728 gemergt | PC | – | Erledigt: Tag v1.6.0 = d2582ceb (09.10. 23:22Z), release.yml 38004103979 grün, latest.json anonym 1.6.0, PC installiert; ersetzt: Freigabe: Nutzer 09.10. ~19:42Z an Root; Tag durch Root nach Merge dieses PRs (V16-RELEASE-PREP); ersetzt: Geplant: E2/E3 beantwortet; konkrete Freigabe dieses Releases weiterhin offen | jeder Release braucht Nutzerfreigabe; Environment release mit Required Reviewer Cuarroc am 09.10. per gh api bestätigt; danach Release-Pipeline grün | – |
| V16-FU | Nachläufer aus v1.6.0-Reviews und Release-Prüfung | Stabschef | v1.6.0 veröffentlicht (V16-RELEASE) | Server | B/C je Punkt | Erledigt 10.10.: SRV-2/SRV-5-Portschutz #931, SRV-3 #952, OWN-3 #930, NOT-1 und R912-FU-1 #941, NOT-2/NOT-3 #928, SRV-4 #927, REL-3 #926, REL-4 #929, R910-FU #937, R889-FU #899 (09.10.); Rest verschoben nach V16-FU-2; ursprünglich: Offen: R908-FU-1 (Wiring-Test stop→limitDrainForSignal), R908-FU-2 (Drain-Kommentar/Idempotenz); R912-FU-1 (existed-Flag statt stat, io-Seam); R910-FU, R896-FU, R899-FU K2, R889-FU; REL-3 (scripts/release.cmd veraltet), REL-4 (Rollback/releases-latest), NOT-1/2/3, SRV-2..5, OWN-3 | je Punkt eigenes Paket mit eigener Abnahme | – |
| V16-FU-2 | Rest aus V16-FU: SRV-5 gegenseitige Authentifizierung (laut #931 weiterhin geparkt), R908-FU-1 (Wiring-Test stop→limitDrainForSignal), R908-FU-2 (Drain-Kommentar/Idempotenz), R896-FU, R899-FU K2 | Stabschef | V16-FU | Server | B/C je Punkt | In Arbeit: Teillieferung R908-FU-1 durch #1838 am 22.10.2026 um 22:28:00Z gemergt (`4934e32e35f8ab1dd5e58229038694be65a04078`): Wiring-Test am echten CLI-Einstieg für Linux-SIGTERM/SIGHUP und prozessseitig emittiertes SIGBREAK; kein nativer Windows-Signalnachweis. SRV-5 gegenseitige Authentifizierung bleibt geparkt; R908-FU-2, R896-FU und R899-FU K2 bleiben offen | je Punkt eigenes Paket mit eigener Abnahme | – |
| V16-NACHBEOB | Zwei Wochenmessungen und 40 Queue-Läufe; Messgrößen-Leitfaden | Stabschef | v1.6.0 | Server | C | Verschoben; KI-30-Schluss (#874: 42 Queue-Läufe ab 09.10., 0 KI-30) liegt vor, sein Fenster weicht vom Originalkriterium (Fenster ab #518, 05.10.) ab — Abgleich: Unbekannt (zu prüfen); zwei Wochenmessungen ohne vollständigen Fensterbeleg | Wochenberichte BENCH-01/02 im Ticket | b8b16ec8 |

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
| Z4-ARCH-D1-REST | [Archiv: Historie][historie]; ARCH-D1 bleibt offen | Implementierer; abgeschlossene api-Arbeit | – | Server | A | Erledigt #663 (merged 2026-10-08T20:55:57Z) | siehe Archiv | 7810a005 |
| Z4-ARCH-11 | KI-24b: Test-DB-Wettlauf auf Windows reproduzieren und absichern; zusätzlich KI-30-Queue-Befund im Native-Receipt-Test | Implementierer · Claude; Ausführungs-Stabschef weist Lane zu | V16-KI30/#737 und anschließender Queue-Beleg; st bis Tag v1.6.0 exklusiv für #737 | Windows-PC für RED | A | Blockiert: Start nur, wenn Queue-Belege nach #737 den Defekt weiter zeigen; keine gemeinsame Ursache unterstellen; Queue-Belege nach #737 liegen vor (KI-30-Schluss #874: 42 Läufe, kein `real_native_`-Treffer, Beleg statistisch); KI-24-Teilfix #1463 (`13ef8a41`) und #1468 (`4f74b8f8`) gemergt; KI-24b-Rest: Unbekannt (zu prüfen), Root entscheidet Start oder Entfallen | Dateien `testutil.rs`, `store/development_launches.rs`, `store.rs` vor Start binden; 180–280 ALL nur Prognose; kompilierende Windows-REDs für Launch-Drop/Reopen und getrennt Migration-Reopen; zusätzlich `real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout` (Queue-Runs 37810056116/37814405700) eingrenzen; Zuordnung zur Windows-Flake-Klasse ist keine bewiesene gemeinsame Ursache; API-Ursache offen, keine Blanket-Retries; Fix nur nach Beleg, >300 ALL trennen; eigene prepush + zwei Fremdvendor-Reviews | 0e7793b4 |
| Z4-R19-09 | Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19); ausschließlich mn | Implementierer · Codex | nach v1.6.0; mn frei und neu zugewiesen | Server | A | Verschoben nach v1.6.0; nur mn, keine st-Naht; fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“, zusammen mit dem eingefrorenen Dauerbetrieb | roter Test zuerst; prepush Exit 0 | – |
| Z4-R19-ST | Audit-Envelopes Ziel/Task, Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review (M4-R19-02/03/04/07) | Chief weist verbleibende Schnitte nach v1.6.0 zu | nach v1.6.0; st bis zum Tag exklusiv für #737 | Server | A | Verschoben: Rest 04/07, fällig seit v1.6.0 (09.10.), Einordnung 16.10. (Root): nach „Später“, zusammen mit dem eingefrorenen Dauerbetrieb; 03 mit 03a #705 und 03b #956 (merged 2026-10-10T04:29:58Z, `2e1de0bb`) erledigt; #702/#705/#717 gemergt, keine Gesamt-Abnahme; ursprünglich: Verschoben nach v1.6.0: Rest 03/04/07 | ≤ 300 ALL je Schnitt; vorhandene Envelopes wiederverwenden, übrige Pfade getrennt belegen; Rot/grün, eigene prepush, zwei Fremdvendor-Reviews/Disposition und Root-Abnahme | – |
| Z4-VERIFY | Fünf Altzeilen gegen aktuelle Quellen prüfen und begrenzt schneiden | Root-Job `srv-z4-verify`; Chief integriert | Quelle `a167486` | Server | C | In Prüfung: Prüfbericht geliefert: `pa-orch/reports/z4-verify-20261008.md`, SHA256 `77341da8`; alle fünf Altzeilen NEUES PAKET, elf FITs unten; keine frischen Laufzeit-/Testbelege | Belege/Teilpässe erhalten; konkrete Reste und NICHT ABGEDECKT statt Altzeilen pauschal schließen | 77c993f3 |
| Z4-W103F-WIRE | Produktionsadapter `agent_record_delivery` anbinden; `main.rs`, ggf. API-Integrationstest und notwendige Adapter-Allowlist; 120–220 ALL | Chief weist einen Codex-Implementierer zu | #664 gemergt; mn frei; bestehende #301/#337/#352 erhalten | eigener Worktree | A | Verschoben: seit 08.10. ohne Start (M4-Freeze, Continuous eingefroren), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; PM prüft Startvertrag, kein neuer Worker | kompilierendes Produktionsadapter-Rot; danach done/blocked persistiert, wiederholtes done unverändert, falsche/veraltete Credentials abgewiesen; eigene prepush, zwei Fremdvendor-Reviews | 8e7b877f |
| Z4-W103F-Z1 | Originaler PC-Zustellbeleg mit 20 Versuchen, nur bereinigter Bericht ≤ 120 Zeilen | Chief weist einen Messowner zu | WIRE integriert; PC/App/Default-opencode und MCP-Start > 30 s belegt | PC | C | Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; reale Voraussetzungen und Zeitpunkt offen | je Versuch Version/Latenz/Marker/terminalbestätigter Empfang; 20/20 bzw. < 20/20 bestimmt Queue-Rest; keine erfundenen Pässe | 1c6d9ed8 |
| Z4-W303-PC-REST | Fehlende Crash-/Kapazitäts-/Provider-Belege aus bestehenden Drills, nur Bericht ≤ 180 Zeilen | Chief weist einen Messowner zu | gültige M4-Aktivierung, PC-Rechte und HQ-Läufe | PC | C | Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; M4-Freeze erhalten; #500-Teilpässe nicht wiederholen | Crash je spezifiziertem Übergang plus Kapazität/Provider mit Version/Befehl/Exit/Manifest; Singleton/Estop/Backup aus #500 erhalten | abf51cef |
| Z4-W307-PC-UPDATE | Signiertes installiertes Client-Update und Neustart, nur Bericht ≤ 150 Zeilen | Chief weist einen Messowner zu | autorisierter Windows-PC, Backup/Rückweg, neuere veröffentlichte Version und Abbruchpfad | PC | C | Verschoben: seit 08.10. ohne Start, Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; Release-Build ist kein Client-Laufbeleg | cancel/fail/success in dieser Reihenfolge; alte/neue Version, echte Signaturprüfung/Neustart, Fall-Manifeste/Exits; kein neuer Schlüssel/Release | c58c630b |
| Z4-M4B-0-AUTH | Transaktionslokale Run-/Owner-/Fence-/Rollen-/Projektautorisierung, store/development_runs.rs und ggf. development_launches.rs, 180–260 ALL | Chief weist einen Nahtowner zu | st nach #632 frei; freigegebene Sicherheitskorrektur bei deaktiviertem Continuous Mode | eigener Worktree | A | Erledigt: #1607 (merged 2026-10-16); nur die Prüffunktion, kein Schreiber angebunden; Source-Ladebefund mit Z4-M4B-4-IMPORT/#1855 geschlossen; übrige Pflichten siehe IMPORT; Continuous bleibt deaktiviert und eingefroren. | dieselbe Schreibtransaktion, stale/fremd/falsche Rolle/fehlendes Ziel abweisen; keine neue Auth-Transaktion/Migration; Rot vor Fix, eigene prepush und zwei Fremdreviews | fea04970 |
| Z4-M4B-1a-PLUMB | Autorität (Run, Owner, Fence; None = Operator) bis zu den vier Schreibern durchreichen, ohne Verhaltensänderung; die hier ursprünglich vorgesehene 403/refused-Korrektur wird verbindlich in GOAL nachgeholt; api.rs, main.rs, hq_routes.rs, planning_access.rs, Tests, 120–200 ALL (Schätzung) | ein serieller st/api/mn-Owner; Chief weist zu | Z4-M4B-0-AUTH (#1607); Nähte `api.rs` und `main.rs` frei | eigener Worktree | A | Erledigt: reine Durchreichung mit #1836 gemergt (22.10.2026, 9cc16b85). | No-Test (reines Durchreichen), bestehende Suite grün; Root dokumentierte Review-/PLAN-Regelabweichungen zu #1836; 403/refused noch nicht durch PLUMB geliefert, verbindliche Nachholung mit deterministischem Test in GOAL; Source-Ladebefund mit IMPORT/#1855 geschlossen; übrige Pflichten siehe GOAL/IMPORT | – |
| Z4-M4B-1-GOAL | Atomare Autorisierung und Goal/Replan, continuous.rs plus api/planning_access/Tests/main, 220–290 ALL | ein serieller st/api/mn-Owner | Z4-M4B-1a-PLUMB; freigegebene Sicherheitskorrektur ohne Continuous-Aktivierung | eigener Worktree | A | Erledigt: #1842 (merged 2026-10-22T18:35:12Z, fa4f2d9a). Source-Ladebefund mit Z4-M4B-4-IMPORT/#1855 geschlossen; GOAL-Reste im bestehenden Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310 bleiben offen; Continuous bleibt eingefroren. | deterministisches kompilierendes Fence-Interleaving-Rot; stale ohne Goal/Event; PLANNING_REFUSED muss HTTP 403 und audit_planning mit refused ergeben (eigener deterministischer Rot vor Fix); Alle vier Planungs-POSTs liefern Some(Run/Owner/Fence), Operator explizit None; Scoped Goal-POST erreicht das erforderliche create_continuous_goal_with_authority mit gebundener Run-/Owner-/Fence-Autorität, Operator None; kein ignorierender Produktionsdefault für Goal, kein Goal-Legacy-Routenbypass; Import/Task/Zuweisung behalten ihre Durchreicher bis zum eigenen Paket; scoped control/queue bleiben gesperrt; gültiger Coordinator erfolgreich, autonome Root operator-only, Operator/Audit erhalten; eigene prepush, zwei zulässige Fremdreviews und GPT-Beobachter gemäß AGENTS.md | 2be81e2e |
| Z4-M4B-2-TASK | Atomare Taskanlage, gleicher begrenzter Dateisatz wie GOAL, 180–270 ALL | ein serieller st/api/mn-Owner | Z4-M4B-1-GOAL (Nahtübergabe) | eigener Worktree | A | Erledigt: #1849 (merged 2026-10-22T21:03:34Z, `8c86bfc44c50e55209da7de48fdc7e3cb692a750`); TASK prüft Run/Owner/Fence/Rolle/Zielprojekt atomar in seiner SQLite-Schreibtransaktion; erforderliche API-Weiterleitung, Operator None erhalten. IMPORT-Source-Ladebefund mit #1855 geschlossen; GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), Import-Testnachlauf c91a08d0, Audit-/Windows-Belege bleiben offen, Continuous bleibt eingefroren. | Fence-Interleaving-Rot; stale ohne Task/Event; eigenes Projekt erfolgreich, fremde Goals/Dependencies abweisen, Operator erhalten; eigene prepush/zwei Fremdreviews | 8dbd5dc7 |
| Z4-M4B-3-ASSIGN | Atomare Zuweisung, team_assignments.rs plus api/planning_access/Tests/main, 200–280 ALL | ein serieller st/api/mn-Owner | Z4-M4B-2-TASK (Nahtübergabe) | eigener Worktree | A | Erledigt: #1852 am 22.10.2026 um 23:04:03Z gemergt (`88ef0b777994fb932d3dba23de456e4d6e264eb6`, Kopf `e341b6f5`); ASSIGN prüft Run/Owner/Fence/Rolle/Task-Projekt unter derselben SQLite-Schreibsperre wie Zuweisung/Revision/Event; getrimmte Coordinator-Selbsteskalation wird verweigert, gültige Zuweisung und Operator None bleiben erhalten. IMPORT-Source-Ladebefund mit #1855 geschlossen; GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), Import-Testnachlauf c91a08d0, Audit-/Windows-Belege bleiben offen, Continuous bleibt eingefroren. | Fence-Interleaving-Rot; stale ohne Assignment/Revision/Event; Selbsteskalation abweisen, gültige Zuweisung/Operator erhalten; eigene prepush/zwei Fremdreviews | 15d92066 |
| Z4-M4B-4-IMPORT | Autorisierung nach Source-Laden im Import-Schreibvorgang, development_plan/access plus api/planning_access/Tests/main, 230–300 ALL | ein serieller st/api/mn-Owner | Z4-M4B-3-ASSIGN (Nahtübergabe) | eigener Worktree | A | Erledigt: #1855 am 23.10.2026 um 02:42:19Z gemergt (`d39a03f1cffe52359516f8cfc1ebfa485e791ef4`); IMPORT prüft Run/Owner/Fence/Rolle/Projekt nach dem echten Source-Laden unter derselben SQLite-Schreibsperre wie Projektion und Revision; Operator None, CAS und Sourceprüfung bleiben erhalten. Root schließt damit den Source-Lade-/Autorisierungsbefund; Import-Testnachlauf c91a08d0, GOAL-/M4B-Reste (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310) und separate Audit-Transaktion bleiben offen. Windows-Nachweis separat, Continuous bleibt deaktiviert und eingefroren. | Fence beim Source-Laden ändern; Rot vor Fix; stale ohne Projektion/Revision/Event, gültiger Import/CAS/Sourceprüfung erhalten; vier Pfade integriert prüfen, eigene prepush/zwei Fremdreviews | e7c9e018 |
| F8-UNPROVEN-CHECK | PRÜFEN (nur lesend): ob `allow_unproven_project_create` (`src-tauri/src/api.rs`, abgeleitet aus einem gesetzten `PROJECTA_APP_DATA`) die Verdict-Prüfung der Projektregistrierung außerhalb des isolierten F8-Laufs aushebeln kann; Befund aus der README-Architekturanalyse vom 16.10. | Root disponiert | – | Server | A | Geplant: nicht disponiert (16.10.), zuerst nur lesend; ein Fix nur bei Befund als eigenes Stufe-A-Paket (Nahtdateien seriell) | Bericht mit `file:line` und rotem Test oder „gilt nicht“; keine Aktivierung | – |
| Z4-SERVER-DISK | Server-Platte: alte Worktrees (~151 GB) aufräumen; erst Backup | Root disponiert, Stabschef führt aus | Inbox E17 | Server | – | Geplant: E17/K6 ist beantwortet; Root darf nur saubere alte Arbeitsbäume mit Kopf auf Remote und nach Backup-Liste aufräumen. Zielerreichung nicht belegt. | Platte < 60 %, Backup-Beleg | – |
| Z4-RCLONE | Eigene rclone-`client_id` vor Ende 2026 | Nutzer | – | PC | – | Geplant (Nutzer, Frist Ende 2026); seit 08.10. ohne Beleg | Backup läuft mit eigener ID | – |
| Z4-SETUP-14 | Rest SETUP-14: tote Keys, Permission-Regeln | Nutzer | – | PC | – | Geplant (Nutzer); seit 08.10. ohne Beleg | Liste abgehakt | – |
| Z4-M5-01 | Testerrunde mit 3–5 externen Testern | Nutzer | V16-03, E16 | egal | – | Verschoben | Rückmeldungen festgehalten | – |
| Z4-M5-04 | Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um | Root | Z1 | egal | – | Verschoben | Umfang festgelegt | – |
| SEC-01b | Audit-Abhängigkeiten rustls und Updater aktualisieren | Implementierer; Root nimmt ab | – | Server | A | Erledigt #1728 (merged 2026-10-19T14:03:41Z); rustls 0.23.46 behebt vier Meldungen; zip 4.6.1 (RUSTSEC-2026-0367/-0368/-0369) bleibt offen, Audit Exit 1; Sicherheitsentscheidung durch Elias ausstehend | prepush Exit 0; Audit 7→3 Meldungen; zwei Fremdfamilien-Reviews vor review-ok | PR #1728 |


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
| V16-PATCH | Gelieferte Patch-Releases; gültige weitere Freigaben ausschließlich nach K5/RELEASE-PAUSE | – | V16-RELEASE | – | – | Erledigt: v1.6.1 bis v1.6.6 dokumentiert; v1.6.2 hatte keinen erfolgreichen GitHub-Release und wurde durch v1.6.3 ersetzt. Weitere Releases nur nach aktueller K5-Regel und konkreter Freigabe. | Originale Releasebelege im [Paketarchiv][pakete]; K5-Patch-Ausnahmen, Release-Sperre sowie frisches Minor-/Major-Ja bleiben verbindlich | – |
| DR2-0 | [Archiv][pakete] | – | – | – | – | Erledigt: #1332 (merged 2026-10-13, `61fbd9ac`) | siehe Archiv | – |
| DR2-2a | Denkraum 2: versionierte Ideendialoge speichern | – | DR2-0 | – | – | Erledigt: #1334 (merged 2026-10-14, `797edcb2`); Herkunft: Nutzerwunsch vom 13.10. (Denkraum zu textlastig, Ideen einreichen und von einem Agenten ausarbeiten lassen) → Konzeptauftrag DR2-KONZEPT (Root, 13.10.); Konzeptbericht mit sechs Paketentwürfen DR2-1 bis DR2-6 liegt außerhalb des Repos; DR2-0 wurde als Voraussetzung abgetrennt, DR2-2 in DR2-2a und DR2-2b geteilt; geliefert: DR2-0 #1332, DR2-1 #1336, DR2-2a #1334; DR2-2b (Abschluss- und Übergabebefehle) und DR2-3 bis DR2-6 (Flow-API, Queue-Bridge, Ideen-Oberfläche, Root-Übergabe): kein PR und kein Auftrag (geprüft 16.10.), Rest ohne Disposition; vor weiterem Dispatch mit DN-03 bis DN-05 abgleichen | – | – |
| AP-9 | IPC-Befehlsnamen zwischen `generate_handler!` und Aufrufern abgleichen | – | – | – | – | In Arbeit: nur S0 erledigt, #1413 (`032f1529`, 14.10.); weitere Schnitte: Unbekannt (zu prüfen) | – | – |
| DS-X-01 | Einstellungen-Reiter und Raster, Betrieb-Leerzustand und Headerumbruch unter 1440 px beheben | – | – | – | B | Erledigt: #1604 (merged 2026-10-16; Merge-SHA: `gh pr view 1604 --json mergeCommit`); ersetzt DS-06 ([v2-Unterplan §10.3](plan/v2.0/plan.md#103-designsystem-feinschliff)) | Root-Abnahme getrennt; Nachläufer V2-FU-HEADER-SPACE (Suchfeld und Kontingent bei 1440 px) getrennt | – |

Historische PR-Zuordnung einschließlich #488: [Abschlussarchiv](archive/plan-2026-10/final-2026-10-23.md#dated-context); keine neue Arbeit oder vollständige Zuordnungsbehauptung.

### Release-Reihenfolge — Nutzer-Entscheid 08.10., Root 22:04Z (historisch, v1.6.0 am 09.10. erschienen)

[Historische Reihenfolge](archive/plan-2026-10/history.md#release-reihenfolge-vor-v160).

V16-NACHBEOB, V16-ADR-A7, V16-03 und D8a–c sind keine Vorgänger von V16-RELEASE.
Tester-Kit/Trockenlauf bleibt ein eigener offener Nachweis; die optionale Windows-Sandbox
ist nicht aktiviert; ihre Aktivierung ist nicht freigegeben. E16 vor externen Testern bleibt offen.
Wissenspilot/#651 ist geschlossen (nicht gemergt), DEV-KNOW-01 bleibt verschoben; der abgeschlossene Messschnitt
wird nicht wiederholt. „Lernende Entwicklungskoordination“ ist ebenfalls nach v1.6.0
verschoben (Nutzer 08.10.); im geprüften aktiven Z-Kopf fehlt eine eigene Paketzeile,
daher kein neuer Ausführungsvertrag/Ticket aus diesem Namen. Z2-RECHTE-PILOT bleibt verschoben.
Z4-M4B-0-AUTH (#1607) und Z4-M4B-1a-PLUMB (#1836, 9cc16b85) sind gemergt.
GOAL (#1842, `fa4f2d9a`), TASK (#1849, `8c86bfc4`) und ASSIGN (#1852,
`88ef0b77`) sind angenommen und gemergt; IMPORT (#1855, `d39a03f1`, 23.10. 02:42:19Z) ist ebenfalls gemergt.
Root schließt damit den Source-Lade-/Autorisierungsbefund, nicht alle M4B-Pflichten;
Import-Testnachlauf c91a08d0, GOAL-Restbefunde (Ticket 2dbc396c-9b74-4556-9c28-d9e00f5c6310), separate Audit-Transaktion
und Windows-Nachweis bleiben offen. Continuous bleibt deaktiviert und eingefroren.
#722 ist seit 21:28:34Z gemergt; dessen Reserven wurden geliefert (#725/#726/#727),
kein erneuter Dispatch aus den historischen Startformulierungen unten.

### Z2-AGENTS-SLIM — begrenzter Server-Startvertrag (C)

- Ziel: AGENTS.md am Gesamtabschluss ≤ 8192 UTF-8-Bytes; die zehn Kernregeln wortgleich erhalten. Aktuelle Basis `072b4af16a9b265882665fbf881ce780552f4bec`: AGENTS.md 22274 Bytes/376 Zeilen (Stand 09.10.; am 15.10. auf `c9d4ca35`: 28903 Bytes, vor Start neu messen); vor jedem Schnitt den wirklichen main-SHA pinnen.
- Owner: bestehende Tabellenzuständigkeit, Ausführungs-Stabschef benennt EINEN vorhandenen Doku-Owner nach DR-12; Root pflegt PLAN interim gemäß Auftrag 09.10.
- Exklusiv: AGENTS.md und `docs/development/AGENTS_REFERENCE.md` als eindeutig verlinkte Referenz; bestehende Referenzdateien nur lesen. Keine Skills, globale CLAUDE/MEMORY, PLAN, Hooks/Gates, Quota/Rechte oder Runtime ändern.
- Vorbereitung im selben Worktree: Regeln/Abschnitte gegen bestehenden Reference-Stand mappen, jede ausgelagerte Pflicht per eindeutigem relativen Pfad/Anker erhalten. Vor Dispatch tatsächliche Diffprognose ≤ 300 ALL inklusive Referenz; kein 8-KB-Ziel als Größenausnahme. Falls nötig zwei serielle Doku-Schnitte S1/S2: S1 höchstens 130 bestehende Referenzzeilen bewegen plus Links, S2 nur nach dessen Root-Abnahme/Merge, jeweils ≤ 300 ALL. Reicht dies nicht, vor Start neu schneiden. Nie Referenz vor erfolgreicher Übertragung streichen; keine Regelabschaffung.
- Nichtziele: Änderungen der GOALS-/Operator-/Freigabe-/Review-/Merge-Semantik, Aktivierung von Teams/Workern/Sandbox, Wirksamkeits-/Tokenersparnisbehauptungen.
- Doku-Probe statt künstlichem RED: vorher/nachher UTF-8-Bytes, zehn Kernregeln bytegleich, vollständige Abschnitt→Pfad/Anker-Matrix im PR, Links existieren; `npm run dev:agent-check` und eigene volle `bash scripts/ci/gates.sh lane prepush` Exit 0. „AGENTS-check“ ist hier diese dokumentierte Prüfung plus vorhandener agent-check; kein zusätzlicher gleichnamiger Gate im geprüften gates.sh-Katalog.
- Abnahme je S1/S2: normaler Secret-/Commit-/Pushhook, Remote-SHA bestätigt, eigener Draft-PR ≤ 300 ALL mit Report/NICHT ABGEDECKT, Tier C, Root-Kopfannahme vor Ready/Mergify. Endziel ≤ 8192 Bytes erst am letzten integrierten Schnitt.
- Startgates: DR-12-Beleg, aktuelle Owner/Dateisperren, beobachtetes Modell/Quota, RAM ≥ 1,5 GiB, Cargo/Slot prüfen. Vorhandene Doku→Gate→Root-Kette wiederverwenden; kein neues Team/Agent/QA. Abbruch: fehlendes Mapping, Link oder Size-Cap stoppt den Schnitt. NICHT ABGEDECKT: allgemeine Adoption oder gemessene Tokenersparnis.

## Lanes (5 parallel) — historisch (v1.6.0, erledigt 09.10.)
[Originaltext][historie]

### DR-07c/d/e1/e2: vier weitere P1-Testports (historischer Startvertrag; erledigt: 07c #752, 07d #753, 07e1 #751, 07e2 #755)
[Originaltext][historie]


[Abgeschlossene P1-Testports](archive/plan-2026-10/context-2026-10-23.md#completed-p1-test-ports-on-8-october).

### Serverreserve: drei disjunkte Startverträge (Root 08.10., 20:45Z; historisch, erledigt #725/#726/#727)
[Originaltext][historie]

### Serverreserve 2: fünf zusätzliche Startverträge (Root 08.10., 21:27Z; historisch, erledigt #738/#739/#742/#745/#746)
[Originaltext][historie]

### Anpassungsnachweis DR-15a und Übergaben (08.10. 04:40 UTC, historisch)
[Originaltext][historie]

### Anpassungsnachweis PLAN-C1 (historisch)
[Originaltext][historie]

## Entscheidungs-Inbox

### Entscheidungen 23.10.2026 — PLAN v2 und aktuelle Glass-Oberfläche

Quelle: die von Root übermittelten Nutzerantworten im freigegebenen PLAN-v2.0-1-Auftrag (Ticket d97a1464-c21a-416e-80da-cc9182cfa03f); keine zusätzliche Laufzeit- oder Freigabebehauptung.

- **Archiv-Ausnahme, nur dieses PLAN-v2-Ziel:** Nutzer-Ja über Root `msg-0mvkbcsmi-e44a645a`, r2 angenommen durch `msg-0mvkbo7z8-610b871f`. Reine bytegleiche Verschiebungen aus diesem Master nach `docs/archive/plan-2026-10/` dürfen 300 rohe Diffzeilen überschreiten, sofern Quell-/Ziel-SHA und inverse Rekonstruktion belegt sind. Alle übrigen Änderungen zählen auf beiden Seiten und bleiben ≤300 je PR. Nur die frühere strikte RAW-Aufteilung dieses Ziels ist ersetzt; Gates, Reviews und Root-Abnahme bleiben verbindlich.
- **Releaseziel:** laut Root (~01:38Z) v2.0.0 mit der aktuellen Glass-Oberfläche erst nach funktionierenden Funktionen, einheitlicher UI und sauberem Release. Pixel-Fabrik, DS-H und DS-WF folgen in v2.x. ACC1b/#1540 und UAT1a/#1544 sind seit 18.10. geschlossen, nicht gemergt; ihre Abnahmen werden anhand aktueller Glass-Belege neu geschnitten, die alten Branches sind nur Referenz.
- **Begrenzte Entparkung:** Nutzer „ja“, Root `msg-0mvkczla4-535d271c` (~02:37Z): der Designstopp vom 18.10. ist ausschließlich für die aktuelle Glass-Vereinheitlichung aufgehoben. Erst die genehmigte nur lesende Bestandsaufnahme, dann durch deren Belege begrenzte DS-U-Codepakete; DS-U0 darf unabhängig die README korrigieren. Keine vorab beschlossene vollständige Entfernung von `styles.css`. Fabrik später als Familie mit gemeinsamen `--g-*`-Tokens und Schnittstellen; jetzt keine Fabrik-Implementierung, -Tokens, -Exporte, -Artefaktauffrischung oder Pixelarbeit.
- **Offene Freigaben:** Release-Sperre/K5 sowie D1-on/#1540 bleiben sichtbar. Diese Entscheidung erlaubt keinen Versionssprung, Tag oder Release; Major v2.0.0 benötigt das frische abschließende ausdrückliche Nutzer-Ja. Sonstige offene Fragen und Abnahmen bleiben offen. Die frühere Meisterbüro-/Probe-Halle-Reihenfolge unten ist damit für den aktuellen Glass-Schnitt überholt.


Gültige Entscheidungsbindungen (beantwortet, keine neue Freigabe):

| # | Entscheidung | Geltung und Abgrenzung | Status |
|---|---|---|---|
| 15.10.2026 | [The user answers seven questions (v2.0 eng)](decisions.md#2026-10-15---the-user-answers-seven-questions-v20-eng) | PA_SEAM_ALLOW nur je Root-Auftrag; Zustandswörter/Farben und ruhige umstellbare Orbs; fremde Agentenkonfiguration nur nach Backup, eigene ausgenommen. Navigation durch NAV-0 und den begrenzten Glass-Entscheid vom 23.10. fortgeschrieben; Antwort ist kein Umsetzungsbeleg. | beantwortet; gültige Regeln bleiben, keine erneute Grundsatzfrage |
| 16.10.2026 | [NAV-0: six navigation areas, three visible in v2.0, tab "Linie"](decisions.md#2026-10-16---nav-0-six-navigation-areas-three-visible-in-v20-tab-linie) | Sechs Bereiche, damals drei sichtbar: Fabrik/Betrieb/Einstellungen; Linie, Halle erst nach DS-H-07-Abnahme, IDs stabil. Fabrik seit Glass-Entscheid 23.10. v2.x; GI02/GI05 bleiben offen, heutige Glass-Ansicht damit nicht abgenommen. | beantwortet; spätere begrenzte Glass-Freigabe gilt, keine Fabrik-Entparkung |

Beantwortete Karten bleiben im [Entscheidungsarchiv](archive/plan-2026-10/final-2026-10-23.md#answered-cards) samt Quellen, Wortlaut und späteren Änderungen erhalten. Es gibt keine erneute Grundsatzfrage aus ihren alten Formulierungen.

| # | Frage | Empfehlung | Status |
|---|---|---|---|
| DR03-F01 | Gesamtgröße des Ledgers begrenzen: WRITE-/Listenlimits getrennt von harter SAFE-READ-/Vor-Parse-Bytegrenze, alle Top-Level-/Nested-Listen, Bestandslesen/503 und spätere Konfigänderungen disponieren | neue übergroße Writes nichtdestruktiv ablehnen; keine Trunkierung/Archivierung/Retention; keine Lesbarkeitszusage jenseits sicherer Lesegrenze; erst repräsentative reale Ledgerform/-größe/-kosten, keine erfundenen Grenzwerte | offen; Interview-Vorbereitung im bestehenden Ticket, Empfehlungen keine Entscheidung; zwei Nutzerfragen bis Belegbasis bei Root geparkt, gesamte DR-03-Abnahme offen |
| OPT-CI-0 / Vorschlag 3 (15.10.) | Windows in der Queue ohne geänderte WINDOWS_INPUTS überspringen? | Offen abwägen: weniger Läufe; Fehler außerhalb der Eingabeliste erst im Wochenlauf erkennbar | offen, Prüfschritt entschieden: Nutzer 16.10. (K3, C; Root-Chat): erst lesend prüfen, ob die WINDOWS_INPUTS-Liste die letzten Windows-Fehler abgedeckt hätte, dann erneut fragen; Prüfung nicht disponiert; keine Umsetzung freigegeben |
| V2-OFFEN | v2.0-Fragen 5–9 und 11 | nach Z1 | offen, fällig seit v1.6.0 (09.10.); Frage 7 = E15 und Frage 11 = E17 (nicht doppelt fragen); bis zur Antwort gilt je Frage „Ohne Antwort“ (v2-Plan Abschnitt 7) |
| GI02 / GI05 | Classic und 13 Platzhalter verbergen/hinter Schalter oder bauen? | Root legt den begrenzten Umfang anhand der aktuellen Glass-Bestandsaufnahme vor | offen; keine Implementierungsfreigabe aus der Frage |
| SEC-01b | Verbleibende zip-Meldungen disponieren? | Bestehenden Auditbefund und Sicherheitsfolgen entscheiden | offen; bei Root zur Nutzerentscheidung |
| E15 / E16 | Server-Zukunft bzw. Lizenz/Geschäftsmodell entscheiden | Nach erster V2-CAP-1-Auslastungszahl bzw. vor erster Testerrunde wieder vorlegen | offen zum beschlossenen späteren Zeitpunkt; Server bleibt, MIT bleibt |


### Entscheidungen 18.10.2026 (Elias)

[Datierter Originalentscheid](archive/plan-2026-10/final-2026-10-23.md#design-decisions). „Nutzbar 1“ bleibt das Ziel vor neuen Funktionen; der spätere Glass-Entscheid oben ersetzt die damalige Designsperre nur in seinem begrenzten Umfang. Retrospektive kostenlose Reviews bleiben historische Belege und zählen nicht nach heutiger Regel 5.

#### Nachtrag 19.10.2026, 02:10 MESZ (Root, Stand nach #1714 und #1724)

[Datierter Designnachtrag](archive/plan-2026-10/final-2026-10-23.md#design-decisions); DESIGN-R2 bleibt v2.x/geparkt. Keine aktuelle Modell-, Quoten- oder Startfreigabe aus dem damaligen Stand.

[Datierte DG-Übergabe](archive/plan-2026-10/context-2026-10-23.md#dg-handover-on-22-october), einschließlich [KI-24-Beleg](../KNOWN_ISSUES.md#ki-24-windows-wiederauftreten-und-erfolgreicher-wiederanlauf-22102026). KI-24 bleibt offen; Ursache des alten H1-Testläufer-Hängers unbelegt. Manuelle scripts/dev-Tests sind nicht in der Gate-Bahn; C1/P3 bleiben geschützt. H1-Nachläufer D1/G2 (Cleanup-Baseline), D2 (spawn-Timeout), D3 (-h-Usage), G4 (fehlende Baseline) bleiben geparkt ohne Start.
B1a/B1b behalten unten alle 396 Schlüssel, Reihenfolge und Werte; B1b erst nach B1a-Merge, Prozessende und freier Datei. Kein --update, Messlauf, neue Metrik/Grenze/CI-Verdrahtung. EQ-2 bleibt entfallen, P9 begrenzt, Referenz-App gestoppt, DESIGN-R2 v2.x/geparkt; D1-on/#1540 und externe Gesamtabnahme bleiben offen.

| ID | Ziel | Owner | Hängt ab von | Ort | Stufe | Status | Abnahme | Ticket |
|---|---|---|---|---|---|---|---|---|
| DG-00 | Design gate `scripts/dev/design-gate.mjs` + `npm run design:gate`: measures unearned slack, box nesting, empty tabs, eyebrows and equal 1fr grids at 0/2/12 items, ratchet baseline; not wired into `gates.sh` (later decision by Elias) | Root disponiert; Autor Codex | – | Server | B | Erledigt: #1723 gemergt 2026-10-20 (`ce1391da`, Kopf `295fb44a`); zwei Nicht-Codex-Familien geprüft, Disposition im PR; main-CI grün; Gate bleibt außerhalb von `gates.sh` (Verdrahtung = spätere Entscheidung Elias); R1723-H1 erledigt, siehe DG00-H1-CLI-HELP; bisher verschobenes B1 durch begrenzten Root-Folgeauftrag in R1723-B1a/B1b geschnitten, Gesamtziel weiter offen; C1/P3 (CI-Verdrahtung/Grenzwerte) bleiben Entscheidung von Nutzer/Root | zwei Nicht-Codex-Familien, Gates grün; ursprüngliche DG-00-Lieferung bleibt erledigt | – |
| DG00-H1-CLI-HELP | Bestehende design:gate-CLI um erfolgreiche --help/-h ohne Mess-, Ausgabeordner- oder Baseline-Nebenwirkungen ergänzen; nur R1723-H1 aus #1723 | srv-dg00-h1-cli-help (job72), fortgesetzt als srv-dg00-h1-cli-help-r2 (job74), Branch codex/dg00-h1-cli-help; Chief disponierte, Root nahm ab | DG-00 | Server | B | Erledigt: #1825, Kopf c54ec5f129cfa555f9d22efab4bc6fa223a27d39, durch Queue #1827 als 0fa721bd133ff15ec57de84d8e52ebc939596bdd am 22.10.2026 09:59:50Z gemergt; Root angenommen nach GLM-/DeepSeek-Prüfungen (approve with conditions), Disposition im PR | Basis dcd4f29408f479db8e8b94eb66006950d2c264e3; 57 rohe Diffzeilen, nur scripts/dev/design-gate.mjs, NEU scripts/dev/design-gate-cli.test.mjs und docs/design/BUILDING.md. Originales design-gate.test.mjs mit 14 Mess-/Ratchet-Tests unverändert. Öffentliche CLI-Regression Rot→Grün, default red-first 0 und volle prepush 0 laut Autorbericht, durch dieses Doku-Paket nicht erneut ausgeführt. Isolierter Testpfad von Root am 22.10. 08:38:18Z als nicht blockierende Anpassung angenommen; keine Metrik-/Schwellen-/Baseline-Format- oder CI-Verdrahtungsänderung, kein neuer Designbau | 69c61ba2-957f-4f60-9488-d3da87ccd37d |
| R1723-B1a | Vorhandenen Baseline-Schreiber auf einen kompakten Fall je Zeile umstellen; erste 132 bestehende Fälle formatieren, 264 als kompakte Restzeile erhalten | srv-dg00-b1-baseline-writer (job76), Branch codex/dg00-b1-baseline-writer; Chief disponiert, Root nimmt ab | DG-00, DG00-H1-CLI-HELP gemergt; exklusiver Baseline-Schreiber | Server | B | Erledigt: #1828 am 22.10.2026 um 11:49:57Z gemergt (`88c10c77`), Kopf `743f5b46`; B1-Gesamtziel und B1b bleiben getrennt. | ≤300 rohe Diffzeilen; nur scripts/dev/design-gate.mjs, NEU scripts/dev/design-gate-baseline.test.mjs, scripts/dev/design-gate.baseline.json und docs/design/BUILDING.md. Reine Serialisierungsregression Rot→Grün, vorhandene Mess-/CLI-Tests unverändert grün, default red-first und volle prepush 0; eine von Root beauftragte Fremdfamilienprüfung laut begrenztem Auftrag. Alle 396 geparsten Schlüssel, Reihenfolge und Zählwerte unverändert; kein --update, Messdurchlauf oder C1/P3-Anschluss. Stufe 1 schließt das B1-Gesamtziel nicht ab | d10b1459-57e4-45b8-bc4f-865ceb2ff205 |
| R1723-B1b | Verbleibende 264 bestehende Baseline-Fälle rein als JSON formatieren | Noch kein Ausführungsowner; Chief disponiert nach Freigabe, Root nimmt ab | Tatsächlicher B1a-Merge UND Prozessende UND freier exklusiver Baseline-Schreiber; gemeinsamer Dateipfad nur seriell | Server | C | Blockiert: serieller Nachfolger, kein Start oder Lieferbeleg | ≤300 rohe Diffzeilen; nur scripts/dev/design-gate.baseline.json, ausschließlich Formatierung. Alle 396 geparsten Schlüssel, Reihenfolge und Zählwerte erhalten; eigene volle prepush, Root-Abnahme/Mergify; keine neuen Fälle, --update, Messung oder CI-Verdrahtung. Erst beide angenommenen/gemergten Schnitte erfüllen den B1-Formatierungsrest | bce93908-1192-438a-8dd8-2ec939b89eec |
| DG-05 | Not-Aus needs a confirmation and exists once (header), Escape/Abbrechen without effect, focus returns | Root disponiert; Autor Codex, Fix-Runden Kimi | – | Server | A | Erledigt: #1722 gemergt 2026-10-20 (`87314b5e`, Kopf `fb2aed45`); Reviews Anthropic (R1, R2) + NVIDIA nemotron (R2), Disposition im PR; main-CI grün; R2-L1/Override separat in FU-DG05-HEADER-HINT (#1810) geführt | zwei Nicht-Codex-Familien, Gates grün; ursprüngliche Lieferung bleibt erledigt | – |
| DESIGN-R2 | Astra round 2 on the Meisterbuero prototype (outside the repo, `pa-orch`), then two independent critics | Elias (TasteCode), Root prüft | Elias' decision 19.10. | PC | C | Verschoben: v2.x/geparkt gemäß Glass-zuerst-Entscheid 23.10.; kein Dispatch; prompt written and checked by the advisor bleibt Herkunft | PASS of the design quality gate | – |

### Entscheidungen vom 16.10.2026 — OWNER-KARTEN-1016

[Vollständige Antworten K1–K15 und weitere Karten](archive/plan-2026-10/final-2026-10-23.md#owner-decisions). K5/Release-Sperre, K7/M4B-Reste und K11/Continuous-Freeze gelten wie oben; K3 verlangt eine lesende WINDOWS_INPUTS-Prüfung vor erneutem Fragen. E15 wartet auf V2-CAP-1, E16 auf die erste Testerrunde. Keine wieder offene Freigabe aus diesem Archivverweis.

### Entscheidungen vom 18.10.2026

[Vollständige Antworten vom 18.10.](archive/plan-2026-10/final-2026-10-23.md#owner-decisions). ROADMAP-HOST bleibt verbindlich: lokal erzeugte `.pa/roadmap.html` und Dev-HQ, keine Veröffentlichung der Roadmap-Seite auf GitHub. Alte Provider-Sperren sind kein heutiger Zulassungsbeleg.

### Beantwortete Karten vom 13.10.2026 — Zwei-Modi und Anbieter
[Originaltext][historie]

## Entschiedene Fragen

PLAN-1 ist durch PLAN-L0-SINGLE entschieden (07.10.): `docs/PLAN.md` bleibt
der einzige Plan, v2.0 ist ein Unterplan. Q10 ist ersetzt; V2-FREEZE-1a/1b entfallen
in ihrer alten Form, die Parser-Pflege übernimmt Z2-PLANPARSER.
Der öffentliche Repo-Neustart ist erledigt: `c60f267` „Initial public release of ProjectA“.
E1–E13 (außer E3), E19, E20, E24, E25, F1–F6, N1, N2, R19, W5-02b3 und
ARCH-D4-PLAN stehen im Archiv und werden nicht neu gefragt.
In `docs/decisions.md` entschieden und umgesetzt, keine offene Frage: CI-QUEUE-02 (#369, `8d1a9467`: Mergify `max_parallel_checks` 2), CI-HARDEN-02 (#404, `4d717fe0`: `review-ok` als Queue-Bedingung) und AGENTS-API-CREDITS (#918, `80ff86a3`: enge Ausnahme für die im Abo enthaltenen API-Guthaben).

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

## Ehemals aktive Ziele und L0-Schnitt (07.10., historisch)

[Ideenfließband V1.0](archive/plan-2026-10/history.md#ideenfließband-anforderungen-und-historischer-übergabestand-v10) steht vollständig und unverändert im Archiv als historischer Anforderungs-/Übergabestand. Aktuellen Status, Freigaben und Verträge führt ausschließlich dieser Masterkopf. Cloud-/Assistentenfassungen sind historische Übergaben, keine synchronisierte zweite Planquelle; PA r05iwt erhält den bestätigten Ref erst nach Integration.
Root-Auftrag und Site-Amende: Child `ec223b75-7972-4555-a442-43e0e32c8fcd`, Chief-Mail `msg-0muy8gvba-939fb23b`, 07.10.2026 14:59 UTC. PM besitzt nur diesen Dokumentenschnitt, Gesamtowner IDEAS-L0 ist Root; Chief disponiert, Root prüft FIT und nimmt ab.
[Historische L0-Vorhersage](archive/plan-2026-10/history.md#l0-vorhersage). Ein Dokumentabschluss beweist keine nutzbare Lieferung.

| Ziel / bestehender Auftrag | Wirkung, Umfang / Nichtziele | Owner / Vorgänger | Abnahme / Evidenz / Status | Nächster Schritt / Blocker / Stand UTC |
|---|---|---|---|---|
| IDEAS-L0 / PLAN-L0-P0 `ec223b75-7972-4555-a442-43e0e32c8fcd` | dauerhaft erfassen, bearbeiten, wiederfinden; kein Planeditor/Graph/Pilot/Autorecherche | Root Gesamtziel; PM cwqxbk Dokument; Backend mctdww; UI d567gh; Chief Integration/FIT an Root | Unbekannt (zu prüfen): P1/P2 über DR-02 bis DR-14 gemergt, L0-Nutzerabnahme nicht belegt; ursprünglich: P0 In Prüfung; Vorbereitung tatsächlich15:05:57Z, Source noch nicht gestartet; Produktlieferung offen; Quellbasis oben, V1.0-SHA329a53ca…124b2c; Zuweisung ist kein Runtime-Start | vollständiger Diff/Metadatenvertrag → Root; anschließend Backend/UI und echte Nutzerabnahme; 07.10.15:00:47 |
| DD-RECEIPT `285001a5-ede9-4940-b039-42d0dd892e96` | bestehende Frage-Quittungsanzeige, disjunkt zu L0 | alleiniger UI d567gh; bestehender V2-Receiptvertrag | Verschoben nach L0; Child pending, Root15:10:09Z; 495 ALL NOT FIT, unimplementiert | ganze Programme/23 Fälle/Pins erhalten; keine zweite Revision/Integration; Frageanzeigebug blockiert Ideensammlung nicht |
| V16-ARCH-D4 `b9606dd4-4dab-460c-9229-a47699702f6d` | restliche API-Entlastung; kein L0-Vorgänger/Releasebeleg | alleiniger API-Owner Root; Part4 Mergify #629 auf3db3407 | In Prüfung laut Root15:20Z: [PR631](https://github.com/Cuarroc/ProjectA/pull/631)/1d4b5bc, eigene Gates0, beide CI37631238380 erfolgreich, Sonnet ACCEPT; kein Merge | zweiter Vendor403, Reviewgate offen; keine frische PM-CI-/Sourceprüfung, Chief API seriell — Nachtrag 15.10.: #631 am 08.10. gemergt (`013513b2`), siehe Z3 V16-ARCH-D4 |

Verbindliche acht Nutzerstatuswerte: Root-Original `msg-0muy9i618-c05a9ee8`, 07.10.2026 15:28:14.348 UTC, vollständig im P0-Child; Chief-Mail `msg-0muy9ivvz-44910681`. B-STATUS ist damit geklärt. Zuweisung allein ist nicht In Arbeit.

| Status | Bedeutung |
|---|---|
| Geplant | beschrieben, noch nicht ausführungsbereit |
| Bereit | Voraussetzungen und Abnahme geklärt |
| In Arbeit | tatsächliche Bearbeitung begonnen |
| In Prüfung | Ergebnis vorhanden, Abnahme offen |
| Erledigt | Abschlusskriterien erfüllt und belegt |
| Blockiert | konkrete Voraussetzung verhindert Fortsetzung |
| Verschoben | bewusst späteres Lieferfenster |
| Entfallen | durch dokumentierte Entscheidung aus Umfang genommen |

### L0-Mapping auf vorhandene Arbeit

P0 im importierten V1.0-Text = PLAN-L0-P0; dieser Schnitt besitzt ausschließlich `docs/PLAN.md` (Tier C). Keine Runtime-/Gate-/Supportänderung; kompletter materialisierter Diff einschließlich Unterstützung muss ≤300 ALL sein.
P1 = bestehender DD3b `b0e90b72-c328-4fe5-8c12-b158c8ab6e83`, alleiniger Backendowner mctdww: Store/API-Vertrag, Metadaten, Daten-/Replay-/CAS-Regressionen; keine UI-Dateien. Bestehende DD1/DD3a-Vorgänger done laut Ticket; DD3b insgesamt weiter offen.
P2 = bestehender DD2 `6713479b-4e9b-46a6-98f4-3b8c0c76344f`, alleiniger UI-Owner d567gh: Eingabe/Liste/Detail, Suche/Filter/Sortierung, Entwürfe und Stationsband; keine Store-/Serverdateien. Start erst nach Root-FIT des P1-Vertrags und Chief-Abgrenzung der freigegebenen UI-Dateien; keine neue parallele Ticketserie.
P3 = Chief/Root bestehende Betriebs-/Integrationsverantwortung nach P1/P2: Backup, kontrollierte Integration und tatsächlicher Nutzerzugriff. Ein neuer Child/Arbeitsbeginn ist hier nicht behauptet. HTTP200 lokal ist kein Handy-/Öffentlichkeitsbeleg.
P4–P10 bleiben mit allen Originalanforderungen im folgenden V1.0-Abschnitt; keine vorgezogene Umsetzung. Teil02-A `73aa18e3-8f3b-4f92-93e8-279e858b6d01` ist nach L0 verschoben, Original/tests/transport/pins erhalten; kein dritter Lauf. Studio `7e16930a-2dee-449b-ad8c-7ed642d8bb7b` und Pilot `44ac79d9-48fb-4fb7-8eb7-ee35608bd964` sind keine L0-Abhängigkeiten.
B3-Store ED6A560E und W3-r app51C5D7E8 sind Root-berichtete deployte Quellen, keine frisch hier auditierte oder synchronisierte Workbench/PlanDraft-Komposition. Angenommen, integriert, erreichbar und abgenommen bleiben getrennt. Backend/UI prüfen ihre vollständige tatsächliche Basis vor Source-Start.

### Modellzuordnung: geplant, konfiguriert, wirksam, erfolgreich benutzt
[Originaltext][historie]

### Minimaler additiver Ideenmetadatenvertrag (Root-Disposition 07.10.15:20 UTC)

Root15:20Z hat flache optionale Request-/Revisionsfelder genehmigt (ersetzt den früheren Envelope-Vorschlag): `category` = getrimmter Text ≤80 UTF-16-Codeunits, leer erlaubt; `userPriority` = `urgent|high|normal|later` (UI dringend/hoch/normal/später). Keine Pflichtoptionen zur Freitextidee, keine Metadaten im Originaltext und keine neue Schema-/Jobarchitektur.
Fehlende historische Metadaten nur lesend als `category=""` (UI „Nicht eingeordnet“) / `userPriority="normal"` projizieren; alte gespeicherte Objekte, Originaltexte, Request-Payloads und Antwortbytes nicht rückwirkend umschreiben. `questionPriority` ist niemals `ideaPriority`/`userPriority`.
Neue explizite Metadaten werden Teil der normalisierten Request-Identität und des neuen append-only Ideensnapshots; gleicher RequestId/geänderte Metadaten muss409 bleiben. Bei vollständig ausgelassenen Metadaten exakt den bisherigen kanonischen Replaypfad/Bytes erhalten; historische Replays bleiben historische Antworten.
Neue CAS-Revisionen übernehmen bei ausgelassenen Feldern die aktuelle Kategorie/Priorität erst nach der bestehenden Replayprüfung; historischer Replay wird nicht neu ausgerechnet. Nur explizite Eingabe ändert Werte, kein Default-Reset. Neues Schreiben verlangt explizite CAS-Revision, veralteter neuer Edit409; vorhandene atomare Schreib-/Recoverypfade verwenden.
Titel/Text/Quelle/Herkunft und alte Ideen-/Fragen-/Antwort-/Receipt-/Planreferenzen erhalten; `actor/source` sind Provenienz, niemals Freigabe. `incoming` heißt Eingang, nicht bereits geprüft; automatische Bewertungen bleiben sichtbar ungeprüft. Vormerken erzeugt keinen Agentenauftrag und keine Root-/Nutzerfreigabe.
Pflichtkompatibilität P1: alte Requests/byteidentischer Replay nach Neustart; neue Defaults, alle vier Prioritäten, Kategoriegrenze; Metadaten-only Edit, omit-preserve, changed-request409, stale-CAS409; Fehlwrite/Retry ohne Datenverlust; unveränderte Geschwister/Receipt-/Provenienzfälle. Tatsächliche Tests erst im zuständigen Paket, nicht hier behauptet.
P2 liest nur erkannte Felder, sucht Text/Titel, filtert Kategorie/Priorität/Station und sortiert stabil; zeigt Herkunft und „Noch nicht geprüft“ sowie vollständiges Stationsband mit unfertigen Stationen „Wird ergänzt“. Alte Inhalte ohne Felder bleiben bedienbar; Wechsel zur tatsächlich gewählten Idee gegen erhaltenen ungesicherten Entwurf prüfen, bevor Bearbeiten als geliefert gilt; kein Editor/Graph als Voraussetzung.
L0-Abnahme: Der Nutzer speichert drei Ideen, bearbeitet eine samt Kategorie/Priorität, sucht/sortiert, lädt neu; Inhalt bleibt gleich. Speicherfehler erhält den Entwurf; CAS-Konflikt/replay/restart verlieren nichts. Funktionierender Nutzerlink mit Zugriffsvoraussetzungen und tatsächlicher Prüfung, relevante unabhängige Reviews und kontrollierte Integration sind erforderlich; P0-Dokuabschluss erfüllt dies nicht.

<a id="ideas-l0-v1-0"></a>

## Ideenfließband-Anforderungen und historischer Übergabestand (V1.0)
[Originaltext][historie]

# ProjectA: Ideenfließband – Umsetzungsplan
[Originaltext][historie]

## 1. Verbindlicher Auftrag und erste Lieferung
[Originaltext][historie]

## 2. Ausgangslage und Evidenzgrenze
[Originaltext][historie]

## 3. Produktmodell: zwei miteinander verbundene Bereiche
[Originaltext][historie]

### Stationen und eindeutige Austrittskriterien
[Originaltext][historie]

## 4. Freigabe und Priorisierung
[Originaltext][historie]

## 5. UI und UX: schnell erfassen, gut überblicken, gezielt vertiefen
[Originaltext][historie]

## 6. Anlagen, Recherche und Planentwurf
[Originaltext][historie]

## 7. Daten und technische Leitplanken
[Originaltext][historie]

## 8. Umsetzungspakete und Parallelisierung
[Originaltext][historie]

| Paket | Inhalt / Ownerrolle | Voraussetzung | Abnahme |
| --- | --- | --- | --- |
| P0 | Root + PM: Quellstand, Zugriff, bestehende Tickets und Paketgrenzen disponieren | aktueller Auftrag | Owner, erster kritischer Pfad, Blocker und Lieferprognose dokumentiert |
| P1 | Backend: sichere Erfassung, Revision, Liste und Bearbeitung wiederverwenden/ergänzen | P0 | Idee überlebt Reload/Neustart; Konflikt und Fehlversuch verlieren keine Daten |
| P2 | Frontend: Eingabe, Liste, Filter, Sortierung und Detail | P0, abgestimmter P1-Vertrag | Der Nutzer kann den vollständigen L0-Ablauf bedienen |
| P3 | Betrieb/Integration: erreichbarer Zugang, stabile Instanz, Backup und L0-Verifikation | P1/P2 | echter Nutzerlink, getesteter Speicherweg, Rückfallmöglichkeit |
| P4 | Backend + Frontend: Anlagen und Vorschau | L0, Uploadvertrag | Datei bleibt zugeordnet; Fehler/Limit/Rechte verständlich |
| P5 | Vorbereitung: Kategorien, Dublettenhinweise, Nutzen/Risiko mit Provenienz | P1, Jobvertrag | konkrete Einordnung sichtbar/korrigierbar; unbekannt bleibt unbekannt |
| P6 | Pipeline: Jobs, begrenzte Recherche und revisionierter Plan | P5, bestehende PlanDraft-Verträge | Ergebnis referenziert richtige Revision; Retry erzeugt kein Duplikat |
| P7 | Freigabe + Roadmap + Orchestrator-Handoff | P6 | exakte Planfreigabe; tatsächlicher Empfang/Start/Abschluss getrennt |
| P8 | Board, fokussierter Graph, Langfristansichten | stabile Beziehungen aus P5/P7 | Filter/Textalternative/Zyklen; keine Verzögerung von L0 |
| P9 | Last, Mobilpolitur, Export/Wiederherstellung | inkrementell nach L0 | gemessene Grenzen und bestandene relevante Regressionen |
| P10 | Arbeitsregeln, Skills/Prompts/Trigger und begrenzter Kritikerpilot | bestehender Pilotauftrag | messbare Entlastung, keine neue dauerhafte Koordinationslast |
## 9. Blocker, Bestätigungen und Cloud-Dokument
[Originaltext][historie]

## 10. Die stärksten Einwände und ihre Behebung
[Originaltext][historie]

## 11. Abnahme, Erfolg und sofortiger Arbeitsauftrag
[Originaltext][historie]

### Lieferprotokoll
[Originaltext][historie]

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

Historisch (25.09.): „nach M1/M4“ ist kein Termin mehr; das Urteil je Zeile steht in [`plan/v2.0/mapping.md`](plan/v2.0/mapping.md) (06.10.).

„Gestrichen“ heißt: fällt weg, bei Bedarf neu einplanen. „Geparkt“ heißt: die
ID bleibt, wird nicht gezählt und nicht dispatcht, und kommt erst nach M4
zurück. Die DEVFLOW-Zeilen tragen ihren Status zusätzlich in der Tabelle unten.

### Gestrichen

| Was | Grund |
|---|---|
| W5 Phase H: W5-26 Angriffs-Reviewer, W5-27 Mutationstest-Gate, W5-29 Anbieter-Wettbewerb | vervielfachen den Abo-Verbrauch und helfen dem Ziel nicht |
| DF-12, DF-18, DF-19, DF-20, DF-26, DF-35, DF-36, DF-37 | DEVFLOW-Doppelungen: schon anderswo geplant oder gebaut (Gründe je Zeile in der DEVFLOW-Tabelle) |
| Aliase auf gestrichene DF-Pakete | W5-08a/08b (Alias von DF-18) werden wieder eigene, geparkte W5-Pakete; HQ2-10 (Alias von DF-35–37) ist mit HQ2-06–10 geparkt |
| `.github/workflows/review.yml`, `anthropic-wif-test.yml` | tote Workflows, in PLAN-01 gelöscht (git behält sie) |
| Pflicht-Berichtsdatei, eingecheckte Review-Prompts, Spec für S-Pakete | ersetzt durch den PR-Text (AGENTS.md, Regel 7) |

### Geparkt

| Was | Grund | Wann wieder |
|---|---|---|
| **W5 außerhalb des Kerns:** W5-01a/b/c, 02c, 02d, 02e, 03, 06, 06b, 07, 08a, 08b, 09a/b/c, 10, 11, 12–16, 17–21, 23–25, 30a/b, 31a–c, 32–34, 35a–f, 36a/b, 37–39 | Das Projekt-System hilft dem Ziel nicht. Kern in M3/M4: W5-02a, W5-22, W5-28, W5-00b, W5-02b3–b5/b7, Not-Aus W5-04a–c, Prüfpfad W5-05 | nach M4; zuerst W5-31 (App zu, Worker laufen weiter); Phase J (autonomer Merge) erst nach vier Wochen Continuous ohne Rückschlag. Konzept: `.pa/plan_projects_w5.md` (nicht im öffentlichen Repo) |
| **DEVFLOW-Motor:** DF-11, DF-13–17, DF-06b, DF-08d | zweite Steuerung neben dem fertigen Continuous-Kern | nach M4 als Erweiterung des Continuous-Runtime neu schneiden |
| **DEVFLOW-Ausbau:** DF-09b, DF-10, DF-21–25, DF-27–34 | hilft dem Ziel nicht; DF-09b wäre ein Doppelbau | nach M4 |
| **HQ2-04, HQ2-06 bis HQ2-10** | große Pakete, jedes ein eigenes Projekt | nach der Oberflächen-Entscheidung (HQ2-02) neu planen |
| W1-09c (KI-1 editierbar), W1-12 (Design-Reste) | Komfort, niedriger Nutzen | nach M4 |
| W4-03a (Journal-Teil ohne Aktivierung) | nur für das geparkte W5-03 nötig (Nutzer 25.09.: später) | mit W5-03 |
| W3-09 (Struktur-Split) | inaktiv, nur wenn W0-05 = zerlegen | bei Bedarf |

### Später (neue Ideen und zurückgestellte Themen)

| Thema | Wann wieder |
|---|---|
| Vorschlag: Alltagssprachliche Diff-Erklärung als gekennzeichnete Einschätzung neben echtem Diff/Befunden (Radar 99235669); A/B/C/unbekannt aus M3-02/#189 erhalten, keine Sicherheitsampel-Zusage | nach M4; kleiner Folgeumfang, keine Wiederholung von #189 |
| Vorschlag: Aufgaben-Vorlagen im App-Arbeitsfluss bei belegtem Nutzungsbedarf (Radar 8985d001); drei Doku-Vorlagen M3-01/#144 sind bereits gemergt | Bestandteil der geparkten DF-33/34; keine parallele neue Planung |
| Vorschlag: Dispatcher nach Start entschärft mit Vorschau (Radar 12d7a534); Not-Aus, Env-Vorfahrt und Reattach erhalten | Später; ausdrückliche Sicherheits-/Umfangsentscheidung, serielle st/mn/pa-Schnitte und Tier-A-Reviews vor Umsetzung |
| Vorschlag: Linux-Runner-Image gezielt pinnen (Radar bbe0db91) | bestehendes CI-Umbrella c77f6955; zuerst behauptete Frist 19.10. und Gate-Kopplung offiziell belegen, dann gesondert priorisieren; kein Bruch oder Pin freigegeben |
| Agenten per Protokoll statt Tippen steuern (strukturierte Schnittstellen der Anbieter) | nach M4 (Nutzer 25.09.: später) |
| ADR, die die st-Lane für unabhängige `store/`-Module teilt | Verschoben nach V16-ADR-A7 / V2-ARCH-0 (mapping.md); ursprünglich: nach M1 (Nutzer 25.09.: später) |
| Öffentlicher Neustart des Repos ohne Historie (Prüfung E) | siehe „Entschiedene Fragen“: Neustart mit `c60f267` („Initial public release of ProjectA“) dort als erledigt geführt; ursprünglich: nach M1; vorher Scan-Bericht, der Nutzer gibt frei (nicht umkehrbar) |
| Vorzeige-README für die Bewerbung | später |
| Prompt-Kompression, MCP-Injektion | wenn ein Worker nachweislich am Kontextlimit scheitert |
| Command Palette, globale FTS-Suche, Fokusmodus | wenn der Nutzer sie im Alltag vermisst |
| Remote-Board, Multi-Prozess-Deskriptor | wenn ein zweiter Rechner dazukommt |
| Ideen-Pipeline, Zeitachse, Vorschlags-Tab | nach M4, mit Kostenschätzung |
| hermes-agent, Multi-Harness | nach M4 (HQ2-06 ist geparkt) |
| Dependabot-Majors (Vite 8 → eslint 10 → TS 7 → React 19 → sqlx 0.9) | einzeln, nach M4 |
| Tauri-Plugins `dialog`, `notification`, `window-state` | wenn ein Paket sie braucht |
| OmniRoute-Cutover in den Produktmodus | erst mit gemessenem Kostensieg |
| Design Studio, Queen/Employee-Neuanlage | nie (gestrichen; der Anlegepfad fällt mit CLEAN-02) |
| W2-02b-Rest „Merge-Ergebnis als Kandidat“ (der Vertrag der vertrauenswürdigen Upstream-Quelle ist ungeklärt; nur lesend geprüft am Kopf d1fce9c, kein Regressionstest ausgeführt) | nach M4 (Nutzer 04.10.: auf später verschoben) |
| Vorschlag: Abschlussvertrag für Headless-Läufe: Gates und Push synchron im Vordergrund; „fertig“ nur mit Gate-Exit, Kandidaten-SHA, `ls-remote` und PR, nicht mit `JOBEXIT0` (echte Abbrüche beobachtet) | nach M4; Vorschlag, keine Freigabe |
| Sicheres Aktionsmuster für Agenten (Anregung aus dem MIT-Projekt browser-use/jev-ultrafast, geprüft 04.10.): Die KI wählt nur aus einer nummerierten Liste erlaubter Aktionen/Ziele, die aus dem beobachteten Zustand erzeugt wird; Modellausgabe wird nie zu Selektoren, Koordinaten, Shell-Befehlen oder ausführbarem Code; jede gewählte Aktion wird vor der Ausführung gegen den aktuellen Zustand geprüft. Kein Code und keine Abhängigkeit übernommen (das Projekt braucht kostenpflichtige API-Schlüssel). Prüfen nach v1.5.0, z. B. für Agentenbefehle oder Freigaben. | nach v1.5.0 |
| Vorschlag: Startcheck-Doku an die Wahrheit anpassen und nur lesend Abhängigkeits-Drift prüfen (nicht optionale installierte Pakete gegen die Kandidaten-Lock); OPS-02 #35 und SETUP-09 #56 bleiben gemergt, dies ist ein begrenzter Folgeschritt | nach M4; Vorschlag, kein Duplikat |
| Vorschlag: PTY-Read/Emit-Diagnose erst nach eingespeistem Beweis; Drain und panikfreie Senke bewahren, den `eprintln`-Rückfall in `logging::log` nicht blind nutzen; Stderr-Verlust im Release ungemessen | nach M4, mit Laufzeitbeleg; ohne Graph-/Windows-Beleg |
| Vorschlag: M4-W2-Merge-Vertrag: frische geschützte Upstream-Bestätigung, gebunden an Kandidat/Lauf/Fence/Scope; lokale Refs und Start-Pin genügen später nicht; Scope-Prüfung Basis → Kandidat auf dem End-Baum nach Merge oder Rebase (Quelle `6fb08b0`, `workers/candidate_scope.rs:56-112`); Continuous nicht aktivieren | nach M4; ohne Graph-/Laufzeit-/Windows-Beleg |
| Plan für v1.6.0 (Pakete, Wellen, Arbeitsweise, Benchmark-Nachweis): [`docs/plan/v1.6.0/plan.md`](plan/v1.6.0/plan.md) | Nutzerentscheidung 06.10.2026: zwei Wochenmessungen und 40 Queue-Läufe bleiben offene Nachbeobachtung nach v1.6.0; Befunde für v1.6.1, kritische früher. Details und unveränderte Originalkriterien in Abschnitt 7a.1; weitere Planfragen und Pakete bleiben in ihrem bisherigen Zustand, nichts davon wird in M1–M4 aufgenommen. Nachtrag 15.10.: v1.6.0 erschienen (09.10.); KI-30-Schluss #874 (42 Läufe ab 09.10.), Wochenmessungen offen (V16-NACHBEOB). |
| Fahrplan v1.6.1 bis v2.0.0 (Pakete, Wellen, Nähte, Nacharbeit je Release): [`docs/plan/roadmap/README.md`](plan/roadmap/README.md) | Ersetzt durch [`plan/v2.0/plan.md`](plan/v2.0/plan.md) (Nutzerentscheid 06.10.: v2.0 als ein Release, keine Zwischenreleases v1.7–v1.9; Kopfzeile von `docs/plan/roadmap/README.md`) und RELEASE-PAUSE (15.10.); Datei historisch, nicht disponieren |
| Werkbank je Projekt (V2-WEG/TRES/CMD/SKL/DB): Dev-Befehle, Datenbanken, Feintuning, Server, Trigger, Automationen, Tresor, Skills-Bibliothek, Bewährte Wege → [`docs/plan/v2.0/werkbank.md`](plan/v2.0/werkbank.md) | Entscheid Nutzer 11.10. E1–E4 (`docs/decisions.md`); Wege-Pilot jetzt ohne App-Code als Thema von DEV-KNOW-01, Tresor vor V2-B6a-2/V2-B19, Rest nach v2.0 hinter Schaltern; nichts davon steht in M1–M4 |
| Paperclip-Kandidaten (COMP-PAPERCLIP-3) → Block direkt darunter | Nutzer 11.10. ~04:30Z: einreihen erlaubt; Richtung, kein neuer Meilenstein; nichts davon steht in M1–M4 oder ändert die v2-Release-Reihenfolge |
| LUMIO: Rückfragen und Freigaben ohne Fensterwechsel (Halle zeigt, wer wartet; Antwortkarte mit Zahlentasten; Windows-Benachrichtigung) → Block LUMIO darunter | nach dem Urteil des Nutzers über die Probe-Halle (DS-H-07); Nutzer 18.10.2026 |
| AGENT-WERKZEUGE: RTK und Repomix messen, eigene Log-Kürzung; Caveman, Headroom-Proxy, OpenCLI, Gitingest, Printing Press abgelehnt → Block AGENT-WERKZEUGE darunter | Messungen nur nach Nutzer-Ja zur Installation; Nutzer 18.10.2026 |

#### LUMIO — Rückfragen und Freigaben ohne Fensterwechsel (Nutzer 18.10.2026)

Quelle: Nutzer im Root-Chat 18.10.2026 ~20:45 MESZ („ja schreibe die Erkenntnisse aus dem video in den plan, ausführlich und für unsere zwecke optimiert“). Root hat das Video im Browser des Nutzers angesehen: TikTok @lumio.mac, ~20 s, Mac-App „Lumio“ (kostenlos, lumiomac.com). Beobachtet, nicht übernommen: kein Code, keine Grafik, keine Texte von Lumio; unsere Kunst bleibt Code nach E-2 (DS-FABRIK-ZIEL).

Was das Video zeigt (beobachtet 18.10.):
- Ein Pixel-Büro mit Agentenfiguren an Schreibtischen; Kopfzeile „Working: 4 · Resting: 3“; ruhende Agenten sitzen in einer Lounge-Ecke.
- Braucht ein Agent eine Antwort, steht seine Figur auf und zeigt eine Sprechblase mit der Frage („SQLite or PostgreSQL?“); die MacBook-Notch leuchtet orange.
- Ein Klick öffnet eine Antwortkarte direkt an der Notch: Anbieter (Claude Code), Agentenname, Aufgabentitel, Kontext 22 %, 27 Aktionen, die Frage, nummerierte Optionen 1–3 mit Kurzbeschreibung plus „4 Other…“, „Number — pick“ (Zahlentaste wählt), ein Countdown, Knöpfe „In chat“ und „Answer“.
- Nach der Antwort setzt sich die Figur wieder an die Arbeit („Got it — he's back to work“).
- Werbeversprechen: Option wählen oder Befehl freigeben, ohne das Fenster zu wechseln; Claude Code und Codex.

Warum es für ProjectA zählt: Der Nutzer betreut viele Agenten gleichzeitig. Heute muss er für jede Rückfrage oder Freigabe das richtige Terminal finden. Die Probe-Halle (DS-H-00 bis DS-H-07) zeigt schon Figuren mit Posen; DS-H-06 hält die Geste für `need` zurück, bis ein beobachtetes Wechselsignal existiert. LUMIO liefert genau den Anwendungsfall dafür: „Wer braucht mich, was fragt er, antworte mit einem Tastendruck.“

Für ProjectA angepasst (Windows, Tauri, „Grün heißt bewiesen“):
- Keine Notch unter Windows. Ersatz: Zähler „Braucht dich: N“ im Kopf der App, ein Infobereich-Symbol mit Zahl und eine Windows-Benachrichtigung mit Knöpfen (Tauri-Plugin `notification`, steht bereits in „Später“). Ein kleines, immer sichtbares Fenster ist nur eine Option. Kein Fokusdiebstahl.
- Ehrlichkeit vor Effekt (AGENTS.md Regel 9): Eine Sprechblase oder Antwortkarte erscheint nur, wenn ein Agent nachweislich wartet (strukturiertes Ereignis des Anbieters oder erkannte Eingabeaufforderung im PTY). Ohne Signal bleibt der Zustand `unknown`; nichts wird erraten.
- Sicheres Aktionsmuster (Zeile oben, 04.10.): Optionen kommen nur aus der strukturierten Frage des Agenten. Die Antwort ist genau der gewählte Optionstext oder Freitext des Nutzers. Modellausgabe wird nie zu einem Befehl, den die App selbst ausführt.
- Freigaben von Befehlen zeigen den Befehl wörtlich und unverkürzt. Zustimmen braucht immer einen ausdrücklichen Klick oder eine Taste, nie eine Vorauswahl. Not-Aus bleibt in jeder Ansicht erreichbar.
- Kein Countdown mit Automatik: Lumio zeigt eine ablaufende Zeit. Wir zeigen nur, seit wann die Frage wartet, und wählen nie selbst eine Antwort.
- Kontextangaben (Anbieter, Modell, Kontext-%, Aktionen) nur, wenn sie beobachtet sind; sonst „unbekannt“.

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| LUMIO-0 | Recherche und Vertrag (Doku): Welche Anbieter liefern heute ein beobachtbares „wartet auf Antwort/Freigabe“-Signal samt Optionen (Claude Code, Codex, Kimi, OpenCode; Hooks, strukturierte Ausgabe, PTY-Muster)? Ergebnis: Ereignistyp `AgentQuestion {agent, frage, optionen[], art: wahl\|freitext\|freigabe, befehl?, seit}`, Quelle je Anbieter, Lücken als `unknown`; `docs/design/hall/QUESTIONS.md` | DS-H-07 (Urteil des Nutzers über die Probe-Halle) | C | Geplant: nicht disponiert (18.10.) |
| LUMIO-1 | Rückfrage in der Halle: Die Figur eines wartenden Agenten zeigt die Pose `need` und eine Sprechblase mit der gekürzten Frage; die volle Frage steht im Inspektor (DS-H-05); nach der Antwort zurück an die Arbeit. Bewegung im Budget von DS-H-06 (höchstens zwölf Figuren, Aus und reduzierte Bewegung statisch) | LUMIO-0, DS-H-06, DS-H-07 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-2 | Antwortkarte: Frage, nummerierte Optionen mit Kurzbeschreibung, „Andere …“ als Freitext; Zahlentasten 1–9 wählen, Enter sendet, Escape schließt, „Im Terminal öffnen“ als Ausweg; voll per Tastatur und Screenreader bedienbar; Texte über `src/i18n/de.ts` | LUMIO-0; Popover DS-X-26 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-3 | Befehlsfreigabe in der Antwortkarte: Befehl wörtlich, Arbeitsordner, Agent; „Erlauben“/„Ablehnen“ nur ausdrücklich, keine Vorauswahl; Weitergabe an den Agenten nur über seinen eigenen Freigabeweg | LUMIO-2 | A (Sicherheit, PTY) | Geplant: nicht disponiert (18.10.) |
| LUMIO-4 | Melden ohne Fensterwechsel unter Windows: Zähler „Braucht dich: N“ im Kopf, Infobereich-Symbol mit Zahl, Windows-Benachrichtigung mit Knopf „Antworten“, der die Antwortkarte öffnet; ein kleines, immer sichtbares Fenster nur nach Nutzerentscheid | LUMIO-2; Tauri-Plugin `notification` (Zeile oben) | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-5 | Zähler in Halle und Kopf: „Arbeiten · Ruhen · Braucht dich · Unbekannt“ aus beobachteten Zuständen, jede Zahl führt zur gefilterten Liste | LUMIO-0, DS-H-05 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-6 | Ruhezone in der Halle: Untätige Agenten sitzen in einer Ruhe-Ecke statt an ihrer Station, damit „arbeitet“ und „ruht“ auf einen Blick verschieden aussehen; neue Kacheln als Code (E-2) | DS-H-07; DS-H-02b | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-7 | Wartezeit statt Countdown: Antwortkarte und Liste zeigen „wartet seit …“ und sortieren danach; keine automatische Antwort, kein stiller Ablauf | LUMIO-2 | B | Geplant: nicht disponiert (18.10.) |

Nicht übernehmen: macOS-Notch, automatische Antwort nach Zeitablauf, vorausgewählte Freigaben, Lumio-Grafik oder -Code, Kontextzahlen ohne Beobachtung.
Erfolgsmaß nach Umsetzung: Zeit von der Frage bis zur Antwort und Zahl der Fensterwechsel je Rückfrage, gemessen an echten Läufen; Ziel ist eine Antwort in unter 10 Sekunden ohne Terminalsuche.
Reihenfolge: erst das Urteil des Nutzers über die Probe-Halle (DS-H-07), dann LUMIO-0, dann LUMIO-1/2/5 parallel, danach 3, 4, 6, 7. Kein Paket startet vor einem Nutzer-Ja zur Probe-Halle.

Nachtrag aus dem zweiten Lumio-Video (Nutzer 18.10.2026 ~20:55 MESZ: „wie vorhin auch dieses Video und übernimm sinnvolles in den plan“; TikTok @lumio.mac, ~38 s, von Root im Browser des Nutzers angesehen):
- Ausgangsproblem im Video: fünf Agenten in fünf Fenstern; einer „denkt noch“, ein anderer wartet seit 23 Minuten auf ein „Ja“ zu `npm install stripe`. Genau dieses Problem hat der Nutzer bei ProjectA: Wartezeit, die niemand sieht.
- Hinweis an der Notch: „Claude Code — Needs permission · Luma 4 · Waiting for "yes": npm install stripe“, also Anbieter, Art (Freigabe oder Frage), Agent und der Befehl in einer Zeile.
- Freigabekarte: Zweck in Worten („Installs dependencies“), darunter der Befehl wörtlich, Knöpfe „Deny“ und „Allow“, Enter bestätigt.
- Laufliste („All 7 chats“): je Agent eine Zeile mit Aufgabe, Agentenname, Anbieter, aktueller Tätigkeit in Worten („Waiting for "yes"“, „Edits OfficeScene.swift“, „Starts a helper · plan 3/5“, „Thinking…“, „Waiting for a task“), Füllstand des Kontexts als Balken (22 %, 34 %, 58 %, 84 % rot, 12 %) und Laufzeit; „Needs you“ als Marke, wartende Läufe oben.
- Eine Tastenkombination (zweimal Command) öffnet das Pixel-Büro als schwebende Übersicht über dem Desktop.

Für ProjectA angepasst: Kontext-Füllstand und Tätigkeit nur, wenn beobachtet (Regel 9); sonst „unbekannt“. Die Kontextwarnung passt zur eigenen Regel „Sitzungen deutlich unter ~150k Tokens, früh übergeben“ (AGENTS.md Regel 4). Die Freigabekarte bietet nur „einmal erlauben“ oder „ablehnen“. Dauerhafte Freigaben („nicht mehr fragen“) erweitern Rechte und bleiben im eigenen Dialog des Anbieters.

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| LUMIO-8 | Laufliste kompakt: eine Zeile je Agent mit Aufgabe, Agent, Anbieter, Tätigkeit in Worten, Kontextbalken, Laufzeit; „Braucht dich“ zuerst, dann nach Wartezeit; Klick öffnet Antwortkarte oder Terminal; dieselben Daten wie Halle und Zähler (eine Quelle) | LUMIO-0, LUMIO-5 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-9 | Kontext-Füllstand je Agent: Balken nur aus beobachteten Zahlen des Anbieters; ab 80 % Warnfarbe plus Text „bald übergeben“, nie nur Farbe; keine automatische Aktion | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-10 | Tätigkeit in Worten: aus beobachteten Werkzeugaufrufen und Ereignissen eine kurze deutsche Zeile („bearbeitet `Datei`“, „wartet auf Freigabe: `Befehl`“, „denkt“, „wartet auf Auftrag“); unbekannt bleibt „unbekannt“; Befehle und Pfade ungekürzt im Tooltip oder Inspektor | LUMIO-0 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-11 | Erinnerung statt Vergessen: wartet eine Freigabe oder Frage länger als eine einstellbare Zeit (Vorschlag 5 min), einmal eine Windows-Benachrichtigung; keine Wiederholungsflut, keine automatische Antwort | LUMIO-4, LUMIO-7 | B | Geplant: nicht disponiert (18.10.) |
| LUMIO-12 | Schnellblick per Tastenkürzel: ein globales Kürzel (Tauri-Plugin `global-shortcut`, Nutzerentscheid über die Taste) zeigt Halle und Laufliste als schwebende Übersicht und schließt mit Escape; kein Fokusdiebstahl ohne Tastendruck | LUMIO-8; Plugin-Installation braucht ein Nutzer-Ja | B | Geplant: nicht disponiert (18.10.) |

Erfolgsmaß ergänzt: längste unbemerkte Wartezeit je Tag (Ziel unter 5 Minuten) und Zahl der Übergaben, die vor dem Kontextlimit statt danach passieren.

#### AGENT-WERKZEUGE — Werkzeuge für weniger Tokens und besseren Kontext (Nutzer 18.10.2026)

Quelle: Nutzer im Root-Chat 18.10.2026 ~21:10 MESZ („prüfe auch das“): TikTok-Bildstrecke @martn.ai „9 GitHub repos for coding agents“, von Root im Browser des Nutzers gelesen. Sterne und Lizenzen stammen von den Bildern (Stand der Aufnahme), nicht live geprüft; vor jeder Nutzung erneut prüfen. Installationen, neue Abhängigkeiten und Änderungen an Agenten-Einstellungen bleiben Nutzerentscheide (AGENTS.md Regel 10).

| Werkzeug (Repo, Lizenz laut Bild) | Was es tut (laut Bild) | Urteil für ProjectA |
|---|---|---|
| Ponytail (DietrichGebert/ponytail, MIT) | Agent prüft vor dem Bauen, ob Code nötig ist; Benchmark laut Repo 54 % weniger Code, 22 % weniger Tokens | Bereits im Einsatz (Claude-Plugin des Nutzers); Update 5.3.2 offen beim Nutzer; nichts Neues |
| Caveman (JuliusBrussee/caveman, Lizenz unklar) | Kürzere Agentenantworten, komprimiert die Eingabe; laut Repo 33,2 % weniger Eingabetokens | Nicht für Root oder Nutzertexte (Berichte, PR-Texte und deutsche Sätze müssen vollständig bleiben). Höchstens beobachten, kein Paket |
| RTK (rtk-ai/rtk, Apache-2.0) | CLI-Proxy, kürzt Ausgaben gängiger Entwicklerbefehle vor dem Agenten (laut Repo bis 90 % weniger Bash-Ausgabe), ein Rust-Binary | Kandidat: unsere Gate-, cargo- und npm-Ausgaben sind groß. Nur mit Messung (AGENT-TOOLS-1); Exit-Codes und erste Fehlzeile dürfen nie verloren gehen (Regel 3/9) |
| Headroom (headroomlabs-ai/headroom, Apache-2.0) | Kompressionsschicht für Logs, Dateien, Werkzeugausgaben, Verlauf; Originale abrufbar; Bibliothek, Proxy, MCP | Nicht als Proxy vor Abo-Anbietern (gleiches Risiko wie beim OmniRoute-Proxy: Kontosperre, Kostenweg unklar). Idee „Original bleibt abrufbar“ übernehmen wir für eigene Log-Kürzung |
| CLI-Anything (HKUDS/CLI-Anything, Apache-2.0) | Erzeugt Kommandozeilen für bestehende Software, damit Agenten sie deterministisch bedienen | Bestätigt unseren Weg: Agenten nutzen `pa` und `pa hq` statt HTML-Scraping (AGENTS.md). Kein Paket |
| OpenCLI (jackwener/OpenCLI, Apache-2.0) | Macht Webseiten zu CLI-Befehlen über die eingeloggte Browsersitzung | Abgelehnt: nutzt fremde eingeloggte Sitzungen, Sicherheitsrisiko |
| Repomix (yamadashy/repomix, MIT) | Packt ein ganzes Repo in eine KI-freundliche Datei; Kompressionsmodus behält die Codestruktur | Kandidat für die kostenlosen Reviewer, die das Repo nicht selbst lesen können (AGENT-TOOLS-2); nur mit Geheimnis-Scan und auf öffentlichem Stand |
| Gitingest (coderamp-labs/gitingest, MIT) | Repo-URL wird zu Prompt-Text | Abgelehnt: doppelt zu Repomix und schickt das Repo an einen fremden Dienst |
| Printing Press Library (mvanhorn/printing-press-library) | Katalog mit 388 fertigen Agenten-CLIs | Abgelehnt: ungeprüfte fremde Binärdateien |

| ID | Ziel | Abhängigkeit | Stufe | Status |
|---|---|---|---|---|
| AGENT-TOOLS-1 | RTK messen (MESSEN, Server, nur Scratch, kein Repo-Eingriff): dieselbe Gate-Lane mit und ohne RTK; Messgrößen: Zeichen der Ausgabe, die der Agent sieht, unveränderter Exit-Code, erste Fehlzeile und `NICHT ABGEDECKT`-Block noch sichtbar, an einem roten und einem grünen Lauf. Danach Nutzerentscheid über die Installation auf dem Server | Nutzer-Ja zur Installation auf dem Server (Server-Änderung außerhalb der Jobqueue) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-2 | Repomix für den kostenlosen Review-Weg prüfen (MESSEN): an zwei bereits gemergten PRs Review mit bisherigem Prompt gegen Prompt plus `repomix --compress`-Auszug der betroffenen Ordner; Messgrößen: belegte Befunde mit `file:line`, Fehlzitate, Prompt-Größe; Geheimnis-Scan auf dem Auszug Pflicht | Nutzer-Ja zur Nutzung (neue Abhängigkeit oder `npx`-Download) | C | Geplant: nicht disponiert (18.10.) |
| AGENT-TOOLS-3 | Eigene Log-Kürzung für Worker-Berichte nach dem Headroom-Prinzip: lange Gate-Ausgaben gekürzt zeigen, Original immer als Datei verlinkt, Exit-Code und erste Fehlzeile immer oben; ohne Proxy, ohne neue Abhängigkeit | AGENT-TOOLS-1 (Ergebnis) | B | Geplant: nicht disponiert (18.10.) |

#### v2 — VERBUND / DevHQ und Denkraum (Beschluss 15.10.2026)

V2-H1..H7 bleiben der DevHQ-Pfad; keine zweite Roadmap. Root nimmt ab, Chief
weist Folgepakete zu; bestehende Design-Owner und gemeinsame Dateien bleiben
seriell. DN-Status ist Planstand, kein Laufzeitbeleg. V-01 zieht DN-09 vor,
V-02 entspricht DN-11a, V-03 DN-15; keine doppelten Aufträge.

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

Nutzer 15.10. ~16:20 MESZ: eine Roadmap mit dem Designsystem, die den Plan
spiegelt (erledigt / jetzt / als Nächstes, Versionen, Pakete und Resttage,
Abhängigkeiten, Blocker, was wann und wo geändert werden muss). ~16:25 MESZ:
die Roadmap wird aus `docs/PLAN.md` erzeugt, und der Plan bleibt bei jeder
Änderung sicher automatisch aktuell und wird geprüft (Inbox: PLAN-AKTUELL).
Keine zweite Roadmap neben dem Plan; der Plan bleibt die einzige Quelle.

| ID | Ziel | Abhängigkeit | Status |
|---|---|---|---|
| PLAN-AUTO-1 | PLAN-Modell + `npm run plan:check` (Befunde: PR ohne Planzeile, Status widerspricht GitHub, unbekannte Abhängigkeit, Job ohne Zeile, Entscheidung ohne Zeile, Plan veraltet) | – | Erledigt: #1564 (merged 2026-10-15T16:44:07Z, `244c4775`); Planzeilen #1570 (merged 2026-10-15T16:07:25Z, `d1def61a`); Nachläufer → PLAN-AUTO-1b |
| PLAN-AUTO-1b | Nachläufer zu PLAN-AUTO-1 und ROADMAP-1a, geteilt in 1b-a (Alias-Auflösung der v2-Abhängigkeiten), 1b-b (bekannte Grenzen aus #1564) und 1b-c (Review-Befunde B1–B4 und C1 aus #1580) | PLAN-AUTO-1, ROADMAP-1a | Erledigt: 1b-a mit #1594 (merged 2026-10-16T00:59:37Z, `e21710de`) und 1b-c mit #1598 (merged 2026-10-16T02:11:54Z, `c8b613ea`); der Rest steht in PLAN-AUTO-1b-b |
| AGENTS-PLAN-REVIEW | Reviews prüfen, ob `docs/PLAN.md` aktuell ist: Paketzeile per `Plan-ID:`, übrige Zeilen, „Für den Nutzer“ und Entscheidungs-Inbox gegen `gh`; Abweichungen vor `review-ok` im selben PR korrigieren | PLAN-AUTO-1 | Erledigt: #1588 (merged 2026-10-15T19:54:21Z, `c7a43fbd`); Stufe C |
| PLAN-AUTO-1b-c | Roadmap-Nachläufer: R1580-B1–B4/C1 und REFS-07 | PLAN-AUTO-1 | Erledigt mit Merge von PR #1598; Alias-Teil #1594 (PLAN-AUTO-1b-a) bleibt separat |
| PLAN-AUTO-1b-b | Bekannte Grenzen aus #1564, vor jeder `--strict`- oder Gate-Nutzung zu beheben (PLAN-GATE wartet darauf) | PLAN-AUTO-1 | Geplant: nicht disponiert (16.10.) |
| PLAN-AUTO-2 | `npm run plan:sync`: widersprüchliche Statuszellen nach bestätigtem Merge abgleichen; Vorschau als Standard, `--write` atomar, alter Text bleibt; Root bringt Änderungen nach einer Merge-Welle über einen Stufe-C-PR auf main | PLAN-AUTO-1 | Erledigt: #1711 (merged 2026-10-20); ursprünglich: In Prüfung: Branch `codex/plan-auto-2`, Stufe B; nach Merge sind Skript, Offline-Regressionstests und Ablauf dokumentiert; kein automatischer Commit oder Push |
| PLAN-AUTO-3 | Status-Abgleich als Skript statt LLM: stündlich, Docs-PR, automatisch eingereiht | PLAN-AUTO-1 | geplant |
| PLAN-NORM-n | Pakettabellen auf feste Spalten (ID, Ziel, Richtung, Version, Abhängigkeit, Status, Owner), je ≤300 Zeilen | PLAN-AUTO-1 | geplant |
| PLAN-CLEAN-1 | Plan bereinigen, Schnitt 1: Status gegen GitHub, „Für den Nutzer“, Entscheidungs-Inbox, fehlende Zeilen und gemergte Arbeit ohne frühere Planzeile; übernimmt die gültigen Inhalte von #1586 und #1587 | PLAN-AUTO-1 | Erledigt: #1591 (merged 2026-10-15T23:52:32Z, `23d0c91e`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-2 | Plan bereinigen, Schnitt 2: v2.0- und v1.6.0-Unterplan und `STAND.md` abgleichen | PLAN-CLEAN-1 | Erledigt: #1592 (merged 2026-10-16T00:04:20Z, `a3b61066`); Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-3 | Plan bereinigen, Schnitt 3: historische Abschnitte von `docs/PLAN.md` kennzeichnen, tote Verweise und Dubletten bereinigen | PLAN-CLEAN-2 | Erledigt: #1596; historische Abschnitte gekennzeichnet, tote Verweise und Dubletten dieses Schnitts bereinigt; Gesamtbereinigung und Root-Abnahme separat |
| PLAN-CLEAN-4 | Plan bereinigen, Schnitt 4: Entscheidungen vom 16.10. buchen, Designziel und neue Paketzeilen eintragen, gemergte PRs ohne Planzeile zuordnen (Sammelzeilen und v2-Zuordnung), Herkunft von COMP, DR2, OPS-* und DS-KONTRAST-FU festhalten | PLAN-CLEAN-3 | Erledigt: #1616 (16.10.) |
| PLAN-GATE | `npm run plan:check` als Pflicht-Gate, damit der Plan nicht mehr veralten kann; vorher Parser-Korrekturen (~~v2-Kurz-IDs wie `MN-A` auflösen~~ erledigt: #1594; Beschreibungstabellen nicht als Dubletten zählen, Zweig-Treffer bei erledigten Zeilen begrenzen); Verdrahtung laut `scripts/ci/lane-plan.sh` bei PLAN-AUTO-2 abgleichen, `scripts/ci/` gehört laut CODEOWNERS dem Nutzer | PLAN-CLEAN-4, PLAN-AUTO-1b-b, PLAN-AUTO-2 | Erledigt: #1625 (merged 2026-10-16); plan check runs as gate `plan-check` (`node scripts/plan-check.mjs --offline`) in lanes precommit, prepush, branchpush, linux, linux_1; `docs/decisions.md` jetzt schwer (`lane-plan.sh`); Nutzer-Ja 16.10. (Root-Chat ~02:22 MESZ), Vorbedingung `plan:check` auf `main` 0 Befunde (Root 16.10.) |
| ROADMAP-0 | Konzept (Root + Rechte Hand) und UX/UI-Entwurf mit dem Designsystem | – | Erledigt: Konzept und UX-/UI-Entwurf am 15.10. angenommen (laut Root, kein PR); Umsetzung in ROADMAP-1a und ROADMAP-1b |
| ROADMAP-1 | Generator: Roadmap-Seite aus PLAN.md, bei jedem Merge neu | PLAN-AUTO-1, ROADMAP-0 | Verschoben nach ROADMAP-1a, ROADMAP-1b und ROADMAP-1c (15.10.): #1580 trägt die Plan-ID ROADMAP-1, liefert aber nur die Datenschicht, keine Seite; der Renderer kam mit #1597 (ROADMAP-1b), Aufrufer und Neuerzeugung bei jedem Merge sind ROADMAP-1c |
| ROADMAP-1a | Erster Generator-Schnitt: Roadmap-Daten aus `docs/PLAN.md` und GitHub ableiten | PLAN-AUTO-1, ROADMAP-0 | Erledigt: #1580 (merged 2026-10-15T18:37:52Z, `c9d4ca35`) |
| ROADMAP-1b | Angenommenen Roadmap-Entwurf in Pakete ≤ 300 Zeilen schneiden und die Seite aus dem Datenvertrag von ROADMAP-1a rendern | ROADMAP-1a, ROADMAP-0 | Erledigt: eigenständiger HTML-Renderer `scripts/lib/roadmap-page.mjs` mit #1597 (merged 2026-10-16T02:19:17Z, `648fba44`); Aufrufer, Neuerzeugung bei jedem Merge, Hosting und Root-Browserabnahme: ROADMAP-1c |
| ROADMAP-1c-1 | Aufrufer: `npm run roadmap:page` schreibt die Roadmap-Seite `.pa/roadmap.html` aus denselben origin/main-Daten wie `roadmap:data`; Root-Browserabnahme | ROADMAP-1b | Erledigt: #1652 (merged 2026-10-16), Branch `claude/roadmap-1c-1` |
| ROADMAP-1c-2 | Neuerzeugung bei jedem Merge, Anzeige im HQ, kein Hosting auf GitHub (Nutzer 18.10.) | ROADMAP-1c-1 | Erledigt: #1659 (merged 2026-10-16), Branch `claude/roadmap-1c-2`; `post-merge` erzeugt `.pa/roadmap.html` auf main neu, `npm run hq:live` zeigt sie unter `/roadmap.html`; Hosting-Entscheid gebucht: ROADMAP-HOST (18.10.) |
| ROADMAP-1d | Roadmap-Seite härten (Review-Nachträge R1659-K1, K2, K4): Änderungszeilen nur mit ISO-Datum, eine Diagnosezeile auf stderr bei unlesbarer Plan-Prüfung, Tests für die Überspringpfade des `post-merge`-Schritts | ROADMAP-1c-2 | Erledigt: #1674 (merged 2026-10-17), Branch `claude/roadmap-1d` (Plan-ID ROADMAP-1d), Stufe B |
| README-ARCH-1 | README-Architekturgrafik präzisieren (Status vs. Freigabe, Startsperre, Sandbox-Grenze, Steuerungsclient) | – | Erledigt: README und Architekturgrafik mit PR #1605 präzisiert (Stufe C; Owner Root) |
| NAME-NUTZER | Persönliche Namensnennung durch neutrale Nutzerformulierung ersetzen | – | Erledigt: #1582 (merged 2026-10-15T18:33:45Z, `0f2cd8de`) |
| KONZEPT-0 | Gliederung für ein neues `docs/KONZEPT.md` (nur lesend): wie ProjectA arbeitet, Regeln, GitHub-Verhalten, Rechte, Ziel, Funktionen, Konfiguration; später von Orchestrator/Wächter aktuell gehalten | – | läuft: nur lesender Gliederungsauftrag, kein PR (laut Root 15.10.); Abnahme Root |
| KONZEPT-n | `docs/KONZEPT.md` nach angenommener Gliederung in Paketen ≤ 300 Zeilen schreiben | KONZEPT-0 | Geplant: erst nach Annahme der Gliederung |

#### Paperclip-Kandidaten (Nutzer 11.10. ~04:30Z: einreihen erlaubt)

Quelle: `pa-orch/wissen/02-recherchen/2026-10-11_comp-paperclip-3-synthese.md`
(Abschnitte „Katalog und Wertung“, „Wellen“, „Nicht übernehmen“). Alle `PC-…`
sind Kandidaten. Wert, Größe (S ≤150, M ≤300 Diffzeilen) und Naht stehen
dort je Zeile. Root prüft jede Einreihung erneut am aktuellen main.

[Abgeschlossene Paperclip-Welle 1](archive/plan-2026-10/context-2026-10-23.md#completed-paperclip-wave-on-11-october); kein erneuter Start aus ihren datierten Jobständen.

**Welle 2: nur Kandidaten.** Reine Kerne dürfen vorbereitet werden. Die
Anschlüsse laufen seriell durch die betroffenen Nähte. SQLite, PTY, Rechte und
Nebenläufigkeit sind Stufe A. Ein Eingriff in eingefrorenen Continuous-Code
braucht vorher Roots Bestätigung des genehmigten v2-/M4-Pakets.

- Abschlussnachweise:
  - PC-TRUST-1: Abnahmekriterium als accepted/missing/rejected/unverifiable klassifizieren.
  - PC-TRUST-2: Done von geprüft/angenommen im gespeicherten Lauf trennen.
  - PC-TRUST-11: Abschlussbelege über Read-only-IPC bereitstellen.
  - PC-TRUST-12: Echte Abschlussbelege in Beweiskette/Chip anzeigen.
- Zustand und Wiederherstellung:
  - PC-ARCH-1: Kleines Zustandsmodell mit Frist, Besitzer und erreichbarem Ausgang.
  - PC-ARCH-2: Echte Queue gegen das Modell prüfen; Gegenbeispiele aufzeichnen.
  - PC-ARCH-3: Schema: eine Wiederherstellungsakte je Quelle/Fingerprint.
  - PC-ARCH-4: Verwaistes Schärfen nach Neustart sicher wieder auffindbar machen.
  - PC-ARCH-12: Wiederherstellungsakte mit geprüften Übergängen bedienen.
- Aufrufschutz, Grenzen, Stopps:
  - PC-BUDGET-2: Schärfen ebenfalls vor bekanntem Limit stoppen.
  - PC-BUDGET-3: Leeres Critic-Ergebnis und Versuch dauerhaft merken.
  - PC-BUDGET-7: Reservierungs-Ledger für gemeinsame Kontingente.
  - PC-BUDGET-8: Ledger für versuchte und quittierte Budget-Stopps.
  - PC-BUDGET-14: Startpfad an Quota-Reservierung anbinden.
  - PC-BUDGET-15: Offene Stoppzustellung wiederaufnehmen und quittieren.
  - PC-BUDGET-16: Fehler-Fingerprint und Versuchszähler dauerhaft anbinden.

**Welle 3: offene Entscheidungen.** Sie gehen erst an den Nutzer, wenn sie reif
sind. Die Prioritätstabelle nimmt keine davon vorweg.

- Soll das Critic-Signaltor tatsächlich sperren? Erst messen, ohne Sperrwirkung (PC-BUDGET-4).
- Welche Warnschwellen bekommen die Kontingent-Meter (PC-BUDGET-12)?
- Detailblatt oder nichtmodaler Inspector? Empfehlung: zuerst das vorhandene zugängliche Sheet.
- Onboarding: Empfehlung ist eine modellfreie Beispielkarte vor einem bewusst gestarteten Probeauftrag.
- Unklare Queue-Aufträge: Empfehlung ist sichtbares Parken statt Autostart mit ungeprüftem Rohtext.
- Mobile Nutzung, Marketing, Import und weitere Plattformen.
- Echte Verbrauchsmessungen.

**Nicht übernehmen** (Langfassung in der Quelle):

- CEO-/Manager-Agenten, die ungefragt Unteragenten oder neue Produktziele erzeugen.
- Modellbehauptung, Prosa, Exit 0 oder teilgrüne Zeilen gelten nicht als Abschlussbeweis.
- Keine Zeitgeber, die ohne vorhandene Arbeit Modelle wecken. Keine unbegrenzten Retries.
- Unbekannter Verbrauch gilt nie als 0. Ein beobachtetes Modell wird nie aus der Konfiguration abgeleitet.
- Keine Freigaben ohne geprüften Umfang und keine stille Rechteerweiterung. Agentengenerierte Skills wirken erst nach Freigabe.
- Firmen-, HR-, Gantt- oder Plugin-Welten nicht als Navigation kopieren. Keine zweiten Scheduler, Datenbanken oder Dienste nur zur Nachahmung.

### Architektur-Pakete aus dem Architektur-Rat (03.10.2026, historisch)

Die folgenden Pakete sind neue Ideen und bleiben nach AGENTS.md unter „Später“.
ARCH-11 ist die Ausnahme: Es ist ein angenommener M3-Kandidat (Nutzer 04.10., F6
und Zeile in der M3-Tabelle), ohne die M3-Abnahme-Tabelle zu ändern.

| ID | Ziel | Dateien | Lane | Naht | Tier | Test-Trailer | Stand / Reihenfolge |
|---|---|---|---|---|---|---|---|---|
| ARCH-01 | [Archiv: Historie][historie] | siehe Archiv | fe + hqL | nein | B | siehe Archiv | Erledigt #166/#167; Reihenfolge: jetzt; Löschung mit Nutzer-Ja (F5) |
| ARCH-02 | [Archiv: Historie][historie] | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #191; Reihenfolge: nach Merge von PR #130 |
| ARCH-03 | [Archiv: Historie][historie]; `db_restore.rs:137` bleibt Folgepaket der pa-Lane. | siehe Archiv | fR | nein | A (Vault) | siehe Archiv | Erledigt #214/#217/#256; Reihenfolge: jetzt |
| ARCH-04 | [Archiv: Historie][historie] | siehe Archiv | fR | nein | B | siehe Archiv | Erledigt #169; Reihenfolge: nach Inbox-Antwort F2 |
| ARCH-05 | [Archiv: Historie][historie] | siehe Archiv | mn | ja | A (Naht) | siehe Archiv | Erledigt #182; Reihenfolge: jetzt |
| ARCH-06 | [Archiv: Historie][historie] | siehe Archiv | mn | ja | A | siehe Archiv | Erledigt #219; Reihenfolge: nach ARCH-05, vor W5-04b |
| ARCH-07 | [Archiv: Historie][historie] | siehe Archiv | st | ja | A | siehe Archiv | Erledigt #202; Reihenfolge: nach #147/#44, gemäß st-Reihenfolge |
| ARCH-08 | [Archiv: Historie][historie] | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #181/#221/#229/#244/#247/#252; Reihenfolge: nach PR #154 |
| ARCH-09 | [Archiv: Historie][historie] | siehe Archiv | fe | nein | B | siehe Archiv | Erledigt #260/#264/#269; Reihenfolge: nach ARCH-08, niedrige Priorität |
| ARCH-10 | [Archiv: Historie][historie] | siehe Archiv | api | ja | A | siehe Archiv | Erledigt #220/#236/#246/#250; Reihenfolge: vor W5-02b3 (api) |
| ARCH-11 | **M3-Kandidat:** KI-24b auf Windows reproduzieren und den Test-DB-Wiederöffnungs-Wettlauf durch bewiesenes Pool-Schließen oder gezieltes Warten absichern. | `testutil.rs` + betroffene Tests | fR + N | nein | A (DB) | Regression-For: KI-24-Läufe 36165944208/36215024767; 20× close→reopen auf Windows | Verschoben nach Z4-ARCH-11; Reihenfolge: M3-Kandidat angenommen (Nutzer 04.10.); Windows-Lauf nötig, der PC des Nutzers darf dafür genutzt werden |
| ARCH-12 | `impl ControlBackend for ApiBackend` aus `main.rs` auslagern. Das Paket bleibt gesperrt, weil der Trait-Block als reine Verschiebung mehr als 300 Diffzeilen erzeugt. | `main.rs`, `api/backend.rs`, ~715 Z. | mn + api | ja | A | No-Test: mechanische Verschiebung erst nach ADR A1 | nach ADR A1; gesperrt |

### Synthese der Bestandsaufnahmen INV-01..08 und des Architektur-Rats (03.10.2026)

Quelle der Bestandsaufnahmen sind die PR-Texte (Abschnitt „Bestandsaufnahme“);
sie liegen nicht als Dateien im Repo. Der Architektur-Rat ist die Tabelle oben.
Alles hier ist **Quellenbefund oder Hypothese, kein reproduzierter Fehler**: ein
Bugpaket braucht zuerst einen kompilierenden roten Test, eine Laufzeit- oder
Performanceaussage eine Messung. Nichts davon ist in M1–M4 aufgenommen. Die
Nummern unten sind heutige PR-Nummern, beobachtet am 03.10.2026 mit
`gh pr view` auf `origin/main` 1b38596; der Paketstand darunter ist am 04.10.2026 nachgeführt.

[Historischer Paketstand und Reihenfolgen](archive/plan-2026-10/history.md#synthese-der-bestandsaufnahmen-inv-0108-und-des-architektur-rats-03102026).

ARCH-11/KI-24b ist der laut Architektur-Rat nützlichste weitere Schutz (ein
roter Test-DB-Wettlauf auf Windows hält die Queue an). Er ist **priorisierter
Kandidat** und mit F6 am 04.10. in M3 aufgenommen. ARCH-12 bleibt
gesperrt (> 300 Diffzeilen, F1). Abgelehnt bleibt: Rust↔TS-Codegen ohne
belegten Vertragsbruch, ein neuer lib/store/`CoreError`-Split, der Review-Lock
bleibt in-process, `delivery_recovery.rs` wird nicht gelöscht (W3-02).

**Korrektur:** Die Behauptung „Vault- und CSP-Vorschläge durch #138 erledigt“ ist
falsch. #138 hat nur `oneshot.rs` geändert (Unix-Verzeichnisprüfung).

#### Später: getrennte Security-Kandidaten (neu zu prüfen, kein M4-Code)

Je Kandidat zuerst Quelle neu bestätigen, dann ein roter Test, dann ein kleines
Tier-A-Paket. Beobachtet am Kopf 90676c5 und am aktuellen Stand erneut gelesen
(`providers.rs:867/728`, `tauri.conf.json:28`).

| Kandidat | Quellenbefund | Voraussetzung |
|---|---|---|
| INV-SEC-VAULT-TEMP | [Archiv: Historie][historie] | ✓ #200 gemergt (03.10.); vorher roter Symlink-Test |
| INV-SEC-VAULT-ARCHIVE | [Archiv: Historie][historie] | ✓ #225 gemergt (03.10.); vorher roter Zwei-Reparaturen-Test |
| INV-SEC-CSP-SPLIT | [Archiv: Historie][historie] | ✓ #288 gemergt (04.10.): `devCsp` getrennt, Release-CSP ohne `ws://localhost` |
| INV-SEC-CREDENTIAL-EXPIRY / -CLEANUP | `api/agent_access.rs:312/361`: abgelaufene Grants bleiben als Datei liegen, Löschfehler werden verschluckt (niedrig). | nach #158 (gelandet) neu lesen |
| API-Descriptor | Private Erstellung/Ersetzung der Descriptor-Datei unter Unix prüfen. | nach #158 prüfen |
| INV-SEC-PRIVATE-PATHS | Einheitliche no-follow-Erstellung privater Dateien (Idee). | nach M4 |

**M4-B, Fortschreibung 23.10.:** Der frühere Projektrahmen-/TOCTOU-Befund ist durch AUTH/PLUMB/GOAL/TASK/ASSIGN und IMPORT/#1855 geschlossen (Root; Source-Lade-/Autorisierungsbefund). Tests c91a08d0, GOAL-/M4B-Reste 2dbc396c, separate Audit-Transaktion und Windows-Nachweis bleiben offen; siehe aktive GOAL-/IMPORT-Zeilen und Inbox. Continuous bleibt deaktiviert und eingefroren; keine Gesamtfreigabe.

#### Später: weitere Quellenbefunde nach Bereich

- **Frontend (stale Antworten):** `AttentionInbox.tsx:63`, `ActivityView.tsx:48`
  (Digest), `HistoryView.tsx:36` (Worker-Wechsel), `HistoryView.tsx:25`
  (verschluckter IPC-Fehler), `SessionRestorePanel.tsx:67` (Sprachmix),
  überlappende Poll-Antworten. Zuerst gegen schon gelandete ähnliche Fixes
  ausschließen: #133 (Empfehlungen), #134/#135 (Projektwechsel), #149
  (History-Polling serialisiert). Dann ein roter Wechseltest je Fund; kein
  allgemeiner Event-/Polling-Neubau.
  **Stand 05.10. (V16-02):** ✓ gemergt: Inbox und History bei Projekt-/Worker-
  Wechsel #194, Inbox und Digest #312, übrige Guards #345 und gemeinsamer
  Poll-Guard #324, Sprachmix #199. Offen bleibt `HistoryView.tsx:47` (der
  `catch` verschluckt den IPC-Fehler weiter).
- **Queue (`queue.rs`):** unbegrenzt blockierter Eintrag ohne Zeit
  (`status.rs:1474`), Dispatcher-Panik beendet den Thread, `launch` ohne
  Zeitlimit, ungültige/negative Worker-Limits (`set_project_max_workers`),
  30-s-Sweep. **Stand 05.10. (V16-02):** ✓ Dispatcher-Panik
  (FJ-2, #319), ✓ `launch` ohne Zeitlimit (FJ-3, #450); die übrigen drei Punkte
  sind ohne PR-Beleg offen. Änderungen am eingefrorenen Runtime nur in bestehenden M4-Paketen.
- **HQ:** die Restzeitschätzung in `hq-live.mjs` (4 h je Spec) ist unbelegt;
  fehlender `blocked`-Zustand (`hq-parse.mjs:240`); veraltete Abhängigkeitskanten
  (`PACKAGE_EDGES`); Tages-/UTC-Grenzen (`hq-stats.mjs:6-22`); keine
  Request-Body-Grenze. Konfiguration ist kein Beleg tatsächlicher Fähigkeiten.
- **Tests/Plattform:** feste 4096-Byte-Seite (`resources.rs:128`), unlesbare
  Unterordner zählen 0 (`resources.rs:38-56`), Linux-`None` bei Platte/CPU,
  fehlende Gegenfälle in `native_launch`/`native_supervisor`/`native_runner`.
  Timing-Flakes sind Hypothesen bis zur Messung.
- **Performance (erst messen, dann ändern):** `useQuestions` ohne SQL-Limit,
  Digest lädt alle Nachrichten, überlappende Attention-Batches.
- **Ops-Prozess:** Mutex-/Budget-Recovery wird als Tier B statt A eingestuft;
  eine Überschrift „Review disposition“ gilt schon als Reviewabschluss; ein
  stiller Worker-/Watchdog-Neustart belegt nicht, dass der alte Prozess
  gestoppt ist. Eine Pipeline-Änderung wäre ein eigenes, red-first getestetes
  Ops-Paket, nicht Teil dieser Synthese.
- **Wartezeit:** CI-06 (#170) prüft lokal nur `--plan` (Form und Referenzen),
  **nicht** semantisch einen roten Test auf der Merge-Base. Folgeideen: engere
  `pfad::testname`-Form, echte parallele unabhängige Reviews, Konfliktvorhersage.
  Flake-Auswertung nur aus vorhandenen Logs; zusätzliche Actions-Läufe sind E11.
- **Doku:** Link-Prüfer, README/KNOWN_ISSUES-Linkcheck, W2-02b-Teil „Merge-Ergebnis
  als Kandidat“ nachweisen oder als eigenes Paket abtrennen.

Nicht erfasst: Die Bestandsaufnahme in #132 (CI) enthält nur den dort behobenen
SIGPIPE-Fund. Die Zuordnung INV-nn → PR steht nicht in den Texten; es wurden
#129–#133, #138, #142 und #149 gelesen.

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
