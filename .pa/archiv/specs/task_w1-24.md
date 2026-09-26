# W1-24 — OmniRoute-Schlüssel-Push deaktivieren

Status: historisch

Nutzerentscheidung 22.09.2026: OmniRoute-Schlüssel-Push aus.
Owner: Codex, Worktree codex-w1-24. Dateien: providers.rs und Paketdoku.
Kein Opt-in-Schalter, keine neuen Credentials, keine globale Routeraenderung.

Abnahme: keys_are_not_pushed_to_an_unidentified_listener kompiliert und
scheitert vor Fix; danach kein POST selbst bei 200-Health und gefuelltem
Vault. Gespeicherte Keys bleiben vorhanden; leere/offline Faelle ebenfalls.
Unbenutzten Key-POST-Transport entfernen; alle erforderlichen Gates und
unabhaengiges Review vor Integration. Keine Main-Nahtstellen-Aenderung.

<<<<<<< HEAD
Abgeschlossen 22.09.2026 mit PR62, Merge25ff100. Roter Listener-Test und37
Provider-Tests plus lokale Vollgates und Linux/Windows-CI dokumentiert in
.pa/report_w1-24.md. Keine installierte App ersetzt.
=======
Abgeschlossen: PR #62, Merge 25ff100. Bericht: .pa/report_w1-24.md.
Die installierte App wurde dadurch nicht aktualisiert.
>>>>>>> origin/main
