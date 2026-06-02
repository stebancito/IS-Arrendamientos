// ================================================================
// propiedades.js  –  Listado, modificación y eliminación de propiedades
// ================================================================
// Implementa:
//   - RF-07: Modificar (redirige a agregar-propiedad.html?editId=X)
//   - RF-08: Eliminar (respetando RN-01 → no eliminar si hay contratos activos)
//   - RF-09: Listado general
//   - RF-10: Jerarquía edificio → departamentos (modal interactivo)
//
// ⚙ Consultas jerárquicas clave:
//   1) Edificios y unidades sueltas:
//        .from('propiedades').eq('duenio_id', uid).is('propiedad_padre_id', null)
//   2) Departamentos de un edificio:
//        .from('propiedades').eq('propiedad_padre_id', edificioId)
//
//   El esquema usa `propiedad_padre_id` (NO `parent_id`).
// ================================================================

const PROPIEDADES = (() => {

    let _usuario = null;
    let _todas = [];                // todas las propiedades cargadas (edificios + sueltas)
    let _idPendienteBorrar = null;
    let _menuAbiertoId = null;      // id de la propiedad con menú abierto

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;
        _asegurarModales();
        _bindFiltros();
        _bindGlobalClicks();
        await _cargarPropiedades();
    }

    // ──────────────────────────────────────────────────────────────
    // SVG decorativos de fondo (uno por tipo de propiedad)
    // Se renderizan absolute, opacidad baja, sin interferir con texto.
    // ──────────────────────────────────────────────────────────────
    function _svgFondo(tipo) {
        // Paleta: azul navy con muy baja opacidad → no compite con el texto
        const wrap = (svgInner) => `
            <div class="absolute -bottom-3 -right-3 w-36 h-36 text-[#0c1f4a] opacity-[0.06] pointer-events-none select-none"
                 aria-hidden="true">
                ${svgInner}
            </div>`;

        if (tipo === 'CASA') {
            // Silueta de casa: techo + paredes + puerta + ventana
            return wrap(`
                <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
                    <path d="M10 50 L50 18 L90 50" />
                    <path d="M18 46 L18 88 L82 88 L82 46" />
                    <path d="M42 88 L42 64 L58 64 L58 88" />
                    <rect x="26" y="56" width="10" height="10" />
                    <rect x="64" y="56" width="10" height="10" />
                    <path d="M70 18 L70 28 L78 28 L78 32" />
                </svg>`);
        }

        if (tipo === 'EDIFICIO') {
            // Silueta de torre con ventanas dispuestas en cuadrícula
            return wrap(`
                <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
                    <path d="M20 12 L20 90 L80 90 L80 12 Z" />
                    <path d="M20 90 L80 90" />
                    <rect x="28" y="22" width="10" height="10" />
                    <rect x="46" y="22" width="10" height="10" />
                    <rect x="62" y="22" width="10" height="10" />
                    <rect x="28" y="38" width="10" height="10" />
                    <rect x="46" y="38" width="10" height="10" />
                    <rect x="62" y="38" width="10" height="10" />
                    <rect x="28" y="54" width="10" height="10" />
                    <rect x="46" y="54" width="10" height="10" />
                    <rect x="62" y="54" width="10" height="10" />
                    <path d="M44 90 L44 72 L56 72 L56 90" />
                </svg>`);
        }

        if (tipo === 'DEPARTAMENTO') {
            // Sala de estar: sofá, lámpara de pie, mesita
            return wrap(`
                <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
                    <!-- piso -->
                    <path d="M8 84 L92 84" />
                    <!-- sofá -->
                    <path d="M22 60 L22 78 L72 78 L72 60" />
                    <path d="M22 60 Q22 56 26 56 L68 56 Q72 56 72 60" />
                    <path d="M30 56 L30 70 M40 56 L40 70 M50 56 L50 70 M60 56 L60 70" />
                    <path d="M22 78 L22 84 M72 78 L72 84" />
                    <!-- mesita lateral -->
                    <path d="M78 70 L78 84 M84 70 L84 84 M76 70 L86 70" />
                    <!-- lámpara de pie -->
                    <path d="M86 36 L78 50 L94 50 Z" />
                    <path d="M86 50 L86 84" />
                    <!-- cuadro en la pared -->
                    <rect x="32" y="22" width="20" height="14" />
                </svg>`);
        }

        if (tipo === 'LOCAL') {
            // Local comercial: fachada con toldo y ventana grande
            return wrap(`
                <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
                    <path d="M14 36 L86 36 L86 90 L14 90 Z" />
                    <!-- toldo -->
                    <path d="M10 36 L90 36 L82 22 L18 22 Z" />
                    <path d="M22 22 L26 36 M34 22 L36 36 M46 22 L46 36 M58 22 L56 36 M70 22 L66 36 M82 22 L76 36" />
                    <!-- escaparate -->
                    <rect x="22" y="46" width="36" height="34" />
                    <!-- puerta -->
                    <path d="M64 46 L64 86 L78 86 L78 46" />
                    <circle cx="74" cy="68" r="1.4" fill="currentColor" />
                </svg>`);
        }

        if (tipo === 'TERRENO') {
            // Terreno: cerco con árbol
            return wrap(`
                <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">
                    <!-- piso -->
                    <path d="M6 80 L94 80" />
                    <!-- cerco -->
                    <path d="M12 80 L12 60 M22 80 L22 60 M32 80 L32 60 M42 80 L42 60" />
                    <path d="M8 66 L46 66 M8 72 L46 72" />
                    <!-- árbol -->
                    <circle cx="72" cy="48" r="18" />
                    <path d="M72 66 L72 86" />
                    <!-- pasto -->
                    <path d="M52 84 L54 80 M58 84 L60 80 M86 84 L88 80" />
                </svg>`);
        }

        return ''; // fallback sin decoración
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar listado principal (jerarquía nivel raíz)
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedades() {
        const { data, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion, tipo_propiedad, propiedad_padre_id, descripcion, activa, creado_en')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('activa', true)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[PROPIEDADES] Error:', error);
            document.getElementById('lista-propiedades').innerHTML = `
                <div class="col-span-full p-6 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-sm text-center">
                    No se pudo cargar el portafolio. ${esc(error.message || '')}
                </div>`;
            return;
        }
        _todas = data || [];

        await _attachInfoOcupacion(_todas);

        _renderMetricas();
        _renderListado();
    }

    // Enriquecer cada propiedad con: ocupada, monto, cumplimiento, incidencias
    async function _attachInfoOcupacion(props) {
        const ids = props.map(p => p.propiedad_id);
        if (!ids.length) return;

        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, propiedad_id, monto_renta, inquilino_id,
                inquilinos ( inquilino_id, usuarios ( nombre_completo, correo ) )
            `)
            .in('propiedad_id', ids)
            .eq('estado', 'ACTIVO');

        const mapContrato = {};
        (contratos || []).forEach(c => { mapContrato[c.propiedad_id] = c; });

        const { data: incidencias } = await window.supabaseClient
            .from('incidencias')
            .select('incidencia_id, propiedad_id, estado')
            .in('propiedad_id', ids)
            .in('estado', ['ABIERTA', 'EN_PROCESO']);

        const mapInc = {};
        (incidencias || []).forEach(i => {
            mapInc[i.propiedad_id] = (mapInc[i.propiedad_id] || 0) + 1;
        });

        const contratoIds = (contratos || []).map(c => c.contrato_id);
        const mapCumplimiento = {};
        if (contratoIds.length) {
            const { data: pagos } = await window.supabaseClient
                .from('calendario_pagos')
                .select('contrato_id, estado')
                .in('contrato_id', contratoIds);

            const agrup = {};
            (pagos || []).forEach(p => {
                agrup[p.contrato_id] = agrup[p.contrato_id] || { total: 0, vencidos: 0 };
                agrup[p.contrato_id].total++;
                if (p.estado === 'VENCIDO') agrup[p.contrato_id].vencidos++;
            });
            (contratos || []).forEach(c => {
                const a = agrup[c.contrato_id];
                if (!a || a.total === 0) { mapCumplimiento[c.propiedad_id] = null; return; }
                mapCumplimiento[c.propiedad_id] = Math.round(((a.total - a.vencidos) / a.total) * 100);
            });
        }

        props.forEach(p => {
            const c = mapContrato[p.propiedad_id];
            p._contrato = c || null;
            p._ocupada = !!c;
            p._inquilino = c?.inquilinos?.usuarios?.nombre_completo || null;
            p._monto = c?.monto_renta || null;
            p._incidencias = mapInc[p.propiedad_id] || 0;
            p._cumplimiento = mapCumplimiento[p.propiedad_id] ?? null;
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Métricas resumen
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas() {
        const habitables = _todas.filter(p => p.tipo_propiedad !== 'EDIFICIO');
        const ocupadas = habitables.filter(p => p._ocupada).length;
        const disponibles = habitables.length - ocupadas;
        const edificios = _todas.filter(p => p.tipo_propiedad === 'EDIFICIO').length;

        document.getElementById('m-total').textContent       = habitables.length;
        document.getElementById('m-ocupadas').textContent    = ocupadas;
        document.getElementById('m-disponibles').textContent = disponibles;
        document.getElementById('m-edificios').textContent   = edificios;
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        ['f-buscar','f-tipo','f-estado'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', _renderListado);
            document.getElementById(id)?.addEventListener('change', _renderListado);
        });
    }

    function _aplicarFiltros() {
        const q  = (document.getElementById('f-buscar')?.value || '').toLowerCase().trim();
        const t  = document.getElementById('f-tipo')?.value || '';
        const es = document.getElementById('f-estado')?.value || '';

        return _todas
            .filter(p => p.propiedad_padre_id === null)
            .filter(p => !t || p.tipo_propiedad === t)
            .filter(p => !q || (p.nombre.toLowerCase().includes(q) || (p.direccion || '').toLowerCase().includes(q)))
            .filter(p => {
                if (!es) return true;
                if (p.tipo_propiedad === 'EDIFICIO') return true;
                if (es === 'ocupada') return p._ocupada;
                if (es === 'disponible') return !p._ocupada;
                return true;
            });
    }

    // ──────────────────────────────────────────────────────────────
    // Cierre global de menús dropdown al clickear afuera
    // ──────────────────────────────────────────────────────────────
    function _bindGlobalClicks() {
        document.addEventListener('click', (e) => {
            // Si el click no proviene del botón del menú ni del menú mismo, cerrar
            if (!e.target.closest('[data-menu-trigger]') && !e.target.closest('[data-menu-content]')) {
                _cerrarTodosMenus();
            }
        });
        // ESC cierra también
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') _cerrarTodosMenus();
        });
    }

    function _cerrarTodosMenus() {
        document.querySelectorAll('[data-menu-content]').forEach(el => el.classList.add('hidden'));
        _menuAbiertoId = null;
    }

    function _toggleMenu(id) {
        const menu = document.querySelector(`[data-menu-content="${id}"]`);
        if (!menu) return;
        const yaAbierto = !menu.classList.contains('hidden');
        _cerrarTodosMenus();
        if (!yaAbierto) {
            menu.classList.remove('hidden');
            _menuAbiertoId = id;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Listado principal
    // ──────────────────────────────────────────────────────────────
    function _renderListado() {
        const lista = _aplicarFiltros();
        const cont = document.getElementById('lista-propiedades');
        if (!lista.length) {
            cont.innerHTML = `
                <div class="col-span-full p-10 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <svg class="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"/>
                        </svg>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin propiedades</p>
                    <p class="text-slate-400 text-sm mb-4">No hay coincidencias con los filtros actuales.</p>
                    <a href="agregar-propiedad.html" class="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                        Agregar primera propiedad
                    </a>
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(_renderCardPropiedad).join('');

        cont.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const id = parseInt(btn.getAttribute('data-id'), 10);
                _despacharAccion(action, id);
            });
        });
    }

    function _renderCardPropiedad(p) {
        const isEdif = p.tipo_propiedad === 'EDIFICIO';
        const tipoLbl = { EDIFICIO:'Edificio', DEPARTAMENTO:'Departamento', CASA:'Casa', LOCAL:'Local', TERRENO:'Terreno' }[p.tipo_propiedad];
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);

        let estadoBadge = '';
        if (!isEdif) {
            estadoBadge = p._ocupada
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-semibold">
                       <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span> Ocupada
                   </span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold">
                       <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Disponible
                   </span>`;
        }

        const hijasCount = isEdif ? _todas.filter(c => c.propiedad_padre_id === p.propiedad_id).length : 0;

        let cuerpo = '';
        if (isEdif) {
            cuerpo = `
                <div class="flex gap-3 text-xs text-slate-500">
                    <span class="px-2 py-1 rounded-md bg-blue-50 text-blue-700 font-semibold">${hijasCount} departamentos</span>
                </div>`;
        } else {
            cuerpo = `
                <div class="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div class="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Renta</p>
                        <p class="text-slate-800 font-bold">${p._monto ? fmtMoney(p._monto) : '—'}</p>
                    </div>
                    <div class="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Cumplimiento</p>
                        <p class="font-bold ${_colorCumplimiento(p._cumplimiento)}">${p._cumplimiento != null ? p._cumplimiento + '%' : '—'}</p>
                    </div>
                </div>
                ${p._inquilino ? `
                    <p class="mt-2 text-xs text-slate-500 truncate">
                        <span class="font-semibold">Inquilino:</span> ${esc(p._inquilino)}
                    </p>` : ''}
            `;
        }

        let acciones = '';
        if (isEdif) {
            acciones = `
                <button data-action="ver-edificio" data-id="${p.propiedad_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
                    Ver departamentos
                </button>`;
        } else if (p._ocupada) {
            acciones = `
                <button data-action="ver-inquilino" data-id="${p.propiedad_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold">
                    Ver inquilino
                </button>`;
        } else {
            acciones = `
                <a href="contratos.html?deptoId=${p.propiedad_id}"
                   class="flex-1 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-semibold text-center">
                    Crear contrato
                </a>`;
        }

        const btnIncidencias = !isEdif ? `
            <button data-action="incidencias" data-id="${p.propiedad_id}"
                    class="relative px-2.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-semibold"
                    title="Incidencias">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
                </svg>
                ${p._incidencias > 0 ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">${p._incidencias}</span>` : ''}
            </button>` : '';

        // SVG decorativo según el tipo (z-index bajo, opacidad baja)
        const svgFondo = _svgFondo(p.tipo_propiedad);

        // ── Card: contenedor relativo + overflow-hidden para el SVG de fondo ──
        // El contenido propio va en una capa "relative z-10" para quedar por encima.
        return `
        <div class="relative overflow-hidden bg-white rounded-2xl border border-slate-100 shadow-sm p-5
                    hover:shadow-md transition-shadow anim-fade-in-up">
            ${svgFondo}
            <div class="relative z-10">
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase">${tipoLbl}</span>
                            ${estadoBadge}
                        </div>
                        <h5 class="text-slate-900 font-bold text-sm truncate">${esc(p.nombre)}</h5>
                        <p class="text-slate-500 text-xs truncate">${esc(p.direccion)}</p>
                    </div>

                    <!-- ╔═══ Menú "kebab" (3 puntos) con dropdown ═══╗ -->
                    <div class="relative flex-shrink-0">
                        <button data-action="menu" data-menu-trigger data-id="${p.propiedad_id}"
                                class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01"/>
                            </svg>
                        </button>
                        <!-- Dropdown flotante: oculto por defecto, alineado a la derecha del botón -->
                        <div data-menu-content="${p.propiedad_id}"
                             class="hidden absolute right-0 top-9 z-30 min-w-[150px]
                                    bg-white border border-slate-200 rounded-xl shadow-lg
                                    overflow-hidden anim-fade-in-up">
                            <button data-action="editar" data-id="${p.propiedad_id}"
                                    class="w-full flex items-center gap-2 px-3.5 py-2.5 text-left
                                           text-slate-700 hover:bg-slate-50 text-xs font-medium transition-colors">
                                <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                                </svg>
                                Editar
                            </button>
                            <button data-action="eliminar" data-id="${p.propiedad_id}"
                                    class="w-full flex items-center gap-2 px-3.5 py-2.5 text-left
                                           text-red-600 hover:bg-red-50 text-xs font-medium transition-colors
                                           border-t border-slate-100">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/>
                                </svg>
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
                ${cuerpo}
                <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    ${acciones}
                    ${btnIncidencias}
                </div>
            </div>
        </div>`;
    }

    function _colorCumplimiento(pct) {
        if (pct == null) return 'text-slate-500';
        if (pct >= 90) return 'text-green-600';
        if (pct >= 70) return 'text-yellow-600';
        return 'text-red-600';
    }

    // ──────────────────────────────────────────────────────────────
    // Despachador de acciones
    // ──────────────────────────────────────────────────────────────
    function _despacharAccion(action, id) {
        switch (action) {
            case 'ver-edificio':   return _abrirModalEdificio(id);
            case 'ver-inquilino':  return _verInquilino(id);
            case 'incidencias':    return _abrirModalIncidencias(id);
            case 'menu':           return _toggleMenu(id);
            case 'editar':         return _editarPropiedad(id);
            case 'eliminar':       return _pedirConfirmEliminar(id);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Editar (redirige al formulario en modo edición)
    // ──────────────────────────────────────────────────────────────
    function _editarPropiedad(id) {
        _cerrarTodosMenus();
        window.location.href = `agregar-propiedad.html?editId=${id}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Modal edificio: lista de departamentos hijos (jerarquía)
    // ──────────────────────────────────────────────────────────────
    async function _abrirModalEdificio(edifId) {
        const edif = _todas.find(p => p.propiedad_id === edifId);
        if (!edif) return;
        document.getElementById('mod-edif-nombre').textContent = edif.nombre;
        document.getElementById('mod-edif-direccion').textContent = edif.direccion;
        const body = document.getElementById('mod-edif-body');
        body.innerHTML = `<p class="text-slate-400 text-sm text-center py-8">Cargando…</p>`;

        const modal = document.getElementById('modal-edificio');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const hijos = _todas.filter(p => p.propiedad_padre_id === edifId);

        if (!hijos.length) {
            body.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-slate-400 text-sm mb-3">Este edificio aún no tiene departamentos registrados.</p>
                    <a href="agregar-propiedad.html?editId=${edifId}" class="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                        Editar y agregar departamentos
                    </a>
                </div>`;
            return;
        }

        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);

        body.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${hijos.map(h => `
            <div class="rounded-xl border border-slate-100 p-3.5 hover:border-blue-200 transition">
                <div class="flex items-center justify-between mb-1">
                    <p class="font-bold text-slate-800 text-sm truncate">${esc(h.nombre)}</p>
                    ${h._ocupada
                        ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Ocupado</span>`
                        : `<span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Disponible</span>`}
                </div>
                <div class="text-xs text-slate-500 space-y-0.5">
                    <p><span class="font-medium">Renta:</span> ${h._monto ? fmtMoney(h._monto) : '—'}</p>
                    <p><span class="font-medium">Cumplimiento:</span>
                        <span class="${_colorCumplimiento(h._cumplimiento)} font-semibold">${h._cumplimiento != null ? h._cumplimiento + '%' : '—'}</span>
                    </p>
                    <p><span class="font-medium">Incidencias:</span> ${h._incidencias}</p>
                    ${h._inquilino ? `<p class="truncate"><span class="font-medium">Inquilino:</span> ${esc(h._inquilino)}</p>` : ''}
                </div>
                <div class="flex gap-1.5 mt-3">
                    ${h._ocupada
                        ? `<button data-action="ver-inquilino" data-id="${h.propiedad_id}" class="flex-1 px-2 py-1.5 rounded-lg bg-slate-800 text-white text-[11px] font-semibold">Ver inquilino</button>`
                        : `<a href="contratos.html?deptoId=${h.propiedad_id}" class="flex-1 px-2 py-1.5 rounded-lg bg-green-600 text-white text-[11px] font-semibold text-center">Crear contrato</a>`}
                    <button data-action="editar" data-id="${h.propiedad_id}" class="px-2 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-semibold" title="Editar">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                    </button>
                    <button data-action="eliminar" data-id="${h.propiedad_id}" class="px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold" title="Eliminar">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('')}</div>`;

        body.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const id = parseInt(btn.getAttribute('data-id'), 10);
                _despacharAccion(action, id);
            });
        });
    }

    function cerrarModal() {
        const modal = document.getElementById('modal-edificio');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ──────────────────────────────────────────────────────────────
    // Modal de incidencias (resumen rápido)
    // ──────────────────────────────────────────────────────────────
    async function _abrirModalIncidencias(propId) {
        const prop = _todas.find(p => p.propiedad_id === propId);
        document.getElementById('mod-inc-prop').textContent = prop?.nombre || '';
        const body = document.getElementById('mod-inc-body');
        body.innerHTML = `<p class="text-slate-400 text-sm text-center py-8">Cargando…</p>`;
        const modal = document.getElementById('modal-incidencias');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const { data } = await window.supabaseClient
            .from('incidencias')
            .select('incidencia_id, titulo, estado, categoria, creado_en')
            .eq('propiedad_id', propId)
            .order('creado_en', { ascending: false })
            .limit(20);

        if (!data?.length) {
            body.innerHTML = `<p class="text-center text-slate-400 text-sm py-8">Sin incidencias registradas. 🎉</p>`;
            return;
        }

        const lbl = { ABIERTA:['Abierta','bg-red-100 text-red-700'], EN_PROCESO:['En proceso','bg-yellow-100 text-yellow-700'], RESUELTA:['Resuelta','bg-green-100 text-green-700'] };
        body.innerHTML = data.map(i => `
            <div class="py-3 first:pt-0 last:pb-0">
                <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-semibold text-slate-800 truncate">${esc(i.titulo)}</p>
                    <span class="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold ${lbl[i.estado]?.[1] || 'bg-slate-100 text-slate-600'}">${esc(lbl[i.estado]?.[0] || i.estado)}</span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">${esc(i.categoria)} · ${new Date(i.creado_en).toLocaleDateString('es-MX')}</p>
            </div>
        `).join('');
    }
    function cerrarModalIncidencias() {
        const modal = document.getElementById('modal-incidencias');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    // ──────────────────────────────────────────────────────────────
    // Ver inquilino → redirige al contrato
    // ──────────────────────────────────────────────────────────────
    function _verInquilino(propId) {
        const p = _todas.find(x => x.propiedad_id === propId);
        if (!p?._contrato) return;
        window.location.href = `contratos.html?contratoId=${p._contrato.contrato_id}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Eliminar (RF-08 + RN-01)
    // ──────────────────────────────────────────────────────────────
    async function _pedirConfirmEliminar(id) {
        _cerrarTodosMenus();
        const p = _todas.find(x => x.propiedad_id === id);
        if (!p) return;

        // ── RN-01: validar que la propiedad (y sus hijos, si es edificio)
        //          no tengan contratos ACTIVOS antes de proceder ──
        const idsAVerificar = [p.propiedad_id];
        if (p.tipo_propiedad === 'EDIFICIO') {
            const hijos = _todas.filter(c => c.propiedad_padre_id === p.propiedad_id);
            hijos.forEach(h => idsAVerificar.push(h.propiedad_id));
        }
        const { count } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id', { count: 'exact', head: true })
            .in('propiedad_id', idsAVerificar)
            .eq('estado', 'ACTIVO');

        if ((count || 0) > 0) {
            if (window.TOAST) {
                TOAST.error('No es posible eliminar esta propiedad: tiene contratos activos asociados. Finaliza los contratos primero.');
            } else {
                alert('No es posible eliminar: hay contratos activos asociados.');
            }
            return;
        }

        _idPendienteBorrar = id;
        const msg = p.tipo_propiedad === 'EDIFICIO'
            ? `Vas a desactivar el edificio "${p.nombre}" y sus departamentos asociados.`
            : `Vas a desactivar "${p.nombre}". Podrás volver a registrarla luego.`;
        document.getElementById('mod-del-msg').textContent = msg;
        const m = document.getElementById('modal-eliminar');
        m.classList.remove('hidden'); m.classList.add('flex');
    }

    function cerrarModalEliminar() {
        const m = document.getElementById('modal-eliminar');
        m.classList.add('hidden'); m.classList.remove('flex');
        _idPendienteBorrar = null;
    }

    async function _ejecutarEliminacion() {
        if (!_idPendienteBorrar) return;
        const id = _idPendienteBorrar;
        const p = _todas.find(x => x.propiedad_id === id);

        // Soft-delete (activa=false). Para edificios, cascada a sus hijos.
        const idsADesactivar = [id];
        if (p?.tipo_propiedad === 'EDIFICIO') {
            const hijos = _todas.filter(c => c.propiedad_padre_id === id);
            hijos.forEach(h => idsADesactivar.push(h.propiedad_id));
        }

        const { error } = await window.supabaseClient
            .from('propiedades')
            .update({ activa: false })
            .in('propiedad_id', idsADesactivar);

        cerrarModalEliminar();
        if (error) {
            if (window.TOAST) TOAST.error('No se pudo eliminar: ' + error.message);
            else alert('No se pudo eliminar: ' + error.message);
            return;
        }
        if (window.TOAST) TOAST.success('Propiedad eliminada correctamente.');
        await _cargarPropiedades();
    }

    // ──────────────────────────────────────────────────────────────
    // Crear modales dinámicamente si no existen
    // ──────────────────────────────────────────────────────────────
    function _asegurarModales() {
        if (document.getElementById('modal-edificio')) return;

        const modalEdificioHTML = `
        <div id="modal-edificio" class="fixed inset-0 z-40 hidden items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-200 p-0 sm:p-4">
            <div class="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                    <div class="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                        <svg class="w-5 h-5 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                        </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h4 id="mod-edif-nombre" class="text-slate-900 font-bold text-base truncate">Edificio</h4>
                        <p id="mod-edif-direccion" class="text-slate-500 text-xs truncate">—</p>
                    </div>
                    <button onclick="PROPIEDADES.cerrarModal()" class="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
                <div id="mod-edif-body" class="flex-1 overflow-y-auto p-5 space-y-3">
                    <p class="text-slate-400 text-sm text-center py-8">Cargando departamentos…</p>
                </div>
            </div>
        </div>`;

        const modalIncidenciasHTML = `
        <div id="modal-incidencias" class="fixed inset-0 z-50 hidden items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
                <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                    <div class="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                        <svg class="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
                        </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h4 class="text-slate-900 font-bold text-base">Incidencias</h4>
                        <p id="mod-inc-prop" class="text-slate-500 text-xs truncate">—</p>
                    </div>
                    <button onclick="PROPIEDADES.cerrarModalIncidencias()" class="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
                <div id="mod-inc-body" class="flex-1 overflow-y-auto p-4 divide-y divide-slate-100"></div>
            </div>
        </div>`;

        const modalEliminarHTML = `
        <div id="modal-eliminar" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div class="bg-white max-w-sm w-full rounded-2xl p-5 shadow-2xl">
                <div class="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-3">
                    <svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                </div>
                <h4 class="text-slate-900 font-bold text-center text-base">¿Eliminar propiedad?</h4>
                <p id="mod-del-msg" class="text-slate-500 text-sm text-center mt-2">Esta acción la desactivará del portafolio.</p>
                <div class="flex gap-2 mt-5">
                    <button onclick="PROPIEDADES.cerrarModalEliminar()" class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">Cancelar</button>
                    <button id="btn-confirmar-eliminar" class="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">Eliminar</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalEdificioHTML);
        document.body.insertAdjacentHTML('beforeend', modalIncidenciasHTML);
        document.body.insertAdjacentHTML('beforeend', modalEliminarHTML);

        // Bind del botón confirmar (¡importante! antes estaba comentado)
        document.getElementById('btn-confirmar-eliminar')?.addEventListener('click', _ejecutarEliminacion);
    }

    return { init, cerrarModal, cerrarModalIncidencias, cerrarModalEliminar };
})();

window.PROPIEDADES = PROPIEDADES;