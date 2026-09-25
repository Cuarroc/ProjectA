#!/usr/bin/env python3
"""Löst Modell-Muster gegen die Live-Modellliste von OpenRouter auf.

Aufruf:  resolve_models.py "<muster1>" "<muster2>" ... [--from-file models.json]

Jedes Muster ist eine ';'-getrennte, geordnete Liste von Regexen. Das erste
Regex mit mindestens einem Kandidaten gewinnt; unter den Kandidaten gewinnt
der jüngste Eintrag (`created`). Ausgeschlossen sind immer: Anthropic-Modelle,
':'-Varianten (free/nitro/online/…), Vorschau-/Batch-/Kleinstmodelle und alles
unter 128k Kontext. Ausgabe: eine Zeile `m<n>=<id>` je Muster (GITHUB_OUTPUT-
tauglich) auf stdout, Diagnose auf stderr. Exit 1, wenn ein Muster leer bleibt.
"""
import json, os, re, sys, urllib.request

URL = os.environ.get("OPENROUTER_MODELS_URL", "https://openrouter.ai/api/v1/models")
EXCLUDE = re.compile(r"(^anthropic/|:|-batch\b|-preview\b|-exp\b|-lite\b|-nano\b|-mini\b|-\d+b\b|-distill)", re.I)
# RESOLVE_ALLOW_FREE=1: ':free'-Varianten zulassen (Kontingent statt Guthaben; kleinere Kontexte, Ratenlimits)
EXCLUDE_FREE_OK = re.compile(r"(^anthropic/|:(?!free$)|-batch\b|-preview\b|-exp\b|-lite\b|-nano\b|-mini\b|-\d+b\b|-distill)", re.I)
MIN_CTX = 128_000

def load(path):
    if path:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)["data"]
    with urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "projecta-review"}), timeout=60) as r:
        return json.load(r)["data"]

def resolve(models, patterns):
    excl = EXCLUDE_FREE_OK if os.environ.get("RESOLVE_ALLOW_FREE") == "1" else EXCLUDE
    pool = [m for m in models if not excl.search(m["id"]) and int(m.get("context_length") or 0) >= MIN_CTX]
    for pat in [p.strip() for p in patterns.split(";") if p.strip()]:
        rx = re.compile(pat)
        hits = [m for m in pool if rx.search(m["id"])]
        if hits:
            hits.sort(key=lambda m: int(m.get("created") or 0), reverse=True)
            return pat, hits[0], hits[1:4]
    return None, None, []

def main(argv):
    src = None
    if "--from-file" in argv:
        i = argv.index("--from-file"); src = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    models = load(src)
    print(f"[resolve] {len(models)} Modelle geladen", file=sys.stderr)
    ok = True
    for n, patterns in enumerate(argv, 1):
        pat, best, rest = resolve(models, patterns)
        if best is None:
            print(f"[resolve] m{n}: kein Treffer für {patterns!r}", file=sys.stderr); ok = False; continue
        alt = ", ".join(m["id"] for m in rest) or "-"
        print(f"[resolve] m{n}: {best['id']} (Regex {pat!r}, ctx {best.get('context_length')}, Alternativen: {alt})", file=sys.stderr)
        print(f"m{n}={best['id']}")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
