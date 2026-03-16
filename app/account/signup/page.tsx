"use client";

import Link from "next/link";
import { SignupForm } from "@/components/signup-form";
import { HomeLogo } from "@/components/home-logo";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
export default function SignupPage() {
  return (
    <main id="main-content" className="bg-background text-foreground flex w-full min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <span className="inline-flex items-center justify-center rounded-[25px] border border-border bg-panel px-2 py-1 shadow-lg">
              <HomeLogo />
            </span>
            <h1 className="text-base font-medium">Ithaca College Map</h1>
          </Link>
          <ThemeToggleButton className="h-10 w-10" />
        </div>
        <SignupForm />
      </div>
    </main>
  );
}
