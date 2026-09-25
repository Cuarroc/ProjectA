# W1-26 — Redaction kennt die Token-Form

Status: historisch

Abgeschlossen: gemergt mit PR #73 (Zeile in `docs/ERLEDIGT.md`); diese Spec ist nur noch Beleg.

Aktivierung (Eintrag unter "Aktive Specs" in STAND.md) zurückgestellt bis
nach dem Merge von PR #70 — STAND.md wird dort umgebaut, ein Eintrag jetzt
würde in den Merge-Konflikt laufen bzw. sofort wieder verworfen. Diese Datei
bleibt bis dahin `Status: entwurf` und ist damit für das Spec-Status-Gate
weder ausführbar noch fehlerhaft.

## Befund

`src-tauri/src/redact.rs::looks_secret` maskiert nur Segmente mit einem
bekannten Präfix (`sk-`, `ghp_`, `gho_`, `ghs_`, `github_pat_`, `xoxb-`,
`xoxp-`, `AIza`, `AKIA`) oder einem PEM-Header. API- und Verdict-Token, die
`api::new_token` (`src-tauri/src/api.rs`) mit `format!("{:032x}", ...)` aus 16
Zufallsbytes prägt, sind 32 kleingeschriebene Hex-Ziffern ohne jedes Präfix und
fallen durch keine der bestehenden Regeln. Sie gehen damit unmaskiert durch
den Choke-Point in `logging.rs`. Herkunft: W1-14-Review, Befund A3b
(`.pa/report_w1-14.md`, Abschnitt „Nachpruefung").

## Fix

`looks_secret` bekommt eine zusätzliche, von den Präfixen unabhängige Regel:
ein Segment aus **genau** 32 Hex-Ziffern (`is_token_shaped`) gilt als
Token-förmig und wird maskiert. Die Segmentierung existiert bereits (Trennung
an Satzzeichen/Whitespace in `redact_token`/`Redactor`), sodass `token=<hex>`
und `Bearer <hex>` beide mit dem reinen Hex-Teil als Segment ankommen.

Bewusst exakt 32, nicht "mindestens": ein 40-Zeichen-Git-SHA und eine
36-Zeichen-UUID mit Bindestrichen bestehen die Prüfung nicht — die
Bindestriche trennen das Segment dabei nicht auf (sie zählen laut
`is_key_char` zum Segment dazu), sondern die UUID bildet als Ganzes ein
36-Zeichen-Segment, das schon wegen der Länge nicht passt. Offener Kompromiss:
ein MD5-Hash ist ebenfalls genau 32 Hex-Zeichen und wird mitmaskiert — dafür
gibt es aus dem String allein keine billige Unterscheidung, und ein Token, das
durchrutscht, wiegt schwerer als ein Hash, der zu Unrecht maskiert wird.

## Abnahme

Roter Test `redact::tests::a_32_hex_token_is_masked` (kompiliert, läuft zur
Laufzeit rot gegen den unveränderten Code, danach grün), Gegenprobe
`redact::tests::hex_lookalikes_are_not_masked` (Git-SHA, UUID, 31/33-stelliges
Hex bleiben unmaskiert), sowie alle bestehenden Redaction-Tests weiterhin
grün. Siehe `.pa/report_w1-26.md` für die gemessenen Läufe.
