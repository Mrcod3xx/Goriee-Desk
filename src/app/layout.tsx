import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

// Resolves the file-convention OG card (src/app/opengraph-image.tsx) into an
// absolute URL for crawlers. Overridable per environment via NEXT_PUBLIC_SITE_URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://goriee-ai-desk.vercel.app";

const description =
  "A Bitget-powered research desk for market context, testable strategies, and paper trading.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Goriee AI Desk | Market research, with receipts",
  description,
  applicationName: "Goriee AI Desk",
  openGraph: {
    title: "Goriee AI Desk | Market research, with receipts",
    description,
    url: siteUrl,
    siteName: "Goriee AI Desk",
    type: "website",
    locale: "en_US",
    // images intentionally omitted: opengraph-image.tsx supplies og:image AND
    // twitter:image — Next inherits OG title/description/images into the twitter
    // card whenever twitter omits them.
  },
  twitter: {
    card: "summary_large_image",
    title: "Goriee AI Desk | Market research, with receipts",
    description,
  },
  robots: { index: true, follow: true },
};

// themeColor lives here rather than inside `metadata` on purpose: it has been
// deprecated in Metadata since Next 14 (Next 16 docs, generate-metadata.md)
// and Next warns when used there. The supported form is this Viewport export.
export const viewport: Viewport = {
  themeColor: "#f2f5f2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
