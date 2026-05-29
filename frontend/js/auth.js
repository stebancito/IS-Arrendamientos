/* ============================================
   AUTENTICACIÓN — Dev 1
   Registro, login, logout, sesión y protección
   de rutas vía Supabase Auth.
   ============================================ */

const Auth = {

    _ruta(archivo) {
        return window.location.pathname.includes('/pages/') ? archivo : 'pages/' + archivo;
    },

    async registrar({ email, password, nombre_completo, rol, telefono }) {
        const { data, error } = await window.supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { nombre_completo, rol, telefono } }
        });
        if (error) return { error };

        // El trigger handle_new_user() crea la fila en `usuarios`.
        // Si es INQUILINO, esperamos al trigger y creamos la fila en `inquilinos`.
        if (data.user) {
            let usuario = null;
            // Hasta ~6s de espera para que el trigger inserte en `usuarios`.
            for (let i = 0; i < 12; i++) {
                await new Promise(r => setTimeout(r, 500));
                const { data: u } = await window.supabaseClient
                    .from('usuarios')
                    .select('usuario_id')
                    .eq('auth_user_id', data.user.id)
                    .maybeSingle();
                if (u) { usuario = u; break; }
            }
            if (!usuario) {
                console.warn('El trigger no creó la fila en `usuarios` a tiempo.');
                return { data, warning: 'Tu cuenta se creó, pero no pudimos completar tu perfil. Inicia sesión e inténtalo de nuevo.' };
            }
            if (telefono) {
                await window.supabaseClient
                    .from('usuarios')
                    .update({ telefono })
                    .eq('usuario_id', usuario.usuario_id);
            }
            if (rol === 'INQUILINO') {
                const { error: errInq } = await window.supabaseClient
                    .from('inquilinos')
                    .insert({ usuario_id: usuario.usuario_id });
                if (errInq) {
                    console.error(errInq);
                    return { data, warning: 'Tu cuenta se creó, pero no se pudo registrar tu perfil de inquilino.' };
                }
            }
        }
        return { data };
    },

    async iniciarSesion({ email, password }) {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email, password
        });
        if (!error && data.user) {
            await window.supabaseClient
                .from('usuarios')
                .update({ ultimo_acceso: new Date().toISOString() })
                .eq('auth_user_id', data.user.id);
        }
        return { data, error };
    },

    async cerrarSesion() {
        await window.supabaseClient.auth.signOut();
        window.location.replace(this._ruta('login.html'));
    },

    async obtenerSesion() {
        const { data } = await window.supabaseClient.auth.getSession();
        return data.session;
    },

    async obtenerUsuarioActual() {
        const sesion = await this.obtenerSesion();
        if (!sesion) return null;
        const { data } = await window.supabaseClient
            .from('usuarios')
            .select('*')
            .eq('auth_user_id', sesion.user.id)
            .maybeSingle();
        return data;
    },

    async obtenerInquilinoActual() {
        const usuario = await this.obtenerUsuarioActual();
        if (!usuario || usuario.rol !== 'INQUILINO') return null;
        const { data } = await window.supabaseClient
            .from('inquilinos')
            .select('*')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();
        return data ? { ...data, usuario } : null;
    },

    async requerirAuth(rolesPermitidos = []) {
        const usuario = await this.obtenerUsuarioActual();
        if (!usuario) {
            window.location.replace(this._ruta('login.html'));
            return null;
        }
        if (rolesPermitidos.length && !rolesPermitidos.includes(usuario.rol)) {
            this.redirigirSegunRol(usuario);
            return null;
        }
        return usuario;
    },

    redirigirSegunRol(usuario) {
        const archivo = usuario.rol === 'ARRENDADOR'
            ? 'dashboard-arrendador.html'
            : 'dashboard-inquilino.html';
        window.location.replace(this._ruta(archivo));
    }
};

window.Auth = Auth;
