import type { Metadata } from "next";
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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

const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#2dd4bf",
    colorBackground: "#0e1216",
    colorText: "#e7eef5",
    colorTextSecondary: "#8496a6",
    colorInputBackground: "#131a21",
    colorInputText: "#e7eef5",
    colorNeutral: "#242e37",
    fontFamily: "var(--font-plex-sans)",
    borderRadius: "10px",
  },
  elements: {
    card: "bg-panel border border-border rounded-xl",
    formButtonPrimary: "bg-cyan text-bg hover:bg-cyan",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE}>
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
    </ClerkProvider>
  );
}
