import { NextRequest } from "next/server";
import { getLLMConfiguration, getLLMProvider } from "@/lib/llm";
import { buildCopilotSystemPrompt } from "@/lib/copilot-prompt";
import { CopilotContextPayload } from "@/types/copilot";

export const dynamic = "force-dynamic";

// Let slow reasoning models (GLM via NVIDIA NIM) run to completion. 300s is the
// hard maximum on the Vercel Hobby plan; the LLM fetch itself gives up at 280s
// (src/lib/llm.ts) so a hung model still returns a readable error, not a 504.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const configuration = getLLMConfiguration();
  if (!configuration) {
    return new Response(
      JSON.stringify({
        error: "AI is not configured. Add LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in Settings or .env.local.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: {
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    context?: CopilotContextPayload;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages array cannot be empty." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const context: CopilotContextPayload = body.context ?? {
    symbol: "BTCUSDT",
    interval: "1H",
    activeView: "desk",
    includeTokenContext: true,
    includeTechnicalContext: true,
    includePortfolioContext: true,
  };

  const systemPrompt = buildCopilotSystemPrompt(context);
  const provider = getLLMProvider(configuration.baseUrl);
  const usesAnthropic = provider === "anthropic";

  const outgoingMessages = rawMessages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }))
    .slice(-12);

  // Prepare streaming request to upstream provider
  const encoder = new TextEncoder();

  if (usesAnthropic) {
    const url = `${configuration.baseUrl}/v1/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": configuration.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: configuration.model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: outgoingMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return new Response(
          JSON.stringify({ error: `Anthropic API error (${response.status}): ${errorText.slice(0, 200)}` }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }
          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const dataStr = trimmed.replace(/^data:\s*/, "");
                if (dataStr === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                    controller.enqueue(encoder.encode(parsed.delta.text));
                  }
                } catch {
                  // ignore partial json
                }
              }
            }
          } catch (err) {
            controller.error(err);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection failed";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // OpenAI / OpenRouter / Unorouter / Nvidia / Local streaming
  const url = `${configuration.baseUrl}/chat/completions`;
  const isNemotron = configuration.model === "nvidia/nemotron-3-ultra-550b-a55b:free";
  const messagesWithSystem = [
    { role: "system", content: systemPrompt },
    ...outgoingMessages,
  ];

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${configuration.apiKey}`,
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer": "https://goriee.trading",
              "X-Title": "Goriee AI Desk",
            }
          : {}),
      },
      body: JSON.stringify({
        model: configuration.model,
        temperature: 0.2,
        max_tokens: isNemotron ? 2048 : 3000,
        messages: messagesWithSystem,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `AI provider error (${response.status}): ${errorText.slice(0, 200)}` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const dataStr = trimmed.replace(/^data:\s*/, "");
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                const deltaContent = parsed.choices?.[0]?.delta?.content;
                if (typeof deltaContent === "string" && deltaContent.length > 0) {
                  controller.enqueue(encoder.encode(deltaContent));
                }
              } catch {
                // ignore SSE json parse errors on partial chunks
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect to AI router";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
