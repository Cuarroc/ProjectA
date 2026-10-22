// Separate from export-svg.mjs so tests can import it without Chromium or argv.
export function stripComments(s) {
  const parts = [];
  let start = 0;
  // Consume processing instructions and comments before interpreting CDATA.
  for (const match of s.matchAll(/<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!--(?:[\s\S]*?-->)?/g)) {
    if (match[0].startsWith('<!--')) continue;
    parts.push(stripMarkupComments(s.slice(start, match.index)), match[0]);
    start = match.index + match[0].length;
  }
  parts.push(stripMarkupComments(s.slice(start)));
  return parts.join('');
}

// The optional group also removes an unterminated `<!--`; repeating until the
// string is stable catches openers that a removed comment re-assembled
// (`<!<!---->-->`), so none survives (CodeQL js/incomplete-multi-character-sanitization).
function stripMarkupComments(s) {
  let prev;
  do { prev = s; s = s.replace(/<!--(?:[\s\S]*?-->)?/g, ''); } while (s !== prev);
  return s;
}
