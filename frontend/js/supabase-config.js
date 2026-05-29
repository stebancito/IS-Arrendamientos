const SUPABASE_URL = 'https://rsrovjfvjnhhmfnqwsws.supabase.co';   // URL del proyecto
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzcm92amZ2am5oaG1mbnF3c3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwODQsImV4cCI6MjA5NTQ3NDA4NH0._54cSp_uBRS7ThaRu9k9NvZ92NIV_Rk7GepNN3HX-cA';                     // Clave anónima
// Crear el cliente de Supabase (una sola vez)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Exponerlo globalmente para que otros scripts lo usen
window.supabaseClient = supabaseClient;

// Escape de HTML para todo contenido dinámico que se inyecta con innerHTML.
// Previene XSS almacenado (p. ej. un inquilino que mete <script> en una incidencia).
function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.esc = esc;
