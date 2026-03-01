
"use server";

export async function signUpAction(email: string, password: string, name: string) {
  return {
    success: false,
    message: "Server auth is disabled. Use client-side session flow.",
  };
}

export async function signInAction(email: string, password: string) {
  return {
    success: false,
    message: "Server auth is disabled. Use client-side session flow.",
  };
}

export async function signOutAction() {
  return { success: true, message: "No server session to clear." };
}
