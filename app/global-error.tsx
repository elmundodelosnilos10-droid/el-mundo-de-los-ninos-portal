"use client";

import { PortalFallback, type PortalErrorProps } from "@/components/portal-fallback";

export default function GlobalError({ reset, retry }: PortalErrorProps) {
  return <html lang="es-MX">
    <head><title>El Mundo de los Niños · Volver a intentar</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
    <body style={{ margin: 0, background: "#f8faf4" }}><PortalFallback kind="error" onRetry={retry ?? reset} /></body>
  </html>;
}
