import {
  UserCog,
  UserRound,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";


// Menu items.
export function AppSidebar() {

  const items = [
    {
      title: "Account Management",
      url: "/account/setting#account-management",
      icon: UserCog,
    },
    {
      title: "Profile Info",
      url: "/account/setting#profile-info",
      icon: UserRound,
    },
  ];



  return (
    <Sidebar variant="sidebar">
      <SidebarHeader>
        <SidebarGroup>
          <SidebarGroupLabel>IC Maps</SidebarGroupLabel>
          <SidebarGroupContent></SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
