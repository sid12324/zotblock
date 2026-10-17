
"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStudyPreferences } from "@/components/preferences-provider";
import { defaultOnboardingAnswers, onboardingAnswersSchema, preferencesFromOnboarding } from "@/lib/preferences";
import type { OnboardingAnswers, StudyPreferences } from "@/lib/types";
import "./onboarding.css";

const questions = [
  {
    id: "nameMajor",
    title: "Let's get to know you.",
    helper: "We'll personalize your semester around you.",
    type: "profile",
  },
  {
    id: "sleep",
    title: "What's your sleep schedule like?",
    helper: "We'll plan study sessions around when you're awake.",
    type: "sleep",
  },
  {
    id: "study",
    title: "How many hours do you study each day?",
    helper: "Enter your usual daily study time. Decimals are okay, too.",
    type: "study",
  },
  {
    id: "breaks",
    title: "How do you take breaks?",
    helper: "Regular breaks can help you stay focused for longer.",
    type: "breaks",
  },
  {
    id: "focus",
    title: "When do you focus the best?",
    helper: "We'll try to schedule your hardest tasks during your peak hours.",
    type: "focus",
  },
  {
    id: "deadline",
    title: "When do you start assignments?",
    helper: "How far ahead of the deadline do you usually get started?",
    type: "deadline",
  },
];

const initialAnswers = defaultOnboardingAnswers;

const focusOptions = ["Morning", "Afternoon", "Evening", "Night"] as const;

function formatTime(time: string) {
  if (!time) return "Not selected";

  const [hours, minutes] = time.split(":");
  // These are wall clock preferences, independent of today's daylight saving transition.
  const date = new Date(Date.UTC(2000, 0, 1, Number(hours), Number(minutes)));

  return date.toLocaleTimeString([], {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
}

function DurationSlider({ label, value, onChange, min, max, unit }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number; unit: string }) {
  const inputId = useId();
  return (
    <div className="slider-panel">
      <div className="slider-heading">
        <label className="field-label" htmlFor={inputId}>{label}</label>
        <strong>
          {value} <span>{unit}</span>
        </strong>
      </div>

      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        value={value}
        step={1}
        aria-valuetext={`${value} ${unit}`}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      <div className="range-labels">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const store = useStudyPreferences();
  if (!store.ready) return <div className="zot-onboarding"><div className="app"><main className="main"><p role="status">Loading your preferences…</p></main></div></div>;
  return <OnboardingForm initialPreferences={store.preferences} completed={store.completed} savePreferences={store.savePreferences} storageNotice={store.storageNotice}/>;
}

function OnboardingForm({ initialPreferences, completed, savePreferences, storageNotice }: { initialPreferences: StudyPreferences; completed: boolean; savePreferences: (preferences: StudyPreferences) => void; storageNotice: string | null }) {
  const router = useRouter();
  const [screen, setScreen] = useState(completed ? 0 : -1);
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => {
    const saved = onboardingAnswersSchema.safeParse(initialPreferences.onboardingAnswers);
    return saved.success ? saved.data : { ...initialAnswers };
  });
  const [formError, setFormError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [screen]);

  const question = questions[screen];
  const isWelcome = screen === -1;
  const isComplete = screen === questions.length;

  const update = <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const next = () => {
    setFormError(null);
    if (screen === questions.length - 1) {
      const parsed = onboardingAnswersSchema.safeParse(answers);
      if (!parsed.success) { setFormError(parsed.error.issues[0]?.message || "Please check your answers."); return; }
      try { savePreferences(preferencesFromOnboarding(parsed.data, initialPreferences)); }
      catch { setFormError("We couldn’t save your preferences. Please check your answers."); return; }
    }
    setScreen((prev) => prev + 1);
  };
  const back = () => { setFormError(null); setScreen((prev) => prev - 1); };

  const validStudyHours =
    answers.studyHours.trim() !== "" &&
    answers.studyHours.length <= 20 &&
    Number.isFinite(Number(answers.studyHours)) &&
    Number(answers.studyHours) >= 0 &&
    Number(answers.studyHours) <= 24;

  const canContinue = !question
    ? true
    : question.type === "profile"
    ? answers.name.trim() !== "" && answers.major.trim() !== ""
    : question.type === "sleep"
    ? /^([01]\d|2[0-3]):[0-5]\d$/.test(answers.wake) && /^([01]\d|2[0-3]):[0-5]\d$/.test(answers.sleep) && answers.wake !== answers.sleep
    : question.type === "focus"
    ? /^([01]\d|2[0-3]):[0-5]\d$/.test(answers.focusTime)
    : question.type === "study"
    ? validStudyHours
    : true;

  const progress = isComplete
    ? 100
    : isWelcome
    ? 0
    : ((screen + 1) / questions.length) * 100;

  const reset = () => {
    setFormError(null);
    setAnswers({ ...initialAnswers });
    setScreen(-1);
  };

  return (
    <div className="zot-onboarding"><div className="app">


      <header className="topbar">
        <Link href="/" className="brand" aria-label="ZotBlock home">
          <div className="brand-icon">Z</div>
          ZotBlock
        </Link>
        <nav className="onboarding-links" aria-label="App navigation"><Link href="/integrations">Integrations</Link><Link href="/calendar">Calendar</Link></nav>
        <div className="top-note">
          {isWelcome
            ? "Your semester starts here"
            : isComplete
            ? "Setup complete"
            : "Let's build your routine"}
        </div>
      </header>

      <main className="main">
        {isWelcome && (
          <section className="card" aria-labelledby="onboarding-step-title">
            <div className="eyebrow">A little more organized</div>
            <h1 id="onboarding-step-title" ref={headingRef} tabIndex={-1}>
              Your whole semester,
              <br />
              <span className="accent">blocked out.</span>
            </h1>
            <p className="description">
              Your classes, study sessions, and breaks — all in one plan
              built around your life.
            </p>

            <div className="welcome-art" aria-hidden="true">
              {[0, 1, 2].map((day) => (
                <div className="mini-day" key={day}>
                  <div className="mini-line" style={{ width: "55%" }} />
                  <div className="mini-block" />
                  <div className={`mini-block ${day === 1 ? "warm" : ""}`} />
                  <div className="mini-line" style={{ width: "75%" }} />
                </div>
              ))}
            </div>

            <button type="button" className="primary full" onClick={next}>
              Get started →
            </button>
            <div className="welcome-footer">
              6 quick questions · Make this semester yours
            </div>
          </section>
        )}

        {!isWelcome && !isComplete && (
          <form className="card" key={question.id} aria-labelledby="onboarding-step-title" onSubmit={(event) => { event.preventDefault(); if (canContinue) next(); }}>
            <div className="progress-section">
              <div className="progress-meta">
                <span>QUESTION {screen + 1} OF {questions.length}</span>
                <span>{Math.round(progress)}% COMPLETE</span>
              </div>
              <div className="progress-track" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`Question ${screen + 1} of ${questions.length}`}>
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="eyebrow">Let’s make it yours</div>
            <h2 id="onboarding-step-title" ref={headingRef} tabIndex={-1}>{question.title}</h2>
            <p className="helper">{question.helper}</p>

            {question.type === "profile" && (
              <>
                <label className="field">
                  <span className="field-label">Your name</span>
                  <input
                    maxLength={100}
                    required
                    type="text"
                    placeholder="e.g. Alex Johnson"
                    value={answers.name}
                    onChange={(e) => update("name", e.target.value)}
                    autoComplete="name"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Your major</span>
                  <input
                    maxLength={160}
                    required
                    type="text"
                    placeholder="e.g. Economics"
                    value={answers.major}
                    onChange={(e) => update("major", e.target.value)}
                  />
                </label>
              </>
            )}

            {question.type === "sleep" && (
              <div className="two-columns" role="group" aria-label="Sleep schedule" aria-describedby={!canContinue ? "sleep-schedule-error" : undefined}>
                <TimeField
                  label="I usually wake up"
                  value={answers.wake}
                  onChange={(v) => update("wake", v)}
                />
                <TimeField
                  label="I usually go to sleep"
                  value={answers.sleep}
                  onChange={(v) => update("sleep", v)}
                />
              </div>
            )}

            {question.type === "study" && (
              <div>
                <label className="field">
                  <span className="field-label">
                    Study hours per day
                  </span>
                  <input
                    className="study-input"
                    type="number"
                    min="0"
                    max="24"
                    step="any"
                    inputMode="decimal"
                    required
                    aria-describedby="study-hours-help"
                    placeholder="e.g. 4 or 3.5"
                    value={answers.studyHours}
                    onChange={(e) => {
                      const value = e.target.value;

                      if (value.length <= 20 && (value === "" || /^\d*\.?\d*$/.test(value))) {
                        update("studyHours", value);
                      }
                    }}
                  />
                  <div className="input-hint" id="study-hours-help">
                    Enter a number between 0 and 24. You can use decimals,
                    such as 2.5 hours.
                  </div>
                </label>
              </div>
            )}

            {question.type === "breaks" && (
              <>
                <SelectField
                  label="How long is each break?"
                  value={answers.breakMinutes}
                  onChange={(v) => update("breakMinutes", v as OnboardingAnswers["breakMinutes"])}
                  options={[
                    { value: "5", label: "5 minutes" },
                    { value: "10", label: "10 minutes" },
                    { value: "15", label: "15 minutes" },
                    { value: "20", label: "20 minutes" },
                    { value: "30", label: "30 minutes" },
                    { value: "45", label: "45 minutes" },
                    { value: "60", label: "1 hour" },
                  ]}
                />
                <SelectField
                  label="How often do you take breaks?"
                  value={answers.breakFrequency}
                  onChange={(v) => update("breakFrequency", v as OnboardingAnswers["breakFrequency"])}
                  options={[
                    { value: "Every 25 minutes", label: "Every 25 minutes" },
                    { value: "Every 30 minutes", label: "Every 30 minutes" },
                    { value: "Every 45 minutes", label: "Every 45 minutes" },
                    { value: "Every 60 minutes", label: "Every 60 minutes" },
                    { value: "Every 90 minutes", label: "Every 90 minutes" },
                    { value: "Whenever I need one", label: "Whenever I need one" },
                  ]}
                />
              </>
            )}

            {question.type === "focus" && (
              <>
                <div className="option-grid" role="group" aria-label="Best focus period">
                  {focusOptions.map((option) => {
                    const selected = answers.focusPeriod === option;

                    return (
                      <button
                        key={option}
                        type="button"
                        className={`option ${selected ? "selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => update("focusPeriod", option)}
                      >
                        {option}
                        <span className="check" aria-hidden="true">
                          {selected ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 23 }}>
                  <TimeField
                    label="What time do you feel most focused?"
                    value={answers.focusTime}
                    onChange={(v) => update("focusTime", v)}
                  />
                </div>
              </>
            )}

            {question.type === "deadline" && (
              <DurationSlider
                label="Days before the deadline"
                value={answers.deadlineDays}
                onChange={(v) => update("deadlineDays", v)}
                min={0}
                max={30}
                unit="days"
              />
            )}

            {formError && <p className="form-error" role="alert">{formError}</p>}
            {question.type === "sleep" && !canContinue && <p className="form-error" id="sleep-schedule-error" role="alert">Choose valid wake and sleep times that are different. Overnight schedules are supported.</p>}
            <div className="nav">
              <button type="button" className="back" onClick={back}>
                ← Back
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!canContinue}
              >
                {screen === questions.length - 1
                  ? "Finish setup"
                  : "Next →"}
              </button>
            </div>
          </form>
        )}

        {isComplete && (
          <section className="card success" aria-labelledby="onboarding-step-title">
            <div className="success-icon" aria-hidden="true">✓</div>
            <div className="eyebrow">Ready when you are</div>
            <h2 id="onboarding-step-title" ref={headingRef} tabIndex={-1}>
              You’re all set{answers.name ? `, ${answers.name}` : ""}!
            </h2>
            <p className="description">
              Your preferences are ready. Let’s turn them into a semester
              that feels more manageable.
            </p>

            <div className="summary">
              <div className="summary-title">YOUR STUDY PROFILE</div>

              <div className="summary-row">
                <span>Major</span>
                <span>{answers.major}</span>
              </div>

              <div className="summary-row">
                <span>Awake hours</span>
                <span>
                  {formatTime(answers.wake)} – {formatTime(answers.sleep)}
                </span>
              </div>

              <div className="summary-row">
                <span>Daily study goal</span>
                <span>{answers.studyHours} hours per day</span>
              </div>

              <div className="summary-row">
                <span>Break length</span>
                <span>{answers.breakMinutes} minutes</span>
              </div>

              <div className="summary-row">
                <span>Break frequency</span>
                <span>{answers.breakFrequency}</span>
              </div>

              <div className="summary-row">
                <span>Peak focus</span>
                <span>
                  {answers.focusPeriod}, {formatTime(answers.focusTime)}
                </span>
              </div>

              <div className="summary-row">
                <span>Assignment lead time</span>
                <span>{answers.deadlineDays} days early</span>
              </div>
            </div>

            {storageNotice && <p className="saved-note" role="status">{storageNotice}</p>}
            <p className="saved-note">{storageNotice ? "Your answers are ready for this visit." : "Your answers are saved in this browser."} Next, connect your accounts and generate your study blocks.</p>
            <button
              type="button"
              className="primary full"
              onClick={() => router.push("/integrations")}
            >
              Build my schedule →
            </button>

            <button
              type="button"
              className="back"
              onClick={reset}
              style={{ marginTop: 12 }}
            >
              Start over
            </button>
          </section>
        )}
      </main>
    </div></div>
  );
}
