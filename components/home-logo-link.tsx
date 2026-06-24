"use client";

import Link from "next/link";

import { HomeLogo } from "@/components/home-logo";

import { mapHeaderChipClass } from "@/lib/panel-classes";

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
      className={[mapHeaderChipClass, className].filter(Boolean).join(" ")}
    >
      <HomeLogo className={imageClassName} />
    </Link>
  );
}
