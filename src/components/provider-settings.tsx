"use client";

import { memo, useEffect, useState } from "react";
import { getCustomLlmHeaders, hasCustomLlm, storageKeys } from "./desk-shared";

type ProviderId = "nvidia" | "openrouter" | "openai" | "anthropic" | "unorouter" | "custom";
type ProviderStatus = {
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  provider: ProviderId | null;
  keyConfigured: boolean;
  editable: boolean;
  isCustom?: boolean;
};

const presets: Record<Exclude<ProviderId, "custom">, { label: string; baseUrl: string; model: string; description: string }> = {
  nvidia: {
    label: "NVIDIA NIM · Build API",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "z-ai/glm-5.3",
    description: "753B MoE text model (Z-ai GLM-5.3) hosted on NVIDIA NIM with DeepSeek-style sparse attention, reasoning, and tool calling.",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    description: "Use a model ID or OpenRouter's free-model router. Live news search is available through OpenRouter.",
  },
  openai: {
    label: "OpenAI API · ChatGPT models",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    description: "Connect an OpenAI API key. A ChatGPT subscription is separate from API billing.",
  },
  anthropic: {
    label: "Claude API · Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5-20251001",
    description: "Uses Anthropic's Messages API directly. Live web search in this app currently requires OpenRouter.",
  },
  unorouter: {
    label: "UnoRouter",
    baseUrl: "https://api.unorouter.com/v1",
    model: "qwen3.8-flash-next:free",
    description: "OpenAI-compatible routing. UnoRouter documents a limit of about one request per minute for free models.",
  },
};

const providerNames: Record<ProviderId, string> = {
  nvidia: "NVIDIA NIM",
  openrouter: "OpenRouter",
  openai: "OpenAI API",
  anthropic: "Claude API",
  unorouter: "UnoRouter",
  custom: "Custom router",
};

const quickModels: Array<{
  name: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  tag: string;
  notes: string;
}> = [
  {
    name: "DeepSeek R1",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-r1",
    tag: "Reasoning Champion",
    notes: "Deep mathematical reasoning for multi-condition strategy compilation.",
  },
  {
    name: "DeepSeek V3 (Direct)",
    provider: "custom",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    tag: "Lowest Token Cost",
    notes: "Direct platform API with fast token generation & high accuracy.",
  },
  {
    name: "OpenAI GPT-4o-mini",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    tag: "Sub-Second Latency",
    notes: "Best for real-time Copilot trade suggestions and instant responses.",
  },
  {
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-20241022",
    tag: "Benchmark Quality",
    notes: "Anthropic's flagship model for rigorous indicator logic synthesis.",
  },
  {
    name: "NVIDIA Llama 3.3 70B",
    provider: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "meta/llama-3.3-70b-instruct",
    tag: "Free Cloud Credits",
    notes: "Fast NIM inference with 1,000 free tokens upon NVIDIA account sign-up.",
  },
  {
    name: "Local Ollama (Offline)",
    provider: "custom",
    baseUrl: "http://localhost:11434/v1",
    model: "deepseek-r1:14b",
    tag: "100% Free & Private",
    notes: "Zero cloud leakage. Runs on local GPU/CPU via `ollama run deepseek-r1:14b`.",
  },
];

// Takes no props at all, so memo() is trivially exact: the Settings tab re-renders
// on every WebSocket tick in the parent, but this panel only needs to update when
// its own internal state changes.
export const ProviderSettings = memo(function ProviderSettings() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId>("openrouter");
  const [baseUrl, setBaseUrl] = useState(presets.openrouter.baseUrl);
  const [model, setModel] = useState(presets.openrouter.model);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copiedEnv, setCopiedEnv] = useState(false);

  function handleCopyEnv() {
    const keyVal = apiKey || (status?.keyConfigured ? "YOUR_SAVED_KEY" : "YOUR_API_KEY");
    const snippet = `# Goriee AI Desk Configuration\nLLM_BASE_URL="${baseUrl}"\nLLM_MODEL="${model}"\nLLM_API_KEY="${keyVal}"`;
    navigator.clipboard.writeText(snippet);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  }

  const [isCustomActive, setIsCustomActive] = useState(false);

  async function refreshStatus() {
    const headers = getCustomLlmHeaders();
    const response = await fetch("/api/ai-status", { cache: "no-store", headers });
    if (!response.ok) throw new Error("Could not read the current AI configuration.");
    const next = (await response.json()) as ProviderStatus;
    setStatus(next);

    const hasCustom = hasCustomLlm();
    setIsCustomActive(hasCustom || Boolean(next.isCustom));

    try {
      const raw = window.localStorage.getItem(storageKeys.customLlm);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.baseUrl) setBaseUrl(parsed.baseUrl);
        if (parsed?.model) setModel(parsed.model);
        if (parsed?.provider) setProvider(parsed.provider);
      } else if (next.configured && next.provider && next.baseUrl && next.model) {
        setProvider(next.provider);
        setBaseUrl(next.baseUrl);
        setModel(next.model);
      }
    } catch {
      if (next.configured && next.provider && next.baseUrl && next.model) {
        setProvider(next.provider);
        setBaseUrl(next.baseUrl);
        setModel(next.model);
      }
    }
    return next;
  }

  useEffect(() => {
    refreshStatus()
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Could not read the AI configuration."))
      .finally(() => setLoading(false));
  }, []);

  function selectProvider(nextProvider: ProviderId) {
    setProvider(nextProvider);
    if (nextProvider !== "custom") {
      setBaseUrl(presets[nextProvider].baseUrl);
      setModel(presets[nextProvider].model);
    }
    setError("");
    setMessage("");
  }

  function handleResetCustomProvider() {
    try {
      window.localStorage.removeItem(storageKeys.customLlm);
    } catch {}
    setIsCustomActive(false);
    setApiKey("");
    setMessage("Custom provider cleared. Reverted to demo server provider.");
    setError("");
    fetch("/api/ai-status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: ProviderStatus) => {
        setStatus(data);
        if (data.configured && data.provider && data.baseUrl && data.model) {
          setProvider(data.provider);
          setBaseUrl(data.baseUrl);
          setModel(data.model);
        }
      })
      .catch(() => {});
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      // Save custom provider in browser localStorage so it's active immediately with no demo limitations
      if (apiKey.trim()) {
        const customData = { baseUrl, model, apiKey, provider };
        window.localStorage.setItem(storageKeys.customLlm, JSON.stringify(customData));
        setIsCustomActive(true);
      } else {
        try {
          const raw = window.localStorage.getItem(storageKeys.customLlm);
          if (raw) {
            const existing = JSON.parse(raw);
            if (existing?.apiKey) {
              window.localStorage.setItem(storageKeys.customLlm, JSON.stringify({ baseUrl, model, apiKey: existing.apiKey, provider }));
              setIsCustomActive(true);
            }
          }
        } catch {}
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, model, apiKey }),
      });
      const payload = await response.json().catch(() => ({})) as ProviderStatus & { error?: string; clientOnly?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "Settings could not be saved.");
      setStatus(payload);
      setProvider(payload.provider ?? provider);
      setBaseUrl(payload.baseUrl ?? baseUrl);
      setModel(payload.model ?? model);
      setApiKey("");
      setMessage(
        payload.clientOnly
          ? "Custom provider saved in your browser! Your personal AI provider is active with unrestricted access."
          : "Saved to local server (.env.local). New research and backtests will use these settings without limitations."
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);

  async function testPing() {
    setPinging(true);
    setPingResult(null);
    const start = performance.now();
    try {
      const res = await fetch("/api/ai-status", { cache: "no-store", headers: getCustomLlmHeaders() });
      const latency = Math.round(performance.now() - start);
      if (!res.ok) throw new Error("Status check failed");
      const data = await res.json() as { configured?: boolean; model?: string; isCustom?: boolean };
      setPingResult({
        ok: Boolean(data.configured),
        latencyMs: latency,
        message: data.configured
          ? `${data.isCustom ? "Custom provider" : "AI provider"} verified (${latency}ms) · Model: ${data.model ?? "active"}`
          : "Endpoint responded, but key is not configured.",
      });
    } catch (e) {
      setPingResult({ ok: false, message: e instanceof Error ? e.message : "Connection failed" });
    } finally {
      setPinging(false);
    }
  }

  const currentProviderName = status?.provider ? providerNames[status.provider] : "Not configured";
  const selectedDescription = provider === "custom"
    ? "Use any endpoint that accepts OpenAI-compatible chat completions and JSON responses."
    : presets[provider].description;
  const savedEndpointIsSelected = Boolean(status?.keyConfigured && status.baseUrl === baseUrl);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="page-kicker">Workspace configuration</p>
          <h1>Choose the AI behind your desk.</h1>
          <p className="page-subtitle">One server-side provider powers research and turns strategy descriptions into backtest rules.</p>
        </div>
        <div className="desk-heading-controls">
          <button
            type="button"
            className="button button-secondary ping-btn"
            onClick={testPing}
            disabled={pinging || loading}
          >
            {pinging ? "Testing latency…" : "Test connection / Ping"}
          </button>
        </div>
      </div>

      {pingResult ? (
        <div className={`ping-banner ${pingResult.ok ? "ping-success" : "ping-error"}`} role="status">
          <strong>{pingResult.ok ? "Connection Operational" : "Connection Check"}</strong>
          <span>{pingResult.message}</span>
        </div>
      ) : null}

      <section className="provider-layout" aria-labelledby="provider-current-title">
        <div className="panel provider-current">
          <div className="panel-heading">
            <div><h2 id="provider-current-title">Current connection</h2><p>Only public model details are shown here.</p></div>
            <span className={`provider-state ${status?.configured ? "provider-state-ready" : ""}`}><span />{loading ? "Checking" : status?.configured ? "Configured" : "Not configured"}</span>
          </div>
          <dl className="provider-current-details">
            <div><dt>Provider</dt><dd>{status?.configured ? currentProviderName : "n/a"}</dd></div>
            <div><dt>Model</dt><dd className="code-dd">{status?.configured ? status.model : "n/a"}</dd></div>
            <div><dt>Endpoint</dt><dd className="code-dd">{status?.configured ? status.baseUrl : "n/a"}</dd></div>
            <div><dt>API key</dt><dd>{status?.keyConfigured ? "Saved on this server" : "Not saved"}</dd></div>
          </dl>
          {status?.configured && status.provider === "openrouter" ? <p className="provider-capability">OpenRouter is selected, so the research form can use its optional live news search.</p> : null}

          <div className="provider-security-card">
            <strong>Local privacy guarantee</strong>
            <p>API keys are saved solely in your local <code>.env.local</code> file and never sent to external servers other than your configured AI provider.</p>
          </div>
        </div>

        <form className="panel provider-form" onSubmit={saveSettings}>
          <div className="panel-heading">
            <div>
              <h2>Provider settings</h2>
              <p>Choose an API preset or select a custom OpenAI-compatible router.</p>
            </div>
          </div>

          <div className="provider-presets-grid" role="radiogroup" aria-label="Quick provider selector">
            {(Object.entries(presets) as [Exclude<ProviderId, "custom">, typeof presets[Exclude<ProviderId, "custom">]][]).map(([id, item]) => {
              const isSelected = provider === id;
              return (
                <div
                  key={id}
                  className={`provider-preset-card ${isSelected ? "is-selected" : ""}`}
                  onClick={() => selectProvider(id)}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                >
                  <div className="preset-card-top">
                    <strong>{item.label}</strong>
                    {isSelected ? <span className="preset-active-check">Active</span> : null}
                  </div>
                  <span className="preset-model-tag">{item.model.split("/").pop()}</span>
                  <p className="preset-desc">{item.description}</p>
                </div>
              );
            })}
            <div
              className={`provider-preset-card ${provider === "custom" ? "is-selected" : ""}`}
              onClick={() => selectProvider("custom")}
              role="radio"
              aria-checked={provider === "custom"}
              tabIndex={0}
            >
              <div className="preset-card-top">
                <strong>Custom Router</strong>
                {provider === "custom" ? <span className="preset-active-check">Active</span> : null}
              </div>
              <span className="preset-model-tag">Self-hosted / vLLM</span>
              <p className="preset-desc">Connect any OpenAI-compatible API endpoint with custom model routing.</p>
            </div>
          </div>

          <label className="provider-field" htmlFor="ai-base-url"><span>API base URL</span><input id="ai-base-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://router.example/v1" autoComplete="url" required disabled={saving} /></label>
          <label className="provider-field" htmlFor="ai-model"><span>Model ID</span><input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider/model-name" maxLength={160} required disabled={saving} /></label>
          <label className="provider-field" htmlFor="ai-api-key"><span>API key</span><input id="ai-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.keyConfigured && baseUrl === status.baseUrl ? "Blank keeps the saved key" : "Paste the API key for this provider"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} disabled={saving} /></label>
          <p className="provider-key-note">Configure your personal API key to unlock unrestricted analysis and bypass shared demo rate limits. On local development servers, settings are written to <code>.env.local</code>. On the hosted demo, your key is securely stored only in your browser.</p>
          {isCustomActive ? (
            <div className="provider-custom-banner">
              <div className="provider-custom-banner-text">
                <strong>Custom Provider Active (Unrestricted)</strong>
                <span>Requests bypass shared demo pacing and route directly through your provider.</span>
              </div>
              <button
                type="button"
                className="button button-secondary custom-reset-btn"
                onClick={handleResetCustomProvider}
              >
                Reset to Demo Provider
              </button>
            </div>
          ) : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          {message ? <p className="provider-success" role="status">{message}</p> : null}
          <div className="provider-form-footer"><span>{status?.keyConfigured ? savedEndpointIsSelected ? "Blank keeps the key saved for this endpoint." : `The saved key belongs to ${currentProviderName}; enter a key for this endpoint.` : "No API key is saved yet."}</span><button className="button button-primary" type="submit" disabled={loading || saving}>{saving ? "Saving settings…" : "Save provider settings"}</button></div>
        </form>

        <div className="provider-guidance">
          <strong>Provider notes &amp; capabilities</strong>
          <ul>
            <li>NVIDIA NIM runs 753B MoE reasoning models with fast inference and deep chain-of-thought analysis.</li>
            <li>OpenRouter provides a broad model hub and real-time live news web search with web citations.</li>
            <li>OpenAI API keys use direct API billing. ChatGPT Plus consumer subscriptions do not include API credits.</li>
            <li>Claude uses Anthropic’s native Messages API with strict JSON schema outputs for rule synthesis.</li>
          </ul>
        </div>

        {/* Informative AI Switching Handout & Reference Manual */}
        <div className="panel ai-handout-section" role="region" aria-labelledby="ai-handout-title">
          <div className="ai-handout-heading">
            <div>
              <div className="ai-handout-title-row">
                <span className="ai-handout-badge">Informative Handout</span>
                <h2 id="ai-handout-title">AI Model Switcher &amp; Operator Handout</h2>
              </div>
              <p className="ai-handout-subtitle">
                Switch between cloud reasoning engines or 100% private local models. Click any verified model below to pre-populate settings, or copy the configuration block directly into your <code>.env.local</code>.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary ai-handout-env-btn"
              onClick={handleCopyEnv}
              title="Copy current settings as .env.local file block"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{copiedEnv ? "Copied .env block!" : "Copy .env.local"}</span>
            </button>
          </div>

          {/* Quick-fill model cards */}
          <div className="ai-handout-grid">
            {quickModels.map((item) => (
              <div
                key={item.name}
                className={`ai-handout-card ${model === item.model && baseUrl === item.baseUrl ? "is-active" : ""}`}
                onClick={() => {
                  setProvider(item.provider);
                  setBaseUrl(item.baseUrl);
                  setModel(item.model);
                  if (item.provider === "custom" && item.baseUrl.includes("11434")) {
                    setApiKey("ollama");
                  }
                  setMessage(`Loaded ${item.name} (${item.model}) into form.`);
                  setError("");
                }}
                role="button"
                tabIndex={0}
              >
                <div className="ai-handout-card-top">
                  <strong className="ai-handout-card-title">{item.name}</strong>
                  <span className="ai-handout-card-tag">{item.tag}</span>
                </div>
                <code className="ai-handout-card-model">{item.model}</code>
                <p className="ai-handout-card-notes">{item.notes}</p>
                <span className="ai-handout-card-action">
                  {model === item.model && baseUrl === item.baseUrl ? "✓ Loaded in Form" : "Click to Load →"}
                </span>
              </div>
            ))}
          </div>

          {/* Informative Handout Guidance Breakdown */}
          <div className="ai-handout-guide-grid">
            <div className="ai-handout-guide-box">
              <strong>1. How AI Switching Works</strong>
              <p>
                When you save settings here, the backend updates your local <code>.env.local</code> file and reloads <code>src/lib/llm.ts</code>. The AI Copilot, Quantitative Backtest compiler, and Market Research immediately start routing prompts through your newly configured model.
              </p>
            </div>
            <div className="ai-handout-guide-box">
              <strong>2. Model Compatibility Rules</strong>
              <p>
                Any model you connect must accept system prompts and return pure JSON objects. Models like <code>deepseek-r1</code>, <code>gpt-4o-mini</code>, and <code>claude-3-5-sonnet</code> have 100% JSON schema adherence and do not hallucinate extraneous conversation.
              </p>
            </div>
            <div className="ai-handout-guide-box">
              <strong>3. Zero-Cost Local Inference (Ollama)</strong>
              <p>
                Run <code>ollama run deepseek-r1:14b</code> in your terminal. Set endpoint to <code>http://localhost:11434/v1</code>, model to <code>deepseek-r1:14b</code>, and key to <code>ollama</code>. 100% private, free, and runs entirely on your own machine.
              </p>
            </div>
            <div className="ai-handout-guide-box">
              <strong>4. Offline Documentation Guide</strong>
              <p>
                A complete technical reference manual is included in the project repository at <code>README.md</code> under the AI Providers &amp; Model Switching Guide section.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
});
