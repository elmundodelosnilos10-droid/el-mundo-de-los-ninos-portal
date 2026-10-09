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
    // External notices remain off until SQL31 and private provider configuration are approved.
    SCHOOL_NOTIFICATION_SETTINGS_ENABLED?: "disabled" | "schema31-ready";
    SCHOOL_NOTIFICATION_EMAIL_PROVIDER?: "disabled" | "resend";
    SCHOOL_NOTIFICATION_PUSH_PROVIDER?: "disabled" | "webpush";
    SCHOOL_NOTIFICATION_WORKER_ENABLED?: "disabled" | "manual-approved";
    SCHOOL_NOTIFICATION_RESEND_KEY?: string;
    SCHOOL_NOTIFICATION_EMAIL_FROM?: string;
    SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY?: string;
    SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY?: string;
    SCHOOL_NOTIFICATION_VAPID_SUBJECT?: string;
    APP_ORIGIN?: string;
  }
}
