// Decode HTML character references so feed/API text reads as plain Unicode.
//
// Titles arrive with entities that must be turned back into real characters,
// e.g. "Nvidia doesn&#8217;t mess around" → "Nvidia doesn't mess around".
// We handle numeric references (decimal &#8217; and hex &#x2019;) plus the
// handful of named entities that show up in headlines. `&amp;` is decoded
// LAST so a value like "&amp;lt;" doesn't get double-decoded into "<".

function fromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

const NAMED: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => fromCodePoint(parseInt(n, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:lt|gt|quot|apos|nbsp);/g, (m) => NAMED[m])
    .replace(/&amp;/g, "&")
    .trim();
}
