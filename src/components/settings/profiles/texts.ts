// Profile roster copy; state and error messages remain owned by SettingsView.
export const T = {
  title: "Profile",
  hint: "Ein deaktiviertes Profil bleibt gespeichert, wird aber keinem neuen Agenten mehr zugeteilt.",
  budgetHint:
    "Budget: ab welchem Prozentsatz des 5-Stunden- bzw. 7-Tage-Fensters " +
    "dieses Profil pausiert wird. Erreicht ein Fenster seine Schwelle, " +
    "überspringt der Dispatcher das Profil und laufende Agenten werden " +
    "gestoppt — die Worktrees bleiben liegen, ein Respawn holt sie " +
    "zurück. Leeres Feld heißt „keine Schwelle“.",
  empty: "Keine Profile vorhanden.",
  active: (name: string) => `Profil ${name} aktiv`,
};
