# Entwurf „Glass Leitstand“ (ProjectA 2.0)

24 Bildschirme des Zielbilds für v2.0, Stand 06.10.2026. Sie ersetzen die vier
Richtungen eine Ebene höher (`direction-a` bis `-d`) als Vorlage.

- Jede `*.dc.html` ist ein Board aus dem Design-Werkzeug; Listen und Zustände
  sind als Vorlagen-Syntax (`sc-for`, `{{ … }}`) geschrieben und rendern nicht
  eigenständig im Browser. Für Text, Aufbau, CSS-Tokens und Regeln sind sie
  vollständig lesbar.
- `canvas.json` ordnet die Boards in sechs Reihen.
- Der gemeinsame Block (Tokens, Seitenleiste, Kopfzeile, Bewegung) ist in jedem
  Board identisch; das Fundament-Paket überführt ihn in die App.
- Alle Zahlen, Namen und Beträge sind Beispieldaten.

Die Bestandsaufnahme je Teil steht in `docs/plan/v2.0/inventory.md`.
