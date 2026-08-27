"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { ChatWindow, type Message } from "@/components/ChatWindow";
import { BusinessProgress } from "@/components/BusinessProgress";

type Theme = "dark" | "light";

const INITIAL_MESSAGE: Message = {
  id: "init",
  role: "assistant",
  content:
    "Hello! I'm your AI Business Problem Discovery Engine. Tell me about a business, workflow, or recurring process you're analyzing. My goal is to help you uncover, qualify, and validate valuable business problems and automation opportunities.\n\nWhere would you like to start?",
  timestamp: new Date(0), // replaced client-side in useEffect
};

type VoiceState = "idle" | "recording" | "transcribing" | "preview";

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [businessId, setBusinessId] = useState<number | undefined>();
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [businessContext, setBusinessContext] = useState<
    Record<string, unknown> | undefined
  >();
  const [askedFields, setAskedFields] = useState<string[]>([]);
  const [skippedFields, setSkippedFields] = useState<string[]>([]);
  const [problemSignals, setProblemSignals] = useState<string[]>([]);
  const [automationSignals, setAutomationSignals] = useState<string[]>([]);
  const [integrationSignals, setIntegrationSignals] = useState<string[]>([]);
  const [aiSignals, setAiSignals] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [opportunityAssessment, setOpportunityAssessment] = useState<string | undefined>();
  // NEW: session identity + disambiguation UI
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [pendingSelection, setPendingSelection] = useState<{
    type: string;
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
  } | null>(null);
  const [pendingBusinessMatch, setPendingBusinessMatch] = useState<{ id: number; name: string } | null>(null);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);


  // ── Session ID (browser-generated, durable across reloads) ───────────────────
  useEffect(() => {
    let sid = localStorage.getItem("bo-session-id");
    if (!sid) {
      sid = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem("bo-session-id", sid);
    }
    setSessionId(sid);
  }, []);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("bo-theme") as Theme | null;
    const initial: Theme = saved ?? "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      localStorage.setItem("bo-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  };

  // ── Voice state ────────────────────────────────────────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Set initial message timestamp client-side to avoid SSR hydration mismatch
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === "init" ? { ...m, timestamp: new Date() } : m
      )
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Core send (unchanged) ──────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (overrideText?: string, mode: "text" | "voice" = "text") => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      // Auto-expand sidebar once conversation starts
      if (!sidebarExpanded) setSidebarExpanded(false);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId,
            businessId,
            askedFields,
            skippedFields,
            problemSignals,
            automationSignals,
            integrationSignals,
            aiSignals,
            evidence,
            opportunityAssessment,
            inputMode: mode,
            sessionId,         // NEW
          }),
        });


        const data = await res.json();

        if (data.error) {
          throw new Error(data.error);
        }

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
          suggestedOptions: data.suggestedOptions,
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (data.conversationId) setConversationId(data.conversationId);
        if (data.businessId) setBusinessId(data.businessId);
        if (data.missingFields) setMissingFields(data.missingFields);
        if (data.businessContext) setBusinessContext(data.businessContext);
        if (data.askedFields) setAskedFields(data.askedFields);
        if (data.skippedFields) setSkippedFields(data.skippedFields);
        if (data.problemSignals) setProblemSignals(data.problemSignals);
        if (data.automationSignals) setAutomationSignals(data.automationSignals);
        if (data.integrationSignals) setIntegrationSignals(data.integrationSignals);
        if (data.aiSignals) setAiSignals(data.aiSignals);
        if (data.evidence) setEvidence(data.evidence);
        if (data.opportunityAssessment) setOpportunityAssessment(data.opportunityAssessment);
        // NEW: structured disambiguation state
        setPendingSelection(data.pendingSelection ?? null);
        setPendingBusinessMatch(data.pendingBusinessMatch ?? null);

      } catch (err) {
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        // Restore focus to input after response
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [
      input,
      isLoading,
      conversationId,
      businessId,
      askedFields,
      skippedFields,
      problemSignals,
      automationSignals,
      integrationSignals,
      aiSignals,
      evidence,
      opportunityAssessment,
      sessionId,
      sidebarExpanded,
    ]
  );


  // ── Voice: start recording ─────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setVoiceError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Choose a supported MIME type
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all mic tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType || "audio/webm",
        });
        audioChunksRef.current = [];

        if (audioBlob.size === 0) {
          setVoiceState("idle");
          return;
        }

        setVoiceState("transcribing");

        try {
          const form = new FormData();
          form.append("audio", audioBlob, `recording.${mimeType.split("/")[1]?.split(";")[0] || "webm"}`);

          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: form,
          });

          const data = await res.json();

          if (!res.ok || data.error) {
            setVoiceError(data.error ?? "I couldn't hear that clearly. Please try again.");
            setVoiceState("idle");
            return;
          }

          if (!data.text || !data.text.trim()) {
            setVoiceError("No speech detected. Please speak clearly and try again.");
            setVoiceState("idle");
            return;
          }

          // Inject transcript into textarea so user can edit
          setTranscript(data.text.trim());
          setInput(data.text.trim());
          setVoiceState("preview");
        } catch {
          setVoiceError("I couldn't hear that clearly. Please try again.");
          setVoiceState("idle");
        }
      };

      recorder.start(250); // collect chunks every 250ms
      setRecordingSeconds(0);
      setVoiceState("recording");

      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow access in your browser settings."
          : "Could not access your microphone. Please try again.";
      setVoiceError(msg);
      setVoiceState("idle");
    }
  }, []);

  // ── Voice: stop recording ──────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  // ── Voice: confirm transcript → send via existing pipeline ─────────────────
  const confirmTranscript = useCallback(() => {
    const text = input.trim(); // user may have edited textarea
    setVoiceState("idle");
    setTranscript("");
    if (text) {
      sendMessage(text, "voice");
    }
  }, [input, sendMessage]);

  // ── Voice: discard ─────────────────────────────────────────────────────────
  const discardTranscript = useCallback(() => {
    setVoiceState("idle");
    setTranscript("");
    setInput("");
    setVoiceError("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ── Text input handlers (unchanged) ───────────────────────────────────────
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (voiceState === "preview") {
        confirmTranscript();
      } else {
        sendMessage();
      }
    }
  };

  const handleStarterClick = (text: string) => {
    setInput(text);
    sendMessage(text);
  };

  const toggleSidebar = () => setSidebarExpanded((e) => !e);

  const isRecording = voiceState === "recording";
  const isTranscribing = voiceState === "transcribing";
  const isPreview = voiceState === "preview";
  const voiceBusy = isRecording || isTranscribing;

  return (
    <main className="app-layout" id="main-content">
      {/* ── Left: Chat panel ── */}
      <section className="chat-panel">
        <header className="chat-header" id="chat-header">
          <div className="header-brand">
            <span className="brand-icon" aria-hidden="true">🔭</span>
            <div>
              <h1 className="brand-title">AI Business Observer</h1>
              <p className="brand-subtitle">Intelligent business discovery</p>
            </div>
          </div>
          {businessId && (
            <div className="business-badge" id="business-badge">
              Business #{businessId}
            </div>
          )}
          <button
            id="theme-toggle"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </header>

        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          onStarterClick={handleStarterClick}
        />

        {/* ── Voice preview card ── */}
        {isPreview && (
          <div className="voice-preview-card" role="status" aria-live="polite">
            <div className="voice-preview-header">
              <span className="voice-preview-icon" aria-hidden="true">🎤</span>
              <span className="voice-preview-label">You said:</span>
              <button
                id="voice-discard-button"
                className="voice-discard-btn"
                onClick={discardTranscript}
                aria-label="Discard transcript"
                title="Discard"
              >
                ✕
              </button>
            </div>
            <p className="voice-preview-text">&ldquo;{transcript}&rdquo;</p>
            <p className="voice-preview-hint">Edit below if needed, then send.</p>
          </div>
        )}

        {/* ── Voice error banner ── */}
        {voiceError && voiceState === "idle" && (
          <div className="voice-error-banner" role="alert">
            <span aria-hidden="true">⚠️</span> {voiceError}
            <button
              className="voice-error-dismiss"
              onClick={() => setVoiceError("")}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        <div className="input-area" id="input-area">

          {/* ── Recording status bar (replaces input while recording) ── */}
          {voiceBusy ? (
            <div className="voice-status-bar" aria-live="polite">
              {isRecording ? (
                <>
                  <span className="recording-dot" aria-hidden="true" />
                  <span className="recording-label">Recording…</span>
                  <span className="recording-timer" aria-label={`Recording time: ${formatSeconds(recordingSeconds)}`}>
                    {formatSeconds(recordingSeconds)}
                  </span>
                </>
              ) : (
                <>
                  <span className="transcribing-spinner" aria-hidden="true" />
                  <span className="recording-label">Transcribing…</span>
                </>
              )}
            </div>
          ) : (
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                id="chat-input"
                className="chat-input"
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  isPreview
                    ? "Edit transcript if needed…"
                    : "Describe a business, answer a question…"
                }
                rows={1}
                disabled={isLoading}
                aria-label="Chat input"
                inputMode="text"
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="on"
                spellCheck={true}
              />
            </div>
          )}

          {/* ── Mic button ── */}
          {!isPreview && (
            isRecording ? (
              <button
                id="voice-stop-button"
                className="mic-button recording"
                onClick={stopRecording}
                aria-label="Stop recording"
                title="Stop recording"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x={6} y={6} width={12} height={12} rx={2} />
                </svg>
              </button>
            ) : isTranscribing ? (
              <button
                id="voice-mic-button"
                className="mic-button"
                disabled
                aria-label="Transcribing…"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1={12} y1={19} x2={12} y2={23} />
                </svg>
              </button>
            ) : (
              <button
                id="voice-mic-button"
                className="mic-button"
                onClick={startRecording}
                disabled={isLoading}
                aria-label="Start voice input"
                title="Voice input"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1={12} y1={19} x2={12} y2={23} />
                </svg>
              </button>
            )
          )}

          {/* ── Send button ── */}
          {isPreview ? (
            <button
              id="voice-send-button"
              className="send-button"
              onClick={confirmTranscript}
              disabled={isLoading || !input.trim()}
              aria-label="Send voice message"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <line x1={22} y1={2} x2={11} y2={13} />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          ) : (
            <button
              id="send-button"
              className="send-button"
              onClick={() => sendMessage()}
              disabled={isLoading || voiceBusy || !input.trim()}
              aria-label="Send message"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <line x1={22} y1={2} x2={11} y2={13} />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </section>

      {/* ── Right: Progress sidebar ── */}
      <div
        className={`business-progress ${sidebarExpanded ? "expanded" : ""}`}
        id="business-progress-container"
      >
        <BusinessProgress
          businessContext={businessContext}
          missingFields={missingFields}
          onToggle={toggleSidebar}
          expanded={sidebarExpanded}
        />
      </div>
    </main>
  );
}
