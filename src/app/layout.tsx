import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Goriee AI Desk | Market research, with receipts",
  description:
    "A Bitget-powered research desk for market context, testable strategies, and paper trading.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
