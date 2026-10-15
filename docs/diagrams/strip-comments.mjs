// Separate from export-svg.mjs so tests can import it without Chromium or argv.
// The optional group also removes an unterminated `<!--`; repeating until the
// string is stable catches openers that a removed comment re-assembled
// (`<!<!---->-->`), so none survives (CodeQL js/incomplete-multi-character-sanitization).
export function stripComments(s) {
  let prev;
  do { prev = s; s = s.replace(/<!--(?:[\s\S]*?-->)?/g, ''); } while (s !== prev);
  return s;
}
