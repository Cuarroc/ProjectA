import type { UiThemeStyle } from "../lib/settings";

/**
 * Decorative layer behind the app shell. Classic style keeps the current look
 * (renders nothing). Other styles mount an empty placeholder until a later
 * package fills in canvas/CSS effects — no WebGL context here.
 */
export default function ThemeBackdrop({ style }: { style: UiThemeStyle }) {
  if (style === "klassisch") return null;
  return <div className="theme-backdrop" data-style={style} aria-hidden="true" />;
}
