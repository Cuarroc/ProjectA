# Bestandsaufnahme Hauptfenster (UI v2, Phase 1)

Stand 06.10.2026, Basis `main` 469505c. Nur Design, kein App-Code.

## Was heute schwach ist

1. **Keine eigene Farbe, keine Verbindung zum Dev HQ.** Der Akzent ist Systemblau
   `#0a6cdd` (`src/styles.css:57`), das HQ arbeitet mit Minze `#82d5b4` auf
   `#0b1013` (`docs/dev-hq/workspace.css:3-6`). App und Cockpit sehen aus wie zwei Produkte.
2. **Zustandsfarben widersprechen sich.** In der App heißt Grün „bereit zum Mergen“
   (`src/styles.css:165`), im statischen HQ heißt Grün „fertig“ und „bereit zum
   Mergen“ ist Orange (`docs/dev-hq/hq.css:497-500`), im HQ-Live wieder Grün
   (`docs/dev-hq/workspace.css:57`). Dasselbe Grün bedeutet je nach Fenster etwas anderes.
3. **Eine Typo-Skala ohne Stimme.** 10,5 / 11 / 12 px (`src/styles.css:102-104`), dazu
   Versalien-Labels mit Sperrung für Marke und Abschnitte (`src/styles.css:933-941`,
   `:966-975`) und Badges in Kleinbuchstaben mit 10,5 px (`src/styles.css:1331-1336`).
   Nichts führt das Auge; alles ist gleich laut und gleich klein.
4. **Worker-Zeile sagt zu wenig.** Aufgabe hart auf 40 Zeichen gekürzt
   (`src/components/WorkerPanel.tsx:102`), Zustand nur als Badge; keine Laufzeit, kein
   „seit wann wartet er auf mich“, keine Sortierung nach Dringlichkeit.
5. **Sprachmix.** Die Worker-Liste spricht Englisch („New worker“, „No project selected.“,
   `src/components/WorkerPanel.tsx:63-80`), die Seitenleiste daneben Deutsch
   (`src/components/Sidebar.tsx:198-242`).
6. **Aktiver Tab kaum erkennbar.** Nur eine 1-px-Linie oben (`src/styles.css:2697-2701`).
7. **Statusleiste ohne die Zahlen, die zählen.** 24 px, 12 px Text (`src/styles.css:3002-3015`);
   zeigt Sitzung, Wartende, „blockiert“, OmniRoute, aber weder Kontingent je Anbieter
   noch freien RAM, Warteschlange oder cargo-Slots (`src/components/StatusBar.tsx:28-88`).
   Der Provider-Knopf ist ein Emoji (`src/components/StatusBar.tsx:56-65`).
8. **Antworten kostet einen Kontextwechsel.** Eine Frage eines Workers wird nicht dort
   beantwortet, wo man sie liest; der Weg führt über Board bzw. Fragen-Ansicht.

## Was die Dev-HQ-Sprache trägt

- Dunkler Grund `#0b1013`, Fläche `#131b20`, sichtbare Haarlinien `#35464d`, Minze für
  Auswahl, zurückhaltendes Amber für Signale (`docs/dev-hq/workspace.css:3-6`).
- Segoe UI, tabellarische Ziffern, **Zahlen animieren nie** (`docs/dev-hq/DESIGN.md`).
- Panels scrollen einzeln, Navigation und Verbindungsstatus bleiben stehen.
- Recursive als HQ-Schrift (`docs/dev-hq/hq.css:3-9`), Studio-Tokens mit Hell/Dunkel per
  `light-dark()` und eigener Kontrastprüfung (`docs/dev-hq/concepts/studio-tokens.css`).

## Frühere Entwürfe (nicht im öffentlichen Repo, nur zitiert)

- `docs/ui-variants/` (28.08.): Der Nutzer wählte **Variante B „Konversation“**:
  Befehls-Chat als Hauptfläche, Board als schmale Leiste, Fragen als Karten im Strom.
- `docs/design/2026-08-29-apple/` (Branch `design/apple`, 29.08.–02.09., nie gemergt):
  verbindlicher Vertrag „Xcode-dicht nach Richtung B“ (`RICHTUNG.md`): Inter, Systemblau,
  Zeilen ≥ 26 px, angeheftetes Queue-Band, Zustand = Form + Verb + Farbe mit sechs
  Zuständen working / needs / review / merge / done / danger über `--state-fg/--state-bg`.
- Im Repo: `docs/design/2026-09-dev-hq/` (HQ-Richtungen A–D, umgesetzt als
  `kombination-bc`) und `docs/dev-hq/concepts/hq2-studio.html`.

## Empfehlung Nummer eins, unabhängig von der Richtung

**Ein gemeinsames Zustandsvokabular und ein Token-Satz für App und HQ.** Alle vier
Mockups nutzen bereits dieselbe Grammatik (Form + Wort + Farbe):

| Zustand | Wort | Form | Farbe |
|---|---|---|---|
| working | Arbeitet | voller Punkt | Blau (Information) |
| needs | Wartet auf dich | Raute | Amber |
| error / danger | Fehler | Kreuz | Ember |
| merge | Bereit zum Mergen | Haken | Minze/Grün |
| review | In Review | halber Kreis | Violett |
| paused | Pausiert | zwei Balken | neutral |
| idle / done | Bereit | Ring | neutral |

Grün heißt damit überall „bereit/geht weiter“, nie „fertig“. Abweichung vom Vertrag
vom 29.08.: working ist ein voller Punkt statt offener Ring, weil der Ring „ruht“
bedeutet.
