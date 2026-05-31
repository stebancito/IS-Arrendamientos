// ================================================================
// supabase-config.js  –  Cliente Supabase CENTRALIZADO
// ================================================================
// Incluir este script PRIMERO en TODAS las páginas, antes
// que auth.js, layout.js o cualquier otro módulo propio.
// ================================================================

const SUPABASE_URL = 'https://rsrovjfvjnhhmfnqwsws.supabase.co';
const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzcm92amZ2am5oaG1mbnF3c3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4OTgwODQsImV4cCI6MjA5NTQ3NDA4NH0.' +
    '_54cSp_uBRS7ThaRu9k9NvZ92NIV_Rk7GepNN3HX-cA';

// Inicialización única — todos los scripts usan window.supabaseClient
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * esc(valor)
 * Escapa HTML para prevenir XSS almacenado.
 * Úsalo en TODA interpolación que se inyecte con innerHTML.
 *
 * @param {*} valor
 * @returns {string}
 */
function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}
window.esc = esc;