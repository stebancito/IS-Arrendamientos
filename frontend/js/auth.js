// ================================================================
// auth.js  –  Módulo de Autenticación con Supabase Auth
// ================================================================
// Patrón IIFE → expuesto en window.AUTH para acceso global.
// Requiere: supabase-config.js cargado previamente.
// ================================================================

const AUTH = (() => {

    // ──────────────────────────────────────────────────────────────
    // PRIVADO: resolver rutas según profundidad de directorio
    // ──────────────────────────────────────────────────────────────
    function _root() {
        // Si estamos en /pages/, subimos un nivel para llegar al root
        return window.location.pathname.includes('/pages/') ? '../' : '';
    }

    // ──────────────────────────────────────────────────────────────
    // PRIVADO: UI helpers — spinner y alertas en formularios
    // ──────────────────────────────────────────────────────────────
    function _setLoading(btnEl, isLoading, textoOriginal) {
        if (!btnEl) return;
        if (isLoading) {
            btnEl.disabled = true;
            btnEl.setAttribute('data-original-text', btnEl.innerHTML);
            btnEl.innerHTML = `
                <svg class="animate-spin h-5 w-5 text-white mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>`;
        } else {
            btnEl.disabled = false;
            btnEl.innerHTML = btnEl.getAttribute('data-original-text') || textoOriginal || 'Continuar';
        }
    }

    function _mostrarAlerta(contenedorId, mensaje, tipo = 'error') {
        const el = document.getElementById(contenedorId);
        if (!el) return;
        const esError = tipo === 'error';
        el.className = `mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-start gap-2 transition-all duration-300 ${
            esError
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-green-50 border border-green-200 text-green-700'
        }`;
        el.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                ${esError
                    ? '<path fill-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 13v-2h2v2h-2zm0-4V7h2v4h-2z" clip-rule="evenodd"/>'
                    : '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>'}
            </svg>
            <span>${esc(mensaje)}</span>`;
        el.classList.remove('hidden');
        // Auto-ocultar después de 6 s
        setTimeout(() => el.classList.add('hidden'), 6000);
    }

    // ──────────────────────────────────────────────────────────────
    // PRIVADO: Obtener perfil desde la tabla pública "usuarios"
    // ──────────────────────────────────────────────────────────────
    // PRIVADO: Obtener perfil por auth_user_id (no lanza 406 si no existe)
async function _obtenerPerfil(authUserId) {
    const { data, error } = await window.supabaseClient
        .from('usuarios')
        .select('usuario_id, auth_user_id, correo, rol, nombre_completo, telefono, activo')
        .eq('auth_user_id', authUserId)
        .maybeSingle();  // ← clave: evita error 406

    if (error) {
        console.error('[AUTH] Error al consultar perfil:', error);
        return null;
    }
    return data;
}

// Función para crear/actualizar perfil si no existe o está corrupto
async function _asegurarPerfil(sessionUser) {
    // 1. Intentar obtener por auth_user_id
    let perfil = await _obtenerPerfil(sessionUser.id);
    if (perfil) return perfil;

    // 2. No encontrado por auth_user_id → buscar por correo (por si el trigger asignó mal el UUID)
    const { data: porCorreo, error: errCorreo } = await window.supabaseClient
        .from('usuarios')
        .select('*')
        .eq('correo', sessionUser.email)
        .maybeSingle();

    if (porCorreo && !errCorreo) {
        // Corregir el auth_user_id para vincularlo correctamente
        const { data: actualizado, error: errUpdate } = await window.supabaseClient
            .from('usuarios')
            .update({ auth_user_id: sessionUser.id })
            .eq('usuario_id', porCorreo.usuario_id)
            .select()
            .single();
        if (!errUpdate && actualizado) return actualizado;
    }

    // 3. No existe ningún perfil con ese correo → crearlo nuevo
    const rolDesdeMeta = (sessionUser.user_metadata?.rol === 'ARRENDADOR') ? 'ARRENDADOR' : 'INQUILINO';
    const nombreDesdeMeta = sessionUser.user_metadata?.nombre_completo || sessionUser.email.split('@')[0];

    const { data: nuevo, error: errInsert } = await window.supabaseClient
        .from('usuarios')
        .insert({
            auth_user_id: sessionUser.id,
            correo: sessionUser.email,
            rol: rolDesdeMeta,
            nombre_completo: nombreDesdeMeta,
            activo: true
        })
        .select()
        .single();

    if (errInsert) {
        console.error('[AUTH] No se pudo crear perfil:', errInsert);
        return null;
    }
    return nuevo;
}

// Modificar iniciarSesion para usar _asegurarPerfil
async function iniciarSesion(correo, contrasena, btnEl) {
    _setLoading(btnEl, true);
    try {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: correo,
            password: contrasena,
        });
        if (error) throw error;

        const perfil = await _asegurarPerfil(data.user);
        if (!perfil) throw new Error('No se pudo obtener ni crear el perfil.');

        sessionStorage.setItem('ua_perfil', JSON.stringify(perfil));

        // Actualizar último acceso (sin esperar)
        window.supabaseClient
            .from('usuarios')
            .update({ ultimo_acceso: new Date().toISOString() })
            .eq('auth_user_id', data.user.id)
            .then(() => {});

        const root = _root();
        if (perfil.rol === 'ARRENDADOR') {
            window.location.href = root + 'pages/dashboard-arrendador.html';
        } else {
            window.location.href = root + 'pages/dashboard-inquilino.html';
        }
    } catch (err) {
        _setLoading(btnEl, false);
        let msg = 'Error al iniciar sesión.';
        if (err.message?.includes('Invalid login credentials')) msg = 'Correo o contraseña incorrectos.';
        else if (err.message?.includes('Email not confirmed'))  msg = 'Confirma tu correo antes de ingresar.';
        else if (err.message) msg = err.message;
        _mostrarAlerta('login-alert', msg, 'error');
    }
}

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: verificarSesion()
    // Llama esto AL INICIO de cualquier página protegida.
    // Si no hay sesión activa → redirige a login automáticamente.
    // ──────────────────────────────────────────────────────────────
    async function verificarSesion() {
        try {
            const { data: { session } } = await window.supabaseClient.auth.getSession();
            if (!session) {
                window.location.replace(_root() + 'index.html');
                return null;
            }
            return session;
        } catch (err) {
            console.error('[AUTH] Error al verificar sesión:', err);
            window.location.replace(_root() + 'index.html');
            return null;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: obtenerUsuarioActual()
    // Primero intenta desde sessionStorage (caché local).
    // Si no existe, consulta Supabase y guarda en sessionStorage.
    // ──────────────────────────────────────────────────────────────
    async function obtenerUsuarioActual() {
        const cached = sessionStorage.getItem('ua_perfil');
        if (cached) {
            try { return JSON.parse(cached); } catch (_) { /* caché corrupta */ }
        }

        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return null;

        const perfil = await _obtenerPerfil(session.user.id);
        if (perfil) sessionStorage.setItem('ua_perfil', JSON.stringify(perfil));
        return perfil;
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: iniciarSesion(correo, contrasena, btnEl?)
    // Autenticación con email + password.
    // Redirige según el rol (ARRENDADOR / INQUILINO).
    // ──────────────────────────────────────────────────────────────
    // async function iniciarSesion(correo, contrasena, btnEl) {
    //     _setLoading(btnEl, true);
    //     try {
    //         const { data, error } = await window.supabaseClient.auth.signInWithPassword({
    //             email: correo,
    //             password: contrasena,
    //         });
    //         if (error) throw error;

    //         let perfil = await _obtenerPerfil(data.user.id);
    //         if (!perfil) {
    //             // Intento de inserción manual
    //             const { data: newPerfil, error: insertError } = await window.supabaseClient
    //                 .from('usuarios')
    //                 .insert({
    //                     auth_user_id: data.user.id,
    //                     correo: data.user.email,
    //                     rol: data.user.user_metadata?.rol || 'INQUILINO',
    //                     nombre_completo: data.user.user_metadata?.nombre_completo || data.user.email.split('@')[0],
    //                     activo: true
    //                 })
    //                 .select()
    //                 .single();
    //             if (insertError) throw new Error('No se pudo crear el perfil automáticamente.');
    //             perfil = newPerfil;
    //         }

    //         // Caché local
    //         sessionStorage.setItem('ua_perfil', JSON.stringify(perfil));

    //         // Registrar último acceso (sin bloquear la navegación)
    //         window.supabaseClient
    //             .from('usuarios')
    //             .update({ ultimo_acceso: new Date().toISOString() })
    //             .eq('auth_user_id', data.user.id)
    //             .then(() => {});

    //         // Redirigir según rol
    //         const root = _root();
    //         if (perfil.rol === 'ARRENDADOR') {
    //             window.location.href = root + 'pages/dashboard-arrendador.html';
    //         } else {
    //             window.location.href = root + 'pages/dashboard-inquilino.html';
    //         }
    //     } catch (err) {
    //         _setLoading(btnEl, false);
    //         let msg = 'Error al iniciar sesión. Inténtalo de nuevo.';
    //         if (err.message?.includes('Invalid login credentials')) msg = 'Correo o contraseña incorrectos.';
    //         else if (err.message?.includes('Email not confirmed'))  msg = 'Debes confirmar tu correo antes de ingresar.';
    //         else if (err.message)                                   msg = err.message;
    //         _mostrarAlerta('login-alert', msg, 'error');
    //     }
    // }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: registrarUsuario(nombre, correo, contrasena, rol, btnEl?)
    // Crea la cuenta en Supabase Auth.
    // El trigger handle_new_user() en BD crea el perfil automáticamente.
    // ──────────────────────────────────────────────────────────────
    async function registrarUsuario(nombre, correo, contrasena, rol, telefono, btnEl) {
        _setLoading(btnEl, true);
        try {
            const { error, data } = await window.supabaseClient.auth.signUp({
                email: correo,
                password: contrasena,
                options: {
                    data: {
                        nombre_completo: nombre,
                        rol,
                        telefono
                    },
                },
            });
            if (error) throw error;

            // Si el registro fue exitoso, iniciamos sesión automáticamente
            if (data?.user) {
                // Inicio de sesión inmediato (sin mostrar alertas de "revisa tu correo")
                await iniciarSesion(correo, contrasena, btnEl);
            } else {
                // Caso extraño: mostrar error genérico
                throw new Error('No se pudo crear la cuenta.');
            }
        } catch (err) {
            _setLoading(btnEl, false);
            let msg = 'Error al crear la cuenta. Inténtalo de nuevo.';
            if (err.message?.includes('already registered')) msg = 'Este correo ya tiene una cuenta registrada.';
            else if (err.message?.includes('Password should'))  msg = 'La contraseña debe tener al menos 6 caracteres.';
            else if (err.message)                               msg = err.message;
            _mostrarAlerta('register-alert', msg, 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: cerrarSesion()
    // Limpia sesión local y redirige al login.
    // ──────────────────────────────────────────────────────────────
    async function cerrarSesion() {
        try {
            await window.supabaseClient.auth.signOut();
        } finally {
            sessionStorage.clear();
            window.location.replace(_root() + 'index.html');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Listener global: limpiar caché cuando Supabase expira la sesión
    // ──────────────────────────────────────────────────────────────
    window.supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
            if (event === 'SIGNED_OUT') sessionStorage.clear();
        }
    });

    // Exponer helpers UI para uso en páginas si hace falta
    return {
        verificarSesion,
        obtenerUsuarioActual,
        iniciarSesion,
        registrarUsuario,
        cerrarSesion,
        // helpers UI disponibles para otras páginas
        mostrarAlerta: _mostrarAlerta,
        setLoading:    _setLoading,
    };
})();

window.AUTH = AUTH;