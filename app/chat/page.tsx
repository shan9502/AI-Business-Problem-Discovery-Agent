"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { ChatWindow, type Message } from "@/components/ChatWindow";
import { BusinessProgress } from "@/components/BusinessProgress";

const INITIAL_MESSAGE: Message = {
  id: "init",
  role: "assistant",
  content:
    "Hello! I'm your AI Business Problem Discovery Engine. Tell me about a business, workflow, or recurring process you're analyzing. My goal is to help you uncover, qualify, and validate valuable business problems and automation opportunities.\n\nWhere would you like to start?",
  timestamp: new Date(0), // placeholder; replaced client-side in useEffect
};

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
  const [askedFields, setAskedFields] = useState<string[]>([]);     // #10
  const [skippedFields, setSkippedFields] = useState<string[]>([]); // #10
  const [problemSignals, setProblemSignals] = useState<string[]>([]);
  const [automationSignals, setAutomationSignals] = useState<string[]>([]);
  const [integrationSignals, setIntegrationSignals] = useState<string[]>([]);
  const [aiSignals, setAiSignals] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [opportunityAssessment, setOpportunityAssessment] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Set initial message timestamp client-side to avoid SSR hydration mismatch
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === "init" ? { ...m, timestamp: new Date() } : m
      )
    );
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
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
          opportunityAssessment
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
    } catch (err) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, conversationId, businessId, askedFields, skippedFields]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <main className="app-layout" id="main-content">
      {/* ── Left: Chat panel ── */}
      <section className="chat-panel">
        <header className="chat-header" id="chat-header">
          <div className="header-brand">
            <span className="brand-icon">🔭</span>
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
        </header>

        <ChatWindow messages={messages} isLoading={isLoading} />

        <div className="input-area" id="input-area">
          <textarea
            ref={inputRef}
            id="chat-input"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a business, answer a question, or ask something…"
            rows={2}
            disabled={isLoading}
            aria-label="Chat input"
          />
          <button
            id="send-button"
            className="send-button"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
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
        </div>
      </section>

      {/* ── Right: Progress sidebar ── */}
      <BusinessProgress
        businessContext={businessContext}
        missingFields={missingFields}
      />
    </main>
  );
}
