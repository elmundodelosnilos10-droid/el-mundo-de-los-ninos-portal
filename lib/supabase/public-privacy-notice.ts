export type PublicPrivacyNotice = {
  version: string; responsibleName: string; address: string; contactName: string; contactEmail: string;
  personalDataCategories: string; sensitiveDataCategories: string; purposes: string; consentPurposes: string;
  limitationMeans: string; arcoProcedure: string; noticeChanges: string; processorsAndTransfers: string; effectiveDate: string;
};
const fields: (keyof PublicPrivacyNotice)[] = ["version", "responsibleName", "address", "contactName", "contactEmail", "personalDataCategories", "sensitiveDataCategories", "purposes", "consentPurposes", "limitationMeans", "arcoProcedure", "noticeChanges", "processorsAndTransfers", "effectiveDate"];

/** Separate from the authenticated database client: this endpoint returns only
 * the legal notice explicitly approved and published by the school. */
export async function readPublicPrivacyNotice(environment: { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }, fetcher: typeof fetch = fetch): Promise<PublicPrivacyNotice | null> {
  try {
    const base = new URL(environment.SUPABASE_URL ?? "");
    const key = environment.SUPABASE_PUBLISHABLE_KEY;
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !key || /[\r\n]/.test(key)) throw new Error();
    const response = await fetcher(new URL("/rest/v1/rpc/school_public_privacy_notice", base), {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_version: 1 }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json() as { notice?: unknown };
    if (body.notice === null) return null;
    const notice = body.notice;
    if (!notice || typeof notice !== "object" || fields.some(field => typeof (notice as Record<string, unknown>)[field] !== "string")) throw new Error();
    // Whitelist fields before rendering; no identifiers or future RPC fields pass through.
    return Object.fromEntries(fields.map(field => [field, (notice as Record<string, unknown>)[field]])) as PublicPrivacyNotice;
  } catch {
    throw new Error("Public privacy notice unavailable");
  }
}
