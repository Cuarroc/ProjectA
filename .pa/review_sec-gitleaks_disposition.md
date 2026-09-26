# Disposition: Review-Stufe A zum Vorgaenger-PR (Branch sec-gitleaks-precommit)

Datum: 2026-09-25. Reviewer: glm-5.2:cloud und deepseek-v4-flash:cloud (beide
Nicht-Kimi; Autor war Kimi). Beide Urteile: **annehmen mit Auflagen**.
Reviews: `.pa/review_sec-gitleaks_glm-5.2.md`, `.pa/review_sec-gitleaks_deepseek-v4-flash.md`.
Jeder Befund wurde gegen den Code im Worktree und empirisch gegen gitleaks
8.30.1 (WinGet) geprueft.

## Angenommen

### A-1 = glm S-01 = deepseek S-01: Selbsttest deckt nicht alle Allowlist-Eintraege ab
Fall 2 in `scripts/test-secret-scan.sh` pruefte nur 4 der 10 Allowlist-Regexes.
Beleg: `.gitleaks.toml:20-41` vs. `scripts/test-secret-scan.sh` Fall 2.
Zusaetzlich eigene Schaerfung (K-02): Ohne Keyword-Kontext (`token =`, `key =`,
`aws_key =`) feuern die Default-Regeln auf den meisten Kanarienvoegeln gar
nicht — der Eintrag waere dann vakuum gruen, nie ausgeuebt. Empirisch
(gitleaks 8.30.1, Default-Regeln): `0123…hex32` mit `token =` feuert,
`kimi-delivery-nt17` mit `key =` feuert, `AKIACANARY1234567890` mit `aws_key =`
feuert; die ubrigen Werte feuern auch mit Kontext nicht (Entropie/fehlende
Default-Regel) und bleiben Dokumentations-Netz.
**Umsetzung:** Fall 2 enthaelt jetzt alle 10 Allowlist-Werte, jeweils mit dem
Kontext, der die Default-Regel ausloesen wuerde.

### A-2 = deepseek S-02 (verschaerft durch eigenen Beleg K-01): `AKIACANARY[0-9A-Z]{12}` deckt den echten Kanarienvogel nicht
Der reale Wert in `src-tauri/src/logging.rs:299` ist `AKIACANARY1234567890`
(10 Ziffern); die Regex verlangt 12. Empirisch: `aws_key = "AKIACANARY1234567890"`
feuert **trotz** Allowlist (rc=1, gitleaks 8.30.1 mit echter `.gitleaks.toml`).
Im Repo kommen die Varianten `AKIACANARY1234567890` (3x) und
`AKIACANARY123456789012` (1x) vor. glm-5.2 hatte die Regex noch als tragend
bewertet — der Laengen-Check greift nur bei der 12-stelligen Variante.
**Umsetzung:** Regex zu `AKIACANARY[0-9A-Z]{10,12}` — deckt beide realen
Varianten; ein echter AWS-Key muesste weiterhin woertlich `CANARY` enthalten
(~1/36^6 pro Schluessel), das Restrisiko ist das dokumentierte Kanarien-Muster.

### A-3 = glm S-02 = deepseek S-03: PATH-Filterung in Fall 4 vakuum bei Doppel-Installation
`command -v gitleaks` liefert nur den ersten Treffer; der alte Filter entfernte
nur dieses Verzeichnis. Rot-Beleg: zweite Installation in weiterem
PATH-Verzeichnis vorgetaeuscht → alter Filter liess gitleaks auffindbar,
Fall 4 haette Exit 2 gesehen ohne „fehlendes gitleaks" zu pruefen.
**Umsetzung:** Fall 4 filtert jetzt alle PATH-Verzeichnisse mit gitleaks-
Binaerdatei und beweist per Positivkontrolle, dass danach kein gitleaks mehr
auffindbar ist (sonst wird der Fall rot statt vakuum gruen).

### A-4 = glm S-03: `set -uo pipefail` ohne `-e` in secret-scan.sh
Info-Stufe, billige Haertung, kein Verhaltensrisiko (die drei Befehle vor
`exec` sind `cd || exit 1`, `command -v` im `if`, `exec`).
**Umsetzung:** `set -euo pipefail`.

## Abgelehnt

### R-1 = deepseek S-04: doctor.sh ueberschreibt `urteil` bei mehreren fehlenden Werkzeugen
Vorbestehendes Muster: die Pruefungen fuer nextest und cargo-audit verhalten
sich identisch (scripts/ci/doctor.sh, Stand origin/main). Der Branch folgt der
bestehenden Konvention; eine Umbau von `urteil` zu einer Liste gehoert nicht in
diesen Sicherheits-PR und wuerde den Diff verwässern. Bei Bedarf eigener
Auftrag.

### R-2 = deepseek S-05: Umgehung via `git commit --no-verify`
Der Reviewer selbst nennt es „akzeptables Restrisiko". `--no-verify` ist
projektweit verboten (AGENTS.md: „never --no-verify"); ein Hook-Bypass ist eine
bewusste Regelverletzung, kein Konfigurationsfehler. Server-seitige
Durchsetzung/Vollscan der Historie ist in `docs/decisions.md` (2026-09-25)
explizit als eigener Auftrag benannt — nichts zu tun in diesem PR.

## Eigene Befunde der Pruefung (keine Reviewer-Befunde)

- **K-01** = Beleg zu A-2 (siehe dort).
- **K-02** = Vakuum-Schaerfung zu A-1 (siehe dort).

## Umsetzungs-Nachweis

- Rot vor dem Fix: `aws_key = "AKIACANARY1234567890"` rc=1 mit alter
  `.gitleaks.toml`; alter PATH-Filter laesst zweite Installation auffindbar.
- Gruen nach dem Fix: `bash scripts/test-secret-scan.sh` — alle Faelle ok,
  Exit 0; `bash scripts/ci/secret-scan.sh` auf dem Branch-Index — Exit 0.
