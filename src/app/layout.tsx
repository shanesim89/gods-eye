import type { Metadata } from "next";
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Topbar } from "@/components/shell/Topbar";
import { TickerStrip } from "@/components/shell/TickerStrip";
import { FooterStatus } from "@/components/shell/FooterStatus";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// UI type for Bento Slate; JetBrains stays for anything tagged font-mono.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "God's Eye / Terminal",
  description: "Personal cockpit dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} ${plexSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Topbar />
        <TickerStrip />
        <main className="flex-1 p-3.5 overflow-auto">{children}</main>
        <FooterStatus />
      </body>
    </html>
  );
}
