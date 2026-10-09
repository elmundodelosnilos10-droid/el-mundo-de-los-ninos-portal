declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SCHOOL_FILE_SCAN_URL?: string;
    SCHOOL_FILE_SCAN_TOKEN?: string;
    SCHOOL_FILE_SCAN_LOCAL_MOCK?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    SCHOOL_SETUP_TOKEN?: string;
    SCHOOL_PASSWORD_SET_TOKEN?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    GMAIL_CLIENT_ID?: string;
    GMAIL_CLIENT_SECRET?: string;
    GMAIL_REFRESH_TOKEN?: string;
    GMAIL_SENDER_EMAIL?: string;
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    SUPABASE_SECRET_KEY?: string;
    SUPABASE_STORAGE_BUCKET?: string;
    SCHOOL_FILE_STORAGE_PROVIDER?: "r2" | "supabase";
    SCHOOL_AUTH_PROVIDER?: "better-auth" | "supabase";
    SCHOOL_DATA_PROVIDER?: "d1" | "supabase";
    SCHOOL_REALTIME_PROVIDER?: "disabled" | "supabase";
    APP_ORIGIN?: string;
  }
}
