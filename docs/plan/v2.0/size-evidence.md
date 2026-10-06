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

## Paketzahl (Runde 3, 06.10.2026)

Lesend, ohne Netzwerk. Die Zahlen in `plan.md`, Abschnitt 3.14, kommen aus diesem Skript (Python 3, nur Standardbibliothek). Aufruf, im Repo-Stamm: `python3 count.py docs/plan/v2.0/plan.md docs/plan/v2.0/mapping.md` (das Skript liegt zum Nachrechnen hier abgedruckt, nicht im Repo).

Regeln des Skripts: eindeutig nach ID; Zeilen von `### 3.1` bis vor `## 4.` plus die Zeilen `| V2-EX-n (` aus 4a; der Abschnitt 3.13 (Geparkt) zählt nicht; `n×M` zählt als n Pakete; V2-REL und V2-N1 (Nutzer-Aufgaben) zählen 0; „Kern“ sind die in 1a ausgeschriebenen IDs; „übernommen“ sind die IDs der Zeilen „übernehmen“ in `mapping.md` (Ketten wie `D4a → D4b` zählen je Glied), soweit sie keine eigene Zeile im Plan haben. Die Variante „Regel 600“ halbiert (aufgerundet) die Pakete der Lane `fe` mit Stufe B und lässt alle anderen unverändert; sie setzt voraus, dass Frage 4b beantwortet wird. Grenzen: Die Größen sind Schätzungen aus Boardzeilen (die Umrechnung in Diffzeilen misst erst das erste Paket); die Zeilen für Gruppen („W5-01 bis W5-39“) sind nicht in Pakete aufgelöst; Runde 2 wurde mit demselben Skript auf dem Stand `25e7c95` gezählt (204 Pakete mit Schnitten, 163 Zeilen, 17 übernommen).

### Kern je Bündel (Runde 3b, Stand nach der Fremdkritik)

Die Tabelle schlüsselt die 107 Kernzeilen und 125 Kernpakete aus `plan.md`, Abschnitt 3.14, nach den Zeilen der Tabelle in 1a auf. Eine ID zählt eindeutig beim **ersten** Bündel, das sie nennt (daher hat „Not-Aus“ nur 2 eigene Zeilen: V2-F8 steht im Fundament). „Zusätzliche Schnitte“ ist die Zahl der Pakete über der Zeilenzahl, also Summe von (n − 1) je `n×M`-Zeile. Erzeugt mit dem Skript unten (gleiche Funktionen `rows`, `kern_ids`) und einer Gruppierung nach den Kernzeilen von 1a; Stand: 155 Zeilen, 193 Pakete, 06.10.2026.

| Bündel (Kernzeile in 1a) | Zeilen | Zusätzliche Schnitte | Pakete | Geschnittene Zeilen |
|---|---|---|---|---|
| Beweis-Schicht und Ablauf mit Beweis | 12 | 3 | 15 | RUN-2 2×, S03a 3× |
| Leitstand | 5 | 2 | 7 | S01a 3× |
| Agent starten, Ort, drei Anbieter-Wege (mit V2-DOC-SRV) | 16 | 4 | 20 | S02 3×, LOCAL-1 2×, B19 2× |
| Kontingente und Failover | 6 | 1 | 7 | S05a 2× |
| Not-Aus | 2 | 0 | 2 | – |
| Core (Steuerung, Autonomie) | 18 | 4 | 22 | CORE-AT 2×, S08 3×, S05c 2× |
| Ersteinrichtung und Einstellungen (Rahmen) | 3 | 3 | 6 | S11 2×, S10a 3× |
| Querschnitt des Kerns | 17 | 0 | 17 | – |
| Release-Pfad | 8 | 1 | 9 | API-C 2× |
| Abschluss | 5 | 0 | 5 | – |
| Fundament | 15 | 0 | 15 | – |
| **Summe** | **107** | **18** | **125** | |

Nachrechnen: 107 + 18 = 125. Gegenüber Runde 3 (108 Zeilen, 126 Pakete): V2-B27 und V2-B23 sind hinter die Schalter gewandert (−2 Zeilen, −2 Pakete), V2-DOC-SRV ist neu (+1 Zeile, +1 Paket); die 18 Zusatzschnitte sind unverändert, weil beide verschobenen Zeilen `M` und `S` sind. Der Reviewer der Fremdkritik schätzte „18 Schnitte“ aus den `n×M`-Zeilen richtig.

```python
"""Count packages of plan.md (std lib only). Usage: python3 count.py plan.md mapping.md"""
import re, sys, math

def rows(plan):
    start = plan.index('### 3.1 ')
    end = plan.index('## 4. Wellen und Tore')
    seen = {}
    seg = plan[start:end]
    if '### 3.13' in seg:
        a = seg.index('### 3.13')
        b = seg.index('@@PAKETZAHL@@') if '@@PAKETZAHL@@' in seg else (seg.index('### 3.14') if '### 3.14' in seg else len(seg))
        seg = seg[:a] + seg[b:]
    for l in seg.split('\n'):
        if not l.startswith('| V2-'):
            continue
        c = [x.strip() for x in l.split('|')[1:-1]]
        pid = c[0]
        if pid in seen or '/' in pid:
            continue
        w = 1
        lane = c[2] if len(c) > 2 else ''
        stufe = c[4] if len(c) > 4 else ''
        for x in c[1:9]:
            m = re.fullmatch(r'(\d)×M', x)
            if m:
                w = int(m.group(1)); break
        if pid in ('V2-REL', 'V2-N1'):
            w = 0
        seen[pid] = dict(w=w, lane=lane, stufe=stufe)
    a4 = plan.index('## 4a. ')
    b4 = plan.index('## 4b. ')
    for l in plan[a4:b4].split('\n'):
        mm = re.match(r'\| (V2-EX-\d) \(', l)
        if mm and mm.group(1) not in seen:
            seen[mm.group(1)] = dict(w=1, lane='ci', stufe='B')
    return seen

def kern_ids(plan):
    a = plan.index('| Kernteil |')
    b = plan.index('**Nach dem Kern')
    ids = set()
    for l in plan[a:b].split('\n'):
        if l.startswith('| ') and not l.startswith('| Kernteil') and not l.startswith('|---'):
            cell = l.split('|')[2]
        elif l.startswith('**Querschnitt'):
            cell = l
        else:
            continue
        ids |= set(re.findall(r'V2-[A-Z0-9][A-Za-z0-9-]*[A-Za-z0-9]', cell))
    return ids

def w600(r):
    return math.ceil(r['w'] / 2) if r['lane'] == 'fe' and r['stufe'] == 'B' else r['w']

def adopted(plan, mapping, own):
    ids = set()
    for l in mapping.split('\n'):
        if re.search(r'\| übernehmen \|', l):
            c = [x.strip() for x in l.split('|')[1:-1]]
            for piece in re.split(r'→|,|\+', c[2]):
                piece = piece.strip()
                if piece.startswith('V2-'):
                    ids.add(re.match(r'V2-[A-Za-z0-9-]+', piece).group(0))
                elif re.fullmatch(r'[A-Z]\d[a-z]?', piece):
                    ids.add('V2-ARCH-' + piece)
    return {i for i in ids if i not in own}

def summary(plan, mapping):
    r = rows(plan)
    k = kern_ids(plan)
    own = set(r)
    ad = adopted(plan, mapping, own)
    miss = sorted(i for i in k if i not in r)
    tot = sum(v['w'] for v in r.values())
    kern = sum(v['w'] for i, v in r.items() if i in k)
    tot6 = sum(w600(v) for v in r.values())
    kern6 = sum(w600(v) for i, v in r.items() if i in k)
    return dict(rows=len(r), krows=len([i for i in r if i in k]), tot=tot, kern=kern, tot6=tot6, kern6=kern6,
                ad=len(ad), missing=miss, adopted=sorted(ad))

if __name__ == '__main__':
    p = open(sys.argv[1], encoding='utf-8').read()
    m = open(sys.argv[2], encoding='utf-8').read()
    print(summary(p, m))
```
