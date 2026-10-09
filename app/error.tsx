"use client";

import { PortalFallback, type PortalErrorProps } from "@/components/portal-fallback";

export default function PageError({ reset, retry }: PortalErrorProps) {
  return <PortalFallback kind="error" onRetry={retry ?? reset} />;
}
