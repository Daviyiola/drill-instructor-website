import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const ROOT = "C:/Users/david/dev/drill-instructor-website";
const SHOTS = path.join(ROOT, "deck-assets", "screenshots");
const OUT = path.join(ROOT, ".tmp", "school-sales-deck", "rendered");
const FINAL = path.join(ROOT, "Drill_Instructor_School_Sales_Deck.pptx");

const C = {
  green: "#4B5320",
  green2: "#65702B",
  olive: "#DDE3C4",
  pale: "#EEF1E4",
  mist: "#F6F8FB",
  gold: "#E8B44B",
  goldPale: "#FAE9BD",
  peach: "#F8E2D1",
  ink: "#101828",
  slate: "#475467",
  faint: "#E4E7EC",
  white: "#FFFFFF",
  red: "#D95D5D",
};

async function readImage(file) {
  const bytes = await fs.readFile(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function rect(slide, position, fill, opts = {}) {
  return slide.shapes.add({
    geometry: opts.geometry || "rect",
    name: opts.name,
    position,
    fill,
    line: opts.line || { style: "solid", fill: opts.lineFill || "none", width: opts.lineWidth || 0 },
    borderRadius: opts.radius,
    shadow: opts.shadow,
  });
}

function text(slide, value, position, fontSize, color = C.ink, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    fontFamily: opts.fontFamily || "Aptos",
    fontSize,
    color,
    bold: opts.bold || false,
    italic: opts.italic || false,
    alignment: opts.align || "left",
    breakLine: false,
  };
  return shape;
}

async function image(slide, fileName, position, opts = {}) {
  return slide.images.add({
    blob: await readImage(path.join(SHOTS, fileName)),
    contentType: "image/png",
    alt: opts.alt || fileName,
    fit: opts.fit || "contain",
    position,
    geometry: opts.geometry || "roundRect",
    borderRadius: opts.radius || "rounded-xl",
    shadow: opts.shadow,
  });
}

async function logo(slide, position) {
  return slide.images.add({
    blob: await readImage(path.join(ROOT, "public", "DI_logo.png")),
    contentType: "image/png",
    alt: "Drill Instructor logo",
    fit: "contain",
    position,
  });
}

function eyebrow(slide, value, x, y, color = C.green) {
  text(slide, value.toUpperCase(), { left: x, top: y, width: 420, height: 24 }, 14, color, { bold: true });
}

function title(slide, value, y = 54, color = C.ink, width = 1136) {
  text(slide, value, { left: 72, top: y, width, height: 70 }, 42, color, { bold: true });
}

function footer(slide, n, dark = false) {
  const color = dark ? "#D7DCC0" : "#667085";
  text(slide, "DRILL INSTRUCTOR  •  SCHOOL PARTNERSHIP", { left: 72, top: 682, width: 450, height: 18 }, 11, color, { bold: true });
  text(slide, String(n).padStart(2, "0"), { left: 1170, top: 680, width: 38, height: 18 }, 11, color, { align: "right", bold: true });
}

function notes(slide, lines) {
  slide.speakerNotes.textFrame.setText(`[Sources]\n${lines.map((line) => `- ${line}`).join("\n")}`);
}

function bullet(slide, headline, body, x, y, color = C.ink, number = null) {
  if (number !== null) {
    text(slide, String(number).padStart(2, "0"), { left: x, top: y - 2, width: 42, height: 28 }, 16, C.gold, { bold: true });
    x += 50;
  }
  text(slide, headline, { left: x, top: y, width: 420, height: 34 }, 24, color, { bold: true });
  text(slide, body, { left: x, top: y + 38, width: 430, height: 62 }, 17, color === C.white ? "#E8EBD8" : C.slate);
}

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

// 1 — Title
{
  const s = deck.slides.add();
  s.background.fill = C.green;
  rect(s, { left: 0, top: 0, width: 1280, height: 720 }, C.green);
  rect(s, { left: 742, top: 0, width: 538, height: 720 }, C.gold);
  rect(s, { left: 770, top: 42, width: 510, height: 638 }, C.white, { radius: "rounded-3xl", shadow: "shadow-lg" });
  await image(s, "public-home-hero.png", { left: 790, top: 62, width: 490, height: 598 }, { fit: "cover", alt: "Drill Instructor product and analytics preview" });
  await logo(s, { left: 72, top: 56, width: 62, height: 62 });
  text(s, "DRILL INSTRUCTOR", { left: 150, top: 69, width: 390, height: 32 }, 21, C.white, { bold: true });
  text(s, "Practice. Review.\nImprove.", { left: 72, top: 172, width: 590, height: 126 }, 54, C.white, { bold: true });
  text(s, "Practice smarter for the tests that matter.", { left: 72, top: 322, width: 565, height: 76 }, 27, "#E9ECD8", { bold: true });
  text(s, "A structured exam-preparation platform for students, educators, and schools.", { left: 72, top: 422, width: 540, height: 74 }, 20, "#D7DCC0" );
  rect(s, { left: 72, top: 550, width: 184, height: 5 }, C.gold);
  text(s, "SCHOOL PARTNERSHIP", { left: 72, top: 574, width: 340, height: 25 }, 15, C.gold, { bold: true });
  text(s, "2026", { left: 72, top: 610, width: 120, height: 22 }, 13, "#D7DCC0" );
  notes(s, ["First-party product screenshot: public-home-hero.png."]);
}

// 2 — Problem
{
  const s = deck.slides.add();
  s.background.fill = C.mist;
  eyebrow(s, "The preparation gap", 72, 52);
  title(s, "Practice generates answers. Schools need insight.", 82);
  text(s, "The work is happening—but the signal is often lost.", { left: 72, top: 152, width: 720, height: 38 }, 22, C.slate);
  rect(s, { left: 72, top: 226, width: 536, height: 328 }, C.white, { radius: "rounded-3xl", shadow: "shadow-md" });
  rect(s, { left: 642, top: 226, width: 566, height: 328 }, C.green, { radius: "rounded-3xl", shadow: "shadow-md" });
  text(s, "01", { left: 104, top: 254, width: 70, height: 58 }, 46, C.gold, { bold: true });
  text(s, "Students practice blindly", { left: 104, top: 330, width: 430, height: 44 }, 30, C.ink, { bold: true });
  text(s, "They answer questions without a clear view of which topics to revisit, where pacing breaks down, or why the same mistakes repeat.", { left: 104, top: 389, width: 438, height: 116 }, 19, C.slate);
  text(s, "02", { left: 676, top: 254, width: 70, height: 58 }, 46, C.gold, { bold: true });
  text(s, "Educators see too little", { left: 676, top: 330, width: 450, height: 44 }, 30, C.white, { bold: true });
  text(s, "Assignments create more grading, yet still may not reveal who is stuck, which concept needs reteaching, or how students used their time.", { left: 676, top: 389, width: 452, height: 116 }, 19, "#E7EAD9" );
  text(s, "The opportunity: turn every practice session into useful next steps.", { left: 228, top: 590, width: 824, height: 40 }, 24, C.green, { bold: true, align: "center" });
  footer(s, 2);
  notes(s, ["Problem framing supplied by the product founder; no external statistics used."]);
}

// 3 — Product idea
{
  const s = deck.slides.add();
  s.background.fill = C.green;
  eyebrow(s, "The platform", 72, 52, C.gold);
  title(s, "Preparation works best as a disciplined training loop.", 82, C.white);
  text(s, "Exam preparation is serious work. Drill Instructor makes the repetition purposeful, visible, and easier to sustain.", { left: 72, top: 154, width: 1000, height: 58 }, 20, "#DCE1C6" );
  const labels = [
    ["PRACTICE", "Focused, timed drills"],
    ["REVIEW", "Corrections and explanations"],
    ["IMPROVE", "Analytics guide the next session"],
  ];
  labels.forEach(([head, sub], i) => {
    const x = 72 + i * 370;
    text(s, head, { left: x, top: 278, width: 300, height: 62 }, 40, i === 1 ? C.gold : C.white, { bold: true, align: "center" });
    text(s, sub, { left: x, top: 350, width: 300, height: 42 }, 18, "#DCE1C6", { align: "center" });
    if (i < 2) text(s, "→", { left: x + 318, top: 292, width: 52, height: 48 }, 34, C.gold, { bold: true, align: "center" });
  });
  rect(s, { left: 72, top: 462, width: 1136, height: 118 }, "#5B6429", { radius: "rounded-2xl" });
  text(s, "Why “Drill Instructor”?", { left: 102, top: 490, width: 320, height: 38 }, 25, C.white, { bold: true });
  text(s, "The military is an enduring symbol of discipline. Students may not love every repetition—but structured repetition builds readiness.", { left: 424, top: 484, width: 726, height: 70 }, 20, "#F1F3E8" );
  footer(s, 3, true);
  notes(s, ["Product positioning and naming rationale supplied by the founder."]);
}

// 4 — Student experience
{
  const s = deck.slides.add();
  s.background.fill = C.mist;
  eyebrow(s, "Student experience", 72, 44);
  title(s, "Students can build the right practice—and learn from every miss.", 74);
  rect(s, { left: 60, top: 160, width: 570, height: 410 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "student-drill-builder.png", { left: 76, top: 176, width: 538, height: 378 }, { fit: "contain", alt: "Student drill builder" });
  rect(s, { left: 650, top: 160, width: 570, height: 410 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "student-review-full.png", { left: 666, top: 176, width: 538, height: 378 }, { fit: "contain", alt: "Student correction review with explanation" });
  text(s, "BUILD TARGETED DRILLS", { left: 90, top: 590, width: 400, height: 28 }, 16, C.green, { bold: true });
  text(s, "Subjects, modules, practice tests, and subject-specific timers.", { left: 90, top: 620, width: 480, height: 42 }, 17, C.slate);
  text(s, "REVIEW WITH CONTEXT", { left: 680, top: 590, width: 400, height: 28 }, 16, C.green, { bold: true });
  text(s, "Correct answer, explanation, reference material, and bookmarks.", { left: 680, top: 620, width: 480, height: 42 }, 17, C.slate);
  footer(s, 4);
  notes(s, ["First-party screenshots: student-drill-builder.png and student-review-full.png."]);
}

// 5 — Motivation
{
  const s = deck.slides.add();
  s.background.fill = C.white;
  eyebrow(s, "Social motivation", 72, 44);
  title(s, "Progress becomes visible—and practice becomes social.", 74);
  text(s, "Every graded answer earns points.", { left: 72, top: 160, width: 420, height: 36 }, 25, C.green, { bold: true });
  text(s, "3", { left: 72, top: 220, width: 90, height: 70 }, 58, C.green, { bold: true });
  text(s, "points for a correct answer", { left: 152, top: 238, width: 300, height: 34 }, 20, C.ink);
  text(s, "1", { left: 72, top: 300, width: 90, height: 70 }, 58, C.gold, { bold: true });
  text(s, "point for an incorrect attempt—because trying still counts", { left: 152, top: 302, width: 335, height: 74 }, 20, C.ink);
  text(s, "Students rise from Recruit to General, build squads with friends, and compare progress across squad, battalion, and corps.", { left: 72, top: 414, width: 420, height: 128 }, 19, C.slate);
  rect(s, { left: 518, top: 144, width: 690, height: 230 }, C.mist, { radius: "rounded-2xl", shadow: "shadow-sm" });
  await image(s, "student-ranks.png", { left: 532, top: 158, width: 662, height: 202 }, { fit: "cover", alt: "Rank progression" });
  rect(s, { left: 518, top: 394, width: 690, height: 230 }, C.mist, { radius: "rounded-2xl", shadow: "shadow-sm" });
  await image(s, "student-leaderboards.png", { left: 532, top: 408, width: 662, height: 202 }, { fit: "cover", alt: "Squad leaderboard" });
  footer(s, 5);
  notes(s, ["First-party screenshots: student-ranks.png and student-leaderboards.png.", "Point system is implemented product behavior supplied by the founder."]);
}

// 6 — Educator workflow
{
  const s = deck.slides.add();
  s.background.fill = C.mist;
  eyebrow(s, "Educator experience", 72, 42);
  title(s, "Assign focused practice without inheriting continuous grading.", 72);
  rect(s, { left: 60, top: 154, width: 728, height: 478 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "educator-question-browser.png", { left: 76, top: 170, width: 696, height: 446 }, { fit: "contain", alt: "Educator question browser" });
  text(s, "Browse the question bank", { left: 824, top: 174, width: 350, height: 42 }, 26, C.green, { bold: true });
  text(s, "Filter by subject, module, and practice test. Inspect questions and explanations before assigning.", { left: 824, top: 226, width: 350, height: 96 }, 18, C.slate);
  text(s, "Set the assignment rules", { left: 824, top: 354, width: 350, height: 42 }, 26, C.green, { bold: true });
  text(s, "Choose recipients, due date, score release, correction release, and question-order shuffling.", { left: 824, top: 406, width: 350, height: 96 }, 18, C.slate);
  text(s, "Review—without re-grading", { left: 824, top: 534, width: 350, height: 42 }, 26, C.green, { bold: true });
  text(s, "Submission summaries and corrections are generated from the same server-owned results.", { left: 824, top: 578, width: 350, height: 68 }, 18, C.slate);
  footer(s, 6);
  notes(s, ["First-party screenshot: educator-question-browser.png."]);
}

// 7 — Analytics depth
{
  const s = deck.slides.add();
  s.background.fill = C.white;
  eyebrow(s, "Actionable visibility", 72, 42);
  title(s, "Zoom from group trends to one answer choice.", 72);
  rect(s, { left: 54, top: 150, width: 760, height: 500 }, C.mist, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "educator-group-analytics.png", { left: 68, top: 164, width: 732, height: 472 }, { fit: "cover", alt: "Group analytics and comprehension thresholds" });
  rect(s, { left: 784, top: 248, width: 444, height: 336 }, C.white, { radius: "rounded-2xl", shadow: "shadow-lg", lineFill: C.gold, lineWidth: 2 });
  await image(s, "educator-question-performance.png", { left: 796, top: 260, width: 420, height: 312 }, { fit: "cover", alt: "Per-answer-choice performance" });
  text(s, "WHOLE GROUP", { left: 842, top: 164, width: 300, height: 24 }, 14, C.green, { bold: true });
  text(s, "→ subject → module → question → answer choice", { left: 842, top: 194, width: 350, height: 42 }, 18, C.slate, { bold: true });
  text(s, "Know who needs support—and the concept that needs reteaching.", { left: 800, top: 606, width: 410, height: 42 }, 19, C.green, { bold: true, align: "center" });
  footer(s, 7);
  notes(s, ["First-party screenshots: educator-group-analytics.png and educator-question-performance.png."]);
}

// 8 — Privacy and governance
{
  const s = deck.slides.add();
  s.background.fill = C.green;
  eyebrow(s, "School trust", 72, 42, C.gold);
  title(s, "Privacy is a foundation—not an afterthought.", 72, C.white);
  await image(s, "educator-admin-summary.png", { left: 612, top: 146, width: 596, height: 138 }, { fit: "cover", alt: "School administration summary" });
  bullet(s, "Private by choice", "Students can keep their profile out of public leaderboards.", 72, 188, C.white, 1);
  bullet(s, "Scoped educator access", "Limit access by exam, subject, student, or group.", 72, 318, C.white, 2);
  bullet(s, "Approval before access", "Educators require school authorization; approval can be withdrawn.", 72, 448, C.white, 3);
  text(s, "School controls", { left: 662, top: 338, width: 380, height: 38 }, 28, C.gold, { bold: true });
  text(s, "• School-wide educator codes\n• Admin approval and audit history\n• Flexible permission boundaries\n• Aggregate solo-practice visibility\n• No sale of analytics data", { left: 662, top: 390, width: 470, height: 176 }, 19, "#F1F3E8" );
  rect(s, { left: 612, top: 596, width: 596, height: 4 }, C.gold);
  text(s, "Challenge participants see summary performance—not another student’s per-question answers.", { left: 612, top: 614, width: 596, height: 44 }, 16, "#DCE1C6" );
  footer(s, 8, true);
  notes(s, ["First-party screenshot: educator-admin-summary.png.", "Privacy and permission statements are based on the implemented product requirements supplied by the founder."]);
}

// 9 — Parents
{
  const s = deck.slides.add();
  s.background.fill = C.mist;
  eyebrow(s, "A shared support system", 72, 42);
  title(s, "Parents can reinforce consistency without hovering over every question.", 72);
  rect(s, { left: 676, top: 150, width: 532, height: 460 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "public-home-hero.png", { left: 692, top: 166, width: 500, height: 428 }, { fit: "cover", alt: "Student progress analytics preview" });
  bullet(s, "See the effort", "Sessions, questions, and timing make practice visible.", 72, 192, C.ink, 1);
  bullet(s, "See the direction", "Accuracy, coverage, and suggested practice clarify what comes next.", 72, 328, C.ink, 2);
  bullet(s, "Support the habit", "A parent can use the student’s account to follow progress at home.", 72, 464, C.ink, 3);
  text(s, "One practice record. Multiple adults supporting the same goal.", { left: 72, top: 610, width: 540, height: 42 }, 22, C.green, { bold: true });
  footer(s, 9);
  notes(s, ["First-party screenshot: public-home-hero.png.", "Parent use case supplied by the founder; no external claims used."]);
}

// 10 — Pricing
{
  const s = deck.slides.add();
  s.background.fill = C.white;
  eyebrow(s, "Access", 72, 42);
  title(s, "Start free. Add student and educator access as needed.", 72);
  const cols = [72, 458, 844];
  const plans = [
    { name: "FREE", price: "$0", sub: "Explore the platform", color: C.slate, bullets: ["Practice Tests 1–2", "Basic review tools", "Limited progress tracking"] },
    { name: "PREMIUM STUDENT", price: "$6.99", sub: "monthly · $49.99 yearly", color: C.green, bullets: ["One selected exam program", "Full practice and explanations", "Bookmarks and challenges"] },
    { name: "EDUCATOR", price: "$99", sub: "yearly", color: C.gold, bullets: ["One selected exam program", "Unlimited linked students", "Groups, assignments, and monitoring"] },
  ];
  plans.forEach((p, i) => {
    if (i > 0) rect(s, { left: cols[i] - 24, top: 174, width: 2, height: 382 }, C.faint);
    text(s, p.name, { left: cols[i], top: 182, width: 310, height: 30 }, 16, i === 2 ? C.green : p.color, { bold: true });
    text(s, p.price, { left: cols[i], top: 230, width: 310, height: 72 }, 54, i === 2 ? C.green : p.color, { bold: true });
    text(s, p.sub, { left: cols[i], top: 302, width: 310, height: 34 }, 17, C.slate);
    p.bullets.forEach((b, j) => {
      text(s, "•", { left: cols[i], top: 370 + j * 54, width: 20, height: 24 }, 20, C.gold, { bold: true });
      text(s, b, { left: cols[i] + 28, top: 368 + j * 54, width: 276, height: 34 }, 17, C.ink);
    });
  });
  rect(s, { left: 72, top: 584, width: 1136, height: 70 }, C.pale, { radius: "rounded-xl" });
  text(s, "For schools", { left: 96, top: 604, width: 150, height: 28 }, 18, C.green, { bold: true });
  text(s, "Student premium access and educator access are licensed separately. Schools can distribute student access through codes or an approved roster.", { left: 242, top: 598, width: 920, height: 42 }, 17, C.slate);
  footer(s, 10);
  notes(s, ["Pricing from the first-party /pricing page captured on 2026-08-10."]);
}

// 11 — Rollout fit
{
  const s = deck.slides.add();
  s.background.fill = C.mist;
  eyebrow(s, "Built for adoption", 72, 42);
  title(s, "A school can start focused—and expand when the routine works.", 72);
  const claims = [
    ["WEB + MOBILE", "Students practice where they already study."],
    ["ONE SHARED RECORD", "Results and analytics stay consistent across platforms."],
    ["FLEXIBLE ACCESS", "Start with one exam, one group, or one educator."],
  ];
  claims.forEach(([h, b], i) => {
    const x = 72 + i * 380;
    text(s, h, { left: x, top: 190, width: 330, height: 28 }, 16, C.green, { bold: true });
    text(s, b, { left: x, top: 226, width: 330, height: 58 }, 18, C.slate);
  });
  rect(s, { left: 60, top: 306, width: 560, height: 300 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "student-bootcamps.png", { left: 76, top: 322, width: 528, height: 268 }, { fit: "cover", alt: "Student bootcamp landing page" });
  rect(s, { left: 660, top: 306, width: 560, height: 300 }, C.white, { radius: "rounded-2xl", shadow: "shadow-md" });
  await image(s, "educator-bootcamps.png", { left: 676, top: 322, width: 528, height: 268 }, { fit: "cover", alt: "Educator bootcamp landing page" });
  text(s, "A familiar product across roles—without forcing the same workflow on everyone.", { left: 220, top: 624, width: 840, height: 36 }, 22, C.green, { bold: true, align: "center" });
  footer(s, 11);
  notes(s, ["First-party screenshots: student-bootcamps.png and educator-bootcamps.png."]);
}

// 12 — Close
{
  const s = deck.slides.add();
  s.background.fill = C.green;
  rect(s, { left: 0, top: 0, width: 24, height: 720 }, C.gold);
  await logo(s, { left: 92, top: 76, width: 72, height: 72 });
  text(s, "DRILL INSTRUCTOR", { left: 184, top: 91, width: 450, height: 38 }, 24, C.white, { bold: true });
  text(s, "Questions?", { left: 92, top: 232, width: 700, height: 86 }, 64, C.white, { bold: true });
  text(s, "Let’s walk through a live student and educator demo.", { left: 92, top: 340, width: 760, height: 58 }, 28, "#E5E9D5", { bold: true });
  rect(s, { left: 92, top: 456, width: 220, height: 5 }, C.gold);
  text(s, "drillinstructorprep.com", { left: 92, top: 488, width: 520, height: 38 }, 22, C.gold, { bold: true });
  text(s, "Practice. Review. Improve.", { left: 92, top: 548, width: 520, height: 38 }, 20, "#DCE1C6" );
  text(s, "12", { left: 1160, top: 660, width: 48, height: 24 }, 12, "#DCE1C6", { align: "right", bold: true });
  notes(s, ["First-party Drill Instructor brand and product domain."]);
}

await fs.mkdir(OUT, { recursive: true });
for (const [i, s] of deck.slides.items.entries()) {
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  const png = await deck.export({ slide: s, format: "png", scale: 1 });
  await fs.writeFile(path.join(OUT, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await s.export({ format: "layout" });
  await fs.writeFile(path.join(OUT, `${stem}.layout.json`), await layout.text());
}

const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
await fs.writeFile(path.join(OUT, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(FINAL);
console.log(FINAL);
