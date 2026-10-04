# Disposition zu Review setup-09-protocol-collision (SETUP-09)

Kandidat: 1cbe02b (fix) + ae5a66b (roter Test), geprueft mit
`bash scripts/review/run-local.sh --label setup-09-protocol-collision`
(kimi-k3:cloud, glm-5.2:cloud, 04.10.2026). Protokolle:
`.pa/review_setup-09-protocol-collision_kimi-k3.md`,
`.pa/review_setup-09-protocol-collision_glm-5.2.md`.

| ID | Quelle | Schwere | Befund | Disposition |
|----|--------|---------|--------|-------------|
| kimi F1 | kimi-k3 | low | `tr -c` arbeitet byteweise, `slug()` im Transport zeichenweise - bei UTF-8 koennten zwei Namen im Guard verschieden, auf der Platte gleich sein | Angenommen (Folgecommit): fail-closed, Modellname ausserhalb `A-Za-z0-9._:/-` wird mit Exit 2 abgelehnt statt umgeschrieben; Testfall mit Leerzeichen gepinnt |
| kimi F2 | kimi-k3 | low | Vergleich case-sensitiv, NTFS/APFS nicht - `Llama3:8b` und `llama3:8b` kollidieren auf der Platte | Angenommen (Folgecommit): Vergleich laeuft ueber die Kleinbuchstabenform (`tr '[:upper:]' '[:lower:]'`, portabel auch unter bash 3.2) |
| kimi F3 | kimi-k3 | low | Der Check feuert auch bei `--dry-run`, wo keine Kollision entstehen kann | Angenommen als bewusste Entscheidung: frueh scheitern; jetzt im Selbsttest gepinnt und in `docs/setup/ollama-reviewers.md` beschrieben |
| kimi F4 | kimi-k3 | low | Geschwisterfaelle des Fixes ungetestet (exaktes Duplikat, `:cloud`-Kollision) | Angenommen (Folgecommit): `:cloud`-Kollision neu gepinnt; das exakte Duplikat war bereits gepinnt (`scripts/test-review-local.sh`, Fall 11) |
| glm F1 | glm-5.2 | low | derselbe Fall wie kimi F1, case-insensitive Dateisystem | Angenommen (Folgecommit), siehe kimi F2 |
| glm F2 | glm-5.2 | low | Kommentar behauptet Gleichheit mit `slug()`, im Diff nicht pruefbar | Angenommen (Folgecommit): die Gleichheit gilt jetzt nur noch fuer den vorher geprueften ASCII-Zeichensatz, wo `tr -c` und `re.sub` dieselbe Regel anwenden; ausserdem uebernimmt run-local.sh den fertigen Namen, den der Transport nicht mehr umschreibt |

Runde 2 mit dem externen Paar: entfaellt - Regel 5 verlangt sie nur bei einem
Befund hoher Schwere, hier sind alle sechs low. Der Delta-Nachweis ist
`bash scripts/test-review-local.sh` (29 Faelle, Exit 0).