# M4-Abnahmematrix: Continuous Mode

Diese Matrix ist der Abnahmevertrag für M4 und W4-02. Continuous Mode darf erst
nach W4-03 und einer ausdrücklichen Entscheidung des Nutzers aktiviert werden.
Eine Konfiguration, ein Plan, ein Modellname oder ein gespeicherter Datensatz
gilt allein nicht als Laufzeitbeleg. Jede Zeile braucht den genannten Beleg
oder das ausdrücklich benannte Nutzer-/PC-Gate.

| Nr. | Abnahmepunkt | Erforderlicher Nachweis | Belegtyp | Status |
|---:|---|---|:---:|:---:|
| 1 | Continuous Mode bleibt ohne Freigabe fail-closed deaktiviert. | Laufzeit-Audit mit `continuousEligible: false` bei fehlender Abnahme; Aktivierung über Konfiguration wird abgewiesen. | Laufzeit | offen |
| 2 | Die Aktivierung ist an eine einzelne, explizite Nutzerentscheidung gebunden. | Nutzer schaltet den Modus in der installierten App ein; die Entscheidung und die Policy-Revision sind dauerhaft protokolliert. | Nutzer-Gate | offen |
| 3 | Riskante Übergänge verlangen ein gültiges menschliches Urteil. | Laufzeitbeleg, dass `resume` ohne gültiges, frisches Human-Verdict abgewiesen wird und das Urteil an Projekt, Run und Policy gebunden ist. | Laufzeit | offen |
| 4 | Goals, Tasks und Runs bleiben auf das freigegebene Projekt begrenzt. | Positiver Zugriff im eigenen Projekt und negativer Cross-Project-Test mit 403/404 ohne Datenleck. | Laufzeit | offen |
| 5 | Claims und Fences verhindern Doppelbearbeitung und stale writes. | Zwei konkurrierende Claims sowie ein veralteter Fence werden reproduzierbar getestet; höchstens einer schreibt erfolgreich. | Laufzeit | offen |
| 6 | Pause, Drain und Cancel stoppen neue Continuous-Arbeit und umgehen nicht die Legacy-Queue. | Laufzeitbeleg für jeden Kontrollzustand einschließlich Neustart; keine interaktive Sitzung wird fälschlich als beendet behauptet. | Laufzeit | offen |
| 7 | Der Scheduler dispatcht nur zugelassene, fällige Arbeit und startet keinen unautorisierten Worker. | End-to-end-Lauf mit Admission, Dependency- und Attempt-Prüfung; Start bleibt ohne akzeptierte Provider-/Scheduler-Gates aus. | Laufzeit | offen |
| 8 | Team, Rolle und Assignee werden vor Claim und Launch geprüft. | Zugewiesene und unzulässige Rollen werden mit stabilen Zuständen und ohne Bypass beobachtet. | Laufzeit | offen |
| 9 | Abhängigkeiten werden konsistent und fail-closed ausgewertet. | Lauf mit erfüllten, offenen, fehlenden, fremden und gekürzten Abhängigkeiten; nur vollständig erfüllte Abhängigkeiten ergeben `satisfied: true`. | Laufzeit | offen |
| 10 | Globale und projektbezogene Kapazitäts- und RAM-Grenzen werden eingehalten. | Ressourcendruck-Test zeigt die begrenzte Claim-Anzahl, die Speicheranpassung und eine unveränderte Sperre bei unbekannter Messung. | Laufzeit | offen |
| 11 | Provider, Modell, Transport und beobachtete Ausführungsidentität stimmen mit der Route überein. | Je freigegebenem Adapter ein echter PC-Lauf mit beobachteter Identität; unbekannte oder stale Zustände blockieren. | Nutzer-Gate | offen |
| 12 | Billing- und Usage-Angaben sind getrennt, quellengebunden und nicht erfunden. | Providerbeleg mit Quelle und Beobachtungszeit; fehlende Collector liefern `not_reported` statt geschätzter Tokens oder Guthaben. | Nutzer-Gate | offen |
| 13 | Launch, Prozessidentität und Exit werden reconciled. | Crash-, normaler Exit- und verlorene-Response-Lauf; unbekannte Prozesse führen zu `reconciling` und sperren Neudispatch. | Laufzeit | offen |
| 14 | Checkpoints und Fortschritt sind strukturiert, idempotent und an den Run gebunden. | Wiederholung, stale revision und fehlende Evidence werden mit stabiler Ablehnung bzw. unveränderter Wiederholung beobachtet. | Laufzeit | offen |
| 15 | Candidate und Evidence sind unveränderlich an Commit und Run gebunden; die Policy ist je Root einmalig eingefroren und je Run kopiert (`policy_json`); eine Policy-Revision je Candidate/Evidence (HumanPolicySnapshot, DF-13) folgt in M5. | Laufzeitbeleg über HTTP: Bindung und Idempotenz von Candidate/Evidence, Leseberechtigung nur im eigenen Run, Ablehnung fremder und stale Evidence; eine nachträglich veränderte Root-Policy ändert `policy_json` des Runs nicht und wird im Briefing als `dispatch.unresolved` ("frozen root policy") fail-closed gemeldet. | Laufzeit | offen |
| 16 | Reviews sind unabhängig vom Implementierer und an denselben Candidate gebunden. | Review-Lauf mit anderer Modellfamilie; Self-review und unverified Providervergleich bleiben nicht abnahmefähig. | Nutzer-Gate | offen |
| 17 | Jede akzeptierte Candidate-Änderung invalidiert Evidence und Reviews des vorherigen Candidates; in v1.5.0 kann keine Review eine Freigabe tragen (Schema-Sperre `approval_eligible = 0`, W5-02d nach M4). | Laufzeitbeleg über HTTP gegen den echten Store: Review auf Candidate A ist `valid`; nach Binden von B sind A-Evidence und A-Review `invalidated` mit `invalidatedAt` und `invalidatedByCommit = B`, auch nach Wiederöffnen des Stores; Replay desselben Commits invalidiert nichts; stale A-Einreichungen stellen keine Gültigkeit her; neue B-Einträge erwecken A nicht; `approvalEligible` bleibt durchgehend false. Belegt die Ungültigkeit der aktuellen Kette, nicht die Widerrufung einer echten Freigabe (M5). Zeile 17 erfüllt nicht die Zeilen 18 oder 27. | Laufzeit | offen |
| 18 | Delivery ist gestuft und darf nur nach gültiger Review-/Testkette integrieren; für v1.5.0 ist die integrierende Stufe der menschlich kontrollierte GitHub-Pfad (PR -> Gates -> Mergify-Queue), die Continuous-Integrationsstufe bleibt verweigert (Nutzer 04.10., E20). | Laufzeitbeleg: Delivery-Dry-run plant die Stufen und schreibt den Audit-Envelope (M4-R19-05); die Continuous-Integrationsstufe wird ohne Freigabe-Autorität abgewiesen (Negativtest, approval_eligible = 0, M4-R27-04); freigegebene Stufe = ein über die Queue gemergter PR mit Review-Disposition und Run-ID im PR-Text; Branch-Protection verhindert den direkten Merge. | Laufzeit + Nutzer-Gate | offen |
| 19 | Fachliche Übergänge und Fehler sind append-only nachvollziehbar; für v1.5.0 auf die sicherheitskritischen Pfade verengt (Nutzer 04.10.). | Typisierter Audit-Envelope weist Einträge ohne project/run/result/sourceRef ab (M4-R19-01); vollständige Envelopes für Not-Aus an/aus und Barrier-/Store-Fehler (M4-R19-06), für Delivery-Start/-Enqueue und W1-03f done/blocked mit Erfolg und Ablehnung (M4-R19-05) und für Planungs-Autorisierungsablehnungen und Planungs-Schreibvorgänge (M4-R19-08); je Eintrag Event-ID, Projekt, Akteur, Run, Ergebnis und Quellenreferenz; UPDATE/DELETE-Bypass wird abgewiesen. | Laufzeit | offen |
| 20 | Der globale Not-Aus stoppt die gesamte Ausführung innerhalb von 10 Sekunden. | PC-Drill misst den Zeitraum vom Auslösen bis zum bestätigten Stillstand aller betroffenen Worker und dokumentiert Restprozesse. | Nutzer-Gate | offen |
| 21 | Crash und Power-Loss lassen keine unklaren Claims oder stillen Zustandswechsel zurück. | Wiederanlauf-Drill an jeder kritischen Transition; Recovery bleibt blockiert, bis Prozess- und DB-Zustand reconciled sind. | Nutzer-Gate | offen |
| 22 | Backup und Wartung bilden einen kohärenten, wiederherstellbaren SQLite-Zustand. | Backup-Drill einschließlich WAL, Restore und Integritätsprüfung vor Wartung; Snapshot und Ergebnis sind referenziert. | Nutzer-Gate | offen |
| 23 | Updater und Recovery behandeln aktive Sitzungen, Fehler und Rollback sichtbar. | Installierter Update-Drill mit erfolgreichem, abgebrochenem und fehlgeschlagenem Übergang; kein unbefristetes stilles Warten. | Nutzer-Gate | offen |
| 24 | Der Benchmark misst Qualität vor Optimierung und bindet jeden Fall an Run und Evidence. | Fünf freigegebene Aufgaben aus W4-01 (oder der vom Nutzer bestätigte Umfang) mit Tokens, Zeit, Rejection, Rework und Regression; Zielwerte gelten erst nach Qualitätsgate. | Nutzer-Gate | offen |
| 25 | Singleton, Mehrfachstart und Recovery sind als installierte PC-Drills bestanden. | Nutzer führt die drei Drills aus; alte Instanz scheitert kontrolliert, Nutzersitzungen bleiben erhalten, Ergebnis wird abgelegt. | Nutzer-Gate | offen |
| 26 | Die vollständige Abnahme ist auf den vorgesehenen Plattformen und Gates reproduziert. | `prepush`, Linux-/Windows-Lane sowie dokumentierte Windows-/Linux-Einschränkungen sind mit Commit und Exit-Code festgehalten. | Nutzer-Gate | offen |
| 27 | Der Nutzer nimmt M4 ab und autorisiert erst danach Release v1.5.0; der Dauerbetrieb bleibt dabei aus und ist nicht releasefähig (Nutzer 04.10., E20). | Der Nutzer bestätigt Zeilen 1–26, Not-Aus, PC-Drills und die Releaseentscheidung selbst in `.pa/release_attestation_v1.5.0.json` (`release`, `commit`, `rows 1–26`, `decidedAt`, `decidedBy`, `continuousEnabled: false`) und committet sie selbst; `npm run dev:continuous-audit -- --attestation <Datei>` zeigt `appReleaseEligible: true` bei `continuousReleaseEligible: false`. | Nutzer-Gate | offen |

Weitere Pfade (Ziel/Task/Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review, Wartung) folgen in M5 (Nutzerentscheidung 04.10.).

## Entscheidungsregel

W4-02 ist vollständig, wenn jede Zeile genau einen dauerhaft auffindbaren
Laufzeitbeleg oder einen dokumentierten Nutzer-/PC-Beleg referenziert. `blocked`,
`unavailable`, `not_reported`, `unverified` und fehlende Belege zählen nicht als
Bestanden. W4-03 darf die Aktivierung erst nach dieser Prüfung und der
Entscheidung aus Zeile 27 umsetzen.
