// ================================================================
// inquilinos-edificio.js  –  Inquilinos del arrendador con semáforo
// ================================================================
// Implementa:
//   - RF-11/12/13: Visualizar inquilinos vinculados a las propiedades.
//   - "Semáforo de Confianza" (Verde / Amarillo / Rojo) calculado a partir
//      del calendario de pagos del contrato activo.
//
// ⚙ Reglas del semáforo:
//   VERDE   → 0 pagos VENCIDO  AND  ≥ 90% pagados a tiempo
//   AMARILLO→ ≤ 2 pagos VENCIDO o entre 60-89% cumplimiento
//   ROJO    → > 2 vencidos o cumplimiento < 60%
//
// ⚙ Consultas jerárquicas:
//   .from('propiedades').eq('duenio_id', uid)
//   - Edificios:    .eq('tipo_propiedad','EDIFICIO').is('propiedad_padre_id', null)
//   - Departamentos de un edificio:
//     .eq('propiedad_padre_id', edificioId)
// ================================================================

const INQUILINOS_EDIFICIO = (() => {

    let _usuario = null;
    let _inquilinos = [];   // estructura enriquecida
    let _edificios  = [];

    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;
        _asegurarModalHistorial();

        // Soportar ?edificioId= en URL para filtrar directamente
        const params = new URLSearchParams(window.location.search);
        const edificioPreset = params.get('edificioId');

        await _cargarEdificios();
        if (edificioPreset) {
            const sel = document.getElementById('filtro-edificio');
            if (sel) sel.value = edificioPreset;
        }
        await _cargarInquilinos();

        _bindFiltros();
    }

    // ──────────────────────────────────────────────────────────────
    // 1. Cargar edificios del arrendador (para el filtro superior)
    // ──────────────────────────────────────────────────────────────
    async function _cargarEdificios() {
        const { data } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('tipo_propiedad', 'EDIFICIO')
            .eq('activa', true)
            .is('propiedad_padre_id', null)
            .order('nombre');
        _edificios = data || [];
        const sel = document.getElementById('filtro-edificio');
        if (sel) {
            sel.innerHTML = `<option value="">Todos los edificios</option>` +
                _edificios.map(e => `<option value="${e.propiedad_id}">${esc(e.nombre)}</option>`).join('');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 2. Cargar contratos + inquilinos + pagos
    // ──────────────────────────────────────────────────────────────
    async function _cargarInquilinos() {
        // Propiedades del arrendador (incluyendo hijas)
        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion, propiedad_padre_id, tipo_propiedad')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('activa', true);
        const propIds = (props || []).map(p => p.propiedad_id);
        if (!propIds.length) {
            _inquilinos = [];
            _renderResumen(); _renderLista();
            return;
        }
        const mapProp = {};
        (props || []).forEach(p => { mapProp[p.propiedad_id] = p; });

        // Contratos activos en estas propiedades + datos del inquilino y usuario
        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, propiedad_id, inquilino_id, fecha_inicio, fecha_fin, monto_renta, estado,
                inquilinos (
                    inquilino_id, contacto_emergencia, telefono_emergencia,
                    usuarios ( usuario_id, nombre_completo, correo, telefono )
                )
            `)
            .in('propiedad_id', propIds)
            .eq('estado', 'ACTIVO');

        const contratoIds = (contratos || []).map(c => c.contrato_id);
        // Pagos de esos contratos
        let mapPagos = {};
        if (contratoIds.length) {
            const { data: pagos } = await window.supabaseClient
                .from('calendario_pagos')
                .select('contrato_id, estado, fecha_limite, fecha_pagado')
                .in('contrato_id', contratoIds);
            (pagos || []).forEach(p => {
                if (!mapPagos[p.contrato_id]) mapPagos[p.contrato_id] = [];
                mapPagos[p.contrato_id].push(p);
            });
        }

        // Armar lista enriquecida
        _inquilinos = (contratos || []).map(c => {
            const pagos = mapPagos[c.contrato_id] || [];
            const semaforo = _calcularSemaforo(pagos);
            const prop = mapProp[c.propiedad_id] || {};
            return {
                contrato_id: c.contrato_id,
                propiedad_id: c.propiedad_id,
                propiedad_nombre: prop.nombre,
                propiedad_direccion: prop.direccion,
                edificio_id: prop.propiedad_padre_id,
                fecha_inicio: c.fecha_inicio,
                fecha_fin: c.fecha_fin,
                monto_renta: c.monto_renta,
                nombre: c.inquilinos?.usuarios?.nombre_completo || 'Inquilino',
                correo: c.inquilinos?.usuarios?.correo || '',
                telefono: c.inquilinos?.usuarios?.telefono || '',
                contacto_emergencia: c.inquilinos?.contacto_emergencia || '',
                telefono_emergencia: c.inquilinos?.telefono_emergencia || '',
                inquilino_id: c.inquilino_id,
                pagos,
                semaforo,
            };
        });

        _renderResumen();
        _renderLista();
    }

    // ──────────────────────────────────────────────────────────────
    // Cálculo del semáforo de confianza
    // ──────────────────────────────────────────────────────────────
    function _calcularSemaforo(pagos) {
        if (!pagos.length) return { nivel: 'AMARILLO', cumplimiento: null, vencidos: 0, total: 0 };
        const total = pagos.length;
        const vencidos = pagos.filter(p => p.estado === 'VENCIDO').length;
        const pagados  = pagos.filter(p => p.estado === 'PAGADO').length;
        const cumpl = Math.round((pagados / total) * 100);

        let nivel = 'VERDE';
        if (vencidos > 2 || cumpl < 60) nivel = 'ROJO';
        else if (vencidos >= 1 || cumpl < 90) nivel = 'AMARILLO';

        return { nivel, cumplimiento: cumpl, vencidos, total };
    }

    // ──────────────────────────────────────────────────────────────
    // Resumen de semáforos
    // ──────────────────────────────────────────────────────────────
    function _renderResumen() {
        const aplicables = _filtrar(_inquilinos);
        const v = aplicables.filter(i => i.semaforo.nivel === 'VERDE').length;
        const a = aplicables.filter(i => i.semaforo.nivel === 'AMARILLO').length;
        const r = aplicables.filter(i => i.semaforo.nivel === 'ROJO').length;
        document.getElementById('m-verdes').textContent    = v;
        document.getElementById('m-amarillos').textContent = a;
        document.getElementById('m-rojos').textContent     = r;
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        document.getElementById('filtro-edificio')?.addEventListener('change', () => { _renderResumen(); _renderLista(); });
        document.getElementById('filtro-semaforo')?.addEventListener('change', () => { _renderResumen(); _renderLista(); });
    }

    function _filtrar(lista) {
        const edif = document.getElementById('filtro-edificio')?.value || '';
        const sem  = document.getElementById('filtro-semaforo')?.value || '';
        return lista
            .filter(i => !edif || String(i.edificio_id) === edif || String(i.propiedad_id) === edif)
            .filter(i => !sem || i.semaforo.nivel === sem);
    }

    // ──────────────────────────────────────────────────────────────
    // Render de tarjetas
    // ──────────────────────────────────────────────────────────────
    function _renderLista() {
        const cont = document.getElementById('lista-inquilinos');
        const lista = _filtrar(_inquilinos);
        if (!lista.length) {
            cont.innerHTML = `
                <div class="col-span-full p-10 bg-white rounded-2xl border border-slate-100 text-center">
                    <p class="text-slate-700 font-semibold mb-1">No hay inquilinos</p>
                    <p class="text-slate-400 text-sm">No se encontraron inquilinos con los filtros actuales.</p>
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(i => _renderCard(i)).join('');

        cont.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const id = parseInt(btn.getAttribute('data-id'), 10);
                _despachar(action, id);
            });
        });
    }

    function _renderCard(i) {
        const iniciales = (i.nombre || 'U').split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase();
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);
        const fmtFecha = d => new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });

        const semColors = {
            VERDE:    { bg:'bg-green-50',  border:'border-green-200',  text:'text-green-700',  dot:'bg-green-500',  label:'Excelente' },
            AMARILLO: { bg:'bg-yellow-50', border:'border-yellow-200', text:'text-yellow-700', dot:'bg-yellow-500', label:'Regular' },
            ROJO:     { bg:'bg-red-50',    border:'border-red-200',    text:'text-red-700',    dot:'bg-red-500',    label:'En riesgo' },
        };
        const s = semColors[i.semaforo.nivel];

        return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow anim-fade-in-up">
            <!-- Encabezado coloreado por semáforo -->
            <div class="${s.bg} ${s.border} border-b px-5 py-3 flex items-center gap-3">
                <span class="w-2.5 h-2.5 rounded-full ${s.dot} animate-pulse"></span>
                <span class="${s.text} text-xs font-bold uppercase tracking-wider">${s.label}</span>
                <span class="ml-auto text-xs font-bold ${s.text}">
                    ${i.semaforo.cumplimiento != null ? i.semaforo.cumplimiento + '% cumplimiento' : 'Sin historial'}
                </span>
            </div>

            <div class="p-5">
                <!-- Cabecera -->
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-900 font-bold text-sm truncate">${esc(i.nombre)}</p>
                        <p class="text-slate-500 text-xs truncate">${esc(i.correo)}</p>
                    </div>
                </div>

                <!-- Datos del depto -->
                <div class="rounded-xl bg-slate-50 px-3 py-2 mb-3">
                    <p class="text-[10px] text-slate-400 uppercase font-semibold">Propiedad</p>
                    <p class="text-slate-800 text-sm font-semibold truncate">${esc(i.propiedad_nombre || '—')}</p>
                    <p class="text-slate-400 text-xs truncate">${esc(i.propiedad_direccion || '')}</p>
                </div>

                <!-- Métricas -->
                <div class="grid grid-cols-3 gap-2 text-center text-xs mb-4">
                    <div>
                        <p class="text-slate-400">Renta</p>
                        <p class="font-bold text-slate-800">${fmtMoney(i.monto_renta)}</p>
                    </div>
                    <div>
                        <p class="text-slate-400">Vencidos</p>
                        <p class="font-bold ${i.semaforo.vencidos > 0 ? 'text-red-600' : 'text-slate-800'}">${i.semaforo.vencidos}</p>
                    </div>
                    <div>
                        <p class="text-slate-400">Vence</p>
                        <p class="font-bold text-slate-800 text-[11px]">${fmtFecha(i.fecha_fin)}</p>
                    </div>
                </div>

                <!-- Acciones -->
                <div class="flex gap-2">
                    <button data-action="historial" data-id="${i.contrato_id}"
                            class="flex-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold">
                        Historial
                    </button>
                    <button data-action="contrato" data-id="${i.contrato_id}"
                            class="flex-1 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
                        Ver contrato
                    </button>
                </div>
            </div>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Acciones
    // ──────────────────────────────────────────────────────────────
    function _despachar(action, id) {
        if (action === 'historial') return _abrirHistorial(id);
        if (action === 'contrato')  return window.location.href = `contratos.html?contratoId=${id}`;
    }

    async function _abrirHistorial(contratoId) {
        const i = _inquilinos.find(x => x.contrato_id === contratoId);
        if (!i) return;
        document.getElementById('mod-hist-titulo').textContent = `Historial de ${i.nombre}`;
        document.getElementById('mod-hist-prop').textContent   = i.propiedad_nombre || '';
        const body = document.getElementById('mod-hist-body');
        body.innerHTML = `<p class="text-slate-400 text-sm text-center py-6">Cargando…</p>`;
        const m = document.getElementById('modal-historial');
        m.classList.remove('hidden'); m.classList.add('flex');

        // Historial de TODOS los contratos del inquilino en esta propiedad (RN-04: una sola dueño)
        const { data: hist } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id, propiedad_id, fecha_inicio, fecha_fin, fecha_terminacion, estado, monto_renta, propiedades ( nombre )')
            .eq('inquilino_id', i.inquilino_id)
            .order('fecha_inicio', { ascending: false });

        if (!hist?.length) {
            body.innerHTML = `<p class="text-center text-slate-400 text-sm">Sin historial.</p>`;
            return;
        }

        const fmt = d => d ? new Date(d).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : '—';
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);
        const lblEstado = { ACTIVO:'Activo', FINALIZADO:'Finalizado', TERMINADO:'Terminado' };
        const colorEstado = {
            ACTIVO: 'bg-green-100 text-green-700',
            FINALIZADO: 'bg-slate-200 text-slate-600',
            TERMINADO: 'bg-orange-100 text-orange-700'
        };

        body.innerHTML = `
            <div class="space-y-3">
                <!-- línea temporal -->
                <p class="text-xs text-slate-500 mb-2">Línea temporal de ocupación:</p>
                ${hist.map(h => `
                    <div class="border border-slate-100 rounded-xl p-3.5">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <p class="font-semibold text-slate-800 text-sm truncate">${esc(h.propiedades?.nombre || 'Propiedad')}</p>
                            <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${colorEstado[h.estado] || 'bg-slate-100'}">${esc(lblEstado[h.estado] || h.estado)}</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-xs text-slate-500">
                            <div><span class="font-medium">Inicio:</span> ${fmt(h.fecha_inicio)}</div>
                            <div><span class="font-medium">Fin:</span> ${fmt(h.fecha_fin)}</div>
                            ${h.fecha_terminacion ? `<div class="col-span-2"><span class="font-medium">Terminación anticipada:</span> ${fmt(h.fecha_terminacion)}</div>` : ''}
                            <div class="col-span-2"><span class="font-medium">Renta:</span> ${fmtMoney(h.monto_renta)}</div>
                        </div>
                        <a href="contratos.html?contratoId=${h.contrato_id}" class="inline-block mt-2 text-xs text-blue-600 font-semibold hover:underline">
                            Ver contrato →
                        </a>
                    </div>
                `).join('')}
            </div>`;
    }

    function cerrarModal() {
        const m = document.getElementById('modal-historial');
        m.classList.add('hidden'); m.classList.remove('flex');
    }

    return { init, cerrarModal };
})();
// ──────────────────────────────────────────────────────────────
// Crear modal de historial si no existe en el DOM
// ──────────────────────────────────────────────────────────────
function _asegurarModalHistorial() {
    if (document.getElementById('modal-historial')) return;

    const modalHTML = `
    <div id="modal-historial"
         class="fixed inset-0 z-40 hidden items-end sm:items-center justify-center
                bg-black/50 backdrop-blur-sm p-0 sm:p-4">
        <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                <div class="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                    <svg class="w-5 h-5 text-purple-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2a4 4 0 014-4h4M3 12a9 9 0 1118 0 9 9 0 01-18 0z"/>
                    </svg>
                </div>
                <div class="flex-1 min-w-0">
                    <h4 id="mod-hist-titulo" class="text-slate-900 font-bold text-base truncate">Historial</h4>
                    <p id="mod-hist-prop" class="text-slate-500 text-xs truncate">—</p>
                </div>
                <button onclick="INQUILINOS_EDIFICIO.cerrarModal()" class="p-2 rounded-xl text-slate-400 hover:bg-slate-100">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div id="mod-hist-body" class="flex-1 overflow-y-auto p-5"></div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.INQUILINOS_EDIFICIO = INQUILINOS_EDIFICIO;