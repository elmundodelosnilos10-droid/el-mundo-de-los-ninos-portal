import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasRole } from "@/lib/access";
import { PortalShell } from "@/components/portal-shell";
import { ConsentManager } from "./consent-manager";

export const dynamic = "force-dynamic";

export default async function Consentimientos() {
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  if (!hasRole(actor, "superadmin", "direccion")) redirect("/");
  return <PortalShell name={actor.name} role={actor.roles[0] ?? "direccion"} active="/consentimientos"><p className="eyebrow">PRIVACIDAD Y CONTROL</p><h1>Autorizaciones documentadas</h1><p className="page-intro">Registro interno de decisiones que la escuela ya obtuvo mediante su aviso y formato aprobados.</p><ConsentManager /></PortalShell>;
}
