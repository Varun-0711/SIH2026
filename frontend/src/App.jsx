import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const API_URL = "http://localhost:8000/analyze-text";
const VOICE_TOKEN_URL = "http://localhost:8000/voice-token";

const riskStyles = {
  Low: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Moderate: "border-yellow-200 bg-yellow-50 text-yellow-700",
  High: "border-orange-200 bg-orange-50 text-orange-700",
  Critical: "border-red-200 bg-red-50 text-red-700",
};

const riskCategories = ["Critical", "High", "Moderate", "Low"];

function RiskBadge({ category, loading = false }) {
  const label = loading ? "Analyzing" : category || "Analysis unavailable";
  const styles = loading
    ? "border-slate-200 bg-slate-50 text-slate-500"
    : riskStyles[category] || "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      {loading && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </span>
  );
}

function LoadingSpinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />;
}

function PageHeader({ view, onViewChange }) {
  return (
    <header className="border-b border-slate-100 px-5 py-5 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-700 text-lg text-white">+</div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">Support Text Analyzer</h1>
            <p className="text-sm text-slate-500">Trauma-informed message screening</p>
          </div>
        </div>
        <nav className="flex rounded-xl bg-slate-100 p-1" aria-label="Main navigation">
          <button
            type="button"
            onClick={() => onViewChange("chat")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${view === "chat" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => onViewChange("dashboard")}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${view === "dashboard" ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            Case Dashboard
          </button>
        </nav>
      </div>
    </header>
  );
}

function ChatView({ messages, onSubmitMessage, isSending, onStartCall, voiceStatus, voiceError }) {
  const [message, setMessage] = useState("");
  const historyEndRef = useRef(null);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isSending) return;
    onSubmitMessage(text);
    setMessage("");
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-80 items-center justify-center text-center">
            <div className="max-w-sm">
              <p className="font-display text-lg font-semibold text-slate-700">Share a message to begin</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">The analysis will return a risk category and a suggested next action.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((item) => (
              <article key={item.id} className="flex items-start gap-3">
                <div className="mt-1 h-8 w-8 shrink-0 rounded-full bg-slate-900 text-center text-sm leading-8 text-white">You</div>
                <div className="min-w-0 max-w-[85%]">
                  <div className="flex flex-wrap items-center gap-2">
                    <RiskBadge category={item.riskCategory} loading={item.loading} />
                  </div>
                  <div className="mt-2 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-800">
                    <p className="whitespace-pre-wrap break-words">{item.text}</p>
                    {item.loading && <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><LoadingSpinner /> Analyzing message...</div>}
                  </div>
                  {item.error && <p className="mt-2 text-xs font-medium text-red-600">Analysis unavailable</p>}
                  {item.recommendedAction && <p className="mt-2 text-xs leading-5 text-slate-500">Suggested action: {item.recommendedAction}</p>}
                </div>
              </article>
            ))}
            <div ref={historyEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 bg-slate-50/80 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-teal-100 bg-teal-50/70 px-4 py-3">
          <button
            type="button"
            onClick={onStartCall}
            disabled={voiceStatus === "connecting" || voiceStatus === "recording"}
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {voiceStatus === "connecting" ? "Connecting..." : "Start Demo Call"}
          </button>
          {voiceStatus === "recording" && <span className="text-sm font-medium text-teal-800">Recording — speak now</span>}
          {voiceStatus === "ended" && !voiceError && <span className="text-sm font-medium text-slate-600">Call ended</span>}
          {voiceError && <span className="text-sm font-medium text-red-600">{voiceError}</span>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="border-t border-slate-100 bg-slate-50/80 p-4 sm:p-5">
        <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form.requestSubmit();
              }
            }}
            placeholder="Type a message to analyze..."
            rows={1}
            disabled={isSending}
            className="max-h-28 min-h-11 flex-1 resize-y bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!message.trim() || isSending}
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send
          </button>
        </div>
        <p className="mt-2 px-1 text-xs text-slate-400">Press Enter to send. Shift + Enter for a new line.</p>
      </form>
    </>
  );
}

function truncateMessage(text) {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function CaseDashboard({ messages }) {
  const [riskFilter, setRiskFilter] = useState("All");
  const completedMessages = messages.filter((item) => !item.loading);
  const filteredMessages = completedMessages
    .filter((item) => riskFilter === "All" || item.riskCategory === riskFilter)
    .sort((a, b) => (b.sviScore ?? -1) - (a.sviScore ?? -1));

  const counts = riskCategories.reduce((summary, category) => {
    summary[category] = completedMessages.filter((item) => item.riskCategory === category).length;
    return summary;
  }, {});

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Officer view</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">Case Dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">Review analyzed messages by urgency and recommended response.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          Filter:
          <select
            value={riskFilter}
            onChange={(event) => setRiskFilter(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          >
            <option>All</option>
            {riskCategories.slice().reverse().map((category) => <option key={category}>{category}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {riskCategories.map((category) => (
          <div key={category} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{category}</p>
            <p className="mt-1 font-display text-2xl font-bold text-slate-800">{counts[category]}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">Timestamp</th>
                <th className="px-4 py-3 font-bold">Message</th>
                <th className="px-4 py-3 font-bold">SVI Score</th>
                <th className="px-4 py-3 font-bold">Risk Category</th>
                <th className="px-4 py-3 font-bold">Flags</th>
                <th className="px-4 py-3 font-bold">Recommended Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredMessages.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center text-slate-500">No analyzed cases match this filter.</td>
                </tr>
              ) : (
                filteredMessages.map((item) => (
                  <tr key={item.id} className="align-top transition hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{new Date(item.timestamp).toLocaleString()}</td>
                    <td className="max-w-[220px] px-4 py-4 font-medium text-slate-700" title={item.text}>
                      {truncateMessage(item.text)}
                      {item.source && <span className="mt-1 block text-[11px] font-normal uppercase tracking-wide text-slate-400">{item.source}</span>}
                    </td>
                    <td className="px-4 py-4 font-display font-bold text-slate-800">{item.sviScore ?? "-"}</td>
                    <td className="px-4 py-4"><RiskBadge category={item.riskCategory} /></td>
                    <td className="max-w-[180px] px-4 py-4 text-xs text-slate-600">{item.flags?.join(", ") || "None"}</td>
                    <td className="max-w-[260px] px-4 py-4 text-xs leading-5 text-slate-600">{item.recommendedAction || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState("chat");
  const [messages, setMessages] = useState([]);
  const [voiceCases, setVoiceCases] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const voiceDeviceRef = useRef(null);
  const voiceCallRef = useRef(null);

  useEffect(() => {
    if (view !== "dashboard") return undefined;

    let active = true;
    async function loadVoiceCases() {
      try {
        const response = await fetch("http://localhost:8000/voice-cases");
        if (response.ok && active) setVoiceCases(await response.json());
      } catch {
        // The dashboard continues to show local chat cases if the backend is unavailable.
      }
    }

    loadVoiceCases();
    const interval = window.setInterval(loadVoiceCases, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [view]);

  async function handleStartCall() {
    setVoiceError("");
    setVoiceStatus("connecting");

    try {
      const response = await fetch(VOICE_TOKEN_URL);
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || "Unable to get a Twilio access token.");
      }

      const { token } = await response.json();
      const device = new Device(token);
      voiceDeviceRef.current = device;
      device.on("error", (error) => {
        setVoiceError(error.message || "The browser call failed.");
        setVoiceStatus("ended");
      });

      const call = await device.connect();
      voiceCallRef.current = call;
      call.on("accept", () => setVoiceStatus("recording"));
      call.on("disconnect", () => {
        setVoiceStatus("ended");
        voiceCallRef.current = null;
        device.destroy();
      });
      call.on("cancel", () => setVoiceStatus("ended"));
      call.on("reject", () => setVoiceStatus("ended"));
      call.on("error", (error) => {
        setVoiceError(error.message || "The browser call failed.");
        setVoiceStatus("ended");
      });
    } catch (error) {
      setVoiceError(error.message || "Unable to start the demo call.");
      setVoiceStatus("ended");
    }
  }

  async function handleSubmitMessage(text) {
    const id = crypto.randomUUID();
    setMessages((current) => [...current, { id, text, source: "Chat", timestamp: new Date().toISOString(), loading: true }]);
    setIsSending(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "en" }),
      });

      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const analysis = await response.json();

      setMessages((current) => current.map((item) => item.id === id ? {
        ...item,
        loading: false,
        riskCategory: analysis.risk_category,
        sviScore: analysis.svi_score,
        flags: analysis.flags || [],
        recommendedAction: analysis.recommended_action,
      } : item));
    } catch {
      setMessages((current) => current.map((item) => item.id === id ? { ...item, loading: false, error: true } : item));
    } finally {
      setIsSending(false);
    }
  }

  const dashboardMessages = [...messages, ...voiceCases];

  return (
    <main className="min-h-screen bg-[#f7f4ef] px-4 py-6 text-slate-900 sm:px-6 sm:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 sm:min-h-[calc(100vh-5rem)]">
        <PageHeader view={view} onViewChange={setView} />
        {view === "chat" ? (
          <ChatView
            messages={messages}
            onSubmitMessage={handleSubmitMessage}
            isSending={isSending}
            onStartCall={handleStartCall}
            voiceStatus={voiceStatus}
            voiceError={voiceError}
          />
        ) : (
          <CaseDashboard messages={dashboardMessages} />
        )}
      </section>
    </main>
  );
}

export default App;
