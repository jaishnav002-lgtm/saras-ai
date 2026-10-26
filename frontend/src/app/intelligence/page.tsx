"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  answerSubjectQuestion,
  AnswerSource,
  ApiError,
  GroundedAnswer,
  listSubjects,
  Subject,
} from "@/lib/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: AnswerSource[];
};

const EXAMPLE_QUESTIONS = [
  "What are the key concepts in this subject?",
  "Summarize the main ideas from the uploaded material.",
  "Create a concise study guide for the most important topics.",
];

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Network error. Check your connection and try again.";
  if (error.status === 401 || error.status === 403) return "Your session cannot access this subject. Please sign in again or choose another subject.";
  if (error.status === 429) return "The study assistant is busy. Please wait a moment and try again.";
  if (error.status >= 500) return "The study assistant is temporarily unavailable. Please try again.";
  return error.message || "Could not get an answer. Please try again.";
}

function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-neutral-800">
      {text.split(/\n{2,}/).filter(Boolean).map((section, index) => {
        const lines = section.split("\n").filter(Boolean);
        const isList = lines.every((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={index} className="whitespace-pre-wrap">{section}</p>;
      })}
    </div>
  );
}

function Sources({ sources, subjectName }: { sources: AnswerSource[]; subjectName?: string }) {
  if (!sources.length) return null;
  return (
    <section className="mt-4 border-t border-neutral-200 pt-3" aria-label="Answer sources">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">Sources</h3>
      <ul className="space-y-1.5">
        {sources.map((source) => (
          <li key={source.chunk_id} className="text-xs text-neutral-600">
            <span className="font-medium text-neutral-800">{source.filename}</span>
            {subjectName && <> · {subjectName}</>}
            {source.page_number !== null && <> · Page {source.page_number}</>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function IntelligencePage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    listSubjects()
      .then((availableSubjects) => {
        setSubjects(availableSubjects);
        setSubjectId((current) => current || availableSubjects[0]?.id || "");
      })
      .catch(() => setSubjectError("Could not load your authorized subjects."))
      .finally(() => setLoadingSubjects(false));
  }, []);

  const selectedSubject = subjects.find((subject) => subject.id === subjectId);

  function startNewChat() {
    setMessages([]);
    setQuestion("");
    setRequestError(null);
  }

  async function submitQuestion(event?: FormEvent) {
    event?.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || !subjectId || isSubmitting) return;

    setRequestError(null);
    setIsSubmitting(true);
    setQuestion("");
    const userMessage: Message = { id: `user-${Date.now()}`, role: "user", text: trimmedQuestion };
    setMessages((current) => [...current, userMessage]);

    try {
      const response: GroundedAnswer = await answerSubjectQuestion(subjectId, trimmedQuestion);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: response.answer,
          sources: response.sources,
        },
      ]);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      setQuestion(trimmedQuestion);
      setRequestError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-4xl flex-col">
        <header className="mb-6 flex flex-col gap-4 border-b border-black pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">S Intelligence</h1>
            <p className="mt-1 text-sm text-neutral-500">Your AI-powered study assistant.</p>
          </div>
          <div className="w-full sm:w-64">
            <label htmlFor="subject" className="mb-1 block text-xs uppercase tracking-wide text-neutral-600">Subject</label>
            <select
              id="subject"
              className="input-field"
              value={subjectId}
              disabled={loadingSubjects || !subjects.length || isSubmitting}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {loadingSubjects ? <option>Loading subjects…</option> : null}
              {!loadingSubjects && !subjects.length ? <option>No subjects available</option> : null}
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </div>
        </header>

        {subjectError && <p role="alert" className="mb-4 border border-black bg-neutral-50 px-3 py-2 text-sm">{subjectError}</p>}

        <main className="flex flex-1 flex-col gap-4" aria-live="polite">
          {messages.length === 0 ? (
            <section className="card my-auto p-6 sm:p-8" aria-label="Start a new conversation">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">Ask about your study materials</h2>
                  <p className="mt-1 text-sm text-neutral-500">
                    {selectedSubject ? `Questions will use authorized material from ${selectedSubject.name}.` : "Choose a subject to begin."}
                  </p>
                </div>
                <button type="button" className="btn-secondary shrink-0" onClick={startNewChat}>New Chat</button>
              </div>
              <div className="mt-6">
                <p className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Try asking</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUESTIONS.map((example) => (
                    <button key={example} type="button" onClick={() => setQuestion(example)} className="border border-neutral-300 px-3 py-2 text-left text-xs hover:border-black focus:outline-none focus:ring-1 focus:ring-black">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <div className="space-y-4 pb-4">
              <div className="flex justify-end"><button type="button" className="btn-secondary text-xs" onClick={startNewChat} disabled={isSubmitting}>New Chat</button></div>
              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-2xl bg-black px-4 py-3 text-sm text-white" : "card max-w-3xl p-4 sm:p-5"}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-widest opacity-70">{message.role === "user" ? "You" : "S Intelligence"}</p>
                  {message.role === "assistant" ? <><AnswerText text={message.text} /><Sources sources={message.sources || []} subjectName={selectedSubject?.name} /></> : <p className="whitespace-pre-wrap leading-6">{message.text}</p>}
                </article>
              ))}
              {isSubmitting && <div className="card max-w-3xl p-4 text-sm text-neutral-500" role="status">S Intelligence is reviewing your study materials…</div>}
            </div>
          )}
        </main>

        {requestError && (
          <div role="alert" className="mt-4 flex flex-col gap-3 border border-black bg-neutral-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>{requestError}</span>
            <button type="button" className="btn-secondary text-xs" onClick={() => submitQuestion()} disabled={isSubmitting || !question.trim()}>Retry</button>
          </div>
        )}

        <form ref={formRef} onSubmit={submitQuestion} className="mt-4 border-t border-black pt-4">
          <label htmlFor="question" className="sr-only">Ask S Intelligence a question</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              id="question"
              className="input-field min-h-24 resize-y"
              value={question}
              disabled={isSubmitting || !subjectId || loadingSubjects}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={subjectId ? "Ask a question about this subject…" : "Select a subject to ask a question"}
              aria-describedby="question-help"
            />
            <button type="submit" className="btn-primary sm:mb-0" disabled={isSubmitting || !question.trim() || !subjectId || loadingSubjects}>
              {isSubmitting ? "Sending…" : "Send"}
            </button>
          </div>
          <p id="question-help" className="mt-2 text-xs text-neutral-500">Press Enter to send. Press Shift+Enter for a new line.</p>
        </form>
      </div>
    </AppShell>
  );
}
