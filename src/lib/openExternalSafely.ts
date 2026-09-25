import { describeError, openExternal } from "./ipc";

/**
 * Dieselbe Grenze, die `ipc.ts::openExternal` zieht: nur Web-Adressen dürfen
 * die App verlassen. Hier ein zweites Mal geprüft, weil die Ablehnung dort ein
 * stilles `return` ist — kein Wurf, kein Log. Der Aufrufer erfährt so oder so
 * nichts, und genau das soll aufhören.
 */
const WEB_URL = /^https?:\/\//i;

/** So viel Adresse passt in eine Meldung, ohne sie zu sprengen. */
const URL_MAX_CHARS = 60;

function shortUrl(url: string): string {
  if (url === "") return "(leer)";
  if (url.length <= URL_MAX_CHARS) return url;
  return `${url.slice(0, URL_MAX_CHARS)}…`;
}

/**
 * Öffnet eine URL im Browser und meldet jede Ablehnung, statt sie verpuffen zu
 * lassen.
 *
 * Ablehnungen gibt es in zwei Formen, und bis F1 verschwand jede davon
 * lautlos: das Schema passt nicht (`openExternal` kehrt still zurück), oder
 * der Opener und das Webview weigern sich beide (`openExternal` wirft, und
 * niemand fing). Für den Menschen ist beides dasselbe Ereignis — der Klick hat
 * nichts getan —, also bekommt er beides in derselben Form: Ursache, dann
 * nächster Schritt, wie bei jedem Attention-Eintrag.
 *
 * `reportError` ist der Fehlerkanal der aufrufenden Ansicht. Bewusst kein
 * eigener: eine vierte Fehleranzeige neben den drei vorhandenen wäre genau die
 * zweite UI-Logik, die dieses Paket abschafft.
 */
export async function openExternalSafely(
  url: string,
  reportError: (message: string) => void,
): Promise<void> {
  const target = url.trim();
  if (!WEB_URL.test(target)) {
    reportError(
      `„${shortUrl(target)}" wurde nicht geöffnet — nur http(s)-Adressen dürfen die App verlassen.`,
    );
    return;
  }
  try {
    await openExternal(target);
  } catch (cause) {
    // Der technische Wortlaut geht in die Konsole (und damit ins Diagnosepaket),
    // nicht in die Oberfläche: er ist englisch und nennt Opener-Interna, die
    // niemandem sagen, was jetzt zu tun ist.
    console.warn("openExternalSafely: konnte nicht geöffnet werden", target, describeError(cause));
    reportError(
      `„${shortUrl(target)}" ließ sich nicht öffnen — kopiere die Adresse und öffne sie von Hand im Browser.`,
    );
  }
}
