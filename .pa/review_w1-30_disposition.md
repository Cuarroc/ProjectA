# Review-Disposition W1-30

Kandidat: W1-30, portiert aus dem internen Vorgänger-Repo (Commit-Hashes in diesen Dateien gehören dorthin). Autor: Claude Sonnet 5.
Reviewer: kimi-k3 (Ollama Cloud, `.pa/review_w1-30_kimi-k3.md`). Ein Review genuegt: unter 300 Zeilen, keine Nahtstelle.
Urteil: **approve**.

| ID | Quelle | Schwere | Befund | Disposition |
|----|--------|---------|--------|-------------|
| L1 | kimi-k3 | low | Fixture-Threads blockieren in `accept()` ohne Timeout; ein Test, dessen Client nie verbindet, leakt den Thread. | Abgelehnt fuer dieses Paket: bestehendes Muster aller Fixtures im Modul, jeder Aufrufer verbindet. Folgearbeit nur falls je ein Test ohne Client entsteht. |
| L2 | kimi-k3 | low | 5 s Budget ist endlich; ein >5 s ausgehungerter Fixture-Thread ergaebe weiter `Timeout`. | Bewusst akzeptiert. 50-facher Abstand zu dem Budget, das bei 24 Burnern versagte; 0/150 bei 48 Burnern. Steht so im Bericht ("nicht beweisbar immun"). |
| L3 | kimi-k3 | low | `a_stalled_...` kippt theoretisch, wenn der Test-Thread selbst >10 s zwischen `write_all` und `read` ruht (Server-Sicherheits-Timeout). | Bewusst akzeptiert; 10 s Verhungern liegt weit ueber jeder gemessenen Last. Eine Endlosschleife im Fixture waere schlechter (unbegrenzte Thread-Lebensdauer). |
| L4 | kimi-k3 | low | Der neue Test sendet Body `"{}"` statt `ERROR_401_FIXTURE`. | Angenommen ohne Aenderung: Klassifikation ist bei Nicht-2xx rein statusbasiert, die 401/403-Faelle mit Fixture bleiben im urspruenglichen Test unveraendert. |

Beantwortete Pruefpunkte des Reviewers: keine Assertion abgeschwaecht (die Erwartungen sind byte-identisch, nur das Budget-Argument wurde geaendert); `Timeout`- und `Offline`-Faelle behalten ihre engen Budgets; kein Produktionscode geaendert.
