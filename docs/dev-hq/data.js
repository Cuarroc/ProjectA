window.HQ_DATA = {
  "generatedAt": "2026-10-16T00:10:59.309Z",
  "commit": "8919ac92",
  "dirty": true,
  "sources": [
    {
      "path": "STAND.md",
      "sha256": "c0669bd8708ba21aadd8a9087c9a69a0355795c2a23d55a386dd847a86a9974d"
    },
    {
      "path": "docs/PLAN.md",
      "sha256": "31f41d7d6e4827320df065ecf98e94286f52be96c54b5cddca2bee563edcc3e8"
    },
    {
      "path": ".pa/task_f_core3_delivery.md",
      "sha256": "dc4e7ffdf3ec813b13dcdf7e42553f2aa35daa869a059090908ccdd5fd12425e"
    }
  ],
  "warnings": [],
  "nextGrip": [
    {
      "text": "`lage-jetzt` und die Live-Belege lesen; Ziel, Owner und nächsten Schritt mit den Z1–Z4-Tabellen in `docs/PLAN.md` abgleichen.",
      "source": "STAND.md#Nächster Griff"
    }
  ],
  "specs": [
    {
      "file": ".pa/task_f_core3_delivery.md",
      "title": "W1-03e/f: F-CORE-3 Rest B.3/C",
      "packet": "W1-03e/f: F-CORE-3 Rest B.3/C",
      "lane": "parallel",
      "serialOwner": null,
      "status": "aktiv",
      "source": "STAND.md#Aktive Specs",
      "startable": true
    }
  ],
  "findings": [],
  "goals": [
    {
      "id": "Z1",
      "title": "Denkraum release-fertig für v1.6.0",
      "packages": [
        {
          "id": "DR-01",
          "title": "Gerüst tools/denkraum/, Gate-Zeile in scripts/ci/gates.sh, Hygiene-Check (LF-Regel in .gitattributes, kein State-Pfad im Repo)",
          "owner": "Seniorentwickler",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "PC",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #635 `e9f8ce8` durch Mergify am 08.10. 06:44:21 UTC gemergt (`0b56f1a`); keine erneute Source-Abnahme",
          "acceptance": "`bash scripts/ci/gates.sh lane prepush` Exit 0; neue Gate-Zeile läuft die Denkraum-Tests",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            635
          ]
        },
        {
          "id": "DR-01a",
          "title": "Überlauf im Hygiene-Check beheben, roter Test zuerst; vor DR-02 mergen",
          "owner": "Seniorentwickler",
          "dependsRaw": "DR-01",
          "dependsOn": [
            "DR-01"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #637 `a2dbf09` durch Mergify am 08.10. 07:56:31 UTC gemergt (`8f7c499`); Queue 655 / CI 37745165188 mit echtem Windows-PASS",
          "acceptance": "Überlauf-Test vor Fix rot, danach grün; eigene prepush Exit 0; zwei unabhängige Vendor-Belege samt Disposition; Merge vor DR-02",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            637
          ]
        },
        {
          "id": "DR-02",
          "title": "Ledger-Modell als Modul, Split-Beweis (verhaltensgleich)",
          "owner": "Seniorentwickler",
          "dependsRaw": "DR-01, DR-01a",
          "dependsOn": [
            "DR-01",
            "DR-01a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #636 `4ef2ac2` durch Mergify am 08.10. 08:33:02 UTC gemergt (`7e3a7af`); Batch 659 / CI 37748898151 volle Windows-, Linux- und red-first-Gates grün; DR-03 folgt",
          "acceptance": "FIT-Abnahme; bestehende Store-Tests unverändert grün; jede Datei ≤ 300 Zeilen; prepush Exit 0; DR-01a vor DR-02 gemergt",
          "tickets": [
            "55ea21ce",
            "b0e90b72"
          ],
          "prNumbers": [
            636
          ]
        },
        {
          "id": "DR-03",
          "title": "DeskStore-Kern; P1/Z1 nach integriertem Ledger-Modell",
          "owner": "Seniorentwickler-Profil, ein nativer Ausführungsowner `qfytpd`; Chief disponiert",
          "dependsRaw": "DR-02 gemergt; eigene Goal-/Laufzeitbelege, frische Guards",
          "dependsOn": [
            "DR-02"
          ],
          "place": "eigener Worktree; schwere Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #661 `c80456a` am 08.10. 14:22:17Z durch Mergify gemergt (`3003748`); F01 und reale DR-04-Komposition bleiben offen",
          "acceptance": "Store-Tests grün, Revision/Konflikt verlieren keine Daten; Folgepunkte aus DR-02: Längenlimit für Ledger-Listen, Antwort-Elemente prüfen (DeskError statt TypeError); eigene prepush und zwei Fremdvendor-Reviews am Kandidaten, Root-Abnahme",
          "tickets": [
            "ee12d457",
            "8fa3ef8e",
            "55ea21ce"
          ],
          "prNumbers": [
            661
          ]
        },
        {
          "id": "DR-04",
          "title": "Antworten, Quittungen, Benachrichtigungen; getrennte Schnitte DR-04a und DR-04b",
          "owner": "bestehender DR-03-Ausführungsowner qfytpd; Root disponiert",
          "dependsRaw": "freigegebener DR-03-Stack `c80456a`, danach DR-04a → DR-04b",
          "dependsOn": [
            "DR-04a",
            "DR-04b"
          ],
          "place": "PC; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #666 (merged 2026-10-08T16:04:16Z); Erledigt #669 (merged 2026-10-08T16:35:44Z)",
          "acceptance": "Tests für Antwort/Quittung/Dedupe grün; Quittungs-Wiederholung und v1-Ack laufen über die D2-Prüfung (Test)",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            666,
            669
          ]
        },
        {
          "id": "DR-04a",
          "title": "Antworten, Quittungen und Root-gebundene Acks",
          "owner": "bestehender qfytpd; kein zweiter Owner",
          "dependsRaw": "DR-03-Stack `c80456a`",
          "dependsOn": [],
          "place": "PC; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #666 (merged 2026-10-08T16:04:16Z)",
          "acceptance": "eigene prepush, zwei Fremdvendor-Belege am Kandidaten, Disposition und Root-Abnahme; D2-Ack fail-closed und 503 bei progressTransition",
          "tickets": [
            "cffccf40"
          ],
          "prNumbers": [
            666
          ]
        },
        {
          "id": "DR-04b",
          "title": "Pending, Inbox und Delivery in den Store übernehmen",
          "owner": "bestehender qfytpd; kein zweiter Owner",
          "dependsRaw": "DR-04a-Stack `1e11bb8`",
          "dependsOn": [],
          "place": "PC; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #669 (merged 2026-10-08T16:35:44Z)",
          "acceptance": "≤ 300 ALL; vollständige P1-Komposition, eigene prepush, zwei Fremdvendor-Belege mit Disposition und Root-Abnahme",
          "tickets": [
            "a27e7eb0"
          ],
          "prNumbers": [
            669
          ]
        },
        {
          "id": "DR-04B-FU",
          "title": "In tools/denkraum/store/delivery.mjs::flushNotifications() Root-Prüfung vor Transport-Prüfung: V2 ohne Root/Transport antwortet 503 statt not-configured",
          "owner": "bestehende Denkraum-Lane qfytpd; alternativ Root-Serverjob nach eindeutiger Zuweisung, kein Doppelstart",
          "dependsRaw": "#669 gemergt; unabhängiger Schnitt von Root am 08.10. 20:45Z vorgezogen; Basis `fc85e3d`",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #727 (merged 2026-10-08T22:06:42Z)",
          "acceptance": "≤ 50 ALL; kompilierender roter Test in `delivery.test.mjs`: rootloser V2-Store ohne Transport → 503, kein Write/Send; V1-Vertrag erhalten; grün, eigene prepush, zwei Fremdvendor-Reviews am Kandidaten mit Disposition und Root-Abnahme",
          "tickets": [
            "a27e7eb0"
          ],
          "prNumbers": [
            727
          ]
        },
        {
          "id": "DR-04c",
          "title": "Fehlende P1-Operationen putQuestion/putIdea/putPatch/putProgress verhaltensgleich auf DeliveryStore zusammensetzen; progressTransition an #progress, store.mjs-Reexport",
          "owner": "bestehender qfytpd, Root-Option A/D1",
          "dependsRaw": "DR-04b-Stack `dc34cae`",
          "dependsOn": [],
          "place": "eigener Worktree; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #671 (merged 2026-10-08T17:43:49Z); Erledigt #674 (merged 2026-10-08T19:45:55Z)",
          "acceptance": "P1 `store.mjs@592b309d` Zeilen 264–382/392–415 erhalten; kompilierendes Rot, eigene prepush, zwei Fremdvendor-Reviews/Disposition, Root-Abnahme",
          "tickets": [
            "1671ee11"
          ],
          "prNumbers": [
            671,
            674
          ]
        },
        {
          "id": "DR-05",
          "title": "P1-Tests der Ideen-Metadaten (Kategorie ≤ 80 UTF-16, userPriority), vollständiger Testimport gemäß G1 α",
          "owner": "Seniorentwickler",
          "dependsRaw": "DR-06b (Store, Delivery, Server und CLI benötigt)",
          "dependsOn": [
            "DR-06b"
          ],
          "place": "Server",
          "tier": "C bei reinem Testdiff; sonst B, höhere Risiken nach Regel 5",
          "status": "Erledigt",
          "statusRaw": "Erledigt #734 (merged 2026-10-08T23:30:05Z)",
          "acceptance": "Alle 16 Tests grün, P1-SHA-Mapping; Grenzfälle rot vor Fix; eigener vollständiger prepush Exit 0",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            734
          ]
        },
        {
          "id": "DR-06",
          "title": "HTTP-Server + CLI, State-Pfad außerhalb des Repos; D2: DECISION_DESK_ROOT_AGENT_ID per ENV/Startparameter, fail-closed",
          "owner": "bestehender qfytpd; Root disponiert",
          "dependsRaw": "DR-04c; getrennte Lieferung DR-06a → DR-06b",
          "dependsOn": [
            "DR-04c",
            "DR-06a",
            "DR-06b"
          ],
          "place": "PC; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #676 (merged 2026-10-08T20:56:05Z); Erledigt #681 (merged 2026-10-08T21:42:27Z)",
          "acceptance": "Tests: ohne State-Pfad oder Root-Agent-ID Start verweigert; Pfad im Repo abgelehnt; fehlende Root-Agent-ID im HTTP-Pfad → 503; keine interne ID im Code/Test",
          "tickets": [
            "672767c8",
            "55ea21ce"
          ],
          "prNumbers": [
            676,
            681
          ]
        },
        {
          "id": "DR-06a",
          "title": "P1-Server mit D2/H2; externen physischen State-Pfad und Root-ID fail-closed prüfen",
          "owner": "bestehender qfytpd",
          "dependsRaw": "DR-04c",
          "dependsOn": [
            "DR-04c"
          ],
          "place": "eigener Worktree; Gates Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #676 (merged 2026-10-08T20:56:05Z)",
          "acceptance": "kompilierendes Rot, eigene prepush/zwei Fremdreviews; `/api/state.rootAgentId` nur bei tatsächlichem Frontend-Leser, sonst D2-Meta-Tag erhalten",
          "tickets": [
            "c044dc2b"
          ],
          "prNumbers": [
            676
          ]
        },
        {
          "id": "DR-06b",
          "title": "P1-CLI verhaltensgleich nach Server übernehmen",
          "owner": "bestehender Root-Serverjob, Claude Sonnet laut Root; qfytpd nur Fixrunde",
          "dependsRaw": "DR-06a",
          "dependsOn": [
            "DR-06a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #681 (merged 2026-10-08T21:42:27Z)",
          "acceptance": "kompilierendes Rot, originale CLI-Verträge erhalten, eigene prepush/zwei Fremdreviews mit Disposition und Root-Abnahme",
          "tickets": [
            "e4ad8296"
          ],
          "prNumbers": [
            681
          ]
        },
        {
          "id": "DR-07",
          "title": "Tests: API, Patches, Fortschritt, freie Antwort, Fragen-Import; ergänzende P1-Ports getrennt",
          "owner": "bestehende Denkraum-Lane qfytpd; Root dispatcht/nimmt ab",
          "dependsRaw": "DR-06b/#681 gemergt `85ab286`",
          "dependsOn": [
            "DR-06b"
          ],
          "place": "Server",
          "tier": "C, Root kann B verlangen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #731 (merged 2026-10-08T23:14:56Z) (07a); Erledigt #732 (merged 2026-10-08T23:14:31Z) (07b); 07c/d/e1/e2 separat",
          "acceptance": "Testsuite grün im Gate; P1-Digest/Test-Mapping und D2-Delta; eigene volle prepush; keine Scratch-/Gesamt-Abnahme ableiten",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            731,
            732
          ]
        },
        {
          "id": "DR-07c",
          "title": "P1-Sender-Tests portieren; HTTP-Verhalten gegen aktuellen Repo-Server belegen",
          "owner": "bestehende Denkraum-Lane qfytpd nach Root-Zuweisung",
          "dependsRaw": "#681 gemergt; Basis `85ab286`; unabhängig von 07d/e1/e2",
          "dependsOn": [],
          "place": "Server",
          "tier": "C bei reinem Testport; Root kann B verlangen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #752 (merged 2026-10-09T00:33:36Z)",
          "acceptance": "nur sender.test.mjs; gemeldete 214 ALL/12 Tests; ≤ 300 tatsächlich; P1/D2-Mapping, Node/Suite/prepush grün, Root-Abnahme",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            752
          ]
        },
        {
          "id": "DR-07d",
          "title": "P1-Prioritäts-Tests portieren; ergänzt DR-05",
          "owner": "bestehende Denkraum-Lane qfytpd nach Root-Zuweisung",
          "dependsRaw": "#681 gemergt; Basis `85ab286`; DR-05-Verknüpfung kein neuer Dateivorgänger",
          "dependsOn": [],
          "place": "Server",
          "tier": "C bei reinem Testport; Root kann B verlangen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #753 (merged 2026-10-08T23:38:16Z)",
          "acceptance": "nur priority.test.mjs; gemeldete 110 ALL/6 Tests; ≤ 300 tatsächlich; P1/D2-Mapping, Node/Suite/prepush grün, Root-Abnahme",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            753
          ]
        },
        {
          "id": "DR-07e1",
          "title": "P1-Store-Receipt-/Recovery-Tests vollständig portieren",
          "owner": "bestehende Denkraum-Lane qfytpd nach Root-Zuweisung",
          "dependsRaw": "#681 gemergt; Basis `85ab286`; unabhängig von e2",
          "dependsOn": [],
          "place": "Server",
          "tier": "C bei reinem Testport; Befund neu einstufen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #751 (merged 2026-10-08T23:55:13Z)",
          "acceptance": "nur store-receipts.test.mjs; gemeldete 169 ALL/10 Tests; ≤ 300 tatsächlich; eingefrorenes P1 1–34 + 35–169, Node/Suite/prepush grün",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            751
          ]
        },
        {
          "id": "DR-07e2",
          "title": "P1-Store-Antwort-/Migrations-Tests vollständig portieren",
          "owner": "bestehende Denkraum-Lane qfytpd nach Root-Zuweisung",
          "dependsRaw": "#681 gemergt; Basis `85ab286`; unabhängig von e1",
          "dependsOn": [],
          "place": "Server",
          "tier": "C bei reinem Testport; Befund neu einstufen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #755 (merged 2026-10-08T23:55:06Z)",
          "acceptance": "nur store-answers-migration.test.mjs; gemeldete 224 ALL/18 Tests; ≤ 300 tatsächlich; eingefrorenes P1 1–34 + 170–359, Child-Source unverändert, Node/Suite/prepush grün",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            755
          ]
        },
        {
          "id": "DR-08",
          "title": "UI-Hülle index.html + Style, byte-genau auf Stand B1",
          "owner": "UX-Architekt",
          "dependsRaw": "FIT vorbereitet, Root-FIT-Abnahme; DR-01",
          "dependsOn": [
            "DR-01"
          ],
          "place": "egal",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #640 `2c57bd3` durch Mergify am 08.10. 08:09:51 UTC gemergt (`cd64c1c`); benutzbare Gesamtlösung weiter offen",
          "acceptance": "Byte-Vergleich mit B1-Kandidat; prepush Exit 0",
          "tickets": [
            "55ea21ce",
            "6713479b"
          ],
          "prNumbers": [
            640
          ]
        },
        {
          "id": "DR-09",
          "title": "App-Teil Fragen (B1 app.js Zeilen 1–238, byte-genau)",
          "owner": "Implementierer · Codex",
          "dependsRaw": "DR-01",
          "dependsOn": [
            "DR-01"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #638 (merged 2026-10-08T14:46:25Z)",
          "acceptance": "Fragen-Ablauf wie B1, Harness grün",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            638
          ]
        },
        {
          "id": "DR-09-WIN",
          "title": "P1/Z1: Windows-Fixture schließt Ressourcen nachvollziehbar vor temporärer Verzeichnisentfernung; sicherer Queue-Beleg statt Zeitfenster-Vergrößerung",
          "owner": "bestehender DR-01a-Owner; Chief disponiert, Root nimmt ab",
          "dependsRaw": "Queue-656-Befund; frische Guards, Windows-Ort und freier Build-Slot",
          "dependsOn": [],
          "place": "PC / vorhandener Windows-Ort",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #660 (merged 2026-10-08T14:21:03Z)",
          "acceptance": "≤ 300 ALL; kompilierendes deterministisches Rot auf Basis und Grün am Kandidaten; originaler Cleanup-Test und eigene prepush Exit 0 auf Windows; zwei Fremdvendor-Reviews am Head; Root vor Ready, Mergify; historischer Lockhalter ungeklärt",
          "tickets": [
            "1d708b0f",
            "a6677e75",
            "8fa3ef8e",
            "55ea21ce"
          ],
          "prNumbers": [
            660
          ]
        },
        {
          "id": "ARCH-D7-WIN",
          "title": "P1/Z1: tatsächlichen nativen Receipt-Fehler getrennt diagnostizieren und kontrolliert rot belegen; verlässliche Queue-Integration für #632",
          "owner": "bestehender DR-15a-Owner; Chief disponiert, Root nimmt ab",
          "dependsRaw": "CI 37746602240 / Windowsjob 113209450490; Store-Lane frei, schwere Läufe nach DR-09-WIN",
          "dependsOn": [
            "DR-09-WIN"
          ],
          "place": "vorhandener Windows-Ort",
          "tier": "A",
          "status": "Entfallen",
          "statusRaw": "Entfallen: aufgegangen in V16-KI30 #737 / Z4-ARCH-11",
          "acceptance": "≤ 300 ALL; Host-/SQLite-/Writer-Zeitpunkte kausal unterscheiden, deterministischer kompilierender Rotnachweis; tatsächliche Windows-Prüfung und eigene prepush am Fix-Head; zwei Fremdvendor-Reviews und Root vor Ready; keine pauschalen Zeitfenster-/Retry-Erhöhungen",
          "tickets": [
            "c4d05a97",
            "782d9e58"
          ],
          "prNumbers": [
            737
          ]
        },
        {
          "id": "DR-10",
          "title": "App-Teil Ideen + Werkbank auf Stand B1",
          "owner": "Root-Job `srv-dr-10-opus`; kein zweiter UI-Owner",
          "dependsRaw": "DR-09/#638 gemergt; Verdrahtung in DR-11/#718",
          "dependsOn": [
            "DR-09",
            "DR-11"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #665 (merged 2026-10-08T19:59:10Z)",
          "acceptance": "Ideen-Ablauf wie B1, Harness grün; eigene prepush, Fremdreview/Disposition und Root-Abnahme; Verdrahtung in DR-11/#718",
          "tickets": [
            "08342807",
            "5945accc"
          ],
          "prNumbers": [
            665
          ]
        },
        {
          "id": "DR-10-WIRE",
          "title": "UI-Verdrahtung von ideas.js und app.js in DR-11/#718 enthalten",
          "owner": "DR-11-Owner; kein separater Start",
          "dependsRaw": "DR-11/#718",
          "dependsOn": [
            "DR-11"
          ],
          "place": "eigener Worktree",
          "tier": "B",
          "status": "Entfallen",
          "statusRaw": "Entfallen (Root 09.10.): Verdrahtung bleibt in #718 (DR-11)",
          "acceptance": "rote Verdrahtungsregression, beide Skripte HTTP 200; inspiziertes Laufzeitbild, eigene prepush/Fremdreview/Root-Abnahme; ≤ 300 ALL",
          "tickets": [
            "4e0b5b37"
          ],
          "prNumbers": [
            718
          ]
        },
        {
          "id": "HOTFIX-RF-PW",
          "title": "#741 red-first Playwright identity",
          "owner": "bestehender Owner; Root disponiert die freigegebene Runde",
          "dependsRaw": "–; Voraussetzung für DR-11",
          "dependsOn": [
            "DR-11"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #741 (merged 2026-10-09T12:27:43Z); ersetzt: In Prüfung: Ready #741; E1 vom 09.10. erlaubte genau eine dritte Runde nur zum Delta",
          "acceptance": "E1-Quelle: Root-Auftrag PLAN-SYNC-0910b; gebundene Gate-/Reviewbelege und Root-Abnahme vor DR-11-Integration",
          "tickets": [],
          "prNumbers": [
            741,
            741
          ]
        },
        {
          "id": "DR-11",
          "title": "UI-Harness auf @playwright/test portieren (nur relative Pfade), permanenter D4-Fall",
          "owner": "UX-Architekt",
          "dependsRaw": "DR-10/#665 und HOTFIX-RF-PW/#741",
          "dependsOn": [
            "DR-10",
            "HOTFIX-RF-PW"
          ],
          "place": "Server",
          "tier": "C bei reinem Testdiff; höhere Risiken nach Regel 5",
          "status": "Erledigt",
          "statusRaw": "Erledigt #718 (merged 2026-10-09T13:38:46Z); ersetzt: In Prüfung: Draft #718",
          "acceptance": "B1-Harness und D4-Test: fehlende/leere Root-ID sperrt alle POST-Aktionen mit Grundtext und ohne Writes; Harness läuft im Gate auf dem Server",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            718,
            718
          ]
        },
        {
          "id": "DR-11-FU",
          "title": "Denkraum-UI Review-Nachzüge nach #718",
          "owner": "DR-11-Owner",
          "dependsRaw": "DR-11/#718 gemergt",
          "dependsOn": [
            "DR-11"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #870 (merged 2026-10-09T17:35:03Z)",
          "acceptance": "Review-Follow-ups gemergt",
          "tickets": [],
          "prNumbers": [
            870
          ]
        },
        {
          "id": "DR-FU-0910g",
          "title": "Review-Nachzüge 09.10. Abend (R870-LOWS, R833-LOWS, R814-G1, R824-G1, R871-A7, R877-LOWS, R887-FU)",
          "owner": "Root/Orchestrator",
          "dependsRaw": "diverse Vorgänger-PRs",
          "dependsOn": [],
          "place": "Server",
          "tier": "B/C",
          "status": "Erledigt",
          "statusRaw": "Erledigt (alle sieben Nachzüge gemergt, #875–#892): R870-LOWS Erledigt #882 (merged 2026-10-09T18:24:36Z); R833-LOWS Erledigt #878 (merged 2026-10-09T18:38:04Z); R814-G1 Erledigt #877 (merged 2026-10-09T18:10:57Z); R824-G1 Erledigt #875 (merged 2026-10-09T18:17:58Z); R871-A7 Erledigt #890 (merged 2026-10-09T19:56:03Z); R877-LOWS Erledigt #887 (merged 2026-10-09T19:41:45Z); R887-FU Erledigt #892 (merged 2026-10-09T20:09:42Z)",
          "acceptance": "beobachtete PR-Zustände via gh; keine neuen Tabellen",
          "tickets": [
            "PLAN-SYNC-0910g"
          ],
          "prNumbers": [
            875,
            892,
            882,
            878,
            877,
            875,
            890,
            887,
            892
          ]
        },
        {
          "id": "DR-12",
          "title": "B2 Kategorie inkl. Pflicht-Fix R1 (Polling baut <select> neu, app.js:349), roter Test zuerst",
          "owner": "UX-Architekt",
          "dependsRaw": "DR-11 (Kategorie- und R1-Tests benötigen dessen Harness)",
          "dependsOn": [
            "DR-11"
          ],
          "place": "egal",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #740 (merged 2026-10-09T14:45:16Z); ersetzt: In Prüfung: Draft #740",
          "acceptance": "roter Test vor Fix, danach grün; unveränderte Optionen behalten ihre Nodes und Auswahl über 15-s-Poll; Textfeld-Rand mit Kontrast ≥ 3:1 (Folgepunkt aus DR-08)",
          "tickets": [
            "98fa8267"
          ],
          "prNumbers": [
            740,
            740
          ]
        },
        {
          "id": "DR-13",
          "title": "Filter Priorität und Station",
          "owner": "UX-Architekt",
          "dependsRaw": "DR-12",
          "dependsOn": [
            "DR-12"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #759 (merged 2026-10-09T15:35:05Z); ersetzt: In Prüfung: Draft #759",
          "acceptance": "Filtertests grün",
          "tickets": [
            "98fa8267"
          ],
          "prNumbers": [
            759,
            759
          ]
        },
        {
          "id": "DR-14",
          "title": "Stabile Sortierung",
          "owner": "UX-Architekt",
          "dependsRaw": "DR-13",
          "dependsOn": [
            "DR-13"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #774 (merged 2026-10-09T16:26:29Z); ersetzt: In Prüfung: Draft #774",
          "acceptance": "Sortiertests grün",
          "tickets": [
            "98fa8267"
          ],
          "prNumbers": [
            774,
            774
          ]
        },
        {
          "id": "DR-15",
          "title": "Sicherer Start ohne manuelle Secret-Eingabe; 15a Basismodul und CLI-Korrektur getrennt, 15b Einbindung nach DR-06 (Secrets über den Secret-Manager von AgentsRoom)",
          "owner": "Implementierer · Codex",
          "dependsRaw": "DR-15a-BASE, DR-15a-CLI (15b: DR-06)",
          "dependsOn": [
            "DR-06",
            "DR-15a-BASE",
            "DR-15a-CLI"
          ],
          "place": "Server",
          "tier": "A",
          "status": "In Prüfung",
          "statusRaw": "In Prüfung: Code von 15a-BASE (`cd3bffac`), 15a-CLI (`7ac5985e`) und 15b (`86eeb68d`, 09.10.) gemergt; Start-/Nutzerabnahme („Start ohne Eingabe“) Unbekannt (zu prüfen); ersetzt: In Prüfung: G1-Teilung tatsächlich geliefert, #647 und #639 gemergt; begrenzte 15a-Source gemeinsam integriert, 15b und gesamte Start-/Nutzerabnahme offen",
          "acceptance": "Basismodul und korrigierter CLI-Aufruf zusammen integriert; Start ohne Eingabe; kein Secret in Datei/Log/Commit; physische STATE-Pfadprüfung bleibt 15b",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            647,
            639
          ]
        },
        {
          "id": "DR-15a-BASE",
          "title": "Z1: exakt geprüftes Startmodul 5f501f1 erhalten; lexikalische Prüfung ohne Dateisystemauflösung",
          "owner": "vorhandener Implementierer · Codex",
          "dependsRaw": "DR-01; gemeinsame Abnahme mit DR-15a-CLI",
          "dependsOn": [
            "DR-01",
            "DR-15a-CLI"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #647 `5f501f1` durch Mergify am 08.10. 07:26:49 UTC gemergt (`cd3bffa`); Lieferung zusammen mit CLI, DR-15b Erledigt #750 (`86eeb68d`)",
          "acceptance": "unveränderter Head `5f501f1`, alter eigener prepush 22/188s Exit 0 und Reviewbelege erhalten; Draft auf #635; Lieferung erst mit CLI-Korrektur erfüllt",
          "tickets": [
            "868dbc83"
          ],
          "prNumbers": [
            647,
            750
          ]
        },
        {
          "id": "DR-15a-CLI",
          "title": "Z1: vorhandenen Alias-Entry-Fix getrennt abnehmen; bestehende Commits erhalten, keine Wiederholung",
          "owner": "derselbe Implementierer · Codex",
          "dependsRaw": "DR-15a-BASE",
          "dependsOn": [
            "DR-15a-BASE"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #639 `3bf5a8b` durch Mergify am 08.10. 08:09:55 UTC gemergt (`7ac5985`); kombinierte Source-Abnahme erhalten, DR-15b Erledigt #750 (`86eeb68d`)",
          "acceptance": "#639 auf Baseline retargetet, gleicher Head; Symlink/Junction und Node-24.0-Einstieg benannt rot→grün; eigener prepush am neuen Head Exit 0; Node >= 24 erhalten; zwei Vendoren außerhalb OpenAI am neuen Delta und Root-Abnahme",
          "tickets": [
            "f1a2ade9"
          ],
          "prNumbers": [
            639,
            750
          ]
        },
        {
          "id": "DR-15b",
          "title": "Startintegration nach Server; bestehendes Startmodul/Entry aus 15a, konkreten Dateischnitt vor Dispatch pinnen",
          "owner": "Chief weist einen Codex-Owner zu",
          "dependsRaw": "DR-06a und integrierte DR-15a-BASE/CLI",
          "dependsOn": [
            "DR-06a",
            "DR-15a-BASE"
          ],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #750 (merged 2026-10-09T01:52:45Z); ersetzt: In Prüfung: Draft #750",
          "acceptance": "loadStartConfig bei fehlender ROOT_AGENT_ID an 06a angleichen: Start verweigern statt nur Benachrichtigungen abschalten; physischer externer STATE-Pfad/H2 und Secret-Manager-Vertrag erhalten; Rot, eigene prepush/zwei Fremdreviews",
          "tickets": [
            "a463151a"
          ],
          "prNumbers": [
            750,
            750
          ]
        },
        {
          "id": "DR-SEC-01a",
          "title": "Erster begrenzter Schnitt zum Denkraum-Sicherheitsbefund; Quelle Root-Disposition 09.10.",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "Dateischnitt und Startvertrag aus Ticket b0221f4a vor Umsetzung",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt als Bericht: Bedrohungsmodell + Testlückenkarte (Server-Job srv-dr-sec-01a 09.10. 02:30Z, Bericht `~/pa-orch/reports/dr-sec-01a-a1d9a5fba38d.md`); Folgeschnitte 01b–01i",
          "acceptance": "Ticketbefunde mit Quellen disponieren; für Code Rot→Grün, eigene prepush und zwei Fremdvendor-Reviews; muss vor DR-16a landen",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": []
        },
        {
          "id": "DR-SEC-01b",
          "title": "Zweiter begrenzter Schnitt zum Denkraum-Sicherheitsbefund; Quelle Root-Disposition 09.10.",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "Abgrenzung zu DR-SEC-01a im Ticket vor Umsetzung",
          "dependsOn": [
            "DR-SEC-01a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #793 (gemergt 2026-10-09T01:38:35Z)",
          "acceptance": "konkrete Abnahme im Ticket b0221f4a erhalten; für Code Rot→Grün, eigene prepush und zwei Fremdvendor-Reviews; muss vor DR-16a landen",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            793
          ]
        },
        {
          "id": "DR-SEC-01c",
          "title": "Body-Limits und ungültiges UTF-8 absichern",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01b",
          "dependsOn": [
            "DR-SEC-01b"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #808 (gemergt 2026-10-09T03:36:26Z)",
          "acceptance": "Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews; vor DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            808
          ]
        },
        {
          "id": "DR-SEC-01d",
          "title": "Restliche P3/P6-Startkontrollen und EPERM-Guards",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01c",
          "dependsOn": [
            "DR-SEC-01c"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #823 (gemergt 2026-10-09T04:39:42Z)",
          "acceptance": "Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews; vor DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            823
          ]
        },
        {
          "id": "DR-SEC-01e",
          "title": "Pfad- und Rechtekontrollen absichern",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01b",
          "dependsOn": [
            "DR-SEC-01b"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #796 (gemergt 2026-10-09T01:45:37Z)",
          "acceptance": "Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews; vor DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            796
          ]
        },
        {
          "id": "DR-SEC-01f",
          "title": "Untrusted Failure-Inhalte aus CLI-Ausgabe halten",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01e",
          "dependsOn": [
            "DR-SEC-01e"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #806 (gemergt 2026-10-09T02:48:29Z)",
          "acceptance": "Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews; vor DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            806
          ]
        },
        {
          "id": "DR-SEC-01g-G1",
          "title": "Ownership-Primitive für das Denkraum-Ledger (Option A)",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01a Bericht; Design dr-sec-01g-design-49fd851ecbb6",
          "dependsOn": [
            "DR-SEC-01a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #811 (merged 2026-10-09T13:37:17Z); ersetzt: In Prüfung: Open #811",
          "acceptance": "Prozess-Konkurrenten und fehlgeschlagenes Takeover rot→grün; eigene prepush, zwei Fremdvendor-Reviews",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            811,
            811
          ]
        },
        {
          "id": "DR-SEC-01g-G2",
          "title": "Core-Enforcement hinter Ownership",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G1",
          "dependsOn": [
            "DR-SEC-01g-G1"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #866 (merged 2026-10-09T17:10:31Z); ersetzt: Geplant (Design-Bericht)",
          "acceptance": "P9 Rot→Grün; Mutationen/Migration geschützt; Notification-Lücke bleibt explizit",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            866
          ]
        },
        {
          "id": "DR-SEC-01g-G3",
          "title": "Notification-Ownership",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G2",
          "dependsOn": [
            "DR-SEC-01g-G2"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #873 (merged 2026-10-09T18:24:46Z); ersetzt: In Prüfung: Draft #873",
          "acceptance": "zweiter Prozess kann nicht senden; Flush serialisiert; bestehende Receipt-/Retry-Tests erhalten",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            873,
            873
          ]
        },
        {
          "id": "DR-SEC-01g-G4",
          "title": "Server-Lifecycle / Admission",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G3",
          "dependsOn": [
            "DR-SEC-01g-G3"
          ],
          "place": "Server",
          "tier": "A",
          "status": "invalid",
          "statusRaw": "Aufgeteilt G4a Signal-Stop / G4b Admission+Drain; ersetzt: Geplant (Design-Bericht)",
          "acceptance": "zweiter Listener mutiert/sendet nicht; Drain vor Release; Interface für DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": []
        },
        {
          "id": "DR-SEC-01g-G4a",
          "title": "Signal-Stop: Ownership freigeben",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G3",
          "dependsOn": [
            "DR-SEC-01g-G3"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #872 (merged 2026-10-09T18:24:41Z); ersetzt: In Prüfung: Draft #872",
          "acceptance": "Signal-Stop gibt Ownership frei",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            872,
            872
          ]
        },
        {
          "id": "DR-SEC-01g-G4b",
          "title": "Admission+Drain",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G4a",
          "dependsOn": [
            "DR-SEC-01g-G4a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #889 (merged 2026-10-09T19:45:58Z); ersetzt: In Prüfung: #889 (Runde 2)",
          "acceptance": "zweiter Listener mutiert/sendet nicht; Drain vor Release",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            889,
            889
          ]
        },
        {
          "id": "DR-SEC-01g-G5",
          "title": "DR-16-Adapter (G4-Lifecycle nutzen)",
          "owner": "DR-16a-Owner",
          "dependsRaw": "DR-SEC-01g-G4",
          "dependsOn": [
            "DR-SEC-01g-G4"
          ],
          "place": "Server",
          "tier": "A",
          "status": "invalid",
          "statusRaw": "in DR-16a gefaltet",
          "acceptance": "Root-Disposition 09.10.: kein eigener Schnitt; Abnahme über DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": []
        },
        {
          "id": "DR-SEC-01g-G6",
          "title": "Recovery-/Portability-Abnahme",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01g-G4",
          "dependsOn": [
            "DR-SEC-01g-G4"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #885 (merged 2026-10-09T19:22:15Z); Folge G6-FU Branch claude/g6-fu-tests; ersetzt: Geplant, Spec in Arbeit",
          "acceptance": "beobachteter Exit/Alias; Windows-Beleg; fehlender Heartbeat ≠ Exit",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            885
          ]
        },
        {
          "id": "DR-SEC-01h",
          "title": "P11/P12 UI- und Header-Tests",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-11/#718",
          "dependsOn": [
            "DR-11"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #859 (merged 2026-10-09T14:40:42Z); ersetzt: Geplant; nach #718",
          "acceptance": "UI-/Header-Kontrollen nach Harness-Port; eigene prepush",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            859,
            718
          ]
        },
        {
          "id": "DR-SEC-01i",
          "title": "Webhook-Fehler sanitizen und Security-Controls abdecken",
          "owner": "Root bindet einen Owner im Ticket",
          "dependsRaw": "DR-SEC-01f",
          "dependsOn": [
            "DR-SEC-01f"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #824 (gemergt 2026-10-09T04:51:19Z)",
          "acceptance": "Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews; vor DR-16a",
          "tickets": [
            "b0221f4a"
          ],
          "prNumbers": [
            824
          ]
        },
        {
          "id": "DR-16a",
          "title": "Umschalt-Helfer + Drill-Tests; nur tools/denkraum/switch.mjs + switch.test.mjs, kein Restore",
          "owner": "Root benennt einen vorhandenen Serverowner",
          "dependsRaw": "DR-SEC-01a/b gemergt; DR-SEC-01g-G4, DR-SEC-01h gemergt; DR-07 einschließlich 07c/d/e1/e2 (#752/#753/#751/#755), DR-14, DR-15 einschließlich 15b/#750 und UI-Verdrahtung #718 gemergt",
          "dependsOn": [
            "DR-07",
            "DR-14",
            "DR-15",
            "DR-SEC-01a",
            "DR-SEC-01g-G4",
            "DR-SEC-01h"
          ],
          "place": "Server",
          "tier": "A, zwei Fremdanbieter",
          "status": "Erledigt",
          "statusRaw": "Erledigt #863 (merged 2026-10-09T16:34:47Z); ersetzt: Geplant; kein Start aus PLAN-Pflege",
          "acceptance": "≤ 300 ALL; benannte DR16:-Tests rot→grün, node --test --test-name-pattern='^DR16:', npm run test:denkraum, eigene volle prepush, zwei Fremdvendor-Reviews am SHA/Disposition, Root-Abnahme",
          "tickets": [
            "b0e90b72"
          ],
          "prNumbers": [
            863
          ]
        },
        {
          "id": "DR-16a-H",
          "title": "Switch-Helfer-Härtung (Review-Nachbesserungen)",
          "owner": "Root bindet Owner",
          "dependsRaw": "DR-16a/#863",
          "dependsOn": [
            "DR-16a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #871 (merged 2026-10-09T18:24:31Z); ersetzt: In Prüfung: Draft #871 (Review-Runde 2)",
          "acceptance": "Tier A; Review-Runde 2 ausstehend",
          "tickets": [],
          "prNumbers": [
            871,
            871
          ]
        },
        {
          "id": "DR-16b",
          "title": "Live-Drill auf dem PC: Schreibpause, Sicherung, Umschalten, metadatensicherer Rückweg",
          "owner": "Stabschef Ausführung, ein Owner",
          "dependsRaw": "DR-16a gemergt sowie alle dessen Vorgänger; G6; Root-Livefreigabe für exakten SHA und Zeitfenster",
          "dependsOn": [
            "DR-16a"
          ],
          "place": "PC",
          "tier": "A plus unabhängiges Nachlesen",
          "status": "Verschoben",
          "statusRaw": "Verschoben: Auslöser v1.6.0 seit 09.10. erreicht, Nutzer-Zeitfenster am PC offen, neue Einordnung: Unbekannt (zu prüfen); ursprünglich: Nach v1.6.0 verschoben (Nutzer 09.10. ~19:42Z: Schritte, die der Nutzer am PC braucht, nach dem Release); Runbook bleibt (pa-orch/wissen/06-anleitungen/2026-10-09_dr16b-pc-drill-runbook.md); ersetzt: Live-Freigabe Nutzer 09.10. ~17:25Z, Probelauf wartet auf G4b/G6 und Nutzer-Zeitfenster; ersetzt: Blockiert bis G0; Kandidat auf v1.6.0 (d2582ceb) neu exportiert; Fenster mit dem Nutzer offen",
          "acceptance": "Gates G0–G7 im gebundenen Vertragsentwurf Ticket b0e90b72; G5 beide UI-Skripte HTTP 200; protokollierter Drill und unabhängige Prüfung; P1/aktuelles Ledger nach Writes erhalten, Root-Abnahme",
          "tickets": [
            "b0e90b72"
          ],
          "prNumbers": []
        },
        {
          "id": "DR-17",
          "title": "Öffentliche README, Anleitung in 5 Schritten, CHANGELOG-Abschnitt Denkraum",
          "owner": "Technischer Autor",
          "dependsRaw": "DR-17a-Entwurf laut Root 09.10. vorgezogen; Trockenlauf nach DR-16a-Merge und Root-Annahme des DR-16b-Protokolls",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #785 (merged 2026-10-09T20:37:12Z): Anleitung gemergt: #785 (gemergt 2026-10-09T20:37:12Z, Trockenlauf der fünf Schritte auf frischer Wegwerf-Instanz im PR-Text); CHANGELOG-Abschnitt final in V16-CHANGELOG; ersetzt: In Prüfung: Entwurf separat #785; Trockenlauf und Gesamt-Abnahme offen",
          "acceptance": "Trockenlauf der 5 Schritte im PR-Text; beide UI-Skripte HTTP 200; eigene prepush; No-Test: documentation only",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            785,
            785,
            785
          ]
        },
        {
          "id": "DR-17a",
          "title": "README-Abschnitt und Anleitung in fünf Schritten als Entwurf; Quelle Root-Disposition 09.10. / PR #785",
          "owner": "bestehender Owner `srv-dr-17a`",
          "dependsRaw": "Draft vor DR-16 erlaubt; Trockenlauf erst nach DR-16a und angenommenem DR-16b-Protokoll",
          "dependsOn": [
            "DR-16a"
          ],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #785 (gemergt 2026-10-09T20:37:12Z); ersetzt: In Prüfung: Draft #785",
          "acceptance": "≤ 150 ALL; eigene prepush; kein Laufzeit-/Startbeleg aus dem Text, bis Trockenlauf erfolgt Draft halten",
          "tickets": [
            "PLAN-SYNC-0910b"
          ],
          "prNumbers": [
            785,
            785
          ]
        }
      ],
      "problems": [],
      "counts": {
        "Geplant": 0,
        "Bereit": 0,
        "In Arbeit": 0,
        "In Prüfung": 1,
        "Erledigt": 50,
        "Blockiert": 0,
        "Verschoben": 1,
        "Entfallen": 2,
        "invalid": 2
      },
      "total": 56
    },
    {
      "id": "Z2",
      "title": "Setup und Entwicklung",
      "packages": [
        {
          "id": "Z2-PLAN-COMMIT",
          "title": "P2: v3 in kohärenten Paketen übernehmen; PLAN-C1 stellt Z1–Z4 vor den unveränderten historischen Parserbestand, danach getrennte Archiv-/Bereinigungsschnitte ≤ 300 ALL",
          "owner": "Stabschef",
          "dependsRaw": "Root-Abnahme je Kandidat",
          "dependsOn": [],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: PLAN-C1 #643 (merged 2026-10-08T05:46:58Z, `0a9a981d`, Kopf `1088909`), Statusnachtrag #646 (`a167486c`); #642 geschlossen als überholt (Nutzer 08.10.); weitere Bereinigungsschnitte ersetzt durch PLAN-CLEAN-1 bis -3 (15.10.); ersetzt: In Prüfung: PLAN-C1 #643 `1088909` tatsächlich 05:46:58 UTC gemergt; #642 geschlossen als überholt (Nutzer 08.10.), Originaldelta bleibt Historie, #646 ist bestehender Statusnachtrag; weitere Archiv-/Bereinigungsschnitte offen",
          "acceptance": "ein kanonischer Plan; DF-Zeilen bytegleich; M1–M5 parsebar; eigene prepush-Lane Exit 0; Archiv erst nach vollständigem Quellenvergleich bereinigen",
          "tickets": [
            "55ea21ce"
          ],
          "prNumbers": [
            643,
            646,
            642,
            643,
            642,
            646
          ]
        },
        {
          "id": "MAIN-PROTECT-01",
          "title": "P0 Sicherheit: geltenden Main-Mergevertrag mit effektivem GitHub-Schutz verankern; tatsächliche Wirkung abgenommen",
          "owner": "vorhandener Git-/CI-Owner; Chief disponiert, Root nimmt ab",
          "dependsRaw": "frische Schutz-/App-/Produkt-/Queuebelege; konkrete Root-Abnahme je Handlung; getrennt von GOALS-B",
          "dependsOn": [
            "GOALS-B"
          ],
          "place": "PC",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: Root-Finalabnahme 06:53:57 UTC; Rulesets A `24699347` und B `24700455` ACTIVE/exakt main, vier App-Checks ohne Checkbypass in A, nur App `10562` Update-Bypass in B; Chief-REST-Readback 10:20 bestätigt Konfiguration, Root-Beleg enthält tatsächliche geschützte Queue #635; keine erneute Produktivaktion",
          "acceptance": "vor jeder Einstellung leere Queue und echte Akteur-/Label-/Dispatch-Pause; vorhandene Produkte erhalten; exakter vierter App-Kontext (nichtpassendes Doku-Paket nur belegtes NEUTRAL); voller Windows-Batch und getrennte Root-A/B-Abnahme",
          "tickets": [
            "52f46527"
          ],
          "prNumbers": [
            635
          ]
        },
        {
          "id": "Z2-RULE10",
          "title": "P2: konkrete bereits erteilte Nutzerfreigaben erhalten; keine Rechteausweitung; Geld, Passwörter und Releases bleiben beim Nutzer",
          "owner": "Stabschef",
          "dependsRaw": "#643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); gemeinsam mit GOALS-B",
          "dependsOn": [
            "Z2-PLAN-COMMIT",
            "GOALS-B"
          ],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: Root-abgenommener #644 `4032800` am 08.10. 07:12:55 UTC gemergt, nach #643; allgemeine Sitzungsadoption nicht daraus abgeleitet",
          "acceptance": "freigegebene Handlung nicht erneut erfragen; keine abgeleitete Pauschalfreigabe; eigene prepush-Lane Exit 0; Root-Abnahme",
          "tickets": [
            "52f46527"
          ],
          "prNumbers": [
            644,
            643
          ]
        },
        {
          "id": "HOOK-WIN",
          "title": "P1: Windows-Hook-Reparatur und echte Unix-Quote-Korrektur integrieren; abgeschlossene Home-Reparaturen erhalten",
          "owner": "vorhandener Implementierer · Claude; Chief koordiniert",
          "dependsRaw": "vorhandene Runtime-/Rot-/Gate-/Vendor-Belege; finaler PR-Bericht vor Ready",
          "dependsOn": [],
          "place": "PC",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: Root-abgenommene Source #641 `bf89c435`/292 ALL am 08.10. 06:10:42 UTC gemergt; Home-Wirksamkeit nur durch separate jeweilige Runtimebelege, keine neue pauschale Behauptung",
          "acceptance": "eigene Windows-prepush 21/295s Exit 0; tatsächliche Google- und OpenAI-Reviews mit Autorgrenzen/Disposition; Root-Abnahme; Merge und Home-Wirksamkeit getrennt berichten",
          "tickets": [
            "b14492cb"
          ],
          "prNumbers": [
            641
          ]
        },
        {
          "id": "HOOK-WIN-DOC",
          "title": "P2: erhaltene 33-ALL-Hookanleitung liefern; Größenlimit der Source-Reparatur wahren",
          "owner": "derselbe Implementierer · Claude",
          "dependsRaw": "HOOK-WIN; eigener Docs-Head",
          "dependsOn": [
            "HOOK-WIN"
          ],
          "place": "PC",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #645 `094e2db`, 33 ALL, eigene Windows-prepush 21/456s Exit 0 und Root-Abnahme; tatsächlich nach #641 am 08.10. 07:13:16 UTC gemergt",
          "acceptance": "nur `docs/setup/codex.md`, erhaltener Hunk unverändert, eigener prepush Exit 0; Draft auf #641; erst nach Source-Merge retargeten/abnehmen",
          "tickets": [
            "fc99616e"
          ],
          "prNumbers": [
            645,
            641
          ]
        },
        {
          "id": "GOALS-A",
          "title": "P1 jetzt: Ist-Abgleich früherer Aufträge, realer Native-Goals, laufender Owner und PLAN; verhindert Doppelstarts und unbelegte Abschlüsse",
          "owner": "Stabschef; Root nimmt ab",
          "dependsRaw": "bestehende Übergaben und eigene Goal-Werkzeuge je Session",
          "dependsOn": [],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: begrenztes Ist-Abgleich-Handover von Root 02:56 UTC angenommen; Chief-Native-Abschluss 02:57:37 belegt, spätere Koordination hat eigenes aktives Ziel",
          "acceptance": "eine Zeile je Live-Agent: Ziel, eigener get/create-Beleg oder belegte Nichtverfügbarkeit plus Ticketziel, Meilenstein und Grenze; kein Plantext als Goal-Beleg",
          "tickets": [
            "52f46527"
          ],
          "prNumbers": []
        },
        {
          "id": "GOALS-B",
          "title": "P2: Rollen-Goals, Anpassung, Grenzen und selektive Rekursion in AGENTS.md, projecta-workflow und Übergabevorlage verankern; nur Prozessdoku, kein Runtime-Ausbau",
          "owner": "Stabschef als Editor; Root nimmt ab",
          "dependsRaw": "#643 (Schnitt PLAN-C1 von Z2-PLAN-COMMIT, Merge `0a9a981d`); Z2-RULE10 im selben Dokumentationspaket",
          "dependsOn": [
            "Z2-PLAN-COMMIT",
            "Z2-RULE10"
          ],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: Root-abgenommenes Dokumentationspaket #644 `4032800` tatsächlich 07:12:55 UTC gemergt; vier bestehende Skills gespeichert/zurückgelesen; Adoption bleibt ausschließlich sitzungsweise belegt, keine allgemeine Wirksamkeitsbehauptung",
          "acceptance": "≤ 300 ALL; Anforderungen GOALS-01 2–7 erhalten; 1 zusätzliche Selbstprüfung, 2. nur konkreter Restmangel; Stops und unabhängige Reviews/Nutzerfreigaben unverändert; prepush Exit 0",
          "tickets": [
            "52f46527"
          ],
          "prNumbers": [
            644
          ]
        },
        {
          "id": "GOALS-C",
          "title": "P2 begleitend: drei vorhandene Praxisproben Lane F, DR-02 und HOOK-WIN auswerten; Stichprobe, kein Wirksamkeitsbeweis; keine neuen Jobs/QA/Benchmarks",
          "owner": "ausführende Owner dokumentieren; Root bewertet",
          "dependsRaw": "vorhandene Fix-, Review- und Runtimebelege",
          "dependsOn": [],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt: genau drei Proben samt Messlücken von Root 02:56 UTC angenommen; selektive Nutzung, kein vierter Versuch aus späteren Fixes",
          "acceptance": "je Ticket Mangel/kein Mangel, Bestätigung, beobachtete Regressionen, nur gemessener Zusatzaufwand; bei überwiegendem Aufwand Anwendung begrenzen",
          "tickets": [
            "52f46527",
            "55ea21ce",
            "b14492cb"
          ],
          "prNumbers": []
        },
        {
          "id": "DEV-KNOW-01",
          "title": "P2: freigegebenen EIN-Thema-Wissenspilot begrenzt auswerten; Quellenindex gegen zwölf Karten, kein Ausbau ohne belegten Nutzen",
          "owner": "einziger Messowner Implementierer · Codex `8qyt6d`; Chief übernimmt Bericht, Root nimmt ab",
          "dependsRaw": "Vorbereitung #651 `1205081` angenommen; eingefrorene neun Quellen und fünf Fragen; Z1-Slots frei halten",
          "dependsOn": [],
          "place": "private leichte Messroute",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen); bisheriger begrenzter Messschnitt erledigt: 20+6-Originalübergabe samt Korrekturappend Root-ACCEPT 09:22:35 (`198949e8`); rationale-only-Nachtrag separat ACCEPT 10:10:29 (`1dbb4ebb`, operative REPORT `8f3f0796`, Input `20c2571d`, Assessment `71d3d6df`, Handover `b5c7a645`), Originale erhalten; eigene Mess-/Koordinationsgoals COMPLETE; kein konsistenter Nettoqualitätsgewinn, Quellenindex empfohlen; keine neue Messung/automatische Übernahme",
          "acceptance": "getrennte Claude-/Codex-Vergleiche, gleiche Fragen/Revisionen und Parameter je Anbieter; Qualität/Kontext/Sucharbeit/Pflege mit Messlücken, sechs begrenzte Fälle; Nullbefund zulässig, keine automatische Übernahme",
          "tickets": [
            "57979887"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-REGELN",
          "title": "Regelwerk 2.0: Lane-A-Korrekturen (6) abschließen, Anweisungsdateien entschlacken (Lane C, Commit 6918bea), Altlasten-Audit liefert „Deine Regeln: bestätigen oder ändern“",
          "owner": "Stabschef + Codebase Archäologe",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "egal",
          "tier": "C",
          "status": "Blockiert",
          "statusRaw": "Blockiert: Lane-C-Teil entfallen (Commit `6918bea` nur in #642, geschlossen 08.10., PR-ALT) → Z2-AGENTS-SLIM; Lane-A-Korrekturen: Unbekannt (zu prüfen), kein PR seit 08.10.; wartet auf R1–R5 (Inbox); ersetzt: In Arbeit",
          "acceptance": "Lane-C-PR gemergt; `npm run dev:agent-check` Exit 0; Regel-Vorschläge R1–R5 in der Inbox entschieden",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            642
          ]
        },
        {
          "id": "DOC-OPERATORS",
          "title": "Operatoren-Katalog und Briefvertrag in AGENTS.md und beiden projecta-workflow-Skills verankern",
          "owner": "bestehender Root-Serverjob; kein zweiter Anweisungseditor",
          "dependsRaw": "konkrete Disposition zu #642 erhalten",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #683 (merged 2026-10-08T15:42:28Z)",
          "acceptance": "nur Abschnitt vor Detailed operating reference und Skill-Dateiende; ≤ 300 ALL, eigene prepush, Regeln/Freigaben unverändert",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            683
          ]
        },
        {
          "id": "Z2-AGENTS-SLIM",
          "title": "AGENTS.md auf etwa ≤ 8 KB reduzieren: Kernregeln, Befehle und Merge-Kurzregel erhalten, Referenzdetails per eindeutigem Pfad auslagern",
          "owner": "ein von Stabschef Ausführung benannter Doku-Owner; Chief pflegt nur PLAN",
          "dependsRaw": "DR-12 gemergt/abgenommen; DOC-OPERATORS integriert; #642 geschlossen (Nutzer 08.10.); frischer Dateischnitt/Owner",
          "dependsOn": [
            "DR-12",
            "DOC-OPERATORS"
          ],
          "place": "Server",
          "tier": "C",
          "status": "Bereit",
          "statusRaw": "Bereit seit DR-12 (09.10.), nicht gestartet (kein PR); Größenbasis im Startvertrag veraltet (AGENTS.md am 15.10. auf `c9d4ca35`: 28903 Bytes) — vor Start neu schneiden und gegen KONZEPT-0 abgrenzen; ersetzt: Bereit nach DR-12; Owner/Guard und Root-Zuweisung vor Ausführung",
          "acceptance": "AGENTS.md plus eindeutige docs/development/AGENTS_REFERENCE.md; bestehende Referenzen nur lesen; globale CLAUDE/MEMORY und Standard-Skills ausgenommen; Regel-für-Regel-Mapping, Linkcheck, dev:agent-check und eigene prepush Exit 0; ≤ 300 ALL, sonst vor Start serielle Schnitte; Byteziel ist kein Token-/Wirksamkeitsbeleg",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-RECHTE",
          "title": "Konsolidiertes Rechtekonzept V3, Herkunft und Disposition erhalten",
          "owner": "Konzeptowner lz0jwp; finale Konzeptabnahme Root",
          "dependsRaw": "privates Bundle V3 `B368BB476E8E`; E1–E5 entschieden",
          "dependsOn": [],
          "place": "bestehender Konzept-Arbeitsort",
          "tier": "C",
          "status": "invalid",
          "statusRaw": "Konzept von Root nach Fable-CONCUR abgenommen (08.10., 15:23Z); E5 bestätigt 15:26Z; keine technische Aktivierung",
          "acceptance": "vier Original-/Kopie-Paare gegen Manifest geprüft; Umsetzung nur über folgende getrennte Schnitte; E2-Schreibhost noch zu benennen",
          "tickets": [
            "b2f36f8a"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-RECHTE-P1",
          "title": "Ein privater Quellen-/Rechte-/Dispositionseintrag für den ausgewählten Werkzeugfall; Originaltexte und Ersetzungslinks erhalten",
          "owner": "bestehender Konzeptowner lz0jwp; Ausführungskoordination beim neuen Stabschef",
          "dependsRaw": "V3 + E5; konkreter privater Zielpfad und Ausgangsdigest vor Start festhalten",
          "dependsOn": [],
          "place": "privater bestehender Wissensbereich",
          "tier": "C",
          "status": "invalid",
          "statusRaw": "Geschnitten, noch nicht gestartet; Dokumentation, keine Settings-/Rechteaktivierung; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen)",
          "acceptance": "≤ 300 ALL; Quelle/Datum/Digest, ursprünglicher Scope, geltende Disposition, Projektion, Owner, fehlende Belege und nächster Schritt; Reset-, alte RH-C9- und Force-push-Ersetzungen getrennt; QA bleibt ausdrücklich beauftragt; kein privater Wortlaut in Git/PR",
          "tickets": [
            "b2f36f8a"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-RECHTE-PILOT",
          "title": "Ein realer rust-analyzer/rust-src-Fall: manuelle Baseline gegen Shadow-Vorbereitung vergleichen",
          "owner": "neuer Stabschef benennt bestehenden Werkzeugowner und genau einen tatsächlichen Schreibhost vor Zulassung; Root nimmt Shadow ab",
          "dependsRaw": "P1; frischer Toolchain-/Client-/Komponenten-/PATH-/Home-Beleg, Quellenbindung und freie Eigentümerschaft",
          "dependsOn": [],
          "place": "tatsächlicher Windows-Zielhost, noch ungebunden",
          "tier": "C für Messbericht; technische Folgedeltas nach Dateien neu einstufen",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Owner/Host fehlen weiter; keine technische Aktivierung; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "≤ 300 ALL je Schnitt; ein gepaarter Nicht-Z2-Fall, Zeit-/Aufrufbelege einschließlich Vorbereitung/Prüfung/Nacharbeit/Recovery; Netto-Nutzen > 0 und > gemessene Vergleichsunsicherheit, sonst nicht belegt; negative Shadow-Fälle keine Laufzeit-PASS; tatsächlicher Effekt erst separat nach Shadow-Abnahme, danach installiert/geladen/funktional getrennt belegen",
          "tickets": [
            "b2f36f8a"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-PLANPARSER",
          "title": "hq-parse.mjs, dev-hq.mjs und hygiene.mjs lesen die Z-Tabellen (Spalte Status, 8 Werte); danach Anhang B entfernen",
          "owner": "Implementierer · Claude",
          "dependsRaw": "Z2-PLAN-COMMIT",
          "dependsOn": [
            "Z2-PLAN-COMMIT"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #697 (merged 2026-10-08T17:43:37Z)",
          "acceptance": "`npm run test:hq` Exit 0; HQ zeigt Z1–Z4; prepush Exit 0",
          "tickets": [],
          "prNumbers": [
            697
          ]
        },
        {
          "id": "Z2-DOKSYNC",
          "title": "KNOWN_ISSUES.md „Offen“ bereinigen: KI-15, KI-16, KI-20 mit PR-Beleg; KI-33 bleibt „Kandidat“, bis ein Windows-Queue-Lauf mit der Änderung beobachtet ist",
          "owner": "bestehender Root-Serverjob, kein zweiter Owner",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #670 (merged 2026-10-08T14:34:08Z)",
          "acceptance": "Jede verschobene Zeile nennt PR und Merge; KI-33 nur mit Windows-Queue-Lauf-ID und Dauer nach „Behoben“; precommit-Lane Exit 0",
          "tickets": [
            "051bdfa0"
          ],
          "prNumbers": [
            670
          ]
        },
        {
          "id": "Z2-AUTOSTART",
          "title": "Denkraum startet nach der Windows-Anmeldung von selbst, ohne Secret-Eingabe",
          "owner": "Desktop-App-Entwickler",
          "dependsRaw": "DR-15, DR-06",
          "dependsOn": [
            "DR-06",
            "DR-15"
          ],
          "place": "PC",
          "tier": "A",
          "status": "Geplant",
          "statusRaw": "Geplant; seit 08.10. ohne PR oder Beleg; hängt an der offenen Start-/Nutzerabnahme von DR-15",
          "acceptance": "PC-Neustart → `127.0.0.1:4791` antwortet ohne Eingabe; kein Secret im Klartext",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z2-PACER",
          "title": "Pacer läuft: Trigger mit Werkzeugen, aber nur lesend; Bericht alle 20 min",
          "owner": "Stabschef",
          "dependsRaw": "Inbox R5",
          "dependsOn": [],
          "place": "PC",
          "tier": "C",
          "status": "Blockiert",
          "statusRaw": "Blockiert: wartet auf R5 (Inbox R1–R5); seit 08.10. ohne PR oder Beleg",
          "acceptance": "drei Läufe nacheinander mit Bericht, keine Schreibaktion",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z2-REVIEW",
          "title": "Zwei feste Fremdanbieter-Wege für Stufe A: Gemini/Cursor auf dem Server (Workspace Trust), Ollama Kimi K3 + GLM, Codex; je Weg eine Probe mit beobachtetem Modell",
          "owner": "Root disponiert Fremdvendor-Reviews; Git-/CI-Owner qualifiziert Wege",
          "dependsRaw": "WT entschieden (F1, 08.10.); Modell-/Head-Belege weiter Pflicht",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "invalid",
          "statusRaw": "Root übernimmt Tier-A-Zweitanbieter über vorhandenen Ollama-GLM/Kimi-Weg laut Übergabe; kein Google-Folgelauf, Modell-/Head-Belege weiter Pflicht; Reviewerzahl und -familien jetzt durch `docs/decisions.md` „Reviewer count per tier“ (15.10.) geregelt, Ollama-Paar bis 01.11. gesperrt; Wegeprobe je Weg (Abnahme): Unbekannt (zu prüfen)",
          "acceptance": "Probe je Weg mit Modellname und Zeit; Weg in `docs/setup/` beschrieben",
          "tickets": [
            "c77f6955"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-RAM",
          "title": "RAM-/Server-Standard: schwer = Server; PC nur leicht bei ≥ 1,5 GiB; idle Konsolen schließen; RAM-Wächter",
          "owner": "Autonomer Optimierungsarchitekt",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "PC + Server",
          "tier": "C",
          "status": "Geplant",
          "statusRaw": "Geplant; seit 08.10. ohne PR oder Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen)",
          "acceptance": "24 h ohne „local heavy STOP“, Messung im Ticket",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z2-RAM-SLOTS",
          "title": "Konfigurierten Warm-Slot-Root im bestehenden build-slot beachten; keine zweite RAM-Messung",
          "owner": "Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/build-slot.mjs` und eigener Test",
          "dependsRaw": "Basis `fc85e3d`, unabhängig von DR-04B-FU und HYGIENE",
          "dependsOn": [
            "DR-04B-FU"
          ],
          "place": "Server",
          "tier": "A (Start-/Ressourcenempfehlung)",
          "status": "Erledigt",
          "statusRaw": "Erledigt #725 (merged 2026-10-09T12:34:55Z); ersetzt: In Prüfung: Draft #725; E1 vom 09.10. erlaubte genau eine dritte Runde nur zum Delta",
          "acceptance": "≤ 180 ALL; kompilierendes Rot, Root-/Override-/Fehler- und belegte-Slot-Fälle; bestehende Schwellen/Heuristiken erhalten; eigene prepush + zwei Fremdvendor-Reviews am Kandidaten",
          "tickets": [],
          "prNumbers": [
            725,
            725
          ]
        },
        {
          "id": "Z2-HYGIENE-STATUS",
          "title": "Aktuelle Draft-/Ready-/In-Arbeit-Zeilen im lesenden Hygiene-Werkzeug erkennen",
          "owner": "Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/hygiene.mjs` und eigener Test",
          "dependsRaw": "Basis `fc85e3d`, unabhängig von beiden anderen Reservepaketen",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #726 (merged 2026-10-08T23:30:10Z)",
          "acceptance": "≤ 160 ALL; benanntes kompilierendes Rot, Kandidaten-PR-Nummern von Vorgänger-/historischen Nummern trennen; keine Board-/PLAN-/GitHub-Schreibwirkung; eigene prepush + Fremdreview am Kandidaten",
          "tickets": [],
          "prNumbers": [
            726
          ]
        },
        {
          "id": "Z2-PR-PROTECTION",
          "title": "Merge-Protection in lesender PR-Bereitempfehlung berücksichtigen",
          "owner": "Root benennt bestehenden Serverworker; Dateipaar unten exklusiv",
          "dependsRaw": "main `9d9eaa7`; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #738 (merged 2026-10-09T00:09:16Z)",
          "acceptance": "≤ 160 ALL; benanntes Rot, Protection-Fälle und Queue-Fakt; volle prepush und Fremdreview",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            738
          ]
        },
        {
          "id": "Z2-STATUS-UNKNOWN",
          "title": "Unbekannte CI-Kontexte und fehlende Checks nicht als grün darstellen",
          "owner": "Root benennt bestehenden Serverworker; Dateipaar unten exklusiv",
          "dependsRaw": "main `9d9eaa7`; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #739 (merged 2026-10-08T22:50:42Z)",
          "acceptance": "≤ 140 ALL; benanntes Rot und Bericht-Fixtures; volle prepush und Fremdreview",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            739
          ]
        },
        {
          "id": "Z2-START-MEASURE",
          "title": "Ungültige RAM-/Usage-Messwerte und leere Usage-Datei verweigern",
          "owner": "Root benennt bestehenden Serverworker; Dateipaar unten exklusiv",
          "dependsRaw": "main `9d9eaa7`; unabhängig von RAM-SLOTS #725",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #742 (merged 2026-10-08T22:36:59Z)",
          "acceptance": "≤ 160 ALL; benanntes Rot, CLI Exit 1, gültige Defaults erhalten; volle prepush und zwei Fremdvendor-Reviews",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            742
          ]
        },
        {
          "id": "Z2-CIWATCH-SHAPE",
          "title": "Ungültige Check-Objekte als Lesefehler verweigern statt abstürzen",
          "owner": "Root benennt bestehenden Serverworker; Dateipaar unten exklusiv",
          "dependsRaw": "main `9d9eaa7`; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #745 (merged 2026-10-09T00:09:09Z)",
          "acceptance": "≤ 140 ALL; benanntes Rot, Exit 3 ohne Folgepoll/Grün; volle prepush und Fremdreview",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            745
          ]
        },
        {
          "id": "Z2-MRP-COMPLETE",
          "title": "Teilweise ausgefülltes Prompt-Log nicht als vollständigen Messbeleg zählen",
          "owner": "Root benennt bestehenden Serverworker; Dateipaar unten exklusiv",
          "dependsRaw": "main `9d9eaa7`; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #746 (merged 2026-10-08T22:55:35Z)",
          "acceptance": "≤ 120 ALL; benanntes Rot, Zähler-/Bench-Fixture, Nullbefund gültig; volle prepush und Fremdreview",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            746
          ]
        },
        {
          "id": "Z2-ROUTE",
          "title": "Verteilung nach Verbrauchstempo über usage_overview; Quota-Regeln erneuern; Officer-Routine neu anmelden",
          "owner": "Stabschef Ausführung beobachtet/routet; keine eigenmächtige Quota-Regeländerung",
          "dependsRaw": "Nutzer: Re-Login",
          "dependsOn": [],
          "place": "PC",
          "tier": "C",
          "status": "Geplant",
          "statusRaw": "Geplant: Routing-Regel steht in AGENTS.md „Routing“ (AP-6a, `2648f097`, 14.10.); Wochenbeleg und Abdeckung von Z2-ROUTE: Unbekannt (zu prüfen)",
          "acceptance": "eine Woche ohne Anbieter am Limit; Routing-Beleg je Start",
          "tickets": [
            "492a9e36"
          ],
          "prNumbers": []
        },
        {
          "id": "Z2-BOARD",
          "title": "Board aufräumen: erledigte/veraltete Tickets schließen (ef39c814, 2720b77f, 5945accc, 5de5c4c9, 7b66731d), Kurzstand-Block je Ticket, Ready-Queue ≥ 5 pflegen",
          "owner": "Stabschef Ausführung: Ready-Reserve, Lane-/Blocker-Beobachtung; Chief nur PLAN",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "egal",
          "tier": "–",
          "status": "Bereit",
          "statusRaw": "Bereit; seit 08.10. ohne Beleg, Einordnung (v2.x, Später oder Entfallen): Unbekannt (zu prüfen)",
          "acceptance": "`backlog_list`: keine erledigten Tickets mehr offen",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "MERGIFY-REPORT-REGEX",
          "title": "Berichtsschutz um aktuelle Paket-Branches erweitern",
          "owner": "abgeschlossener Root-Job",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "B laut Root-Abnahme #768",
          "status": "Erledigt",
          "statusRaw": "Erledigt #768 (merged 2026-10-09T00:33:52Z)",
          "acceptance": "Mergebeleg per gh pr view; Statistik-Folgepunkt getrennt in MRP-REGEX-SCRIPTS",
          "tickets": [
            "aa1238e6"
          ],
          "prNumbers": [
            768
          ]
        },
        {
          "id": "DOCS-SYNC-0910",
          "title": "Agenten-Dokumentation und Queue-Hinweise angleichen",
          "owner": "abgeschlossener Root-Job",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #764 (merged 2026-10-09T00:33:57Z)",
          "acceptance": "Mergebeleg per gh pr view; restliche BUGS-Zeilen bleiben eigener Schnitt",
          "tickets": [
            "#764"
          ],
          "prNumbers": [
            764
          ]
        },
        {
          "id": "HOTFIX-HYGIENE-VERBS",
          "title": "Git-Globaloptionen in Hygiene-Testguards vor Verbprüfung entfernen",
          "owner": "abgeschlossener Root-Job",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "C laut Root-Abnahme #777",
          "status": "Erledigt",
          "statusRaw": "Erledigt #777 (merged 2026-10-09T00:33:23Z)",
          "acceptance": "Mergebeleg per gh pr view; echte Schreibbefehle bleiben im Guard erkennbar",
          "tickets": [
            "#777"
          ],
          "prNumbers": [
            777
          ]
        },
        {
          "id": "MRP-REGEX-SCRIPTS",
          "title": "Paketregex in mrp-count und bench-weekly an #768 angleichen; Root-Disposition 09.10.",
          "owner": "bestehender Owner `srv-mrp-regex-scripts`",
          "dependsRaw": "MERGIFY-REPORT-REGEX/#768",
          "dependsOn": [
            "MERGIFY-REPORT-REGEX"
          ],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #782 (merged 2026-10-09T01:26:43Z); ersetzt: In Prüfung: Draft #782",
          "acceptance": "benannte Regex-Regressionen rot→grün, Zählerverträge erhalten, eigene prepush/Fremdreview und Root-Abnahme",
          "tickets": [
            "46800384"
          ],
          "prNumbers": [
            782,
            782
          ]
        },
        {
          "id": "MATRIX-RECONCILE",
          "title": "Alle 27 Matrixzeilen mit datierten Belegen und offenen Resten abgleichen; Root-Disposition 09.10.",
          "owner": "bestehender Owner `srv-matrix-reconcile`",
          "dependsRaw": "bestehende Belege; Continuous bleibt aus",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #781 (merged 2026-10-09T01:17:02Z); ersetzt: In Prüfung: Draft #781",
          "acceptance": "Anforderungen unverändert, kein erfundener Laufzeit-PASS; eigene prepush und Root-Abnahme",
          "tickets": [
            "a6a28ae8"
          ],
          "prNumbers": [
            781,
            781
          ]
        },
        {
          "id": "Z2-REVIEW-FOLLOWUPS-1",
          "title": "Review-Folgepunkte gemäß Root-Disposition 09.10. bündeln und abgrenzen",
          "owner": "Root bindet vorhandenen Owner",
          "dependsRaw": "konkrete Findings, Dateien und Abnahme vor Dispatch binden",
          "dependsOn": [],
          "place": "Server",
          "tier": "nach Dateischnitt festlegen",
          "status": "Erledigt",
          "statusRaw": "Erledigt #800 (merged 2026-10-09T02:07:35Z, `15305c2e`); ersetzt: Geplant; kein neuer Worker aus PLAN-Eintrag",
          "acceptance": "jeder Folgepunkt mit Quelle/Disposition; ≤ 300 ALL je Paket, keine erneute Abnahmebehauptung",
          "tickets": [
            "PLAN-SYNC-0910b"
          ],
          "prNumbers": [
            800
          ]
        },
        {
          "id": "CI-SPLIT-LINUX",
          "title": "Linux-Gates teilen, Pflichtcheck zusammenführen",
          "owner": "srv-ci-split-linux",
          "dependsRaw": "bestehender Gate-Vertrag",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1560 (merged 2026-10-15T16:56:24Z, `a8aef6da`); ersetzt: In Arbeit: läuft (Server-Auftrag srv-ci-split-linux), Branch `codex/ci-split-linux`",
          "acceptance": "Gate-Abdeckung unverändert; prepush, Reviews, Root",
          "tickets": [
            "OPT-CI-0"
          ],
          "prNumbers": [
            1560
          ]
        },
        {
          "id": "OPT-PIPE-0",
          "title": "Durchlauf ausschließlich lesend messen",
          "owner": "srv-opt-pipeline; Root klärt Basis",
          "dependsRaw": "korrekte Auftragsbasis",
          "dependsOn": [],
          "place": "Server",
          "tier": "C (Bericht)",
          "status": "Blockiert",
          "statusRaw": "Blockiert: geplant nach Basisklärung; Server-Auftrag srv-opt-pipeline endete 16:12 MESZ wegen HEAD-Abweichung",
          "acceptance": "Messbericht mit Methode und Einheiten; keine Implementierung",
          "tickets": [
            "OPT-PIPE-0"
          ],
          "prNumbers": []
        },
        {
          "id": "CI-SEC-CODEQL",
          "title": "CodeQL-Alarm 57 (docs/diagrams/export-svg.mjs) schließen; Code-Fix für Alarm 59 versucht",
          "owner": "Root",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1581 (merged 2026-10-15T18:25:41Z, `ded1eef5`); Alarm 57 laut GitHub Code Scanning `fixed`",
          "acceptance": "Alarm 57 geschlossen",
          "tickets": [],
          "prNumbers": [
            1581
          ]
        },
        {
          "id": "CI-SEC-CODEQL-2",
          "title": "CodeQL-Alarme 59 und 60 (actions/cache-poisoning, .github/workflows/ci.yml)",
          "owner": "Root; `.github/` gehört laut CODEOWNERS dem Nutzer",
          "dependsRaw": "Nutzerentscheid CODEQL-59-60",
          "dependsOn": [],
          "place": "–",
          "tier": "B",
          "status": "Blockiert",
          "statusRaw": "Blockiert: Nutzerentscheid CODEQL-59-60 offen; lesende Prüfung läuft (laut Root 15.10.); Alarm 59 blieb nach #1581 laut GitHub offen",
          "acceptance": "beide Alarme geschlossen oder begründet als Fehlalarm abgewiesen",
          "tickets": [],
          "prNumbers": [
            1581
          ]
        },
        {
          "id": "FU-1015",
          "title": "Nachläufer aus den Reviews vom 15.10.: #1551 G3 (KR-09m), #1556 K4 und toter CSS-Rest (KR-08a), #1560 K2 (CI-SPLIT-LINUX), #1561 G2 (DS-01), #1568 Lows (FABRIK-TAB-1), #1569 B1/B3 (KR-04a), #1581 K1/K3–K5 (CI-SEC-CODEQL)",
          "owner": "Root disponiert",
          "dependsRaw": "jeweiliger Eltern-PR gemergt",
          "dependsOn": [],
          "place": "–",
          "tier": "je Punkt",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert (laut Root, Stand 15.10.)",
          "acceptance": "je Punkt eigenes Paket ≤ 300 Zeilen mit eigener Abnahme",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "OPS-CLOUD-PREFLIGHT",
          "title": "Vorabprüfung für den Codex-Cloud-Weg vor jedem Auftrag (laut Root 15.10.; Datei: Unbekannt (zu prüfen))",
          "owner": "Root disponiert",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert (15.10.)",
          "acceptance": "Abnahme vor Dispatch festlegen",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "OPS-JOB-ENDZEILE",
          "title": "Endzeile jedes Auftrags nennt private Abrechnungs- und Token-Messwerte; keine Werte im öffentlichen Repo (laut Root 15.10.; Datei: Unbekannt (zu prüfen))",
          "owner": "Root disponiert",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert (15.10.)",
          "acceptance": "Abnahme vor Dispatch festlegen",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "OPS-AUTO-LOCK",
          "title": "Auto-Skript: doppelte Sperre (laut Root 15.10. „duplicate lock“; genaue Bedeutung und Datei: Unbekannt (zu prüfen))",
          "owner": "Root disponiert",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert (15.10.)",
          "acceptance": "Abnahme vor Dispatch festlegen",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z2-STATUS-CI",
          "title": "main-Gates nicht durch jüngeren grünen CodeQL-Lauf verdecken; gemischte Workflow-Fixture; exklusiv scripts/dev/status-report.mjs + scripts/lib/dev-status-report.test.mjs",
          "owner": "Root/Stabschef benennt einen vorhandenen Owner",
          "dependsRaw": "main a8f0032; unabhängig",
          "dependsOn": [],
          "place": "Codex Cloud Node 20 möglich; Server Node 24",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #773 (merged 2026-10-09T00:48:18Z)",
          "acceptance": "benanntes Rot: ältere rote CI + jüngeres grünes CodeQL bleibt sichtbarer CI-Blocker; bestehende Zeit-/Zeilenlimitfälle erhalten",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            773
          ]
        },
        {
          "id": "Z2-SETUP-VERSION",
          "title": "Nicht-endliche/ungültige Node-Versionsangaben dürfen Pflichtcheck nicht grün machen; exklusiv scripts/dev/agent-setup-check.mjs + scripts/lib/agent-setup-check.test.mjs",
          "owner": "Root/Stabschef benennt einen vorhandenen Owner",
          "dependsRaw": "main a8f0032; unabhängig",
          "dependsOn": [],
          "place": "Codex Cloud Node 20 möglich; Server Node 24",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #772 (merged 2026-10-09T00:48:05Z)",
          "acceptance": "benanntes Rot: Infinity/ungültige Majorversion fail; echte Node 24 bleibt ok, fehlende optionale Programme weiterhin nur Warnung",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            772
          ]
        },
        {
          "id": "Z2-ERLEDIGT-META",
          "title": "Fehlerhafte Merge-Metadaten vor Tabellenwrite ablehnen; exklusiv scripts/dev/erledigt-row.mjs + scripts/lib/dev-erledigt-row.test.mjs",
          "owner": "Root/Stabschef benennt einen vorhandenen Owner",
          "dependsRaw": "main a8f0032; unabhängig",
          "dependsOn": [],
          "place": "Codex Cloud Node 20 möglich; Server Node 24",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #769 (merged 2026-10-09T00:48:09Z)",
          "acceptance": "benanntes Rot: ungültiges mergedAt erzeugt keine NaN-Datumszeile/keinen Write; gültiges UTC-Datum/Replay erhalten; nur temporäre Fixture",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            769
          ]
        },
        {
          "id": "Z2-SPEC-STATUS",
          "title": "Unbekannten Spec-Status nicht still als historisch umschreiben; exklusiv scripts/dev/spec-close.mjs + scripts/lib/dev-spec-close.test.mjs",
          "owner": "Root/Stabschef benennt einen vorhandenen Owner",
          "dependsRaw": "main a8f0032; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #767 (merged 2026-10-09T00:33:27Z)",
          "acceptance": "benanntes Rot: Status-Tippfehler verweigert ohne Änderung an Spec/STAND; erlaubte Statuswerte aus bestehendem Spec-Vertrag lesen/pinnen; dry-run und historische Wiederholung erhalten",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            767
          ]
        },
        {
          "id": "Z2-PUSH-REMOTE",
          "title": "Optionsähnlichen Remote-Wert vor Git-Aufruf abweisen; exklusiv scripts/dev/push-verified.mjs + scripts/lib/dev-push-verified.test.mjs",
          "owner": "Root/Stabschef benennt einen vorhandenen Owner",
          "dependsRaw": "main a8f0032; unabhängig",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #788 (merged 2026-10-09T01:17:15Z); ersetzt: In Prüfung: Draft #788 (GitHub 09.10.)",
          "acceptance": "benanntes Rot: --remote -x verweigert ohne Push/Netzwerk; gültiger Remote/Branch sowie Remote-SHA-Beweis erhalten; nur injizierter Runner",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": [
            788,
            788
          ]
        }
      ],
      "problems": [],
      "counts": {
        "Geplant": 7,
        "Bereit": 2,
        "In Arbeit": 0,
        "In Prüfung": 0,
        "Erledigt": 31,
        "Blockiert": 4,
        "Verschoben": 2,
        "Entfallen": 0,
        "invalid": 3
      },
      "total": 49
    },
    {
      "id": "Z3",
      "title": "Rest von v1.6.0",
      "packages": [
        {
          "id": "V16-ARCH-D4-05",
          "title": "Queue-Routen aus api.rs (PR #631)",
          "owner": "Implementierer · Codex, Abnahme Root",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #631 (merged 2026-10-08T08:10:01Z)",
          "acceptance": "Merge über Mergify; `api.rs` 7858",
          "tickets": [
            "b9606dd4"
          ],
          "prNumbers": [
            631
          ]
        },
        {
          "id": "V16-ARCH-D7",
          "title": "Einstellungen nach store/settings.rs (PR #632)",
          "owner": "Implementierer · Codex",
          "dependsRaw": "V16-ARCH-D4-05 (Review seriell)",
          "dependsOn": [
            "V16-ARCH-D4-05"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #632 (merged 2026-10-08T15:25:08Z)",
          "acceptance": "Merge über Mergify",
          "tickets": [
            "782d9e58"
          ],
          "prNumbers": [
            632
          ]
        },
        {
          "id": "V16-06",
          "title": "Start nach Update ohne Journal stoppt fail-closed mit Anleitung",
          "owner": "MCP-Integrationsentwickler",
          "dependsRaw": "E2/V16-F3 beantwortet 09.10.; mn nach D5-GUARD → V16-UPD-CANCEL; Update-Drill",
          "dependsOn": [
            "V16-UPD-CANCEL",
            "D5-GUARD"
          ],
          "place": "PC",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #832 + Folgepaket #845",
          "acceptance": "roter Test zuerst; Drill Erfolg/Abbruch/Fehler",
          "tickets": [
            "2557db66"
          ],
          "prNumbers": [
            832,
            845
          ]
        },
        {
          "id": "V16-UPD-CANCEL",
          "title": "Abbrechen-Knopf beim Update-Download (sonst ist der Drill „Abbruch“ unmöglich)",
          "owner": "Desktop-App-Entwickler; Startzuweisung durch Ausführungs-Stabschef",
          "dependsRaw": "V16-ARCH-D5b/#728 gemergt → D5-GUARD; mn danach neu zuweisen",
          "dependsOn": [
            "V16-ARCH-D5b",
            "D5-GUARD"
          ],
          "place": "PC-Drill; Gates Server möglich",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #813 (78415d74), #828 (d0dc06d5), #830 (55c22381, re-cut von #821), #833 (9735583), #834 (34f2b0b), #851 (Freeze-Test) gemergt am 09.10.",
          "acceptance": "compiling RED vor Fix; Abbruch nur vor Installation autoritativ quittieren, Ende/Thaw vor Retry; Drill und Screenshot; eigene prepush + zwei Fremdvendor-Reviews; Backend/IPC → UI vor Start in je ≤ 300 ALL schneiden",
          "tickets": [],
          "prNumbers": [
            813,
            828,
            830,
            821,
            833,
            834,
            851
          ]
        },
        {
          "id": "V16-ARCH-D2",
          "title": "Doppelte Projektanlage in main.rs zusammenführen",
          "owner": "Implementierer; mn-Nachfolge gemäß L3",
          "dependsRaw": "vor V16-06 freigegeben (Inbox V16-D2)",
          "dependsOn": [
            "V16-06"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #664 (merged 2026-10-08T16:13:04Z)",
          "acceptance": "`rg -c 'fn create_project' src-tauri/src/main.rs` → eine Umsetzung; `main.rs` < 5133; eigene prepush und zwei Fremdvendor-Belege mit Disposition",
          "tickets": [
            "257e3a7b"
          ],
          "prNumbers": [
            664
          ]
        },
        {
          "id": "V16-ARCH-D5a",
          "title": "Diagnosebefehle aus main.rs lösen",
          "owner": "Implementierer · Claude",
          "dependsRaw": "V16-ARCH-D2",
          "dependsOn": [
            "V16-ARCH-D2"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #704 (merged 2026-10-08T20:27:48Z)",
          "acceptance": "`main.rs` −150 Zeilen",
          "tickets": [],
          "prNumbers": [
            704
          ]
        },
        {
          "id": "V16-ARCH-D5b",
          "title": "Einstellungsbefehle aus main.rs lösen",
          "owner": "Implementierer · Claude",
          "dependsRaw": "V16-ARCH-D5a",
          "dependsOn": [
            "V16-ARCH-D5a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #728 (merged 2026-10-09T00:33:32Z)",
          "acceptance": "`main.rs` −150 Zeilen",
          "tickets": [],
          "prNumbers": [
            728
          ]
        },
        {
          "id": "D5-GUARD",
          "title": "Guard-Folgeschnitt nach D5b; Quelle Root-Disposition 09.10.",
          "owner": "Root weist einen exklusiven mn-Owner zu",
          "dependsRaw": "V16-ARCH-D5b/#728 gemergt; vor V16-UPD-CANCEL",
          "dependsOn": [
            "V16-UPD-CANCEL",
            "V16-ARCH-D5b"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #792 (merged 2026-10-09T02:00:10Z); ersetzt: Geplant; konkreter Startvertrag in Ticket 5e18c3e8",
          "acceptance": "mn (`main.rs`) seriell; Ticketabnahme erhalten, kompilierendes Rot→Grün, eigene prepush, zwei Fremdvendor-Reviews und Root-Abnahme",
          "tickets": [
            "5e18c3e8"
          ],
          "prNumbers": [
            792
          ]
        },
        {
          "id": "V16-ARCH-D8a",
          "title": "Ereignisnamen als Konstanten in main.rs",
          "owner": "Implementierer · Claude",
          "dependsRaw": "V16-ARCH-D5b",
          "dependsOn": [
            "V16-ARCH-D5b"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #960 (merged 2026-10-10T06:01:09Z, `2bc9b884`; D8a–c in einem PR); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.)",
          "acceptance": "`rg -n -F -e '\"worker:status\"' -e '\"supervisor:notification\"' src-tauri/src/main.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0",
          "tickets": [],
          "prNumbers": [
            960
          ]
        },
        {
          "id": "V16-ARCH-D8b",
          "title": "Ereignisnamen in PTY",
          "owner": "Implementierer · Claude",
          "dependsRaw": "V16-ARCH-D8a",
          "dependsOn": [
            "V16-ARCH-D8a"
          ],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #960 (`2bc9b884`, zusammen mit D8a und D8c); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.)",
          "acceptance": "`rg -n -F -e '\"pty:output:' -e '\"pty:exit:' src-tauri/src/pty.rs` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `cargo test --manifest-path src-tauri/Cargo.toml` Exit 0",
          "tickets": [],
          "prNumbers": [
            960
          ]
        },
        {
          "id": "V16-ARCH-D8c",
          "title": "Ereignisnamen im Frontend",
          "owner": "Implementierer · Codex",
          "dependsRaw": "V16-ARCH-D8b",
          "dependsOn": [
            "V16-ARCH-D8b"
          ],
          "place": "egal",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #960 (`2bc9b884`); der Abnahme-Grep findet 4 Kommentar-Treffer (`App.tsx:244`, `types.ts:160/567`, `useBoard.ts:35`), keinen Code; Abnahme durch Root: Unbekannt (zu prüfen); ersetzt: Verschoben: nach v1.6.0 (Nutzer 08.10.)",
          "acceptance": "`rg -n -e '[\"\\x27\\x60]worker:status' -e '[\"\\x27\\x60]supervisor:notification' -e '[\"\\x27\\x60]pty:output:' -e '[\"\\x27\\x60]pty:exit:' src` → 0 Treffer außerhalb des gemeinsamen Konstantenmoduls; `npm run typecheck` und `npm run test:unit` Exit 0",
          "tickets": [],
          "prNumbers": [
            960
          ]
        },
        {
          "id": "V16-ADR-A1",
          "title": "ADR A1 (ApiBackend teilen) in docs/decisions.md entscheiden",
          "owner": "bestehender Root-Job `srv-v16-adr-a1`; Fable bei Root",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #667 (merged 2026-10-08T14:34:03Z)",
          "acceptance": "`docs/decisions.md` A1 nicht mehr „Vorschlag (offen)“; precommit-Lane Exit 0; Root-Abnahme am SHA",
          "tickets": [
            "72f47044"
          ],
          "prNumbers": [
            667
          ]
        },
        {
          "id": "V16-ADR-A7",
          "title": "ADR A7 (st-Lane teilen)",
          "owner": "Architekturberater Fable + Architekturberater Astra",
          "dependsRaw": "V16-NACHBEOB (zwei Wochenmessungen)",
          "dependsOn": [
            "V16-NACHBEOB"
          ],
          "place": "egal",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben",
          "acceptance": "Eintrag in `docs/decisions.md`",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "V16-KI30",
          "title": "KI-30 Windows-Flake: Restursache nach V16-01",
          "owner": "Performance- und Benchmark-Spezialist",
          "dependsRaw": "st exklusiv für #737 bis zum Tag v1.6.0",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #874 (merged 2026-10-09T18:03:26Z); ersetzt: Abschluss-Doku Open #874 (Ready, nicht gemergt)",
          "acceptance": "neuer Beleg (Queue-Lauf-ID) vor Fix; 0 KI-30-Fehlschläge in 40 Queue-Läufen; Quellenkonflikt und unveränderte Nachbeobachtung siehe unten",
          "tickets": [],
          "prNumbers": [
            874,
            874
          ]
        },
        {
          "id": "V16-03",
          "title": "Tester-Kit: Installation, Rückmeldeformular, Grenzen",
          "owner": "Implementierer · Codex",
          "dependsRaw": "Inbox E16; kein Pflichtkonto",
          "dependsOn": [],
          "place": "PC / erster externer Tester",
          "tier": "C",
          "status": "Geplant",
          "statusRaw": "Geplant: Konto entfällt laut Nutzerentscheid vom 08.10.; kein Release-Vorgänger",
          "acceptance": "Trockenlauf in Windows Sandbox ODER beim ersten externen Tester; Sandbox-Aktivierung nicht freigegeben",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "V16-CHANGELOG",
          "title": "CHANGELOG v1.6.0 und Release-Notiz",
          "owner": "Stabschef",
          "dependsRaw": "DR-17 und die release-blockierenden Pakete aus V16-RELEASE (ohne diesen CHANGELOG selbst)",
          "dependsOn": [
            "DR-17",
            "V16-RELEASE"
          ],
          "place": "egal",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #922 (merged 2026-10-09T23:08:04Z): b erledigt #861; c erledigt #894; final in diesem PR (V16-RELEASE-PREP); ersetzt: c (Nachtrag 09.10. Abend) in Arbeit, final nach DR-17, Geplant",
          "acceptance": "Eintrag `v1.6.0` über `v1.5.1`",
          "tickets": [],
          "prNumbers": [
            922,
            861,
            894
          ]
        },
        {
          "id": "V16-CHANGELOG-a",
          "title": "Unveröffentlichtes v1.6.0-Changelog-Gerüst; Quelle Root-Disposition 09.10.",
          "owner": "bestehender Owner `srv-changelog-geruest`",
          "dependsRaw": "nur an Basis gemergte Änderungen aufnehmen; unabhängig vom finalen Release-Text",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #783 (gemergt 2026-10-09T01:02:31Z); Nachtrag #835 (gemergt 2026-10-09T10:05:01Z)",
          "acceptance": "nur CHANGELOG.md, ≤ 120 ALL; eigene prepush; keine Tag-/Releasefreigabe; finale Aktualisierung bleibt V16-CHANGELOG",
          "tickets": [
            "ed847e77"
          ],
          "prNumbers": [
            783,
            835
          ]
        },
        {
          "id": "V16-CHANGELOG-b",
          "title": "v1.6.0-Abschnitt bis 09.10. nachziehen",
          "owner": "bestehender Owner",
          "dependsRaw": "V16-CHANGELOG-a",
          "dependsOn": [
            "V16-CHANGELOG-a"
          ],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #861 (merged 2026-10-09T15:02:01Z)",
          "acceptance": "nur CHANGELOG.md; finale Aktualisierung bleibt V16-CHANGELOG",
          "tickets": [],
          "prNumbers": [
            861
          ]
        },
        {
          "id": "V16-RELEASE",
          "title": "Tag v1.6.0 (Beta-Regel x.y.0)",
          "owner": "Nutzer",
          "dependsRaw": "Z1 (bis DR-17), V16-KI30 (Fix-Abnahme), D5-GUARD, V16-UPD-CANCEL, V16-06, V16-CHANGELOG; #728 gemergt",
          "dependsOn": [
            "Z1",
            "DR-17",
            "V16-06",
            "V16-UPD-CANCEL",
            "D5-GUARD",
            "V16-KI30",
            "V16-CHANGELOG"
          ],
          "place": "PC",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: Tag v1.6.0 = d2582ceb (09.10. 23:22Z), release.yml 38004103979 grün, latest.json anonym 1.6.0, PC installiert; ersetzt: Freigabe: Nutzer 09.10. ~19:42Z an Root; Tag durch Root nach Merge dieses PRs (V16-RELEASE-PREP); ersetzt: Geplant: E2/E3 beantwortet; konkrete Freigabe dieses Releases weiterhin offen",
          "acceptance": "jeder Release braucht Nutzerfreigabe; Environment release mit Required Reviewer Cuarroc am 09.10. per gh api bestätigt; danach Release-Pipeline grün",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "V16-FU",
          "title": "Nachläufer aus v1.6.0-Reviews und Release-Prüfung",
          "owner": "Stabschef",
          "dependsRaw": "v1.6.0 veröffentlicht (V16-RELEASE)",
          "dependsOn": [
            "V16-RELEASE"
          ],
          "place": "Server",
          "tier": "B/C je Punkt",
          "status": "Erledigt",
          "statusRaw": "Erledigt 10.10.: SRV-2/SRV-5-Portschutz #931, SRV-3 #952, OWN-3 #930, NOT-1 und R912-FU-1 #941, NOT-2/NOT-3 #928, SRV-4 #927, REL-3 #926, REL-4 #929, R910-FU #937, R889-FU #899 (09.10.); Rest verschoben nach V16-FU-2; ursprünglich: Offen: R908-FU-1 (Wiring-Test stop→limitDrainForSignal), R908-FU-2 (Drain-Kommentar/Idempotenz); R912-FU-1 (existed-Flag statt stat, io-Seam); R910-FU, R896-FU, R899-FU K2, R889-FU; REL-3 (scripts/release.cmd veraltet), REL-4 (Rollback/releases-latest), NOT-1/2/3, SRV-2..5, OWN-3",
          "acceptance": "je Punkt eigenes Paket mit eigener Abnahme",
          "tickets": [],
          "prNumbers": [
            931,
            952,
            930,
            941,
            928,
            927,
            926,
            929,
            937,
            899
          ]
        },
        {
          "id": "V16-FU-2",
          "title": "Rest aus V16-FU: SRV-5 gegenseitige Authentifizierung (laut #931 weiterhin geparkt), R908-FU-1 (Wiring-Test stop→limitDrainForSignal), R908-FU-2 (Drain-Kommentar/Idempotenz), R896-FU, R899-FU K2",
          "owner": "Stabschef",
          "dependsRaw": "V16-FU",
          "dependsOn": [
            "V16-FU"
          ],
          "place": "Server",
          "tier": "B/C je Punkt",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert; ob schon anderswo erledigt: Unbekannt (zu prüfen)",
          "acceptance": "je Punkt eigenes Paket mit eigener Abnahme",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "V16-NACHBEOB",
          "title": "Zwei Wochenmessungen und 40 Queue-Läufe; Messgrößen-Leitfaden",
          "owner": "Stabschef",
          "dependsRaw": "v1.6.0",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben; KI-30-Schluss (#874: 42 Queue-Läufe ab 09.10., 0 KI-30) liegt vor, sein Fenster weicht vom Originalkriterium (Fenster ab #518, 05.10.) ab — Abgleich: Unbekannt (zu prüfen); zwei Wochenmessungen ohne vollständigen Fensterbeleg",
          "acceptance": "Wochenberichte BENCH-01/02 im Ticket",
          "tickets": [
            "b8b16ec8"
          ],
          "prNumbers": [
            874,
            518
          ]
        }
      ],
      "problems": [],
      "counts": {
        "Geplant": 2,
        "Bereit": 0,
        "In Arbeit": 0,
        "In Prüfung": 0,
        "Erledigt": 18,
        "Blockiert": 0,
        "Verschoben": 2,
        "Entfallen": 0,
        "invalid": 0
      },
      "total": 22
    },
    {
      "id": "Z4",
      "title": "Wichtig, aber liegen geblieben",
      "packages": [
        {
          "id": "Z4-ARCH-D1-REST",
          "title": "Vierten HTTP-Fehlertext-Klassifizierer error_status in den gemeinsamen Klassifizierer übernehmen; ARCH-D1 bleibt offen",
          "owner": "Implementierer; abgeschlossene api-Arbeit",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #663 (merged 2026-10-08T20:55:57Z)",
          "acceptance": "`rg -n \"fn error_status\" src-tauri/src/development_plan_access.rs` → 0 Treffer außerhalb des gemeinsamen Klassifizierers; eigene prepush und zwei Fremdvendor-Belege mit Disposition",
          "tickets": [
            "7810a005"
          ],
          "prNumbers": [
            663
          ]
        },
        {
          "id": "Z4-E14",
          "title": "Update-Signierschlüssel finden und verschlüsselt sichern; Anleitung auf der Handgriffe-Seite",
          "owner": "Nutzer",
          "dependsRaw": "E3/E14 beantwortet 09.10.; kein Schlüsselmaterial im Repo",
          "dependsOn": [],
          "place": "PC",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10. laut Root: Schlüssel exportiert und per Test-Signatur geprüft (Exit 0); verschlüsselte Sicherung durch den Nutzer bestätigt (laut Root, 15.10.); kein Schlüsselmaterial im Repo; ersetzt: Geplant: Sicherung beauftragt, Durchführung nicht belegt",
          "acceptance": "verschlüsselte Sicherung durch Nutzer bestätigt; kein Schlüssel in Datei/Log/Commit",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "FLAKE-Q-TMP",
          "title": "Fragen-Testfixture wartet bis Pool und temporäres Verzeichnis geschlossen sind; Root-Disposition 09.10.",
          "owner": "bestehender Owner `srv-flake-q-tmp`",
          "dependsRaw": "keine st-Änderung; #737 bleibt exklusiver st-Owner",
          "dependsOn": [],
          "place": "Server / Windows-Beleg",
          "tier": "B laut Auftrag #784",
          "status": "Erledigt",
          "statusRaw": "Erledigt #784 (merged 2026-10-09T01:17:07Z); ersetzt: In Prüfung: Draft #784",
          "acceptance": "deterministisches Rot→Grün, eigene prepush/Fremdreview; Windows-Fixture-PASS und fremden nativen Fehler getrennt bewerten (PR-Bericht)",
          "tickets": [
            "e257cee3"
          ],
          "prNumbers": [
            784,
            784
          ]
        },
        {
          "id": "KI25-SETUP-XDEAD",
          "title": "X/x im Setup-Test als beendete Prozesszustände erkennen; Root-Disposition 09.10.",
          "owner": "bestehender Owner `srv-ki25-setup-xdead`",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "Server",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #780 (merged 2026-10-09T01:17:11Z); ersetzt: In Prüfung: Draft #780",
          "acceptance": "benanntes kompilierendes Rot→Grün, gültige Zustände erhalten; eigene prepush/Fremdreview und Root-Abnahme",
          "tickets": [
            "ca926ea3"
          ],
          "prNumbers": [
            780,
            780
          ]
        },
        {
          "id": "KI-CLOSE-C",
          "title": "Dokumentierte KI-Abschlüsse mit Quellen abgleichen; Root-Disposition 09.10.",
          "owner": "Root bindet vorhandenen Doku-Owner",
          "dependsRaw": "datierte Abschlussbelege je betroffenem KI-Eintrag",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #790 (merged 2026-10-09T01:45:33Z; title: docs: close eight obsolete HQ bug records (KI-CLOSE-C)); ersetzt: Geplant; Abschluss-/PR-Beleg hier nicht beobachtet",
          "acceptance": "keine pauschale Schließung, konkrete Belege und offene Reste; eigene prepush bei Repo-Änderung",
          "tickets": [
            "PLAN-SYNC-0910b"
          ],
          "prNumbers": [
            790
          ]
        },
        {
          "id": "KI-AUDIT-9-10",
          "title": "KI-9 und KI-10 prüfen; Root-Disposition 09.10.",
          "owner": "Root bindet vorhandenen Prüfowner",
          "dependsRaw": "bestehende Quellen lesen; kein Fixauftrag aus Prüfung",
          "dependsOn": [],
          "place": "Server",
          "tier": "C für Bericht",
          "status": "Erledigt",
          "statusRaw": "Erledigt #804 (merged 2026-10-09T02:32:04Z; title: docs: refresh KI-9 and KI-10 from the October 9 audit); ersetzt: Geplant; Prüfbericht hier nicht beobachtet",
          "acceptance": "je KI datierte Quelle, Befund oder kein Befund, fehlende Nachweise und nächster Schritt",
          "tickets": [
            "PLAN-SYNC-0910b"
          ],
          "prNumbers": [
            804
          ]
        },
        {
          "id": "Z4-ARCH-11",
          "title": "KI-24b: Test-DB-Wettlauf auf Windows reproduzieren und absichern; zusätzlich KI-30-Queue-Befund im Native-Receipt-Test",
          "owner": "Implementierer · Claude; Ausführungs-Stabschef weist Lane zu",
          "dependsRaw": "V16-KI30/#737 und anschließender Queue-Beleg; st bis Tag v1.6.0 exklusiv für #737",
          "dependsOn": [
            "V16-KI30"
          ],
          "place": "Windows-PC für RED",
          "tier": "A",
          "status": "Blockiert",
          "statusRaw": "Blockiert: Start nur, wenn Queue-Belege nach #737 den Defekt weiter zeigen; keine gemeinsame Ursache unterstellen; Queue-Belege nach #737 liegen vor (KI-30-Schluss #874: 42 Läufe, kein `real_native_`-Treffer, Beleg statistisch); KI-24-Teilfix #1463 (`13ef8a41`) und #1468 (`4f74b8f8`) gemergt; KI-24b-Rest: Unbekannt (zu prüfen), Root entscheidet Start oder Entfallen",
          "acceptance": "Dateien `testutil.rs`, `store/development_launches.rs`, `store.rs` vor Start binden; 180–280 ALL nur Prognose; kompilierende Windows-REDs für Launch-Drop/Reopen und getrennt Migration-Reopen; zusätzlich `real_native_completed_receipt_survives_sqlite_writer_within_busy_timeout` (Queue-Runs 37810056116/37814405700) eingrenzen; Zuordnung zur Windows-Flake-Klasse ist keine bewiesene gemeinsame Ursache; API-Ursache offen, keine Blanket-Retries; Fix nur nach Beleg, >300 ALL trennen; eigene prepush + zwei Fremdvendor-Reviews",
          "tickets": [
            "0e7793b4"
          ],
          "prNumbers": [
            737,
            737,
            874,
            1463,
            1468
          ]
        },
        {
          "id": "Z4-R19-09",
          "title": "Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19); ausschließlich mn",
          "owner": "Implementierer · Codex",
          "dependsRaw": "nach v1.6.0; mn frei und neu zugewiesen",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben nach v1.6.0; nur mn, keine st-Naht; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "roter Test zuerst; prepush Exit 0",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z4-R19-ST",
          "title": "Audit-Envelopes Ziel/Task, Claim/Checkpoint, Intent/Launch, Kandidat/Evidence/Review (M4-R19-02/03/04/07)",
          "owner": "Chief weist verbleibende Schnitte nach v1.6.0 zu",
          "dependsRaw": "nach v1.6.0; st bis zum Tag exklusiv für #737",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: Rest 04/07, fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen); 03 mit 03a #705 und 03b #956 (merged 2026-10-10T04:29:58Z, `2e1de0bb`) erledigt; #702/#705/#717 gemergt, keine Gesamt-Abnahme; ursprünglich: Verschoben nach v1.6.0: Rest 03/04/07",
          "acceptance": "≤ 300 ALL je Schnitt; vorhandene Envelopes wiederverwenden, übrige Pfade getrennt belegen; Rot/grün, eigene prepush, zwei Fremdvendor-Reviews/Disposition und Root-Abnahme",
          "tickets": [],
          "prNumbers": [
            705,
            956,
            702,
            705,
            717
          ]
        },
        {
          "id": "M4-R19-02a",
          "title": "Ziel-/Task-Erstellung und gemeinsamer Audit-Helper atomar",
          "owner": "bestehender Root-Job `srv-r19-02-fix1`",
          "dependsRaw": "#632/D7 gemergt; abgeschlossener st-Schnitt",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #702 (merged 2026-10-08T20:13:18Z)",
          "acceptance": "Erstellung/Audit und Rollback mit kompilierendem Rot/grün belegen; ≤ 300 ALL auch nach Fix; eigene prepush, zwei Fremdvendor-Reviews am Kandidaten mit vollständiger Disposition",
          "tickets": [],
          "prNumbers": [
            702
          ]
        },
        {
          "id": "M4-R19-02b / M4-R19-03a",
          "title": "Task-/Projektsteuerung und vorhandene Claim-/Checkpoint-Audit-Envelopes aus #705",
          "owner": "derselbe bestehende Fixrundenowner; st seriell",
          "dependsRaw": "#702 gemergt; abgeschlossener st-Schnitt",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #705 (merged 2026-10-08T21:42:19Z)",
          "acceptance": "Helper aus 02a und Envelopes in späterem R19-03 wiederverwenden; keine doppelte Auditierung; Rot/grün und Rollbackbelege, ≤ 300 ALL nach Fix, eigene prepush/zwei Fremdvendor-Reviews/Disposition; #698 erst nach Root-Abnahme beider Schnitte disponieren",
          "tickets": [],
          "prNumbers": [
            705
          ]
        },
        {
          "id": "M4-R19-02c",
          "title": "Audit-Härtung für Ziel-/Task-Pfade",
          "owner": "bestehender Implementierer; abgeschlossen",
          "dependsRaw": "#702/#705",
          "dependsOn": [],
          "place": "Server",
          "tier": "A",
          "status": "Erledigt",
          "statusRaw": "Erledigt #717 (merged 2026-10-08T22:19:06Z)",
          "acceptance": "atomare Audit-/Rollbackbelege und Review-Disposition im PR; keine Gesamt-Abnahme der R19-Reste",
          "tickets": [],
          "prNumbers": [
            717
          ]
        },
        {
          "id": "Z4-VERIFY",
          "title": "Fünf Altzeilen gegen aktuelle Quellen prüfen und begrenzt schneiden",
          "owner": "Root-Job `srv-z4-verify`; Chief integriert",
          "dependsRaw": "Quelle `a167486`",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "invalid",
          "statusRaw": "Prüfbericht geliefert: `pa-orch/reports/z4-verify-20261008.md`, SHA256 `77341da8`; alle fünf Altzeilen NEUES PAKET, elf FITs unten; keine frischen Laufzeit-/Testbelege",
          "acceptance": "Belege/Teilpässe erhalten; konkrete Reste und NICHT ABGEDECKT statt Altzeilen pauschal schließen",
          "tickets": [
            "77c993f3"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-W103F-WIRE",
          "title": "Produktionsadapter agent_record_delivery anbinden; main.rs, ggf. API-Integrationstest und notwendige Adapter-Allowlist; 120–220 ALL",
          "owner": "Chief weist einen Codex-Implementierer zu",
          "dependsRaw": "#664 gemergt; mn frei; bestehende #301/#337/#352 erhalten",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: seit 08.10. ohne Start (M4-Freeze, Continuous eingefroren), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; PM prüft Startvertrag, kein neuer Worker",
          "acceptance": "kompilierendes Produktionsadapter-Rot; danach done/blocked persistiert, wiederholtes done unverändert, falsche/veraltete Credentials abgewiesen; eigene prepush, zwei Fremdvendor-Reviews",
          "tickets": [
            "8e7b877f"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-W103F-Z1",
          "title": "Originaler PC-Zustellbeleg mit 20 Versuchen, nur bereinigter Bericht ≤ 120 Zeilen",
          "owner": "Chief weist einen Messowner zu",
          "dependsRaw": "WIRE integriert; PC/App/Default-opencode und MCP-Start > 30 s belegt",
          "dependsOn": [],
          "place": "PC",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; reale Voraussetzungen und Zeitpunkt offen",
          "acceptance": "je Versuch Version/Latenz/Marker/terminalbestätigter Empfang; 20/20 bzw. < 20/20 bestimmt Queue-Rest; keine erfundenen Pässe",
          "tickets": [
            "1c6d9ed8"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-W303-PC-REST",
          "title": "Fehlende Crash-/Kapazitäts-/Provider-Belege aus bestehenden Drills, nur Bericht ≤ 180 Zeilen",
          "owner": "Chief weist einen Messowner zu",
          "dependsRaw": "gültige M4-Aktivierung, PC-Rechte und HQ-Läufe",
          "dependsOn": [],
          "place": "PC",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben: seit 08.10. ohne Start (M4-Freeze), Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; M4-Freeze erhalten; #500-Teilpässe nicht wiederholen",
          "acceptance": "Crash je spezifiziertem Übergang plus Kapazität/Provider mit Version/Befehl/Exit/Manifest; Singleton/Estop/Backup aus #500 erhalten",
          "tickets": [
            "abf51cef"
          ],
          "prNumbers": [
            500
          ]
        },
        {
          "id": "Z4-W307-PC-UPDATE",
          "title": "Signiertes installiertes Client-Update und Neustart, nur Bericht ≤ 150 Zeilen",
          "owner": "Chief weist einen Messowner zu",
          "dependsRaw": "autorisierter Windows-PC, Backup/Rückweg, neuere veröffentlichte Version und Abbruchpfad",
          "dependsOn": [],
          "place": "PC",
          "tier": "C",
          "status": "Verschoben",
          "statusRaw": "Verschoben: seit 08.10. ohne Start, Einordnung: Unbekannt (zu prüfen); ursprünglich: Pending; Release-Build ist kein Client-Laufbeleg",
          "acceptance": "cancel/fail/success in dieser Reihenfolge; alte/neue Version, echte Signaturprüfung/Neustart, Fall-Manifeste/Exits; kein neuer Schlüssel/Release",
          "tickets": [
            "c58c630b"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-W118B-PROBE",
          "title": "Native Codex-Skill-Erkennung mit unabhängigem Canary/Kontrolle; Setup-Doku ≤ 120 ALL",
          "owner": "bestehender Root-Job; kein Doppelstart",
          "dependsRaw": "eigener Harness-/Modell-/Startcheck, keine Installation",
          "dependsOn": [],
          "place": "Server",
          "tier": "C",
          "status": "Erledigt",
          "statusRaw": "Erledigt #675 (merged 2026-10-08T14:34:14Z)",
          "acceptance": "Canary-Wert fehlt in Prompt/Katalog; reale Discovery-/Read-Spur und Kontrolle samt Befehl/Exit; gesperrter Zugriff ist kein PASS",
          "tickets": [
            "e4bae87c"
          ],
          "prNumbers": [
            675
          ]
        },
        {
          "id": "Z4-W118B-PROFILE",
          "title": "Nur nachgewiesene Codex-Capability anheben; agent-defaults.json, profiles.rs und Setup-Doku, 80–160 ALL",
          "owner": "bestehender Root-Serverjob, Claude Sonnet; kein Doppelstart",
          "dependsRaw": "positive PROBE von Root abgenommen",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "B",
          "status": "Erledigt",
          "statusRaw": "Erledigt #678 (merged 2026-10-08T15:58:08Z)",
          "acceptance": "kompilierendes Capability-/Pack-Rot, danach nachgewiesener Pfad; fremde Profile unverändert, eigene prepush und Fremdreview",
          "tickets": [
            "67c1ca17"
          ],
          "prNumbers": [
            678
          ]
        },
        {
          "id": "Z4-M4B-0-AUTH",
          "title": "Transaktionslokale Run-/Owner-/Fence-/Rollen-/Projektautorisierung, store/development_runs.rs und ggf. development_launches.rs, 180–260 ALL",
          "owner": "Chief weist einen Nahtowner zu",
          "dependsRaw": "st nach #632 frei; freigegebene Sicherheitskorrektur bei deaktiviertem Continuous Mode",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Sicherheitsbefund bleibt offen, Continuous eingefroren; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "dieselbe Schreibtransaktion, stale/fremd/falsche Rolle/fehlendes Ziel abweisen; keine neue Auth-Transaktion/Migration; Rot vor Fix, eigene prepush und zwei Fremdreviews",
          "tickets": [
            "fea04970"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-M4B-1-GOAL",
          "title": "Atomare Autorisierung und Goal/Replan, continuous.rs plus api/planning_access/Tests/main, 220–290 ALL",
          "owner": "ein serieller st/api/mn-Owner",
          "dependsRaw": "AUTH und freie Nähte; freigegebene Sicherheitskorrektur ohne Continuous-Aktivierung",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Sicherheitsbefund bleibt offen, Continuous eingefroren; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "deterministisches kompilierendes Fence-Interleaving-Rot; stale ohne Goal/Event, gültiger Coordinator erfolgreich; autonome Root operator-only, Operator/Audit erhalten; eigene prepush/zwei Fremdreviews",
          "tickets": [
            "2be81e2e"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-M4B-2-TASK",
          "title": "Atomare Taskanlage, gleicher begrenzter Dateisatz wie GOAL, 180–270 ALL",
          "owner": "ein serieller st/api/mn-Owner",
          "dependsRaw": "AUTH und GOAL-Nahtübergabe",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Sicherheitsbefund bleibt offen, Continuous eingefroren; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "Fence-Interleaving-Rot; stale ohne Task/Event; eigenes Projekt erfolgreich, fremde Goals/Dependencies abweisen, Operator erhalten; eigene prepush/zwei Fremdreviews",
          "tickets": [
            "8dbd5dc7"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-M4B-3-ASSIGN",
          "title": "Atomare Zuweisung, team_assignments.rs plus api/planning_access/Tests/main, 200–280 ALL",
          "owner": "ein serieller st/api/mn-Owner",
          "dependsRaw": "AUTH und TASK-Nahtübergabe",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Sicherheitsbefund bleibt offen, Continuous eingefroren; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "Fence-Interleaving-Rot; stale ohne Assignment/Revision/Event; Selbsteskalation abweisen, gültige Zuweisung/Operator erhalten; eigene prepush/zwei Fremdreviews",
          "tickets": [
            "15d92066"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-M4B-4-IMPORT",
          "title": "Autorisierung nach Source-Laden im Import-Schreibvorgang, development_plan/access plus api/planning_access/Tests/main, 230–300 ALL",
          "owner": "ein serieller st/api/mn-Owner",
          "dependsRaw": "AUTH und ASSIGN-Nahtübergabe",
          "dependsOn": [],
          "place": "eigener Worktree",
          "tier": "A",
          "status": "Verschoben",
          "statusRaw": "Verschoben: nach v1.6.0, Nutzer 08.10.; Sicherheitsbefund bleibt offen, Continuous eingefroren; fällig seit v1.6.0 (09.10.), neue Einordnung: Unbekannt (zu prüfen)",
          "acceptance": "Fence beim Source-Laden ändern; Rot vor Fix; stale ohne Projektion/Revision/Event, gültiger Import/CAS/Sourceprüfung erhalten; vier Pfade integriert prüfen, eigene prepush/zwei Fremdreviews",
          "tickets": [
            "e7c9e018"
          ],
          "prNumbers": []
        },
        {
          "id": "Z4-SERVER-DISK",
          "title": "Server-Platte: alte Worktrees (~151 GB) aufräumen; erst Backup",
          "owner": "Nutzer entscheidet, Stabschef führt aus",
          "dependsRaw": "Inbox E17",
          "dependsOn": [],
          "place": "Server",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant; wartet auf E17 (Nutzer); seit 08.10. ohne Beleg",
          "acceptance": "Platte < 60 %, Backup-Beleg",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z4-RCLONE",
          "title": "Eigene rclone-client_id vor Ende 2026",
          "owner": "Nutzer",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "PC",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant (Nutzer, Frist Ende 2026); seit 08.10. ohne Beleg",
          "acceptance": "Backup läuft mit eigener ID",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z4-SETUP-14",
          "title": "Rest SETUP-14: tote Keys, Permission-Regeln",
          "owner": "Nutzer",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "PC",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant (Nutzer); seit 08.10. ohne Beleg",
          "acceptance": "Liste abgehakt",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z4-M5-01",
          "title": "Testerrunde mit 3–5 externen Testern",
          "owner": "Nutzer",
          "dependsRaw": "V16-03, E16",
          "dependsOn": [
            "V16-03"
          ],
          "place": "egal",
          "tier": "–",
          "status": "Verschoben",
          "statusRaw": "Verschoben",
          "acceptance": "Rückmeldungen festgehalten",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "Z4-M5-04",
          "title": "Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um",
          "owner": "Root",
          "dependsRaw": "Z1",
          "dependsOn": [
            "Z1"
          ],
          "place": "egal",
          "tier": "–",
          "status": "Verschoben",
          "statusRaw": "Verschoben",
          "acceptance": "Umfang festgelegt",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "FLK-NATIVE-EXIT",
          "title": "Nativen Exit-Fehler rot belegen und beheben",
          "owner": "srv-flk-native-exit; Root klärt Windows-Ort",
          "dependsRaw": "deterministischer Windows-Rotnachweis",
          "dependsOn": [],
          "place": "Server / Windows-Beleg",
          "tier": "A",
          "status": "Blockiert",
          "statusRaw": "Blockiert: geplant nach Rotnachweis; Server-Auftrag srv-flk-native-exit endete 15:28 MESZ ohne Rotnachweis; ursprüngliches „läuft“ überholt",
          "acceptance": "Rot/Grün, prepush, Reviews, Root",
          "tickets": [
            "FLK-NATIVE-EXIT"
          ],
          "prNumbers": []
        },
        {
          "id": "FLK-SQLITE-LOCK",
          "title": "SQLite-Lock-Befunde kausal abgrenzen",
          "owner": "srv-flk-sqlite-lock; Root",
          "dependsRaw": "Windows-Messung, neuer Defektbeleg",
          "dependsOn": [],
          "place": "Server / Windows-Beleg",
          "tier": "A bei Fix",
          "status": "Blockiert",
          "statusRaw": "Blockiert: Befunde vor #1463; Server-Auftrag srv-flk-sqlite-lock ohne neuen gemeinsamen Rotnachweis beendet; keine Aktion",
          "acceptance": "Neuer kausaler Befund vor jedem Fix",
          "tickets": [
            "FLK-SQLITE-LOCK"
          ],
          "prNumbers": [
            1463
          ]
        },
        {
          "id": "FLK-TEMPDIR",
          "title": "Tests hinterlassen wieder temporäre Ordner; Quelle belegen und beheben (Nachfolger von KI-TMP #1036, 1953b010)",
          "owner": "Root disponiert",
          "dependsRaw": "Rotnachweis, welcher Test leckt",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Geplant",
          "statusRaw": "Geplant: nicht disponiert (laut Root 15.10.)",
          "acceptance": "Testlauf hinterlässt keinen neuen Ordner im Temp-Verzeichnis; Rot/Grün",
          "tickets": [],
          "prNumbers": []
        },
        {
          "id": "V16-PATCH",
          "title": "Patch-Releases nach v1.6.0",
          "owner": "–",
          "dependsRaw": "V16-RELEASE",
          "dependsOn": [
            "V16-RELEASE"
          ],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: v1.6.1 #1063 (Tag `85dd8ef7`, 10.10.); v1.6.2 #1211 (Tag `9a91ca88`; Release-Lauf 38119801714 fehlgeschlagen, kein GitHub-Release, ersetzt durch v1.6.3); v1.6.3 #1244 (`af20a503`, 11.10.); v1.6.4 #1341 (`587cf97c`, 14.10.); v1.6.5 #1476 (`8dfb07a8`, Tag `6bd3ac87`, 15.10.); v1.6.6 #1528 (`a8b00911`, 15.10., Latest); weitere Patches bis v2.0 ausgesetzt (RELEASE-PAUSE)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1063,
            1211,
            1244,
            1341,
            1476,
            1528
          ]
        },
        {
          "id": "V161",
          "title": "v1.6.1-Welle: Review-/Guard-Härtung (V161-IGNORE bis FU-9), Neuigkeiten-Tab (CL-1/CL-2), Oberflächen-Tokens (V161-UI-*, TH1)",
          "owner": "–",
          "dependsRaw": "V16-RELEASE",
          "dependsOn": [
            "V16-RELEASE"
          ],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 10.10.: 31 PRs #933, #934, #935, #936, #938, #940, #944, #945, #946, #948, #950, #953, #955, #958, #962, #964, #965, #970, #973, #974, #975, #976, #977, #978, #979, #980, #982, #986, #989, #991, #997 (Branches `*/v161-*`); Release-Bump #1063 (`85dd8ef7`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            933,
            934,
            935,
            936,
            938,
            940,
            944,
            945,
            946,
            948,
            950,
            953,
            955,
            958,
            962,
            964,
            965,
            970,
            973,
            974,
            975,
            976,
            977,
            978,
            979,
            980,
            982,
            986,
            989,
            991,
            997,
            1063
          ]
        },
        {
          "id": "CI-SEC-01",
          "title": "Keine Secrets in PR-Jobs, fail-closed-Wächter; REL-HARD-01: minimale Rechte und Herkunftsnachweis für release.yml",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 11.10.: #1171 (`9a41ce11`), #1208 (`117a1e3a`), #1231 (`5bc9a500`), #1172 (`36bee03c`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1171,
            1208,
            1231,
            1172
          ]
        },
        {
          "id": "TOOL-GUARDS",
          "title": "Claude-Hooks: Regelwächter (TOOL-RG-1), TDD-Regeln (TOOL-MP-1), Nahtwächter",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1147 (`20785579`), #1149 (`bbe91509`) 11.10.; #1361 (`59320781`) 14.10.",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1147,
            1149,
            1361
          ]
        },
        {
          "id": "LOOP-1",
          "title": "Deterministische Ratschen, Brief-/PR-Linter, Render-Budgets, Abnahme-Vorprüfung",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 11.10.: #1251 (`ff64a86b`), #1252 (`9ee1e8c4`), #1255 (`2b53868c`), #1260 (`186d325c`), #1276 (`52960347`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1251,
            1252,
            1255,
            1260,
            1276
          ]
        },
        {
          "id": "DEV-BUILD-FEEDBACK",
          "title": "Dev-Build trennt Daten, Build-Abzeichen, Fehler melden, Frontend-Absturzlog",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1214 (`f11beb51`), #1268 (`3cf4e9d3`), #1272 (`177a6360`), #1283 (`aa97112e`), #1287 (`6ac21980`) 11.10.; #1290 (`ec656b36`) 12.10.; #1292 (`5a3372de`), #1302 (`6e61f4c2`), #1306 (`8dcdf8bd`), #1311 (`acfdbc48`) 13.10.",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1214,
            1268,
            1272,
            1283,
            1287,
            1290,
            1292,
            1302,
            1306,
            1311
          ]
        },
        {
          "id": "DR2-0",
          "title": "Denkraum 2: kanonische Glass-Stile über eine URL",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1332 (merged 2026-10-13, `61fbd9ac`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1332
          ]
        },
        {
          "id": "DR2-1",
          "title": "Denkraum 2: ruhiger Start und kompakte Entscheidungen",
          "owner": "–",
          "dependsRaw": "DR2-0",
          "dependsOn": [
            "DR2-0"
          ],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1336 (merged 2026-10-14, `4b882f35`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1336
          ]
        },
        {
          "id": "DR2-2a",
          "title": "Denkraum 2: versionierte Ideendialoge speichern",
          "owner": "–",
          "dependsRaw": "DR2-0",
          "dependsOn": [
            "DR2-0"
          ],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1334 (merged 2026-10-14, `797edcb2`); Herkunft des DR2-Auftrags und weitere DR2-Pakete: Unbekannt (zu prüfen), vor weiterem Dispatch mit DN-03 bis DN-05 abgleichen",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1334
          ]
        },
        {
          "id": "AP-2",
          "title": "WIP-Grenze, 48-h-Draft-Regel, review-ok-Besitz; PR-Flussmetriken",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1399 (`f240e956`), #1403 (`03183325`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1399,
            1403
          ]
        },
        {
          "id": "AP-4a",
          "title": "Windows-Tests in zwei nextest-Partitionen",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1410 (`69cefcaa`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1410
          ]
        },
        {
          "id": "AP-5",
          "title": "Veraltete KNOWN_ISSUES-/deny.toml-Texte; veraltete PLAN-Statuszellen",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1401 (`8ed489ac`), #1439 (`33980373`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1401,
            1439
          ]
        },
        {
          "id": "AP-6a",
          "title": "Routing-Tabelle Aufgabentyp → Profil in AGENTS.md",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1424 (`2648f097`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1424
          ]
        },
        {
          "id": "AP-8",
          "title": "Browser-Mock deckt alle IPC-Befehle; gemeinsamer Retry-Hook",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1402 (`c722c89c`), #1407 (`e6851aa8`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1402,
            1407
          ]
        },
        {
          "id": "AP-9",
          "title": "IPC-Befehlsnamen zwischen generate_handler! und Aufrufern abgleichen",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "invalid",
          "statusRaw": "Teilweise erledigt: S0 #1413 (`032f1529`, 14.10.); weitere Schnitte: Unbekannt (zu prüfen)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1413
          ]
        },
        {
          "id": "AP-10",
          "title": "Plan-Parser ohne Panik, Opener nur https, SAFETY-Kommentare, Begründung für ignorierte Tests",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1400 (`23c189f6`), #1404 (`d37841a6`), #1412 (`e2be4a51`), #1425 (`0a84cec1`), #1420 (`fb9db458`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1400,
            1404,
            1412,
            1425,
            1420
          ]
        },
        {
          "id": "AP-11",
          "title": "Pool-Lasttest, block_on-Drift-Gate, Favicon/Formularnamen, Loopback-/VPN-Doku",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1411 (`53ad10e5`), #1414 (`ea649d2c`), #1416 (`e1e46938`), #1421 (`0d80708e`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1411,
            1414,
            1416,
            1421
          ]
        },
        {
          "id": "UI-TEXTE-1014",
          "title": "Backend-Fehler als Nutzertexte (UI-ERR-1), deutsche Ansichtsnamen (I18N-1)",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1417 (`b2f496bb`), #1419 (`4180d3ad`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1417,
            1419
          ]
        },
        {
          "id": "CLEAN-1014",
          "title": "Tote Skripte, veraltete dead_code-Allows und toten Markdown-Renderer entfernen",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 14.10.: #1428 (`9a753900`), #1433 (`cb02847d`), #1435 (`f6867c1d`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1428,
            1433,
            1435
          ]
        },
        {
          "id": "SLIM-TESTS",
          "title": "Testmodule aus den vier Nähten auslagern, Verschiebung bytegleich beweisen (move-check)",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: move-check #1431 (`83d702a1`, 14.10.); SLIM-M1 #1451 (`20275b8d`), SLIM-S1 #1459 (`d96abfaa`), SLIM-A1 #1456 (`85a0c61e`), SLIM-P1 #1457 (`18ef908e`), 15.10.",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1431,
            1451,
            1459,
            1456,
            1457
          ]
        },
        {
          "id": "FLK-KI34",
          "title": "TresorPanel-Flake unter Last (KI-34)",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt: #1504 (`9c7a785d`, 15.10.); `KNOWN_ISSUES.md` KI-34",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1504
          ]
        },
        {
          "id": "FLK-KI35",
          "title": "Native-Capture-Kapazitätstest reservierte Owner zu früh (KI-35); vollständiges Native-Test-Inventar; Windows-Dateinamen-Tests",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 15.10.: #1543 (`be305ef4`), #1554 (`a5f8c538`), #1545 (`3015d841`); `KNOWN_ISSUES.md` KI-35",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1543,
            1554,
            1545
          ]
        },
        {
          "id": "FIX-1015",
          "title": "Einzel-Fixes 15.10.: Leitstand-Tabpfade und Fluss-Schaltertest, Quellaudit-Testausnahme, gleiche Lampe auf Karte und Flussknoten (FU-LAMP-PROOF)",
          "owner": "–",
          "dependsRaw": "–",
          "dependsOn": [],
          "place": "–",
          "tier": "–",
          "status": "Erledigt",
          "statusRaw": "Erledigt 15.10.: #1510 (`2e687b7b`), #1517 (`d173cd82`), #1535 (`000ed75b`)",
          "acceptance": "–",
          "tickets": [],
          "prNumbers": [
            1510,
            1517,
            1535
          ]
        }
      ],
      "problems": [],
      "counts": {
        "Geplant": 4,
        "Bereit": 0,
        "In Arbeit": 0,
        "In Prüfung": 0,
        "Erledigt": 33,
        "Blockiert": 3,
        "Verschoben": 13,
        "Entfallen": 0,
        "invalid": 2
      },
      "total": 55
    }
  ],
  "milestones": [
    {
      "id": "M1",
      "title": "Alles Laufende gelandet, App startbar ✓ erreicht",
      "packages": [
        {
          "id": "W2-03",
          "title": "Usage-/Billing-Collectors je Adapter",
          "size": "M",
          "lane": "st",
          "stand": "✓ alt-#140",
          "state": "done",
          "prNumbers": [
            140
          ]
        },
        {
          "id": "W2-06",
          "title": "Supervisor: Producer-Audit und Runtime-Notifications",
          "size": "M",
          "lane": "mn + sup",
          "stand": "✓ alt-#152",
          "state": "done",
          "prNumbers": [
            152
          ]
        },
        {
          "id": "W2-08a",
          "title": "Ressourcendruck- und Streaming-Enforcement",
          "size": "M",
          "lane": "fR",
          "stand": "✓ alt-#134",
          "state": "done",
          "prNumbers": [
            134
          ]
        },
        {
          "id": "W2-04f",
          "title": "Planungsendpunkte nur für den Koordinator",
          "size": "S",
          "lane": "api",
          "stand": "✓ alt-#135",
          "state": "done",
          "prNumbers": [
            135
          ]
        },
        {
          "id": "W2-01b",
          "title": "Review-Route nimmt reviewerRunId aus dem Credential",
          "size": "S",
          "lane": "api",
          "stand": "✓ alt-#124",
          "state": "done",
          "prNumbers": [
            124
          ]
        },
        {
          "id": "W2-01c",
          "title": "approvalAuthority in agent_access.rs angleichen",
          "size": "S",
          "lane": "fR",
          "stand": "✓ alt-#150",
          "state": "done",
          "prNumbers": [
            150
          ]
        },
        {
          "id": "W1-15c",
          "title": "Übrige Mutex-Stellen in pty.rs",
          "size": "S",
          "lane": "pty",
          "stand": "✓ alt-#137",
          "state": "done",
          "prNumbers": [
            137
          ]
        },
        {
          "id": "W1-23c",
          "title": "„-0 Tokens“-Anzeige, MSRV gemessen",
          "size": "S",
          "lane": "fR",
          "stand": "✓ alt-#136",
          "state": "done",
          "prNumbers": [
            136
          ]
        },
        {
          "id": "W1-29",
          "title": "Linux-Flake im Prozessgruppen-Test",
          "size": "S",
          "lane": "fR",
          "stand": "✓ alt-#138",
          "state": "done",
          "prNumbers": [
            138
          ]
        },
        {
          "id": "W1-21c",
          "title": "xterm-pageerror beim Mount",
          "size": "S",
          "lane": "fe",
          "stand": "✓ alt-#151",
          "state": "done",
          "prNumbers": [
            151
          ]
        },
        {
          "id": "SETUP-04",
          "title": "AGENTS.md: Mergify, Reviews, Build-Slots",
          "size": "M",
          "lane": "doc",
          "stand": "✓ alt-#132",
          "state": "done",
          "prNumbers": [
            132
          ]
        },
        {
          "id": "HOOK-01",
          "title": "Hook-ROOT-Fix einzeln vor CI-02 (Nutzer 25.09.)",
          "size": "S",
          "lane": "ci",
          "stand": "✓ alt-#156",
          "state": "done",
          "prNumbers": [
            156
          ]
        },
        {
          "id": "W1-05b",
          "title": "Sichere Cancel-Regel für dispatched, Dedup der toten Tasks; erst st-Kind, dann api-Kind; Zahl der toten Einträge read-only nachzählen",
          "size": "M",
          "lane": "st → api",
          "stand": "✓ #19",
          "state": "done",
          "prNumbers": [
            19
          ]
        },
        {
          "id": "W1-03e",
          "title": "MSG_USER erst nach bewiesener Zustellung (F-CORE-3 B.3)",
          "size": "S",
          "lane": "wk",
          "stand": "✓ alt-#171",
          "state": "done",
          "prNumbers": [
            171
          ]
        },
        {
          "id": "W1-20",
          "title": "Zweites Setup reproduzieren (Node 24, npm ci, dev:setup, dev:doctor)",
          "size": "S",
          "lane": "N",
          "stand": "✓ alt-#166",
          "state": "done",
          "prNumbers": [
            166
          ]
        },
        {
          "id": "CI-02",
          "title": "Leichter main-Push, Docs-only, Dependabot im red-first (enthält W1-19b)",
          "size": "S",
          "lane": "ci",
          "stand": "✓ alt-#133",
          "state": "done",
          "prNumbers": [
            133
          ]
        },
        {
          "id": "CI-03",
          "title": "Actions-Kosten senken: CI nur bei „ready“ und in der Queue, Windows nur in Queue und Wochenlauf, Budgetstopp ab 80 %",
          "size": "M",
          "lane": "ci",
          "stand": "✓ alt-#149",
          "state": "done",
          "prNumbers": [
            149
          ]
        },
        {
          "id": "SETUP-08",
          "title": "Git-/PR- und Plan-Helfer unter scripts/dev (08a + 08b)",
          "size": "M",
          "lane": "doc",
          "stand": "✓ #22",
          "state": "done",
          "prNumbers": [
            22
          ]
        },
        {
          "id": "SEC-01",
          "title": "Geheimnis-Scan (gitleaks) als precommit-Gate",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #20",
          "state": "done",
          "prNumbers": [
            20
          ]
        }
      ],
      "done": 19,
      "total": 19
    },
    {
      "id": "M2",
      "title": "Überblick und Setup",
      "packages": [
        {
          "id": "M2-FRAG",
          "title": "Frag-mich-Skill für Einsteiger-Erklärungen",
          "size": "S",
          "lane": "doc",
          "stand": "✓ alt-#161",
          "state": "done",
          "prNumbers": [
            161
          ]
        },
        {
          "id": "PLAN-01",
          "title": "Ein Plan, zehn Regeln, gestufte Reviews, PR-Text ist der Bericht, Archiv",
          "size": "M",
          "lane": "doc",
          "stand": "✓ #26",
          "state": "done",
          "prNumbers": [
            26
          ]
        },
        {
          "id": "PLAN-SYNC",
          "title": "Gemergte Pakete seit 25.09.2026 und M1-Status im Plan nachführen",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #45",
          "state": "done",
          "prNumbers": [
            45
          ]
        },
        {
          "id": "OPS-01",
          "title": "Status und Tagesbericht per Skript aus GitHub und git (was läuft, was fertig ist, was du entscheidest)",
          "size": "M",
          "lane": "doc",
          "stand": "✓ alt-#164",
          "state": "done",
          "prNumbers": [
            164
          ]
        },
        {
          "id": "OPS-02",
          "title": "Startcheck vor jedem Worker: Modell beobachtet, Limit, freier RAM, laufende Cargo-Builds; harte Stopps",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #35",
          "state": "done",
          "prNumbers": [
            35
          ]
        },
        {
          "id": "CI-04",
          "title": "Roter main stoppt die Queue: Issue mit Run-ID, Label, Queue-Pause",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #28",
          "state": "done",
          "prNumbers": [
            28
          ]
        },
        {
          "id": "W1-21d",
          "title": "Suchschalter im Scrollback (Groß-/Kleinschreibung, Regex)",
          "size": "S",
          "lane": "fe",
          "stand": "✓ #27",
          "state": "done",
          "prNumbers": [
            27
          ]
        },
        {
          "id": "W1-30",
          "title": "Flake omniroute::…management_failures_keep_their_http_and_network_classes (100-ms-Timeout)",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #32",
          "state": "done",
          "prNumbers": [
            32
          ]
        },
        {
          "id": "CLEAN-01",
          "title": "Toten Code löschen: npm @tauri-apps/plugin-process, drei ungenutzte TS-Funktionen und Exporte (Prüfung B, S6)",
          "size": "S",
          "lane": "fe",
          "stand": "✓ #31",
          "state": "done",
          "prNumbers": [
            31
          ]
        },
        {
          "id": "CLEAN-02",
          "title": "Stillgelegten Queen-Anlegepfad löschen (Trait-Methode in api.rs, Umsetzung in main.rs, drei Funktionen in workers.rs)",
          "size": "S",
          "lane": "api → mn → wk",
          "stand": "✓ #25",
          "state": "done",
          "prNumbers": [
            25
          ]
        },
        {
          "id": "W1-17",
          "title": "HQ-Parser: prüfen, ob OPS-01 oder DF-06a ihn überholt haben; sonst auf die Meilenstein-Tabellen umstellen. Bis dahin zeigt der eingecheckte HQ-Snapshot (docs/dev-hq/data.js/data.json) die alten F-Meilensteine als „waiting“ — bekannter Zwischenstand, kein Datenfehler",
          "size": "S",
          "lane": "hqL",
          "stand": "✓ #38",
          "state": "done",
          "prNumbers": [
            38
          ]
        },
        {
          "id": "SETUP-09",
          "title": "Lokaler Review-Lauf scripts/review/run-local.sh",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #39",
          "state": "done",
          "prNumbers": [
            39
          ]
        },
        {
          "id": "SETUP-12",
          "title": "Rest des Docs-only-Pfadfilters, soweit CI-02/CI-03 ihn nicht abdecken",
          "size": "S",
          "lane": "ci",
          "stand": "✓ #36",
          "state": "done",
          "prNumbers": [
            36
          ]
        },
        {
          "id": "SETUP-14",
          "title": "Nutzer: tote Keys, OpenCode-Modelle, ollama signin, Permission-Regeln",
          "size": "S",
          "lane": "N",
          "stand": "teilweise: `ollama signin` und OpenCode-Modelle geprüft (02.10.); offen: tote Keys, Permission-Regeln",
          "state": "in_progress",
          "prNumbers": []
        },
        {
          "id": "SETUP-15",
          "title": "Abschlussreview der Setup-Doku, verkleinert",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #51",
          "state": "done",
          "prNumbers": [
            51
          ]
        }
      ],
      "done": 14,
      "total": 15
    },
    {
      "id": "M3",
      "title": "App im Alltag + Zwischenrelease v1.5.0 (Beta)",
      "packages": [
        {
          "id": "HQ2-02",
          "title": "Abnahme der Konzeptdemo und Studio-Variante; legt die Richtung für „HQ als Hauptbereich der App“ fest",
          "size": "M",
          "lane": "hqS + N",
          "stand": "✓ entschieden (Nutzer 04.10., E1: Mix)",
          "state": "done",
          "prNumbers": []
        },
        {
          "id": "HQ2-03",
          "title": "Gemeinsame Design-Tokens hell/dunkel, nach HQ2-02",
          "size": "M",
          "lane": "hqS",
          "stand": "✓ #311",
          "state": "done",
          "prNumbers": [
            311
          ]
        },
        {
          "id": "W1-10",
          "title": "HQ-Stylesheet: Kontrast-Gate auf hq.css, Light Mode, prefers-contrast",
          "size": "M",
          "lane": "hqL",
          "stand": "✓ #33",
          "state": "done",
          "prNumbers": [
            33
          ]
        },
        {
          "id": "M3-01",
          "title": "Drei deutschsprachige Aufgaben-Vorlagen mit eingebautem Abnahmekriterium (nur Doku)",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #144",
          "state": "done",
          "prNumbers": [
            144
          ]
        },
        {
          "id": "W2-10",
          "title": "Live-HQ-Views (vor Dispatch teilen: 10a Ziele/Teams, 10b Routing/Budget, 10c Review/Delivery)",
          "size": "M",
          "lane": "hqL",
          "stand": "10a ✓ #13, 10b ✓ #21, 10c ✓ #62",
          "state": "done",
          "prNumbers": [
            13,
            21,
            62
          ]
        },
        {
          "id": "W5-02b7",
          "title": "HQ-Profilansicht zeigt envPolicy",
          "size": "S",
          "lane": "hqL",
          "stand": "✓ #58",
          "state": "done",
          "prNumbers": [
            58
          ]
        },
        {
          "id": "W5-02a",
          "title": "Koordinator ohne Schreibpfad",
          "size": "M",
          "lane": "wk",
          "stand": "✓ #24",
          "state": "done",
          "prNumbers": [
            24
          ]
        },
        {
          "id": "W5-22",
          "title": "Konfliktvorhersage und Lane-Guard",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #9",
          "state": "done",
          "prNumbers": [
            9
          ]
        },
        {
          "id": "W5-28",
          "title": "Automatischer Laufzeitbeleg (Sandbox, Queue aus)",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #11",
          "state": "done",
          "prNumbers": [
            11
          ]
        },
        {
          "id": "W5-00b",
          "title": "Fremden Text in workers.rs-Prompts suchen und einhüllen",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #18",
          "state": "done",
          "prNumbers": [
            18
          ]
        },
        {
          "id": "W2-04e",
          "title": "dispatch.role ins Agenten-Briefing",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #50",
          "state": "done",
          "prNumbers": [
            50
          ]
        },
        {
          "id": "W2-01d",
          "title": "CLI-Befehl pa hq agent review",
          "size": "S",
          "lane": "pa",
          "stand": "✓ #46",
          "state": "done",
          "prNumbers": [
            46
          ]
        },
        {
          "id": "W1-18b",
          "title": "Probe, ob Codex/OpenCode .agents/skills lesen",
          "size": "S",
          "lane": "wk + N",
          "stand": "OpenCode ✓ #30, Codex △ headless-Probe 02.10.2026: `projecta-workflow` gemeldet, direkte Dateisystemabfrage durch Read-only-Policy blockiert",
          "state": "in_progress",
          "prNumbers": [
            30
          ]
        },
        {
          "id": "W1-01b",
          "title": "Kimi-Re-Smoke mit PROJECTA_PTY_TRACE_DIR",
          "size": "S",
          "lane": "pty",
          "stand": "gestrichen (Nutzer 04.10.: Kimi-Abo abgelaufen; Smoke ✓ #192)",
          "state": "done",
          "prNumbers": [
            192
          ]
        },
        {
          "id": "W1-27",
          "title": "KI-20, doppelte ESC[6n-Antwort; welche Seite antwortet, entscheidet der Advisor (Nutzer 25.09.)",
          "size": "S",
          "lane": "pty + fe",
          "stand": "✓ #140 (ersetzt das geschlossene #112; gemergt 03.10.)",
          "state": "done",
          "prNumbers": [
            140,
            112
          ]
        },
        {
          "id": "W3-08",
          "title": "Paketierter HQ-v1-Beleg",
          "size": "S",
          "lane": "N",
          "stand": "✓ #381; Drill 8 PASS am 05.10. (Beleg: Datum aus `events.log`, lokal)",
          "state": "done",
          "prNumbers": [
            381
          ]
        },
        {
          "id": "ARCH-11",
          "title": "KI-24b auf Windows reproduzieren, Test-DB-Wettlauf absichern (siehe Tabelle Architektur-Pakete)",
          "size": "S",
          "lane": "fR + N",
          "stand": "angenommener M3-Kandidat (Nutzer 04.10., F6); Windows-Lauf am PC des Nutzers erlaubt; offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "R-1",
          "title": "Zwischenrelease v1.5.0 (Beta) als Abschluss von M3; Tag und Veröffentlichung darf der Orchestrator selbst, sobald alle Gates und die 27 Matrixzeilen in der Fassung vom 04.10. belegt sind (Nutzer 04.10.)",
          "size": "S",
          "lane": "N + doc",
          "stand": "✓ v1.5.0 (05.10.)",
          "state": "done",
          "prNumbers": []
        }
      ],
      "done": 16,
      "total": 18
    },
    {
      "id": "M4",
      "title": "Dauerbetrieb abgenommen, v1.5.1",
      "packages": [
        {
          "id": "W5-05",
          "title": "Prüfpfad (append-only, Trigger gegen UPDATE/DELETE)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #44",
          "state": "done",
          "prNumbers": [
            44
          ]
        },
        {
          "id": "W5-04a",
          "title": "Not-Aus im Store, global ohne Projektrahmen (Schnitt 25.09., W5-01a bleibt geparkt)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #69",
          "state": "done",
          "prNumbers": [
            69
          ]
        },
        {
          "id": "W5-04b",
          "title": "Not-Aus in der App (10 s Frist)",
          "size": "S",
          "lane": "mn",
          "stand": "✓ #125 (Backend W5-04d ✓ #157, Release-Auth W5-04e ✓ #158)",
          "state": "done",
          "prNumbers": [
            125,
            157,
            158
          ]
        },
        {
          "id": "W5-04c",
          "title": "Not-Aus in pa",
          "size": "S",
          "lane": "pa",
          "stand": "✓ #124",
          "state": "done",
          "prNumbers": [
            124
          ]
        },
        {
          "id": "W2-02b",
          "title": "Gleichstand in derselben Sekunde, vertrauenswürdige Testquelle (Rest „Merge-Ergebnis als Kandidat“ siehe „Später“)",
          "size": "M",
          "lane": "st",
          "stand": "Gleichstand ✓ #82, Testquelle ✓ #122; Rest „Merge-Ergebnis als Kandidat“ auf später verschoben (Nutzer 04.10.)",
          "state": "done",
          "prNumbers": [
            82,
            122
          ]
        },
        {
          "id": "W2-04c",
          "title": "Rollenbewusste Routen und Credentials beim Launch",
          "size": "M",
          "lane": "st",
          "stand": "✓ #222 (Teil 2, gemergt 03.10.); Teil 1 ✓ #178 (ersetzt #147; gemergt 03.10.)",
          "state": "done",
          "prNumbers": [
            222,
            178,
            147
          ]
        },
        {
          "id": "W2-04d",
          "title": "Rollen auf Budget-Zwecke abbilden",
          "size": "S",
          "lane": "st",
          "stand": "✓ #15",
          "state": "done",
          "prNumbers": [
            15
          ]
        },
        {
          "id": "W2-04g",
          "title": "Optional: Versionsspalte für die Attestierungsregel",
          "size": "S",
          "lane": "st",
          "stand": "gestrichen (Nutzer 04.10.)",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "DF-15b",
          "title": "Reservierung und Delivery bei exited_undelivered freigeben (KI-27; Nutzer 25.09.: ja)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #16",
          "state": "done",
          "prNumbers": [
            16
          ]
        },
        {
          "id": "W2-07b",
          "title": "Windows-ACL für projecta-api.json und agent-access/",
          "size": "S",
          "lane": "api",
          "stand": "✓ #12",
          "state": "done",
          "prNumbers": [
            12
          ]
        },
        {
          "id": "W2-08b",
          "title": "Speicher-/CPU-Grenzen je Job (Nutzer 25.09.: ja); Stillstand früh erkennen (Denk- und Fortschrittszeichen prüfen, sonst nach 15 min)",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #53",
          "state": "done",
          "prNumbers": [
            53
          ]
        },
        {
          "id": "W2-09b",
          "title": "DeepSeek-V4-Flash-Worker über OpenCode",
          "size": "M",
          "lane": "wk",
          "stand": "✓ #78",
          "state": "done",
          "prNumbers": [
            78
          ]
        },
        {
          "id": "HQ2-05b",
          "title": "Echte Collector-/Billing-Proben je Anbieter; vorher prüfen, ob W2-03 es schon abdeckt; echte Proben mit Claude/Codex/OpenCode dürfen Abo-Kontingent verbrauchen (Nutzer 04.10.)",
          "size": "M",
          "lane": "fR + N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02b3",
          "title": "Env-Stufe als globale Einstellung (st → api → fe); Produktfrage entschieden (Nutzer 04.10.): die globale Stufe ersetzt die Isolation je Profil für gewöhnliche Agenten, Koordinatoren bleiben immer strict, profilspezifisches passthrough bleibt",
          "size": "M",
          "lane": "st → api → fe",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W5-02b4",
          "title": "Push aus dem Worker über den Runner-Host, danach strict als Voreinstellung",
          "size": "M",
          "lane": "pty + wk",
          "stand": "✓ #65",
          "state": "done",
          "prNumbers": [
            65
          ]
        },
        {
          "id": "W5-02b5",
          "title": "Test für den http.extraHeader-Reset; GPG unter strict",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #17",
          "state": "done",
          "prNumbers": [
            17
          ]
        },
        {
          "id": "W1-03f",
          "title": "F-CORE-3 Baustein C: Zustell-Queue, pa worker done/blocked (braucht das Z-1-Protokoll am PC)",
          "size": "M",
          "lane": "wk + pa",
          "stand": "Teilpakete gemergt (#337 W1-03f-api, #301 W1-03f-a); Hauptpaket offen",
          "state": "open",
          "prNumbers": [
            337,
            301
          ]
        },
        {
          "id": "W3-01",
          "title": "Globaler DB-Wartungs-/Write-Lock + Drain (st-Kind, dann mn-Kind)",
          "size": "M",
          "lane": "st → mn",
          "stand": "✓ #285, #335, #402",
          "state": "done",
          "prNumbers": [
            285,
            335,
            402
          ]
        },
        {
          "id": "W3-02",
          "title": "Windows-Recovery-Helper",
          "size": "M",
          "lane": "fR + N",
          "stand": "✓ (Teilpakete W3-02a bis W3-02k gemergt, zuletzt #475)",
          "state": "done",
          "prNumbers": [
            475
          ]
        },
        {
          "id": "W3-02a",
          "title": "Journal-Treiber, eine Aktion je Schritt",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #291",
          "state": "done",
          "prNumbers": [
            291
          ]
        },
        {
          "id": "W3-02b",
          "title": "Staged-Update-Identitäten binden",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #321",
          "state": "done",
          "prNumbers": [
            321
          ]
        },
        {
          "id": "W3-02c",
          "title": "Datenbank-Wiederherstellung ans Journal binden",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #357",
          "state": "done",
          "prNumbers": [
            357
          ]
        },
        {
          "id": "W3-02d",
          "title": "Installer-Adapter (Exit-/UAC-/Sharing-Klassifikation, kein Retry)",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #348",
          "state": "done",
          "prNumbers": [
            348
          ]
        },
        {
          "id": "W3-02e",
          "title": "Installation nur über das Wiederherstellungs-Journal",
          "size": "S",
          "lane": "fR",
          "stand": "✓ #411 (gemergt 05.10.; Befunde C1/C2 zurückgestellt, siehe W3-02h/i)",
          "state": "done",
          "prNumbers": [
            411
          ]
        },
        {
          "id": "W3-02f",
          "title": "Wiederherstellung beim Start",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #425",
          "state": "done",
          "prNumbers": [
            425
          ]
        },
        {
          "id": "W3-02g",
          "title": "Release-Blocker R-1 (Beta): Journal-Erzeuger. update-recovery.json legt heute nichts an, daher lehnt das Selbst-Update in der App immer ab (offener Punkt aus #411). Stufe A",
          "size": "M",
          "lane": "mn",
          "stand": "✓ #446",
          "state": "done",
          "prNumbers": [
            446
          ]
        },
        {
          "id": "W3-02h",
          "title": "Release-Blocker R-1 (Beta): #411-Befund C1, die installierten Bytes und die Version an das Journal binden (signed_artifact_sha256, candidate_version; heute verwirft InstallOnly beide). Stufe A",
          "size": "M",
          "lane": "mn",
          "stand": "✓ #457",
          "state": "done",
          "prNumbers": [
            457
          ]
        },
        {
          "id": "W3-02j",
          "title": "Release-Blocker R-1 (Beta): Handshake-Identität nach dem Update. Die Startprüfung muss die laufende exe und die Live-Datenbank nach einem echten Update als Erbe des Journals anerkennen (Vertrauen beim ersten Start, siehe docs/decisions.md), sonst blockiert IdentityMismatch den Start. Befund aus #457. Stufe A",
          "size": "M",
          "lane": "mn",
          "stand": "✓ #462",
          "state": "done",
          "prNumbers": [
            462
          ]
        },
        {
          "id": "W3-02i",
          "title": "Release-Blocker R-1 (Beta): #411-Befund C2, Wartungs-Lease statt Momentaufnahme von is_maintenance_active(); berührt auch store.rs (Naht, nur seriell). Stufe A",
          "size": "M",
          "lane": "mn",
          "stand": "✓ #471",
          "state": "done",
          "prNumbers": [
            471
          ]
        },
        {
          "id": "W3-03",
          "title": "Paketierte Drills: Singleton, Crash/Power-Loss, Backup (3 × S)",
          "size": "S",
          "lane": "N",
          "stand": "✓ Drill-Kits #364, #376, #379, #382, #377, #380, #384 gemergt; die Läufe am PC stehen laut R-1-Voraussetzungen noch aus",
          "state": "done",
          "prNumbers": [
            364,
            376,
            379,
            382,
            377,
            380,
            384
          ]
        },
        {
          "id": "W3-04",
          "title": "Updater-Zustände in App und HQ",
          "size": "S",
          "lane": "fe + hqL",
          "stand": "✓ #119",
          "state": "done",
          "prNumbers": [
            119
          ]
        },
        {
          "id": "W3-07",
          "title": "Produktionsschlüssel-Build + Signed-Updater-Relaunch; der bestehende Schlüssel bleibt (E4)",
          "size": "S",
          "lane": "N",
          "stand": "offen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "W4-01",
          "title": "Benchmark, verkleinert auf 5 Aufgaben statt 20 (E2, Nutzer 02.10.)",
          "size": "M",
          "lane": "fR",
          "stand": "✓ #73",
          "state": "done",
          "prNumbers": [
            73
          ]
        },
        {
          "id": "W4-02",
          "title": "Abnahmematrix final (27 Zeilen)",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #48",
          "state": "done",
          "prNumbers": [
            48
          ]
        },
        {
          "id": "W4-03",
          "title": "Continuous-Aktivierung, nur nach W4-02 und mit Freigabe des Nutzers; der Schalter darf jetzt gebaut werden, fail-closed (gesperrt, bis die Zeilen 1–26 der Abnahmematrix belegt sind); einschalten tut der Nutzer selbst am Ende (Zeile 2) (Nutzer 04.10., E5)",
          "size": "S",
          "lane": "mn",
          "stand": "✓ #481",
          "state": "done",
          "prNumbers": [
            481
          ]
        },
        {
          "id": "W4-04",
          "title": "Release v1.5.1 (Endrelease)",
          "size": "S",
          "lane": "N",
          "stand": "✓ v1.5.1 (06.10.)",
          "state": "done",
          "prNumbers": []
        },
        {
          "id": "M4-R7-01",
          "title": "Scheduler-dispatch_once hinter einem Nur-Test-Permit (Matrixzeile 7)",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #340",
          "state": "done",
          "prNumbers": [
            340
          ]
        },
        {
          "id": "M4-R7-02",
          "title": "Negative Fake-Adapter-Matrix (Matrixzeile 7): Tests, die Starts ohne akzeptierte Gates ablehnen, plus Matrixzeilen 5 und 9: zwei gleichzeitige dispatch_once auf eine Aufgabe starten genau einen Worker, der veraltete Schreiber wird abgewiesen; Abhängigkeiten erfüllt/offen/fehlend/projektfremd/65 Einträge -> genau ein Start nur im erfüllten Fall",
          "size": "S",
          "lane": "wk",
          "stand": "✓ #412 (ersetzt #407)",
          "state": "done",
          "prNumbers": [
            412,
            407
          ]
        },
        {
          "id": "M4-ROW15-PROOF",
          "title": "HTTP-Beleg Zeile 15 (eingeengt): Bindung/Idempotenz Kandidat und Evidenz, Lesen nur im eigenen Run, fremde/stale Evidenz abgewiesen, veränderte Root-Policy ändert policy_json nicht und meldet fail-closed",
          "size": "S",
          "lane": "api-Tests",
          "stand": "✓ #360",
          "state": "done",
          "prNumbers": [
            360
          ]
        },
        {
          "id": "M4-ROW17-PROOF",
          "title": "HTTP-Beleg Zeile 17 (eingeengt): Kandidat-Delta macht Evidenz und Reviews sichtbar ungültig, auch nach Neustart; Freigabe bleibt per Schema unmöglich",
          "size": "S",
          "lane": "api-Tests",
          "stand": "✓ #374",
          "state": "done",
          "prNumbers": [
            374
          ]
        },
        {
          "id": "M4-E2E-14",
          "title": "Echter HTTP-Router + Store + Fake-Agentenprozess: Checkpoint -> Abbruch -> Fortsetzen (Zeile 14)",
          "size": "S",
          "lane": "api",
          "stand": "✓ #365",
          "state": "done",
          "prNumbers": [
            365
          ]
        },
        {
          "id": "M4-R19-01",
          "title": "Typisierter Audit-Envelope: Einträge ohne project/run/result/sourceRef werden abgewiesen (Matrixzeile 19)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #358",
          "state": "done",
          "prNumbers": [
            358
          ]
        },
        {
          "id": "M4-R19-05",
          "title": "Vollständige Audit-Envelopes für Delivery-Start/-Enqueue und W1-03f done/blocked mit Erfolg und Ablehnung (Matrixzeile 19)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #408",
          "state": "done",
          "prNumbers": [
            408
          ]
        },
        {
          "id": "M4-R19-06",
          "title": "Vollständige Audit-Envelopes für Not-Aus an/aus und Barrier-/Store-Fehler (Matrixzeile 19)",
          "size": "S",
          "lane": "st",
          "stand": "✓ #423",
          "state": "done",
          "prNumbers": [
            423
          ]
        },
        {
          "id": "M4-R19-08",
          "title": "Vollständige Audit-Envelopes für Planungs-Autorisierungsablehnungen und Planungs-Schreibvorgänge (Matrixzeile 19)",
          "size": "S",
          "lane": "api",
          "stand": "✓ #444",
          "state": "done",
          "prNumbers": [
            444
          ]
        },
        {
          "id": "M4-R27-01",
          "title": "Readiness für App-Release und Continuous-Release getrennt ausweisen (E20)",
          "size": "S",
          "lane": "scripts",
          "stand": "✓ #372",
          "state": "done",
          "prNumbers": [
            372
          ]
        },
        {
          "id": "M4-R27-02",
          "title": "Release-Attestierung für den App-Release prüfen, ohne Continuous freizugeben (E20)",
          "size": "S",
          "lane": "scripts",
          "stand": "✓ #398",
          "state": "done",
          "prNumbers": [
            398
          ]
        },
        {
          "id": "M4-R27-03",
          "title": "Matrixzeilen 18 und 27 an den menschlich kontrollierten App-Release-Pfad anpassen (E20)",
          "size": "S",
          "lane": "doc",
          "stand": "✓ #413",
          "state": "done",
          "prNumbers": [
            413
          ]
        },
        {
          "id": "M4-R27-04",
          "title": "Store-Test: Continuous-Integrationsstufe wird bei approval_eligible = 0 abgewiesen",
          "size": "S",
          "lane": "st",
          "stand": "✓ #448",
          "state": "done",
          "prNumbers": [
            448
          ]
        }
      ],
      "done": 44,
      "total": 49
    },
    {
      "id": "M5",
      "title": "Aufräumen und erste Tester (nach v1.5.1)",
      "packages": [
        {
          "id": "M5-01",
          "title": "Testerrunde mit 3–5 externen Testern (N = Zahl noch offen)",
          "size": "S",
          "lane": "N",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "M5-02",
          "title": "Produktfokus als Aussage im README: „sicherer Dauerbetrieb für KI-Agenten: Not-Aus, Kostenkontrolle, Protokoll“",
          "size": "S",
          "lane": "doc",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "M5-03",
          "title": "ARCH-G1 Regeldokument docs/architecture-rules.md + ARCH-G2 Drift-Gate in der CI",
          "size": "M",
          "lane": "ci + doc",
          "stand": "✓ G1 #316, G2 #304 (04.10.)",
          "state": "done",
          "prNumbers": [
            316,
            304
          ]
        },
        {
          "id": "M5-04",
          "title": "Dogfooding: ein Orchestrierungsschritt zieht in ProjectA um (Umfang später festlegen)",
          "size": "M",
          "lane": "später",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D1",
          "title": "Vier HTTP-Fehlertext-Klassifizierer zu einem",
          "size": "S",
          "lane": "api",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D2",
          "title": "Projektanlage ist in main.rs doppelt umgesetzt",
          "size": "S",
          "lane": "mn",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D3",
          "title": "Elf direkte BEGIN IMMEDIATE zu einem Store-Helfer",
          "size": "M",
          "lane": "st",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D4",
          "title": "Restlicher API-Router mit 51 Zweigen: kleinere serielle Teil-PRs, insgesamt ≥ 300 Zeilen Netto-Abbau in api.rs; je PR ≤ 300 Gesamtdiffzeilen einschließlich Tests (ARCH-D4-PLAN)",
          "size": "M",
          "lane": "api",
          "stand": "offen, nach v1.5.1; Schnitt vor Dispatch messen",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D5",
          "title": "Diagnose- und Einstellungsbefehle aus dem Befehls-Monolithen in main.rs herauslösen",
          "size": "M",
          "lane": "mn",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D6",
          "title": "pa::run vermischt Verteilung und Darstellung",
          "size": "M",
          "lane": "pa",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D7",
          "title": "Einstellungs-Speicherung in ein Untermodul unter store/",
          "size": "M",
          "lane": "st",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "ARCH-D8",
          "title": "Ereignisnamen als gemeinsame Konstanten in Rust und TypeScript",
          "size": "M",
          "lane": "mn → pty → fe",
          "stand": "offen, nach v1.5.1",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "M4-R19-02",
          "title": "Vollständige Audit-Envelopes für die Pfade Ziel/Task (Matrixzeile 19); zugeschnitten in 02a #702 und 02b/03a #705, #698 Referenz",
          "size": "S",
          "lane": "st",
          "stand": "Erledigt: #702/#705/#717 gemergt; R19-Reste separat",
          "state": "open",
          "prNumbers": [
            702,
            705,
            717
          ]
        },
        {
          "id": "M4-R19-03",
          "title": "Vollständige Audit-Envelopes für die Pfade Claim/Checkpoint (Matrixzeile 19); 03a bereits im #705-Zuschnitt, vorhandene Envelopes wiederverwenden, Restumfang vor Dispatch prüfen",
          "size": "S",
          "lane": "st",
          "stand": "Verschoben nach v1.6.0; #705-Teilumfang bleibt erledigt",
          "state": "open",
          "prNumbers": [
            705
          ]
        },
        {
          "id": "M4-R19-04",
          "title": "Vollständige Audit-Envelopes für die Pfade Intent/Launch (Matrixzeile 19)",
          "size": "S",
          "lane": "st",
          "stand": "Verschoben nach v1.6.0",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "M4-R19-07",
          "title": "Vollständige Audit-Envelopes für die Pfade Kandidat/Evidence/Review (Matrixzeile 19)",
          "size": "S",
          "lane": "st",
          "stand": "Verschoben nach v1.6.0",
          "state": "open",
          "prNumbers": []
        },
        {
          "id": "M4-R19-09",
          "title": "Vollständige Audit-Envelopes für den Pfad Wartung (Matrixzeile 19)",
          "size": "S",
          "lane": "mn",
          "stand": "Verschoben nach v1.6.0",
          "state": "open",
          "prNumbers": []
        }
      ],
      "done": 1,
      "total": 17
    }
  ],
  "next": [
    {
      "packet": "`lage-jetzt` und die Live-Belege lesen; Ziel, Ow",
      "why": "`lage-jetzt` und die Live-Belege lesen; Ziel, Owner und nächsten Schritt mit den Z1–Z4-Tabellen in `docs/PLAN.md` abgleichen.",
      "source": "STAND.md#Nächster Griff",
      "lane": "parallel",
      "serialOwner": null,
      "doneWhen": "`lage-jetzt` und die Live-Belege lesen; Ziel, Owner und nächsten Schritt mit den Z1–Z4-Tabellen in `docs/PLAN.md` abgleichen.",
      "startable": true
    }
  ],
  "lessons": [
    {
      "id": "L-dc8be5e2f0",
      "createdAt": "2026-09-08T22:27:22.706Z",
      "lastSeen": "2026-09-08T22:27:22.706Z",
      "hits": 1,
      "symptom": "cargo check fails in pre-commit: Package gdk-3.0 was not found in the pkg-config search path",
      "cause": "Fresh Linux container without the GTK/WebKit development headers Tauri links against",
      "fix": "apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev — then rerun the commit; never bypass the hook with --no-verify",
      "tags": [
        "cargo",
        "linux",
        "pre-commit"
      ],
      "source": ".pa/report_devhq_lanes_m12_m14.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-32124d0483",
      "createdAt": "2026-09-08T22:27:22.758Z",
      "lastSeen": "2026-09-08T22:27:22.758Z",
      "hits": 1,
      "symptom": "browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-<n>",
      "cause": "The npm @playwright/test version pins a newer Chromium build than the one preinstalled on the runner",
      "fix": "HQ_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:hq:visual (or npx playwright install chromium where downloads are allowed)",
      "tags": [
        "chromium",
        "playwright",
        "tests"
      ],
      "source": "scripts/lib/hq-visual.browser.mjs",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-f2d4c93cfa",
      "createdAt": "2026-09-08T22:27:22.815Z",
      "lastSeen": "2026-09-08T22:27:22.815Z",
      "hits": 1,
      "symptom": "git stash pop fails: Your local changes would be overwritten by merge (docs/dev-hq/data.js)",
      "cause": "Running the HQ tests regenerates data.js/data.json; a stash taken before the run no longer applies cleanly. Worktrees also share one stash stack, so a stash can grab another session's work",
      "fix": "Do not stash in this repo — make a WIP commit instead. If already stashed: git checkout -- docs/dev-hq/data.js docs/dev-hq/data.json && git stash pop",
      "tags": [
        "dev-hq",
        "git",
        "worktree"
      ],
      "source": "CLAUDE.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-6fd4c65aab",
      "createdAt": "2026-09-08T22:27:22.873Z",
      "lastSeen": "2026-09-08T22:27:22.873Z",
      "hits": 1,
      "symptom": "A gate looked green but the failing status was masked",
      "cause": "Piping a command into tail/head/grep replaces its exit code with the pipe's last command",
      "fix": "Read exit codes unmasked: run the gate alone, or use set -o pipefail and check PIPESTATUS",
      "tags": [
        "gates",
        "shell"
      ],
      "source": "CLAUDE.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-c1242ee204",
      "createdAt": "2026-09-08T22:27:22.930Z",
      "lastSeen": "2026-09-08T22:27:22.930Z",
      "hits": 1,
      "symptom": "HQ test 'Now grip is STAND prose' fails after a STAND revision although nothing is broken",
      "cause": "The test matched a fixed phrase from an older STAND §3 instead of the contract (verbatim STAND prose)",
      "fix": "Bind content tests to the source document (read STAND.md and assert containment), not to one wording",
      "tags": [
        "dev-hq",
        "stand",
        "tests"
      ],
      "source": "scripts/lib/hq-pages.test.mjs",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-d211310281",
      "createdAt": "2026-09-08T22:27:22.987Z",
      "lastSeen": "2026-09-08T22:27:22.987Z",
      "hits": 1,
      "symptom": "Worker dies with chat_admission_busy or invalid_api_key and blind retries burn the quota",
      "cause": "An error with its own code is a documented condition, not noise; 'retry shortly' is an instruction",
      "fix": "Investigate the first failure: worker-why <name> names cause and remedy before any retry loop",
      "tags": [
        "omniroute",
        "retries",
        "workers"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-0fc6438deb",
      "createdAt": "2026-09-08T22:27:23.045Z",
      "lastSeen": "2026-09-08T22:27:23.045Z",
      "hits": 1,
      "symptom": "Reachability check passes while the service is dead",
      "cause": "The probe asked 'answer with READY' and grepped READY — the model echoed the prompt",
      "fix": "Ask for something whose answer is not in the question, and make the check fail once on purpose before trusting it (preflight --selftest)",
      "tags": [
        "preflight",
        "verification"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-1fa4cacf90",
      "createdAt": "2026-09-08T22:27:23.102Z",
      "lastSeen": "2026-09-08T22:27:23.102Z",
      "hits": 1,
      "symptom": "Release endpoint check green, but the updater app got 404 (Could not fetch a valid release JSON)",
      "cause": "Verification ran with gh auth token credentials the product does not have",
      "fix": "Probe remote endpoints anonymously with exactly the product's headers; the release workflow's anonymous verify gate does this",
      "tags": [
        "release",
        "updater",
        "verification"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-a2b34ecd04",
      "createdAt": "2026-09-08T22:27:23.161Z",
      "lastSeen": "2026-09-08T22:27:23.161Z",
      "hits": 1,
      "symptom": "cargo build aborts with 0xc000012d / mmap errors under parallel load",
      "cause": "Machine memory pressure, not a code problem",
      "fix": "CARGO_BUILD_JOBS=2 and rebuild. Never set CARGO_PROFILE_* env vars — that invalidates the whole dependency cache",
      "tags": [
        "build",
        "cargo",
        "windows"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-3db6dbc1f6",
      "createdAt": "2026-09-08T22:27:23.220Z",
      "lastSeen": "2026-09-08T22:27:23.220Z",
      "hits": 1,
      "symptom": "Vite answers 504 Outdated Optimize Dep on every module",
      "cause": "Vite's dependency cache is stale after a dependency change",
      "fix": "scripts/dev-fresh.cmd (clears the dep cache and restarts)",
      "tags": [
        "frontend",
        "vite"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-d78036fb38",
      "createdAt": "2026-09-08T22:27:23.279Z",
      "lastSeen": "2026-09-08T22:27:23.279Z",
      "hits": 1,
      "symptom": "cd <worktree> && git ... acts on the wrong repository",
      "cause": "The agent shell resets the working directory between calls",
      "fix": "Always git -C <path> ..., never cd X && git ...",
      "tags": [
        "git",
        "shell",
        "worktree"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-15af4dc17a",
      "createdAt": "2026-09-08T22:27:23.336Z",
      "lastSeen": "2026-09-08T22:27:23.336Z",
      "hits": 1,
      "symptom": "Orchestrator spent 223k tokens mostly on waiting",
      "cause": "Polling every 60s on 20-minute work",
      "fix": "Poll at a fraction of the expected duration or wait on a cheap signal (file exists, process exited)",
      "tags": [
        "orchestrator",
        "polling",
        "tokens"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-b973efab33",
      "createdAt": "2026-09-08T22:27:23.399Z",
      "lastSeen": "2026-09-08T22:27:23.399Z",
      "hits": 1,
      "symptom": "The same bug reappeared right next to the freshly fixed one",
      "cause": "A fix is the moment with the highest chance of repeating the pattern nearby",
      "fix": "After each fix, search the fix's siblings for the same mistake before committing",
      "tags": [
        "process",
        "review"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-9be7ac486f",
      "createdAt": "2026-09-08T22:27:23.456Z",
      "lastSeen": "2026-09-08T22:27:23.456Z",
      "hits": 1,
      "symptom": "Status tool reported five successful workers as dead",
      "cause": "Success was derived from a report file instead of the work left behind (commits on the branches)",
      "fix": "Derive state from artefacts — commits, files, processes — never from a form somebody should have filled",
      "tags": [
        "status",
        "verification",
        "workers"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-5a2226bd8d",
      "createdAt": "2026-09-08T22:27:23.514Z",
      "lastSeen": "2026-09-08T22:27:23.514Z",
      "hits": 1,
      "symptom": "A daemon started by a scheduled task survives Stop-ScheduledTask",
      "cause": "It detaches and keeps running under its old PID",
      "fix": "Kill the process directly, then measure again instead of assuming",
      "tags": [
        "daemon",
        "ops",
        "windows"
      ],
      "source": "AGENTS.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 37,
        "votes": 0
      }
    },
    {
      "id": "L-242f649538",
      "createdAt": "2026-09-08T22:37:49.091Z",
      "lastSeen": "2026-10-02T22:21:26.585Z",
      "hits": 2,
      "symptom": "CI red-first: '<file> war an der Merge-Base GRUEN — das ist kein Test-First-Beleg'",
      "cause": "The Test-First: trailer named an existing test file that only gained new cases; red-first runs the whole file at the merge-base and it passed there",
      "fix": "Put new test cases for an existing suite into a new *.test.mjs file (missing at base = red) and name that file in the Test-First: trailer; a trailer already pushed must be amended on your own branch",
      "tags": [
        "ci",
        "git",
        "red-first",
        "test-first"
      ],
      "source": ".pa/report_devhq_v2.md",
      "worked": 1,
      "failed": 0,
      "feedbackRuns": [
        {
          "runId": "pl-104-cifix-07e542f",
          "outcome": "worked",
          "observedAt": "2026-10-02T22:21:26.585Z"
        }
      ],
      "badges": {
        "label": "new",
        "confidence": 100,
        "ageDays": 13,
        "votes": 1
      }
    },
    {
      "id": "L-9c3141fa5f",
      "createdAt": "2026-09-10T15:06:34.316Z",
      "lastSeen": "2026-09-10T15:06:34.316Z",
      "hits": 1,
      "symptom": "HQ profile save drops wrapper metadata or overwrites corrupt JSON",
      "cause": "Profile writes rebuilt the wrapper and non-strict reads hid parse failures",
      "fix": "Use strict reads before edits, preserve unknown wrapper and profile fields, and atomically replace the profile file",
      "tags": [
        "configuration",
        "hq",
        "profiles"
      ],
      "source": ".pa/report_continuous_devhq.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 35,
        "votes": 0
      }
    },
    {
      "id": "L-4786a45bc6",
      "createdAt": "2026-09-10T21:55:23.371Z",
      "lastSeen": "2026-09-10T21:55:23.371Z",
      "hits": 1,
      "symptom": "HQ backend ancestor ownership misses files under the directory",
      "cause": "Normalizing protected paths to a seam sentinel discarded the actual path overlap",
      "fix": "Preserve declared paths, apply seam exclusion during conflict checks, conservatively expand legacy sentinels",
      "tags": [
        "hq",
        "ownership",
        "regression"
      ],
      "source": ".pa/report_continuous_runtime.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 35,
        "votes": 0
      }
    },
    {
      "id": "L-151ce5695b",
      "createdAt": "2026-09-11T10:55:27.921Z",
      "lastSeen": "2026-09-11T10:55:27.921Z",
      "hits": 1,
      "symptom": "HQ advertises test-only built-in profiles and drops runtime capabilities",
      "cause": "Regex scanned all Rust source, including unit fixtures; JavaScript merging did not follow Rust defaults",
      "fix": "Read one shared embedded profile manifest, compare runtime provenance, and test replacement plus longest-prefix inheritance",
      "tags": [
        "configuration",
        "evidence",
        "hq",
        "profiles"
      ],
      "source": ".pa/report_continuous_profiles.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-58319dab4f",
      "createdAt": "2026-09-11T11:42:44.756Z",
      "lastSeen": "2026-09-11T11:42:44.756Z",
      "hits": 1,
      "symptom": "Token exhaustion and legacy backfill granted unintended capacity",
      "cause": "Strict greater-than missed exact exhaustion; migration serialized evolving defaults",
      "fix": "Distinguish measured exhaustion from held reservations and freeze legacy token allowance as unavailable; keep boundary regression tests",
      "tags": [
        "budgets",
        "migration",
        "regression"
      ],
      "source": ".pa/report_continuous_budgets.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-f6b9db1f1d",
      "createdAt": "2026-09-11T14:56:25.201Z",
      "lastSeen": "2026-09-11T14:56:25.201Z",
      "hits": 1,
      "symptom": "Policy supervisor skips deadline checks when its notification observer fails",
      "cause": "A wake-hint transport was used as authority to skip the independent SQLite transaction",
      "fix": "Reconcile the authoritative store on periodic ticks even when notification health fails; preserve degraded observer status separately and test block-once behavior",
      "tags": [
        "notifications",
        "recovery",
        "supervisor"
      ],
      "source": ".pa/report_continuous_policy_supervisor.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-a5669fa974",
      "createdAt": "2026-09-11T16:50:09.345Z",
      "lastSeen": "2026-09-11T16:50:09.345Z",
      "hits": 1,
      "symptom": "Test-First CI rejects successful long Rust logs with Broken pipe",
      "cause": "grep -q exits before printf drains a large log; pipefail reports SIGPIPE as failure, and negative zero-test checks can invert it.",
      "fix": "Drain the entire stream with grep -E redirected to null; test long success and zero-test logs plus nonzero exits.",
      "tags": [
        "bash",
        "ci",
        "pipefail"
      ],
      "source": ".pa/report_continuous_ci.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-1cd96b04c4",
      "createdAt": "2026-09-11T17:16:32.561Z",
      "lastSeen": "2026-09-11T17:16:32.561Z",
      "hits": 1,
      "symptom": "Continuous claims exceed two workers when projects claim concurrently",
      "cause": "Capacity was counted per project although all projects share one execution host.",
      "fix": "Retain project limits and count all running claims inside the existing serialized claim transaction; never free slots on pause or lease expiry.",
      "tags": [
        "capacity",
        "concurrency",
        "continuous"
      ],
      "source": ".pa/report_continuous_capacity.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-f9dd5890f0",
      "createdAt": "2026-09-11T17:47:48.427Z",
      "lastSeen": "2026-09-11T17:50:36.812Z",
      "hits": 1,
      "symptom": "Database restore loses original target on rename failure and consumes an existing temp file",
      "cause": "Restore removed the destination before rename and copied into a predictable unowned temporary pathname.",
      "fix": "Exclusively create an owner-private temporary file, flush the owned handle, then replace via rename without deleting the destination first; preserve unowned collisions.",
      "tags": [
        "filesystem",
        "recovery",
        "restore"
      ],
      "source": ".pa/report_restore_file_safety.md",
      "history": [
        {
          "at": "2026-09-11T17:50:36.812Z",
          "fix": "Exclusively create a private temporary file, preserve backup permissions and flush the owned handle, then replace via rename without deleting the destination first.",
          "note": "Full-suite permission-owner gate rejected direct permission mutation; use the existing secure-create pattern, not broader backup permission bits."
        }
      ],
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-4314196d30",
      "createdAt": "2026-09-11T18:49:42.176Z",
      "lastSeen": "2026-09-11T18:49:42.176Z",
      "hits": 1,
      "symptom": "Run launch journal fails with database is locked under another SQLite writer",
      "cause": "Deferred transaction reads state before acquiring write access; SQLite WAL cannot always upgrade that read snapshot.",
      "fix": "Begin state-changing run transactions with BEGIN IMMEDIATE before authority reads; keep read-only views deferred and test a held competing writer.",
      "tags": [
        "concurrency",
        "runs",
        "sqlite"
      ],
      "source": ".pa/report_continuous_run_contention.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-e6b55e9d19",
      "createdAt": "2026-09-11T19:25:59.671Z",
      "lastSeen": "2026-09-11T19:25:59.671Z",
      "hits": 1,
      "symptom": "Capture settlement accepts a provider route changed while waiting for the ledger writer",
      "cause": "Provider route and exit were checked outside the settlement transaction",
      "fix": "Recheck the exact validated route receipt and exit code under the same writer lock as run/session and ledger settlement, including replay",
      "tags": [
        "identity",
        "sqlite",
        "usage"
      ],
      "source": ".pa/report_continuous_capture_atomicity.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-99b548f2b3",
      "createdAt": "2026-09-11T19:58:38.114Z",
      "lastSeen": "2026-09-11T19:58:38.114Z",
      "hits": 1,
      "symptom": "red-first treats a fully qualified Rust test name as a missing file",
      "cause": "Trailer parsing assumes every :: reference begins with a source file path",
      "fix": "Recognize Rust module identifiers and retain unique real-test discovery and positive test counts; test module-name success and zero-test rejection",
      "tags": [
        "ci",
        "rust",
        "test-first"
      ],
      "source": ".pa/report_continuous_ci.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-fa7ec0b52a",
      "createdAt": "2026-09-11T21:00:07.530Z",
      "lastSeen": "2026-09-11T21:00:07.530Z",
      "hits": 1,
      "symptom": "Concurrent evidence submissions time out acquiring SQLite connections under load",
      "cause": "Synchronous Git probes occupied async runtime threads; a controlled regression demonstrated blocked database progress, without proving Git held a SQL connection",
      "fix": "Offload evidence Git probes behind two shared owned permits; keep the permit through blocking work and retain code/policy checks before evidence writes",
      "tags": [
        "concurrency",
        "evidence",
        "sqlite"
      ],
      "source": ".pa/report_evidence_probe_progress.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 34,
        "votes": 0
      }
    },
    {
      "id": "L-dfd9e7e90e",
      "createdAt": "2026-09-12T09:05:02.691Z",
      "lastSeen": "2026-09-12T09:05:02.691Z",
      "hits": 1,
      "symptom": "Git ownership diff hides out-of-scope submodule commits",
      "cause": "Repository diff.ignoreSubmodules configuration suppresses gitlinks from name-only diffs",
      "fix": "Use --ignore-submodules=none with NUL-delimited, no-renames baseline-to-candidate diffs; verify both rename sides and immutable backend launch baseline",
      "tags": [
        "candidate",
        "evidence",
        "git",
        "ownership"
      ],
      "source": ".pa/report_candidate_ownership.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-229e7163d2",
      "createdAt": "2026-09-12T11:06:18.186Z",
      "lastSeen": "2026-09-12T11:06:18.186Z",
      "hits": 1,
      "symptom": "Update guard reports idle while a session is reserved or native exit is unconfirmed",
      "cause": "Separate starting/live registries and empty defaults hide pending or failed process observations",
      "fix": "Use one atomic reserved-starting-interactive registry; propagate unknown inventory; dispatch exit effects only after confirmed native wait; a snapshot still requires a maintenance lock",
      "tags": [
        "concurrency",
        "evidence",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_session_inventory.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-6627acad8b",
      "createdAt": "2026-09-12T12:13:05.589Z",
      "lastSeen": "2026-09-12T12:13:05.589Z",
      "hits": 1,
      "symptom": "Capture timeout hides unresolved input writer cleanup",
      "cause": "Execution error was returned before distinguishing writer join failure from delivery failure",
      "fix": "Preserve separate retirement and delivery results; propagate unresolved cleanup before execution error, retaining the execution error only after confirmed writer join",
      "tags": [
        "capture",
        "cleanup",
        "windows"
      ],
      "source": ".pa/report_host_timeout_cleanup.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-880d8ec43b",
      "createdAt": "2026-09-12T15:31:07.131Z",
      "lastSeen": "2026-09-12T15:31:07.131Z",
      "hits": 1,
      "symptom": "SQLx row column metadata panics after multiple ALTER TABLE migrations",
      "cause": "Startup connections retained column metadata from an earlier schema generation; schema15 to17 test reproduced len16 index16 twice",
      "fix": "Retire and reopen the startup pool after successful schema changes before publishing Store, preserving connection options; verify populated old-schema rows",
      "tags": [
        "migration",
        "recovery",
        "sqlite"
      ],
      "source": ".pa/report_development_delivery_ledger.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-44b44b8dd6",
      "createdAt": "2026-09-12T16:01:12.219Z",
      "lastSeen": "2026-09-12T16:01:12.219Z",
      "hits": 1,
      "symptom": "Session inventory becomes idle before core exit bookkeeping completes",
      "cause": "Native reaper called a hook that detached asynchronous database and credential work, then removed the session",
      "fix": "Await an explicit core exit result on the dedicated reaper, retain a Retiring entry during owned resource release and on failure, and require separate reader/global-write drain gates",
      "tags": [
        "concurrency",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_exit_bookkeeping_gate.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-7798ae705e",
      "createdAt": "2026-09-12T16:22:00.713Z",
      "lastSeen": "2026-09-12T16:22:00.713Z",
      "hits": 1,
      "symptom": "Session inventory clears before the independent PTY reader retires",
      "cause": "Native exit and core bookkeeping complete independently of the output thread and owned reader handle",
      "fix": "Retain the shared Retiring marker through resource disposal and bounded reader acknowledgement; timeout or panic keeps reconciliation required",
      "tags": [
        "concurrency",
        "sessions",
        "updater"
      ],
      "source": ".pa/report_reader_retirement_gate.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-054b09e8f6",
      "createdAt": "2026-09-12T16:57:36.038Z",
      "lastSeen": "2026-09-12T16:57:36.038Z",
      "hits": 1,
      "symptom": "A prepared worker route is not compared with its durable launch receipt",
      "cause": "Pre-spawn validation checked current profile and policy but the receipt omitted the translated profile and was not compared before consumption",
      "fix": "Hash the prepared profile without publishing secrets and require exact write-once receipt equality before session reservation, credential binding and spawn; keep final native overlays as separate evidence",
      "tags": [
        "identity",
        "routing",
        "workers"
      ],
      "source": ".pa/report_bound_prepared_invocation.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-9a2196f42f",
      "createdAt": "2026-09-12T22:12:47.565Z",
      "lastSeen": "2026-09-12T22:12:47.565Z",
      "hits": 1,
      "symptom": "Native drain blocks after a completion notification although its wait budget is zero",
      "cause": "The notification is sent before thread termination; immediate join waits for unconfirmed retirement",
      "fix": "Retain notified thread handles until is_finished, then join; preserve pending handles across drain timeouts and reproduce with a paused post-notification thread",
      "tags": [
        "concurrency",
        "drain",
        "threads"
      ],
      "source": ".pa/report_native_drain.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-0ae4de6822",
      "createdAt": "2026-09-12T23:11:43.988Z",
      "lastSeen": "2026-09-12T23:11:43.988Z",
      "hits": 1,
      "symptom": "Successful Tauri MSI build omits pa.exe while capture host is present",
      "cause": "Implicit multi-bin discovery produced an incomplete MSI inventory with CLI 2.11.4",
      "fix": "Declare all Cargo binary targets with explicit paths and inspect the actual MSI File table before publication",
      "tags": [
        "msi",
        "packaging",
        "tauri"
      ],
      "source": ".pa/report_msi_inventory.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 33,
        "votes": 0
      }
    },
    {
      "id": "L-021c8e1116",
      "createdAt": "2026-09-16T18:48:22.226Z",
      "lastSeen": "2026-09-16T18:48:22.226Z",
      "hits": 1,
      "symptom": "Kimi-Worker: Submit-Guard schreibt den Auftrag, sieht kein Echo, drei Rewrites, Eskalation needs_you nach 24 s; Composer zeigt den Text erst, wenn jemand die Terminal-Ansicht oeffnet",
      "cause": "Kimi Code 0.43 fragt als allererstes ESC[6n (Cursor-Position) und blockiert seinen gesamten Start bis zur Antwort (Roh-PTY-Capture: 4 Bytes, dann 200 s Stille). ConPTY antwortet nicht, der Reader-Thread der App antwortete nicht; nur ein angehaengtes xterm.js antwortete. Die Stille-Heuristik des Guards las '4 Bytes, dann ruhig' als settled und tippte in einen blockierten Prozess",
      "fix": "pty.rs: Reader-Thread beantwortet ESC[6n selbst mit ESC[1;1R (CursorReportScanner, chunk-uebergreifend); submit_guard.rs: ohne Readiness-Marker gilt nur sichtbarer Inhalt als Startausgabe. Fixture src-tauri/testdata/pty/kimi-0.43.0-composer-2026-09-16.raw; Bericht .pa/report_kimi_raw_stream_2026-09-16.md",
      "tags": [
        "conpty",
        "kimi",
        "nt-17",
        "pty",
        "submit-guard"
      ],
      "source": ".pa/report_kimi_raw_stream_2026-09-16.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 29,
        "votes": 0
      }
    },
    {
      "id": "L-1102db326f",
      "createdAt": "2026-09-22T00:05:10.902Z",
      "lastSeen": "2026-09-22T00:05:10.902Z",
      "hits": 1,
      "symptom": "HQ post-merge skips retained snapshots or overwrites local edits",
      "cause": "Keep-ours driver leaves no output diff; generator wrote directly into possibly dirty outputs and reads lessons from its output directory",
      "fix": "Preserve dirty outputs; regenerate every merge into a temp directory seeded with lessons; validate both artifacts before replacing; ignore only top-level metadata",
      "tags": [
        "git",
        "hq",
        "regression"
      ],
      "source": ".pa/report_pr38_followup_2026-09-22.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 24,
        "votes": 0
      }
    },
    {
      "id": "L-8b092b4358",
      "createdAt": "2026-09-23T16:31:25.019Z",
      "lastSeen": "2026-09-23T16:31:25.019Z",
      "hits": 1,
      "symptom": "New schema migration fails existing old-schema rewind fixtures with table already exists",
      "cause": "Fixtures create latest schema then lower user_version without removing newly introduced schema objects; diagnosis schema constant also lagged",
      "fix": "Drop new child and parent tables only in isolated rewind fixtures, update diagnosis constant, retain strict production migration; rerun all seven failed cases and full prepush",
      "tags": [
        "migration",
        "schema",
        "tests"
      ],
      "source": ".pa/report_df05_fixture_repair.md",
      "badges": {
        "label": "new",
        "confidence": null,
        "ageDays": 22,
        "votes": 0
      }
    }
  ],
  "lessonStats": {
    "count": 40,
    "hits": 41,
    "tags": [
      {
        "tag": "concurrency",
        "count": 7
      },
      {
        "tag": "git",
        "count": 5
      },
      {
        "tag": "evidence",
        "count": 4
      },
      {
        "tag": "hq",
        "count": 4
      },
      {
        "tag": "sqlite",
        "count": 4
      },
      {
        "tag": "updater",
        "count": 4
      },
      {
        "tag": "ci",
        "count": 3
      },
      {
        "tag": "migration",
        "count": 3
      },
      {
        "tag": "recovery",
        "count": 3
      },
      {
        "tag": "regression",
        "count": 3
      },
      {
        "tag": "sessions",
        "count": 3
      },
      {
        "tag": "tests",
        "count": 3
      },
      {
        "tag": "verification",
        "count": 3
      },
      {
        "tag": "windows",
        "count": 3
      },
      {
        "tag": "workers",
        "count": 3
      },
      {
        "tag": "cargo",
        "count": 2
      },
      {
        "tag": "configuration",
        "count": 2
      },
      {
        "tag": "dev-hq",
        "count": 2
      },
      {
        "tag": "identity",
        "count": 2
      },
      {
        "tag": "ownership",
        "count": 2
      },
      {
        "tag": "profiles",
        "count": 2
      },
      {
        "tag": "shell",
        "count": 2
      },
      {
        "tag": "test-first",
        "count": 2
      },
      {
        "tag": "worktree",
        "count": 2
      },
      {
        "tag": "bash",
        "count": 1
      },
      {
        "tag": "budgets",
        "count": 1
      },
      {
        "tag": "build",
        "count": 1
      },
      {
        "tag": "candidate",
        "count": 1
      },
      {
        "tag": "capacity",
        "count": 1
      },
      {
        "tag": "capture",
        "count": 1
      },
      {
        "tag": "chromium",
        "count": 1
      },
      {
        "tag": "cleanup",
        "count": 1
      },
      {
        "tag": "conpty",
        "count": 1
      },
      {
        "tag": "continuous",
        "count": 1
      },
      {
        "tag": "daemon",
        "count": 1
      },
      {
        "tag": "drain",
        "count": 1
      },
      {
        "tag": "filesystem",
        "count": 1
      },
      {
        "tag": "frontend",
        "count": 1
      },
      {
        "tag": "gates",
        "count": 1
      },
      {
        "tag": "kimi",
        "count": 1
      },
      {
        "tag": "linux",
        "count": 1
      },
      {
        "tag": "msi",
        "count": 1
      },
      {
        "tag": "notifications",
        "count": 1
      },
      {
        "tag": "nt-17",
        "count": 1
      },
      {
        "tag": "omniroute",
        "count": 1
      },
      {
        "tag": "ops",
        "count": 1
      },
      {
        "tag": "orchestrator",
        "count": 1
      },
      {
        "tag": "packaging",
        "count": 1
      },
      {
        "tag": "pipefail",
        "count": 1
      },
      {
        "tag": "playwright",
        "count": 1
      },
      {
        "tag": "polling",
        "count": 1
      },
      {
        "tag": "pre-commit",
        "count": 1
      },
      {
        "tag": "preflight",
        "count": 1
      },
      {
        "tag": "process",
        "count": 1
      },
      {
        "tag": "pty",
        "count": 1
      },
      {
        "tag": "red-first",
        "count": 1
      },
      {
        "tag": "release",
        "count": 1
      },
      {
        "tag": "restore",
        "count": 1
      },
      {
        "tag": "retries",
        "count": 1
      },
      {
        "tag": "review",
        "count": 1
      },
      {
        "tag": "routing",
        "count": 1
      },
      {
        "tag": "runs",
        "count": 1
      },
      {
        "tag": "rust",
        "count": 1
      },
      {
        "tag": "schema",
        "count": 1
      },
      {
        "tag": "stand",
        "count": 1
      },
      {
        "tag": "status",
        "count": 1
      },
      {
        "tag": "submit-guard",
        "count": 1
      },
      {
        "tag": "supervisor",
        "count": 1
      },
      {
        "tag": "tauri",
        "count": 1
      },
      {
        "tag": "threads",
        "count": 1
      },
      {
        "tag": "tokens",
        "count": 1
      },
      {
        "tag": "usage",
        "count": 1
      },
      {
        "tag": "vite",
        "count": 1
      }
    ],
    "recent": [
      "L-242f649538",
      "L-8b092b4358",
      "L-1102db326f",
      "L-021c8e1116",
      "L-0ae4de6822"
    ]
  }
};
