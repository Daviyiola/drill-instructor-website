"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const targets = [
  path.resolve(root, "../../../functions/data/actData.js"),
  path.join(root, "import-into-act-data.js"),
];

function collectFragments(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFragments(fullPath);
    else if (entry.name.endsWith(".jsfrag")) targets.push(fullPath);
  }
}

collectFragments(path.join(root, "staging"));
collectFragments(path.join(root, "work"));

let filesChanged = 0;
let labelsChanged = 0;
for (const file of targets) {
  const before = fs.readFileSync(file, "utf8");
  const matches = before.match(/Additional reasoning step:/g) || [];
  if (!matches.length) continue;
  const after = before.replace(/Additional reasoning step:/g, "Step 3:");
  fs.writeFileSync(file, after, "utf8");
  filesChanged += 1;
  labelsChanged += matches.length;
}

console.log(`Renamed ${labelsChanged} explanation labels across ${filesChanged} files.`);
