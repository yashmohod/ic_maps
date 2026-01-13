"use client";

import Link from "next/link";

import { HomeLogo } from "@/components/home-logo";

type Props = {
  className?: string;
  imageClassName?: string;
  label?: string;
};

export function HomeLogoLink({
  className = "",
  imageClassName = "",
  label = "Go to home",
}: Props) {
  return (
    <Link
      href="/"
      aria-label={label}
      className={[
        "inline-flex items-center justify-center rounded-2xl border border-border bg-panel text-panel-foreground shadow-lg backdrop-blur transition hover:scale-[1.02] active:scale-95",
        className,
      ].join(" ")}
    >
      <HomeLogo className={imageClassName} />
    </Link>
  );
}
