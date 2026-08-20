type SchoolLocation = {
  timezone?: string;
  country?: string;
  state?: string;
};

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: value}).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function countryTimeZone(country: string) {
  const key = country.trim().toLowerCase();
  const zones: Record<string, string> = {
    nigeria: "Africa/Lagos",
    ng: "Africa/Lagos",
    ghana: "Africa/Accra",
    gh: "Africa/Accra",
    "united kingdom": "Europe/London",
    uk: "Europe/London",
  };
  return zones[key] || "";
}

export function resolveSchoolTimeZone(school?: SchoolLocation | null) {
  const configured = String(school?.timezone || "").trim();
  if (configured && validTimeZone(configured)) return configured;
  const countryZone = countryTimeZone(String(school?.country || ""));
  if (countryZone) return countryZone;
  const browserZone = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "";
  return browserZone && validTimeZone(browserZone) ? browserZone : "UTC";
}

export function formatSchoolDateTime(
  value: string | number | Date,
  school?: SchoolLocation | null,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveSchoolTimeZone(school),
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatSchoolDate(
  value: string | number | Date,
  school?: SchoolLocation | null,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveSchoolTimeZone(school),
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
