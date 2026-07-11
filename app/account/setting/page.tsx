"use client";

import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { Shield, UserRound, Star, Route } from "lucide-react";

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
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Spinner } from "@/components/ui/spinner";
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
  useSidebar,
} from "@/components/ui/sidebar";

export default function Setting() {
  const { session, isPending, allowed } = useRequireAuth("/account/setting");
  const { isAdmin, isPending: isAdminPending, userId } = useIsAdmin();
  const [users, setUsers] = useState<
    Array<{ id: string; name: string; email: string; isAdmin: boolean }>
  >([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState("profile-info");
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
  const [favorites, setFavorites] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [chains, setChains] = useState<
    Array<{
      id: number;
      name: string;
      destinations: Array<{ id: number; name: string }>;
    }>
  >([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const { state, open } = useSidebar();
  const isCollapsed = state === "collapsed";

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const resp = await fetch(withBasePath("/api/users"));
      if (!resp.ok) throw new Error("Failed to load users");
      const data = (await resp.json()) as {
        users: Array<{
          id: string;
          name: string;
          email: string;
          isAdmin: boolean;
        }>;
      };
      setUsers(data.users);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load users.");
    } finally {
      setUsersLoading(false);
    }
  };

  async function setUserAdmin(userId: string, nextIsAdmin: boolean) {
    setAdminUpdatePending((prev) => new Set(prev).add(userId));
    try {
      const resp = await fetch(withBasePath(`/api/users/${userId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: nextIsAdmin }),
      });
      if (!resp.ok) {
        const message = await resp.text();
        throw new Error(message || "Failed to update user");
      }
      const data = (await resp.json()) as {
        user: { id: string; name: string; email: string; isAdmin: boolean };
      };
      setUsers((prev) =>
        prev.map((row) =>
          row.id === data.user.id
            ? { ...row, isAdmin: data.user.isAdmin }
            : row,
        ),
      );
      toast.success(
        data.user.isAdmin
          ? `${data.user.name} is now an admin`
          : `Admin access removed for ${data.user.name}`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to update admin status.");
    } finally {
      setAdminUpdatePending((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  useEffect(() => {
    if (session?.user?.name) setDisplayName(session.user.name);
  }, [session?.user?.name]);

  const loadSavedPlaces = async () => {
    if (!session?.user?.id) return;
    setSavedLoading(true);
    try {
      const [favResp, chainResp] = await Promise.all([
        fetch(withBasePath("/api/favorites")),
        fetch(withBasePath("/api/destination-chains")),
      ]);
      if (favResp.ok) {
        const data = (await favResp.json()) as {
          favorites?: Array<{ id: number; name: string }>;
        };
        setFavorites(data.favorites ?? []);
      }
      if (chainResp.ok) {
        const data = (await chainResp.json()) as {
          chains?: Array<{
            id: number;
            name: string;
            destinations: Array<{ id: number; name: string }>;
          }>;
        };
        setChains(data.chains ?? []);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load saved places.");
    } finally {
      setSavedLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    if (activeSection !== "saved-places") return;
    void loadSavedPlaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, activeSection]);

  useEffect(() => {
    if (!isAdmin || activeSection !== "account-management") return;
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeSection]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  const adminCount = useMemo(
    () => users.filter((user) => user.isAdmin).length,
    [users],
  );

  if (isPending || !allowed || isAdminPending) {
    return (
      <div className="grid min-h-svh place-items-center bg-background text-foreground">
        <Spinner className="size-10" />
      </div>
    );
  }

  return (
    <main
      id="main-content"
      className="relative min-h-svh w-full bg-background text-foreground"
    >
      <h1 className="sr-only">Settings</h1>
      <div className="flex w-full pt-20">
        <Sidebar
          side="left"
          variant="inset"
          collapsible="icon"
          className="border-r border-border bg-panel text-panel-foreground"
        >
          <SidebarHeader className="bg-panel">
            <div
              className={`flex items-center w-24 justify-center ${isCollapsed ? "ml-[-30px]" : "ml-[50px]"}`}
            >
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
                  {session ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={activeSection === "saved-places"}
                        onClick={() => setActiveSection("saved-places")}
                      >
                        <Star />
                        <span>Saved Places</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                  {isAdmin ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={activeSection === "account-management"}
                        onClick={() => setActiveSection("account-management")}
                      >
                        <Shield />
                        <span>Admin access</span>
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
                <div className="flex items-center gap-2">
                  <Shield
                    className="size-5 text-brand-cta"
                    aria-hidden="true"
                  />
                  <h2 className="text-lg font-semibold">Admin access</h2>
                </div>
                <p className="text-sm text-panel-muted-foreground">
                  Grant or revoke admin privileges. Admins can edit
                  destinations, routes, and floorplans.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <span className="rounded-full border border-border bg-panel-muted px-3 py-1 font-medium">
                  {adminCount} admin{adminCount === 1 ? "" : "s"}
                </span>
                <span className="rounded-full border border-border bg-panel-muted px-3 py-1 font-medium">
                  {users.length} account{users.length === 1 ? "" : "s"} total
                </span>
              </div>

              <div className="mt-6 grid gap-4">
                <div className="max-w-md">
                  <Label htmlFor="user-search">Find an account</Label>
                  <div className="mt-2">
                    <Input
                      id="user-search"
                      placeholder="Search by name or email"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>
                  <p className="mt-2 text-xs text-panel-muted-foreground">
                    Users must sign in at least once before they appear here.
                  </p>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-brand text-brand-foreground text-left">
                      <tr>
                        <th
                          className="px-4 py-3 text-start font-semibold"
                          scope="col"
                        >
                          User
                        </th>
                        <th
                          className="px-4 py-3 text-start font-semibold"
                          scope="col"
                        >
                          Email
                        </th>
                        <th
                          className="px-4 py-3 text-start font-semibold"
                          scope="col"
                        >
                          Role
                        </th>
                        <th
                          className="px-4 py-3 text-end font-semibold"
                          scope="col"
                        >
                          Admin access
                        </th>
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
                      ) : filteredUsers.length === 0 ? (
                        <tr className="border-t border-border/70">
                          <td
                            className="px-4 py-6 text-center text-panel-muted-foreground"
                            colSpan={4}
                          >
                            {searchQuery.trim()
                              ? "No users match that search."
                              : "No accounts yet."}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isSelf = user.id === userId;
                          const pending = adminUpdatePending.has(user.id);
                          return (
                            <tr
                              key={user.id}
                              className="border-t border-border/70"
                            >
                              <td className="px-4 py-3 font-medium">
                                {user.name}
                                {isSelf ? (
                                  <span className="ml-2 text-xs font-normal text-panel-muted-foreground">
                                    (you)
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 text-panel-muted-foreground">
                                {user.email}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={[
                                    "inline-flex rounded-full border px-2 py-1 text-xs font-semibold",
                                    user.isAdmin
                                      ? "border-brand-cta/40 bg-brand-cta/10 text-brand-cta-foreground dark:text-brand-cta"
                                      : "border-border",
                                  ].join(" ")}
                                >
                                  {user.isAdmin ? "Admin" : "User"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                      user.isAdmin ? "outline" : "default"
                                    }
                                    className={
                                      user.isAdmin
                                        ? undefined
                                        : "bg-brand-cta text-brand-cta-foreground hover:bg-brand-cta/90"
                                    }
                                    onClick={() =>
                                      void setUserAdmin(user.id, !user.isAdmin)
                                    }
                                    disabled={
                                      pending || (isSelf && user.isAdmin)
                                    }
                                    title={
                                      isSelf && user.isAdmin
                                        ? "You cannot revoke your own admin access"
                                        : undefined
                                    }
                                  >
                                    {pending
                                      ? "Saving…"
                                      : user.isAdmin
                                        ? "Revoke admin"
                                        : "Grant admin"}
                                  </Button>
                                  {!isSelf ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      onClick={() =>
                                        setDeleteTarget({
                                          id: user.id,
                                          name: user.name,
                                        })
                                      }
                                    >
                                      Delete
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === "saved-places" && session ? (
            <section
              id="saved-places"
              className="rounded-2xl border border-border bg-panel p-6 shadow-sm ring-2 ring-brand-cta/30"
            >
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Saved Places</h2>
                <p className="text-sm text-panel-muted-foreground">
                  Manage favorites and multi-stop chains from the home map.
                </p>
              </div>

              {savedLoading ? (
                <p className="mt-6 text-sm text-panel-muted-foreground">
                  Loading…
                </p>
              ) : (
                <div className="mt-6 grid gap-8">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-panel-muted-foreground">
                      Favorites
                    </h3>
                    {favorites.length === 0 ? (
                      <p className="mt-2 text-sm text-panel-muted-foreground">
                        No favorites yet. Star buildings on the home map.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {favorites.map((fav) => (
                          <li
                            key={fav.id}
                            className="flex min-h-11 items-center justify-between rounded-xl border border-border px-4 py-2"
                          >
                            <span className="font-medium">{fav.name}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="min-h-11"
                              onClick={async () => {
                                try {
                                  const resp = await fetch(withBasePath(`/api/favorites?destinationId=${encodeURIComponent(fav.id)}`), { method: "DELETE" });
                                  if (!resp.ok)
                                    throw new Error("delete failed");
                                  setFavorites((prev) =>
                                    prev.filter((row) => row.id !== fav.id),
                                  );
                                  toast.success("Favorite removed");
                                } catch (err) {
                                  console.error(err);
                                  toast.error("Could not remove favorite");
                                }
                              }}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-panel-muted-foreground">
                      Destination chains
                    </h3>
                    {chains.length === 0 ? (
                      <p className="mt-2 text-sm text-panel-muted-foreground">
                        No saved chains yet. Build a trip on the home map and
                        save it.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-3">
                        {chains.map((chain) => (
                          <li
                            key={chain.id}
                            className="rounded-xl border border-border px-4 py-3"
                          >
                            <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 font-medium">
                                <Route className="size-4" aria-hidden="true" />
                                {chain.name}
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                className="min-h-11"
                                onClick={async () => {
                                  try {
                                    const resp = await fetch(withBasePath(`/api/destination-chains?id=${encodeURIComponent(chain.id)}`), { method: "DELETE" });
                                    if (!resp.ok)
                                      throw new Error("delete failed");
                                    setChains((prev) =>
                                      prev.filter((row) => row.id !== chain.id),
                                    );
                                    toast.success("Chain deleted");
                                  } catch (err) {
                                    console.error(err);
                                    toast.error("Could not delete chain");
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </div>
                            <p className="mt-2 text-sm text-panel-muted-foreground">
                              {chain.destinations
                                .map((d, i) => `${i + 1}. ${d.name}`)
                                .join(" → ")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
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
                    disabled={profileSaving || !userId}
                    onClick={async () => {
                      if (!userId) return;
                      setProfileSaving(true);
                      try {
                        const resp = await fetch(withBasePath(`/api/users/${userId}`), {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: displayName }),
                        });
                        if (!resp.ok) {
                          const message = await resp.text();
                          throw new Error(
                            message || "Failed to update profile",
                          );
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
                  const resp = await fetch(withBasePath(`/api/users/${deleteTarget.id}`), {
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
