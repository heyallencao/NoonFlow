import type { Metadata } from "next";
import "./globals.css";
import { AppQueryProvider } from '@/components/layout/AppQueryProvider';
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { AppShell } from "@/components/layout/AppShell";
import { DesktopBridgeProvider } from "@/components/layout/DesktopBridgeProvider";
import { FontSizeProvider } from "@/components/layout/FontSizeProvider";
import { ChatLifecycleSync } from "@/components/providers/ChatLifecycleSync";
import { ChatTimelineSync } from "@/components/providers/ChatTimelineSync";
import { StreamRuntimeSync } from "@/components/providers/StreamRuntimeSync";

export const metadata: Metadata = {
  title: "NoonFlow",
  description: "Desktop workspace for local Claude Code and Codex sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <DesktopBridgeProvider />
        <ThemeProvider>
          <FontSizeProvider>
            <AppQueryProvider>
              <I18nProvider>
                <StreamRuntimeSync />
                <ChatTimelineSync />
                <ChatLifecycleSync />
                <AppShell>{children}</AppShell>
              </I18nProvider>
            </AppQueryProvider>
          </FontSizeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
