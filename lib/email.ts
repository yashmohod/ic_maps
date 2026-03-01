import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const resend =
  resendApiKey && resendApiKey.length > 0
    ? new Resend(resendApiKey)
    : null;

export async function sendDevEmail(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!resend) {
    // Resend disabled: no API key. No-op so auth flows don't break.
    return { data: null, error: null };
  }
  return resend.emails.send({
    from: "IC Maps <onboarding@resend.dev>",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

