// ================================================================
// pagos.js  –  Módulo del Dev 4 (Motor de Pagos y Simulación)
// ================================================================
// Vista del ARRENDADOR. Responsabilidades:
//   - RF-21/22 : Registrar la recepción de pagos manuales.
//   - RF-23    : Cambiar el estado de un pago (PENDIENTE/PAGADO/VENCIDO).
//   - RF-24    : Consultar el historial de pagos por contrato.
//   - RN-12    : Un pago solo puede registrarse una vez (UNIQUE en
//                registros_pago.calendario_id). Registrar genera un
//                registro y marca el periodo como PAGADO.
//   - RN-13    : Marcar como VENCIDO los pagos PENDIENTES cuya
//                fecha_limite ya pasó (RPC actualizar_pagos_vencidos).
//
// El calendario de pagos se genera al ACEPTAR el contrato
// (ver contratos-inquilino.js). Aquí solo se opera sobre él.
//
// URL opcional: pagos.html?contratoId=N  → pre-selecciona ese contrato
//               (se usa al venir desde el detalle del contrato).
//
// Dependencias (cargadas antes en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const PAGOS = (() => {

    // ── Estado del módulo ──────────────────────────────────────────
    let _usuario       = null;   // Perfil del arrendador autenticado
    let _contratos     = [];     // Contratos del arrendador con calendario
    let _pagosPorCont  = {};     // { contrato_id: [ ...calendario_pagos ] }
    let _registros     = {};     // { calendario_id: registro_pago }
    let _seleccionado  = null;   // contrato_id actualmente seleccionado

    // ── Helpers de formato ─────────────────────────────────────────
    const fmtMoney = v => new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(Number(v) || 0);

    const fmtFecha = d => d
        ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
        : '—';

    const MESES = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    const hoyStr = () => new Date().toISOString().slice(0, 10);

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        const params  = new URLSearchParams(window.location.search);
        const presetId = parseInt(params.get('contratoId'), 10);
        if (!isNaN(presetId)) _seleccionado = presetId;

        await _marcarVencidos();
        await _cargarDatos();
    }

    // ──────────────────────────────────────────────────────────────
    // RN-13: marcar pagos vencidos (PENDIENTE con fecha_limite pasada)
    //   Intenta la función RPC del esquema; si no está disponible,
    //   no es crítico (el render recalcula visualmente igual).
    // ──────────────────────────────────────────────────────────────
    async function _marcarVencidos() {
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[PAGOS] RPC actualizar_pagos_vencidos no disponible:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Carga: propiedades → contratos (con calendario) → calendario → registros
    // ──────────────────────────────────────────────────────────────
    async function _cargarDatos() {
        // 1. Propiedades del arrendador
        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id')
            .eq('duenio_id', _usuario.usuario_id);

        const propIds = (props || []).map(p => p.propiedad_id);
        if (!propIds.length) {
            _contratos = [];
            _renderTodo();
            return;
        }

        // 2. Contratos con calendario (ACTIVO / FINALIZADO / TERMINADO)
        const { data: contratos, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, monto_renta,
                frecuencia_pago, estado,
                propiedades ( propiedad_id, nombre, direccion ),
                inquilinos (
                    inquilino_id,
                    usuarios ( usuario_id, nombre_completo, correo, telefono )
                )
            `)
            .in('propiedad_id', propIds)
            .in('estado', ['ACTIVO', 'FINALIZADO', 'TERMINADO'])
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[PAGOS] Error al cargar contratos:', error);
            _renderError('No se pudieron cargar los contratos.');
            return;
        }

        _contratos = contratos || [];
        const contIds = _contratos.map(c => c.contrato_id);

        // 3. Calendario de pagos de esos contratos
        _pagosPorCont = {};
        _registros    = {};
        if (contIds.length) {
            const { data: pagos } = await window.supabaseClient
                .from('calendario_pagos')
                .select('calendario_id, contrato_id, fecha_limite, monto_esperado, anio, mes, estado, fecha_pagado')
                .in('contrato_id', contIds)
                .order('fecha_limite', { ascending: true });

            (pagos || []).forEach(p => {
                (_pagosPorCont[p.contrato_id] = _pagosPorCont[p.contrato_id] || []).push(p);
            });

            // 4. Registros de pago (para mostrar monto recibido / fecha / notas)
            const calIds = (pagos || []).map(p => p.calendario_id);
            if (calIds.length) {
                const { data: regs } = await window.supabaseClient
                    .from('registros_pago')
                    .select('pago_id, calendario_id, fecha_recibido, monto_recibido, notas')
                    .in('calendario_id', calIds);
                (regs || []).forEach(r => { _registros[r.calendario_id] = r; });
            }
        }

        // Solo contratos que efectivamente tienen calendario
        _contratos = _contratos.filter(c => (_pagosPorCont[c.contrato_id] || []).length);

        // Validar selección preexistente
        if (_seleccionado && !_contratos.some(c => c.contrato_id === _seleccionado)) {
            _seleccionado = null;
        }
        if (!_seleccionado && _contratos.length) {
            _seleccionado = _contratos[0].contrato_id;
        }

        _renderTodo();
    }

    // ──────────────────────────────────────────────────────────────
    // Render maestro
    // ──────────────────────────────────────────────────────────────
    function _renderTodo() {
        _renderMetricasGlobales();
        _renderListaContratos();
        _renderCalendario();
    }

    // ── Métricas globales (montos agregados de todos los contratos) ─
    function _renderMetricasGlobales() {
        let esperado = 0, cobrado = 0, pendiente = 0, vencido = 0;

        Object.values(_pagosPorCont).flat().forEach(p => {
            esperado += Number(p.monto_esperado) || 0;
            if (p.estado === 'PAGADO') {
                const reg = _registros[p.calendario_id];
                cobrado += Number(reg?.monto_recibido ?? p.monto_esperado) || 0;
            } else if (p.estado === 'VENCIDO') {
                vencido += Number(p.monto_esperado) || 0;
            } else {
                pendiente += Number(p.monto_esperado) || 0;
            }
        });

        _set('m-esperado',  fmtMoney(esperado));
        _set('m-cobrado',   fmtMoney(cobrado));
        _set('m-pendiente', fmtMoney(pendiente));
        _set('m-vencido',   fmtMoney(vencido));
    }

    // ── Lista lateral de contratos (selector) ──────────────────────
    function _renderListaContratos() {
        const cont = document.getElementById('lista-contratos-pago');
        if (!cont) return;

        if (!_contratos.length) {
            cont.innerHTML = `
                <div class="p-6 text-center">
                    <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-2">
                        <i class="fa-solid fa-receipt text-slate-400"></i>
                    </div>
                    <p class="text-slate-500 text-xs">No hay contratos con calendario de pagos todavía.</p>
                </div>`;
            return;
        }

        cont.innerHTML = _contratos.map(c => {
            const pagos    = _pagosPorCont[c.contrato_id] || [];
            const total    = pagos.length;
            const pagados  = pagos.filter(p => p.estado === 'PAGADO').length;
            const vencidos = pagos.filter(p => p.estado === 'VENCIDO').length;
            const pct      = total ? Math.round((pagados / total) * 100) : 0;
            const activo   = c.contrato_id === _seleccionado;
            const inq      = c.inquilinos?.usuarios || {};
            const prop     = c.propiedades || {};
            const iniciales = (inq.nombre_completo || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

            return `
            <button type="button" data-contrato="${c.contrato_id}"
                    class="sel-contrato w-full text-left px-3.5 py-3 rounded-xl border transition
                           ${activo
                               ? 'bg-blue-50 border-blue-300 shadow-sm'
                               : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'}">
                <div class="flex items-center gap-2.5 mb-2">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[11px] flex-shrink-0
                                ${activo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-900 font-semibold text-xs truncate">${esc(inq.nombre_completo || 'Inquilino')}</p>
                        <p class="text-slate-400 text-[11px] truncate">${esc(prop.nombre || '')}</p>
                    </div>
                    ${vencidos ? `<span class="flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">${vencidos}</span>` : ''}
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'} rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                    <span class="text-[10px] font-semibold text-slate-500 flex-shrink-0">${pagados}/${total}</span>
                </div>
            </button>`;
        }).join('');

        cont.querySelectorAll('.sel-contrato').forEach(btn => {
            btn.addEventListener('click', () => {
                _seleccionado = parseInt(btn.getAttribute('data-contrato'), 10);
                _renderListaContratos();
                _renderCalendario();
            });
        });
    }

    // ── Panel principal: calendario del contrato seleccionado ──────
    function _renderCalendario() {
        const cont = document.getElementById('panel-calendario');
        if (!cont) return;

        const c = _contratos.find(x => x.contrato_id === _seleccionado);
        if (!c) {
            cont.innerHTML = `
                <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-hand-pointer text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Selecciona un contrato</p>
                    <p class="text-slate-400 text-sm">Elige un contrato de la lista para ver y registrar sus pagos.</p>
                </div>`;
            return;
        }

        const pagos   = _pagosPorCont[c.contrato_id] || [];
        const inq     = c.inquilinos?.usuarios || {};
        const prop    = c.propiedades || {};
        const total   = pagos.length;
        const pagados = pagos.filter(p => p.estado === 'PAGADO').length;
        const cobrado = pagos.reduce((s, p) => {
            if (p.estado !== 'PAGADO') return s;
            const reg = _registros[p.calendario_id];
            return s + (Number(reg?.monto_recibido ?? p.monto_esperado) || 0);
        }, 0);

        const filas = pagos.map(p => _renderFilaPago(p)).join('');

        cont.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden anim-fade-in-up">
            <!-- Cabecera del contrato -->
            <div class="px-5 py-4 bg-gradient-to-r from-[#0c1f4a] to-[#1a3680] text-white">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="font-bold text-base truncate">${esc(prop.nombre || 'Propiedad')}</p>
                        <p class="text-blue-200/80 text-xs truncate">
                            <i class="fa-solid fa-user mr-1"></i>${esc(inq.nombre_completo || 'Inquilino')}
                            <span class="mx-1.5 text-blue-300/40">•</span>
                            Folio #${String(c.contrato_id).padStart(6, '0')}
                        </p>
                    </div>
                    <a href="detalle-contrato.html?contratoId=${c.contrato_id}"
                       class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                              bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition">
                        <i class="fa-solid fa-up-right-from-square text-[10px]"></i> Detalle
                    </a>
                </div>
                <div class="grid grid-cols-3 gap-3 mt-4">
                    <div class="bg-white/10 rounded-xl px-3 py-2">
                        <p class="text-blue-200/70 text-[10px] uppercase font-semibold">Renta</p>
                        <p class="font-bold text-sm">${fmtMoney(c.monto_renta)}</p>
                    </div>
                    <div class="bg-white/10 rounded-xl px-3 py-2">
                        <p class="text-blue-200/70 text-[10px] uppercase font-semibold">Cumplim.</p>
                        <p class="font-bold text-sm">${pagados}/${total}</p>
                    </div>
                    <div class="bg-white/10 rounded-xl px-3 py-2">
                        <p class="text-blue-200/70 text-[10px] uppercase font-semibold">Cobrado</p>
                        <p class="font-bold text-sm text-green-300">${fmtMoney(cobrado)}</p>
                    </div>
                </div>
            </div>

            <!-- Tabla de periodos -->
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                            <th class="px-5 py-3 font-semibold">Periodo</th>
                            <th class="px-3 py-3 font-semibold">Vence</th>
                            <th class="px-3 py-3 font-semibold text-right">Monto</th>
                            <th class="px-3 py-3 font-semibold text-center">Estado</th>
                            <th class="px-5 py-3 font-semibold text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">
                        ${filas}
                    </tbody>
                </table>
            </div>
        </div>`;

        // Bind de acciones por fila
        cont.querySelectorAll('[data-registrar]').forEach(btn => {
            btn.addEventListener('click', () => {
                const calId = parseInt(btn.getAttribute('data-registrar'), 10);
                const pago  = pagos.find(p => p.calendario_id === calId);
                if (pago) _abrirModalRegistro(c, pago);
            });
        });
        cont.querySelectorAll('[data-revertir]').forEach(btn => {
            btn.addEventListener('click', () => {
                const calId = parseInt(btn.getAttribute('data-revertir'), 10);
                const pago  = pagos.find(p => p.calendario_id === calId);
                if (pago) _abrirModalRevertir(c, pago);
            });
        });
        cont.querySelectorAll('[data-confirmar]').forEach(btn => {
            btn.addEventListener('click', () => {
                const calId = parseInt(btn.getAttribute('data-confirmar'), 10);
                const pago  = pagos.find(p => p.calendario_id === calId);
                if (pago) _abrirModalConfirmarReporte(c, pago);
            });
        });
    }

    // ── Una fila de la tabla de pagos ──────────────────────────────
    function _renderFilaPago(p) {
        const venceHoy = p.fecha_limite === hoyStr();
        const cfg = {
            PAGADO:    { bg:'bg-green-50',  text:'text-green-700',  dot:'bg-green-500',   label:'Pagado'    },
            REPORTADO: { bg:'bg-indigo-50', text:'text-indigo-700', dot:'bg-indigo-500',  label:'Reportado' },
            VENCIDO:   { bg:'bg-red-50',    text:'text-red-700',    dot:'bg-red-500',     label:'Vencido'   },
            PENDIENTE: { bg:'bg-amber-50',  text:'text-amber-700',  dot:'bg-amber-500',   label:'Pendiente' },
        }[p.estado] || { bg:'bg-slate-50', text:'text-slate-600', dot:'bg-slate-400', label:p.estado };

        const reg = _registros[p.calendario_id];

        // Columna de acción según estado
        let accion;
        if (p.estado === 'PAGADO') {
            accion = `
                <div class="flex flex-col items-end gap-0.5">
                    <span class="text-green-700 text-xs font-semibold">
                        <i class="fa-solid fa-circle-check mr-1"></i>${fmtFecha(p.fecha_pagado)}
                    </span>
                    <button data-revertir="${p.calendario_id}"
                            class="text-slate-400 hover:text-red-600 text-[11px] font-medium transition">
                        Deshacer
                    </button>
                </div>`;
        } else if (p.estado === 'REPORTADO') {
            // El inquilino reportó el pago; el arrendador confirma o rechaza.
            accion = `
                <div class="flex flex-col items-end gap-1">
                    <button data-confirmar="${p.calendario_id}"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                   bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold
                                   shadow-sm shadow-indigo-600/25 transition">
                        <i class="fa-solid fa-check-double text-[11px]"></i> Confirmar recepción
                    </button>
                    <button data-revertir="${p.calendario_id}"
                            class="text-slate-400 hover:text-red-600 text-[11px] font-medium transition">
                        Rechazar reporte
                    </button>
                </div>`;
        } else {
            accion = `
                <button data-registrar="${p.calendario_id}"
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                               bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold
                               shadow-sm shadow-blue-600/25 transition">
                    <i class="fa-solid fa-money-bill-wave text-[11px]"></i> Registrar
                </button>`;
        }

        let montoRecibido = '';
        if (reg && reg.monto_recibido != null) {
            if (p.estado === 'REPORTADO') {
                montoRecibido = `<span class="block text-[10px] text-indigo-500">reportó ${fmtMoney(reg.monto_recibido)}</span>`;
            } else if (Number(reg.monto_recibido) !== Number(p.monto_esperado)) {
                montoRecibido = `<span class="block text-[10px] text-slate-400">recibido ${fmtMoney(reg.monto_recibido)}</span>`;
            }
        }

        return `
        <tr class="hover:bg-slate-50/60 transition">
            <td class="px-5 py-3">
                <p class="font-semibold text-slate-800">${MESES[p.mes] || p.mes} ${p.anio}</p>
            </td>
            <td class="px-3 py-3 text-slate-600 text-xs">
                ${fmtFecha(p.fecha_limite)}
                ${venceHoy && p.estado !== 'PAGADO' ? '<span class="block text-[10px] text-amber-600 font-semibold">vence hoy</span>' : ''}
            </td>
            <td class="px-3 py-3 text-right">
                <span class="font-semibold text-slate-800">${fmtMoney(p.monto_esperado)}</span>
                ${montoRecibido}
            </td>
            <td class="px-3 py-3 text-center">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text} text-[11px] font-bold">
                    <span class="w-1.5 h-1.5 rounded-full ${cfg.dot}"></span>${cfg.label}
                </span>
            </td>
            <td class="px-5 py-3 text-right">${accion}</td>
        </tr>`;
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: registrar recepción de un pago (RF-21/22)
    // ──────────────────────────────────────────────────────────────
    function _abrirModalRegistro(c, pago) {
        document.getElementById('modal-registro-pago')?.remove();

        const inqNombre = esc(c.inquilinos?.usuarios?.nombre_completo || 'el inquilino');
        const periodo   = `${MESES[pago.mes] || pago.mes} ${pago.anio}`;

        const html = `
        <div id="modal-registro-pago"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

                <div class="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-money-bill-wave text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-base leading-tight">Registrar pago recibido</p>
                            <p class="text-white/70 text-xs truncate">${esc(periodo)} · ${inqNombre}</p>
                        </div>
                    </div>
                </div>

                <div class="p-5">
                    <div id="pago-alert" class="hidden mb-3"></div>

                    <div class="bg-slate-50 rounded-xl p-3.5 mb-4 flex items-center justify-between">
                        <span class="text-slate-500 text-xs">Monto esperado del periodo</span>
                        <span class="text-slate-900 font-bold">${fmtMoney(pago.monto_esperado)}</span>
                    </div>

                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Fecha de recepción *</label>
                            <input id="pago-fecha" type="date" value="${esc(hoyStr())}" max="${esc(hoyStr())}"
                                   class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Monto recibido *</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                                <input id="pago-monto" type="number" min="0.01" step="0.01"
                                       value="${esc(String(pago.monto_esperado))}"
                                       class="input-brand w-full pl-7 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Notas (opcional)</label>
                            <textarea id="pago-notas" rows="2" maxlength="300"
                                      placeholder="Ej. Transferencia SPEI, efectivo, referencia…"
                                      class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                        </div>
                    </div>

                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-registro-pago').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition">
                            Cancelar
                        </button>
                        <button id="btn-confirm-pago" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md transition">
                            Confirmar pago
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirm-pago').addEventListener('click', async () => {
            const btn      = document.getElementById('btn-confirm-pago');
            const alertBox = document.getElementById('pago-alert');
            const fecha    = document.getElementById('pago-fecha').value;
            const monto    = parseFloat(document.getElementById('pago-monto').value);
            const notas    = document.getElementById('pago-notas').value.trim();

            if (!fecha) { _alertaModal(alertBox, 'Indica la fecha de recepción.'); return; }
            if (new Date(fecha) > new Date(hoyStr())) {
                _alertaModal(alertBox, 'La fecha de recepción no puede ser futura.'); return;
            }
            if (isNaN(monto) || monto <= 0) {
                _alertaModal(alertBox, 'El monto recibido debe ser mayor a cero.'); return;
            }

            AUTH.setLoading(btn, true);
            try {
                await _registrarPago(c, pago, fecha, monto, notas);
                document.getElementById('modal-registro-pago')?.remove();
                await _cargarDatos();
            } catch (err) {
                AUTH.setLoading(btn, false);
                _alertaModal(alertBox, err.message || 'No se pudo registrar el pago.');
                console.error('[PAGOS] Error al registrar pago:', err);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Registrar pago: INSERT en registros_pago + UPDATE calendario_pagos
    // ──────────────────────────────────────────────────────────────
    async function _registrarPago(c, pago, fecha, monto, notas) {
        // 1. Crear el registro de pago (RN-12: calendario_id es UNIQUE)
        const { error: errReg } = await window.supabaseClient
            .from('registros_pago')
            .insert({
                calendario_id:     pago.calendario_id,
                registrado_por_id: _usuario.usuario_id,
                fecha_recibido:    fecha,
                monto_recibido:    monto,
                notas:             notas || null
            });
        if (errReg) {
            if (errReg.code === '23505') {
                throw new Error('Este periodo ya tiene un pago registrado.');
            }
            throw new Error(errReg.message);
        }

        // 2. Marcar el periodo como PAGADO
        const { error: errCal } = await window.supabaseClient
            .from('calendario_pagos')
            .update({ estado: 'PAGADO', fecha_pagado: fecha })
            .eq('calendario_id', pago.calendario_id);
        if (errCal) throw new Error(errCal.message);

        // 3. Notificar al inquilino (confirmación de recepción)
        const inqUsuarioId = c.inquilinos?.usuarios?.usuario_id;
        if (inqUsuarioId) {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: inqUsuarioId,
                titulo:     'Pago registrado',
                mensaje:    `El arrendador registró tu pago de ${fmtMoney(monto)} correspondiente a ${MESES[pago.mes] || pago.mes} ${pago.anio}.`,
                tipo:       'RECORDATORIO',
                metadatos:  { contrato_id: c.contrato_id, calendario_id: pago.calendario_id }
            });
        }

        if (window.TOAST) TOAST.success('Pago registrado correctamente.');
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: confirmar la recepción de un pago REPORTADO por el inquilino
    //   El inquilino declaró el pago (estado REPORTADO); el arrendador
    //   valida los datos reportados y confirma → el periodo pasa a PAGADO.
    // ──────────────────────────────────────────────────────────────
    function _abrirModalConfirmarReporte(c, pago) {
        document.getElementById('modal-confirmar-reporte')?.remove();

        const periodo   = `${MESES[pago.mes] || pago.mes} ${pago.anio}`;
        const inqNombre = esc(c.inquilinos?.usuarios?.nombre_completo || 'El inquilino');
        const reg       = _registros[pago.calendario_id];

        // Datos reportados (si el inquilino dejó un registro) o valores por defecto
        const montoRep = reg?.monto_recibido != null ? Number(reg.monto_recibido) : Number(pago.monto_esperado);
        const fechaRep = reg?.fecha_recibido || pago.fecha_pagado || hoyStr();
        const notasRep = reg?.notas && reg.notas !== '-' ? reg.notas : '';

        const html = `
        <div id="modal-confirmar-reporte"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

                <div class="px-5 py-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-check-double text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-base leading-tight">Confirmar recepción</p>
                            <p class="text-white/70 text-xs truncate">${esc(periodo)} · ${inqNombre}</p>
                        </div>
                    </div>
                </div>

                <div class="p-5">
                    <div id="reporte-alert" class="hidden mb-3"></div>

                    <p class="text-slate-700 text-sm leading-relaxed mb-4">
                        ${inqNombre} reportó haber realizado este pago. Verifica que lo recibiste
                        y confírmalo para marcar el periodo como <strong>pagado</strong>.
                    </p>

                    <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3.5 space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-slate-500 text-xs">Monto reportado</span>
                            <span class="text-slate-900 font-bold">${fmtMoney(montoRep)}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-slate-500 text-xs">Fecha reportada</span>
                            <span class="text-slate-800 font-semibold text-xs">${fmtFecha(fechaRep)}</span>
                        </div>
                        ${notasRep ? `
                        <div class="pt-2 border-t border-indigo-100">
                            <span class="text-slate-500 text-xs block mb-0.5">Nota del inquilino</span>
                            <span class="text-slate-700 text-xs">${esc(notasRep)}</span>
                        </div>` : ''}
                    </div>

                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-confirmar-reporte').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition">
                            Cancelar
                        </button>
                        <button id="btn-confirm-reporte" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md transition">
                            Confirmar recepción
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirm-reporte').addEventListener('click', async () => {
            const btn      = document.getElementById('btn-confirm-reporte');
            const alertBox = document.getElementById('reporte-alert');
            AUTH.setLoading(btn, true);
            try {
                await _confirmarReporte(c, pago, montoRep, fechaRep);
                document.getElementById('modal-confirmar-reporte')?.remove();
                await _cargarDatos();
            } catch (err) {
                AUTH.setLoading(btn, false);
                _alertaModal(alertBox, err.message || 'No se pudo confirmar el pago.');
                console.error('[PAGOS] Error al confirmar reporte:', err);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Confirmar reporte: asegura el registro_pago + marca PAGADO
    // ──────────────────────────────────────────────────────────────
    async function _confirmarReporte(c, pago, monto, fecha) {
        // Si el inquilino aún no dejó un registro de pago, lo creamos ahora.
        if (!_registros[pago.calendario_id]) {
            const { error: errReg } = await window.supabaseClient
                .from('registros_pago')
                .insert({
                    calendario_id:     pago.calendario_id,
                    registrado_por_id: _usuario.usuario_id,
                    fecha_recibido:    fecha,
                    monto_recibido:    monto,
                    notas:             'Recepción confirmada por el arrendador'
                });
            // Si ya existía (carrera), ignoramos el conflicto de unicidad.
            if (errReg && errReg.code !== '23505') throw new Error(errReg.message);
        }

        // Marcar el periodo como PAGADO
        const { error: errCal } = await window.supabaseClient
            .from('calendario_pagos')
            .update({ estado: 'PAGADO', fecha_pagado: fecha })
            .eq('calendario_id', pago.calendario_id);
        if (errCal) throw new Error(errCal.message);

        // Notificar al inquilino que su pago fue confirmado
        const inqUsuarioId = c.inquilinos?.usuarios?.usuario_id;
        if (inqUsuarioId) {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: inqUsuarioId,
                titulo:     'Pago confirmado',
                mensaje:    `El arrendador confirmó la recepción de tu pago de ${fmtMoney(monto)} (${MESES[pago.mes] || pago.mes} ${pago.anio}).`,
                tipo:       'RECORDATORIO',
                metadatos:  { contrato_id: c.contrato_id, calendario_id: pago.calendario_id }
            });
        }

        if (window.TOAST) TOAST.success('Pago confirmado. El periodo quedó como pagado.');
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: deshacer un pago registrado
    // ──────────────────────────────────────────────────────────────
    function _abrirModalRevertir(c, pago) {
        document.getElementById('modal-revertir-pago')?.remove();
        const periodo   = `${MESES[pago.mes] || pago.mes} ${pago.anio}`;
        const esReporte = pago.estado === 'REPORTADO';

        const titulo = esReporte ? 'Rechazar reporte' : 'Deshacer pago';
        const texto  = esReporte
            ? `Se descartará el pago que el inquilino reportó para <strong>${esc(periodo)}</strong> y el periodo volverá a quedar pendiente. ¿Continuar?`
            : `Se eliminará el registro del pago de <strong>${esc(periodo)}</strong> y el periodo volverá a quedar como pendiente. ¿Continuar?`;
        const btnTxt = esReporte ? 'Sí, rechazar' : 'Sí, deshacer';

        const html = `
        <div id="modal-revertir-pago"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="p-5">
                    <div class="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-rotate-left text-red-500 text-lg"></i>
                    </div>
                    <p class="text-slate-900 font-bold text-base mb-1">${esc(titulo)}</p>
                    <p class="text-slate-500 text-sm leading-relaxed mb-4">${texto}</p>
                    <div class="flex gap-2">
                        <button type="button" onclick="document.getElementById('modal-revertir-pago').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold transition">
                            No, volver
                        </button>
                        <button id="btn-confirm-revertir" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-md transition">
                            ${esc(btnTxt)}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirm-revertir').addEventListener('click', async () => {
            const btn = document.getElementById('btn-confirm-revertir');
            AUTH.setLoading(btn, true);
            try {
                await _revertirPago(pago);
                document.getElementById('modal-revertir-pago')?.remove();
                await _cargarDatos();
            } catch (err) {
                AUTH.setLoading(btn, false);
                console.error('[PAGOS] Error al revertir pago:', err);
                if (window.TOAST) TOAST.error(err.message || 'No se pudo deshacer el pago.');
            }
        });
    }

    async function _revertirPago(pago) {
        // 1. Borrar el registro de pago
        const { error: errDel } = await window.supabaseClient
            .from('registros_pago')
            .delete()
            .eq('calendario_id', pago.calendario_id);
        if (errDel) throw new Error(errDel.message);

        // 2. Recalcular estado: VENCIDO si ya pasó su fecha límite, si no PENDIENTE
        const nuevoEstado = pago.fecha_limite < hoyStr() ? 'VENCIDO' : 'PENDIENTE';
        const { error: errCal } = await window.supabaseClient
            .from('calendario_pagos')
            .update({ estado: nuevoEstado, fecha_pagado: null })
            .eq('calendario_id', pago.calendario_id);
        if (errCal) throw new Error(errCal.message);

        if (window.TOAST) TOAST.info('Pago deshecho. El periodo quedó pendiente.');
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de UI
    // ──────────────────────────────────────────────────────────────
    function _set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value ?? '—');
    }

    function _alertaModal(box, msg) {
        if (!box) return;
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box.classList.add('hidden'), 4000);
    }

    function _renderError(msg) {
        const cont = document.getElementById('panel-calendario');
        if (!cont) return;
        cont.innerHTML = `
            <div class="bg-white rounded-2xl border border-red-100 shadow-sm p-10 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-triangle-exclamation text-red-500 text-xl"></i>
                </div>
                <p class="text-slate-700 font-semibold mb-1">Error</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    return { init };
})();

window.PAGOS = PAGOS;
