@echo off
rem omniroute-serve.cmd — OmniRoute-Daemon mit ProjectA-Betriebsparametern.
rem
rem Die geplante Aufgabe "OmniRoute" ruft ab 2026-08-30 dieses Script statt
rem "omniroute.cmd serve" direkt. Grund: OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT
rem ist ein reines Prozess-Env (Default 1!). Der Wert schuetzt den Node-Heap
rem (schwere Chat-Bodies amplifizieren beim Parsen/Komprimieren), nicht das
rem Upstream-Kontingent. Gemessen am 30.08. mit 3 parallelen Workern:
rem 736x HTTP 200, 3x 429 (0,4 %), kein Circuit Breaker offen — Heap 4 GB,
rem also massig Luft nach oben. 8 ist der belegte, nicht der geratene Wert.
rem
rem Regel fuer Erhoehungen: erst /api/usage/quota + Circuit-Breaker-Statius
rem unter Last ansehen, dann hoch. Nicht andersherum.

set "OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT=8"
rem Loopback-Bindung (Befund 31.08.): ohne HOSTNAME bindet der Daemon auf
rem 0.0.0.0 und ist im LAN erreichbar. Der Reverse-Tunnel forwarded auf
rem 127.0.0.1:20128 und funktioniert damit weiter.
set "HOSTNAME=127.0.0.1"
"%APPDATA%\npm\omniroute.cmd" serve --daemon --no-open
