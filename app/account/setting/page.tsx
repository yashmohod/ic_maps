"use client";

import { useEffect, useState } from "react";
import { UserCog, UserRound } from "lucide-react";

import { HomeLogoLink } from "@/components/home-logo-link";
import { ThemeToggleButton } from "@/components/theme-toggle-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";

export default function Setting() {
  const [users, setUsers] = useState<
    Array<{ id: string; name: string; email: string; isAdmin: boolean }>
  >([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("profile-info");
  const { data: session } = authClient.useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [adminUpdatePending, setAdminUpdatePending] = useState<Set<string>>(
    new Set(),
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const { state, open } = useSidebar();
  const isCollapsed = state === "collapsed";

  const loadUsers = async (query?: string) => {
    setUsersLoading(true);
    try {
      const search = query?.trim();
      const url = search
        ? `/api/users?search=${encodeURIComponent(search)}`
        : "/api/users";
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to load users");
      const data = (await resp.json()) as {
        users: Array<{ id: string; name: string; email: string; isAdmin: boolean }>;
      };
      setUsers(data.users);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load users.");
    } finally {
      setUsersLoading(false);
    }
  };


  useEffect(() => {
    if (session?.user?.name) setDisplayName(session.user.name);
  }, [session?.user?.name]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    let mounted = true;
    const loadIsAdmin = async () => {
      try {
        const resp = await fetch(`/api/users/${userId}`);
        if (!resp.ok) return;
        const data = (await resp.json()) as { user?: { isAdmin: boolean } };
        if (mounted) setIsAdmin(!!data.user?.isAdmin);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load admin status.");
      }
    };
    void loadIsAdmin();
    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  const filteredUsers = users;
  const hasActiveSearch = searchQuery.trim().length > 0;

  useEffect(() => {
    if (!hasActiveSearch) return;
    const handle = window.setTimeout(() => {
      void loadUsers(searchQuery);
    }, 1000);
    return () => window.clearTimeout(handle);
  }, [searchQuery, hasActiveSearch]);

  return (
    <main id="main-content" className="relative min-h-svh w-full bg-background text-foreground">
      <h1 className="sr-only">Settings</h1>
      <div className="flex w-full pt-20">
        <Sidebar
          side="left"
          variant="inset"
          collapsible="icon"
          className="border-r border-border bg-panel text-panel-foreground"
        >
          <SidebarHeader className="bg-panel">
            <div className={`flex items-center w-24 justify-center ${isCollapsed ? "ml-[-30px]" : "ml-[50px]"}`}>
              <HomeLogoLink
                className="h-10 shadow-sm "
                imageClassName="max-h-9"
              />
            </div>
            <SidebarGroup className="mt-2">
              <SidebarGroupLabel className="text-panel-muted-foreground">
                Settings
              </SidebarGroupLabel>
            </SidebarGroup>
          </SidebarHeader>
          <SidebarContent className="bg-panel">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeSection === "profile-info"}
                      onClick={() => setActiveSection("profile-info")}
                    >
                      <UserRound />
                      <span>Profile Info</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {isAdmin ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={activeSection === "account-management"}
                        onClick={() => setActiveSection("account-management")}
                      >
                        <UserCog />
                        <span>Account Management</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="flex-1 px-6 pb-10">
          <div className="sticky  z-20 flex items-center justify-between gap-2 mb-10 mt-4 ">
            <SidebarTrigger className="size-11 rounded-full border border-border bg-panel text-panel-foreground shadow-sm" />
            <ThemeToggleButton className="h-11 w-11 shadow-xl backdrop-blur" />
          </div>
          {isAdmin && activeSection === "account-management" ? (
            <section
              id="account-management"
              className="rounded-2xl border border-border bg-panel p-6 shadow-sm ring-2 ring-brand-cta/30"
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Account Management</h2>
                <p className="text-sm text-panel-muted-foreground">
                  Manage user access and privileges.
                </p>
              </div>

              <div className="mt-6 grid gap-4">
                <div className="max-w-md">
                  <Label htmlFor="user-search">Search users</Label>
                  <div className="mt-2">
                    <Input
                      id="user-search"
                      placeholder="Filter by name or email"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-brand text-brand-foreground text-left">
                      <tr>
                        <th className="px-4 py-3 text-start font-semibold" scope="col">User</th>
                        <th className="px-4 py-3 text-start font-semibold" scope="col">Email</th>
                        <th className="px-4 py-3 text-start font-semibold" scope="col">Role</th>
                        <th className="px-4 py-3 text-end font-semibold" scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersLoading ? (
                        <tr className="border-t border-border/70">
                          <td
                            className="px-4 py-6 text-center text-panel-muted-foreground"
                            colSpan={4}
                          >
                            Loading users...
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
                          <tr
                            key={user.id}
                            className="border-t border-border/70"
                          >
                            <td className="px-4 py-3 font-medium">{user.name}</td>
                            <td className="px-4 py-3 text-panel-muted-foreground">
                              {user.email}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full border border-border px-2 py-1 text-xs font-semibold">
                                {user.isAdmin ? "Admin" : "User"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={user.isAdmin ? "default" : "outline"}
                                  onClick={() =>
                                    (async () => {
                                      setAdminUpdatePending((prev) => {
                                        const next = new Set(prev);
                                        next.add(user.id);
                                        return next;
                                      });
                                      try {
                                        const resp = await fetch(
                                          `/api/users/${user.id}`,
                                          {
                                            method: "PATCH",
                                            headers: {
                                              "Content-Type": "application/json",
                                            },
                                            body: JSON.stringify({
                                              isAdmin: !user.isAdmin,
                                            }),
                                          },
                                        );
                                        if (!resp.ok) {
                                          const message = await resp.text();
                                          throw new Error(
                                            message || "Failed to update user",
                                          );
                                        }
                                        const data = (await resp.json()) as {
                                          user: {
                                            id: string;
                                            name: string;
                                            email: string;
                                            isAdmin: boolean;
                                          };
                                        };
                                        setUsers((prev) =>
                                          prev.map((row) =>
                                            row.id === data.user.id
                                              ? { ...row, isAdmin: data.user.isAdmin }
                                              : row,
                                          ),
                                        );
                                      } catch (err) {
                                        console.error(err);
                                        toast.error("Failed to update admin status.");
                                      } finally {
                                        setAdminUpdatePending((prev) => {
                                          const next = new Set(prev);
                                          next.delete(user.id);
                                          return next;
                                        });
                                      }
                                    })()
                                  }
                                  disabled={adminUpdatePending.has(user.id)}
                                >
                                  {user.isAdmin ? "Admin active" : "Set admin"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() =>
                                    setDeleteTarget({ id: user.id, name: user.name })
                                  }
                                >
                                  Delete account
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {!usersLoading && hasActiveSearch && filteredUsers.length === 0 && (
                  <p className="text-sm text-panel-muted-foreground">
                    No users match that search.
                  </p>
                )}
              </div>
            </section>
          ) : null}

          {activeSection === "profile-info" ? (
            <section
              id="profile-info"
              className="rounded-2xl border border-border bg-panel p-6 shadow-sm ring-2 ring-brand-cta/30"
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Profile Info</h2>
                <p className="text-sm text-panel-muted-foreground">
                  Edit your public details and campus profile.
                </p>
              </div>

              <div className="mt-6 grid gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    className="bg-brand-cta text-brand-cta-foreground uppercase font-semibold tracking-wide hover:bg-brand-cta/90"
                    disabled={profileSaving || !session?.user?.id}
                    onClick={async () => {
                      if (!session?.user?.id) return;
                      setProfileSaving(true);
                      try {
                        const resp = await fetch(`/api/users/${session.user.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: displayName }),
                        });
                        if (!resp.ok) {
                          const message = await resp.text();
                          throw new Error(message || "Failed to update profile");
                        }
                        } catch (err) {
                        console.error(err);
                        toast.error("Failed to update profile.");
                      } finally {
                        setProfileSaving(false);
                      }
                    }}
                  >
                    {profileSaving ? "Saving..." : "Update profile"}
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="mt-8 rounded-2xl border border-border bg-panel p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Accessibility</h2>
            <p className="mt-1 text-sm text-panel-muted-foreground">
              We are committed to making IC Maps accessible to everyone. If you encounter any accessibility barriers, please let us know.
            </p>
            <a
              href="mailto:accessibility@ithaca.edu?subject=IC%20Maps%20Accessibility%20Issue"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-brand-cta bg-brand-cta/5 px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand-cta/10"
            >
              Report an accessibility issue
            </a>
          </section>
        </SidebarInset>
      </div>
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account</DialogTitle>
            <DialogDescription>
              This will permanently remove {deleteTarget?.name ?? "this user"}'s
              account and data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deletePending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || deletePending}
              onClick={async () => {
                if (!deleteTarget) return;
                setDeletePending(true);
                try {
                  const resp = await fetch(`/api/users/${deleteTarget.id}`, {
                    method: "DELETE",
                  });
                  if (!resp.ok) {
                    const message = await resp.text();
                    throw new Error(message || "Failed to delete user");
                  }
                  setUsers((prev) =>
                    prev.filter((row) => row.id !== deleteTarget.id),
                  );
                  setDeleteTarget(null);
                } catch (err) {
                  console.error(err);
                  toast.error("Failed to delete account.");
                } finally {
                  setDeletePending(false);
                }
              }}
            >
              {deletePending ? "Deleting..." : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
