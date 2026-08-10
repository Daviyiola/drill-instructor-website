export interface DrillStreaks {
  current: number;
  best: number;
}

function localDayIndex(value: string | number | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ) / (24 * 60 * 60 * 1000));
}

export function calculateDrillStreaks(
  values: Array<string | number | Date>,
  now: Date = new Date(),
): DrillStreaks {
  const dates = Array.from(
    new Set(
      values
        .map(localDayIndex)
        .filter((value): value is number => value !== null),
    ),
  ).sort((a, b) => a - b);

  if (!dates.length) return {current: 0, best: 0};

  let best = 1;
  let run = 1;
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index] - dates[index - 1] === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  const today = localDayIndex(now) ?? 0;
  const latest = dates.at(-1) ?? 0;
  if (today - latest > 1) return {current: 0, best};

  let current = 1;
  for (let index = dates.length - 1; index > 0; index -= 1) {
    if (dates[index] - dates[index - 1] !== 1) break;
    current += 1;
  }

  return {current, best};
}
