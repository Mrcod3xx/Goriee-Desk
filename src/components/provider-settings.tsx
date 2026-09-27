"use client";

import { useEffect, useState } from "react";

type ProviderId = "nvidia" | "openrouter" | "openai" | "anthropic" | "unorouter" | "custom";
type ProviderStatus = {
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  provider: ProviderId | null;
  keyConfigured: boolean;
  editable: boolean;
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

export function ProviderSettings() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId>("openrouter");
  const [baseUrl, setBaseUrl] = useState(presets.openrouter.baseUrl);
  const [model, setModel] = useState(presets.openrouter.model);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refreshStatus() {
    const response = await fetch("/api/ai-status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not read the current AI configuration.");
    const next = (await response.json()) as ProviderStatus;
    setStatus(next);
    if (next.configured && next.provider && next.baseUrl && next.model) {
      setProvider(next.provider);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
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

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, model, apiKey }),
      });
      const payload = await response.json().catch(() => ({})) as ProviderStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Settings could not be saved.");
      setStatus(payload);
      setProvider(payload.provider ?? provider);
      setBaseUrl(payload.baseUrl ?? baseUrl);
      setModel(payload.model ?? model);
      setApiKey("");
      setMessage("Saved on this local server. New research and backtests will use these settings.");
    } catch (saveError) {
      try {
        const latest = await refreshStatus();
        if (latest.configured && latest.baseUrl === baseUrl && latest.model === model) {
          setApiKey("");
          setMessage("Settings were saved. The local server refreshed while writing its configuration.");
          return;
        }
      } catch {
        // Keep the original save error for the user.
      }
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
      const res = await fetch("/api/ai-status", { cache: "no-store" });
      const latency = Math.round(performance.now() - start);
      if (!res.ok) throw new Error("Status check failed");
      const data = await res.json() as { configured?: boolean; model?: string };
      setPingResult({
        ok: Boolean(data.configured),
        latencyMs: latency,
        message: data.configured ? `Active connection verified (${latency}ms)` : "Endpoint responded, but key is not configured.",
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

          <label className="provider-field" htmlFor="ai-base-url"><span>API base URL</span><input id="ai-base-url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://router.example/v1" autoComplete="url" required disabled={!status?.editable || saving} /></label>
          <label className="provider-field" htmlFor="ai-model"><span>Model ID</span><input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider/model-name" maxLength={160} required disabled={!status?.editable || saving} /></label>
          <label className="provider-field" htmlFor="ai-api-key"><span>API key</span><input id="ai-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.keyConfigured && baseUrl === status.baseUrl ? "Blank keeps the saved key" : "Paste the API key for this provider"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} disabled={!status?.editable || saving} /></label>
          <p className="provider-key-note">Keys are written to this app’s local <code>.env.local</code> file, sent only to the local server, and never returned to the browser. When changing providers, enter that provider’s key.</p>
          {!status?.editable && !loading ? <p className="provider-readonly-note">Editing is enabled only while the app runs on its local development server. On a deployed server, configure the three LLM environment variables in the host’s settings.</p> : null}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
          {message ? <p className="provider-success" role="status">{message}</p> : null}
          <div className="provider-form-footer"><span>{status?.keyConfigured ? savedEndpointIsSelected ? "Blank keeps the key saved for this endpoint." : `The saved key belongs to ${currentProviderName}; enter a key for this endpoint.` : "No API key is saved yet."}</span><button className="button button-primary" type="submit" disabled={!status?.editable || loading || saving}>{saving ? "Saving settings…" : "Save provider settings"}</button></div>
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
      </section>
    </>
  );
}
