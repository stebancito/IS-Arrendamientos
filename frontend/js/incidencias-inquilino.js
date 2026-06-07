// ================================================================
// incidencias-inquilino.js  –  Centro de Incidencias (Inquilino)
// ================================================================
// Responsabilidades:
//   - Levantar tickets (incidencias) sobre las propiedades que renta.
//   - Ver el listado de sus incidencias con su estado actual.
//   - Filtrar por estado (Todas / Abierta / En proceso / Resuelta).
//   - Notificar al arrendador al crear una incidencia.
//
// Reglas de datos (schema.sql):
//   incidencias.reportado_por_id  → inquilinos(inquilino_id)   ⚠️
//   incidencias.propiedad_id      → propiedades(propiedad_id)
//   categoria_incidencia_enum : PLOMERIA, ELECTRICIDAD, ESTRUCTURA,
//                               LIMPIEZA, SEGURIDAD, OTRO
//   estado_incidencia_enum    : ABIERTA, EN_PROCESO, RESUELTA
//
// Dependencias:
//   supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const INCIDENCIAS_INQUILINO = (() => {

    let _usuario = null;
    let _inquilinoId = null;
    let _propiedades = [];     // propiedades de sus contratos ACTIVOS (para crear)
    let _incidencias = [];     // sus incidencias reportadas
    let _filtro = 'TODAS';     // filtro de estado activo

    // ── Metadatos de categoría ──────────────────────────────────
    const CATEGORIAS = {
        PLOMERIA:     { label: 'Plomería',     icon: 'fa-droplet',           color: 'text-cyan-600',   bg: 'bg-cyan-50' },
        ELECTRICIDAD: { label: 'Electricidad', icon: 'fa-bolt',              color: 'text-amber-600',  bg: 'bg-amber-50' },
        ESTRUCTURA:   { label: 'Estructura',   icon: 'fa-building-shield',   color: 'text-slate-600',  bg: 'bg-slate-100' },
        LIMPIEZA:     { label: 'Limpieza',     icon: 'fa-broom',             color: 'text-emerald-600',bg: 'bg-emerald-50' },
        SEGURIDAD:    { label: 'Seguridad',    icon: 'fa-shield-halved',     color: 'text-red-600',    bg: 'bg-red-50' },
        OTRO:         { label: 'Otro',         icon: 'fa-circle-question',   color: 'text-indigo-600', bg: 'bg-indigo-50' },
    };

    // ── Metadatos de estado ─────────────────────────────────────
    const ESTADOS = {
        ABIERTA:    { label: 'Abierta',    dot: 'bg-red-500',   pill: 'bg-red-50 text-red-700 border-red-200',     icon: 'fa-circle-exclamation' },
        EN_PROCESO: { label: 'En proceso', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'fa-spinner' },
        RESUELTA:   { label: 'Resuelta',   dot: 'bg-green-500', pill: 'bg-green-50 text-green-700 border-green-200', icon: 'fa-circle-check' },
    };

    function _cat(c)  { return CATEGORIAS[c] || CATEGORIAS.OTRO; }
    function _est(e)  { return ESTADOS[e]    || ESTADOS.ABIERTA; }

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // 1. inquilino_id
        const { data: inq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();

        if (!inq) {
            _renderVacioGlobal('No tienes un perfil de inquilino registrado.');
            return;
        }
        _inquilinoId = inq.inquilino_id;

        // 2. Cargar propiedades (de contratos activos) e incidencias
        await Promise.all([_cargarPropiedades(), _cargarIncidencias()]);

        // 3. Bind de controles
        _bindNuevaIncidencia();
        _bindFiltros();

        // 4. Render
        _renderStats();
        _renderLista();
        _abrirDesdeURL();
    }

    // ──────────────────────────────────────────────────────────────
    // Deep-link: si la URL trae ?inc=<id>, abre el detalle de ese ticket
    // (y de paso lo resalta en la lista)
    // ──────────────────────────────────────────────────────────────
    function _abrirDesdeURL() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('inc');
        if (!id) return;

        // Limpiar el parámetro para que un refresh no lo vuelva a abrir
        params.delete('inc');
        const nuevaURL = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', nuevaURL);

        // Resaltar la tarjeta si está visible
        const card = document.querySelector(`[data-inc-id="${id}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-slate-50');
            setTimeout(() => {
                card.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2', 'ring-offset-slate-50');
            }, 3500);
        }

        // Abrir el detalle del ticket
        const inc = _incidencias.find(x => String(x.incidencia_id) === String(id));
        if (inc) _abrirDetalle(inc);
    }

    // ──────────────────────────────────────────────────────────────
    // Carga de datos
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedades() {
        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, estado,
                propiedades ( propiedad_id, nombre, direccion, duenio_id )
            `)
            .eq('inquilino_id', _inquilinoId)
            .eq('estado', 'ACTIVO');

        if (error) {
            console.error('[INC-INQ] Error cargando propiedades:', error);
            _propiedades = [];
            return;
        }

        // Dedupe por propiedad_id
        const mapa = new Map();
        (data || []).forEach(c => {
            const p = c.propiedades;
            if (p && !mapa.has(p.propiedad_id)) mapa.set(p.propiedad_id, p);
        });
        _propiedades = Array.from(mapa.values());
    }

    async function _cargarIncidencias() {
        const { data, error } = await window.supabaseClient
            .from('incidencias')
            .select(`
                incidencia_id, propiedad_id, titulo, descripcion, categoria, estado,
                creado_en, actualizado_en, resuelto_en, resolucion_notas,
                propiedades ( nombre, direccion )
            `)
            .eq('reportado_por_id', _inquilinoId)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[INC-INQ] Error cargando incidencias:', error);
            _incidencias = [];
            return;
        }
        _incidencias = data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Stats (contadores por estado)
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
    // Filtros por estado
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        document.querySelectorAll('.filtro-inc').forEach(btn => {
            btn.addEventListener('click', () => {
                _filtro = btn.getAttribute('data-filtro');
                _pintarFiltroActivo();
                _renderLista();
            });
        });
    }

    function _pintarFiltroActivo() {
        document.querySelectorAll('.filtro-inc').forEach(btn => {
            const activo = btn.getAttribute('data-filtro') === _filtro;
            btn.className = 'filtro-inc px-3 py-2 rounded-lg text-xs font-semibold transition-all ' +
                (activo ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700');
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Lista de incidencias (tarjetas)
    // ──────────────────────────────────────────────────────────────
    function _renderLista() {
        const cont = document.getElementById('inc-lista');
        if (!cont) return;

        const items = _filtro === 'TODAS'
            ? _incidencias
            : _incidencias.filter(i => i.estado === _filtro);

        if (!items.length) {
            cont.innerHTML = _htmlVacio(
                _incidencias.length
                    ? 'No hay incidencias con este estado.'
                    : 'Aún no has reportado ninguna incidencia. Usa el botón "Nueva incidencia" para crear una.');
            return;
        }

        cont.innerHTML = items.map((inc, idx) => {
            const c = _cat(inc.categoria);
            const e = _est(inc.estado);
            const prop = inc.propiedades?.nombre || 'Propiedad';
            const delay = ['', 'anim-delay-1', 'anim-delay-2', 'anim-delay-3'][idx % 4];
            return `
            <button type="button" data-id="${inc.incidencia_id}" data-inc-id="${inc.incidencia_id}"
                    class="inc-card text-left w-full bg-white rounded-2xl border border-slate-100 shadow-sm
                           p-4 hover:shadow-md hover:border-slate-200 transition anim-fade-in-up ${delay}"
                    style="transition: box-shadow .3s, border-color .3s;">
                <div class="flex items-start gap-3">
                    <div class="w-11 h-11 rounded-xl ${c.bg} ${c.color} flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid ${c.icon} text-lg"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                            <p class="text-slate-900 font-bold text-sm leading-snug truncate">${esc(inc.titulo)}</p>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${e.pill} flex-shrink-0">
                                <span class="w-1.5 h-1.5 rounded-full ${e.dot}"></span>${e.label}
                            </span>
                        </div>
                        <p class="text-slate-500 text-xs mt-1 line-clamp-2">${esc(inc.descripcion)}</p>
                        <div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-400">
                            <span><i class="fa-solid fa-building mr-1"></i>${esc(prop)}</span>
                            <span><i class="fa-solid ${c.icon} mr-1"></i>${c.label}</span>
                            <span><i class="fa-solid fa-clock mr-1"></i>${_fecha(inc.creado_en)}</span>
                        </div>
                    </div>
                </div>
            </button>`;
        }).join('');

        cont.querySelectorAll('.inc-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = Number(card.getAttribute('data-id'));
                const inc = _incidencias.find(x => x.incidencia_id === id);
                if (inc) _abrirDetalle(inc);
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Modal: detalle de incidencia
    // ──────────────────────────────────────────────────────────────
    function _abrirDetalle(inc) {
        document.getElementById('modal-detalle-inc')?.remove();
        const c = _cat(inc.categoria);
        const e = _est(inc.estado);
        const prop = inc.propiedades?.nombre || 'Propiedad';

        const resolucionHTML = inc.estado === 'RESUELTA'
            ? `<div class="mt-4 p-3 rounded-xl bg-green-50 border border-green-100">
                   <p class="text-[10px] font-bold text-green-700 uppercase tracking-wider mb-1">
                       <i class="fa-solid fa-circle-check mr-1"></i>Resolución
                   </p>
                   <p class="text-green-900 text-sm">${esc(inc.resolucion_notas || 'Marcada como resuelta por el arrendador.')}</p>
                   ${inc.resuelto_en ? `<p class="text-green-600/70 text-[10px] mt-1">Resuelta el ${_fecha(inc.resuelto_en)}</p>` : ''}
               </div>`
            : '';

        const html = `
        <div id="modal-detalle-inc" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 bg-gradient-to-r from-[#0c1f4a] to-[#1a3680] text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid ${c.icon} text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-base leading-tight truncate">${esc(inc.titulo)}</p>
                            <p class="text-white/70 text-xs">${c.label} · ${esc(prop)}</p>
                        </div>
                    </div>
                </div>
                <div class="p-5">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${e.pill} mb-3">
                        <span class="w-2 h-2 rounded-full ${e.dot}"></span>${e.label}
                    </span>
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Descripción</p>
                    <p class="text-slate-700 text-sm whitespace-pre-line">${esc(inc.descripcion)}</p>
                    ${resolucionHTML}
                    <div class="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
                        <span><i class="fa-solid fa-calendar-plus mr-1"></i>Creada: ${_fecha(inc.creado_en)}</span>
                        <span><i class="fa-solid fa-clock-rotate-left mr-1"></i>Actualizada: ${_fecha(inc.actualizado_en)}</span>
                    </div>
                    <button type="button" onclick="document.getElementById('modal-detalle-inc').remove()"
                            class="w-full mt-5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    // ──────────────────────────────────────────────────────────────
    // Modal: nueva incidencia
    // ──────────────────────────────────────────────────────────────
    function _bindNuevaIncidencia() {
        const btn = document.getElementById('btn-nueva-incidencia');
        if (btn) btn.addEventListener('click', _abrirModalNueva);
    }

    function _abrirModalNueva() {
        if (!_propiedades.length) {
            if (window.TOAST) TOAST.warning('No tienes contratos activos para reportar incidencias.');
            return;
        }
        document.getElementById('modal-nueva-inc')?.remove();

        const opcionesProp = _propiedades.map(p =>
            `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('');

        const opcionesCat = Object.entries(CATEGORIAS).map(([k, v]) =>
            `<option value="${k}">${v.label}</option>`).join('');

        const html = `
        <div id="modal-nueva-inc" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-screwdriver-wrench text-lg"></i>
                        </div>
                        <div>
                            <p class="font-bold text-base leading-tight">Nueva incidencia</p>
                            <p class="text-white/70 text-xs">Describe el problema para que el arrendador lo atienda.</p>
                        </div>
                    </div>
                </div>
                <div class="p-5">
                    <div id="nueva-inc-alert" class="hidden mb-3"></div>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Propiedad *</label>
                            <select id="ni-propiedad" class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                                ${opcionesProp}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Categoría *</label>
                            <select id="ni-categoria" class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                                ${opcionesCat}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Título *</label>
                            <input id="ni-titulo" type="text" maxlength="120"
                                   placeholder="Ej. Fuga de agua en el baño"
                                   class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Descripción *</label>
                            <textarea id="ni-descripcion" rows="4" maxlength="1000"
                                      placeholder="Explica el problema con el mayor detalle posible…"
                                      class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                        </div>
                    </div>
                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-nueva-inc').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cancelar
                        </button>
                        <button id="btn-crear-inc" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md">
                            <i class="fa-solid fa-paper-plane mr-1"></i> Enviar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-crear-inc').addEventListener('click', _crearIncidencia);
    }

    async function _crearIncidencia() {
        const btn = document.getElementById('btn-crear-inc');
        const alertEl = document.getElementById('nueva-inc-alert');

        const propiedadId = Number(document.getElementById('ni-propiedad')?.value);
        const categoria   = document.getElementById('ni-categoria')?.value;
        const titulo      = document.getElementById('ni-titulo')?.value.trim();
        const descripcion = document.getElementById('ni-descripcion')?.value.trim();

        if (!propiedadId)        { _alerta(alertEl, 'Selecciona una propiedad.'); return; }
        if (!categoria)          { _alerta(alertEl, 'Selecciona una categoría.'); return; }
        if (!titulo)             { _alerta(alertEl, 'Escribe un título.'); return; }
        if (titulo.length < 4)   { _alerta(alertEl, 'El título es demasiado corto.'); return; }
        if (!descripcion)        { _alerta(alertEl, 'Escribe una descripción.'); return; }
        if (descripcion.length < 10) { _alerta(alertEl, 'La descripción es demasiado corta.'); return; }

        AUTH.setLoading(btn, true);

        try {
            // 1. INSERT incidencia
            const { data: nueva, error: errInsert } = await window.supabaseClient
                .from('incidencias')
                .insert({
                    propiedad_id:     propiedadId,
                    reportado_por_id: _inquilinoId,   // ⚠️ FK a inquilinos
                    titulo,
                    descripcion,
                    categoria,
                    estado: 'ABIERTA',
                })
                .select('incidencia_id')
                .single();

            if (errInsert) throw errInsert;

            // 2. Notificar al arrendador (dueño de la propiedad)
            const prop = _propiedades.find(p => p.propiedad_id === propiedadId);
            if (prop?.duenio_id) {
                await window.supabaseClient.from('notificaciones').insert({
                    usuario_id: prop.duenio_id,
                    titulo: 'Nueva incidencia reportada',
                    mensaje: `${_usuario.nombre_completo} reportó "${titulo}" en ${prop.nombre}.`,
                    tipo: 'INCIDENCIA_ACTUALIZADA',
                    metadatos: { incidencia_id: nueva.incidencia_id, propiedad_id: propiedadId, categoria },
                });
            }

            document.getElementById('modal-nueva-inc')?.remove();
            if (window.TOAST) TOAST.success('Incidencia enviada. El arrendador fue notificado.');

            await _cargarIncidencias();
            _renderStats();
            _renderLista();

        } catch (err) {
            console.error('[INC-INQ] Error al crear incidencia:', err);
            AUTH.setLoading(btn, false);
            _alerta(alertEl, err.message || 'No se pudo crear la incidencia. Intenta de nuevo.');
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
                    <i class="fa-solid fa-clipboard-list text-blue-500 text-xl"></i>
                </div>
                <p class="text-slate-700 font-semibold mb-1">Nada por aquí</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    function _renderVacioGlobal(msg) {
        const cont = document.getElementById('inc-lista');
        if (cont) cont.innerHTML = _htmlVacio(msg);
    }

    return { init };
})();

window.INCIDENCIAS_INQUILINO = INCIDENCIAS_INQUILINO;