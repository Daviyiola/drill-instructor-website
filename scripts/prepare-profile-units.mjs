import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(
  root,
  "Drill_Instructor",
  "assets",
  "scripts",
  "countries.js",
);
const destination = path.join(
  root,
  "public",
  "app-data",
  "countries-states.json",
);

const source = await fs.readFile(sourceFile, "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context, {filename: sourceFile, timeout: 2_000});
const countries = vm.runInContext("countriesList", context, {timeout: 2_000});

const windows1252Bytes = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function repairText(value) {
  const text = String(value || "").trim();
  if (!/[ÃÂâÄÅÌ]/.test(text)) return text;
  const bytes = [];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (windows1252Bytes.has(code)) bytes.push(windows1252Bytes.get(code));
    else return text;
  }
  const repaired = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
  return repaired.includes("\uFFFD") ? text : repaired;
}

const compact = countries
  .map((country) => ({
    name: repairText(country.name),
    states: Array.isArray(country.states)
      ? country.states
          .map((state) => repairText(state.name))
          .filter(Boolean)
      : [],
  }))
  .filter((country) => country.name);

await fs.mkdir(path.dirname(destination), {recursive: true});
await fs.writeFile(destination, `${JSON.stringify(compact)}\n`, "utf8");
console.log(`Prepared ${compact.length} countries for the web profile selector.`);
