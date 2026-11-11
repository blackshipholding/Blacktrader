import type { Metadata, Viewport } from "next";
import { InstallHint, OfflineBanner, PullToRefresh } from "@/components/AppChrome";
import { BottomNav } from "@/components/BottomNav";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import { MarketProvider } from "@/lib/client/market";
import "./globals.css";

export const metadata: Metadata = {
  title: "Black Ship Holding – Blacktrader",
  description: "Elliott-Wellen-, Fundamental- und Volumenanalyse mit Watchlist, Echtzeit-Signalen und Depot.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.png", type: "image/png" }], apple: "/icon-180.png" },
  appleWebApp: {
    capable: true,
    title: "Black Ship",
    statusBarStyle: "black-translucent",
    startupImage: [{ url: "/splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh antialiased">
        <MarketProvider>
          <Header />
          <main className="mx-auto w-full max-w-3xl px-3 pb-[calc(var(--nav-h)+var(--safe-bottom)+16px)] pt-[calc(var(--header-h)+var(--safe-top)+12px)] sm:px-5">
            <OfflineBanner />
            {children}
          </main>
          <PullToRefresh />
          <InstallHint />
          <BottomNav />
        </MarketProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
