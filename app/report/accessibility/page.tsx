"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AccessibilityReportForm } from "@/components/accessibility-report-form";
import { HomeLogo } from "@/components/home-logo";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

type Step = "form" | "success";

const REDIRECT_DELAY_MS = 4000;

export default function AccessibilityReportPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [submittedReportId, setSubmittedReportId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (step !== "success") return;
    const timer = setTimeout(() => router.replace("/"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [step, router]);

  function handleReportSuccess(reportId: number) {
    setSubmittedReportId(reportId);
    setStep("success");
  }

  return (
    <main
      id="main-content"
      className="bg-background text-foreground flex min-h-svh w-full flex-col items-center justify-center gap-6 p-6 md:p-10"
    >
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <span className="border-border bg-panel inline-flex items-center justify-center rounded-[25px] border px-2 py-1 shadow-lg">
              <HomeLogo />
            </span>
            <h1 className="text-base font-medium">Ithaca College Map</h1>
          </Link>
          <ThemeToggleButton className="h-10 w-10" />
        </div>

        {step === "success" ? (
          <Card>
            <CardHeader className="text-center">
              <h2 className="text-xl leading-none font-semibold">
                Report submitted
              </h2>
              <CardDescription>
                Thank you — your accessibility report was submitted
                {submittedReportId != null ? ` (ID #${submittedReportId})` : ""}
                . You will be redirected to the home page shortly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                className="w-full bg-brand-cta text-brand-cta-foreground font-semibold tracking-wide uppercase hover:bg-brand-cta/90"
                onClick={() => router.replace("/")}
              >
                Return home
              </Button>
            </CardContent>
          </Card>
        ) : (
          <AccessibilityReportForm onSuccess={handleReportSuccess} />
        )}
      </div>
    </main>
  );
}
