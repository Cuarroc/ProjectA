# v2.0 Bestandsaufnahme (Eingabe für den Plan)

Stand 06.10.2026, Basis `origin/main` 719426c. Quelle: die Systemkarte des
Entwurfs „Glass Leitstand“ (`docs/design/2026-10-ui-v2/glass/Systemkarte.dc.html`).
Jede Zeile ist ein Teil von ProjectA 2.0 mit seinem heutigen Stand:

- **gebaut**: gibt es in der App, braucht nur das neue Aussehen
- **teilweise**: gibt es zum Teil oder nur außerhalb der App (pa-orch, Dev-HQ)
- **neu**: gibt es noch nicht, braucht Oberfläche und Technik dahinter
- **geplant**: steht schon in `docs/PLAN.md` (M1–M4)

Die Spalte „Code heute“ ist ein Hinweis aus dem Entwurf, kein geprüfter
Beleg. Der Plan prüft jeden Anker mit `rg -n`, bevor er ein Paket darauf baut.

| Schicht | Teil | Stand | Code heute | Beschreibung |
|---|---|---|---|---|
| Oberfläche | Leitstand | teilweise |  | Live-Agentenkarten; jede Karte trägt ihren Beweis. Heute: BoardView, WorkerPanel. |
| Oberfläche | Agent starten · Modell & Failover | teilweise |  | 10 CLIs, Modell, Aufwand, MCP und Rechte; das Modell wird beim Start beobachtet. Heute: NewWorkerDialog mit 5 CLIs. |
| Oberfläche | Beweise & Merge | neu |  | Beweiskette, Fremd-Review und Merge nur über die Warteschlange. Heute nur extern in pa-orch/pipeline.py. |
| Oberfläche | Kontingente & Failover | teilweise |  | 5 h, Woche und Monat mit Entsperr-Probe; Regeln als Sätze (neu). Heute: quota.rs. |
| Oberfläche | Organigramm | neu |  | Abteilungen mit Budget, erlaubten CLIs und Autonomie als Grenze. Heute nicht vorhanden. |
| Oberfläche | Personas & Vorlagen | neu |  | Vorlagen und eigene Personas mit Rechten, Failover und MCP-Servern. Heute: agent-defaults.json ohne Rollen. |
| Oberfläche | Team-Lauf · Orchestrator | teilweise |  | Orchestrator, Chief of Staff und drei Teams gleichzeitig. Heute extern in pa-orch und AgentsRoom. |
| Oberfläche | Projektgedächtnis | teilweise |  | Notizen mit Quelle, Prüfdatum und deiner Bestätigung; Lessons mit Abstimmung. Heute: LearningsPanel, memorix extern. |
| Oberfläche | Ideen | neu |  | Agenten-Triage: Dubletten, Größe und Meilenstein stehen vor dem Ticket fest. Heute: Später-Liste in docs/PLAN.md. |
| Oberfläche | Bugs | neu |  | Kein Fix ohne kompilierenden roten Test mit Exit-Code. Heute: Hook red-first.sh, keine Ansicht. |
| Oberfläche | Plan & Entscheidungen | teilweise |  | Plan und Entscheidungs-Inbox im selben Fenster. Heute: Dev-HQ getrennt, Token aus der Seitenleiste (hq.js:387). |
| Oberfläche | MCP-Server | neu |  | Team-Rechte, Schlüssel nur als Tresor-Verweis, Mergen über MCP gesperrt. Heute nur in den CLI-Einstellungen. |
| Oberfläche | Agenten-Generator | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Trigger & Webhooks | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Befehle & Automatik | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Einstellungen | teilweise |  | Heute: SettingsView; dort liegt auch der Not-Aus, versteckt. |
| Oberfläche | Projekteinstellungen | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Ersteinrichtung | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Diff & Rückspulen | teilweise |  | Heute: DiffView. Rückspulen ist neu. |
| Oberfläche | Benachrichtigungen & Handy | teilweise |  | Heute: AttentionInbox in der App. Handy-Benachrichtigungen fehlen noch. |
| Oberfläche | Aktivität & Wiederholung | teilweise |  | Heute: ActivityView und HistoryView. |
| Oberfläche | Ablauf-Vorlagen | neu |  | Neu in diesem Entwurf. |
| Oberfläche | Sechs Zustände, ein Wörterbuch | neu |  | Jeder Zustand hat Form, Wort und Farbe, gleich in App, HQ und CLI. Heute vier Designsprachen, Grün doppelt belegt (KI-28). |
| Oberfläche | „Braucht dich“ mit Antwort im Stream | gebaut |  | Die Antwort geht direkt ins Terminal, mit Frist und „entscheide selbst“. Heute: QuestionsView, questions.rs. |
| Oberfläche | Glass, hell und dunkel | neu |  | Eine ruhige Sprache für alles, Kontrast 4,5:1, ganz per Tastatur. Heute vier Designsprachen. |
| Oberfläche | Deutsch und Englisch | neu |  | Die ganze Oberfläche auf Deutsch oder Englisch. |
| Orchestrierung | Orchestrator | teilweise | CommandChat · Rest in pa-orch | Nimmt ein Paket aus dem Plan und gibt es einem Agenten. In der App heute die Befehlsleiste an den Orchestrator. |
| Orchestrierung | Chief of Staff | neu | nur extern in pa-orch | Übergaben bleiben sichtbar, nur wichtige Fragen erreichen dich. |
| Orchestrierung | Abteilungsregeln | neu | nicht vorhanden | Jede Abteilung hat Budget, erlaubte CLIs und Autonomie als Grenze, nicht nur als Gruppierung. |
| Orchestrierung | Drei Teams parallel | neu | nicht vorhanden | Abhängigkeiten und Naht-Spur sind sichtbar; kein Auftrag bleibt als Zombie hängen. |
| Orchestrierung | Personas als Rollen | neu | agent-defaults.json, ohne Rollen | Eine Persona bringt Rechte, Failover und MCP-Server mit, nicht nur einen Prompt. |
| Orchestrierung | Trigger und Abläufe | neu | neu in diesem Entwurf | Trigger und Webhooks starten Abläufe aus Vorlagen. |
| Orchestrierung | Warteschlange | neu | queue.rs ohne Vorgänger | Mit Vorgängern, Naht-Spur und RAM-Prüfung: Ein Auftrag startet, oder du erfährst, warum nicht. |
| Orchestrierung | Verdiente Autonomie | neu | Regel in AGENTS.md | Agenten erweitern ihre Rechte nie selbst; Vertrauen wächst mit grünen Läufen. |
| Orchestrierung | Dauerbetrieb | geplant | M4 · W4-03 | Eingefroren bis M4; Aktivierung nur nach der Abnahmematrix und mit deiner Freigabe. |
| Orchestrierung | Wachhund | teilweise | pa-orch/watchdog.sh | Erkennt fertige und stehengebliebene Läufe und meldet sie. Heute ein pa-orch-Skript, nicht in der App. |
| Laufzeit | Agent im Worktree | gebaut | workers.rs · TerminalView | Jeder Agent läuft als echtes Terminal (PTY) in seinem eigenen Worktree. |
| Laufzeit | CLI-Anbieter | teilweise | 5 heute · 10 im Entwurf | Heute im NewWorkerDialog. |
| Laufzeit | Failover-Kette | teilweise | quota.rs · fallback: null | Wechselt vor der Grenze über Anbieter hinweg, ohne Kontowechsel im Gespräch. |
| Laufzeit | Kontingente | teilweise | quota.rs · ohne Entsperr-Probe | 5 h, Woche und Monat. Heute endet eine Sperre erst bei neuer Aktivität; eine eigene Probe soll sie aufheben. |
| Laufzeit | Nur Abos | gebaut | Tresor, keine API-Schlüssel | „Pause statt Rechnung“ ist eine Pflichtregel, die niemand abschaltet. |
| Laufzeit | Startprüfung | teilweise | pa-orch · resources.rs | Vor jedem Start: beobachtetes Modell, Kontingent, freier RAM, laufende Builds. Heute als pa-orch-Skript, nicht in der App. |
| Laufzeit | MCP-Anbindung | neu | nur in den CLI-Einstellungen | MCP-Server je Agent und Team, Schlüssel nur als Tresor-Verweis. |
| Laufzeit | Gedächtnis | teilweise | LearningsPanel · memorix extern | Jede Notiz trägt Quelle, Prüfdatum und deine Bestätigung. |
| Laufzeit | Grenzen je Job | geplant | M4 · W2-08b | Speicher- und CPU-Grenzen je Job; Stillstand früh erkennen. |
| Laufzeit | Server-Ort | teilweise | lokal oder eigener Server · pa-orch | Wo Agenten laufen: auf diesem Rechner oder auf dem eigenen Server. Heute über pa-orch eingerichtet, nicht in der App. |
| Beweis-Schicht | Gates | gebaut | scripts/ci/gates.sh | Die Gate-Liste steht an genau einer Stelle; beide Hooks und alle Workflows rufen dieselben Lanes. |
| Beweis-Schicht | Fremd-Review | neu | store/development_runs.rs:1322, Dauerbetrieb aus | Kein Modell benotet seine eigene Familie. |
| Beweis-Schicht | Merge-Queue | neu | Merge-Knopf umgeht sie: gh.rs:429 (KI-29) | Im Repo läuft Mergify seit 24.09.2026; der Merge-Knopf der App umgeht die Warteschlange noch. |
| Beweis-Schicht | Risikostufe | neu | AGENTS.md · Skript in pa-orch | A, B oder C folgt aus den Dateipfaden. Nahtstellen, Sicherheit und Datenbank sind immer A mit zwei Prüfern. |
| Beweis-Schicht | Beleg am Commit | neu | nur extern: pipeline.py | Ein neuer Commit macht den Beleg ungültig; das Delta wird neu geprüft. |
| Beweis-Schicht | NICHT ABGEDECKT | teilweise | PR-Vorlage, nicht in der App | Ehrliche Lücken werden sichtbar statt eines pauschalen „alles grün“. |
| Beweis-Schicht | red-first | neu | Hook red-first.sh | Kein Fix ohne roten Test. Nach drei gescheiterten Fix-Versuchen entscheidest du. |
| Beweis-Schicht | Not-Aus in 10 s | teilweise | estop.rs · App-Frist in M4 | Immer sichtbar in jeder Kopfleiste, mit Zeitgarantie und Nachweis. Heute versteckt in den Einstellungen. |
| Beweis-Schicht | Mergify-Pipeline | teilweise | pa-orch/pipeline.py · CI | Reagiert selbst: CI rot → Fix-Auftrag, Konflikt → Merge-Auftrag, aus der Queue geworfen → genau ein neuer Versuch. Heute in pa-orch, nicht in der App. |
| Beweis-Schicht | Sicherer Start | teilweise | teilweise, nicht in der App | Nach einem Neustart bleiben alte Aufträge pausiert, statt blind weiterzulaufen. |
| Beweis-Schicht | Signierter Installer | teilweise | release.yml · nur v*-Tags | CI baut Installer nur auf v*-Tags. Produktionsschlüssel und signierter Updater fehlen noch (M4 · W3-07). |
| Daten | SQLite-Store | gebaut | store.rs · store/ | Rust und SQLite besitzen den Laufzeitzustand; HQ zeigt ihn nur an. |
| Daten | Plan als Quelle | teilweise | docs/PLAN.md · Inbox | Der einzige Plan: Meilensteine M1 bis M4 und die Entscheidungs-Inbox. |
| Daten | Lessons | gebaut | npm run hq:lesson | Was geholfen hat, wandert nach oben; was nicht half, nach unten. |
| Daten | Prüfpfad | geplant | M4 · W5-05 | Nur anhängen: Trigger verhindern UPDATE und DELETE. |
| Daten | Anbieter-Zeugnisse | neu | neu in diesem Entwurf | Ein Zeugnis je Modell, gebildet aus seinen bisherigen Läufen und Reviews. |
| Daten | Kostenbuch | neu | neu in diesem Entwurf | Hält fest, wie viel Kontingent jeder Lauf verbraucht hat. |
| Daten | Sicherung & Umzug | geplant | M4 · W3-03, Backup-Drill | Sichern und auf einen anderen Rechner umziehen. Der Backup-Drill ist für M4 geplant; der Umzug ist neu. |
| Daten | Lizenz | geplant | Entscheidung in docs/PLAN.md | Eine Lizenz fehlt noch; die Entscheidung steht in der Inbox des Plans. |
## Nach der Systemkarte hinzugekommen

| Schicht | Teil | Stand | Code heute | Beschreibung |
|---|---|---|---|---|
| Oberfläche | Erweitert · Verbesserungen | neu |  | 32 Schalter in 6 Gruppen (Denken & Qualität, Kontext & Gedächtnis, Werkzeuge & Automatik, Kontingente & Kosten, Sicherheit & Rechte, Ablauf & Aufmerksamkeit), Presets, je Schalter Wirkung und Kosten. Board `Verbesserungen.dc.html`. |
| Oberfläche | Kontextfenster je Modell | neu |  | Auswahl im Agenten-Generator, bei Personas und beim Start (z. B. 200k/1M); Kostenhinweis bei 1M; Regler „Automatisch verdichten ab“ (50–95 %, Standard 80 %). |
| Orchestrierung | App-Wissen der Agenten | neu |  | App-Handbuch für alle Personas, Regeln „Wann was“ (Situation → Werkzeug, automatisch oder mit Freigabe), Protokoll der tatsächlichen Nutzung mit „Verpasst“-Zähler. Board `Befehle.dc.html`. |
| Oberfläche | Bewegung | neu |  | Motion-Tokens (120/200/320 ms, ease-out, Feder), Drücken 0,98, ein Puls für „Läuft“, `prefers-reduced-motion` schaltet alles ab. Gemeinsamer Block in jedem Board. |
| Laufzeit | Ausführungsort je Agent | teilweise | pa-orch (lokal/Server), Codex Cloud extern | Nutzerwunsch 06.10.: wählbar, ob ein Modell auf dem PC, in der Cloud des Anbieters oder auf einem eigenen Server (SSH) läuft; Vorgabe je Persona und je Projekt, „automatisch“ nach freiem RAM. Heute nur außerhalb der App über pa-orch. |
