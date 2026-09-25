---
name: frag-mich
description: Beantwortet Einsteiger-Fragen des Nutzers zu ProjectA kurz und auf Deutsch — Begriffe ("Was heißt Worktree?"), rote Checks ("Warum ist der Check rot?"), offene Entscheidungen ("Was soll ich entscheiden?"). Use when the user asks what a term means, why CI/a PR is red, what to do next, or what they have to decide. Antwort maximal 5 Zeilen, dann Was passiert ist / Was du entscheidest / Nächster Schritt.
---

# frag-mich — kurze Antworten für den Nutzer

Der Nutzer ist Einsteiger und hat ADHS: **kurz, Kernaussage zuerst, Listen statt
Fließtext, normaler Ton, Fachbegriff in einem Halbsatz erklärt.** Antworte auf
Deutsch (Code, Befehle und Dateinamen bleiben unverändert).

## Wo die Wahrheit steht (nicht kopieren, nur verweisen)

- Begriffe: [`docs/hilfe/glossar.md`](../../../docs/hilfe/glossar.md) — 30 Begriffe.
- Befehle und Klicks: [`docs/hilfe/spickzettel.md`](../../../docs/hilfe/spickzettel.md).
- Regeln und Gates: `AGENTS.md`; Stand: `STAND.md`; Plan: `docs/PLAN.md`.

Dieser Skill enthält **keine eigene Regel-Fassung**. Widerspricht er dem
Glossar oder `AGENTS.md`, gilt das Dokument, nicht der Skill.

## Vorgehen

1. **Frage einordnen:**
   - *Begriff* („Was heißt …?“) → Eintrag im Glossar lesen, in eigenen Worten
     wiedergeben. Fehlt der Begriff: sagen, dass er fehlt, kurz erklären, und
     vorschlagen, ihn ins Glossar aufzunehmen.
   - *Roter Check* („Warum ist … rot?“) → **erst nachsehen, nicht raten:**
     `gh pr checks <n>`, dann `gh run view <id> --log-failed`. Den ersten
     Fehler nennen, nicht die Folgefehler.
   - *Entscheidung* („Was soll ich entscheiden?“) → `STAND.md`, offene PRs
     (`gh pr list --repo Cuarroc/ProjectA`) und den Fragebogen/die
     Entscheidungs-Inbox (Spickzettel Nr. 13–14) ansehen. Nur nennen, was
     wirklich beim Nutzer liegt.
   - *Anderes* → knapp beantworten; wenn du nichts Belegtes findest, sag das.
2. **Antwort schreiben** im Format unten. Nichts behaupten, was du nicht
   gesehen hast; Zahlen und Zustände aus dem Befehl, nicht aus dem Gedächtnis.
3. **Nichts verändern.** Dieser Skill liest nur. Kein Merge, kein Löschen, kein
   Push, keine App starten, nichts installieren.

## Antwortformat

Zuerst **höchstens 5 Zeilen** direkte Antwort (Kernaussage in Zeile 1). Dann
immer genau diese drei Punkte, je ein Satz oder eine Zeile:

```text
**Was passiert ist:** <Befund, mit Beleg — z. B. "Check `red-first` rot: Test fehlt">
**Was du entscheidest:** <die eine echte Entscheidung — oder "nichts, das läuft von selbst">
**Nächster Schritt:** <ein konkreter Schritt; wer macht ihn (du / Agent)>
```

## Regeln für die Entscheidung

Beim Nutzer liegen immer: **Löschen, Geld, Installationen, Veröffentlichen /
Release, Rechte ausweiten.** Alles andere (grüne PRs mergen, Worker neu
starten, Reviews einholen) erledigen Agenten — sag dann „nichts“ und nenne,
wer es tut. Frage nicht mehr als eine Sache auf einmal.

## Beispiele

**„Was heißt Worktree?“**

> Ein Worktree ist ein zweiter Ordner mit eigenem Branch, aber demselben Repo.
> So können mehrere Agenten gleichzeitig arbeiten, ohne sich zu stören.
>
> **Was passiert ist:** nichts — reine Begriffsfrage (Glossar: „Worktree“).
> **Was du entscheidest:** nichts.
> **Nächster Schritt:** `git worktree list` zeigt alle vorhandenen.

**„Warum ist der Check rot?“** (nach `gh pr checks` und `--log-failed`)

> `red-first` ist rot: im PR fehlt ein Test, der vor der Reparatur fehlschlug.
>
> **Was passiert ist:** Der Check `red-first` meldet „kein roter Test“ (Run `<id>`).
> **Was du entscheidest:** nichts — der Autor-Agent muss den Test nachliefern.
> **Nächster Schritt:** Agent bitten, den Test zuerst zu committen; du wartest.
