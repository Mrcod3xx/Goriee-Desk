"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopilotAction,
  CopilotContextPayload,
  CopilotMessage,
  CopilotSession,
  MarketContextSnapshot,
  PaperContextSnapshot,
} from "@/types/copilot";
import { parseCopilotResponse } from "@/lib/copilot-prompt";
import { CopilotActionCard } from "@/components/copilot-action-card";

interface StrategyCopilotProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  interval: string;
  activeView: string;
  marketSnapshot?: MarketContextSnapshot;
  paperSnapshot?: PaperContextSnapshot;
  aiConfigured: boolean | null;
  aiModel: string | null;
  cooldownSeconds?: number;
  onSetCooldown?: (retryAt: number) => void;
  onLoadOrder: (action: any) => void;
  onRunBacktest: (action: any) => void;
  onSavePlaybook: (action: any) => void;
  onSelectMarket: (symbol: string) => void;
  onExportToJournal: (entry: { title: string; notes: string; symbol: string }) => void;
}

const STORAGE_KEY = "goriee_copilot_sessions_v1";

function renderMarkdown(content: string) {
  // Simple markdown formatting for bold, inline code, headers, bullets
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  lines.forEach((line, idx) => {
    let text = line.trimEnd();

    if (text.startsWith("### ")) {
      elements.push(<h4 key={idx} className="copilot-md-h3">{text.slice(4)}</h4>);
      return;
    }
    if (text.startsWith("## ")) {
      elements.push(<h3 key={idx} className="copilot-md-h2">{text.slice(3)}</h3>);
      return;
    }
    if (text.startsWith("# ")) {
      elements.push(<h2 key={idx} className="copilot-md-h1">{text.slice(2)}</h2>);
      return;
    }
    if (text.startsWith("- ") || text.startsWith("* ")) {
      elements.push(
        <div key={idx} className="copilot-md-bullet">
          <span className="bullet-dot">•</span>
          <span>{formatInlineMarkdown(text.slice(2))}</span>
        </div>
      );
      return;
    }
    if (/^\d+\.\s/.test(text)) {
      const match = text.match(/^(\d+)\.\s(.*)/);
      if (match) {
        elements.push(
          <div key={idx} className="copilot-md-numbered">
            <span className="num-prefix">{match[1]}.</span>
            <span>{formatInlineMarkdown(match[2])}</span>
          </div>
        );
        return;
      }
    }
    if (text === "") {
      elements.push(<div key={idx} className="copilot-md-space" />);
      return;
    }

    elements.push(<p key={idx} className="copilot-md-p">{formatInlineMarkdown(text)}</p>);
  });

  return elements;
}

function formatInlineMarkdown(text: string): React.ReactNode {
  // Replace **bold** and `code`
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function StrategyCopilot({
  isOpen,
  onClose,
  symbol,
  interval,
  activeView,
  marketSnapshot,
  paperSnapshot,
  aiConfigured,
  aiModel,
  cooldownSeconds,
  onSetCooldown,
  onLoadOrder,
  onRunBacktest,
  onSavePlaybook,
  onSelectMarket,
  onExportToJournal,
}: StrategyCopilotProps) {
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [showSessionsList, setShowSessionsList] = useState(false);

  // Context attachment toggles
  const [includeToken, setIncludeToken] = useState(true);
  const [includeTech, setIncludeTech] = useState(true);
  const [includePortfolio, setIncludePortfolio] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamTimerRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // Load sessions from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CopilotSession[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          return;
        }
      }
    } catch {
      // fallback
    }

    // Default first session
    const initialSession: CopilotSession = {
      id: "session_" + Date.now(),
      title: "Strategy Session: " + symbol,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      symbol,
      messages: [],
    };
    setSessions([initialSession]);
    setActiveSessionId(initialSession.id);
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
      } catch {
        // storage full
      }
    }
  }, [sessions]);

  // Focus textarea when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessions, streamBuffer, isStreaming]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const handleNewSession = () => {
    const newSession: CopilotSession = {
      id: "session_" + Date.now(),
      title: `Strategy Chat: ${symbol}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      symbol,
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setShowSessionsList(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      // Clear messages instead of deleting last session
      setSessions([
        {
          id: "session_" + Date.now(),
          title: `Strategy Chat: ${symbol}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          symbol,
          messages: [],
        },
      ]);
      return;
    }
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    if (activeSessionId === id) {
      setActiveSessionId(filtered[0].id);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputValue).trim();
    if (!query || isStreaming || (cooldownSeconds ?? 0) > 0) return;

    setInputValue("");

    const userMessage: CopilotMessage = {
      id: "msg_" + Date.now(),
      role: "user",
      content: query,
      timestamp: Date.now(),
      contextSnapshot: {
        symbol,
        interval,
        price: marketSnapshot?.price,
        activeView,
      },
    };

    const currentMessages = activeSession?.messages || [];
    const updatedMessages = [...currentMessages, userMessage];

    // Update session with user message
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              title: s.messages.length === 0 ? query.slice(0, 32) : s.title,
              updatedAt: Date.now(),
              messages: updatedMessages,
            }
          : s
      )
    );

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current);
    }
    setStreamElapsed(0);
    const streamStart = Date.now();
    streamTimerRef.current = window.setInterval(() => {
      setStreamElapsed((Date.now() - streamStart) / 1000);
    }, 100);

    setIsStreaming(true);
    setStreamBuffer("");

    const contextPayload: CopilotContextPayload = {
      symbol,
      interval,
      activeView,
      includeTokenContext: includeToken,
      includeTechnicalContext: includeTech,
      includePortfolioContext: includePortfolio,
      marketSnapshot,
      paperSnapshot,
    };

    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          context: contextPayload,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (typeof errorData.retryAt === "number" && onSetCooldown) {
          onSetCooldown(errorData.retryAt);
        }
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response stream received.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamBuffer(fullText);
      }

      // Parse finished response for action cards
      const { cleanContent, actions } = parseCopilotResponse(fullText);

      const assistantMessage: CopilotMessage = {
        id: "msg_" + Date.now(),
        role: "assistant",
        content: cleanContent || fullText,
        timestamp: Date.now(),
        actions: actions.length > 0 ? actions : undefined,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                updatedAt: Date.now(),
                messages: [...s.messages, assistantMessage],
              }
            : s
        )
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      const errorMessage: CopilotMessage = {
        id: "msg_" + Date.now(),
        role: "assistant",
        content: `⚠️ **Copilot Error:** ${errorMsg}\n\nPlease check AI router settings or try again.`,
        timestamp: Date.now(),
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                updatedAt: Date.now(),
                messages: [...s.messages, errorMessage],
              }
            : s
        )
      );
    } finally {
      if (streamTimerRef.current) {
        window.clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamBuffer("");
    }
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    setIsStreaming(false);

    if (streamBuffer.trim()) {
      const partialContent = streamBuffer.trim() + "\n\n*(Generation stopped by user)*";
      const { cleanContent, actions } = parseCopilotResponse(partialContent);
      const partialMessage: CopilotMessage = {
        id: "msg_" + Date.now(),
        role: "assistant",
        content: cleanContent || partialContent,
        timestamp: Date.now(),
        actions: actions.length > 0 ? actions : undefined,
      };
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession?.id
            ? {
                ...s,
                updatedAt: Date.now(),
                messages: [...s.messages, partialMessage],
              }
            : s
        )
      );
    }
    setStreamBuffer("");
  };

  const getThinkingStage = (elapsed: number) => {
    if (elapsed < 1.8) return "Reading market quote & order book depth";
    if (elapsed < 3.8) return "Evaluating technical confluence & regime";
    return "Synthesizing strategy thesis & actions";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((cooldownSeconds ?? 0) > 0 || isStreaming) return;
      void handleSendMessage();
    }
  };

  const handleActionExecute = (action: CopilotAction) => {
    if (action.type === "order") {
      onLoadOrder(action);
      onClose();
    } else if (action.type === "backtest") {
      onRunBacktest(action);
      onClose();
    } else if (action.type === "playbook") {
      onSavePlaybook(action);
      onClose();
    } else if (action.type === "market") {
      onSelectMarket(action.symbol);
    }
  };

  const handleExportJournal = (msg: CopilotMessage) => {
    onExportToJournal({
      title: `Copilot Insight: ${symbol} (${interval})`,
      notes: msg.content,
      symbol,
    });
  };

  if (!isOpen) return null;

  const starterChips = [
    `Assess breakout vs false break on ${symbol}`,
    `Calculate optimal Half-Kelly size for current risk`,
    `Stress-test open paper positions against 5% drop`,
    `Draft automated playbook rule for current volatility`,
  ];

  return (
    <>
      <div className="copilot-backdrop" onClick={onClose} />
      <aside className="copilot-drawer" role="dialog" aria-label="AI Strategy Copilot">
        {/* Drawer Header */}
        <div className="copilot-header">
          <div className="copilot-header-info">
            <div className="copilot-title-row">
              <span className="copilot-sparkle">✦</span>
              <h3 className="copilot-title">Strategy Copilot</h3>
              <span className="copilot-live-chip">Live Bitget</span>
            </div>
            <div className="copilot-session-bar">
              <button
                type="button"
                className="copilot-session-btn"
                onClick={() => setShowSessionsList(!showSessionsList)}
              >
                <span>{activeSession?.title || "Active Chat"}</span>
                <span className="dropdown-arrow">▾</span>
              </button>
              <button
                type="button"
                className="copilot-new-chat-btn"
                onClick={handleNewSession}
                title="New Strategy Chat"
              >
                + New
              </button>
            </div>
          </div>
          <button type="button" className="copilot-close-btn" onClick={onClose} aria-label="Close Copilot">
            ✕
          </button>
        </div>

        {/* Sessions Dropdown List */}
        {showSessionsList ? (
          <div className="copilot-sessions-popover">
            <div className="sessions-list-header">
              <span>Saved Conversations ({sessions.length})</span>
              <button type="button" className="new-chat-link" onClick={handleNewSession}>
                + New Chat
              </button>
            </div>
            <div className="sessions-list-items">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`session-item ${s.id === activeSessionId ? "is-active" : ""}`}
                  onClick={() => {
                    setActiveSessionId(s.id);
                    setShowSessionsList(false);
                  }}
                >
                  <div className="session-item-content">
                    <strong className="session-item-title">{s.title}</strong>
                    <span className="session-item-meta">
                      {s.messages.length} msgs · {s.symbol} · {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="session-delete-btn"
                    onClick={(e) => handleDeleteSession(s.id, e)}
                    title="Delete session"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Message Stream Area */}
        <div className="copilot-messages-container">
          {(!activeSession || activeSession.messages.length === 0) && !isStreaming ? (
            <div className="copilot-empty-state">
              <div className="empty-state-badge">✦ Quant Pair-Programmer</div>
              <h4 className="empty-state-heading">How can I assist your {symbol} strategy?</h4>
              <p className="empty-state-desc">
                Ask about current order flow, calculate Kelly position sizing, or test hypotheses against historical Bitget candles.
              </p>

              <div className="starter-chips-group">
                <span className="starter-chips-label">Quick Strategy Starters:</span>
                {starterChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="starter-chip"
                    onClick={() => handleSendMessage(chip)}
                  >
                    {chip} →
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeSession?.messages.map((msg) => (
            <div
              key={msg.id}
              className={`copilot-message-bubble ${msg.role === "user" ? "is-user" : "is-assistant"}`}
            >
              {msg.role === "assistant" ? (
                <div className="assistant-header-strip">
                  <span className="copilot-avatar">✦</span>
                  <span className="copilot-name">Copilot</span>
                  {aiModel ? <span className="copilot-model-tag">{aiModel}</span> : null}
                  <button
                    type="button"
                    className="copilot-journal-export-btn"
                    onClick={() => handleExportJournal(msg)}
                    title="Export insight to Trade Journal"
                  >
                    Save to Journal
                  </button>
                </div>
              ) : null}

              <div className="message-content-body">{renderMarkdown(msg.content)}</div>

              {msg.actions && msg.actions.length > 0 ? (
                <div className="copilot-actions-wrapper">
                  {msg.actions.map((action, aIdx) => (
                    <CopilotActionCard
                      key={aIdx}
                      action={action}
                      onExecute={handleActionExecute}
                    />
                  ))}
                </div>
              ) : null}

              <span className="message-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}

          {isStreaming ? (
            <div className="copilot-message-bubble is-assistant is-streaming">
              <div className="assistant-header-strip is-streaming-header">
                <div className="header-left-meta">
                  <span className="copilot-avatar">✦</span>
                  <span className="copilot-name">Copilot</span>
                  {aiModel ? <span className="copilot-model-tag">{aiModel}</span> : null}
                  <span className="copilot-elapsed-badge">{streamElapsed.toFixed(1)}s</span>
                </div>
                <button
                  type="button"
                  className="copilot-stop-strip-btn"
                  onClick={handleStopStreaming}
                  title="Stop Copilot response generation"
                  aria-label="Stop generation"
                >
                  <span className="stop-square" />
                  <span>Stop</span>
                </button>
              </div>
              <div className="message-content-body">
                {!streamBuffer ? (
                  <div className="copilot-thinking-state" role="status" aria-live="polite">
                    <div className="thinking-stage-row">
                      <span className="thinking-beacon">
                        <span className="thinking-pulse-ring" />
                        <span className="thinking-pulse-dot" />
                      </span>
                      <span className="thinking-stage-text">
                        {getThinkingStage(streamElapsed)}
                      </span>
                      <span className="thinking-dots-anim" aria-hidden="true">
                        <span className="dot dot-1">.</span>
                        <span className="dot dot-2">.</span>
                        <span className="dot dot-3">.</span>
                      </span>
                    </div>

                    <div className="thinking-shimmer-wave" aria-hidden="true">
                      <div className="shimmer-bar bar-1" />
                      <div className="shimmer-bar bar-2" />
                      <div className="shimmer-bar bar-3" />
                    </div>
                  </div>
                ) : (
                  <div className="copilot-streaming-text">
                    {renderMarkdown(streamBuffer)}
                    <span className="stream-cursor" />
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        {/* Live Context Toggle Pills */}
        <div className="copilot-context-pills-bar">
          <span className="pills-label">Live Context:</span>
          <button
            type="button"
            className={`context-pill ${includeToken ? "is-active" : ""}`}
            onClick={() => setIncludeToken(!includeToken)}
            title="Toggle token spot price snapshot"
          >
            <span className="pill-dot" />
            <span>{symbol} {marketSnapshot?.price ? `$${marketSnapshot.price.toLocaleString()}` : ""}</span>
          </button>

          <button
            type="button"
            className={`context-pill ${includeTech ? "is-active" : ""}`}
            onClick={() => setIncludeTech(!includeTech)}
            title="Toggle technical indicators snapshot"
          >
            <span className="pill-dot" />
            <span>Regime: {marketSnapshot?.rsi ? `RSI ${marketSnapshot.rsi.toFixed(0)}` : "Indicators"}</span>
          </button>

          <button
            type="button"
            className={`context-pill ${includePortfolio ? "is-active" : ""}`}
            onClick={() => setIncludePortfolio(!includePortfolio)}
            title="Toggle paper account portfolio balance"
          >
            <span className="pill-dot" />
            <span>Paper: {paperSnapshot?.equity ? `$${Math.round(paperSnapshot.equity).toLocaleString()}` : "Portfolio"}</span>
          </button>
        </div>

        {/* Prompt Input Box */}
        <div className="copilot-input-area">
          <textarea
            ref={inputRef}
            className="copilot-textarea"
            rows={2}
            placeholder={`Ask Copilot about ${symbol} setup, backtesting, or risk... (Enter to send)`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              type="button"
              className="copilot-send-button copilot-stop-btn button button-danger"
              onClick={handleStopStreaming}
              title="Stop Copilot generation"
              aria-label="Stop generation"
            >
              <span className="stop-square" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              className="copilot-send-button button button-primary"
              disabled={!inputValue.trim() || aiConfigured === false || (cooldownSeconds ?? 0) > 0}
              onClick={() => void handleSendMessage()}
              title={(cooldownSeconds ?? 0) > 0 ? `Provider cooldown active (${cooldownSeconds}s)` : "Send message to Copilot"}
            >
              <span>{(cooldownSeconds ?? 0) > 0 ? `${cooldownSeconds}s` : "Send ↵"}</span>
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
