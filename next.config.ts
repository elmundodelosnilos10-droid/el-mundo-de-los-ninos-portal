import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Sites-only Vite/Worker build sources out of Next type checking.
  typescript: { tsconfigPath: "tsconfig.next.json" },
};

export default nextConfig;
