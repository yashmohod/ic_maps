export const ITHACA_EDU_DOMAIN = "ithaca.edu";

export const IC_SSO_REQUIRED_MESSAGE =
  "Ithaca College accounts (@ithaca.edu) must sign in with Microsoft SSO.";

export function emailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

export function isIthacaEduEmail(email: string): boolean {
  return emailDomain(email) === ITHACA_EDU_DOMAIN;
}
