import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import { PrivacyRequestManager } from "./privacy-request-manager";

export const dynamic = "force-dynamic";

export default async function Privacidad() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const canReview = hasRole(actor, "superadmin", "direccion");
  if (!canReview && !hasRole(actor, "tutor")) redirect("/");
  return <PortalShell name={actor.name} role={actor.roles[0] ?? "tutor"} active="/privacidad"><p className="eyebrow">DATOS PERSONALES</p><h1>Solicitudes de privacidad</h1><p className="page-intro">Familias pueden solicitar acceso, corrección o eliminación de información vinculada a sus hijos.</p><PrivacyRequestManager canReview={canReview} /></PortalShell>;
}
