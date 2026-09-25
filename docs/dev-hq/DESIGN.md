# DEV-HQ Live: Werkbank und Instrument

Approved B/C combination, implemented 2026-09-10. The Live workspace is for
ProjectA's operator and agents. Five tabs separate decisions, profile teams,
statistics, evidence and setup. Each panel scrolls independently; navigation and
connection status stay visible. Existing form nodes are preserved between tabs.

The dark ground (#0b1013), raised surfaces (#131b20), visible borders (#35464d)
and mint selection (#82d5b4) distinguish actions and groups. Text uses Segoe UI
with system fallbacks and tabular numbers. Signals use a restrained amber area;
errors retain their explicit status. Numbers do not animate during refresh.

Teams group real executable profiles and store optional purpose, role, effort
and tool descriptions. These are briefing metadata; command, arguments and
environment still determine actual execution. This is not a team scheduler.
The 7/14/30-day selector applies to measured Git commits. Other metrics retain
their own stated source and period; missing live data is not presented as zero.

Tabs support arrows, Home and End, visible focus and linked panel labels.
At 1024px the two-column desktop layout remains usable; below 760px columns
stack. Source pages stay available through the evidence tab.

Evidence: 32 targeted tests including 10 isolated browser tests passed on the
final implementation; screenshots were inspected at 1280 and 1024 pixels.
Two independent reviews and dispositions are recorded in
../../.pa/report_devhq_implementation.md. The earlier visual alternatives in
../design/2026-09-dev-hq/ are historical prototypes, not live fleet data.
