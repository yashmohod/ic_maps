"use client";

import Image from "next/image";

import { withBasePath } from "@/lib/base-path";

type Props = {
  className?: string;
};

export function HomeLogo({ className = "" }: Props) {
  return (
    <>
      <Image
        src={withBasePath("/assets/ic_logo_up.png")}
        alt="Ithaca College logo"
        width={160}
        height={40}
        className={`max-h-10 w-auto dark:hidden ${className}`}
      />
      <Image
        src={withBasePath("/assets/ic_logo_up_dark.png")}
        alt="Ithaca College logo"
        width={160}
        height={40}
        className={`hidden max-h-10 w-auto dark:block ${className}`}
      />
    </>
  );
}
