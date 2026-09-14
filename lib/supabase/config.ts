/** Supabase connection settings shared by the browser, server and middleware clients. */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False until `.env.local` provides both values; the app shows a setup screen in that case. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
