"server-only";

export const auth = {
  api: {
    signUpEmail: async () => ({ ok: false }),
    signInEmail: async () => ({ ok: false }),
    signOut: async () => ({ ok: true }),
    getSession: async () => null,
  },
};
