import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import React, { useState, useEffect } from "react";
import { authClient, type Session } from "@/lib/auth-client"
import {
  IconSettings,
  IconLogin2,
} from "@tabler/icons-react";
interface profileOptions {
  session: Session;
}
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppTheme } from "@/hooks/use-app-theme";
import { IconMoon, IconSun } from "@tabler/icons-react";

export default function ProfileOptions({ session }: profileOptions) {
  const router = useRouter();
  const { isDark, toggleTheme } = useAppTheme();
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  useEffect(() => {
    console.log("here in profileOptions")
    console.log(session)
  }, [session])



  return <>
    <Popover>
      <PopoverTrigger asChild>

        <Avatar className=" h-12 w-12">
          {session.user.image !== "" && session.user.image ?
            <AvatarImage src={session.user.image} alt="@shadcn" />
            :
            <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />}
        </Avatar>
      </PopoverTrigger>
      <PopoverContent className="w-45">
        <div className="grid gap-2  w-full text-center">
          <h1 className="mb-2"> Hi {session.user.name} !</h1>
          <Button onClick={toggleTheme}>{isDark ?
            <>  Light Mode<IconSun size={18} /></>
            : <>  Dark Mode<IconMoon size={18} /></>}</Button>
          <Button onClick={() => { router.replace("/account/setting"); }}>Settings <IconSettings /></Button>
          <Button onClick={async () => { await authClient.signOut(); }}>Logout <IconLogin2 /></Button>
        </div>
      </PopoverContent>
    </Popover>
  </>
}
