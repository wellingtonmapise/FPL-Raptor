import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Fonts come from the geist package (bundled files), so builds never depend on
// reaching Google Fonts.

export const metadata: Metadata = {
  title: "FPL Raptor",
  description: "Deadlines, alerts, transfer ideas and mini-league banter for Fantasy Premier League.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
