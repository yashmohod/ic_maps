export const DEV_BYPASS_USER = {
  id: "dev-bypass-user",
  name: "Dev User",
  email: "dev@local.icmaps",
  isAdmin: true,
} as const;

export type DevBypassSession = {
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    token: string;
  };
};

export function createDevBypassSession(
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin: boolean;
  } = DEV_BYPASS_USER,
): DevBypassSession {
  return {
    user,
    session: {
      id: "dev-bypass-session",
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      token: "dev-bypass-token",
    },
  };
}
