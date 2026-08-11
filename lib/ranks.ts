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
      "Training has begun. Every answered question starts building a record of practice, discipline, and persistence.",
  },
  {
    name: "Corporal",
    number: 2,
    minimum: 100,
    nextMinimum: 250,
    description:
      "Consistency is forming. Practice is becoming a habit and meaningful momentum is beginning to build.",
  },
  {
    name: "Sergeant",
    number: 3,
    minimum: 250,
    nextMinimum: 450,
    description:
      "The training record is growing through continued answering, reviewing, and returning to difficult areas.",
  },
  {
    name: "Warrant Officer",
    number: 4,
    minimum: 450,
    nextMinimum: 800,
    description:
      "A meaningful body of practice has been completed across a broader range of questions.",
  },
  {
    name: "Lieutenant",
    number: 5,
    minimum: 800,
    nextMinimum: 1300,
    description:
      "Sustained effort has earned this promotion through continued, purposeful training.",
  },
  {
    name: "Captain",
    number: 6,
    minimum: 1300,
    nextMinimum: 1950,
    description:
      "A steady practice habit has taken shape with substantial training experience accumulated.",
  },
  {
    name: "Major",
    number: 7,
    minimum: 1950,
    nextMinimum: 3000,
    description:
      "Practice is deliberate and sustained, reflecting serious commitment to continued preparation.",
  },
  {
    name: "Colonel",
    number: 8,
    minimum: 3000,
    nextMinimum: 4500,
    description:
      "Extensive training has been completed through a long record of disciplined practice.",
  },
  {
    name: "Major General",
    number: 9,
    minimum: 4500,
    nextMinimum: 7000,
    description:
      "Exceptional consistency has been demonstrated while approaching the highest practice rank.",
  },
  {
    name: "General",
    number: 10,
    minimum: 7000,
    description:
      "The highest practice rank, representing sustained commitment and an exceptional training record.",
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

export function unitRankImage(number: number) {
  const tier = Math.min(10, Math.max(1, Number(number) || 1));
  const imageNumber = tier === 10 ? 10 : tier + 10;
  return `/app-assets/ranks/Rank${imageNumber}.png`;
}
