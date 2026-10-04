"use client";

import { useEffect, useRef } from "react";

interface DemoNoticeModalProps {
  isOpen: boolean;
  onContinue: () => void;
}

export function DemoNoticeModal({ isOpen, onContinue }: DemoNoticeModalProps) {
  const continueBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus the continue button for accessibility and quick keyboard navigation
      continueBtnRef.current?.focus();

      // Prevent escape key from closing before acknowledgment
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      window.addEventListener("keydown", handleKeyDown, true);
      return () => {
        window.removeEventListener("keydown", handleKeyDown, true);
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop demo-notice-backdrop"
      role="presentation"
      // Intentionally no backdrop click handler: user must click "I Understand, Continue"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <section
        className="order-modal demo-notice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-notice-title"
        aria-describedby="demo-notice-desc"
      >
        <div className="demo-notice-header">
          <div className="demo-notice-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Demo Notice · Important</span>
          </div>
          <h2 id="demo-notice-title">Welcome to Goriee AI Desk</h2>
          <p id="demo-notice-desc">
            Please review this operational overview before exploring the desk.
          </p>
        </div>

        <div className="demo-notice-content">
          <div className="demo-notice-card">
            <div className="demo-notice-card-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="demo-notice-card-text">
              <strong>Locally Developed Demo App</strong>
              <p>
                This application was locally developed by the owner as a personal quantitative trading desk.
                This hosted web deployment is strictly a demo preview.
              </p>
            </div>
          </div>

          <div className="demo-notice-card">
            <div className="demo-notice-card-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="demo-notice-card-text">
              <strong>Run Locally to Unlock Full Potential</strong>
              <p>
                The app must be run locally on your own machine to unlock its full potential. Running locally eliminates cloud timeouts, ensures 100% data privacy, and supports zero-cost offline local inference via Ollama (e.g. DeepSeek R1).
              </p>
            </div>
          </div>

          <div className="demo-notice-card">
            <div className="demo-notice-card-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </div>
            <div className="demo-notice-card-text">
              <strong>Use Your Own AI Provider for Accurate Readings</strong>
              <p>
                For deeper reasoning and more accurate market readings, users should configure their own AI provider (OpenRouter, NVIDIA NIM, OpenAI, Anthropic, or custom routers) in the Settings tab.
              </p>
            </div>
          </div>

          <div className="demo-notice-card highlight-card">
            <div className="demo-notice-card-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="demo-notice-card-text">
              <strong>Unrestricted Access with Your Own Key</strong>
              <p>
                The shared demo has restrictions in place due to limited owner funding. Connecting your own provider removes these limitations so you can analyze markets without unnecessary constraints.
              </p>
            </div>
          </div>
        </div>

        <div className="demo-notice-footer">
          <button
            ref={continueBtnRef}
            type="button"
            className="button button-primary demo-notice-continue-btn"
            id="demo-notice-continue-btn"
            onClick={onContinue}
          >
            <span>I Understand, Continue</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
          <p className="demo-notice-footnote">
            Acknowledgment is required to access the desk. No live trading orders are ever executed.
          </p>
        </div>
      </section>
    </div>
  );
}
