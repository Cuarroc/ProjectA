# Beleg zur Paketgrößenregel (Eingabe für `plan.md`, Abschnitt 6)

Stand 06.10.2026. Alles hier ist lesend: `gh` und `git` ohne Schreibzugriff, kein Build. Die Auswertung ist unten als Skript abgedruckt, damit jeder die Zahlen nachrechnen kann (Python 3, nur Standardbibliothek).

## Befehle (Datenabzug vom 06.10.2026)

```sh
gh pr list --state merged --limit 400 --json number,title,additions,deletions,changedFiles,createdAt,mergedAt,headRefName,files,labels > prs.json
gh pr list --state closed --limit 600 --json number,title,additions,deletions,changedFiles,createdAt,closedAt,mergedAt,headRefName,files > closed.json
python3 size.py        # das Skript unten, im selben Ordner wie die zwei JSON-Dateien
```

Ergebnis des Laufs (Ausgabe des Skripts, gekürzt auf die Kopfzeilen): 301 gemergte PRs von 2026-09-25 bis 2026-10-05, 28 ohne Merge geschlossene PRs (die 240 Queue-Entwürfe der Mergify-Warteschlange, Zweige `mergify/…`, sind ausgenommen), Median 124 Zeilen, 16 % über 300, 63 Seam-PRs mit Median 185. Die Tabellen stehen in `plan.md`, Abschnitt 6.

## Grenzen (ehrlich)

- Zehn Tage, 301 PRs: Kleine Gruppen (601–1200: 4 PRs) tragen keine Aussage.
- „Folge-Fix“ ist eine **Untergrenze**: Er zählt nur, wenn der Fix-PR dieselbe Paket-ID, denselben Zweig-Stamm oder `#<Nummer>` nennt. Die breite Variante (Titel mit „fix“ und eine gemeinsame Datei, ohne `CHANGELOG.md`) traf 49 bis 64 % je Gruppe und ist unbrauchbar: Viele Fix-PRs ändern dieselben Sammeldateien (Plan, Changelog).
- „Netto“ lässt erzeugte Dateien weg (`docs/dev-hq/data.*`, Lockfiles, `*.snap`, Fixtures, Snapshots, `.pa/ACTIVITY`). Reine Verschiebungen sind nicht erkennbar und zählen mit.
- Die Art „nur Tests“ lässt sich nicht trennen, weil Rust-Tests im selben Modul liegen.
- **Nicht gemessen:** Review-Runden und Review-Fix-Commits je PR (ein API-Aufruf je PR), rote Queue-Läufe je Größe. `gh run list --workflow ci --limit 200 --json conclusion,event,createdAt,headBranch` zeigt am 06.10. kein Ereignis `merge_group`; die Queue läuft über Entwurfs-PRs auf Zweigen `mergify/merge-queue/*`, ihre Läufe sind keinem Paket zugeordnet.
- Die Auswertung enthält Nutzernamen weder im Skript noch in den Tabellen; die JSON-Dateien gehören nicht ins Repo.

## Skript `size.py`

```python
import json, re, statistics as st
from datetime import datetime as D

def t(s): return D.fromisoformat(s.replace('Z', '+00:00'))

merged = json.load(open('prs.json'))
closed = json.load(open('closed.json'))
GEN = re.compile(r'(docs/dev-hq/data\.|package-lock|Cargo\.lock|\.snap$|fixtures?/|\.pa/ACTIVITY|snapshots?/)')
SEAM = re.compile(r'src-tauri/src/(api\.rs|main\.rs|store\.rs|store/|bin/pa\.rs)')
ORDER = ['<=150', '151-300', '301-600', '601-1200', '>1200']

def bucket(n):
    return '<=150' if n <= 150 else '151-300' if n <= 300 else '301-600' if n <= 600 else '601-1200' if n <= 1200 else '>1200'

def kind(p):
    fs = [f['path'] for f in p['files']]
    if not fs: return 'unknown'
    if all(f.endswith('.md') or f.startswith('docs/') or GEN.search(f) for f in fs): return 'docs'
    rs = any(f.endswith('.rs') or f.startswith('src-tauri') for f in fs)
    fe = any(f.startswith('src/') for f in fs)
    ci = any(f.startswith(('scripts/', '.github/')) for f in fs)
    return 'rust+fe' if rs and fe else 'rust' if rs else 'frontend' if fe else 'scripts/ci' if ci else 'other'

for p in merged + closed:
    p['raw'] = p['additions'] + p['deletions']
    p['net'] = sum(f['additions'] + f['deletions'] for f in p['files'] if not GEN.search(f['path'])) if p['files'] else p['raw']
    p['kind'] = kind(p)

def strict_followup(p):
    """A fix/hotfix/revert PR created <=72 h after the merge that names the same
    package id, the same branch stem or '#<n>'. A lower bound: fixes without an id are invisible."""
    stem = p['headRefName'].split('/', 1)[-1]
    ids = re.findall(r'[A-Z][A-Z0-9]+-\d+[a-z]?', p['title'])
    for q in merged:
        if q is p or not re.search(r'\b(fix|hotfix|revert)', q['title'] + q['headRefName'], re.I): continue
        dt = (t(q['createdAt']) - t(p['mergedAt'])).total_seconds() / 3600
        if 0 <= dt <= 72 and ((len(stem) > 8 and stem in q['headRefName'])
                              or any(i in q['title'] or i in q['headRefName'].upper() for i in ids)
                              or f"#{p['number']}" in q['title']):
            return True
    return False

for p in merged:
    p['fix'] = strict_followup(p)
    p['hours'] = (t(p['mergedAt']) - t(p['createdAt'])).total_seconds() / 3600
unmerged = [p for p in closed if p['mergedAt'] is None and not p['headRefName'].startswith('mergify/')]

def p90(a):
    a = sorted(a); return a[min(len(a) - 1, int(.9 * len(a)))]

print('merged', len(merged), 'closed-unmerged (ohne Queue-Entwuerfe)', len(unmerged))
print('range', min(p['createdAt'] for p in merged), max(p['mergedAt'] for p in merged))
print('median raw', st.median(p['raw'] for p in merged), 'share raw>300', round(sum(p['raw'] > 300 for p in merged) / len(merged), 2))
print('fix-followups', [p['number'] for p in merged if p['fix']])
for label, key in (('Groesse roh', lambda p: bucket(p['raw'])), ('Groesse netto', lambda p: bucket(p['net'])), ('Art', lambda p: p['kind'])):
    print('\n' + label)
    for k in sorted({key(p) for p in merged}, key=lambda x: ORDER.index(x) if x in ORDER else 9):
        g = [p for p in merged if key(p) == k]; u = [p for p in unmerged if key(p) == k]
        print(f"{k:11} n={len(g):3} fix72h={sum(p['fix'] for p in g)} unmerged={len(u)} ({100*len(u)/(len(u)+len(g)):.0f}%) median_h={st.median(p['hours'] for p in g):.1f} p90_h={p90([p['hours'] for p in g]):.1f}")
seam = [p for p in merged if any(SEAM.search(f['path']) for f in p['files'])]
print('\nSeam-PRs', len(seam), 'median raw', st.median(p['raw'] for p in seam))
```
