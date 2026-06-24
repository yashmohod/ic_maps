import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ToasterClient } from "@/components/toaster-client";
import { DevModeProvider } from "@/components/dev-mode-provider";
import { isDevModeEnabled } from "@/lib/dev-mode";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});



const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IC Map",
  description: "Handy tool to navigate IC",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {




  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-100 focus:top-2 focus:left-2 focus:rounded-lg focus:px-4 focus:py-2 focus:bg-brand focus:text-brand-foreground focus:shadow-lg focus:outline-none"
        >
          Skip to main content
        </a>
        <DevModeProvider enabled={isDevModeEnabled()}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SidebarProvider defaultOpen={false}>
              <ToasterClient />

              {children}
            </SidebarProvider>
          </ThemeProvider>
        </DevModeProvider>
      </body>
    </html>
  );
}
