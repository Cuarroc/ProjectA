# Review-Disposition PR #17 (Stufe B)

Kandidat: `60f0f6a5cfa230216d3d67224138d7a119e7da0b` (Branch `claude/w5-02b5`, Autor: Kimi). Stufe A
(glm-5.2, Fehlalarm F1 widerlegt) steht in `review_w5-02b5_disposition.md`.

## Reviewer-Lage

- **Nemotron 3 Ultra 550B** (Nvidia, Kilo, Gratis-Modell,
  `.pa/review_pr17_nemotron-3-ultra.md`): geantwortet, Urteil **freigeben**.
  Anbieterfremd zum Autor (Kimi/Moonshot) und zu Stufe A (Zhipu GLM).
- Ollama und OpenCode nicht benutzt (Wochenlimit), Fable 5.1 / GPT-6 Astra
  weiterhin extern blockiert (siehe Stufe A). Der Auftrag sieht für Stufe B
  genau einen Reviewer vor.

## Befunde und Disposition

| # | Schwere | Befund | Disposition |
|---|---|---|---|
| F1 | high (Reviewer-Einstufung) | `HeaderServer` ist sauber, portabel, ohne neue Abhängigkeit | **keine Aktion** — Bestätigung, kein Mangel (Einstufung „high" ist ein Etikett des Reviewers, der Text lobt). |
| F2 | high (s. o.) | Test zum generischen `http.extraHeader`-Reset ist deterministisch | **keine Aktion** — Bestätigung. |
| F3 | high (s. o.) | Pinned-Leak-Test und Doku machen die Grenze unmissverständlich | **keine Aktion** — Bestätigung (deckt sich mit glm F4). |
| F4 | high (s. o.) | GPG-Test setzt die Nutzerentscheidung K6 korrekt um | **keine Aktion** — Bestätigung. |
| F5 | medium | Modul-Doku ist korrekt und an die Tests gebunden | **keine Aktion** — Bestätigung. |
| F6 | low | `without_proxy` entfernt nur Großschreibung; `http_proxy` klein könnte unter Linux durchrutschen | **abgelehnt mit Beleg** (wie glm F2). Die Testumgebung entsteht in `environment_with()` (`agent_env.rs`, `.map(|(key, value)| (key.to_ascii_uppercase(), …))`): jeder Name, auch ein kleingeschriebenes `http_proxy`, landet großgeschrieben in der Map, die `without_proxy` bereinigt und die dem Kind als `env_clear().envs(env)` übergeben wird. Eine kleingeschriebene Variante erreicht git dort nicht; `NO_PROXY=127.0.0.1,localhost` deckt Loopback zusätzlich. |
| F7 | low | Prompt nennt eine skills.rs-Normalisierung, der Diff zeigt sie nicht | **gegenstandslos.** Der Diff wurde bewusst auf `src-tauri/` gegen das aktuelle `origin/main` gebildet; die skills.rs-Normalisierung steht inzwischen selbst auf `main` (PR #11) und ist im Branch-Diff nicht mehr enthalten (`git diff origin/main...HEAD --stat -- src-tauri/src/skills.rs` leer). Der Reviewer hat den Prompt-Text, nicht den Diff, gelesen. |

Kein Befund angenommen, daher keine Codeänderung und kein red-first-Test. Der
Kandidat bleibt unverändert; die Evidenz aus Stufe A (clippy und rust-suite der
prepush-Bahn auf dem Kandidaten, Exit 0) gilt weiter. Die Rust-Quelle wurde in
dieser Stufe nicht angefasst; seit Stufe A kam nur der Merge von `main` hinzu.

## Offene Punkte

- Zweites anbieterfremdes Review (Fable 5.1 / GPT-6 Astra ab 30.09.) laut
  AGENTS.md für „über 300 Zeilen" weiterhin offen — Entscheidung des
  Koordinators, siehe `review_w5-02b5_disposition.md`.
