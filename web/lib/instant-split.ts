/**
 * A sentence cut at its ISO UTC instants, so a renderer can keep each instant whole on one line.
 *
 * Pure text in, pure text out: the parts concatenate back to the input exactly, so what a reader copies and what a
 * pin compares is the sentence the lib wrote — only the break opportunity inside an instant is the renderer's to
 * remove. An instant is the wire's own form, `YYYY-MM-DDTHH:MM[:SS]Z`; nothing else is marked.
 */

const INSTANT = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z)/;

export interface InstantPart {
  readonly text: string;
  /** True when `text` is one whole UTC instant; false for the prose around it. */
  readonly instant: boolean;
}

/** No empty part is returned; a text with no instant is one prose part, and the empty string is no parts. */
export function splitInstants(text: string): InstantPart[] {
  // A split on one capturing group alternates prose (even index) with the captured instant (odd index).
  return text
    .split(INSTANT)
    .map((part, index): InstantPart => ({ text: part, instant: index % 2 === 1 }))
    .filter((part) => part.text !== "");
}
