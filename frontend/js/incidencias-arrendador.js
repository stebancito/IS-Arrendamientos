// ================================================================
// incidencias-arrendador.js  –  Panel de Incidencias (Arrendador)
// ================================================================
// Responsabilidades:
//   - Ver TODAS las incidencias de sus propiedades.
//   - Cambiar el estado: ABIERTA → EN_PROCESO → RESUELTA
//     (y reabrir si hace falta).
//   - Al resolver, capturar notas de resolución.
//   - Notificar al inquilino que reportó cada vez que cambia el estado.
//   - Filtrar por estado y por propiedad.
//
// Reglas de datos (schema.sql):
//   incidencias.propiedad_id      → propiedades(propiedad_id)
//   incidencias.reportado_por_id  → inquilinos(inquilino_id)
//   inquilinos.usuario_id         → usuarios(usuario_id)  (para notificar)
//   estado_incidencia_enum : ABIERTA, EN_PROCESO, RESUELTA
//
// Dependencias:
//   supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const INCIDENCIAS_ARRENDADOR = (() => {

    let _usuario = null;
    let _propiedades = [];     // propiedades del arrendador
    let _incidencias = [];     // incidencias de esas propiedades
    let _filtroEstado = 'TODAS';
    let _filtroPropiedad = 'TODAS';

    const CATEGORIAS = {
        PLOMERIA:     { label: 'Plomería',     icon: 'fa-droplet',         color: 'text-cyan-600',    bg: 'bg-cyan-50' },
        ELECTRICIDAD: { label: 'Electricidad', icon: 'fa-bolt',            color: 'text-amber-600',   bg: 'bg-amber-50' },
        ESTRUCTURA:   { label: 'Estructura',   icon: 'fa-building-shield', color: 'text-slate-600',   bg: 'bg-slate-100' },
        LIMPIEZA:     { label: 'Limpieza',     icon: 'fa-broom',           color: 'text-emerald-600', bg: 'bg-emerald-50' },
        SEGURIDAD:    { label: 'Seguridad',    icon: 'fa-shield-halved',   color: 'text-red-600',     bg: 'bg-red-50' },
        OTRO:         { label: 'Otro',         icon: 'fa-circle-question', color: 'text-indigo-600',  bg: 'bg-indigo-50' },
    };

    const ESTADOS = {
        ABIERTA:    { label: 'Abierta',    dot: 'bg-red-500',   pill: 'bg-red-50 text-red-700 border-red-200' },
        EN_PROCESO: { label: 'En proceso', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
        RESUELTA:   { label: 'Resuelta',   dot: 'bg-green-500', pill: 'bg-green-50 text-green-700 border-green-200' },
    };

    function _cat(c) { return CATEGORIAS[c] || CATEGORIAS.OTRO; }
    function _est(e) { return ESTADOS[e]    || ESTADOS.ABIERTA; }

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        await _cargarPropiedades();

        if (!_propiedades.length) {
            _renderVacioGlobal('Aún no tienes propiedades registradas.');
            _renderStats();
            return;
        }

        await _cargarIncidencias();

        _renderFiltroPropiedades();
        _bindFiltros();
        _renderStats();
        _renderLista();
        _resaltarDesdeURL();
    }

    // ──────────────────────────────────────────────────────────────
    // Deep-link: si la URL trae ?inc=<id>, hace scroll y resalta el ticket
    // ──────────────────────────────────────────────────────────────
    function _resaltarDesdeURL() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('inc');
        if (!id) return;

        // Limpiar el parámetro para que un refresh no vuelva a resaltar
        params.delete('inc');
        const nuevaURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', nuevaURL);

        const card = document.querySelector(`[data-inc-id="${id}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-slate-50');
        setTimeout(() => {
            card.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-slate-50');
        }, 3500);
    }

    // ──────────────────────────────────────────────────────────────
    // Carga de datos
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedades() {
        const { data, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('activa', true)
            .order('nombre', { ascending: true });

        if (error) {
            console.error('[INC-ARR] Error cargando propiedades:', error);
            _propiedades = [];
            return;
        }
        _propiedades = data || [];
    }

    async function _cargarIncidencias() {
        const ids = _propiedades.map(p => p.propiedad_id);
        if (!ids.length) { _incidencias = []; return; }

        const { data, error } = await window.supabaseClient
            .from('incidencias')
            .select(`
                incidencia_id, propiedad_id, titulo, descripcion, categoria, estado,
                creado_en, actualizado_en, resuelto_en, resolucion_notas,
                propiedades ( nombre, direccion ),
                inquilinos!reportado_por_id (
                    inquilino_id, usuario_id,
                    usuarios ( nombre_completo, correo, telefono )
                )
            `)
            .in('propiedad_id', ids)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[INC-ARR] Error cargando incidencias:', error);
            _incidencias = [];
            return;
        }
        _incidencias = data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Stats
    // ──────────────────────────────────────────────────────────────
    function _renderStats() {
        const abiertas  = _incidencias.filter(i => i.estado === 'ABIERTA').length;
        const proceso   = _incidencias.filter(i => i.estado === 'EN_PROCESO').length;
        const resueltas = _incidencias.filter(i => i.estado === 'RESUELTA').length;

        _set('stat-total',     _incidencias.length);
        _set('stat-abiertas',  abiertas);
        _set('stat-proceso',   proceso);
        _set('stat-resueltas', resueltas);
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _renderFiltroPropiedades() {
        const sel = document.getElementById('filtro-propiedad');
        if (!sel) return;
        sel.innerHTML = '<option value="TODAS">Todas las propiedades</option>' +
            _propiedades.map(p => `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('');
    }

    function _bindFiltros() {
        document.querySelectorAll('.filtro-estado').forEach(btn => {
            btn.addEventListener('click', () => {
                _filtroEstado = btn.getAttribute('data-filtro');
                _pintarFiltroActivo();
                _renderLista();
            });
        });
        const sel = document.getElementById('filtro-propiedad');
        if (sel) sel.addEventListener('change', () => {
            _filtroPropiedad = sel.value;
            _renderLista();
        });
    }

    function _pintarFiltroActivo() {
        document.querySelectorAll('.filtro-estado').forEach(btn => {
            const activo = btn.getAttribute('data-filtro') === _filtroEstado;
            btn.className = 'filtro-estado px-3 py-2 rounded-lg text-xs font-semibold transition-all ' +
                (activo ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700');
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Lista
    // ──────────────────────────────────────────────────────────────
    function _filtradas() {
        return _incidencias.filter(i => {
            const okEstado = _filtroEstado === 'TODAS' || i.estado === _filtroEstado;
            const okProp = _filtroPropiedad === 'TODAS'
                || String(i.propiedad_id) === String(_filtroPropiedad);
            return okEstado && okProp;
        });
    }

    function _renderLista() {
        const cont = document.getElementById('inc-lista');
        if (!cont) return;

        const items = _filtradas();
        if (!items.length) {
            cont.innerHTML = _htmlVacio(
                _incidencias.length
                    ? 'No hay incidencias que coincidan con los filtros.'
                    : 'No tienes incidencias reportadas. Cuando un inquilino reporte una, aparecerá aquí.');
            return;
        }

        cont.innerHTML = items.map((inc, idx) => {
            const c = _cat(inc.categoria);
            const e = _est(inc.estado);
            const prop = inc.propiedades?.nombre || 'Propiedad';
            const reporta = inc.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const delay = ['', 'anim-delay-1', 'anim-delay-2', 'anim-delay-3'][idx % 4];
            return `
            <div data-inc-id="${inc.incidencia_id}" class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 anim-fade-in-up ${delay}" style="transition: box-shadow .3s, border-color .3s;">
                <div class="flex items-start gap-3">
                    <div class="w-11 h-11 rounded-xl ${c.bg} ${c.color} flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid ${c.icon} text-lg"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                            <p class="text-slate-900 font-bold text-sm leading-snug">${esc(inc.titulo)}</p>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${e.pill} flex-shrink-0">
                                <span class="w-1.5 h-1.5 rounded-full ${e.dot}"></span>${e.label}
                            </span>
                        </div>
                        <p class="text-slate-500 text-xs mt-1 line-clamp-2">${esc(inc.descripcion)}</p>
                        <div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-400">
                            <span><i class="fa-solid fa-building mr-1"></i>${esc(prop)}</span>
                            <span><i class="fa-solid fa-user mr-1"></i>${esc(reporta)}</span>
                            <span><i class="fa-solid ${c.icon} mr-1"></i>${c.label}</span>
                            <span><i class="fa-solid fa-clock mr-1"></i>${_fecha(inc.creado_en)}</span>
                        </div>
                        ${inc.estado === 'RESUELTA' && inc.resolucion_notas ? `
                            <div class="mt-2 p-2.5 rounded-xl bg-green-50 border border-green-100">
                                <p class="text-green-900 text-xs"><i class="fa-solid fa-circle-check mr-1 text-green-600"></i>${esc(inc.resolucion_notas)}</p>
                            </div>` : ''}

                        <!-- Acciones de estado -->
                        <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-50">
                            ${_botonesAccion(inc)}
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Bind de acciones
        cont.querySelectorAll('[data-accion]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number(btn.getAttribute('data-id'));
                const accion = btn.getAttribute('data-accion');
                const inc = _incidencias.find(x => x.incidencia_id === id);
                if (!inc) return;
                if (accion === 'RESUELTA') _abrirModalResolver(inc);
                else _cambiarEstado(inc, accion);
            });
        });
    }

    // Devuelve los botones según el estado actual (flujo de trabajo)
    function _botonesAccion(inc) {
        const id = inc.incidencia_id;
        const btn = (accion, label, clase, icon) =>
            `<button type="button" data-id="${id}" data-accion="${accion}"
                     class="px-3 py-1.5 rounded-lg text-xs font-semibold transition ${clase}">
                <i class="fa-solid ${icon} mr-1"></i>${label}
             </button>`;

        if (inc.estado === 'ABIERTA') {
            return btn('EN_PROCESO', 'Iniciar atención', 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm', 'fa-play')
                 + btn('RESUELTA', 'Marcar resuelta', 'bg-green-600 hover:bg-green-700 text-white shadow-sm', 'fa-check');
        }
        if (inc.estado === 'EN_PROCESO') {
            return btn('RESUELTA', 'Marcar resuelta', 'bg-green-600 hover:bg-green-700 text-white shadow-sm', 'fa-check')
                 + btn('ABIERTA', 'Reabrir', 'bg-slate-100 hover:bg-slate-200 text-slate-600', 'fa-rotate-left');
        }
        // RESUELTA
        return btn('EN_PROCESO', 'Reabrir', 'bg-slate-100 hover:bg-slate-200 text-slate-600', 'fa-rotate-left');
    }

    // ──────────────────────────────────────────────────────────────
    // Modal: resolver (capturar notas)
    // ──────────────────────────────────────────────────────────────
    function _abrirModalResolver(inc) {
        document.getElementById('modal-resolver-inc')?.remove();
        const html = `
        <div id="modal-resolver-inc" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-circle-check text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-base leading-tight">Marcar como resuelta</p>
                            <p class="text-white/70 text-xs truncate">${esc(inc.titulo)}</p>
                        </div>
                    </div>
                </div>
                <div class="p-5">
                    <div id="resolver-alert" class="hidden mb-3"></div>
                    <label class="block text-xs font-medium text-slate-600 mb-1.5">Notas de resolución (opcional)</label>
                    <textarea id="res-notas" rows="3" maxlength="500"
                              placeholder="Ej. Se reemplazó la tubería dañada el 12/06."
                              class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                    <p class="text-slate-400 text-[11px] mt-1.5">El inquilino verá estas notas y será notificado.</p>
                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-resolver-inc').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cancelar
                        </button>
                        <button id="btn-confirmar-resolver" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold shadow-md">
                            <i class="fa-solid fa-check mr-1"></i> Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirmar-resolver').addEventListener('click', async () => {
            const notas = document.getElementById('res-notas')?.value.trim() || null;
            await _cambiarEstado(inc, 'RESUELTA', notas, document.getElementById('btn-confirmar-resolver'));
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Cambio de estado + notificación al inquilino
    // ──────────────────────────────────────────────────────────────
    async function _cambiarEstado(inc, nuevoEstado, notas = null, btnEl = null) {
        if (btnEl) AUTH.setLoading(btnEl, true);

        try {
            const update = { estado: nuevoEstado };
            if (nuevoEstado === 'RESUELTA') {
                update.resuelto_en = new Date().toISOString();
                update.resolucion_notas = notas;
            } else {
                // Reabrir / volver a proceso: limpiar resolución
                update.resuelto_en = null;
                update.resolucion_notas = null;
            }

            const { error } = await window.supabaseClient
                .from('incidencias')
                .update(update)
                .eq('incidencia_id', inc.incidencia_id);

            if (error) throw error;

            // Notificar al inquilino que reportó
            const usuarioInquilino = inc.inquilinos?.usuario_id;
            if (usuarioInquilino) {
                const labelEstado = _est(nuevoEstado).label;
                await window.supabaseClient.from('notificaciones').insert({
                    usuario_id: usuarioInquilino,
                    titulo: 'Actualización de tu incidencia',
                    mensaje: `Tu incidencia "${inc.titulo}" cambió a estado: ${labelEstado}.`,
                    tipo: 'INCIDENCIA_ACTUALIZADA',
                    metadatos: {
                        incidencia_id: inc.incidencia_id,
                        estado: nuevoEstado,
                        propiedad_id: inc.propiedad_id,
                    },
                });
            }

            document.getElementById('modal-resolver-inc')?.remove();
            if (window.TOAST) TOAST.success(`Incidencia marcada como ${_est(nuevoEstado).label}.`);

            await _cargarIncidencias();
            _renderStats();
            _renderLista();

        } catch (err) {
            console.error('[INC-ARR] Error al cambiar estado:', err);
            if (btnEl) AUTH.setLoading(btnEl, false);
            const alertEl = document.getElementById('resolver-alert');
            if (alertEl) _alerta(alertEl, err.message || 'No se pudo actualizar la incidencia.');
            else if (window.TOAST) TOAST.error('No se pudo actualizar la incidencia.');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    function _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
    }

    function _alerta(box, msg) {
        if (!box) return;
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box?.classList.add('hidden'), 4500);
    }

    function _fecha(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    }

    function _htmlVacio(msg) {
        return `
            <div class="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-clipboard-check text-blue-500 text-xl"></i>
                </div>
                <p class="text-slate-700 font-semibold mb-1">Sin incidencias</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    function _renderVacioGlobal(msg) {
        const cont = document.getElementById('inc-lista');
        if (cont) cont.innerHTML = _htmlVacio(msg);
    }

    return { init };
})();

window.INCIDENCIAS_ARRENDADOR = INCIDENCIAS_ARRENDADOR;