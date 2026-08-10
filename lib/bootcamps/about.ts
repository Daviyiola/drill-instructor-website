export interface BootcampAboutSection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const bootcampAbout: Record<string, {
  intro: string;
  sections: BootcampAboutSection[];
}> = {
  act: {
    intro:
      "A practical guide to the ACT—what it measures, how it is scored, and how to prepare with purpose.",
    sections: [
      {
        title: "What is the ACT?",
        paragraphs: [
          "The ACT is a standardized college entrance exam used by colleges and universities across the United States. It measures college readiness through English, Mathematics, Reading, and optional Science and Writing sections.",
          "Students commonly take it during junior or senior year. International students can take the same assessment at authorized test centers.",
        ],
      },
      {
        title: "Format of the ACT",
        paragraphs: [
          "The enhanced ACT has three core multiple-choice sections: English, Mathematics, and Reading. Science and Writing are optional. Every section is timed, so familiarity with the format matters as much as subject knowledge.",
        ],
        bullets: [
          "English: 50 questions in 35 minutes",
          "Mathematics: 45 questions in 50 minutes",
          "Reading: 36 questions in 40 minutes",
          "Science, optional: 40 questions in 40 minutes",
          "Writing, optional: one 40-minute essay",
        ],
      },
      {
        title: "How to prepare",
        paragraphs: [
          "Begin with a timed diagnostic test, then use the results to identify weak topics. Build a study schedule that alternates content review with timed practice and careful correction.",
        ],
        bullets: [
          "Review grammar rules, formulas, reading strategies, and data interpretation.",
          "Practice under official section time limits.",
          "Study every missed question and explain why each alternative is wrong.",
          "Use elimination and educated guessing—there is no penalty for a wrong answer.",
        ],
      },
      {
        title: "Scoring system",
        paragraphs: [
          "ACT section scores use a 1–36 scale. Your raw number of correct answers is converted into a scaled score, and there is no guessing penalty.",
          "For the enhanced ACT, the Composite score is based on English, Mathematics, and Reading. Science receives its own score when selected, while Writing is reported separately.",
        ],
      },
      {
        title: "Common mistakes to avoid",
        paragraphs: [
          "Many avoidable losses come from pacing and execution rather than missing knowledge.",
        ],
        bullets: [
          "Spending too long on one difficult question",
          "Leaving questions unanswered",
          "Misreading what a question asks for",
          "Doing complex calculations mentally",
          "Taking practice tests without reviewing mistakes",
          "Changing answers without a specific reason",
        ],
      },
      {
        title: "Test-day tips",
        paragraphs: [
          "Arrive early with the required identification and an approved calculator. Read directions carefully, keep a steady pace, and move on when a question begins consuming too much time.",
          "Use the final minutes of each section to answer anything left blank. A calm, deliberate finish is usually more valuable than repeatedly second-guessing completed work.",
        ],
      },
      {
        title: "Retaking the exam",
        paragraphs: [
          "You may take the ACT more than once. A retake is most useful when you have enough time to diagnose the first attempt, study the gaps, and complete meaningful timed practice before the next date.",
          "Check each college’s score-reporting policy. Some consider your highest Composite, while others may use a superscore assembled from your strongest section results.",
        ],
      },
      {
        title: "Eligibility requirements",
        paragraphs: [
          "The ACT does not impose a strict grade-level requirement, although most students test in grades 11 or 12. Registration requires an ACT account, an acceptable photo, and the identification required for your test location.",
        ],
      },
      {
        title: "International candidates",
        paragraphs: [
          "International candidates take the same academic assessment, generally using computer-based testing at authorized centers. Availability, dates, identification rules, and fees vary by country, so verify the details for your location before registering.",
        ],
      },
      {
        title: "Fees and payment",
        paragraphs: [
          "Registration fees vary with optional sections, international testing, late registration, and additional score reports. Confirm current pricing directly with ACT when you are ready to book.",
        ],
      },
      {
        title: "How to register",
        paragraphs: [
          "Create an account on the official ACT website, choose a test date and center, upload the required photo, select any optional sections and score recipients, then complete payment. Save your admission ticket and verify every deadline.",
        ],
      },
      {
        title: "What colleges look for",
        paragraphs: [
          "Colleges interpret ACT scores alongside grades, course rigor, essays, activities, and recommendations. A useful target score depends on the typical range at the schools on your list—not on a single universal definition of a good score.",
        ],
      },
      {
        title: "What’s next?",
        paragraphs: [
          "After testing, review your score report by section and compare it with your college targets. Decide whether to send scores, prepare for a retake, or focus on the rest of your application.",
          "Keep registration dates, application deadlines, and scholarship requirements together so that a strong test result becomes part of a complete, timely application.",
        ],
      },
    ],
  },
  sat: {
    intro:
      "A concise orientation to the digital SAT and the preparation habits that make practice useful.",
    sections: [
      {
        title: "What is the SAT?",
        paragraphs: [
          "The SAT is a digital college entrance assessment used by many U.S. colleges and universities. It measures Reading and Writing together with Mathematics.",
        ],
      },
      {
        title: "Test structure",
        paragraphs: [
          "The digital SAT is divided into Reading and Writing and Math. Each section has two adaptive modules, so performance in the first module influences the difficulty of the second.",
        ],
      },
      {
        title: "How to prepare",
        paragraphs: [
          "Use timed, module-length practice; review every missed question; and focus study time on recurring weaknesses rather than repeating topics you already control.",
        ],
      },
      {
        title: "Scoring",
        paragraphs: [
          "The total SAT score ranges from 400 to 1600, combining section scores for Reading and Writing and Math. Your target should reflect the score ranges at the schools you are considering.",
        ],
      },
    ],
  },
};
