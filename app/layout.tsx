import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ToasterClient } from "@/components/toaster-client";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

//// app/layout.tsx  (or app/page.tsx)
//export const dynamic = "force-dynamic";
//export const revalidate = 0;
//
//export const fetchCache = "force-no-store";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IC Map",
  description: "Handy tool to navigate IC",
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
      </body>
    </html>
  );
}
