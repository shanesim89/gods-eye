import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "God's Eye / Terminal",
  description: "Personal cockpit dashboard",
};

const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#ffb000",
    colorBackground: "#0a0a0a",
    colorText: "#d4d4d4",
    colorTextSecondary: "#6b6b6b",
    colorInputBackground: "#121212",
    colorInputText: "#d4d4d4",
    colorNeutral: "#1f1f1f",
    fontFamily: "var(--font-jetbrains-mono)",
    borderRadius: "0px",
  },
  elements: {
    card: "bg-panel border border-border",
    formButtonPrimary: "bg-amber text-black hover:bg-amber",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE}>
      <html lang="en" className={`${jetbrainsMono.variable} h-full antialiased`}>
        <body className="min-h-full flex flex-col">
          <Topbar />
          <TickerStrip />
          <main className="flex-1 p-3 overflow-auto">{children}</main>
          <FooterStatus />
        </body>
      </html>
    </ClerkProvider>
  );
}
