import type { Metadata } from "next";
import { PortalFallback } from "@/components/portal-fallback";

export const metadata: Metadata = { title: "Página no disponible · El Mundo de los Niños", robots: { index: false, follow: false } };

export default function NotFound() {
  return <PortalFallback kind="not-found" />;
}
