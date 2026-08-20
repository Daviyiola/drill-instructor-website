"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import QuestionRichText from "@/components/app/QuestionRichText";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {questionImageUrls} from "@/lib/drills/images";
import {questionText} from "@/lib/drills/text";

type BlueprintSubject = {subject: string; questionIds: string[]};
type DrillDetail = {ok: true; full: {status: string; title: string; blueprint: null | {subjects: BlueprintSubject[]}}};
type BankQuestion = {id: string; subject: string; module: string; practiceTest: number; prompt: string; options: string[]; answerIndex: number; explanation: string; passage: string; imageSources: string[]};
type QuestionBank = {ok: true; questions: BankQuestion[]};

function mixedCase(value: string) {
  return String(value || "General").toLowerCase().replace(/(^|[\s/&-])\p{L}/gu, (letter) => letter.toUpperCase());
}

export default function EducatorPublishedQuestions({bootcamp, drillId}: {bootcamp: string; drillId: string}) {
  const {user} = useAuth();
  const [detail, setDetail] = useState<DrillDetail | null>(null);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [moduleName, setModuleName] = useState("all");
  const [explanations, setExplanations] = useState<Record<string, boolean>>({});
  const [showMap, setShowMap] = useState(false);
  const [reference, setReference] = useState<BankQuestion | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      setLoading(true); setError("");
      try {
        const drill = await callFunction<DrillDetail>(user, "getEducatorDrillDraftHttps", {bootcamp, drillId}, {retryTransient: true});
        if (!drill.full.blueprint || !["published", "closed"].includes(drill.full.status)) throw new Error("Published questions are not available for this drill.");
        const ids = drill.full.blueprint.subjects.flatMap((row) => Array.isArray(row.questionIds) ? row.questionIds : []);
        const bank = await callFunction<QuestionBank>(user, "getEducatorQuestionBankHttps", {bootcamp, questionIds: ids, limit: 500}, {retryTransient: true});
        if (!active) return;
        setDetail(drill);
        const byId = new Map(bank.questions.map((row) => [row.id, row]));
        setQuestions(ids.map((id) => byId.get(id)).filter((row): row is BankQuestion => Boolean(row)));
      } catch (reason) {
        if (active) setError((reason as Error).message);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [bootcamp, drillId, user]);

  const subjects = useMemo(() => [...new Set(questions.map((row) => row.subject))], [questions]);
  const modules = useMemo(() => [...new Set(questions.filter((row) => subject === "all" || row.subject === subject).map((row) => row.module))].sort(), [questions, subject]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return questions.filter((row) =>
      (subject === "all" || row.subject === subject) &&
      (moduleName === "all" || row.module === moduleName) &&
      (!needle || [row.prompt, row.module, row.explanation, ...row.options].some((value) => questionText(value).toLowerCase().includes(needle))));
  }, [moduleName, query, questions, subject]);

  return <main className="min-h-screen bg-brand-mist px-4 py-6 sm:px-6 lg:px-8">
    {loading && <BrandedLoadingOverlay label="Loading assignment questions" />}
    <div className="mx-auto max-w-7xl">
      <Link href={`/app/educator/bootcamps/${bootcamp}/drills`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>Drills</Link>
      <header className="mt-6"><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Read-only question set</p><h1 className="mt-2 text-3xl font-semibold">{detail?.full.title || "Assignment questions"}</h1><p className="mt-2 text-sm text-slate-600">Review the exact ordered question set assigned to students.</p></header>
      {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!loading && !error && <>
        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions, answers, or modules" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-sm outline-none focus:border-brand-green" />
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{["all", ...subjects].map((value) => <button key={value} type="button" onClick={() => {setSubject(value); setModuleName("all");}} className={`shrink-0 rounded-full px-3 py-2 text-xs ${subject === value ? "bg-brand-green text-white" : "bg-brand-mist text-slate-600"}`}>{value === "all" ? "All subjects" : value}</button>)}</div>
          <div className="mt-3 flex flex-wrap gap-2"><select value={moduleName} onChange={(event) => setModuleName(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600"><option value="all">All modules</option>{modules.map((value) => <option key={value} value={value}>{mixedCase(value)}</option>)}</select><span className="ml-auto self-center text-xs text-slate-400">{visible.length} shown</span></div>
        </section>
        <div className="mt-6 space-y-4">{visible.map((question) => {
          const originalIndex = questions.findIndex((row) => row.id === question.id) + 1;
          const explanationOpen = Boolean(explanations[question.id]);
          const images = questionImageUrls(question.imageSources, bootcamp);
          return <article id={`published-question-${question.id}`} key={question.id} className="scroll-mt-5 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <button type="button" onClick={() => setShowMap(true)} className="text-sm text-brand-green underline decoration-1 underline-offset-4">Question {originalIndex} of {questions.length}</button>
            <p className="mt-3 text-sm text-slate-700">{question.subject} · {mixedCase(question.module)}</p>
            <div className="mt-5 text-lg font-normal leading-8 text-slate-800"><QuestionRichText value={question.prompt} /></div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">{question.options.map((option, index) => <div key={index} className={`flex gap-3 rounded-xl border p-3 text-sm leading-6 ${explanationOpen && index === question.answerIndex ? "border-green-300 bg-green-50 text-green-900" : "border-slate-200 bg-brand-mist/45"}`}><span>{String.fromCharCode(65 + index)}</span><QuestionRichText value={option} /></div>)}</div>
            {explanationOpen && <div className="mt-5 rounded-2xl bg-brand-gold/15 p-5"><p className="text-xs uppercase tracking-wider text-brand-green">Explanation</p><div className="mt-3 text-sm leading-7 text-slate-700">{questionText(question.explanation) ? <QuestionRichText value={question.explanation} /> : "No explanation is available for this question."}</div></div>}
            <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setExplanations((current) => ({...current, [question.id]: !current[question.id]}))} className="min-h-10 rounded-xl bg-brand-green px-4 text-xs text-white">{explanationOpen ? "Hide explanation" : "Show explanation"}</button>{(images.length > 0 || question.passage) && <button type="button" onClick={() => setReference(question)} className="min-h-10 rounded-xl border border-brand-green px-4 text-xs text-brand-green">View reference</button>}</div>
          </article>;
        })}</div>
        {!visible.length && <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No questions match these filters.</div>}
      </>}
    </div>
    {showMap && <div className="fixed inset-0 z-50 bg-black/35"><button type="button" className="absolute inset-0" onClick={() => setShowMap(false)} aria-label="Close question navigator" /><aside className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-medium">Question navigator</h2><button type="button" onClick={() => setShowMap(false)} className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl">×</button></div><div className="mt-6 space-y-7">{subjects.map((subjectName) => <section key={subjectName}><h3 className="mb-3 text-sm font-medium">{subjectName}</h3><div className="grid grid-cols-6 gap-2">{questions.map((question, index) => ({question, index})).filter(({question}) => question.subject === subjectName).map(({question, index}) => <button key={question.id} type="button" onClick={() => {document.getElementById(`published-question-${question.id}`)?.scrollIntoView({behavior: "smooth", block: "start"}); setShowMap(false);}} className="aspect-square rounded-xl border border-slate-200 bg-brand-mist text-xs text-slate-700">{index + 1}</button>)}</div></section>)}</div></aside></div>}
    {reference && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><section className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white"><header className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><p className="text-sm">{reference.subject} · {mixedCase(reference.module)}</p><button type="button" onClick={() => setReference(null)} className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl">×</button></header><div className="max-h-[calc(90vh-5rem)] space-y-5 overflow-y-auto p-5 sm:p-7">{questionImageUrls(reference.imageSources, bootcamp).map((image, index) => <img key={image} src={image} alt={`Question reference ${index + 1}`} className="mx-auto max-h-[62vh] max-w-full rounded-2xl object-contain" />)}{reference.passage && <div className="rounded-2xl bg-brand-mist p-5 text-base leading-8 text-slate-700"><QuestionRichText value={reference.passage} /></div>}</div></section></div>}
  </main>;
}
