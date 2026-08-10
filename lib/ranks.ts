export interface RankDefinition {
  name: string;
  number: number;
  minimum: number;
  nextMinimum?: number;
  description: string;
}

export const ranks: RankDefinition[] = [
  {
    name: "Recruit",
    number: 1,
    minimum: 0,
    nextMinimum: 100,
    description:
      "Training has begun. Build discipline, learn the test structure, and master the foundations.",
  },
  {
    name: "Corporal",
    number: 2,
    minimum: 100,
    nextMinimum: 250,
    description:
      "Consistency is forming. Foundational concepts are becoming more accurate and controlled.",
  },
  {
    name: "Sergeant",
    number: 3,
    minimum: 250,
    nextMinimum: 450,
    description:
      "Performance is becoming reliable under time pressure with fewer tactical errors.",
  },
  {
    name: "Warrant Officer",
    number: 4,
    minimum: 450,
    nextMinimum: 800,
    description:
      "Technical skill is evident across more advanced questions and unfamiliar situations.",
  },
  {
    name: "Lieutenant",
    number: 5,
    minimum: 800,
    nextMinimum: 1300,
    description:
      "Strategic awareness is strong. Time and test plans are managed with confidence.",
  },
  {
    name: "Captain",
    number: 6,
    minimum: 1300,
    nextMinimum: 1950,
    description:
      "Battle readiness is clear across longer drills and demanding testing conditions.",
  },
  {
    name: "Major",
    number: 7,
    minimum: 1950,
    nextMinimum: 3000,
    description:
      "Preparation is deliberate. Weaknesses are identified early and tactics adjust quickly.",
  },
  {
    name: "Colonel",
    number: 8,
    minimum: 3000,
    nextMinimum: 4500,
    description:
      "High readiness achieved across varied question types and testing conditions.",
  },
  {
    name: "Major General",
    number: 9,
    minimum: 4500,
    nextMinimum: 7000,
    description:
      "Elite preparation is confirmed with near-exam speed, accuracy, and control.",
  },
  {
    name: "General",
    number: 10,
    minimum: 7000,
    description:
      "Fully battle ready. Mastery, composure, and peak execution are the standard.",
  },
];

export function rankForPoints(points: number) {
  const safe = Math.max(0, Number(points || 0));
  return (
    [...ranks].reverse().find((rank) => safe >= rank.minimum) || ranks[0]
  );
}

export function rankForUnitScore(score: number) {
  const safe = Math.min(100, Math.max(0, Number(score || 0)));
  const number = Math.min(10, Math.max(1, Math.ceil(safe / 10) || 1));
  return ranks[number - 1];
}

export function rankImage(number: number) {
  return `/app-assets/ranks/Rank${Math.min(10, Math.max(1, number))}.png`;
}
