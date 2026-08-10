const bootcampFullNames: Record<string, string> = {
  act: "American College Testing",
  sat: "Scholastic Assessment Test",
  utme: "Unified Tertiary Matriculation Examination",
  waec: "West African Examinations Council",
};

export function bootcampFullName(bootcamp: string) {
  const id = String(bootcamp || "").toLowerCase();
  return bootcampFullNames[id] || `${id.toUpperCase()} preparation`;
}
