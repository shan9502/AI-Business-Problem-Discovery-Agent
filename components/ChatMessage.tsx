"use client";

import React from "react";

interface Props {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

export function ChatMessage({ role, content, timestamp }: Props) {
  const isUser = role === "user";

  return (
    <div className={`chat-message ${isUser ? "user" : "assistant"}`}>
      <div className="message-bubble">
        {!isUser && (
          <div className="assistant-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx={12} cy={12} r={10} />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1={9} y1={9} x2={9.01} y2={9} />
              <line x1={15} y1={9} x2={15.01} y2={9} />
            </svg>
          </div>
        )}
        <div className="bubble-content">
          {content.split("\n").map((line, i) => {
            // Render *text* as emphasis
            const parts = line.split(/(\*[^*]+\*)/g);
            return (
              <p key={i}>
                {parts.map((part, j) =>
                  part.startsWith("*") && part.endsWith("*") ? (
                    <em key={j} className="hint-text">
                      {part.slice(1, -1)}
                    </em>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
              </p>
            );
          })}
          {timestamp && (
            <span className="timestamp" suppressHydrationWarning>
              {timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
