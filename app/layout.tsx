import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

// Fonts come from the geist package (bundled files), so builds never depend on
// reaching Google Fonts.

export const metadata: Metadata = {
  title: "FPL Raptor",
  description: "Deadlines, alerts, transfer ideas and mini-league banter for Fantasy Premier League.",
  // Lets iPhones open it full-screen from the Home Screen, like an app.
  appleWebApp: { capable: true, title: "FPL Raptor", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
