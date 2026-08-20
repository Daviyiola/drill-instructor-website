export function minimumFutureLocalDateTime(now = new Date()) {
  const nextMinute = new Date(now.getTime() + 60_000);
  nextMinute.setSeconds(0, 0);
  const local = new Date(nextMinute.getTime() - nextMinute.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isFutureLocalDateTime(value: string, now = Date.now()) {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > now;
}
