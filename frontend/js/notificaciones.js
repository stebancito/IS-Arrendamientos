// ================================================================
// notificaciones.js  –  Centro de Notificaciones GLOBAL
// ================================================================
// Componente reutilizable que:
//   1. Inyecta una campana 🔔 en la topbar (header) de layout.js
//      con un badge de no-leídas y un panel desplegable.
//   2. Carga las notificaciones persistentes de la tabla
//      public.notificaciones (usuario_id = usuario actual).
//   3. Se suscribe a Supabase Realtime para recibir nuevas
//      notificaciones al instante (INSERT) → toast + badge.
//      Si Realtime no está habilitado, sigue funcionando "al
//      cargar la página" (las notificaciones aparecen en el panel).
//   4. Genera ALERTAS de pago al cargar la página (próximos a
//      vencer / vencidos) como toasts, calculadas desde la BD.
//      Estas alertas NO insertan filas, son informativas.
//
// USO EN CUALQUIER PÁGINA PROTEGIDA (después de inyectar layout):
//   <script src="../js/notificaciones.js"></script>
//   ...
//   await LAYOUT.inyectarLayout({ paginaActiva: '...' });
//   const usuario = await AUTH.obtenerUsuarioActual();
//   NOTIFICACIONES.init(usuario);                 // todo activado
//   NOTIFICACIONES.init(usuario, { alertasPago: false }); // sin toasts de pago
//
// Dependencias: supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const NOTIFICACIONES = (() => {

    let _usuario = null;
    let _items = [];          // notificaciones cargadas
    let _canal = null;        // canal de realtime
    let _abierto = false;     // estado del panel
    let _inicializado = false;// evita doble inicialización en la misma página
    let _maxId = 0;           // mayor notificacion_id conocido (para el sondeo)
    let _pollId = null;       // id del setInterval del sondeo de respaldo

    const POLL_MS = 30000;    // cada cuánto se revisa por nuevas notificaciones

    // ── Cola de toasts (toast.js solo muestra uno a la vez) ─────
    // Encolamos para que varios avisos se muestren uno tras otro
    // sin pisarse.
    let _colaToasts = [];
    let _corriendoCola = false;

    function _toast(mensaje, tipo = 'info', duracion = 4000, onClick = null) {
        if (!window.TOAST) return;
        _colaToasts.push({ mensaje, tipo, duracion, onClick });
        if (!_corriendoCola) _correrCola();
    }

    function _correrCola() {
        if (!_colaToasts.length) { _corriendoCola = false; return; }
        _corriendoCola = true;
        const { mensaje, tipo, duracion, onClick } = _colaToasts.shift();
        TOAST.mostrar(mensaje, tipo, duracion);

        // Hacer el toast clickeable si trae una acción
        if (onClick) {
            const el = document.querySelector('.global-toast');
            if (el) {
                el.style.cursor = 'pointer';
                el.title = 'Abrir';
                el.addEventListener('click', (e) => {
                    // No navegar si se pulsó la "x" de cerrar
                    if (e.target.closest('.toast-close')) return;
                    onClick();
                });
            }
        }

        // Mostrar el siguiente cuando el actual ya se vio un buen rato
        setTimeout(_correrCola, Math.min(duracion, 3600) + 400);
    }

    // ── Iconos SVG inline (NO dependen de Font Awesome) ─────────
    // Así la campana se ve igual en cualquier página, tenga o no
    // cargado Font Awesome.
    const ICONS = {
        bell:      '<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>',
        bellSlash: '<path d="M9.143 17.082a24.248 24.248 0 003.844.148m-3.844-.148a23.856 23.856 0 01-5.455-1.31 8.964 8.964 0 002.3-5.542m3.155 6.852a3 3 0 005.667 1.97m1.965-2.277L21 21m-4.225-4.225a23.81 23.81 0 003.536-1.003 8.967 8.967 0 01-2.312-5.542V7.5a6 6 0 00-9.756-4.696M3 3l3.105 3.105"/>',
        calendar:  '<path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>',
        warning:   '<path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>',
        wrench:    '<path d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"/>',
        document:  '<path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>',
        check:     '<path d="M4.5 12.75l6 6 9-13.5"/>',
        trash:     '<path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>',
    };

    function _svg(name, clase = 'w-5 h-5') {
        const inner = ICONS[name] || ICONS.bell;
        return `<svg xmlns="http://www.w3.org/2000/svg" class="${clase}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    }

    // Metadatos visuales por tipo de notificación
    const TIPO_META = {
        PAGO_PROXIMO:           { icon: 'calendar', color: 'text-blue-600',   bg: 'bg-blue-50' },
        PAGO_VENCIDO:           { icon: 'warning',  color: 'text-red-600',    bg: 'bg-red-50' },
        INCIDENCIA_ACTUALIZADA: { icon: 'wrench',   color: 'text-amber-600',  bg: 'bg-amber-50' },
        CONTRATO_TERMINADO:     { icon: 'document', color: 'text-rose-600',   bg: 'bg-rose-50' },
        RECORDATORIO:           { icon: 'bell',     color: 'text-indigo-600', bg: 'bg-indigo-50' },
    };

    function _meta(tipo) {
        return TIPO_META[tipo] || { icon: 'bell', color: 'text-slate-600', bg: 'bg-slate-50' };
    }

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario, opciones = {}) {
        if (!usuario) return;
        if (_inicializado) return;   // ya montado en esta página → no duplicar
        _inicializado = true;
        _usuario = usuario;

        const { alertasPago = true } = opciones;

        _montarCampana();

        await _cargar();
        _renderPanel();
        _renderBadge();

        _suscribirRealtime();
        _iniciarSondeo();          // respaldo por si Realtime no está activo

        // Aviso emergente al entrar (una vez por sesión / login)
        _avisoDeEntrada();

        if (alertasPago) {
            // No bloquea el render; corre en segundo plano.
            _generarAlertasPago().catch(err =>
                console.warn('[NOTIF] alertas de pago:', err));
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Aviso emergente al iniciar sesión / entrar
    // (una sola vez por sesión del navegador; se reinicia al cerrar
    //  sesión porque auth.js hace sessionStorage.clear())
    // ──────────────────────────────────────────────────────────────
    function _avisoDeEntrada() {
        try {
            if (sessionStorage.getItem('notif_saludo') === '1') return;
            sessionStorage.setItem('notif_saludo', '1');
        } catch (_) { /* sessionStorage no disponible */ }

        const noLeidas = _items.filter(n => !n.leida).length;
        if (noLeidas > 0) {
            _toast(`Tienes ${noLeidas} notificación${noLeidas === 1 ? '' : 'es'} sin leer.`,
                   'info', 5000, () => _abrirPanel());
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Inyecta la campana + panel en la topbar (<header>)
    // ──────────────────────────────────────────────────────────────
    function _montarCampana() {
        const header = document.querySelector('header');
        if (!header || document.getElementById('notif-wrap')) return;

        const wrap = document.createElement('div');
        wrap.id = 'notif-wrap';
        wrap.className = 'relative flex-shrink-0';
        wrap.innerHTML = `
            <button id="notif-btn" type="button" aria-label="Notificaciones"
                    class="relative p-2 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                ${_svg('bell', 'w-6 h-6')}
                <span id="notif-badge"
                      class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1
                             rounded-full bg-red-500 text-white text-[10px] font-bold
                             flex items-center justify-center shadow-md ring-2 ring-white">0</span>
            </button>

            <!-- Panel desplegable -->
            <div id="notif-panel"
                 class="hidden absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)]
                        bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden anim-fade-in-up">
                <div class="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#0c1f4a] to-[#1a3680] text-white">
                    <div class="flex items-center gap-2">
                        ${_svg('bell', 'w-4 h-4')}
                        <span class="font-bold text-sm">Notificaciones</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button id="notif-marcar-todas" type="button" title="Marcar todas como leídas"
                                class="flex items-center gap-1 px-2 py-1 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 text-[11px] font-semibold transition">
                            ${_svg('check', 'w-3.5 h-3.5')}<span class="hidden sm:inline">Leídas</span>
                        </button>
                        <button id="notif-eliminar-todas" type="button" title="Eliminar todas las notificaciones"
                                class="flex items-center gap-1 px-2 py-1 rounded-lg text-blue-200 hover:text-white hover:bg-red-500/30 text-[11px] font-semibold transition">
                            ${_svg('trash', 'w-3.5 h-3.5')}<span class="hidden sm:inline">Limpiar</span>
                        </button>
                    </div>
                </div>
                <div id="notif-lista" class="max-h-96 overflow-y-auto custom-scrollbar divide-y divide-slate-50">
                    <div class="p-6 text-center text-slate-400 text-sm">Cargando…</div>
                </div>
            </div>`;

        // Insertar la campana ANTES del badge de usuario (último hijo del header)
        const badgeUsuario = header.lastElementChild;
        header.insertBefore(wrap, badgeUsuario);

        // Toggle del panel
        document.getElementById('notif-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            _togglePanel();
        });
        document.getElementById('notif-marcar-todas').addEventListener('click', (e) => {
            e.stopPropagation();
            _marcarTodas();
        });
        document.getElementById('notif-eliminar-todas').addEventListener('click', (e) => {
            e.stopPropagation();
            _eliminarTodas();
        });

        // Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (_abierto && !wrap.contains(e.target)) _cerrarPanel();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _abierto) _cerrarPanel();
        });
    }

    function _togglePanel() { _abierto ? _cerrarPanel() : _abrirPanel(); }

    function _abrirPanel() {
        document.getElementById('notif-panel')?.classList.remove('hidden');
        _abierto = true;
    }

    function _cerrarPanel() {
        document.getElementById('notif-panel')?.classList.add('hidden');
        _abierto = false;
    }

    // ──────────────────────────────────────────────────────────────
    // Carga de notificaciones persistentes
    // ──────────────────────────────────────────────────────────────
    async function _cargar() {
        const { data, error } = await window.supabaseClient
            .from('notificaciones')
            .select('notificacion_id, titulo, mensaje, tipo, leida, creado_en, leida_en, metadatos')
            .eq('usuario_id', _usuario.usuario_id)
            .order('creado_en', { ascending: false })
            .limit(30);

        if (error) {
            console.error('[NOTIF] Error al cargar notificaciones:', error);
            _items = [];
            return;
        }
        _items = data || [];
        // Recordar el mayor id para el sondeo de respaldo
        _maxId = _items.reduce((max, n) => Math.max(max, n.notificacion_id), _maxId);
    }

    // ──────────────────────────────────────────────────────────────
    // Render del panel y del badge
    // ──────────────────────────────────────────────────────────────
    function _renderPanel() {
        const lista = document.getElementById('notif-lista');
        if (!lista) return;

        if (!_items.length) {
            lista.innerHTML = `
                <div class="p-8 text-center">
                    <div class="w-12 h-12 mx-auto rounded-full bg-slate-50 flex items-center justify-center mb-2 text-slate-300">
                        ${_svg('bellSlash', 'w-6 h-6')}
                    </div>
                    <p class="text-slate-500 text-sm font-medium">Sin notificaciones</p>
                    <p class="text-slate-400 text-xs mt-0.5">Aquí verás los avisos importantes.</p>
                </div>`;
            return;
        }

        lista.innerHTML = _items.map(n => {
            const m = _meta(n.tipo);
            const noLeida = !n.leida;
            return `
            <div class="notif-row flex items-stretch transition-colors
                        ${noLeida ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-slate-50'}">
                <button type="button" data-open="${n.notificacion_id}"
                        class="notif-open flex-1 min-w-0 text-left px-4 py-3 flex gap-3">
                    <div class="w-9 h-9 rounded-xl ${m.bg} ${m.color} flex items-center justify-center flex-shrink-0">
                        ${_svg(m.icon, 'w-5 h-5')}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start gap-2">
                            <p class="text-slate-800 text-sm font-semibold leading-snug flex-1">${esc(n.titulo)}</p>
                            ${noLeida ? '<span class="w-2 h-2 rounded-full bg-blue-500 mt-1 flex-shrink-0"></span>' : ''}
                        </div>
                        <p class="text-slate-500 text-xs mt-0.5 leading-snug">${esc(n.mensaje)}</p>
                        <p class="text-slate-400 text-[10px] mt-1">${_tiempoRelativo(n.creado_en)}</p>
                    </div>
                </button>
                <button type="button" data-del="${n.notificacion_id}" title="Eliminar"
                        class="notif-del flex-shrink-0 px-3 text-slate-300 hover:text-red-500 transition-colors">
                    ${_svg('trash', 'w-4 h-4')}
                </button>
            </div>`;
        }).join('');

        // Bind: abrir la sección correspondiente
        lista.querySelectorAll('.notif-open').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number(btn.getAttribute('data-open'));
                const n = _items.find(x => x.notificacion_id === id);
                if (n) _navegar(n);
            });
        });
        // Bind: eliminar una notificación
        lista.querySelectorAll('.notif-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.getAttribute('data-del'));
                _eliminarUna(id);
            });
        });
    }

    function _renderBadge() {
        const badge = document.getElementById('notif-badge');
        if (!badge) return;
        const noLeidas = _items.filter(n => !n.leida).length;
        if (noLeidas > 0) {
            badge.textContent = noLeidas > 99 ? '99+' : String(noLeidas);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Marcar leídas
    // ──────────────────────────────────────────────────────────────
    async function _marcarLeida(id) {
        const n = _items.find(x => x.notificacion_id === id);
        if (!n || n.leida) return;

        // Optimista
        n.leida = true;
        n.leida_en = new Date().toISOString();
        _renderPanel();
        _renderBadge();

        const { error } = await window.supabaseClient
            .from('notificaciones')
            .update({ leida: true, leida_en: n.leida_en })
            .eq('notificacion_id', id);

        if (error) console.error('[NOTIF] Error al marcar leída:', error);
    }

    async function _marcarTodas() {
        const noLeidas = _items.filter(n => !n.leida);
        if (!noLeidas.length) { _cerrarPanel(); return; }

        const ahora = new Date().toISOString();
        noLeidas.forEach(n => { n.leida = true; n.leida_en = ahora; });
        _renderPanel();
        _renderBadge();

        const { error } = await window.supabaseClient
            .from('notificaciones')
            .update({ leida: true, leida_en: ahora })
            .eq('usuario_id', _usuario.usuario_id)
            .eq('leida', false);

        if (error) console.error('[NOTIF] Error al marcar todas:', error);
        else if (window.TOAST) TOAST.success('Notificaciones marcadas como leídas.');
    }

    // ──────────────────────────────────────────────────────────────
    // Navegación: abrir la sección correspondiente al tipo
    // ──────────────────────────────────────────────────────────────
    function _destino(n) {
        const rol = _usuario.rol;
        const md = n.metadatos || {};
        const prefijo = window.location.pathname.includes('/pages/') ? '' : 'pages/';

        let page = null;
        let params = '';

        switch (n.tipo) {
            case 'PAGO_PROXIMO':
            case 'PAGO_VENCIDO':
                page = rol === 'ARRENDADOR' ? 'pagos.html' : 'mis-pagos.html';
                // mis-pagos.js soporta ?contratoId= (si viene en metadatos)
                if (rol === 'INQUILINO' && md.contrato_id) params = `?contratoId=${md.contrato_id}`;
                break;
            case 'INCIDENCIA_ACTUALIZADA':
                page = rol === 'ARRENDADOR' ? 'incidencias.html' : 'mis-incidencias.html';
                if (md.incidencia_id) params = `?inc=${md.incidencia_id}`;
                break;
            case 'CONTRATO_TERMINADO':
                page = rol === 'ARRENDADOR' ? 'gestion-contratos.html' : 'contratos-inquilinos.html';
                break;
            case 'RECORDATORIO':
            default:
                page = rol === 'ARRENDADOR' ? 'dashboard-arrendador.html' : 'dashboard-inquilino.html';
                break;
        }
        return page ? (prefijo + page + params) : null;
    }

    async function _navegar(n) {
        const url = _destino(n);

        // Marcar como leída antes de salir (para que el badge baje)
        try {
            if (!n.leida) {
                await window.supabaseClient
                    .from('notificaciones')
                    .update({ leida: true, leida_en: new Date().toISOString() })
                    .eq('notificacion_id', n.notificacion_id);
                n.leida = true;
            }
        } catch (err) {
            console.warn('[NOTIF] No se pudo marcar leída antes de navegar:', err);
        }

        if (url) {
            window.location.href = url;
        } else {
            _renderPanel();
            _renderBadge();
            _cerrarPanel();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Eliminar notificaciones
    // ──────────────────────────────────────────────────────────────
    async function _eliminarUna(id) {
        // Optimista
        const respaldo = _items.slice();
        _items = _items.filter(n => n.notificacion_id !== id);
        _renderPanel();
        _renderBadge();

        const { error } = await window.supabaseClient
            .from('notificaciones')
            .delete()
            .eq('notificacion_id', id);

        if (error) {
            console.error('[NOTIF] Error al eliminar:', error);
            _items = respaldo;            // revertir
            _renderPanel();
            _renderBadge();
            if (window.TOAST) TOAST.error('No se pudo eliminar la notificación.');
        }
        // Nota: NO bajamos _maxId, para que el sondeo no la vuelva a traer.
    }

    async function _eliminarTodas() {
        if (!_items.length) { _cerrarPanel(); return; }
        if (!window.confirm('¿Eliminar todas las notificaciones? Esta acción no se puede deshacer.')) return;

        const respaldo = _items.slice();
        _items = [];
        _renderPanel();
        _renderBadge();

        const { error } = await window.supabaseClient
            .from('notificaciones')
            .delete()
            .eq('usuario_id', _usuario.usuario_id);

        if (error) {
            console.error('[NOTIF] Error al eliminar todas:', error);
            _items = respaldo;
            _renderPanel();
            _renderBadge();
            if (window.TOAST) TOAST.error('No se pudieron eliminar las notificaciones.');
        } else {
            if (window.TOAST) TOAST.success('Notificaciones eliminadas.');
            _cerrarPanel();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Realtime: nuevas notificaciones al instante
    // ──────────────────────────────────────────────────────────────
    function _suscribirRealtime() {
        try {
            _canal = window.supabaseClient
                .channel('notif-' + _usuario.usuario_id)
                .on('postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'notificaciones',
                        filter: `usuario_id=eq.${_usuario.usuario_id}`,
                    },
                    (payload) => {
                        if (payload.new) _ingestarNueva(payload.new);
                    })
                .subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        console.log('[NOTIF] Realtime activo.');
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        console.warn('[NOTIF] Realtime no disponible. ' +
                            'Se usará el sondeo de respaldo (cada ' + (POLL_MS / 1000) + 's). ' +
                            'Para avisos instantáneos habilita Realtime para la tabla "notificaciones".');
                    }
                });
        } catch (err) {
            console.warn('[NOTIF] No se pudo suscribir a Realtime:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Ingesta de una notificación nueva (desde Realtime o sondeo).
    // Dedupe por id → un mismo aviso nunca se muestra dos veces.
    // ──────────────────────────────────────────────────────────────
    function _ingestarNueva(nueva) {
        if (!nueva || !nueva.notificacion_id) return;
        if (_items.some(n => n.notificacion_id === nueva.notificacion_id)) return;

        _items.unshift(nueva);
        _maxId = Math.max(_maxId, nueva.notificacion_id);
        _renderPanel();
        _renderBadge();

        const tipoToast = nueva.tipo === 'PAGO_VENCIDO' ? 'error'
                        : nueva.tipo === 'PAGO_PROXIMO' ? 'warning' : 'info';
        _toast(nueva.titulo, tipoToast, 5000, () => _navegar(nueva));
    }

    // ──────────────────────────────────────────────────────────────
    // Sondeo de respaldo: revisa periódicamente por nuevas
    // notificaciones (funciona aunque Realtime no esté habilitado).
    // ──────────────────────────────────────────────────────────────
    function _iniciarSondeo() {
        if (_pollId) return;
        _pollId = setInterval(_sondear, POLL_MS);
        // Pausar cuando la pestaña no está visible (ahorra consultas)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') _sondear();
        });
    }

    async function _sondear() {
        if (document.visibilityState === 'hidden') return;
        try {
            const { data, error } = await window.supabaseClient
                .from('notificaciones')
                .select('notificacion_id, titulo, mensaje, tipo, leida, creado_en, leida_en, metadatos')
                .eq('usuario_id', _usuario.usuario_id)
                .gt('notificacion_id', _maxId)
                .order('notificacion_id', { ascending: true });

            if (error) { console.warn('[NOTIF] sondeo:', error); return; }
            (data || []).forEach(n => _ingestarNueva(n));
        } catch (err) {
            console.warn('[NOTIF] Error en sondeo:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Alertas de pago AL CARGAR (toasts informativos, sin insertar)
    // ──────────────────────────────────────────────────────────────
    async function _generarAlertasPago() {
        // Mostrar las alertas de pago solo UNA vez por sesión del navegador,
        // para no repetir los toasts cada vez que el usuario cambia de página.
        try {
            if (sessionStorage.getItem('notif_alertas_pago') === '1') return;
            sessionStorage.setItem('notif_alertas_pago', '1');
        } catch (_) { /* sessionStorage no disponible: continúa igual */ }

        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (_) { /* opcional */ }

        if (_usuario.rol === 'INQUILINO') {
            await _alertasInquilino();
        } else if (_usuario.rol === 'ARRENDADOR') {
            await _alertasArrendador();
        }
    }

    const DIAS_PROXIMO = 5;  // ventana de "pago próximo"

    async function _alertasInquilino() {
        // 1. inquilino_id
        const { data: inq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', _usuario.usuario_id)
            .maybeSingle();
        if (!inq) return;

        // 2. contratos activos
        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id')
            .eq('inquilino_id', inq.inquilino_id)
            .eq('estado', 'ACTIVO');
        const ids = (contratos || []).map(c => c.contrato_id);
        if (!ids.length) return;

        // 3. cuotas pendientes/vencidas
        const hoy = new Date();
        const limite = new Date();
        limite.setDate(limite.getDate() + DIAS_PROXIMO);
        const isoHoy = hoy.toISOString().slice(0, 10);
        const isoLimite = limite.toISOString().slice(0, 10);

        const { data: pagos } = await window.supabaseClient
            .from('calendario_pagos')
            .select('estado, fecha_limite, monto_esperado')
            .in('contrato_id', ids)
            .in('estado', ['PENDIENTE', 'VENCIDO']);

        if (!pagos || !pagos.length) return;

        const vencidos  = pagos.filter(p => p.estado === 'VENCIDO');
        const proximos  = pagos.filter(p => p.estado === 'PENDIENTE'
            && p.fecha_limite >= isoHoy && p.fecha_limite <= isoLimite);

        const irAPagos = () => { const u = _destino({ tipo: 'PAGO_VENCIDO', metadatos: {} }); if (u) window.location.href = u; };
        if (vencidos.length) {
            const total = vencidos.reduce((s, p) => s + Number(p.monto_esperado || 0), 0);
            _toast(`Tienes ${vencidos.length} pago(s) vencido(s) por ${_money(total)}.`, 'error', 6000, irAPagos);
        }
        if (proximos.length) {
            _toast(`Tienes ${proximos.length} pago(s) por vencer en los próximos ${DIAS_PROXIMO} días.`, 'warning', 6000, irAPagos);
        }
    }

    async function _alertasArrendador() {
        // vista_pagos_detalle ya trae duenio_id → ideal para el arrendador
        const hoy = new Date();
        const limite = new Date();
        limite.setDate(limite.getDate() + DIAS_PROXIMO);
        const isoHoy = hoy.toISOString().slice(0, 10);
        const isoLimite = limite.toISOString().slice(0, 10);

        const { data, error } = await window.supabaseClient
            .from('vista_pagos_detalle')
            .select('estado, fecha_limite, monto_esperado')
            .eq('duenio_id', _usuario.usuario_id)
            .in('estado', ['PENDIENTE', 'VENCIDO']);

        if (error || !data || !data.length) return;

        const vencidos = data.filter(p => p.estado === 'VENCIDO');
        const proximos = data.filter(p => p.estado === 'PENDIENTE'
            && p.fecha_limite >= isoHoy && p.fecha_limite <= isoLimite);

        const irAPagos = () => { const u = _destino({ tipo: 'PAGO_VENCIDO', metadatos: {} }); if (u) window.location.href = u; };
        if (vencidos.length) {
            const total = vencidos.reduce((s, p) => s + Number(p.monto_esperado || 0), 0);
            _toast(`${vencidos.length} cuota(s) vencida(s) por cobrar (${_money(total)}).`, 'error', 6000, irAPagos);
        }
        if (proximos.length) {
            _toast(`${proximos.length} cuota(s) vencen en los próximos ${DIAS_PROXIMO} días.`, 'info', 6000, irAPagos);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    function _money(n) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', minimumFractionDigits: 0,
        }).format(Number(n) || 0);
    }

    function _tiempoRelativo(iso) {
        if (!iso) return '';
        const fecha = new Date(iso);
        const diff = Math.floor((Date.now() - fecha.getTime()) / 1000); // segundos
        if (diff < 60)        return 'hace un momento';
        if (diff < 3600)      return `hace ${Math.floor(diff / 60)} min`;
        if (diff < 86400)     return `hace ${Math.floor(diff / 3600)} h`;
        if (diff < 604800)    return `hace ${Math.floor(diff / 86400)} d`;
        return fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    }

    // ──────────────────────────────────────────────────────────────
    // API pública para recargar manualmente (p. ej. tras una acción)
    // ──────────────────────────────────────────────────────────────
    async function refrescar() {
        await _cargar();
        _renderPanel();
        _renderBadge();
    }

    return { init, refrescar };
})();

window.NOTIFICACIONES = NOTIFICACIONES;