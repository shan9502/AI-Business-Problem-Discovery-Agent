"use client";

import React, { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Props {
  messages: Message[];
  isLoading?: boolean;
}

export function ChatWindow({ messages, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="chat-window" id="chat-window">
      {messages.length === 0 && (
        <div className="welcome-state">
          <div className="welcome-icon">🔍</div>
          <h2>AI Business Observer</h2>
          <p>
            Start by describing a business or process you want to analyze.
            <br />
            I&apos;ll help you gather structured insights through conversation.
          </p>
          <div className="starter-hints">
            <span>Try: &quot;We distribute electrical components to contractors&quot;</span>
            <span>Or: &quot;Which companies have high automation potential?&quot;</span>
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          role={msg.role}
          content={msg.content}
          timestamp={msg.timestamp}
        />
      ))}

      {isLoading && (
        <div className="chat-message assistant">
          <div className="message-bubble">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
