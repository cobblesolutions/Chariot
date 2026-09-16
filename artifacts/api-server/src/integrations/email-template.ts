const BRAND_TEAL = "#064B3E";
const BRAND_COPPER = "#C46B2B";
const BODY_TEXT = "#2B2E2C";
const MUTED_TEXT = "#6B7570";

export interface ChariotEmailOptions {
  /** Short heading shown at the top of the message body. */
  heading: string;
  /** Inner body content as an array of paragraph strings (rendered as <p> tags), or raw HTML if `rawBody` is used. */
  paragraphs?: string[];
  /** Optional pre-rendered HTML block (tables, lists, etc.) inserted after the paragraphs. */
  rawBody?: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Optional short preview text shown in inbox lists, hidden in the rendered body. */
  preheader?: string;
}

/**
 * Wraps email body content in Chariot Financial Solutions' branded HTML
 * shell: logo header, formal typography, and a standard footer. Every
 * outbound email should be produced through this helper so formatting stays
 * consistent across purposes.
 */
export function renderChariotEmail(options: ChariotEmailOptions): string {
  // Email clients fetch <img> sources over the public internet, not through
  // the app's own routing, so this must be a fully-qualified, publicly
  // reachable URL. PORTAL_URL is the same publicly reachable base already
  // used for portal/reset links in these emails; chariot-logo.png is served
  // from the web app's public directory at that same origin.
  const portalUrl = process.env.PORTAL_URL?.replace(/\/$/, "");
  const logoUrl = portalUrl ? `${portalUrl}/chariot-logo.png` : undefined;

  const paragraphsHtml = (options.paragraphs ?? [])
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${BODY_TEXT};">${p}</p>`,
    )
    .join("");

  const ctaHtml = options.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;">
        <tr>
          <td style="border-radius:6px;background-color:${BRAND_COPPER};">
            <a href="${options.cta.url}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;letter-spacing:0.2px;">${options.cta.label}</a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chariot Financial Solutions</title>
  </head>
  <body style="margin:0;padding:0;background-color:#EEF1EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    ${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${options.preheader}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF1EF;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E3E7E4;">
            <tr>
              <td style="background-color:#ffffff;padding:32px 40px;text-align:center;border-bottom:3px solid ${BRAND_COPPER};">
                ${logoUrl ? `<img src="${logoUrl}" alt="Chariot Financial Solutions" height="40" style="height:40px;width:auto;display:inline-block;" />` : ""}
                <div style="margin-top:12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND_TEAL};font-weight:600;">Chariot Financial Solutions</div>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 40px 32px 40px;">
                <h1 style="margin:0 0 18px 0;font-size:20px;line-height:1.3;color:${BODY_TEXT};font-weight:700;">${options.heading}</h1>
                ${paragraphsHtml}
                ${options.rawBody ?? ""}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid #EDEFEC;">
                <p style="margin:0 0 6px 0;font-size:12px;line-height:1.6;color:${MUTED_TEXT};">
                  Chariot Financial Solutions is a trading name providing mortgage and financial case management services. This is an automated notification — please do not reply directly to this email if you require assistance; contact your case handler instead.
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED_TEXT};">
                  &copy; ${new Date().getFullYear()} Chariot Financial Solutions. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
