import { createSchoolDatabaseClient, type SupabaseDatabaseEnvironment } from "./database";
import type { InternalActivationSession } from "./internal-activation";

/** User-scoped RPCs only; the database owns the durable one-use decision. */
export async function claimInternalActivation(environment: SupabaseDatabaseEnvironment, session: InternalActivationSession) {
  const result = await createSchoolDatabaseClient(environment).rpc(session.accessToken, "school_claim_internal_activation", { p_invitation_nonce: session.nonce });
  const receipt = result.data[0];
  if (result.data.length !== 1 || !receipt || Object.keys(receipt).length !== 1 || typeof receipt.claimed !== "boolean") throw new Error("Activation claim could not be confirmed");
  return receipt.claimed;
}

/** Check before creating an Auth identity so an unapplied migration fails closed. */
export async function isInternalActivationDatabaseReady(environment: SupabaseDatabaseEnvironment, accessToken: string) {
  const result = await createSchoolDatabaseClient(environment).rpc(accessToken, "school_internal_activation_ready", {});
  const receipt = result.data[0];
  return result.data.length === 1 && receipt?.ready === true && receipt.version === 32 && Object.keys(receipt).length === 2;
}
