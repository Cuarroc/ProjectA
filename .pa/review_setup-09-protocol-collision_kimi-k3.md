# Review setup-09-protocol-collision - kimi-k3

- Status: ok
- Reviewer: kimi-k3 (kind ollama)
- Model requested: kimi-k3:cloud
- Model reported: kimi-k3
- Author of the candidate: -
- Prompt: .pa/review_prompt_setup-09-protocol-collision.md (13841 chars, sha256 a5a39347740db601)
- Time: 2026-10-04T07:11:11Z

---

## Findings

**F1 — low** — `scripts/review/run-local.sh:168` (`printf '%s' "${n//:/-}" | tr -c 'A-Za-z0-9._-' '-'`)
Der Guard lebt von der Invariante „Name hier = Dateiname, den der Transport schreibt". GNU `tr` arbeitet byteweise: ein UTF-8-Zeichen wie `ü` (2 Bytes) wird zu `--`. Ein zeichenbasiertes `slug()` im Transport (typisch: Python `re.sub(r'[^A-Za-z0-9._-]', '-', name)` auf `str`) ergäbe dagegen ein einzelnes `-`. Dann kann die hier geprüfte Kollision auf der Platte trotzdem passieren: Modelle `mü` und `m-` bestehen den Guard (`m--` ≠ `m-`), der Transport schriebe aber für beide `review_<label>_m-.md` — das zweite Urteil überschreibt das erste bei Exit 0, also genau der Fehler, den der Branch behebt. Praktisch unwahrscheinlich (Ollama-/kilo-Modell-IDs sind ASCII), deshalb low. Sauberste Lösung wäre fail-closed: Modellname nach Normalisierung gegen `[A-Za-z0-9._/-]` prüfen und bei anderem Zeichensatz mit Exit 2 ablehnen, statt still zu transliterieren. Der neue Test o15 pinnt die Transport-Slug-Semantik übrigens nur für `/` — er beweist nicht, ob der Transport überhaupt sluggt (der exportierte NAME ist nach `tr` schon endgültig).

**F2 — low** — `scripts/review/run-local.sh:183` (`[ "${proto_names[$i]}" != "${proto_names[$j]}" ]`)
Der Vergleich ist exakt und case-sensitiv, das Dateisystem oft nicht: `Llama3:8b` + `llama3:8b` (z. B. via `REVIEW_OLLAMA_MODELS`) ergeben `Llama3-8b` ≠ `llama3-8b`, kollidieren aber auf Standard-APFS/NTFS in einer Datei. Für den Vergleich auf die lowercase-Form zu gehen wäre fail-closed und fängt den Fall „gleiches Modell zweimal in anderer Schreibweise" gleich mit. Randfall, weil Ollama-Namen konventionsgemäß lowercase sind — low.

**F3 — low** — `scripts/review/run-local.sh:176-187` (Check-Platzierung vor dem Trockenlauf-Ausstieg bei ~341)
Der Check feuert auch bei `--dry-run`. Im Trockenlauf wird aber nur `review_prompt_<label>.md` geschrieben (einmalig, label- und nicht modellbezogen) und nie ein Protokoll — die zu verhindernde Kollision kann dort gar nicht auftreten. Wer nur den Prompt inspizieren will, wird jetzt mit Exit 2 für eine Gefahr blockiert, die es nur beim echten Versand gibt. Vertretbar (früh scheitern), aber nicht im Test gepinnt: entweder bewusst in die Doku aufnehmen/als Test festzurren oder den Check in den `dry_run=0`-Pfad verschieben.

**F4 — low** — `scripts/test-review-local.sh:379-416`
Geschwisterfälle des gefixten Bugs sind ungetestet: exaktes Duplikat (`--models a,a`) und `:cloud`-Kollision (`x:cloud` neben `x`, der in Doku und Kommentar prominent genannte Fall). Beide laufen durch denselben Codepfad, aber die Repo-Regel „Geschwisterfälle jedes gefixten Bugs prüfen" legt die zwei billigen Pins nahe — eine Regression in `${n%:cloud}` würde aktuell nur indirekt über Test 12 auffallen.

Die rote-Reihenfolge (Test-Commit vor Fix-Commit) ist eingehalten, Exit-Codes werden nicht maskiert, keine Seam-Dateien, keine Dependencies, keine Secrets.

**Verdict: approve with conditions** — F4 (zwei Sibling-Tests) und eine Entscheidung zu F1 (Charset ablehnen oder Limitation im Kommentar dokumentieren) vor dem Merge; F2/F3 sind Anmerkungen ohne Blocker-Charakter.
