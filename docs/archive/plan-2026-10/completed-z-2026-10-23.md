# Completed Z records — 23 October 2026

Historical source from `docs/PLAN.md` at `d39a03f1cffe52359516f8cfc1ebfa485e791ef4`; no dispatch authority.
The literal records below retain their original bytes and order. Link syntax inside the source block is historical text.
Working navigation: [current master](../../PLAN.md), [full package records](completed.md), [historical contracts](history.md).
Only discharged records without a remaining parser dependency target were retired; ambiguous duties remain in the master.

## Literal retired records

```text
| DR-04B-FU | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd; alternativ Root-Serverjob nach eindeutiger Zuweisung, kein Doppelstart | #669 gemergt; unabhängiger Schnitt von Root am 08.10. 20:45Z vorgezogen; Basis `fc85e3d` | Server | A | Erledigt #727 (merged 2026-10-08T22:06:42Z) | siehe Archiv | a27e7eb0 |
| DR-05 | [Archiv][pakete] | Seniorentwickler | DR-06b (Store, Delivery, Server und CLI benötigt) | Server | C bei reinem Testdiff; sonst B, höhere Risiken nach Regel 5 | Erledigt #734 (merged 2026-10-08T23:30:05Z) | siehe Archiv | 55ea21ce |
| DR-07c | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von 07d/e1/e2 | Server | C bei reinem Testport; Root kann B verlangen | Erledigt #752 (merged 2026-10-09T00:33:36Z) | siehe Archiv | 55ea21ce |
| DR-07d | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; DR-05-Verknüpfung kein neuer Dateivorgänger | Server | C bei reinem Testport; Root kann B verlangen | Erledigt #753 (merged 2026-10-08T23:38:16Z) | siehe Archiv | 55ea21ce |
| DR-07e1 | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von e2 | Server | C bei reinem Testport; Befund neu einstufen | Erledigt #751 (merged 2026-10-08T23:55:13Z) | siehe Archiv | 55ea21ce |
| DR-07e2 | [Archiv][pakete] | bestehende Denkraum-Lane qfytpd nach Root-Zuweisung | #681 gemergt; Basis `85ab286`; unabhängig von e1 | Server | C bei reinem Testport; Befund neu einstufen | Erledigt #755 (merged 2026-10-08T23:55:06Z) | siehe Archiv | 55ea21ce |
| DR-11-FU | [Archiv][pakete] | DR-11-Owner | DR-11/#718 gemergt | Server | B | Erledigt #870 (merged 2026-10-09T17:35:03Z) | siehe Archiv | – |
| DR-FU-0910g | [Archiv][pakete] | Root/Orchestrator | diverse Vorgänger-PRs | Server | B/C | Erledigt (alle sieben Nachzüge gemergt, #875–#892): R870-LOWS Erledigt #882 (merged 2026-10-09T18:24:36Z); R833-LOWS Erledigt #878 (merged 2026-10-09T18:38:04Z); R814-G1 Erledigt #877 (merged 2026-10-09T18:10:57Z); R824-G1 Erledigt #875 (merged 2026-10-09T18:17:58Z); R871-A7 Erledigt #890 (merged 2026-10-09T19:56:03Z); R877-LOWS Erledigt #887 (merged 2026-10-09T19:41:45Z); R887-FU Erledigt #892 (merged 2026-10-09T20:09:42Z) | siehe Archiv | PLAN-SYNC-0910g |
| DR-SEC-01d | [Archiv][pakete] | Root bindet einen Owner im Ticket | DR-SEC-01c | Server | A | Erledigt #823 (gemergt 2026-10-09T04:39:42Z) | siehe Archiv | b0221f4a |
| DR-SEC-01i | [Archiv][pakete] | Root bindet einen Owner im Ticket | DR-SEC-01f | Server | A | Erledigt #824 (gemergt 2026-10-09T04:51:19Z) | siehe Archiv | b0221f4a |
| HOOK-WIN-DOC | [Archiv][pakete] | derselbe Implementierer · Claude | HOOK-WIN; eigener Docs-Head | PC | C | Erledigt: #645 `094e2db`, 33 ALL, eigene Windows-prepush 21/456s Exit 0 und Root-Abnahme; tatsächlich nach #641 am 08.10. 07:13:16 UTC gemergt | siehe Archiv | fc99616e |
| Z2-RAM-SLOTS | [Archiv][pakete] | Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/build-slot.mjs` und eigener Test | Basis `fc85e3d`, unabhängig von DR-04B-FU und HYGIENE | Server | A (Start-/Ressourcenempfehlung) | Erledigt #725 (merged 2026-10-09T12:34:55Z); ersetzt: In Prüfung: Draft #725; E1 vom 09.10. erlaubte genau eine dritte Runde nur zum Delta | siehe Archiv | – |
| Z2-HYGIENE-STATUS | [Archiv][pakete] | Root weist einen vorhandenen Serverworker zu; nur `scripts/dev/hygiene.mjs` und eigener Test | Basis `fc85e3d`, unabhängig von beiden anderen Reservepaketen | Server | B | Erledigt #726 (merged 2026-10-08T23:30:10Z) | siehe Archiv | – |
| Z2-PR-PROTECTION | [Archiv][pakete] | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Erledigt #738 (merged 2026-10-09T00:09:16Z) | siehe Archiv | 77c993f3 |
| Z2-STATUS-UNKNOWN | [Archiv: Historie][historie] | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Erledigt #739 (merged 2026-10-08T22:50:42Z) | siehe Archiv | 77c993f3 |
| Z2-START-MEASURE | [Archiv][pakete] | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig von RAM-SLOTS #725 | Server | A | Erledigt #742 (merged 2026-10-08T22:36:59Z) | siehe Archiv | 77c993f3 |
| Z2-CIWATCH-SHAPE | [Archiv][pakete] | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Erledigt #745 (merged 2026-10-09T00:09:09Z) | siehe Archiv | 77c993f3 |
| Z2-MRP-COMPLETE | [Archiv: Historie][historie] | Root benennt bestehenden Serverworker; Dateipaar unten exklusiv | main `9d9eaa7`; unabhängig | Server | B | Erledigt #746 (merged 2026-10-08T22:55:35Z) | siehe Archiv | 77c993f3 |
| HOTFIX-HYGIENE-VERBS | [Archiv: Historie][historie] | abgeschlossener Root-Job | – | Server | C laut Root-Abnahme #777 | Erledigt #777 (merged 2026-10-09T00:33:23Z) | siehe Archiv | #777 |
| MRP-REGEX-SCRIPTS | [Archiv][pakete] | bestehender Owner `srv-mrp-regex-scripts` | MERGIFY-REPORT-REGEX/#768 | Server | B | Erledigt #782 (merged 2026-10-09T01:26:43Z); ersetzt: In Prüfung: Draft #782 | siehe Archiv | 46800384 |
| MATRIX-RECONCILE | [Archiv: Historie][historie] | bestehender Owner `srv-matrix-reconcile` | bestehende Belege; Continuous bleibt aus | Server | C | Erledigt #781 (merged 2026-10-09T01:17:02Z); ersetzt: In Prüfung: Draft #781 | siehe Archiv | a6a28ae8 |
| Z2-REVIEW-FOLLOWUPS-1 | [Archiv][pakete] | Root bindet vorhandenen Owner | konkrete Findings, Dateien und Abnahme vor Dispatch binden | Server | nach Dateischnitt festlegen | Erledigt #800 (merged 2026-10-09T02:07:35Z, `15305c2e`); ersetzt: Geplant; kein neuer Worker aus PLAN-Eintrag | siehe Archiv | PLAN-SYNC-0910b |
| Z2-STATUS-CI | [Archiv][historie] | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #773 (merged 2026-10-09T00:48:18Z) | siehe Archiv | 77c993f3 |
| Z2-SETUP-VERSION | [Archiv][historie] | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #772 (merged 2026-10-09T00:48:05Z) | siehe Archiv | 77c993f3 |
| Z2-ERLEDIGT-META | [Archiv][historie] | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Codex Cloud Node 20 möglich; Server Node 24 | B | Erledigt #769 (merged 2026-10-09T00:48:09Z) | siehe Archiv | 77c993f3 |
| Z2-SPEC-STATUS | [Archiv][historie] | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Server | B | Erledigt #767 (merged 2026-10-09T00:33:27Z) | siehe Archiv | 77c993f3 |
| Z2-PUSH-REMOTE | [Archiv][historie] | Root/Stabschef benennt einen vorhandenen Owner | main a8f0032; unabhängig | Server | A | Erledigt #788 (merged 2026-10-09T01:17:15Z); ersetzt: In Prüfung: Draft #788 (GitHub 09.10.) | siehe Archiv | 77c993f3 |
| V16-ARCH-D7 | [Archiv][pakete] | Implementierer · Codex | V16-ARCH-D4-05 (Review seriell) | Server | A | Erledigt #632 (merged 2026-10-08T15:25:08Z) | siehe Archiv | 782d9e58 |
| V16-ADR-A1 | [Archiv: Historie][historie] | bestehender Root-Job `srv-v16-adr-a1`; Fable bei Root | – | Server | C | Erledigt #667 (merged 2026-10-08T14:34:03Z) | siehe Archiv | 72f47044 |
| V16-CHANGELOG-b | [Archiv: Historie][historie] | bestehender Owner | V16-CHANGELOG-a | Server | C | Erledigt #861 (merged 2026-10-09T15:02:01Z) | siehe Archiv | – |
| FLAKE-Q-TMP | [Archiv: Historie][historie] | bestehender Owner `srv-flake-q-tmp` | keine st-Änderung; #737 bleibt exklusiver st-Owner | Server / Windows-Beleg | B laut Auftrag #784 | Erledigt #784 (merged 2026-10-09T01:17:07Z); ersetzt: In Prüfung: Draft #784 | siehe Archiv | e257cee3 |
| KI25-SETUP-XDEAD | [Archiv][pakete] | bestehender Owner `srv-ki25-setup-xdead` | – | Server | B | Erledigt #780 (merged 2026-10-09T01:17:11Z); ersetzt: In Prüfung: Draft #780 | siehe Archiv | ca926ea3 |
| KI-CLOSE-C | [Archiv: Historie][historie] | Root bindet vorhandenen Doku-Owner | datierte Abschlussbelege je betroffenem KI-Eintrag | Server | C | Erledigt #790 (merged 2026-10-09T01:45:33Z; title: docs: close eight obsolete HQ bug records (KI-CLOSE-C)); ersetzt: Geplant; Abschluss-/PR-Beleg hier nicht beobachtet | siehe Archiv | PLAN-SYNC-0910b |
| KI-AUDIT-9-10 | [Archiv][pakete] | Root bindet vorhandenen Prüfowner | bestehende Quellen lesen; kein Fixauftrag aus Prüfung | Server | C für Bericht | Erledigt #804 (merged 2026-10-09T02:32:04Z; title: docs: refresh KI-9 and KI-10 from the October 9 audit); ersetzt: Geplant; Prüfbericht hier nicht beobachtet | siehe Archiv | PLAN-SYNC-0910b |
| V161 | [Archiv][pakete] | – | V16-RELEASE | – | – | Erledigt 10.10.: 31 PRs #933, #934, #935, #936, #938, #940, #944, #945, #946, #948, #950, #953, #955, #958, #962, #964, #965, #970, #973, #974, #975, #976, #977, #978, #979, #980, #982, #986, #989, #991, #997 (Branches `*/v161-*`); Release-Bump #1063 (`85dd8ef7`) | siehe Archiv | – |
| CI-SEC-01 | [Archiv][pakete] | – | – | – | – | Erledigt 11.10.: #1171 (`9a41ce11`), #1208 (`117a1e3a`), #1231 (`5bc9a500`), #1172 (`36bee03c`) | siehe Archiv | – |
| TOOL-GUARDS | [Archiv][pakete] | – | – | – | – | Erledigt: #1147 (`20785579`), #1149 (`bbe91509`) 11.10.; #1361 (`59320781`) 14.10. | siehe Archiv | – |
| LOOP-1 | [Archiv][pakete] | – | – | – | – | Erledigt 11.10.: #1251 (`ff64a86b`), #1252 (`9ee1e8c4`), #1255 (`2b53868c`), #1260 (`186d325c`), #1276 (`52960347`) | siehe Archiv | – |
| DEV-BUILD-FEEDBACK | [Archiv][pakete] | – | – | – | – | Erledigt: #1214 (`f11beb51`), #1268 (`3cf4e9d3`), #1272 (`177a6360`), #1283 (`aa97112e`), #1287 (`6ac21980`) 11.10.; #1290 (`ec656b36`) 12.10.; #1292 (`5a3372de`), #1302 (`6e61f4c2`), #1306 (`8dcdf8bd`), #1311 (`acfdbc48`) 13.10. | siehe Archiv | – |
| DR2-1 | [Archiv][pakete] | – | DR2-0 | – | – | Erledigt: #1336 (merged 2026-10-14, `4b882f35`) | siehe Archiv | – |
| AP-2 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1399 (`f240e956`), #1403 (`03183325`) | siehe Archiv | – |
| AP-4a | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1410 (`69cefcaa`) | siehe Archiv | – |
| AP-5 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1401 (`8ed489ac`), #1439 (`33980373`) | siehe Archiv | – |
| AP-6a | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1424 (`2648f097`) | siehe Archiv | – |
| AP-8 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1402 (`c722c89c`), #1407 (`e6851aa8`) | siehe Archiv | – |
| AP-10 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1400 (`23c189f6`), #1404 (`d37841a6`), #1412 (`e2be4a51`), #1425 (`0a84cec1`), #1420 (`fb9db458`) | siehe Archiv | – |
| AP-11 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1411 (`53ad10e5`), #1414 (`ea649d2c`), #1416 (`e1e46938`), #1421 (`0d80708e`) | siehe Archiv | – |
| UI-TEXTE-1014 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1417 (`b2f496bb`), #1419 (`4180d3ad`) | siehe Archiv | – |
| CLEAN-1014 | [Archiv][pakete] | – | – | – | – | Erledigt 14.10.: #1428 (`9a753900`), #1433 (`cb02847d`), #1435 (`f6867c1d`) | siehe Archiv | – |
| SLIM-TESTS | [Archiv][pakete] | – | – | – | – | Erledigt: move-check #1431 (`83d702a1`, 14.10.); SLIM-M1 #1451 (`20275b8d`), SLIM-S1 #1459 (`d96abfaa`), SLIM-A1 #1456 (`85a0c61e`), SLIM-P1 #1457 (`18ef908e`), 15.10. | siehe Archiv | – |
| FLK-KI34 | [Archiv][pakete] | – | – | – | – | Erledigt: #1504 (`9c7a785d`, 15.10.); `KNOWN_ISSUES.md` KI-34 | siehe Archiv | – |
| FLK-KI35 | [Archiv][pakete] | – | – | – | – | Erledigt 15.10.: #1543 (`be305ef4`), #1554 (`a5f8c538`), #1545 (`3015d841`); `KNOWN_ISSUES.md` KI-35 | siehe Archiv | – |
| FIX-1015 | [Archiv][pakete] | – | – | – | – | Erledigt 15.10.: #1510 (`2e687b7b`), #1517 (`d173cd82`), #1535 (`000ed75b`) | siehe Archiv | – |
| DEPS-1002 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–06.10.: #37, #40, #41, #57, #77, #588 | siehe Archiv | – |
| DOC-OEFF-1004 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–14.10.: #52, #293, #513, #609, #1279, #1454 | siehe Archiv | – |
| DOC-ANWEISUNG-1002 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–15.10.: #43, #467, #517, #918, #1006, #1440, #1477 | siehe Archiv | – |
| SEC-02 | [Archiv: Historie][historie] | – | – | – | – | Erledigt 02.10.: #64, #71, #88, #90, #117 | siehe Archiv | – |
| KI-1002 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–14.10.: #83, #84, #85, #86, #116, #123, #141, #208, #331, #339, #476, #543, #1438 | siehe Archiv | – |
| BUG-1002 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–03.10.: #101, #104, #106, #107, #108, #139 | siehe Archiv | – |
| TEST-1003 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–11.10.: #92, #93, #94, #129, #145, #237, #240, #262, #573, #843, #1206, #1232, #1254 | siehe Archiv | – |
| FE-STATE-1004 | [Archiv][pakete] | – | – | – | – | Erledigt 03.–05.10.: #194, #303, #308, #312, #313, #319, #324, #329, #342, #344, #345, #356, #450, #465 | siehe Archiv | – |
| M4-NACHWEIS-1004 | [Archiv][pakete] | – | – | – | – | Erledigt 04.–05.10.: #315, #346, #373, #405, #431, #432, #440, #443, #453, #456 | siehe Archiv | – |
| CI-WAECHTER-1003 | [Archiv][pakete] | – | – | – | – | Erledigt 02.–05.10.: #61, #148, #170, #175, #279, #351, #369, #370, #396, #404, #419, #427, #435, #521, #534 | siehe Archiv | – |
| DEV-BUILD-1011 | [Archiv][pakete] | – | – | – | – | Erledigt 11.10.: #1161, #1193, #1264, #1266 | siehe Archiv | – |
| PC-TRUST-1011 | [Archiv][pakete] | – | – | – | – | Erledigt 11.10.: #1248, #1249, #1261, #1275 | siehe Archiv | – |
| REL-1005 | [Archiv][pakete] | – | – | – | – | Erledigt 04.–05.10.: #338, #472, #482, #484, #569 | siehe Archiv | – |
| HQ-KLEIN-1003 | [Archiv: Historie][historie] | – | – | – | – | Erledigt 03.–05.10.: #131, #326, #511, #514, #516 | siehe Archiv | – |
| UI-KLEIN-1005 | [Archiv][pakete] | – | – | – | – | Erledigt 03.–05.10.: #153, #172, #290, #497, #501, #512, #524, #526, #541 | siehe Archiv | – |
| V16-HAERTUNG-1005 | [Archiv][pakete] | – | – | – | – | Erledigt 05.–06.10.: #499, #533, #535, #536, #537, #539, #542, #544, #556, #558, #559, #560, #561, #599, #600, #601, #606 | siehe Archiv | – |
| DR-NACH-1009 | [Archiv: Historie][historie] | – | – | – | – | Erledigt 09.10.: #805, #809, #814, #818, #819, #896, #902, #904, #905, #908, #910, #911, #912, #914 | siehe Archiv | – |
| PLAN-SYNC-HIST | [Archiv][pakete] | – | – | – | – | Erledigt 03.–15.10.: #142, #242, #258, #266, #284, #354, #361, #463, #540, #591, #795, #837, #849, #856, #881, #897, #924, #1491, #1525, #1536, #1539, #1565; geschlossen ohne Merge, ersetzt durch PLAN-CLEAN-1: #1586, #1587 | siehe Archiv | – |
| PLAN-ENTSCHEID-HIST | [Archiv][pakete] | – | – | – | – | Erledigt 02.–15.10.: #54, #165, #188, #295, #307, #320, #390, #399, #426, #478, #491, #619, #633, #668, #680, #686, #690, #693, #695, #700, #711, #722, #733, #744, #749, #1229, #1234, #1386, #1481 | siehe Archiv | – |
| V16-PAKETE-HIST | [Archiv][pakete] | – | – | – | – | Erledigt 05.–06.10.: #493, #494, #495, #496, #505, #509, #510, #523, #528, #530, #553, #590, #617 | siehe Archiv | – |
```
