import { AIRequestError, providerRetryAt } from "@/lib/ai-errors";

export type LLMConfiguration = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type LLMProvider = "openrouter" | "openai" | "anthropic" | "unorouter" | "nvidia" | "custom";

export type JsonOutputSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type UrlCitation = {
  url: string;
  title: string;
  content: string;
};

export function getLLMConfiguration(headers?: Headers | null): LLMConfiguration | null {
  const customKey = headers?.get("x-llm-api-key")?.trim();
  const customBaseUrl = headers?.get("x-llm-base-url")?.trim()?.replace(/\/+$/, "");
  const customModel = headers?.get("x-llm-model")?.trim();

  if (customKey && customBaseUrl && customModel) {
    return {
      apiKey: customKey,
      baseUrl: customBaseUrl,
      model: customModel,
    };
  }

  const apiKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/$/, "");
  const model = process.env.LLM_MODEL?.trim();
  return apiKey && baseUrl && model ? { apiKey, baseUrl, model } : null;
}

export function isCustomLLM(headers?: Headers | null): boolean {
  return Boolean(
    headers?.get("x-llm-api-key")?.trim() &&
    headers?.get("x-llm-base-url")?.trim() &&
    headers?.get("x-llm-model")?.trim()
  );
}

export function getLLMProvider(baseUrl: string | null | undefined): LLMProvider | null {
  if (!baseUrl) return null;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) return "openrouter";
  if (host === "api.openai.com" || host.endsWith(".openai.com")) return "openai";
  if (host === "api.anthropic.com" || host.endsWith(".anthropic.com")) return "anthropic";
  if (host === "api.unorouter.com" || host.endsWith(".unorouter.com")) return "unorouter";
  if (host === "integrate.api.nvidia.com" || host.endsWith(".nvidia.com")) return "nvidia";
  return "custom";
}

export function parseJsonObject<T>(content: string): T {
  const text = content.trim();

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = start; end < text.length; end += 1) {
      const character = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth !== 0) continue;

        try {
          const parsed: unknown = JSON.parse(text.slice(start, end + 1));
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as T;
          }
        } catch {
          // Keep looking in case the model included an invalid example before its answer.
        }
        break;
      }
    }
  }

  throw new Error("The AI did not return a valid JSON object. Check the selected model's JSON support and try again.");
}

export async function requestJsonCompletion<T>(
  system: string,
  user: unknown,
  outputSchema?: JsonOutputSchema,
  options: { webSearch?: boolean; citations?: UrlCitation[]; configuration?: LLMConfiguration } = {},
): Promise<{
  model: string;
  result: T;
  citations: UrlCitation[];
}> {
  const configuration = options.configuration ?? getLLMConfiguration();
  if (!configuration) {
    throw new Error("AI is not configured. Add LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in Settings or .env.local, then try again.");
  }

  const provider = getLLMProvider(configuration.baseUrl);
  const usesOpenRouter = provider === "openrouter";
  const usesAnthropic = provider === "anthropic";
  const nemotronFreeModel = usesOpenRouter && configuration.model === "nvidia/nemotron-3-ultra-550b-a55b:free";
  const supportsJsonResponseFormat = (usesOpenRouter && !nemotronFreeModel) || provider === "openai" || provider === "unorouter";
  const schemaInstruction = outputSchema && (provider === "unorouter" || provider === "nvidia" || usesAnthropic || nemotronFreeModel)
    ? `\n\nReturn a JSON object that follows this schema:\n${JSON.stringify(outputSchema.schema)}`
    : "";
  const promptOnlyJson = provider === "unorouter" || provider === "nvidia" || nemotronFreeModel;

  let activeCitations: UrlCitation[] = options.citations ?? [];
  if (options.webSearch && activeCitations.length === 0) {
    try {
      const userObj = user && typeof user === "object" ? (user as Record<string, unknown>) : {};
      const sym = typeof userObj.symbol === "string" ? userObj.symbol : "BTCUSDT";
      const q = typeof userObj.question === "string" ? userObj.question : undefined;
      const { fetchLiveMarketNews } = await import("@/lib/news");
      activeCitations = await fetchLiveMarketNews(sym, q);
    } catch {
      activeCitations = [];
    }
  }

  let userPayload = user;
  if (activeCitations.length > 0 && user && typeof user === "object" && !("liveMarketNewsHeadlines" in user)) {
    userPayload = {
      ...(user as Record<string, unknown>),
      liveMarketNewsHeadlines: activeCitations.map((c) => ({
        headline: c.title,
        source: c.content,
        url: c.url,
      })),
    };
  }

  const requestBody = usesAnthropic
    ? {
        model: configuration.model,
        max_tokens: 1200,
        system: `${system}${schemaInstruction}\n\nReturn only one valid JSON object. Do not include markdown fences or explanatory text outside the JSON.`,
        messages: [{ role: "user", content: JSON.stringify(userPayload) }],
      }
    : {
        model: configuration.model,
        temperature: 0.1,
        max_tokens: provider === "nvidia" || configuration.model.includes("glm") ? 4096 : 1200,
        ...(supportsJsonResponseFormat ? {
          response_format: provider === "unorouter"
            ? { type: "json_object" }
            : outputSchema
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: outputSchema.name,
                    strict: true,
                    schema: outputSchema.schema,
                  },
                }
              : { type: "json_object" },
        } : {}),
        ...(usesOpenRouter ? {
          provider: { require_parameters: true },
          ...(configuration.model === "nex-agi/nex-n2.5-mini:free"
            ? { reasoning: { effort: "none" } }
            : {}),
        } : {}),
        ...(options.webSearch && usesOpenRouter && activeCitations.length === 0 ? {
          tools: [{
            type: "openrouter:web_search",
            parameters: {
              engine: "parallel",
              mode: "turbo",
              max_uses: 1,
              max_results: 3,
              max_total_results: 3,
              search_context_size: "low",
              max_characters: 1200,
            },
          }],
          max_tool_calls: 1,
        } : {}),
        messages: [
          { role: "system", content: `${system}${schemaInstruction}${promptOnlyJson ? "\n\nReturn only one valid JSON object. Do not include markdown fences or explanatory text outside the JSON." : ""}${provider === "nvidia" || configuration.model.includes("glm") ? "\n\nKeep internal chain-of-thought concise and proceed directly to producing the JSON object." : ""}` },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      };
  const request = () => fetch(`${configuration.baseUrl}/${usesAnthropic ? "messages" : "chat/completions"}`, {
    method: "POST",
    headers: {
      ...(usesAnthropic
        ? { "x-api-key": configuration.apiKey, "anthropic-version": "2023-06-01" }
        : { authorization: `Bearer ${configuration.apiKey}` }),
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
    // 280s for slow reasoning models so they can finish inside the 300s Vercel
    // function budget (route maxDuration); aborting first lets us return a
    // readable error instead of a platform 504.
    signal: AbortSignal.timeout(provider === "nvidia" || configuration.model.includes("glm") ? 280000 : 35000),
  });

  // Failed requests also count toward free-model quotas, so return the first failure to the user.
  const attempts = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request();
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {
        error?: { message?: unknown; metadata?: { limit_source?: unknown } };
      } | null;
      const providerMessage = typeof payload?.error?.message === "string"
        ? payload.error.message.replaceAll(configuration.apiKey, "[redacted]").trim().slice(0, 360)
        : "";
      const limitSource = typeof payload?.error?.metadata?.limit_source === "string" ? payload.error.metadata.limit_source : "";
      const retryAfter = response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset");
      if (response.status === 429) {
        const reasons = [
          providerMessage,
          limitSource ? `Limit type: ${limitSource}.` : "",
          retryAfter ? `Provider retry hint: ${retryAfter}.` : "",
        ].filter(Boolean).join(" ");
        const providerName = provider === "unorouter" ? "UnoRouter" : provider === "openrouter" ? "OpenRouter" : provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : provider === "nvidia" ? "NVIDIA NIM" : "Your AI provider";
        throw new AIRequestError(`${providerName} has temporarily limited requests (HTTP 429). ${reasons} Your input is preserved. Wait before retrying; if this continues, check your provider quota in Settings.`.trim(), 429, providerRetryAt(response.headers));
      }
      throw new Error(`AI provider returned HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ". Check the server-side API key, base URL, and model name."}`);
    }

    const completion = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; annotations?: unknown } }>;
      content?: Array<{ type?: string; text?: string }>;
    };
    const message = completion.choices?.[0]?.message;
    const rawContent = message?.content;
    const reasoningContent = message?.reasoning_content;
    const content = usesAnthropic
      ? completion.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n")
      : (rawContent && rawContent.trim()) || (reasoningContent && reasoningContent.trim()) || "";
    if (!content?.trim()) {
      lastError = new Error("The AI provider returned an empty response.");
      continue;
    }

    try {
      const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
      const citations = annotations.flatMap((annotation): UrlCitation[] => {
        if (!annotation || typeof annotation !== "object") return [];
        const item = annotation as Record<string, unknown>;
        const citation = item.url_citation && typeof item.url_citation === "object"
          ? item.url_citation as Record<string, unknown>
          : item;
        const url = typeof citation.url === "string" ? citation.url : "";
        if (!/^https?:\/\//i.test(url)) return [];
        return [{
          url,
          title: typeof citation.title === "string" ? citation.title.slice(0, 240) : url,
          content: typeof citation.content === "string" ? citation.content.slice(0, 800) : "",
        }];
      });
      const finalCitations = citations.length > 0 ? citations : activeCitations;
      return { model: completion.model ?? configuration.model, result: parseJsonObject<T>(content), citations: finalCitations };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("The AI did not return a valid JSON object.");
    }
  }

  if (lastError?.message === "The AI provider returned an empty response.") {
    throw new Error("The free model returned an empty response. Retry after a brief pause or choose another compatible model.");
  }
  throw lastError ?? new Error("The AI response could not be parsed. Try again.");
}
