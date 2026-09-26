import type { UrlCitation } from "@/lib/llm";

const KNOWN_ASSETS: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP Ripple",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  AVAX: "Avalanche",
  BNB: "BNB Binance",
  LINK: "Chainlink",
  SUI: "Sui Network",
  NEAR: "NEAR Protocol",
  DOT: "Polkadot",
  LTC: "Litecoin",
  PEPE: "Pepe memecoin",
  SHIB: "Shiba Inu",
  TRX: "TRON",
  ARB: "Arbitrum",
  OP: "Optimism",
  APT: "Aptos",
  MATIC: "Polygon",
  POL: "Polygon",
  ATOM: "Cosmos",
  FTM: "Fantom Sonic",
  INJ: "Injective",
  RENDER: "Render Token",
  FET: "Fetch.ai Artificial Superintelligence",
  TAO: "Bittensor",
};

function cleanHtmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/<[^>]*>/g, "")
    .trim();
}

/**
 * Universally fetch live crypto & financial market news headlines with citations.
 * Works across all LLM providers and routers (NVIDIA NIM, UnoRouter, OpenAI, Anthropic, OpenRouter, etc.).
 */
export async function fetchLiveMarketNews(symbol: string, userQuestion?: string): Promise<UrlCitation[]> {
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const baseAsset = cleanSymbol.replace(/USDT$|USD$|PERP$|BUSD$|USDC$/i, "");
  const fullName = KNOWN_ASSETS[baseAsset] ?? baseAsset;

  const queries = [
    `${fullName} crypto market news`,
    `${baseAsset} cryptocurrency`,
  ];

  if (userQuestion && userQuestion.trim().length > 6 && !userQuestion.toLowerCase().includes("analyze")) {
    const topicWords = userQuestion.replace(/[^\w\s]/g, " ").trim().split(/\s+/).slice(0, 5).join(" ");
    queries.unshift(`${fullName} ${topicWords}`);
  }

  // Attempt Google News RSS search
  for (const query of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(4500),
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const citations: UrlCitation[] = [];
      const seenUrls = new Set<string>();

      for (const item of items.slice(0, 6)) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        const sourceMatch = item.match(/<source[^>]*>(.*?)<\/source>/);

        const rawTitle = titleMatch ? cleanHtmlEntities(titleMatch[1]) : "";
        const link = linkMatch ? linkMatch[1].trim() : "";
        const pubDate = pubDateMatch ? cleanHtmlEntities(pubDateMatch[1]) : "";
        const source = sourceMatch ? cleanHtmlEntities(sourceMatch[1]) : "";

        if (rawTitle && link && /^https?:\/\//i.test(link) && !seenUrls.has(link)) {
          seenUrls.add(link);
          const formattedDate = pubDate ? new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
          const content = [source, formattedDate].filter(Boolean).join(" · ") || `Recent market reporting for ${baseAsset}`;
          citations.push({
            title: rawTitle.slice(0, 240),
            url: link,
            content: content.slice(0, 300),
          });
        }
      }

      if (citations.length > 0) {
        return citations.slice(0, 4);
      }
    } catch {
      // Continue to next query or fallback
    }
  }

  // Fallback: Cointelegraph RSS feed
  try {
    const fallbackRes = await fetch("https://cointelegraph.com/rss", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(3500),
    });

    if (fallbackRes.ok) {
      const xml = await fallbackRes.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const citations: UrlCitation[] = [];

      for (const item of items) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

        const rawTitle = titleMatch ? cleanHtmlEntities(titleMatch[1]) : "";
        const link = linkMatch ? linkMatch[1].trim() : "";
        const pubDate = pubDateMatch ? cleanHtmlEntities(pubDateMatch[1]) : "";

        // Check if item mentions the asset or general market
        if (rawTitle && link && /^https?:\/\//i.test(link)) {
          const lower = rawTitle.toLowerCase();
          const matchesAsset = lower.includes(baseAsset.toLowerCase()) || (fullName && lower.includes(fullName.toLowerCase()));
          if (matchesAsset || citations.length < 2) {
            citations.push({
              title: rawTitle.slice(0, 240),
              url: link,
              content: `Cointelegraph · ${pubDate ? new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Recent"}`,
            });
            if (citations.length >= 3) break;
          }
        }
      }

      if (citations.length > 0) {
        return citations;
      }
    }
  } catch {
    // If all fail, return empty array gracefully
  }

  return [];
}
