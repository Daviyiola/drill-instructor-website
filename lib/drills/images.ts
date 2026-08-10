export type QuestionImageSources = string[] | string | null | undefined;

function oneQuestionImageUrl(source: string, bootcamp = "") {
  const clean = String(source || "")
    .replace(/\\/g, "/")
    .replace(/^qrc:\/assets\/images\//, "")
    .replace(/^(\.\.\/)+assets\/images\//, "")
    .replace(/^assets\/images\//, "")
    .replace(/^\/+/, "");

  if (!clean) return "";
  if (/^(ACT|SAT)\//i.test(clean)) {
    return `/question-images/${clean.replace(/\.[^.]+$/, ".webp")}`;
  }
  const packMatch = clean.match(/^assets\/(.+)$/i);
  const normalizedBootcamp = String(bootcamp || "").trim().toUpperCase();
  if (packMatch && normalizedBootcamp) {
    return `/question-images/${normalizedBootcamp}/${packMatch[1]
      .replace(/\.[^.]+$/, ".webp")}`;
  }
  return "";
}

export function questionImageUrls(source: QuestionImageSources, bootcamp = "") {
  const values = Array.isArray(source)
    ? source
    : String(source || "").split("|");
  return values
    .map((part) => oneQuestionImageUrl(String(part || "").trim(), bootcamp))
    .filter(Boolean);
}

export function questionImageUrl(source: QuestionImageSources, bootcamp = "") {
  return questionImageUrls(source, bootcamp)[0] || "";
}
