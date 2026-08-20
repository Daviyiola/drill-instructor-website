export interface BootcampAboutSection {
  title: string;
  summary: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface BootcampAboutContent {
  fullName: string;
  intro: string;
  facts: Array<{value: string; label: string}>;
  sections: BootcampAboutSection[];
}

export const bootcampAbout: Record<string, BootcampAboutContent> = {
  act: {
    fullName: "The enhanced ACT assessment",
    intro: "Understand the enhanced ACT format, scoring, pacing, and the preparation habits that turn practice into progress.",
    facts: [
      {value: "1 - 36", label: "Score scale"},
      {value: "131 - 171", label: "Questions"},
      {value: "2H 5M", label: "Core testing time"},
    ],
    sections: [
      {
        title: "ACT at a glance",
        summary: "What the exam is and where it fits.",
        paragraphs: [
          "The ACT is a college-readiness assessment used in U.S. admissions and accepted by many institutions. It measures skills developed through secondary school rather than a separate specialist curriculum.",
          "Colleges set their own testing policies, so always check the requirements and typical score range for each school on your list.",
        ],
      },
      {
        title: "Structure and timing",
        summary: "Five sections, with Science and Writing optional.",
        paragraphs: ["The enhanced ACT has three required multiple-choice sections. Science and Writing are optional. Breaks and check-in time are not included in the section times below."],
        bullets: [
          "English: 50 questions in 35 minutes",
          "Mathematics: 45 questions in 50 minutes",
          "Reading: 36 questions in 40 minutes",
          "Science, optional: 40 questions in 40 minutes",
          "Writing, optional: one essay in 40 minutes",
        ],
      },
      {
        title: "What it measures",
        summary: "Language, mathematics, reading, and scientific reasoning.",
        paragraphs: [
          "English focuses on revising and editing texts for grammar, usage, organization, and rhetorical effectiveness. Mathematics covers reasoning from foundational algebra through geometry and trigonometry.",
          "Reading measures comprehension and analysis of literary and informational texts. Optional Science emphasizes interpreting data, evaluating investigations, and reasoning from scientific evidence rather than memorizing isolated facts.",
        ],
      },
      {
        title: "Scores and guessing",
        summary: "Section scores use 1 - 36; wrong answers carry no penalty.",
        paragraphs: [
          "The number of correct answers in each multiple-choice section is converted to a 1–36 scale score. The current Composite is the rounded average of English, Mathematics, and Reading. Science receives a separate section score and contributes to a STEM score when taken; Writing is reported separately.",
          "There is no penalty for an incorrect answer, so answer every question. Colleges may also consider superscores, but their score-use policies vary.",
        ],
      },
      {
        title: "Prepare with purpose",
        summary: "Diagnose, target weak areas, then retest under time.",
        paragraphs: ["Begin with a timed diagnostic. Use its subject and module results to decide what to study instead of repeating material you already control."],
        bullets: [
          "Alternate focused skill drills with full timed sections.",
          "Review every missed or guessed question and explain the correct reasoning.",
          "Practice skipping, returning, and eliminating choices without losing pace.",
          "Use full tests periodically to build stamina and measure progress.",
        ],
      },
      {
        title: "Test-day essentials",
        summary: "Remove logistical surprises before the clock starts.",
        paragraphs: [
          "Confirm your reporting time, test location, identification requirements, admission materials, and calculator policy in advance. Delivery may be paper or online depending on the testing program and location.",
          "Arrive early, follow the proctor's instructions, and keep moving when one question begins consuming too much time. Use any remaining time within the section to check marked or unanswered questions.",
        ],
      },
      {
        title: "Registration and retakes",
        summary: "Plan backward from admission and scholarship deadlines.",
        paragraphs: [
          "Register through the official ACT service, choose the appropriate date and location, provide the required photo and identification details, select optional sections, and confirm current fees before paying.",
          "A retake is most useful after you have diagnosed the first result and completed meaningful targeted practice. Leave enough time for registration, score release, and score delivery.",
        ],
      },
      {
        title: "International planning",
        summary: "Dates, seats, fees, and identification vary by country.",
        paragraphs: [
          "International students take the same academic assessment, but delivery, available dates, test centers, identification rules, and regional fees can differ. Register early where seats are limited.",
          "Because testing details can change, confirm the current rules on ACT's official website before booking or traveling.",
        ],
      },
    ],
  },
  sat: {
    fullName: "The digital SAT college-admissions assessment",
    intro: "A clear guide to the digital SAT, its adaptive modules, scoring, pacing, and effective preparation.",
    facts: [
      {value: "400 - 1600", label: "Total score"},
      {value: "98", label: "Questions"},
      {value: "2H 14M", label: "Testing time"},
    ],
    sections: [
      {
        title: "SAT at a glance",
        summary: "A digital college-admissions assessment.",
        paragraphs: [
          "The SAT measures Reading and Writing together with Mathematics. It is used by many U.S. colleges and by some institutions elsewhere, but every college decides whether scores are required, optional, or considered at all.",
          "Use the admission policy and typical score range of each target school to set a meaningful goal.",
        ],
      },
      {
        title: "Structure and timing",
        summary: "Two sections, each divided into two adaptive modules.",
        paragraphs: ["The digital SAT takes 2 hours and 14 minutes of testing time, with a 10-minute break between Reading and Writing and Math."],
        bullets: [
          "Reading and Writing: 54 questions in 64 minutes, split into two 32-minute modules",
          "Math: 44 questions in 70 minutes, split into two 35-minute modules",
          "Total: 98 questions in 134 minutes",
          "Most questions are multiple choice; some Math questions require an entered answer",
        ],
      },
      {
        title: "How adaptive modules work",
        summary: "The first module helps determine the second module's difficulty.",
        paragraphs: [
          "Each section begins with a module containing a range of difficulty. Performance in that first module routes the student to a more or less difficult second module.",
          "You may move among questions within the current module, but after a module ends you cannot return to it. One difficult second module is not a reason to panic; it may reflect strong first-module performance.",
        ],
      },
      {
        title: "Scores and guessing",
        summary: "Two 200 - 800 section scores form the 400 - 1600 total.",
        paragraphs: [
          "Reading and Writing is scored from 200 to 800, and Math is scored from 200 to 800. Their sum produces the total score from 400 to 1600.",
          "Scoring accounts for question difficulty and the adaptive route, so it is not a simple percentage conversion. There is no penalty for an incorrect answer; answer every question.",
        ],
      },
      {
        title: "Prepare with purpose",
        summary: "Practice by skill, module, and full-test conditions.",
        paragraphs: ["Start with a timed diagnostic and use the results to identify recurring weaknesses in comprehension, language conventions, algebra, problem solving, geometry, and advanced math."],
        bullets: [
          "Practice complete 32- and 35-minute modules, not only untimed questions.",
          "Review why the correct choice works and why each tempting alternative fails.",
          "Learn the built-in graphing calculator before test day.",
          "Use full digital practice tests periodically to develop pacing and stamina.",
        ],
      },
      {
        title: "Test-day essentials",
        summary: "Prepare the testing device and admission materials early.",
        paragraphs: [
          "Complete the required Bluebook setup before test day and arrive with an approved, fully charged device, charger, admission ticket, and acceptable photo identification. College Board provides a built-in graphing calculator, and an approved handheld calculator may also be used for Math.",
          "Follow the current device, scratch-paper, prohibited-item, and test-center instructions shown in your registration account.",
        ],
      },
      {
        title: "Registration and retakes",
        summary: "Register early and leave room for another attempt if needed.",
        paragraphs: [
          "Register through College Board, select an available date and test center, verify that your personal details match your identification, complete the required photo and payment steps, and finish Bluebook setup by the stated deadline.",
          "Retaking can make sense when later practice is consistently stronger or a target school or scholarship requires a higher range. Check each institution's superscoring and score-reporting policy.",
        ],
      },
      {
        title: "International planning",
        summary: "Confirm local availability, identification, and regional fees.",
        paragraphs: [
          "International test-center capacity can be limited, and identification or regional fee requirements may differ. Register early and avoid placing your final attempt too close to an application deadline.",
          "Confirm current dates, fees, accepted devices, identification, and score-delivery timelines on College Board's official SAT website.",
        ],
      },
    ],
  },
};
