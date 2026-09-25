# Dev-HQ 2 / ProjectA: gemeinsamer Vertrag v1

Stand 23.09.2026, Basis `v1.4.1` (`3bcaed3`). **Vorgeschlagener Vertrag**
für die HQ2-Pakete; kein Beleg für bereits ausgelieferte Endpunkte. Änderungen
werden in `docs/PLAN.md` als Pakete geführt. Die bestehende Control API wird
erweitert, nicht still umgedeutet.

## Autorität und bestehende Anker

- Rust/SQLite besitzt Projekte, Worktrees, PTYs, Claims, Laufzustand,
  Budgets, Verdicts und Recovery. App und Dev-HQ sind Clients desselben
  versionierten Vertrags. Der installierbare HQ-Host dient statische Assets
  und proxyt die Loopback-API; er plant und startet keine Worker selbst.
- Bereits vorhanden sind u. a. `GET/POST /api/projects`,
  `POST /api/projects/<id>/orchestrator/send`, `GET /api/quota`,
  `GET /api/usage`, `GET /api/providers`, `GET /api/budgets` sowie
  `/api/hq/v1/runtime`, `/context`, `/changes` und `/runs`. Der Browser
  liest Briefings über `/api/hq/v1/context`; `/api/hq/v1/agent/context`
  verlangt einen run-gebundenen Agenten-Credential und ist über den
  gewöhnlichen HQ-Proxy nicht zugänglich. Projektanlage und menschliche
  Verdict-Aktionen benutzen den bestehenden Kern samt separatem
  Verdict-Token. Die App besitzt bereits
  einen projektbezogenen Orchestrator-Chat; HQ2 ersetzt dessen Eigentümer
  nicht durch Browser-Zustand.
- Der lokale Host hält nur seine eigene Control-API-Authentifizierung; er
  fügt niemals automatisch menschliche Verdict-Befugnis hinzu. Für
  Projektanlage oder Verdict sendet der Browser das vom Nutzer ausdrücklich
  eingefügte separate Verdict-Token als `x-hq-verdict-token` für genau diese
  Aktion durch den Host an den Kern. Das Token wird weder im Browser noch im
  Host gespeichert oder in einer URL transportiert. Anzeigen, Statusabfragen
  und Entwürfe verlangen es nicht.
  Secrets, OAuth-Token und vollständige Rohtranskripte gehören nicht in
  Ereignis- oder Briefing-Datensätze.

## Datenvertrag und Verhalten

Alle **neuen** Antworten tragen eine Vertragsversion und stabile IDs.
Zeitangaben sind UTC, Quellenverweise bleiben auflösbar. Optionale Messwerte
sind `null` mit einem erklärten Verfügbarkeitsstatus statt `0`. Diese
logischen Objekte legen die Bedeutung fest; Route, Speicherlayout und
Serialisierung werden erst im jeweiligen Implementierungspaket fixiert.

| Objekt | Pflichtinhalt | Semantik |
|---|---|---|
| Projekt | ID, Name, Repo-Standort, Lebenszustand | Bestehendes Projekt öffnen oder neues Projekt über denselben Kernpfad anlegen. GitHub und Linear sind getrennte optionale Verknüpfungen mit eigener Sync-Quelle und letztem Sync-Zeitpunkt. Externe Syncs erzeugen keine Worker-Claims. |
| Code-Sitzung | ID, Projekt-ID, Harness-Profil-ID, Modus, Zustand, Worktree-/Worker-Referenz soweit vorhanden | `advisory` ist Gespräch ohne Arbeitsauftrag und ohne implizite Schreibbefugnis. `active` arbeitet nur nach expliziter Aufnahme über die vorhandene Admission, Worktree- und Budgetlogik. Ein Moduswechsel erzeugt einen nachvollziehbaren Übergang; er erweitert keine Freigaben. |
| Handoff | Quell- und Ziel-Sitzung, Anlass, kompakter Kontext mit Quellen, angefordert/angenommen/fehlgeschlagen | Beim Wechsel zwischen Claude, Codex oder anderem Harness bleiben Sitzungen getrennt. Nur ein ausdrücklich bestätigter Übergabevorgang trägt Kontext und offene Arbeit hinüber; kein unsichtbares Umschalten einer laufenden PTY. Fehlgeschlagene Übergaben lassen die Quellsitzung unverändert sichtbar. |
| Harness-Profil | ID, Anzeigename, ausführbares Kommando/Argumente, Fähigkeiten, Quelle, Prüfstatus | Geführte Presets und Expertenansicht bearbeiten dieselbe Profildefinition. Konfiguration ist keine Capability-Evidenz. `proven` stammt nur aus dem in `.pa/task_multi_harness.md` beschriebenen Attestat und darf nicht als Nutzereingabe gespeichert werden. Ungeprüfte Profile bleiben eingeschränkt. |
| Anbieter-Kapazität | Anbieter/Abo, Profilbindung, getrennte Quota-/Usage-/Budgetwerte, Quelle, Beobachtungszeit, Status | Eine Routing- und Übersichtsfläche für Claude Max, Codex Max, Kimi Max, OpenCode Go und Ollama Pro. Jeder Anbieter behält seine eigenen Grenzen. `unknown`, `stale`, `blocked` und `available` sind unterscheidbar; eine CLI-Anmeldung oder ein Tarifname belegt weder Billing-Quelle noch verfügbare Tokens. Kein zusätzlicher bezahlter API-Verbrauch. |
| Ereignis/Beleg | Event-ID, Projekt, Zeitpunkt, Akteur, Aktion, Kandidat/Run, Ergebnis, Quellenreferenz | Append-only fachliche Änderungen und Fehler. Ein Beleg ist an Kandidat, Policy und Run gebunden; nach relevanter Änderung ist die frühere Review-Aussage ungültig. Rohlogs bleiben an ihrer Quelle und werden nur gezielt aufgerufen. |
| Agenten-Briefing | Projekt, Ziel, aktuelle Blocker, jüngste Deltas, Evidenzlinks, Cursor, Erstellzeit | Klein und quellgebunden; aus autoritativen Zuständen abgeleitet. Kein periodisches Kopieren des ganzen Repos oder aller Chats. Ein veralteter Cursor führt zu einer erneuten Kernabfrage, nicht zu stiller Vollständigkeitsbehauptung. |

Routing berücksichtigt Eignung, beobachtete Kapazität, Budget, Profilattestat
und Nutzervorgabe. Manuelle Wahl bleibt möglich. Fehlt eine notwendige
Beobachtung, zeigt HQ2 den Grund und bietet einen belegten alternativen Weg
oder stoppt; es schätzt keine gemeinsame Restquote. Ein `active`-Start ist
eine Kerntransaktion und muss dieselben Claims und Fencing-Regeln wie andere
ProjectA-Arbeit benutzen. Abgelaufene Leases beweisen kein Prozessende.

## Oberfläche und Parität

Die gemeinsame Designsprache umfasst Typografie, Farbe, Abstand, Fokus,
Zustandsformen und Bewegungsregeln; App und HQ behalten passende eigene
Layouts. Der neue Arbeitsbereich stellt aktive Arbeit und Blocker ins
Zentrum, ein Agenten-Hilfebereich bleibt verfügbar und lässt sich mit dem
Quellenbereich austauschen. Hilfe erscheint kontextbezogen; die Anleitung
unten lässt sich schließen, und diese Wahl bleibt beim nächsten Öffnen
erhalten. Die App öffnet den lokal gebundenen HQ-Host mit einem Klick; die
installierte Fassung funktioniert ohne Node oder Repository am Zielort und
gibt die Oberfläche nicht ins LAN frei. Animation erklärt Übergänge,
respektiert reduzierte Bewegung und
verändert keine Zahlen nur zum Effekt.

Der Build bündelt die gebauten HQ-Assets als Tauri-Ressourcen. Ein von Rust
verwalteter Listener bindet ausschließlich `127.0.0.1`, startet auf Anforderung
der App und endet mit ihr; er serviert die Assets und proxyt die versionierte
Control API. Er prüft Host und Origin gegen die eigene Loopback-Adresse und
verlangt ein kurzlebiges Session-Credential für schreibende Browseraufrufe.
Der installierte Paket-Smoke öffnet HQ aus einem Verzeichnis ohne Node und
ohne Repository, prüft alle sieben bisherigen Seiten sowie Start/Stop und
weist nach, dass keine LAN-Adresse gebunden wird.

| Heutiger HQ-Bereich | HQ2-Ort und Paritätskriterium |
|---|---|
| Übersicht | Arbeitsjournal: aktuelle Projekte, Arbeit, Blocker, nächste Entscheidungen und Verbindungslage erreichbar. |
| Agenten-Teams | Agenten/Harnesses: bestehende Team-Metadaten, Profile, Status und Queue-Aktionen auffindbar; Prüfstatus getrennt von Beschreibung. |
| Statistiken | Analyse: vorhandene 7/14/30-Tage-Gitwerte, Usage, Quellen und Zeiträume erhalten; unbekannte Messungen sichtbar. |
| Belege | Quellenbereich: Belege pro Eintrag aufrufbar, Kandidat- und Run-Bezug sichtbar. |
| System | Einstellungen: Setup, Verbindungen, Anbieter, Routing, Budget und Harness-Konfiguration erreichbar. |

Zusätzlich erhält **Code** einen eigenen Arbeitsbereich mit getrennten
Sitzungen, `advisory`/`active`-Kennzeichnung und expliziter Übergabe. Die
Paritätsprüfung vergleicht jeden heutigen Live-Flow und die statischen
Offline-Ansichten mit installierter HQ2-App sowie direktem Browserstart.
Projektstart, GitHub- und Linear-Verknüpfung kommen als nachvollziehbare
Erweiterungen hinzu. Linear-Sync auf einem lokalen Host nutzt begrenztes
Polling; Ausfall oder fehlender Login blockiert lokale Projektarbeit nicht.

## Fehler- und Freigabegrenzen

- API oder HQ-Host nicht erreichbar: sichtbarer Offline-/Stale-Zustand;
  lesbare lokale Snapshots werden nicht als Live-Status ausgegeben. Keine
  Browser-Queue als Ersatz für Rust/SQLite.
- Authentifizierung, Quota, nicht unterstützter Effort oder Profil-Drift:
  spezifischer Fehler am betroffenen Anbieter und Sitzungsversuch; kein
  stiller Wechsel auf einen zahlungspflichtigen API-Key oder anderen Harness.
- Projektwechsel, verspätete Antwort oder Handoff-Fehler: Nachrichten und
  Belege bleiben ihrer Projekt- und Sitzungs-ID zugeordnet. Ein Entwurf wird
  nicht in ein anderes Projekt übernommen.
- GitHub/Linear-Sync: externe Daten tragen Herkunft und Synchronisationszeit;
  Konflikte und Rate Limits werden gezeigt. Writeback ist auf gewählte
  Fortschrittsereignisse begrenzt und darf kein menschliches Verdict ersetzen.
- Automatische Dauerarbeit bleibt bis zu den Gates von
  `.pa/task_continuous_devhq.md` aus. Unabhängige Reviews dürfen innerhalb
  der freigegebenen Policy automatisch erfolgen. Entscheidungen außerhalb
  dieser Policy sowie Merge, Release und Continuous-Aktivierung benötigen
  menschliche Freigabe. `F-CORE-3 → F6 → Multi-Harness` gilt auch
  für den neuen Editor und weitere CLI-Profile.

## DEVFLOW-Erweiterung v1 (DF-03, Entwurf vom 23.09.2026)

Diese Erweiterung definiert Zielverhalten für DF-04 ff.; sie behauptet keine
implementierten Endpunkte, Migrationen oder bestandenen Abnahmegates.
`contractVersion` bezeichnet das Schema, `revision` den veränderlichen
Objektstand; beide sind unabhängig von `sourceRevision` und `policyRevision`.
App, HQ und CLI zeigen dieselben IDs, Zustände, Gründe und Belegreferenzen.

### Planquelle und Laufzeitbindung

`PlanPackage` enthält `projectId`, `planId`, stabile `packageId`, `parentId`
(nullable), `sourcePath`, `sourceRevision` (Digest der gelesenen Quellbytes,
ergänzt um Git-Commit falls vorhanden), Quellanker, Titel, Abnahmekriterien,
`dependencyIds`, Priorität samt Begründung und `revision`. Der eindeutige
Schlüssel ist `(projectId, planId, packageId)`, nicht Titel oder Zeilennummer.
Eltern bilden die Anzeigehierarchie; nur explizite Abhängigkeiten sperren
Ausführung. Fehlende/doppelte IDs, unbekannte Eltern/Abhängigkeiten und Zyklen
in beiden Beziehungen verwerfen den gesamten Import mit Quellstellen.
Ein Wiederimport derselben Revision erzeugt weder Pakete noch Arbeit doppelt.
Eine neue Quellrevision aktualisiert die Projektion atomar; entfernte Pakete
werden als entfernt markiert, laufende Aufträge bleiben an ihre ursprüngliche
Revision gebunden. Planänderungen erzeugen einen prüfbaren Quelldiff, niemals
einen stillen konkurrierenden Plan im Browser.
Import verlangt `expectedProjectionRevision` als atomaren Compare-and-Swap;
eine parallel überholte Lesebasis darf keine neuere Projektion überschreiben.
Digests sind nicht zeitlich geordnet. Absichtlicher Rollback ist eine neue
Importoperation mit aktuellem CAS, explizitem Grund und neuer Projektionsrevision.
Entfernung setzt für alle gebundenen Versuche `noNewDispatch`; existierende
Prozesse werden weiter abgeglichen. Pause oder Launch-Intent beweisen kein Ende.
Wiederauftauchen des Pakets belebt weder alte Claims noch Autorität wieder;
neue Versuche brauchen neue Admission unter aktueller Quelle/Policy.
Aufteilung/Zusammenführung vergibt neue Paket-IDs und dokumentiert explizit
`derivedFrom`/`supersedes` als Referenzen auf ursprüngliche Paket-ID UND
Quellrevision. Historische Revisionen bleiben auflösbar; Run-/Evidence-IDs und
deren Paketbindung werden niemals still umgeschrieben. Die Nachfolge übernimmt
weder Claims noch Abnahmebelege automatisch. Fehlende oder widersprüchliche
Nachfolgereferenzen sind Importfehler statt einer heuristischen Titelzuordnung.

| Vorhandener Anker | DEVFLOW-Bindung und Grenze |
|---|---|
| Klassische Taskqueue, `queue.rs::dispatch_project/dispatch_once` | Bestehende manuelle Queue bleibt erhalten. Eine Paketzuordnung ist Metadatum, kein Beleg für Continuous-Admission oder unabhängige Abnahme. |
| `ContinuousGoal`, `ContinuousTask`, `ContinuousClaim` in `store/continuous.rs` | Workflow-Arbeit referenziert zugelassenes Goal und bestehende Task-/Owner-/Fence-IDs. Planimport allein erzeugt keinen Claim und startet nichts. |
| `DevelopmentRun` in `store/development_runs.rs` | Stage-Versuche referenzieren vorhandene Runs samt unveränderlicher Intent-Policy, Worker und Kandidatenbindung; kein zweiter Run-Lebenszyklus. |
| `development_events.rs` | Bestehendes Journal enthält Metadaten zur erneuten autorisierten Abfrage, keine replayfähigen Zustandsübergänge. DF-11 ergänzt persistente fachliche Übergänge. |

Jeder Stage-Versuch besitzt eine Ausführungsbindung: `classicQueueEntryId` ODER
`continuousTaskId`; dieselbe Arbeit darf nicht in beiden Dispatchpfaden aktiv
sein. Eine Überführung verlangt im Kern nachgewiesene Stilllegung des alten
Auftrags und atomare Zuordnung; ohne diesen Nachweis bleibt sie blockiert.
Stage-Fortschritt nutzt bestehende Admission, Queue, Claims, Fences und Budgets.
Browser/Node planen oder starten keine eigenen Worker. Die Klassik-Bindung
schaltet keine Continuous-Fähigkeit frei; Continuous bleibt hinter W4.
Sync, Polling und Entwürfe erzeugen keine Admission; jede Mutation wird im Kern
validiert. Clientgenerierte Idempotency-Keys sind erlaubt, ihre Scope-Eindeutigkeit prüft der Kern.

### Beobachtete Ausführungsidentität

`ExecutionIdentity` besitzt stabile ID und Runbezug; `requested`, `configured`
und `observed` führen Provider, Modell und kanonische Modellfamilie getrennt.
Ausführender `adapterId` mit Version und `uiProfileId` sind eigene Felder.
Jede Beobachtung trägt Quelle, Beleg-ID, Beobachtungs-/Ablaufzeit und Status
(`observed`, `unknown`, `stale`, `conflicting`). Konfiguration ersetzt keine
Beobachtung; ein Alias braucht eine versionierte, belegte Familienauflösung.
Unbekannte oder widersprüchliche Auflösung bleibt unbekannt für Abnahmezwecke.
Modellwechsel innerhalb eines Runs erzeugen weitere Identitätsbeobachtungen;
eine spätere Identität überschreibt keine frühere Autorschaft.
Familienauflösung benutzt ein kontrolliert geprüftes Register mit Quelle,
Revision, Digest und Widerrufsstatus; Agenten dürfen sich nicht selbst attestieren.
Historische Belege behalten ihre Registerreferenz; Widerruf invalidiert betroffene
Attestationen. Eine neue Registerrevision schreibt frühere Autorschaft nicht um.

DF-08 erweitert die vorhandenen `ModelCandidate`, `ResolvedRoute` und
`Observation` aus `development_policy.rs`. Ein Codex-/Claude-/DeepSeek-UI-Profil
ändert weder Modellfamilie noch Adapterfähigkeit. Native Kombinationen brauchen
Capability-Beleg und Aktualität; fehlende Kompatibilität verhindert den Start
mit Grund statt eines stillen Adapter- oder kostenpflichtigen Providerwechsels.

### Workflow, Stage und Übergang

Ein Workflow bindet Paket/Quellrevision und versionierte Stage-Konfiguration.
Eine Stage nennt ID, Rolle, Vorgänger, Versuch, Zustand, `revision`, Run-ID,
Kandidat-Hash (vor Bindung nullable), Policyrevision und Ausführungsbindung.
Jeder Übergang enthält Event-ID, Schema, Projekt/Paket/Stage, Versuch,
Von/Nach-Zustand, erwartete/neue Revision, Akteur, Grund, UTC-Zeit, Quelle,
Idempotency-Key sowie vorhandene Run-, Kandidat-, Claim-/Fence-Referenzen.
Für ausführende Übergänge sind Run, Claim/Fence und aktuelle Policy Pflicht.

| Von | Nach | Bedingung |
|---|---|---|
| `pending` | `ready` | Vorgänger samt erforderlichen Review-/Testgates bestanden; Paketrevision gültig. |
| `ready` | `running` | Admission prüft atomar aktuelle Quell-/Paketrevision, noNewDispatch, Policy, Budget und Claim/Fence erneut; veraltete Bindung blockiert. Vorhandener Launchpfad bestätigt den Start. Persistenter Intent davor ist noch kein laufender Worker. |
| `pending`, `ready`, `running` | `blocked` | Abhängigkeit, Provider oder Recht fehlt; Grund und gegebenenfalls Decision-ID gespeichert. Ein aktiver Prozess muss zuvor gestoppt/quieszent bestätigt sein. |
| `blocked` | `pending` | Blocker nachweislich behoben; alle Startbedingungen werden erneut geprüft. |
| `running` | `succeeded`, `failed` | Persistiertes Ergebnis; Prozessende/Abgabe und gültiger Fence nachgewiesen. Erfolg erfüllt Stage-Abnahmekriterien. |
| `pending`, `ready`, `blocked`, `running` | `paused` | Pause angefordert; bei aktiver Arbeit erst nach bestätigtem Checkpoint und Quieszenz. |
| `paused` | `pending` | Explizite Wiederaufnahme innerhalb aktueller Rechte; keine Wiederverwendung abgelaufener Autorität. |
| Jeder nichtterminale Zustand | `cancelled` | Abbruch angefordert; bei aktivem Worker erst nach bestätigt beendetem Prozess. |
| `failed` oder Review mit Nachbesserungsauftrag | neuer Versuch `pending` | Explizite Retry-/Rework-Entscheidung innerhalb Policy; alter Versuch und Urteil bleiben unverändert. |

Terminale Versuche werden nicht wieder geöffnet. Noch nicht quittierte Pause/
Abbruch stehen als `pendingAction` am bisherigen Zustand. Ein Neustart oder
unklarer Prozesszustand setzt `recoveryStatus=reconciling`, sperrt Neudispatch
und zeigt die Unsicherheit. Erst Prozess-/Ownership-Abgleich entscheidet über
Fortsetzung, terminales Ergebnis oder einen neuen Versuch; Leaseablauf allein
reicht nie. Ein negativer Review ist ein gespeichertes Urteil, kein Erfolgsgate:
Er öffnet eine Rework-Stage und nach Kandidatenänderung neue Prüfversuche.
Reconciliation hat eine policygebundene Frist/Versuchsgrenze. Bei Überschreitung
entsteht eine menschliche Decision mit Prozess-/Claim-Evidenz, Unsicherheiten
und sicheren Optionen: inspizieren, kontrolliertes Stoppen anfordern oder
weiter blockiert lassen. Neudispatch bleibt gesperrt. Auch ein Human-Verdict
darf unbekanntes Prozessende nicht als `failed`/neuen Versuch deklarieren;
erst nachgewiesenes Ende und gültige Fencing-/Admission-Prüfung erlauben Ersatz.

### Kandidatenweite unabhängige Prüfung

`ReviewEvidence` bindet exakten Kandidat-Hash, Run, Policyrevision, Prüfart,
Umfang, Ergebnis, Quellen und beobachtete Reviewer-/Tester-Identität.
Die Autorenmenge des Kandidaten umfasst alle beitragenden Runs/Identitäten
und ihre Modellfamilien, einschließlich Handoffs, Integrationsänderungen und
Reviewer-Fixes. Ein Fix macht den Reviewer zum Autor; kein neuer Agentenname,
Harness oder UI-Profil entfernt diese Zugehörigkeit. Unaufgelöste Autorschaft
oder unbekannte/veraltete Prüfidentität blockiert die Attestation.

Review und inhaltliche Testgestaltung/-bewertung sind nur abnahmefähig, wenn
die belegte Prüferfamilie von JEDER Autorenfamilie verschieden ist. Die
Autorenfamilien werden historisch belegt, nicht nachträglich aus aktueller
Profilkonfiguration erraten. Deterministische Tests durch Autoren sind erlaubt,
aber kein Ersatz für unabhängige Testgestaltung und Bewertung. Kandidaten-,
Scope- oder relevante Policyänderungen invalidieren betroffene Prüfbelege;
Übernahme alter Belege benötigt eine ausdrücklich verifizierte Umfangsbindung.
`ReviewInput`-Labels des Bestands bleiben Auditdaten: sie beweisen keinen
vertrauenswürdigen Principal. Menschliches Merge-/Release-Verdict ersetzt
keinen fehlenden Qualitätsbeleg und erteilt keine Continuous-Freigabe.

### Entscheidungen, Messwerte und Erweiterungen

DF-01-Antworten werden als unveränderlicher `HumanPolicySnapshot` mit ID,
`policyRevision`, Digest über kanonisch serialisierten Inhalt, Schema-Version,
Scope, Erfassungszeit und Referenzen auf die tatsächlichen menschlichen
Antworten gespeichert. Der Digest sichert Inhaltsbindung, beweist allein aber
keine menschliche Herkunft: diese verlangt den verifizierten Human-Kanal.
DF-13 und DF-22 referenzieren genau diesen Snapshot samt Revision und Digest;
unbekannte Revisionen, Digestabweichung oder fehlender Herkunftsnachweis sperren
die abhängige Aktion. Neue Antworten erzeugen neue Snapshots mit Vorgängerbezug,
keine Änderungen am alten Snapshot. Agenteninterpretationen bleiben Vorschläge.

`Decision` enthält ID, Typ, Optionen, Grund, benötigte menschliche Entscheidung,
Aktion/Projekt/Paket/Kandidat, Scope, Ablauf, einmalige Nonce, Policyrevision, erwartete Objektversion,
Entscheider samt verifizierter Autorität und Auditspur. `pending`, `resolved`,
`expired` und `superseded` sind verschieden. Antworten gelten nur für den
gebundenen Scope/Stand; Wiederholung, Ablauf oder Scopewechsel erweitert keine
Rechte. Ein Berechtigungsteam darf erlauben/ablehnen/eskalieren gemäß Policy,
aber keine Human-Verdicts erzeugen oder seine Policy erweitern. Änderungen
erzeugen neue unveränderliche Policyrevisionen und prüfen offene Aktionen neu.
Verdict-Nutzung konsumiert die Nonce atomar. Host-Sitzungsauthentifizierung ist
keine Verdict-Befugnis: der Host darf diese weder erzeugen noch verlängern.
Token/Credentials werden aus Logs und Auditpayloads entfernt, nicht als Beleg gespeichert.

`Measurement` enthält Einheit, Stichprobengröße, Zeitraum, Taskklasse, Quelle
und Unsicherheit; unbekannt/veraltet/konfiguriert/beobachtet bleiben getrennt.
`Capability`/`Template` nennen Quelle, feste Version, Kompatibilität, Rechte,
Projekt-/Globalscope, Auswahlgrund, tatsächliche Nutzung und Ergebnis.
DF-21 ergänzt erst die GitHub-Installation; vorhandene gebündelte Skill-Packs
belegen keine beliebige GitHub-Kompatibilität. Repositorymetadaten sind keine
Freigabe. Zusätzliche bezahlte API-Nutzung bleibt verboten.

### Persistenz, Leseschnittstellen und Fehler

DF-04 beginnt mit einer reinen Rust-Planprojektion; Store-/API-Anbindung folgt
seriell. DF-11 speichert Zustandsänderung, fachliches Ereignis und erforderliche
Ausführungsreferenzen atomar in SQLite. Ein Intent mit Idempotency-Key wird
vor externem Start persistiert; nach Absturz wird dessen Ausgang abgeglichen,
nicht erneut blind gestartet. Gleicher Schlüssel und gleiche Nutzlast liefern
das ursprüngliche Ergebnis, abweichende Nutzlast einen Konflikt. Schlüssel
sind pro Projekt und Operation eindeutig; erwartete Revision und Fence
verhindern parallele veraltete Schreibversuche ohne Teiländerung.

Migrationen sind additiv, versioniert und transaktional in der bestehenden
Store-Lane. Bestandsarbeit erhält keine erfundene Plan-/Modellzuordnung,
Reviewattestation oder rückwirkende Transition; fehlende Werte bleiben explizit
unbekannt. Schemafehler lassen die Migration zurückrollen und sperren die neue
Funktion. Ein älterer Client darf unbekannte Schema-/Zustandsversionen anzeigen,
aber nicht mutieren. Downgrade braucht einen geprüften Kompatibilitätspfad;
kein Restore einer alten DB über nachfolgende akzeptierte Writes.
Unbekannte Versionen/Enums bleiben nicht ausführbar. Migrationen sperren alle
betroffenen Writer; explizite Kompatibilitäts-/Mindestversionen steuern deren Wiederzulassung.

DF-05 spezifiziert lesende Projektionen für Planpakete, Paketdetails und
Quellrevision; DF-11 ff. ergänzen Stages, Ereignisse, Entscheidungen und Belege.
Konkrete Routen sind hier bewusst noch nicht implementiert. Antwortumschläge
tragen `contractVersion`, Projekt-ID, `sourceRevision`, Erstellzeit,
Verfügbarkeitsstatus und bei Listen Cursor/`hasMore`. Fehlende Quelle,
ungültiger Plan, nicht unterstützte Version, veraltete Revision, fehlende
Admission oder unbekannte Identität liefern unterscheidbare Fehler mit Grund
und Quellbezug; keine leere Erfolgsliste. Veraltete Ereigniscursor verlangen
einen neuen autorisierten Snapshot. App/HQ/CLI-Parität wird über dieselben
Fixtures und reale Kernantworten geprüft, nicht über übereinstimmende Mockups.
