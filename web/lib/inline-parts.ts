// The contract's inline Markdown read as parts. Its own module because pages that render one wire sentence
// (Activity's liquidation note) must not pull the generated contract that api-view reads.

/** A run of a contract paragraph: plain text, bold, or code — the contract's words, its markers taken away. */
export type InlinePart = { readonly kind: "text" | "strong" | "code"; readonly text: string };

const STRONG = "**";
const TICK = "`";

/** Where a bold marker opened before `from` closes: the first bold marker outside a code span, read as the scanner reads one; -1 when none does. */
function strongClose(paragraph: string, from: number): number {
  let at = from;
  while (at < paragraph.length) {
    if (paragraph.startsWith(TICK, at)) {
      const tickClose = paragraph.indexOf(TICK, at + 1);
      at = tickClose > at + 1 ? tickClose + 1 : at + 1;
      continue;
    }
    if (paragraph.startsWith(STRONG, at)) return at;
    at += 1;
  }
  return -1;
}

/**
 * The contract's two inline markers read as formatting, its words untouched.
 * The contract's prose is CommonMark and uses exactly two inline markers:
 * `**…**` for bold and a backtick pair for code. Read left to right, a marker
 * opens a part only when its partner closes it around at least one character;
 * a code span binds first, so a star inside one is literal — before a bold
 * marker and inside one alike: a bold part closes at the first bold marker
 * outside its own code spans. A bold part keeps
 * its inner text raw — its own backtick pairs are read by reading it again —
 * and a marker with no partner is the contract's character, printed as it
 * came. Every part carries text; the parts' texts, markers removed, are the
 * paragraph's own, in order.
 */
export function inlineParts(paragraph: string): readonly InlinePart[] {
  const parts: InlinePart[] = [];
  let text = "";
  const flush = (): void => {
    if (text !== "") parts.push({ kind: "text", text });
    text = "";
  };
  let at = 0;
  while (at < paragraph.length) {
    const marker = paragraph.startsWith(TICK, at) ? TICK : paragraph.startsWith(STRONG, at) ? STRONG : null;
    if (marker === null) {
      text += paragraph.charAt(at);
      at += 1;
      continue;
    }
    const close = marker === TICK ? paragraph.indexOf(TICK, at + 1) : strongClose(paragraph, at + STRONG.length);
    if (close > at + marker.length) {
      flush();
      parts.push({ kind: marker === TICK ? "code" : "strong", text: paragraph.slice(at + marker.length, close) });
      at = close + marker.length;
    } else {
      text += marker;
      at += marker.length;
    }
  }
  flush();
  return parts;
}
