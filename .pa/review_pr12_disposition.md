# Review-Disposition: pr12 (W2-07b)

Kandidat: Branch `claude/w2-07b`, Review-Eingang `0acbaac` (= `origin/main`
`a18dcd6` plus Paket-Diff `2ce0de6`).
Autor: kimi-k3 (Kimi Code) — Kimi-Modelle als Reviewer daher ausgeschlossen.
Reviewer (Stufe A laut Auftrag, Ollama/OpenCode wegen Wochenlimit tabu):
xAI Grok (`grok.exe --prompt-file`) und Claude Sonnet (`claude -p --model
sonnet`). Prompt: `.pa/review_prompt_pr12.md` mit komplettem Diff
`origin/main...HEAD`; Antworten unverändert in `.pa/review_pr12_grok.md` bzw.
`.pa/review_pr12_sonnet.md`. Beide Urteile: **approve with conditions**.

Jeder Befund wurde gegen den echten Code geprüft (`credential_acl.rs`,
`api.rs:1020-1064`, `agent_access.rs:175-259`, `credential_acl_tests.rs`,
`oneshot.rs:91-100`).

## Grok (xAI) — `.pa/review_pr12_grok.md`

- **G-F1 (hoch): Owner-Prüfung bricht über die Elevation-Grenze und klemmt
  dann fest. Verifiziert und angenommen.** `validate_owner_only`
  (`credential_acl.rs:323`) verlangt `EqualSid(owner, TokenOwner)`; elevated ist
  `TokenOwner` = `BUILTIN\Administrators`, unelevated der Benutzer. Eine
  elevated erzeugte Datei gehört der Gruppe Administratoren und wird bei jedem
  späteren unelevated Start abgelehnt (und umgekehrt); `CREATE_ALWAYS` hat den
  Inhalt vorher schon gelöscht, der Fehlerzustand ist klebrig. Fix: Owner wird
  akzeptiert, wenn er `TokenUser` **oder** `TokenOwner` **oder** der
  wohlbekannten Administrators-SID entspricht — kein Nicht-Admin kann Objekte
  mit einem dieser drei Eigentümer anlegen, das Bedrohungsmodell (fremde
  lokale Benutzer) bleibt intakt. Zusätzlich wird der Owner **vor** dem
  Kürzen geprüft (Open ohne `truncate`, Owner-Read, dann DACL, dann
  `set_len(0)` + Write): eine abgelehnte Datei bleibt unangetastet. Den
  von Grok alternativ vorgeschlagenen automatischen Löschen-und-Neu-Anlegen
  bei wirklich fremdem Eigentümer lehne ich ab: genau dafür ist Fail-closed
  das dokumentierte, im PR-Text ausgewiesene Verhalten — eine fremde Datei
  ist ein Angriffssignal und soll den Start blockieren, nicht still
  absorbiert werden.
- **G-F2 (mittel): Credential-Opens folgen Reparse-Points. Verifiziert und
  angenommen.** Weder `write_descriptor_body` (`api.rs:1047`) noch
  `restrict_directory_to_current_user` (`credential_acl.rs:192`) setzen
  `FILE_FLAG_OPEN_REPARSE_POINT`; `CREATE_ALWAYS` folgt Symlinks/Hardlinks.
  Fix: `FILE_FLAG_OPEN_REPARSE_POINT` am Öffnen, danach per
  `GetFileInformationByHandle` Reparse-Attribut bzw. Link-Anzahl > 1
  fail-closed ablehnen (Datei und Verzeichnis). Der Scoped-Writer ist
  bereits immun (`create_new`). Rot-Nachweis über Hardlink (ohne Admin
  erzeugbar): Opfer-Datei bleibt unberührt, Aufruf schlägt fehl.
- **G-F3 (mittel): Verzeichnis-DACL wird nicht über die Kind-Erzeugung
  gehalten. Verifiziert, als Follow-up an den Koordinator.** Handle-relative
  Kind-Erzeugung ist eine neue Naht (NtCreateFile/relative Opens), über dieses
  Paket hinaus. Der Token bleibt geschützt: die Kind-Datei wird vor dem
  Schreiben selbst fail-closed verengt; ein getauschtes Verzeichnis ändert
  nur, wer darin listen/anlegen/löschen kann. In „Offene Punkte" aufnehmen.
- **G-F4 (mittel): Unix-`make_private` am Verzeichnis kann den Issuer nicht
  scheitern lassen. Verifiziert und angenommen.** `agent_access.rs:198`
  ignoriert das Ergebnis (`make_private` schluckt intern, `oneshot.rs:96`).
  Fix: `#[cfg(unix)]`-Zweig propagiert den chmod-Fehler (`0o700`) fail-closed.
  Nebenfrage aus Grok F4/S-F8 geklärt: `make_private` setzt für Verzeichnisse
  bereits `0o700` (`oneshot.rs:95`), nicht `0o600`. Unix-only kompilierbar
  (KI-7); diese Maschine hat kein WSL2 (`wsl -l -q` leer) — Rot/Grün-Zeuge ist
  die Linux-CI-Bahn, im NICHT-ABGEDECKT-Block vermerkt.
- **G-F5 (mittel): Orakel und Unit-Tests sichern Owner-/Vererbungs-Aussagen
  nicht. Verifiziert und angenommen** (identisch mit S-F2). Das Orakel
  (`credential_acl_tests.rs:103`) vergleicht den Owner gegen `TokenUser`, die
  Produktion gegen `TokenOwner` — auf einem elevated Windows-Runner (Genau das
  ist die Merge-Queue) würde das Orakel die eigene, korrekte Produktion rot
  machen. Fix: Orakel akzeptiert dieselbe Owner-Menge wie die Produktion
  (Benutzer, Token-Owner, Administrators); Vererbungs-Flags der
  Verzeichnis-ACE (`OBJECT_INHERIT|CONTAINER_INHERIT`) werden im Orakel
  festgepinnt. Rot lokal nur über die Crafted-Snapshot-Unit-Tests zeigbar
  (unelevated Maschine); ehrlich vermerkt.
- **G-F6 (niedrig): Share-Modus 0 am Verzeichnis ist ein Dauer-
  Verfügbarkeitsrisiko. Verifiziert und angenommen** (identisch mit S-F3):
  die Ausstellung läuft parallel (Queue dispatcht Worker parallel), und die
  Datei wird bereits vor dem Grants-Mutex geöffnet — ein zweiter Issuance-
  Versuch oder ein Scanner-Handle lässt `CreateFile` mit
  `ERROR_SHARING_VIOLATION` fehlschlagen und damit den ganzen Launch
  fail-closed sterben. Fix: begrenzte Retry-Schleife auf
  `ERROR_SHARING_VIOLATION` (32) beim Öffnen von Verzeichnis und breitem
  Deskriptor. Rot-Nachweis: Test hält ein exklusives Handle und gibt es
  verzögert frei — ohne Retry sofort rot, mit Retry grün.
- **G-F7 (niedrig): `make_private` läuft nach der Windows-Verengung erneut.
  Abgelehnt mit Beleg:** `make_private` hat auf Windows einen leeren Rumpf
  (`oneshot.rs:98-99`, `#[cfg(not(unix))] let _ = path;`) — es öffnet nichts
  und setzt keine DACL. Der Aufruf ist bewusster Unix-Pfad; kein Fehler.

## Claude Sonnet — `.pa/review_pr12_sonnet.md`

- **S-F1 = G-F1 (hoch). Angenommen**, dieselbe Disposition. Sonnets Variante
  „delete + create_new bei Owner-Mismatch" wird aus dem oben genannten Grund
  nicht übernommen; die Owner-Mengen-Erweiterung löst beide Szenarien (A: die
  Gruppe Administratoren wird akzeptiert; B: `TokenUser` ist auch elevated der
  Benutzer). Nebenfrage beantwortet: kein Reader ruft `verify_owner_only`
  (einzige Aufrufstelle ist `restrict_handle`; geprüft per grep über
  `src-tauri/src`).
- **S-F2 = G-F5 (hoch, „probable"). Angenommen**, siehe oben. Hinweis auf den
  elevated Windows-Runner der Merge-Queue ist der entscheidende Punkt.
- **S-F3 = G-F6 (mittel). Angenommen**, Retry-Schleife wie oben; die Datei-
  Seite (breiter Deskriptor beim Start) bekommt dieselbe Behandlung.
- **S-F4 = G-F2 (mittel). Angenommen**, siehe oben.
- **S-F5 (mittel/niedrig): Elternverzeichnis des breiten Deskriptors bleibt
  weit offen; Reader prüfen keinen Owner. Verifiziert, Follow-up/Eskalation.**
  Reader-seitige Verifikation existiert nicht (grep-Beleg oben); die
  Vertrauensgrenze des Datenverzeichnisses zu ziehen ist eine
  Architektur-Entscheidung über diesem Paket → „Offene Punkte" für den
  Koordinator.
- **S-F6 (mittel/niedrig): Die Fehler-Injektion `FAIL_NEXT_RESTRICT` wird jetzt
  vom Verzeichnis-Schritt konsumiert — stiller Abdeckungsverlust. Verifiziert
  und angenommen.** `restrict_handle` (`credential_acl.rs:170`) prüft das Flag;
  der neue Verzeichnis-Schritt läuft zuerst und frisst es, sodass
  `a_failed_restriction_leaves_no_descriptor_and_no_grant` nicht mehr den
  Datei-Aufräumpfad beweist. Fix: das Flag wandert in den Datei-Pfad
  (`restrict_to_current_user`), das Verzeichnis bekommt ein eigenes
  `FAIL_NEXT_DIRECTORY_RESTRICT`; zwei Tests pinnen die Naht (Verzeichnis-
  Restrict darf das Datei-Flag nicht konsumieren; Verzeichnis-Fehler lässt
  keinen Grant zurück).
- **S-F7 (niedrig/mittel): Testlücken. Teilweise angenommen** — neu in dieser
  Runde: (a) Injektions-Test für den breiten Deskriptor (fehlgeschlagene
  Verengung hinterlässt kein Token), (b) Selbstheilungs-Test (vorab weit
  angelegte Datei/Verzeichnis werden verengt), (c) Vererbungs-Flags-Pin im
  Orakel, (d) Inhaltserhalt bei abgelehnter Verengung (Owner vor Truncate).
  Nicht in diesem Paket: Elevations-Matrix gegen echte Objekte (braucht
  `SeTakeOwnership`) und Concurrency-Stress — Follow-up.
- **S-F8 = G-F4 plus zwei Zusätze (niedrig).** Verzeichnis-Teil angenommen
  (siehe G-F4). Die Zusätze „breiter Deskriptor auf Unix liegt kurz mit
  umask-Modus auf der Platte" und „kein Owner-/Symlink-Check auf Unix" sind
  **vorbestehend** und kein Delta dieses PR — als Follow-up notiert, nicht
  hier umgesetzt (Unix-Schreibpfad ist bewusst unverändert, PR-Text:
  „Unix bleibt unverändert").
- **S-F9 (niedrig): Doku sagt „user-only" stärker zu als es unter Elevation
  gilt. Angenommen als Dokumentation:** der Modul-Kommentar nennt den
  Trade-off (Administrators-Eigentum = „Benutzer plus lokale Admins", die
  ohnehin Ownership nehmen könnten).

## Zusammenfassung der Umsetzung

Angenommen und umgesetzt (red-first, Commits auf dem Branch):
Owner-Menge {TokenUser, TokenOwner, Administrators} + Owner-Prüfung vor dem
Kürzen (G-F1/S-F1/S-F9-Doku), Orakel angleichen + Vererbungs-Pin (G-F5/S-F2),
Reparse-/Hardlink-Ablehnung (G-F2/S-F4), Retry bei Sharing-Verletzung
(G-F6/S-F3), getrennte Injektions-Nähte (S-F6), Unix-Verzeichnis fail-closed
(G-F4/S-F8), neue Tests aus S-F7 (a-d).

Abgelehnt: G-F7 (Windows-`make_private` ist nachweislich no-op),
Auto-Delete bei fremdem Eigentümer (Fail-closed ist Design).

Follow-ups für den Koordinator: Verzeichnis-Handle über die Kind-Erzeugung
halten (G-F3), Vertrauensgrenze Elternverzeichnis + Reader-seitige
Owner-Prüfung (S-F5), Elevations-Matrix-/Concurrency-Tests (Rest S-F7),
Unix-Schreibfenster des breiten Deskriptors (Rest S-F8).

Weil angenommene Fixes die geprüfte Substanz ändern, folgt nach AGENTS.md
(„Evidence is bound to the actual candidate … review the delta again") eine
Delta-Review-Runde beider Reviewer auf den Fix-Diff; ihre Disposition steht
unter „Delta-Runde" weiter unten.

## Delta-Runde

Kandidat der Delta-Review: `c2b26f3` (Fix-Diff gegen `0acbaac`). Prompt:
`.pa/review_prompt_pr12_delta.md`; Antworten unverändert in
`.pa/review_pr12-delta_grok.md` (xAI Grok) und
`.pa/review_pr12-delta_sonnet.md` (Claude Sonnet). Beide Urteile: **approve
with conditions**. Umsetzung red-first: Test-Commit `8177744`, Fix `e6742ad`.
Beide Reviewer bestätigen: die Owner-Menge {TokenUser, TokenOwner,
Administrators} lässt kein fremdes Nicht-Admin-Konto durch; die neue
Reihenfolge (öffnen ohne Kürzen, Links, Owner, DACL, dann Schreiben) ist
schlüssig.

- **gD1 (mittel): `nNumberOfLinks > 1` an Verzeichnissen. Abgelehnt mit
  Messung.** Behauptet: NTFS zähle bei Verzeichnissen 1 + Unterverzeichnisse.
  Der Test `a_subdirectory_inside_the_credential_directory_is_not_a_hard_link`
  legt ein Unterverzeichnis an und ist auf `c2b26f3` grün: Windows meldet für
  ein Verzeichnis einen Link. Kein Fix nötig; der Test bleibt als Pin.
- **gD2 (mittel): Verzeichnis-Handle ohne `FILE_READ_ATTRIBUTES`. Angenommen**
  (`e6742ad`). Der Test `a_restricted_directory_passes_the_same_check` und die
  Verzeichnis-Tests belegen, dass der Aufruf funktioniert; die Berechtigung
  ist jetzt ausdrücklich angefordert.
- **gD3 = sD4 (mittel/niedrig): Verzeichnis ohne Owner-Vorprüfung. Angenommen**
  (`e6742ad`): `verify_owned` läuft vor `restrict_handle`.
- **gD4 = sD2 (mittel): jeder Reparse-Punkt wird abgelehnt. Angenommen**
  (`e6742ad`): `refuse_links` liest das Tag (`FileAttributeTagInfo`) und
  lehnt nur Name-Surrogate ab (Symlink, Junction, LX-Symlink); Cloud-
  Platzhalter und Kompression bleiben zulässig. Pin:
  `a_junction_at_the_credential_directory_is_refused`.
- **gD5 (mittel): Test-Modul importiere `WinWorldSid` u. a. nicht. Abgelehnt:**
  `mod tests` importiert `CreateWellKnownSid`, `WinWorldSid`,
  `SECURITY_MAX_SID_SIZE` und `OpenOptionsExt` ausdrücklich (`use super::*`
  plus eigene Imports); der Test-Build läuft (27/27 grün).
- **gD6 = sD8 (niedrig): Unix-`make_private_checked` folgt Symlinks, `mkdir`
  mit umask. Follow-up.** Unix-only, hier nicht kompilier- und damit nicht
  red-first belegbar (KI-7, kein WSL2); vorbestehendes Verhalten der Unix-
  Bahn.
- **gD7 (niedrig) / sD6 Teil 3: leere Datei bleibt nach fehlgeschlagener
  Verengung. Angenommen** (`e6742ad`): eine selbst angelegte Datei wird bei
  Fehler wieder entfernt (`create_new` unterscheidet neu/vorhanden). Rot:
  `a_failed_first_write_leaves_no_empty_descriptor` (`8177744`). Der andere
  Teil (bereits vorhandene Datei nach `set_len`-Fehler) bleibt: kleineres
  Fenster als Kürzen beim Öffnen, dokumentiert.
- **gD8 / sD7 (niedrig/mittel): Testlücken. Angenommen, soweit belegbar:**
  Junction-Test, Inheritance-Pin am Kind
  (`a_child_inherits_only_the_user_grant_from_the_narrowed_directory`; die
  Messung zeigt, dass der Kernel `INHERITED_ACE` nicht setzt, der Pin
  vergleicht daher die ACE-Liste), Issuer-Test für den Verzeichnis-Fehler
  (`a_failed_directory_restriction_aborts_the_issuance`), SID-Bytes-Pin
  `the_administrators_sid_is_s_1_5_32_544` (feste Bytes, kein
  `ConvertStringSidToSidW`, das Feature `Win32_Security_Authorization` bleibt
  aus). Timing-Marge des Retry-Tests (300 ms gegen 1 s) und Elevations-Matrix
  → Follow-up / NICHT ABGEDECKT.
- **sD1 (niedrig): Administrators ohne Gruppenprüfung akzeptiert. Akzeptiertes
  Restrisiko:** ein Admin oder SYSTEM könnte die Datei ohnehin übernehmen; im
  Modulkommentar dokumentiert.
- **sD3 (niedrig): Verzeichnis-Handle über die Kind-Erzeugung halten.
  Follow-up** (= G-F3), ebenso Elternkomponenten ungeprüft.
- **sD5 (niedrig): Delete-Pending als Access-Denied, blockierendes Sleep.
  Follow-up:** die Ausstellung läuft auf Worker-Threads (nicht im
  Async-Runtime-Pfad); Delete-Pending bleibt fail-closed.
- **sD6 Teil 1/2 (niedrig): Fehlertexte ohne Pfad/Hinweis, alte weite ACL bei
  echtem Verengungsfehler. Follow-up:** Verfügbarkeit gegen Exposition ist
  bewusst; Text nachschärfen ist kosmetisch.
- **sD9 (nit): Review-IDs in Kommentaren. Angenommen** (`e6742ad`): aus dem
  Code entfernt, die IDs stehen nur hier.

Offene Punkte für den Koordinator: G-F3/sD3 (Handle-relative Kind-Erzeugung),
S-F5 (Vertrauensgrenze Elternverzeichnis, Reader-Owner-Prüfung), gD6/sD8
(Unix-Symlinks und umask), Elevations-Matrix und Concurrency-Tests, Linux-Bahn
(`#[cfg(unix)]`-Teil) nur über CI.
