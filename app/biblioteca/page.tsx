import { env } from "@/lib/runtime/env";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getSchoolPageActor } from "@/lib/supabase/page-actor";
import { getDb } from "@/db";
import { groups } from "@/db/schema";
import { accessibleGroupIds, hasRole } from "@/lib/access";
import { createSchoolDatabaseClient } from "@/lib/supabase/database";
import { PortalShell } from "@/components/portal-shell";
import { LibraryManager } from "./library-manager";
import { isFileScannerConfigured } from "@/lib/file-scanner";
import { isFileStorageConfigured } from "@/lib/file-storage";
export const dynamic="force-dynamic";
export default async function Biblioteca(){
  const actor = await getSchoolPageActor(await headers());
  if (!actor) redirect("/ingresar");
  const role = actor.roles[0];
  if (!role) redirect("/");
  let groupsForUser: {id:string;name:string}[];
  if(env.SCHOOL_DATA_PROVIDER === "supabase"){
    if (!actor.supabaseAuth)redirect("/ingresar");
    try{
      const result=await createSchoolDatabaseClient(env).select<{id:string;name:string}>(actor.supabaseAuth.accessToken,"groups",{
        columns:["id","name"],filters:[{column:"active",operator:"eq",value:true}],orderBy:[{column:"name"},{column:"id"}],limit:500,
      });
      groupsForUser=result.data;
    }catch{
      return <PortalShell name={actor.name} role={role} active="/biblioteca"><p className="eyebrow">MATERIALES ESCOLARES</p><h1>Biblioteca de actividades</h1><p className="form-error" role="alert">No se pudieron cargar los grupos desde Supabase. Inténtalo en unos minutos.</p></PortalShell>;
    }
  }else{
    const db = getDb();
    const ids=await accessibleGroupIds(actor);
    groupsForUser=ids.length?await db.select({id:groups.id,name:groups.name}).from(groups).where(and(inArray(groups.id,ids),eq(groups.active,true))):[];
  }
  return <PortalShell name={actor.name} role={role} active="/biblioteca"><p className="eyebrow">MATERIALES ESCOLARES</p><h1>Biblioteca de actividades</h1><p className="page-intro">Guías, lecturas, imágenes y recursos descargables organizados por grupo.</p><LibraryManager groups={groupsForUser} canUpload={hasRole(actor,"superadmin","direccion","docente")} uploadsReady={isFileStorageConfigured(env) && isFileScannerConfigured({url:env.SCHOOL_FILE_SCAN_URL,token:env.SCHOOL_FILE_SCAN_TOKEN})}/></PortalShell>;
}
