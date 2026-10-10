/** German UI copy for Glass UI v2. English locale is parked; keep Messages. */

export const de = {
  "nav.leitstand": "Leitstand",
  "nav.eingangPlan": "Eingang & Plan",
  "nav.beweise": "Beweise",
  "nav.team": "Team",
  "nav.automatik": "Automatik",
  "nav.core": "Core",
  "nav.steuerung": "Core · Steuerung",
  "nav.gedaechtnis": "Gedächtnis",
  "nav.einstellungen": "Einstellungen",
  "nav.aria": "Hauptnavigation",
  "shell.brand": "ProjectA",
  "shell.search": "Suchen oder Befehl eingeben",
  "shell.searchPlaceholder": "Agenten, PRs, Ideen, Befehle",
  "shell.estop": "Not-Aus",
  "shell.estopHint": "stoppt alles in 10 s",
  "shell.resume": "Fortsetzen",
  "shell.projectSwitch": "Projekt wechseln",
  "state.all": "Alle",
  "state.run": "Läuft",
  "state.need": "Braucht dich",
  "state.rev": "In Prüfung",
  "state.ok": "Bereit zum Mergen",
  "state.done": "Erledigt",
  "state.bad": "Fehler",
  "theme.light": "Hell",
  "theme.dark": "Dunkel",
  "theme.system": "System",
} as const;

export type MessageKey = keyof typeof de;
export type Messages = { readonly [K in MessageKey]: string };

/** Only `de` ships; `en` stays undefined until the parked locale lands. */
export const catalogs: { de: Messages; en?: Messages } = { de };
