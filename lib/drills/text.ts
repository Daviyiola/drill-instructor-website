const entities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeEntities(value: string) {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return entities[entity.toLowerCase()] ?? match;
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function questionText(value: string) {
  const text = String(value || "")
    .replace(/<?br\s*\/?>|>br>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Converts portable question-bank markup into safe display HTML.
 * Only formatting shared by the web and native datasets is retained.
 */
export function questionRichHtml(value: string) {
  const source = String(value || "").replace(/<?br\s*\/?>|>br>/gi, "<br>");
  const allowedTag = /<br>|<\/?(?:b|strong|i|em|u)>/gi;
  const parts: string[] = [];
  let cursor = 0;

  for (const match of source.matchAll(allowedTag)) {
    const index = match.index ?? 0;
    const plain = source
      .slice(cursor, index)
      .replace(/<\/?[a-z][^>]*>/gi, "");
    parts.push(escapeHtml(decodeEntities(plain)));

    const tag = match[0].toLowerCase();
    if (tag === "<br>") parts.push("<br>");
    else if (tag === "<b>" || tag === "<strong>") parts.push("<strong>");
    else if (tag === "</b>" || tag === "</strong>") parts.push("</strong>");
    else if (tag === "<i>" || tag === "<em>") parts.push("<em>");
    else if (tag === "</i>" || tag === "</em>") parts.push("</em>");
    else if (tag === "<u>") parts.push("<u>");
    else if (tag === "</u>") parts.push("</u>");
    cursor = index + match[0].length;
  }

  const tail = source.slice(cursor).replace(/<\/?[a-z][^>]*>/gi, "");
  parts.push(escapeHtml(decodeEntities(tail)));
  return parts.join("");
}
