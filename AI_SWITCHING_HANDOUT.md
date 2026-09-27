# Goriee AI Desk — AI Switching Handout & Operator Guide
> **Informative Reference Manual for Switching AI Providers, Models, and Local Inference Engines**

---

## 1. Quick Switch Overview (TL;DR)

You can switch the AI powering **Goriee AI Desk** (Strategy Compiler, Market Research, and Copilot) in two ways:

### Method A: In-Browser GUI (Zero Restart)
1. Open the web app at `http://localhost:3000`.
2. Click **Settings** in the left sidebar navigation.
3. Select an AI Provider preset (e.g. **OpenRouter**, **NVIDIA NIM**, **OpenAI**, **Claude**, or **Custom Router**).
4. Enter your **API Key** (or use `ollama` for local inference).
5. Click **Save provider settings**, then click **Test connection / Ping** to verify latency.

### Method B: Direct `.env.local` Editing
Open `.env.local` in your project root and update the three configuration keys:
```bash
LLM_BASE_URL="https://openrouter.ai/api/v1"
LLM_MODEL="deepseek/deepseek-r1"
LLM_API_KEY="sk-or-v1-..."
```
Save the file. The Next.js dev server hot-reloads the environment automatically.

---

## 2. Supported AI Providers & Endpoint Matrix

| Provider | Base URL (`LLM_BASE_URL`) | Recommended Model ID (`LLM_MODEL`) | Best For | Cost / Tier |
| :--- | :--- | :--- | :--- | :--- |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `deepseek/deepseek-r1`<br>`meta-llama/llama-3.3-70b-instruct`<br>`anthropic/claude-3.5-sonnet` | Broadest model access, live web search, auto-fallback | Free models available; pay-per-token for top tiers |
| **DeepSeek (Direct)** | `https://api.deepseek.com/v1` | `deepseek-chat` (V3)<br>`deepseek-reasoner` (R1) | Incredible reasoning & low token cost | ~$0.14 - $0.55 per 1M tokens |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` (Fastest)<br>`gpt-4o` (Flagship) | Reliable structured JSON outputs, ultra-fast response | Developer API billing (separate from ChatGPT Plus) |
| **Anthropic Claude** | `https://api.anthropic.com/v1` | `claude-3-5-haiku-20241022`<br>`claude-3-5-sonnet-20241022` | Deep quantitative reasoning & complex conditional rules | Commercial API token billing |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.3-70b-instruct`<br>`z-ai/glm-5.3` | High-throughput enterprise MoE inference | 1,000 free credits upon sign-up |
| **Local Ollama** *(100% Private)* | `http://localhost:11434/v1` | `deepseek-r1:14b`<br>`qwen2.5-coder:14b`<br>`llama3.1:8b` | Complete offline privacy, zero API costs | Completely Free (runs on your GPU/CPU) |
| **LM Studio / vLLM** | `http://localhost:1234/v1` | Local loaded model name | Local testing with GUI controls | Free local server |

---

## 3. Curated Model Recommendations for Trading Operations

### A. Quantitative Backtest Strategy Compiler
*Translates natural-language English prompts (e.g., "Buy when RSI is below 30 and EMA 20 crosses EMA 50") into deterministic execution rules.*
- **Top Choice**: `deepseek/deepseek-r1` or `deepseek-reasoner` — Reasoner models chain thought tokens to guarantee all indicator bounds and exit thresholds match the prompt exactly.
- **Speed Choice**: `gpt-4o-mini` — Sub-second latency, almost never hallucinates malformed JSON.
- **Benchmark Pick**: `claude-3-5-sonnet-20241022` — Highest accuracy on complex multi-timeframe rules.

### B. AI Copilot (Real-Time Trading Assistant)
*Analyzes tape velocity, orderbook imbalances, Kelly sizing, and generates discretionary order tickets.*
- **Top Choice**: `gpt-4o-mini` or `claude-3-5-haiku-20241022` — Instant latency is critical so the user is not waiting during live market conditions.

### C. Bullish / Bearish Market Research Engine
*Analyzes technicals, volatility squeezes, funding rates, and macroeconomic sentiment.*
- **Top Choice**: `openrouter.ai` with any model — OpenRouter includes live web news search citations seamlessly.

---

## 4. Step-by-Step Provider Setup Guides

### Guide 1: Switching to DeepSeek (via OpenRouter or Direct)
#### Option 1: OpenRouter (Recommended for Web Search)
1. Go to [openrouter.ai](https://openrouter.ai) and generate an API key.
2. Open **Settings** in Goriee Desk.
3. Select **OpenRouter**.
4. Set Model ID to: `deepseek/deepseek-r1` (or `deepseek/deepseek-chat`).
5. Paste your OpenRouter key (`sk-or-v1-...`) and click **Save**.

#### Option 2: DeepSeek Direct API
1. Go to [platform.deepseek.com](https://platform.deepseek.com) and create an API key.
2. Open **Settings** in Goriee Desk.
3. Select **Custom Router**.
4. Set API base URL: `https://api.deepseek.com/v1`
5. Set Model ID: `deepseek-chat`
6. Paste your DeepSeek key (`sk-...`) and click **Save**.

---

### Guide 2: Switching to OpenAI (GPT-4o / GPT-4o-mini)
1. Go to [platform.openai.com](https://platform.openai.com/api-keys) and generate an API key.
   *(Note: A ChatGPT Plus monthly subscription is separate from OpenAI developer API platform credits).*
2. Open **Settings** in Goriee Desk.
3. Select **OpenAI API · ChatGPT models**.
4. Model ID defaults to `gpt-4o-mini` (or enter `gpt-4o` for full capacity).
5. Paste your OpenAI key (`sk-proj-...`) and click **Save**.

---

### Guide 3: Switching to Anthropic Claude
1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. Open **Settings** in Goriee Desk.
3. Select **Claude API · Anthropic**.
4. Model ID defaults to `claude-haiku-4-5-20251001` (or enter `claude-3-5-sonnet-20241022`).
5. Paste your Anthropic key (`sk-ant-...`) and click **Save**.

---

### Guide 4: Switching to 100% Free & Private Local AI (Ollama)
Run state-of-the-art models completely on your own hardware without sending any data over the internet:

1. **Install Ollama**: Download from [ollama.com](https://ollama.com).
2. **Pull a Model** in your terminal:
   ```bash
   ollama run deepseek-r1:14b
   # or for lower RAM / VRAM:
   ollama run qwen2.5:7b
   ```
3. **Configure Goriee Desk**:
   - Open **Settings** in Goriee Desk.
   - Select **Custom Router**.
   - API base URL: `http://localhost:11434/v1`
   - Model ID: `deepseek-r1:14b` (or whichever model you pulled)
   - API key: `ollama` (Ollama does not require auth, but enter `ollama` as a non-empty placeholder).
4. Click **Save provider settings**, then click **Test connection / Ping**!

---

## 5. Verification & Testing

### Test Connection via UI
In the **Settings** view, click the **Test connection / Ping** button in the top right.
- **Success**: Displays green banner with round-trip latency (e.g. `Active connection verified (185ms)`).
- **Failure**: Displays error banner with root cause (e.g. invalid key, 404 model not found, network unreachable).

### Test Connection via Command Line
Run this one-line command to test your configured AI server-side:
```powershell
node -e "fetch('http://localhost:3000/api/ai-status').then(r=>r.json()).then(console.log)"
```
Expected output:
```json
{
  "configured": true,
  "model": "deepseek/deepseek-r1",
  "baseUrl": "https://openrouter.ai/api/v1",
  "provider": "openrouter",
  "keyConfigured": true,
  "editable": true
}
```

---

## 6. Troubleshooting & Diagnostics

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"AI is not configured"** | Missing API key or baseUrl in `.env.local` | Open **Settings** in the browser, choose a preset, paste your key and click Save. |
| **"Daily quota exceeded / 429"** | Free tier rate limits reached on provider | In Settings, switch to a paid API key or use local Ollama / LM Studio. |
| **"Invalid JSON object returned"** | Model generated conversational prose around JSON | Ensure your model supports system prompts and JSON mode. DeepSeek, GPT-4o, and Claude natively adhere to strict schemas. |
| **401 Unauthorized** | Expired or incorrect API key | Re-copy key directly from provider's developer dashboard and re-save in Settings. |
| **High Latency (> 5s)** | Large reasoning models thinking through proofs | Switch to a faster model like `gpt-4o-mini`, `qwen2.5:14b`, or `claude-3-5-haiku`. |

---

## 7. Developer & Incoming AI Assistant Handover Notes

If you are switching to another AI coding assistant (Cursor, Claude Code, Windsurf, Codex, ChatGPT, Aider) or handing off to another developer:

> **IMPORTANT**: A complete, dedicated handover specification has been generated at [`AI_AGENT_HANDOVER.md`](file:///c:/Users/Admin/Documents/Codex/2026-09-24/bitget-hackathon-q-a-chatgpt-conversation/outputs/goriee-ai-desk/AI_AGENT_HANDOVER.md). You can copy that entire file or paste its kickoff prompt directly into your new AI agent to resume work immediately.

1. **Architecture Stack**:
   - **Framework**: Next.js 15 (App Router), React 19, TypeScript.
   - **Styling**: Vanilla CSS Design Tokens (`src/app/globals.css`), strictly adhering to `/antislop` guidelines (no decorative emojis, WCAG AA contrast, SVG icons only).
   - **Market Feed**: Bitget Spot Public API (`src/lib/bitget.ts`).
   - **AI Core**: `src/lib/llm.ts` (multi-provider router supporting OpenAI, Anthropic, OpenRouter, NVIDIA, and Custom OpenAI-compatible endpoints with resilient JSON parsing).
   - **Backtest Engine**: `src/lib/backtest.ts` (deterministic rule evaluation, Monte Carlo analysis, parameter heatmaps).
   - **Trade Replay Studio**: `src/components/trading-desk.tsx` (historical tape replay with 720+ candles, step-by-step playback, zero-hindsight order tickets).

2. **Quality Gates & Commands**:
   - Unit tests: `cmd.exe /c "npm run test:unit"` (39/39 passing).
   - Type check: `cmd.exe /c "npm run typecheck"` (0 errors).
   - Dev server: Already running on `http://localhost:3000`.
