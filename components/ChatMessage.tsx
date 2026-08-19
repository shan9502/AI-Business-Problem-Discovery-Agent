"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
          {isUser ? (
            // User messages: plain text, no markdown needed
            <p>{content}</p>
          ) : (
            // Assistant messages: full Markdown rendering
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Headings
                  h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
                  h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
                  h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
                  // Paragraphs
                  p: ({ children }) => <p className="md-p">{children}</p>,
                  // Lists
                  ul: ({ children }) => <ul className="md-ul">{children}</ul>,
                  ol: ({ children }) => <ol className="md-ol">{children}</ol>,
                  li: ({ children }) => <li className="md-li">{children}</li>,
                  // Bold / Italic
                  strong: ({ children }) => <strong className="md-strong">{children}</strong>,
                  em: ({ children }) => <em className="md-em">{children}</em>,
                  // Code (inline and block)
                  code: ({ children, className }) => {
                    const isBlock = className?.startsWith("language-");
                    return isBlock ? (
                      <pre className="md-pre"><code className={`md-code-block ${className ?? ""}`}>{children}</code></pre>
                    ) : (
                      <code className="md-code-inline">{children}</code>
                    );
                  },
                  pre: ({ children }) => <>{children}</>,
                  // Tables (GFM)
                  table: ({ children }) => (
                    <div className="md-table-wrapper">
                      <table className="md-table">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="md-thead">{children}</thead>,
                  tbody: ({ children }) => <tbody>{children}</tbody>,
                  tr: ({ children }) => <tr className="md-tr">{children}</tr>,
                  th: ({ children }) => <th className="md-th">{children}</th>,
                  td: ({ children }) => <td className="md-td">{children}</td>,
                  // Blockquote
                  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
                  // Horizontal rule
                  hr: () => <hr className="md-hr" />,
                  // Links
                  a: ({ href, children }) => (
                    <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}
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
