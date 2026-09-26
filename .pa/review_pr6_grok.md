Ich lese zuerst `review_prompt_pr6.md` und richte das Review exakt nach dem dort geforderten Format aus.Der Prompt verlangt ein reines Diff-Review. Ich prüfe die belastenden Aussagen und die Wartebedingung am Quellstand, ohne etwas zu schreiben.Der Commit `b518cd7` liegt im öffentlichen Checkout. Ich gleiche die README-Behauptungen und die Wartebedingung nur lesend dagegen ab.Die Testnamen existieren. Als Nächstes prüfe ich die Status-Aussagen, die ein Leser für „funktioniert“ halten könnte.PR #6 ist so nicht mergebar. Ein Befund ist blocking: der Getting-started-Satz über Installer widerspricht dem Release-Workflow im selben Stand `b518cd7`.

## Befunde

### 1. Installer werden öffentlich angeboten
**Schwere:** blocking  
**Beleg:** `README.md:104`

Der Satz „Signed installers are built for the maintainer's own machine; they are not offered or supported for other users.“ ist falsch. `.github/workflows/release.yml:116` beschreibt den öffentlichen Update-Kanal. Der Job lädt das signierte NSIS-Setup nach `Cuarroc/ProjectA-updates` (`release.yml:195`) und gibt es anonym als Latest frei (`release.yml:263`, `gh release edit … --prerelease=false --latest`). `src-tauri/tauri.conf.json` zeigt mit `createUpdaterArtifacts: true` auf genau diesen Kanal. Gebaut wird auf `windows-latest` in GitHub Actions, nicht auf der Maschine des Maintainers. Die Stufe-A-Disposition schließt den alten Befund „no public installer“, ohne diese neue Formulierung noch einmal gegen `release.yml` zu prüfen.

**Fehlerszenario:** Eine Leserin folgt „build from source“ und hält den öffentlichen Setup für nicht existent. Parallel lädt jede installierte App Updates von `https://github.com/Cuarroc/ProjectA-updates/releases/latest/download/latest.json`, und derselbe Release enthält `ProjectA_<version>_x64-setup.exe` ohne Anmeldung.

**Fix-Vorschlag:** Den Satz durch den tatsächlichen Kanal ersetzen: CI baut bei einem `v*`-Tag signierte Windows-Installer und veröffentlicht sie auf dem öffentlichen Spiegel `Cuarroc/ProjectA-updates`; dieses Repo unterstützt keine Installation für Dritte; der vorgesehene Weg hier bleibt der Build aus den Quellen. „Not supported“ kann bleiben, „not offered“ nicht.

### 2. Team-Rollen sind gleichzeitig „partial“, „planned“ und „geplant“
**Schwere:** medium  
**Beleg:** `README.md:47` (Widerspruch zu `README.md:58` und `README.md:170`)

Zeile 28 definiert nur „works“. „partial“ bleibt ohne Definition. Die Tabellenzeile nennt Team-Rollen „partial“ und zitiert einen Test, der Nachweis wirkt wie eine laufende Funktion. Dieselbe Zeile sagt, die Rollen seien nur über den ausgeschalteten Continuous Mode erreichbar. Die Vision führt dieselben Rollen als „planned“ (`README.md:58`). Der deutsche Absatz sagt „Agenten-Teams mit Rollen, abgestufte Freigaben und der Dauerbetrieb sind geplant“ (`README.md:170`). Der Code stützt die engere Lesart: Zuweisungen hängen an `continuous_tasks`, und `development_policy.rs` lehnt `continuous.enabled = true` ab.

**Fehlerszenario:** Eine englische Leserin startet die App, sucht Koordinator und Integrator und findet nichts Bedienbares. Eine deutsche Leserin erwartet reines Zukunftsmaterial und übersieht, dass der Code schon da ist, aber hinter dem gesperrten Dauerbetrieb liegt.

**Fix-Vorschlag:** In der Tabelle einen Status verwenden, der die Sperre trägt, zum Beispiel „planned — locked off“, mit dem bestehenden Satz, dass der Weg nur über Continuous Mode führt. Im deutschen Absatz die drei Dinge trennen: Rollen sind implementiert und nur über den gesperrten Dauerbetrieb erreichbar; abgestufte Freigaben fehlen; Continuous Mode ist im Code gesperrt. „partial“ in Zeile 28 in einem Satz definieren.

### 3. Das Diagramm legt die lokale API außerhalb der App
**Schwere:** medium  
**Beleg:** `README.md:77`

`api::start` bindet in demselben Prozess einen ephemeren Port auf `127.0.0.1` (`src-tauri/src/api.rs`, `SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)`). `pa` und das Dev-HQ sind Clients dieses Listeners. Das Diagramm zeichnet die API außerhalb der Teilgraphen „ProjectA desktop app“ und einen HTTP-Pfeil vom Core zur API.

**Fehlerszenario:** Jemand sucht einen separaten API-Dienst, den er neben der Desktop-App starten oder absichern muss, und öffnet dafür einen Port, den es als eigenen Prozess nicht gibt.

**Fix-Vorschlag:** Die API in den App-Teilgraphen neben den Core setzen. Pfeile von `pa` und vom Dev-HQ zur API, mit der Beschriftung „HTTP 127.0.0.1, Token“. Der Core spricht nicht per HTTP mit seiner eigenen API.

### 4. Der Beleg für die `pa`-Brücke zeigt auf den falschen Test
**Schwere:** medium  
**Beleg:** `README.md:41`

Die Zeile verlangt für „works“ den Test `hq_changes_require_auth_project_and_valid_cursor` in `bin/pa.rs`. Die Funktion steht in `src-tauri/src/api.rs:4149`. Sie ruft per HTTP `/api/hq/v1/changes` und einen ungültigen Context-Query auf. Sie startet `pa` nicht und trifft `/api/hq/v1/runtime` nicht. `pa hq runtime` ist in `src-tauri/src/bin/pa.rs:378` ein GET auf genau diese Runtime-Route; die Tests dort prüfen nur den Parser (`parse("hq runtime")` bei Zeile 3816).

**Fehlerszenario:** Wer den genannten Test öffnet, findet ihn in `bin/pa.rs` nicht. Wer ihn in `api.rs` findet, hat den HTTP-Vertrag geprüft und den CLI-Brückensatz der Zeile damit nicht belegt. Nach der eigenen Regel in `README.md:28` ist „works“ für die Brücke damit nicht eingelöst.

**Fix-Vorschlag:** Die API-Zeile auf `api.rs` und diesen Test stützen. Für `pa hq runtime` / `pa hq context` einen Test nennen, der das Kommando ausführt oder wenigstens die Zuordnung `HqRuntime` → `/api/hq/v1/runtime` prüft. Liegt nur der Parser-Test vor, die Brücke nicht als „works“ führen.

### 5. Die Wartebedingung ist bei fehlendem Panel wahr
**Schwere:** low  
**Beleg:** `scripts/lib/hq-visual.browser.mjs:247`

```javascript
() => !document.querySelector("#worker-detail")?.textContent?.includes("Loading…")
```

Fehlt `#worker-detail`, liefert die optionale Kette `undefined`, und `!undefined` ist `true`. `waitForFunction` gilt dann als erfüllt. Sichtbarkeit wird nicht erneut geprüft. Der Platzhalter `Loading…` (Auslassung U+2026) steht in `docs/dev-hq/hq.js` nur kurz in `#detail-facts` und wird im selben Schritt ersetzt, in dem „Inspecting queue.rs“ und „wk-dispatcher“ geschrieben werden. Die beiden `assert.match` danach fangen den heutigen Fixture-Fall ab. Enthält ein geladenes Feld später selbst `Loading…`, läuft die Warte bis zum Timeout, obwohl der Inhalt da ist.

**Fehlerszenario:** Das Panel wird entfernt oder der Selektor trifft nichts. Die Warte kehrt sofort zurück. `page.textContent("#worker-detail")` ist `null`, und `assert.match` wirft einen TypeError statt einer klaren Warte-Meldung. Wechselt der Platzhalter auf drei ASCII-Punkte, ist `includes("Loading…")` sofort falsch, und die alte Race auf den noch leeren Inhalt ist wieder da.

**Fix-Vorschlag:** Auf den erwarteten Inhalt warten und ein fehlendes oder verstecktes Panel als nicht fertig werten:

```javascript
() => {
  const el = document.querySelector("#worker-detail");
  if (!el || el.hidden) return false;
  const text = el.textContent ?? "";
  return text.includes("Inspecting queue.rs") && text.includes("wk-dispatcher");
}
```

### 6. Der zitierte Gate-Marker heißt anders
**Schwere:** low  
**Beleg:** `README.md:91`

Der Text setzt „NOT COVERED“ in Anführungszeichen. `scripts/ci/gates.sh:213` druckt `--- NICHT ABGEDECKT von diesem Lauf ---`.

**Fehlerszenario:** Jemand sucht im Gate-Log nach `NOT COVERED`, findet die Zeile nicht und hält den Lauf für unvollständig.

**Fix-Vorschlag:** Die deutsche Zeile wörtlich zitieren.

## Geprüft und tragfähig

Die in der Status-Tabelle genannten Testfunktionen existieren an den genannten Modulen, mit der Ausnahme in Befund 4. Continuous Mode lehnt `continuous.enabled = true` ab. Cancel eines bereits dispatchten Tasks ist in `docs/PLAN.md` (W1-05b) als 409 beschrieben. Der Vault-Satz (DPAPI unter Windows, sonst Klartext mit Modus 0600) steht so in `providers.rs`. React `^18.3.1`, Rust `1.89`, die Ports 1420 und 4173, sqlx/sqlite, xterm und die vier seriellen Nahtstellen in `STAND.md` stimmen. Eine `LICENSE`-Datei gibt es nicht; der Abschnitt „all rights reserved“ widerspricht nichts im Diff, und der Diff übernimmt keinen fremden Text.

`npm run dev:agent-check` fehlt im neuen README. Das ist für die Kurzfassung stimmig: der Status-Tabelle bleiben `pa hq runtime` und `pa hq context`, und `AGENTS.md` sowie `docs/setup/README.md` nennen `dev:agent-check` weiter.

Blocking ist nur Befund 1.

**mergebar nein**
