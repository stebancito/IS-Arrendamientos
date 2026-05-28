const SUPABASE_URL = 'https://rsrovjfvjnhhmfnqwsws.supabase.co';   // URL del proyecto
const SUPABASE_ANON_KEY = '******';                     // Clave anónima

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
