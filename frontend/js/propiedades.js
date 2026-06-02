// ================================================================
// propiedades.js  –  Listado, modificación y eliminación de propiedades
// ================================================================
// Implementa:
//   - RF-07: Modificar (vía inline edit / link a edición)
//   - RF-08: Eliminar (respetando RN-01 → no eliminar si hay contratos activos)
//   - RF-09: Listado general
//   - RF-10: Jerarquía edificio → departamentos (modal interactivo)
//
// ⚙ Consulta jerárquica clave:
//   1) Edificios y unidades sueltas:
//        .from('propiedades').eq('duenio_id', uid).is('propiedad_padre_id', null)
//   2) Departamentos de un edificio:
//        .from('propiedades').eq('propiedad_padre_id', edificioId)
//
//   El esquema usa `propiedad_padre_id` (NO `parent_id`).
// ================================================================

const PROPIEDADES = (() => {

    let _usuario = null;
    let _todas = [];           // todas las propiedades cargadas (edificios + sueltas)
    let _idPendienteBorrar = null;

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;
        _bindFiltros();
        _bindEliminarConfirm();
        await _cargarPropiedades();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar listado principal (jerarquía nivel raíz)
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedades() {
        // Cargamos TODAS las propiedades activas del arrendador y filtramos en cliente
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

        // Pre-calcular: para cada propiedad, ¿tiene contrato activo? (una sola query)
        await _attachInfoOcupacion(_todas);

        _renderMetricas();
        _renderListado();
    }

    // Anexar a cada propiedad: ocupada (bool), cumplimiento, n_incidencias
    async function _attachInfoOcupacion(props) {
        const ids = props.map(p => p.propiedad_id);
        if (!ids.length) return;

        // Contratos ACTIVOS de esas propiedades (con inquilino para mostrar)
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

        // Incidencias ABIERTAS / EN_PROCESO por propiedad
        const { data: incidencias } = await window.supabaseClient
            .from('incidencias')
            .select('incidencia_id, propiedad_id, estado')
            .in('propiedad_id', ids)
            .in('estado', ['ABIERTA', 'EN_PROCESO']);

        const mapInc = {};
        (incidencias || []).forEach(i => {
            mapInc[i.propiedad_id] = (mapInc[i.propiedad_id] || 0) + 1;
        });

        // Cumplimiento de pagos del contrato activo (si existe)
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
                // % pagos NO vencidos
                mapCumplimiento[c.propiedad_id] = Math.round(((a.total - a.vencidos) / a.total) * 100);
            });
        }

        // Anexar info a cada propiedad
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
    // Renderizar métricas resumen
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas() {
        // Sólo cuentan unidades habitables (no edificios padre)
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

        // Sólo a nivel raíz (jerarquía): edificios + propiedades sueltas
        return _todas
            .filter(p => p.propiedad_padre_id === null)
            .filter(p => !t || p.tipo_propiedad === t)
            .filter(p => !q || (p.nombre.toLowerCase().includes(q) || (p.direccion || '').toLowerCase().includes(q)))
            .filter(p => {
                if (!es) return true;
                if (p.tipo_propiedad === 'EDIFICIO') return true; // los edificios pasan
                if (es === 'ocupada') return p._ocupada;
                if (es === 'disponible') return !p._ocupada;
                return true;
            });
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

        // Bind acciones
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

        // Estado (sólo para no-edificios)
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

        // Para edificios → contar hijas
        const hijasCount = isEdif ? _todas.filter(c => c.propiedad_padre_id === p.propiedad_id).length : 0;

        // Cuerpo según tipo
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

        // Acciones
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

        // Botón incidencias (sólo para unidades habitables)
        const btnIncidencias = !isEdif ? `
            <button data-action="incidencias" data-id="${p.propiedad_id}"
                    class="relative px-2.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-semibold"
                    title="Incidencias">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
                </svg>
                ${p._incidencias > 0 ? `<span class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">${p._incidencias}</span>` : ''}
            </button>` : '';

        return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-shadow anim-fade-in-up">
            <div class="flex items-start justify-between gap-2 mb-2">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase">${tipoLbl}</span>
                        ${estadoBadge}
                    </div>
                    <h5 class="text-slate-900 font-bold text-sm truncate">${esc(p.nombre)}</h5>
                    <p class="text-slate-500 text-xs truncate">${esc(p.direccion)}</p>
                </div>
                <!-- menú acciones -->
                <div class="relative flex-shrink-0">
                    <button data-action="menu" data-id="${p.propiedad_id}" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v.01M12 12v.01M12 19v.01"/>
                        </svg>
                    </button>
                </div>
            </div>
            ${cuerpo}
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                ${acciones}
                ${btnIncidencias}
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
    // Despachador de acciones de las tarjetas
    // ──────────────────────────────────────────────────────────────
    function _despacharAccion(action, id) {
        switch (action) {
            case 'ver-edificio':   return _abrirModalEdificio(id);
            case 'ver-inquilino':  return _verInquilino(id);
            case 'incidencias':    return _abrirModalIncidencias(id);
            case 'menu':           return _mostrarMenuAcciones(id);
            case 'editar':         return _editarPropiedad(id);
            case 'eliminar':       return _pedirConfirmEliminar(id);
        }
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

        // Consulta jerárquica: hijos de este edificio
        const hijos = _todas.filter(p => p.propiedad_padre_id === edifId);

        if (!hijos.length) {
            body.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-slate-400 text-sm mb-3">Este edificio aún no tiene departamentos registrados.</p>
                    <a href="agregar-propiedad.html" class="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                        Agregar departamento
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
                    <button data-action="eliminar" data-id="${h.propiedad_id}" class="px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[11px] font-semibold" title="Eliminar">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('')}</div>`;

        // Rebind acciones dentro del modal
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
    // Modal incidencias (resumen rápido por propiedad)
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
    // Ver inquilino → redirige al detalle del contrato/inquilino
    // ──────────────────────────────────────────────────────────────
    function _verInquilino(propId) {
        const p = _todas.find(x => x.propiedad_id === propId);
        if (!p?._contrato) return;
        // Ruta esperada del Dev 3: contratos.html?contratoId=
        window.location.href = `contratos.html?contratoId=${p._contrato.contrato_id}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Menú de acciones (Editar / Eliminar)
    // ──────────────────────────────────────────────────────────────
    function _mostrarMenuAcciones(id) {
        const p = _todas.find(x => x.propiedad_id === id);
        if (!p) return;
        // Implementación simple: abrir un confirm con opciones via prompt nativo del navegador
        // Para mantener un solo modal, abrimos directamente la confirmación de eliminar:
        _pedirConfirmEliminar(id);
    }

    function _editarPropiedad(id) {
        // Dejamos enlace al flujo de edición (a implementar en agregar-propiedad.html?id=X)
        window.location.href = `agregar-propiedad.html?id=${id}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Eliminar (RF-08 + RN-01)
    // ──────────────────────────────────────────────────────────────
    function _bindEliminarConfirm() {
        document.getElementById('btn-confirmar-eliminar')?.addEventListener('click', _ejecutarEliminacion);
    }

    async function _pedirConfirmEliminar(id) {
        const p = _todas.find(x => x.propiedad_id === id);
        if (!p) return;

        // 1. Validar RN-01: que no tenga contratos ACTIVOS
        const idsAVerificar = [p.propiedad_id];
        // Si es edificio, también validar sus hijos
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
            alert('No es posible eliminar esta propiedad: tiene contratos activos asociados (RN-01). Finaliza los contratos primero.');
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

        // En lugar de DELETE definitivo, hacemos soft-delete (activa=false)
        // Para edificios, desactivar también los hijos (jerarquía).
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
            alert('No se pudo eliminar: ' + error.message);
            return;
        }
        // Recargar listado
        await _cargarPropiedades();
    }

    return { init, cerrarModal, cerrarModalIncidencias, cerrarModalEliminar };
})();

window.PROPIEDADES = PROPIEDADES;