"use client";

import React, { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";

export interface SelectionOption {
  id: string;
  label: string;
  description?: string;
}

export interface PendingSelectionData {
  type: string;
  question: string;
  options: SelectionOption[];
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  suggestedOptions?: string[];
  /** Structured disambiguation selection (multi-business match, etc.) */
  pendingSelection?: PendingSelectionData;
}

interface Props {
  messages: Message[];
  isLoading?: boolean;
  onStarterClick?: (text: string) => void;
  onSelectionClick?: (optionLabel: string) => void;
}

const STARTER_PROMPTS = [
  { icon: "🏭", text: "We distribute electrical components to contractors" },
  { icon: "🍕", text: "A restaurant chain with 12 locations managing orders" },
  { icon: "🤖", text: "Which businesses have high automation potential?" },
  { icon: "📦", text: "A warehouse doing manual inventory tracking daily" },
];

export function ChatWindow({ messages, isLoading, onStarterClick, onSelectionClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Show starter chips when no user messages have been sent yet
  const hasUserMessages = messages.some((m) => m.role === "user");
  const showStarters = !hasUserMessages;

  return (
    <div className="chat-window" id="chat-window" role="log" aria-live="polite" aria-label="Chat messages">

      {messages.map((msg, index) => (
        <React.Fragment key={msg.id}>
          <ChatMessage
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
          />

          {/* ── Suggested answer chips (short options) ── */}
          {msg.suggestedOptions && msg.suggestedOptions.length > 0 && index === messages.length - 1 && !isLoading && (
            <div className="suggested-options" role="list" aria-label="Suggested answers">
              {msg.suggestedOptions.map((opt) => (
                <button
                  key={opt}
                  className="suggested-option-chip"
                  role="listitem"
                  onClick={() => onStarterClick?.(opt)}
                  aria-label={`Select option: ${opt}`}
                >
                  <span>{opt}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Pending selection card (business disambiguation) ── */}
          {msg.pendingSelection && index === messages.length - 1 && !isLoading && (
            <div className="selection-card" role="group" aria-label={msg.pendingSelection.question}>
              <p className="selection-card-hint">Choose one, or type your answer below:</p>
              <div className="selection-options">
                {msg.pendingSelection.options.map((opt) => (
                  <button
                    key={opt.id}
                    id={`selection-option-${opt.id}`}
                    className="selection-option-btn"
                    onClick={() => (onSelectionClick ?? onStarterClick)?.(opt.label)}
                    aria-label={`Select: ${opt.label}`}
                  >
                    <span className="selection-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="selection-option-desc">{opt.description}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </React.Fragment>
      ))}

      {showStarters && (
        <div className="starter-chips" role="list" aria-label="Conversation starters">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt.text}
              className="starter-chip"
              role="listitem"
              onClick={() => onStarterClick?.(prompt.text)}
              aria-label={`Start with: ${prompt.text}`}
            >
              <span className="starter-chip-icon" aria-hidden="true">{prompt.icon}</span>
              <span>{prompt.text}</span>
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="chat-message assistant" aria-label="Assistant is typing">
          <div className="message-bubble">
            <div className="assistant-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx={12} cy={12} r={10} />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1={9} y1={9} x2={9.01} y2={9} />
                <line x1={15} y1={9} x2={15.01} y2={9} />
              </svg>
            </div>
            <div className="typing-indicator" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
