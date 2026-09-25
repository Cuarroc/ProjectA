# Review-Disposition W2-10a

Reviewer: GLM 5.2 (`glm-5.2:cloud`, Ollama Cloud) — nicht die Autorenfamilie
(Autor: Kimi K3). Kandidat: `02e6101`, Delta nach Nacharbeit: `ae41907`.
Review-Protokoll: `.pa/review_w2-10a_glm-5.2.md`. Urteile: approve / approve.

## Befunde und Disposition

| ID | Schwere | Befund | Disposition |
|---|---|---|---|
| F1 | low | g-Key-Test hängt still am Default von `#live-keys-enabled` | **angenommen**, Commit `ae41907`: Test assertet den Default explizit vor dem Dispatch |
| F2 | low | Fokus auf Submit-Button ohne `name` ging bei Rebuild verloren (`part='button'` matcht nichts) | **angenommen**, Commit `ae41907`: Buttons → `part='submit'`, Restore via `button[type="submit"]`; neuer Test war rot gegen den Pre-Fix-Stand (`node --test --test-name-pattern="submit button"` → Exit 1) und ist grün |
| F3 | low | `teams`-Zuweisung im Diff nicht sichtbar — ginge die Signatur bei Team-Änderung nicht mit? | **abgelehnt mit Grund**: `teams` wird in `refresh()` (continuous.js, Zuweisung aus `effectiveLimits.rootPolicies`) vor der Signaturberechnung gesetzt; die Signatur enthält `teams`, Team-Änderungen lösen den Rebuild aus. Im Quelltext verifiziert. |
| F4 | low | Unbekannter/fehlender Goal-Status gilt als „laufend" | **abgelehnt mit Grund**: bewusstes Design — „unbekannt ≠ geschlossen" folgt dem Belegstandard (nichts wird als erledigt angenommen, das nicht belegt ist); der Status wird als `unbekannt` angezeigt. |

## Delta-Review (ae41907), Info-Notizen

- D-F1/D-F2/D-F3 (info): korrekte Selektoren, Attribut-Selektor-Falle bei
  künftigen ungetypten Buttons, Erste-Treffer-Regel bei mehreren Submits —
  **zur Kenntnis**, keine Aktion; als Folgearbeit notiert, falls ein
  Zuweisungsformular je mehrere Submit-Buttons bekommt.
- D-F4 (low): Test-Soundness bestätigt — keine Aktion.
- D-F5 (info): Assertion-Platzierung korrekt — keine Aktion.

Nach der Nacharbeit wurde das Delta erneut reviewt (Regel: neue Evidenz an
den geänderten Kandidaten binden). Stand danach: zwei Urteile „approve",
keine offenen Befunde.
