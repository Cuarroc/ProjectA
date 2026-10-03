# Drei kleine Aufgaben für ProjectA

Diese Vorlagen helfen Einsteigern, einem Agenten eine kleine, klar begrenzte
Aufgabe zu geben. Kopiere eine Vorlage, fülle die Platzhalter aus und lege die
Aufgabe zusammen mit dem ausgefüllten Beispiel in den Auftrag.

Für jede Aufgabe gilt: Der Agent arbeitet red-first, wenn sich das Problem mit
einem Test absichern lässt. Änderungen werden als Draft-PR vorgeschlagen. Der
Agent darf keine pauschale Freigabe zum Löschen, Installieren oder Ausgeben von
Geld annehmen. Solche Aktionen sind ausdrücklich nicht freigegeben; bei Bedarf
stoppt er und fragt nach einer Entscheidung.

## 1. Kleinen Fehler mit Test beheben

**Ziel:** Behebe den kleinen Fehler in `<kurze Beschreibung>` und sichere die
Korrektur mit einem Test ab.

**Rahmen:** Arbeite nur in `<Datei oder kleinem Bereich>`. Ändere keine
Nahtstelle und keine Abhängigkeit, sofern der Auftrag das nicht ausdrücklich
nennt. Entferne keine Daten oder Dateien und installiere nichts.

**Abnahmekriterium:** Führe `<Befehl für den Regressionstest>` aus; der neue
Test schlägt auf dem Ausgangsstand fehl und besteht nach der Korrektur. Danach
zeigt `<Befehl für die betroffene Prüfung>` den erwarteten grünen Abschluss.

**Abbruchgrenze:** Stoppe und frage nach, wenn die Ursache außerhalb des
genannten Bereichs liegt, mehr als `<Zahl>` Dateien betroffen wären, ein
bestehender Test geändert werden müsste oder Löschen, Installieren oder Geld
freigegeben werden soll.

**Beispiel für ProjectA:**

> **Ziel:** Behebe den kleinen Fehler, dass eine ungültige Eingabe im
> ausgewählten Parser als Erfolg behandelt wird, und sichere ihn mit einem
> Regressionstest ab.
>
> **Rahmen:** Arbeite nur in `src-tauri/src/parse.rs` und dessen Inline-Tests.
> Keine Änderungen an den vier Nahtstellen, an Cargo-Abhängigkeiten oder an
> gespeicherten Daten.
>
> **Abnahmekriterium:** Führe `cargo test -p projecta parse::tests` aus; der
> neue Test für die ungültige Eingabe ist auf dem Ausgangsstand rot und besteht
> nach der Korrektur. Danach besteht `bash scripts/ci/gates.sh lane prepush`
> mit Exit-Code 0.
>
> **Abbruchgrenze:** Stoppe und frage nach, wenn mehr als die genannte Datei
> und ihre Tests nötig sind oder eine Änderung am Datenmodell, an einer
> Nahtstelle, eine Installation, Löschung oder Geldfreigabe erforderlich wird.

## 2. Text oder Übersetzung in der Oberfläche ändern

**Ziel:** Ändere den sichtbaren Text `<bisheriger Text>` zu `<neuer Text>`, damit
`<gewünschte Bedeutung>` klar verständlich ist.

**Rahmen:** Arbeite nur in `<UI-Datei, Übersetzungsdatei oder UI-Bereich>`.
Verändere keine Logik, keine Tastaturkürzel, keine Farben und keine
Abhängigkeiten. Entferne keine Dateien und installiere nichts.

**Abnahmekriterium:** Führe `<UI-Testbefehl>` aus; er endet mit Exit-Code 0.
Zusätzlich ist in der betroffenen Ansicht sichtbar, dass `<neuer Text>` an der
richtigen Stelle erscheint und der Text nicht abgeschnitten ist.

**Abbruchgrenze:** Stoppe und frage nach, wenn der Text an mehr als
`<Zahl>` Stellen geändert werden müsste, eine Übersetzung unklar ist, Logik
geändert werden müsste oder Löschen, Installieren oder Geld freigegeben werden
soll.

**Beispiel für ProjectA:**

> **Ziel:** Ersetze in der HQ-Ansicht die Einsteiger-Beschriftung „Run“ durch
> „Aufgabe starten“, damit klar ist, was der Knopf auslöst.
>
> **Rahmen:** Arbeite nur in der zugehörigen HQ-Übersetzungsdatei und dem
> bereits vorhandenen Beschriftungstest. Keine Logik-, Layout- oder
> Abhängigkeitsänderung, keine Installation und keine Löschung.
>
> **Abnahmekriterium:** Führe `npm test -- --run` aus; der Befehl endet mit
> Exit-Code 0. In der betroffenen HQ-Ansicht ist sichtbar „Aufgabe starten“ zu
> lesen, vollständig und an derselben Stelle wie zuvor „Run“.
>
> **Abbruchgrenze:** Stoppe und frage nach, wenn die Änderung weitere Ansichten
> oder Logik berührt, eine Übersetzung nicht eindeutig ist oder eine
> Installation, Löschung oder Geldfreigabe nötig erscheint.

## 3. Dokumentationsabschnitt aktualisieren

**Ziel:** Aktualisiere den Abschnitt `<Überschrift>` in `<Dokument>` so, dass
`<konkrete Information>` für Einsteiger richtig und verständlich ist.

**Rahmen:** Arbeite nur in `<Dokument>` und, falls ausdrücklich genannt, in
`<zweitem Dokument>`. Ändere keinen Programmcode und keine Konfiguration.
Lösche keinen Abschnitt pauschal, installiere nichts und gib kein Geld frei.

**Abnahmekriterium:** Führe `<Dokumentationsprüfung>` aus; sie endet mit
Exit-Code 0. Prüfe außerdem, dass der aktualisierte Abschnitt den genannten
Befehl und das erwartete Ergebnis enthält.

**Abbruchgrenze:** Stoppe und frage nach, wenn die Information nicht aus dem
Repository belegt werden kann, mehr Dokumente als genannt betroffen wären,
Code geändert werden müsste oder Löschen, Installieren oder Geld freigegeben
werden soll.

**Beispiel für ProjectA:**

> **Ziel:** Aktualisiere den Abschnitt „Lokale Gates“ in `docs/ci-lokal.md`,
> damit Einsteiger wissen, wie sie vor dem Push den vollständigen Nachweis
> ausführen.
>
> **Rahmen:** Arbeite nur in `docs/ci-lokal.md`. Kein Code, keine CI-
> Konfigurationsänderung und keine Änderung an anderen Dokumenten.
>
> **Abnahmekriterium:** Führe `bash scripts/ci/gates.sh --list` aus; der Befehl
> endet mit Exit-Code 0. Der Abschnitt nennt außerdem
> `bash scripts/ci/gates.sh lane prepush` und erklärt, dass ein erfolgreicher
> Lauf mit Exit-Code 0 endet.
>
> **Abbruchgrenze:** Stoppe und frage nach, wenn die tatsächliche Gate-Liste
> nicht aus dem Repository hervorgeht, weitere Dokumente nötig wären, Code
> geändert werden müsste oder eine Löschung, Installation oder Geldfreigabe
> verlangt wird.
