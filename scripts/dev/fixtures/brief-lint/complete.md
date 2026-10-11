OPERATOR: UMSETZEN
GOAL: Check a brief deterministically.
NON-GOALS: install, delete, Secret
BASE: main@36bee03c
FILES (exclusive):
- scripts/dev/brief-lint.mjs
SEAM: no
SIZE: M, at most 300 lines
Test-First: scripts/lib/dev-brief-lint.test.mjs::complete brief exits 0
ACCEPTANCE: node --test scripts/lib/dev-brief-lint.test.mjs
TIER/REVIEW: B
RETURN: draft PR
