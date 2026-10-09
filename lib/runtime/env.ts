/** Server runtime environment for Next.js / Vercel.
 * Sites replaces this module with env.cloudflare.ts at build time. Real D1/R2
 * bindings therefore remain available there; Node never invents those bindings.
 * Keep this import in server components and route handlers only.
 */
export const env = process.env as unknown as Cloudflare.Env;
