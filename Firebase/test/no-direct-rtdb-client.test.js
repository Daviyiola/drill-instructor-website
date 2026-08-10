"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_ROOTS = ["app", "components", "lib", "Drill_Instructor/qml"];
const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".qml"]);
const IGNORED = [
  `${path.sep}Drill_Instructor${path.sep}qml${path.sep}Firebase${path.sep}`,
];
const FORBIDDEN = [
  /firebase\/database/,
  /firebaseRDatabase/,
  /authorizedFirebaseGet/,
  /uploadMetrics\s*\(/,
  /\.firebaseio\.com/i,
  /-default-rtdb\.firebaseio\.com/i,
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const fullPath = path.join(directory, entry.name);
    if (IGNORED.some((fragment) => fullPath.includes(fragment))) continue;
    if (entry.isDirectory()) walk(fullPath, files);
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

test("web and active native screens do not access RTDB directly", () => {
  const violations = [];
  for (const sourceRoot of SOURCE_ROOTS) {
    for (const file of walk(path.join(ROOT, sourceRoot))) {
      const source = fs.readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(ROOT, file)} matched ${pattern}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});
