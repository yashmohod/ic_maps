import { Button } from "@/components/ui/button"
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
import React from "react";
import { authClient, type Session } from "@/lib/auth-client"
import { LogIn, Moon, Settings, Sun } from "lucide-react";
interface profileOptions {
  session: Session;
}
import { useRouter } from "next/navigation";
import { useAppTheme } from "@/hooks/use-app-theme";

export default function ProfileOptions({ session }: profileOptions) {
  const router = useRouter();
  const { isDark, toggleTheme } = useAppTheme();
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return <>
    <Popover>
      <PopoverTrigger asChild aria-label="User menu">

        <Avatar className=" h-12 w-12 cursor-pointer" role="button" tabIndex={0}>
          {session.user.image !== "" && session.user.image ?
            <AvatarImage src={session.user.image} alt={`${session.user.name}'s profile picture`} />
            :
            <AvatarFallback aria-label={session.user.name}>
              {session.user.name?.charAt(0)?.toUpperCase() ?? "U"}
            </AvatarFallback>}
        </Avatar>
      </PopoverTrigger>
      <PopoverContent className="w-45">
        <div className="grid gap-2  w-full text-center">
          <h1 className="mb-2"> Hi {session.user.name} !</h1>
          <Button onClick={toggleTheme} aria-label={label}>{isDark ?
            <>  Light Mode<Sun size={18} /></>
            : <>  Dark Mode<Moon size={18} /></>}</Button>
          <Button onClick={() => { router.replace("/account/setting"); }}>Settings <Settings size={18} /></Button>
          <Button onClick={async () => { await authClient.signOut(); }}>Logout <LogIn size={18} /></Button>
        </div>
      </PopoverContent>
    </Popover>
  </>
}
