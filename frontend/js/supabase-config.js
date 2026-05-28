const SUPABASE_URL = 'https://rsrovjfvjnhhmfnqwsws.supabase.co';   // URL del proyecto
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzcm92amZ2am5oaG1mbnF3c3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwODQsImV4cCI6MjA5NTQ3NDA4NH0._54cSp_uBRS7ThaRu9k9NvZ92NIV_Rk7GepNN3HX-cA';                     // Clave anónima
// Crear el cliente de Supabase (una sola vez)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Exponerlo globalmente para que otros scripts lo usen
window.supabaseClient = supabaseClient;
