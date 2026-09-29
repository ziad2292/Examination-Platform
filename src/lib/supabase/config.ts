export function hasSupabaseConfig() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); }
export function getSupabaseConfig() { const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; if(!url||!key) throw new Error("Supabase is not configured. Copy .env.example to .env.local."); return {url,key}; }
