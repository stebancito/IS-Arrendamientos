// ================================================================
// pagos-inquilino.js  –  Módulo Dev 4 (Gestión de Pagos – Inquilino)
// ================================================================
// Responsabilidades:
//   - RF-20/21 : Visualizar calendario de pagos asignado al inquilino.
//   - RF-22    : Reportar un pago realizado (INSERT en registros_pago,
//                UPDATE en calendario_pagos → estado 'REPORTADO').
//   - RF-24    : Ver historial completo de todos los pagos.
//   - RN-11    : El calendario se genera al aceptar el contrato
//                (contratos-inquilino.js), aquí solo se consulta.
//   - RN-12    : No se puede reportar un pago que ya esté PAGADO o REPORTADO.
//
// Tabs:
//   1. Calendario → Grilla mensual con indicadores de pago por día.
//   2. Lista      → Tabla de cuotas del contrato seleccionado.
//   3. Historial  → Todos los pagos de todos los contratos.
//
// Al inicializar se llama a .rpc('actualizar_pagos_vencidos') para
// marcar automáticamente los pagos PENDIENTE cuya fecha_limite < hoy.
//
// Modales: Se inyectan dinámicamente con insertAdjacentHTML.
//
// Dependencias:
//   supabase-config.js · auth.js · layout.js · toast.js
//   utils/calendario-helper.js
// ================================================================

const PAGOS_INQUILINO = (() => {

    let _usuario = null;
    let _inquilinoId = null;
    let _contratos = [];          // contratos activos del inquilino
    let _contratoActual = null;   // contrato seleccionado en el selector
    let _pagos = [];              // pagos del contrato actual
    let _todosPagos = [];         // pagos de TODOS los contratos (para historial)
    let _tabActiva = 'calendario';
    let _calAnio = new Date().getFullYear();
    let _calMes = new Date().getMonth() + 1;

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // 1. Obtener inquilino_id
        const { data: inq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();

        if (!inq) {
            _renderMensaje('No tienes un perfil de inquilino registrado.');
            return;
        }
        _inquilinoId = inq.inquilino_id;

        // 2. Marcar pagos vencidos (función RPC en Supabase)
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[PAGOS-INQ] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        // 3. Cargar contratos activos del inquilino
        await _cargarContratos();

        // 4. Bind de tabs y controles
        _bindTabs();
        _bindSelectorContrato();
        _bindCalendarioNav();

        // 5. Render inicial
        _renderResumen();
        _renderBannerProximoPago();
        _renderTab();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar contratos y pagos
    // ──────────────────────────────────────────────────────────────
    async function _cargarContratos() {
        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, monto_renta, frecuencia_pago, estado,
                propiedades ( propiedad_id, nombre, direccion, tipo_propiedad )
            `)
            .eq('inquilino_id', _inquilinoId)
            .in('estado', ['ACTIVO', 'TERMINADO', 'FINALIZADO'])
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[PAGOS-INQ] Error cargando contratos:', error);
            return;
        }
        _contratos = data || [];

        // Poblar selector de contrato
        const sel = document.getElementById('selector-contrato');
        if (sel && _contratos.length) {
            sel.innerHTML = _contratos.map((c, i) => {
                const prop = c.propiedades?.nombre || 'Propiedad';
                const est = c.estado === 'ACTIVO' ? '● Activo' : c.estado;
                return `<option value="${c.contrato_id}" ${i === 0 ? 'selected' : ''}>
                    ${esc(prop)} — ${est}
                </option>`;
            }).join('');
        }

        // Seleccionar el primero por defecto (o el que venga en la URL)
        const params = new URLSearchParams(window.location.search);
        const contratoIdURL = params.get('contratoId');
        const tabURL = params.get('tab');

        if (contratoIdURL) {
            const found = _contratos.find(c => String(c.contrato_id) === contratoIdURL);
            if (found) {
                _contratoActual = found;
                if (sel) sel.value = contratoIdURL;
            }
        }
        if (!_contratoActual && _contratos.length) {
            _contratoActual = _contratos[0];
        }

        if (tabURL && ['calendario', 'lista', 'historial'].includes(tabURL)) {
            _tabActiva = tabURL;
            _pintarTabActiva();
        }

        // Cargar pagos del contrato actual
        await _cargarPagosContrato();
        // Cargar todos los pagos (para historial global)
        await _cargarTodosPagos();
    }

    async function _cargarPagosContrato() {
        if (!_contratoActual) { _pagos = []; return; }

        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select('*')
            .eq('contrato_id', _contratoActual.contrato_id)
            .order('fecha_limite', { ascending: true });

        if (error) {
            console.error('[PAGOS-INQ] Error cargando pagos:', error);
        }
        _pagos = data || [];
    }

    async function _cargarTodosPagos() {
        const ids = _contratos.map(c => c.contrato_id);
        if (!ids.length) { _todosPagos = []; return; }

        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                contratos (
                    contrato_id, monto_renta,
                    propiedades ( nombre, direccion )
                )
            `)
            .in('contrato_id', ids)
            .order('fecha_limite', { ascending: false });

        if (error) console.error('[PAGOS-INQ] Error cargando todos los pagos:', error);
        _todosPagos = data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Tabs
    // ──────────────────────────────────────────────────────────────
    function _bindTabs() {
        document.querySelectorAll('.tab-pagos').forEach(btn => {
            btn.addEventListener('click', () => {
                _tabActiva = btn.getAttribute('data-tab');
                _pintarTabActiva();
                _renderTab();
            });
        });
    }

    function _pintarTabActiva() {
        document.querySelectorAll('.tab-pagos').forEach(btn => {
            const activa = btn.getAttribute('data-tab') === _tabActiva;
            btn.className = 'tab-pagos flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-all ' +
                (activa ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700');
        });
    }

    function _renderTab() {
        switch (_tabActiva) {
            case 'calendario': _renderCalendario(); break;
            case 'lista':      _renderListaPagos(); break;
            case 'historial':  _renderHistorial();  break;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Selector de contrato
    // ──────────────────────────────────────────────────────────────
    function _bindSelectorContrato() {
        const sel = document.getElementById('selector-contrato');
        if (sel) {
            sel.addEventListener('change', async () => {
                const id = parseInt(sel.value, 10);
                _contratoActual = _contratos.find(c => c.contrato_id === id) || null;
                await _cargarPagosContrato();
                _renderResumen();
                _renderBannerProximoPago();
                _renderTab();
            });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Navegación del calendario (mes anterior / siguiente)
    // ──────────────────────────────────────────────────────────────
    function _bindCalendarioNav() {
        document.getElementById('cal-prev')?.addEventListener('click', () => {
            _calMes--;
            if (_calMes < 1) { _calMes = 12; _calAnio--; }
            _renderCalendario();
        });
        document.getElementById('cal-next')?.addEventListener('click', () => {
            _calMes++;
            if (_calMes > 12) { _calMes = 1; _calAnio++; }
            _renderCalendario();
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Banner de próximo pago (sticky)
    // ──────────────────────────────────────────────────────────────
    function _renderBannerProximoPago() {
        const cont = document.getElementById('banner-proximo');
        if (!cont) return;

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Buscar el próximo pago PENDIENTE o VENCIDO más cercano
        const proximo = _pagos.find(p =>
            (p.estado === 'PENDIENTE' || p.estado === 'VENCIDO') &&
            new Date(p.fecha_limite + 'T00:00:00') >= hoy
        ) || _pagos.find(p => p.estado === 'VENCIDO'); // si todos están vencidos, tomar el último

        if (!proximo) {
            cont.innerHTML = `
                <div class="flex items-center gap-3 p-4 rounded-2xl bg-green-50 border border-green-200">
                    <div class="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-circle-check text-green-600"></i>
                    </div>
                    <div>
                        <p class="text-green-800 font-bold text-sm">Sin pagos pendientes</p>
                        <p class="text-green-600 text-xs">Todos tus pagos están al día. ¡Excelente!</p>
                    </div>
                </div>`;
            return;
        }

        const H = CALENDARIO_HELPER;
        const esVencido = proximo.estado === 'VENCIDO';
        const fecha = new Date(proximo.fecha_limite + 'T00:00:00');
        const diasRest = Math.ceil((fecha - hoy) / 86400000);
        const urgencia = esVencido ? 'bg-red-50 border-red-200'
                       : diasRest <= 3 ? 'bg-orange-50 border-orange-200'
                       : 'bg-amber-50 border-amber-200';
        const iconColor = esVencido ? 'bg-red-100 text-red-600'
                        : diasRest <= 3 ? 'bg-orange-100 text-orange-600'
                        : 'bg-amber-100 text-amber-600';
        const txtColor  = esVencido ? 'text-red-800' : 'text-amber-800';
        const diasTxt   = esVencido ? `Vencido hace ${Math.abs(diasRest)} día(s)`
                        : diasRest === 0 ? 'Vence hoy'
                        : diasRest === 1 ? 'Vence mañana'
                        : `Vence en ${diasRest} días`;

        cont.innerHTML = `
            <div class="flex items-center gap-3 p-4 rounded-2xl ${urgencia} border">
                <div class="w-10 h-10 rounded-xl ${iconColor} flex items-center justify-center flex-shrink-0">
                    <i class="fa-solid ${esVencido ? 'fa-triangle-exclamation' : 'fa-clock'} text-lg"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="${txtColor} font-bold text-sm">Próximo pago: ${H.fmtMoney(proximo.monto_esperado)}</p>
                    <p class="${txtColor} text-xs opacity-80">${diasTxt} · Vencimiento: ${H.fmtFecha(proximo.fecha_limite)}</p>
                </div>
                ${(proximo.estado === 'PENDIENTE' || proximo.estado === 'VENCIDO') ? `
                    <button data-action="reportar-banner" data-id="${proximo.calendario_id}"
                            class="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition flex-shrink-0">
                        <i class="fa-solid fa-paper-plane mr-1"></i> Reportar pago
                    </button>` : ''}
            </div>`;

        // Bind del botón de reporte rápido
        cont.querySelector('[data-action="reportar-banner"]')?.addEventListener('click', () => {
            _abrirModalReportar(proximo);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Resumen lateral (totales)
    // ──────────────────────────────────────────────────────────────
    function _renderResumen() {
        const H = CALENDARIO_HELPER;
        const total     = _pagos.length;
        const pagados   = _pagos.filter(p => p.estado === 'PAGADO').length;
        const pendientes = _pagos.filter(p => p.estado === 'PENDIENTE').length;
        const vencidos  = _pagos.filter(p => p.estado === 'VENCIDO').length;
        const reportados = _pagos.filter(p => p.estado === 'REPORTADO').length;
        const cumpl     = total > 0 ? Math.round((pagados / total) * 100) : 0;

        const montoPendiente = _pagos
            .filter(p => p.estado === 'PENDIENTE' || p.estado === 'VENCIDO')
            .reduce((s, p) => s + (p.monto_esperado || 0), 0);

        _set('r-total', total);
        _set('r-pagados', pagados);
        _set('r-pendientes', pendientes);
        _set('r-vencidos', vencidos);
        _set('r-reportados', reportados);
        _set('r-cumplimiento', `${cumpl}%`);
        _set('r-deuda', H.fmtMoney(montoPendiente));
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 1: Calendario visual
    // ──────────────────────────────────────────────────────────────
    function _renderCalendario() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;

        const H = CALENDARIO_HELPER;
        const matriz = H.obtenerMatrizMes(_calAnio, _calMes);
        const pagosPorFecha = H.agruparPagosPorFecha(_pagos);
        const diasSemana = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

        let html = `
            <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <!-- Navegación de mes -->
                <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                    <button id="cal-prev" class="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
                        <i class="fa-solid fa-chevron-left text-sm"></i>
                    </button>
                    <h4 class="text-slate-800 font-bold text-sm">
                        ${H.nombreMes(_calMes)} ${_calAnio}
                    </h4>
                    <button id="cal-next" class="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
                        <i class="fa-solid fa-chevron-right text-sm"></i>
                    </button>
                </div>

                <!-- Días de la semana -->
                <div class="grid grid-cols-7 gap-0 bg-slate-50 border-b border-slate-100">
                    ${diasSemana.map(d => `
                        <div class="text-center py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">${d}</div>
                    `).join('')}
                </div>

                <!-- Grilla de días -->
                <div class="grid grid-cols-7 gap-0">
                    ${matriz.map(semana => semana.map(dia => {
                        const pagosDelDia = pagosPorFecha.get(dia.fecha) || [];
                        const tienePagos = pagosDelDia.length > 0;
                        const bgDia = !dia.esMesActual ? 'bg-slate-50/50'
                                    : dia.esHoy ? 'bg-blue-50'
                                    : '';
                        const txtDia = !dia.esMesActual ? 'text-slate-300'
                                     : dia.esHoy ? 'text-blue-700 font-bold'
                                     : 'text-slate-700';

                        // Renderizar los indicadores de pago (dots)
                        let dots = '';
                        if (tienePagos) {
                            dots = pagosDelDia.map(p => {
                                const c = H.colorPorEstado(p.estado);
                                return `<span class="w-1.5 h-1.5 rounded-full ${c.dot}" title="${c.label}: ${H.fmtMoney(p.monto_esperado)}"></span>`;
                            }).join('');
                        }

                        const clickable = tienePagos && dia.esMesActual
                            ? `cursor-pointer hover:bg-slate-100 transition-colors`
                            : '';
                        const dataAttr = tienePagos && dia.esMesActual
                            ? `data-fecha="${dia.fecha}"`
                            : '';

                        return `
                            <div class="relative min-h-[60px] sm:min-h-[72px] p-1.5 border-b border-r border-slate-100
                                        ${bgDia} ${clickable}" ${dataAttr}>
                                <span class="${txtDia} text-xs">${dia.dia}</span>
                                ${dia.esHoy ? '<span class="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-blue-500"></span>' : ''}
                                ${tienePagos ? `
                                    <div class="flex gap-0.5 mt-1 flex-wrap">${dots}</div>
                                    <p class="text-[9px] font-semibold mt-0.5 truncate ${H.colorPorEstado(pagosDelDia[0].estado).text}">
                                        ${H.fmtMoney(pagosDelDia[0].monto_esperado)}
                                    </p>` : ''}
                            </div>`;
                    }).join('')).join('')}
                </div>

                <!-- Leyenda -->
                <div class="flex flex-wrap gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50">
                    ${['PENDIENTE', 'REPORTADO', 'PAGADO', 'VENCIDO'].map(est => {
                        const c = H.colorPorEstado(est);
                        return `<span class="inline-flex items-center gap-1.5 text-[10px] ${c.text} font-medium">
                            <span class="w-2 h-2 rounded-full ${c.dot}"></span> ${c.label}
                        </span>`;
                    }).join('')}
                </div>
            </div>`;

        cont.innerHTML = html;

        // Re-bind navegación del calendario (se destruyó al reemplazar innerHTML)
        _bindCalendarioNav();

        // Bind: clic en un día con pagos → mostrar detalle/acción
        cont.querySelectorAll('[data-fecha]').forEach(celda => {
            celda.addEventListener('click', () => {
                const fecha = celda.getAttribute('data-fecha');
                const pagosDelDia = pagosPorFecha.get(fecha) || [];
                if (pagosDelDia.length === 1) {
                    _abrirDetallePago(pagosDelDia[0]);
                } else if (pagosDelDia.length > 1) {
                    // Si hay múltiples pagos en un día (quincenal/semanal), listar
                    _abrirDetallePago(pagosDelDia[0]);
                }
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 2: Lista de pagos del contrato
    // ──────────────────────────────────────────────────────────────
    function _renderListaPagos() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;
        const H = CALENDARIO_HELPER;

        if (!_pagos.length) {
            cont.innerHTML = _htmlVacio('No hay pagos registrados para este contrato.');
            return;
        }

        let html = `<div class="space-y-2">`;
        _pagos.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const periodo = H.formatearPeriodo(p);
            const puedeReportar = (p.estado === 'PENDIENTE' || p.estado === 'VENCIDO');

            html += `
                <div class="flex items-center gap-3 bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 hover:shadow-md transition-shadow">
                    <!-- Indicador de estado -->
                    <div class="w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid ${c.icon} ${c.text}"></i>
                    </div>

                    <!-- Info del pago -->
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <p class="text-slate-900 font-bold text-sm">${H.fmtMoney(p.monto_esperado)}</p>
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${c.bg} ${c.text} text-[9px] font-bold uppercase">
                                <span class="w-1 h-1 rounded-full ${c.dot}"></span> ${c.label}
                            </span>
                        </div>
                        <p class="text-slate-500 text-xs mt-0.5">${esc(periodo)}</p>
                        <p class="text-slate-400 text-[10px]">Vence: ${H.fmtFecha(p.fecha_limite)}</p>
                    </div>

                    <!-- Acción -->
                    ${puedeReportar ? `
                        <button data-action="reportar" data-id="${p.calendario_id}"
                                class="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold shadow-sm transition flex-shrink-0">
                            <i class="fa-solid fa-paper-plane mr-1"></i> Reportar
                        </button>` : ''}
                    ${p.estado === 'REPORTADO' ? `
                        <span class="px-3 py-2 rounded-xl bg-blue-50 text-blue-600 text-[11px] font-semibold flex-shrink-0">
                            <i class="fa-solid fa-hourglass-half mr-1"></i> En revisión
                        </span>` : ''}
                </div>`;
        });
        html += `</div>`;
        cont.innerHTML = html;

        // Bind acciones
        cont.querySelectorAll('[data-action="reportar"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const pago = _pagos.find(p => p.calendario_id === id);
                if (pago) _abrirModalReportar(pago);
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 3: Historial global (todos los contratos)
    // ──────────────────────────────────────────────────────────────
    function _renderHistorial() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;
        const H = CALENDARIO_HELPER;

        if (!_todosPagos.length) {
            cont.innerHTML = _htmlVacio('No hay pagos en tu historial aún.');
            return;
        }

        let html = `<div class="space-y-2">`;
        _todosPagos.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';
            const periodo = H.formatearPeriodo(p);

            html += `
                <div class="flex items-center gap-3 bg-white rounded-xl border border-slate-100 shadow-sm p-3.5">
                    <div class="w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid ${c.icon} ${c.text}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <p class="text-slate-900 font-bold text-sm">${H.fmtMoney(p.monto_esperado)}</p>
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${c.bg} ${c.text} text-[9px] font-bold uppercase">
                                <span class="w-1 h-1 rounded-full ${c.dot}"></span> ${c.label}
                            </span>
                        </div>
                        <p class="text-slate-500 text-xs truncate">${esc(propNombre)} · ${esc(periodo)}</p>
                        <p class="text-slate-400 text-[10px]">Vencimiento: ${H.fmtFecha(p.fecha_limite)}</p>
                    </div>
                </div>`;
        });
        html += `</div>`;
        cont.innerHTML = html;
    }

    // ──────────────────────────────────────────────────────────────
    // Detalle rápido de un pago (al tocar un día en el calendario)
    // ──────────────────────────────────────────────────────────────
    function _abrirDetallePago(pago) {
        const H = CALENDARIO_HELPER;
        const c = H.colorPorEstado(pago.estado);
        const puedeReportar = (pago.estado === 'PENDIENTE' || pago.estado === 'VENCIDO');

        document.getElementById('modal-detalle-pago')?.remove();

        const html = `
        <div id="modal-detalle-pago" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 ${c.bgSoft} ${c.border} border-b flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center">
                        <i class="fa-solid ${c.icon} ${c.text} text-lg"></i>
                    </div>
                    <div>
                        <p class="${c.text} font-bold text-sm">${c.label}</p>
                        <p class="text-slate-500 text-xs">${H.formatearPeriodo(pago)}</p>
                    </div>
                </div>
                <div class="p-5 space-y-3">
                    <div class="flex justify-between text-sm">
                        <span class="text-slate-500">Monto</span>
                        <span class="text-slate-900 font-bold">${H.fmtMoney(pago.monto_esperado)}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-slate-500">Vencimiento</span>
                        <span class="text-slate-800 font-semibold">${H.fmtFecha(pago.fecha_limite)}</span>
                    </div>
                    ${pago.fecha_pagado ? `
                    <div class="flex justify-between text-sm">
                        <span class="text-slate-500">Fecha de pago</span>
                        <span class="text-green-700 font-semibold">${H.fmtFecha(pago.fecha_pagado)}</span>
                    </div>` : ''}

                    <div class="flex gap-2 pt-3 border-t border-slate-100">
                        <button onclick="document.getElementById('modal-detalle-pago').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cerrar
                        </button>
                        ${puedeReportar ? `
                        <button id="btn-reportar-desde-detalle" data-id="${pago.calendario_id}"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md">
                            <i class="fa-solid fa-paper-plane mr-1"></i> Reportar pago
                        </button>` : ''}
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-reportar-desde-detalle')?.addEventListener('click', () => {
            document.getElementById('modal-detalle-pago')?.remove();
            _abrirModalReportar(pago);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: Reportar un pago
    //   Inyecta dinámicamente el formulario de reporte.
    //   El inquilino indica: fecha en que pagó, método, referencia y notas.
    //   Al confirmar:
    //     1. INSERT en registros_pago (con validado = false)
    //     2. UPDATE en calendario_pagos (estado → 'REPORTADO', reportado_en)
    //   Ambas operaciones en un try/catch estricto.
    // ──────────────────────────────────────────────────────────────
    function _abrirModalReportar(pago) {
        // RN-12: No reportar pagos ya pagados o reportados
        if (pago.estado === 'PAGADO' || pago.estado === 'REPORTADO') {
            if (window.TOAST) TOAST.info('Este pago ya fue ' + (pago.estado === 'PAGADO' ? 'validado' : 'reportado') + '.');
            return;
        }

        const H = CALENDARIO_HELPER;
        document.getElementById('modal-reportar-pago')?.remove();

        const hoy = new Date().toISOString().slice(0, 10);

        const html = `
        <div id="modal-reportar-pago" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <!-- Cabecera -->
                <div class="px-5 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-paper-plane text-lg"></i>
                        </div>
                        <div>
                            <p class="font-bold text-base leading-tight">Reportar pago realizado</p>
                            <p class="text-white/70 text-xs">${H.formatearPeriodo(pago)} · ${H.fmtMoney(pago.monto_esperado)}</p>
                        </div>
                    </div>
                </div>

                <div class="p-5">
                    <div id="reportar-alert" class="hidden mb-3"></div>

                    <p class="text-slate-600 text-sm mb-4">
                        Indica los datos de tu pago. El arrendador validará la información.
                    </p>

                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Fecha en que pagaste *</label>
                            <input id="rp-fecha" type="date" value="${hoy}" max="${hoy}"
                                   class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Monto pagado *</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                                <input id="rp-monto" type="number" min="1" step="0.01"
                                       value="${pago.monto_esperado}"
                                       class="input-brand w-full pl-7 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Método de pago *</label>
                            <select id="rp-metodo"
                                    class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                                <option value="TRANSFERENCIA">Transferencia bancaria</option>
                                <option value="EFECTIVO">Efectivo</option>
                                <option value="DEPOSITO">Depósito bancario</option>
                                <option value="TARJETA">Tarjeta de débito/crédito</option>
                                <option value="OTRO">Otro</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Referencia o número de operación</label>
                            <input id="rp-referencia" type="text" maxlength="100"
                                   placeholder="Ej. 1234567890"
                                   class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Notas (opcional)</label>
                            <textarea id="rp-notas" rows="2" maxlength="300"
                                      placeholder="Algún comentario adicional…"
                                      class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                        </div>
                    </div>

                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-reportar-pago').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cancelar
                        </button>
                        <button id="btn-confirmar-reporte" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md">
                            <i class="fa-solid fa-paper-plane mr-1"></i> Enviar reporte
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        // Bind botón de confirmación
        document.getElementById('btn-confirmar-reporte').addEventListener('click', async () => {
            await _reportarPago(pago);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // _reportarPago()
    // Transacción:
    //   1. INSERT en registros_pago (el reporte del inquilino)
    //   2. UPDATE en calendario_pagos (estado → 'REPORTADO')
    // Si alguno falla, se deshace el INSERT (compensación manual).
    // ──────────────────────────────────────────────────────────────
    async function _reportarPago(pago) {
        const btn     = document.getElementById('btn-confirmar-reporte');
        const alertEl = document.getElementById('reportar-alert');

        const fecha     = document.getElementById('rp-fecha')?.value;
        const monto     = parseFloat(document.getElementById('rp-monto')?.value);
        const metodo    = document.getElementById('rp-metodo')?.value;
        const referencia = document.getElementById('rp-referencia')?.value.trim();
        const notas     = document.getElementById('rp-notas')?.value.trim();

        // Validaciones
        if (!fecha) { _alertaModal(alertEl, 'Indica la fecha de pago.'); return; }
        if (isNaN(monto) || monto <= 0) { _alertaModal(alertEl, 'El monto debe ser mayor a cero.'); return; }
        if (!metodo) { _alertaModal(alertEl, 'Selecciona un método de pago.'); return; }

        AUTH.setLoading(btn, true);

        try {
            // ── 1. INSERT en registros_pago ──
            // Registra el reporte del inquilino. validado = false hasta
            // que el arrendador lo apruebe.
            const { data: registro, error: errInsert } = await window.supabaseClient
                .from('registros_pago')
                .insert({
                    calendario_id:     pago.calendario_id,
                    registrado_por_id: _usuario.usuario_id,
                    fecha_recibido:    fecha,
                    monto_recibido:    monto,
                    metodo_pago:       metodo,
                    referencia:        referencia || null,
                    notas:             notas || null,
                    validado:          false,
                })
                .select('pago_id')
                .single();

            if (errInsert) {
                // Si el error es de unicidad (ya existe un reporte para este calendario_id)
                if (errInsert.code === '23505') {
                    throw new Error('Ya existe un reporte para esta cuota. Si fue rechazado, espera a que el arrendador lo procese.');
                }
                throw errInsert;
            }

            // ── 2. UPDATE en calendario_pagos ──
            // Cambiar estado a 'REPORTADO' y registrar la fecha de reporte.
            const { error: errUpdate } = await window.supabaseClient
                .from('calendario_pagos')
                .update({
                    estado:       'REPORTADO',
                    reportado_en: new Date().toISOString(),
                })
                .eq('calendario_id', pago.calendario_id);

            if (errUpdate) {
                // Compensación: borrar el registro_pago que acabamos de insertar
                console.error('[PAGOS-INQ] Falló UPDATE de calendario, compensando INSERT:', errUpdate);
                await window.supabaseClient
                    .from('registros_pago')
                    .delete()
                    .eq('pago_id', registro.pago_id);
                throw new Error('No se pudo actualizar el estado del pago: ' + errUpdate.message);
            }

            // ── 3. Notificación al arrendador ──
            if (_contratoActual?.propiedades) {
                const { data: propData } = await window.supabaseClient
                    .from('propiedades')
                    .select('duenio_id')
                    .eq('propiedad_id', _contratoActual.propiedades.propiedad_id)
                    .maybeSingle();

                if (propData?.duenio_id) {
                    await window.supabaseClient.from('notificaciones').insert({
                        usuario_id: propData.duenio_id,
                        titulo: 'Pago reportado por inquilino',
                        mensaje: `${_usuario.nombre_completo} reportó un pago de ${CALENDARIO_HELPER.fmtMoney(monto)} para "${_contratoActual.propiedades.nombre}". Valídalo en la sección de pagos.`,
                        tipo: 'PAGO_PROXIMO',
                        metadatos: { calendario_id: pago.calendario_id, pago_id: registro.pago_id },
                    });
                }
            }

            // ── Éxito ──
            document.getElementById('modal-reportar-pago')?.remove();
            if (window.TOAST) TOAST.success('Pago reportado. El arrendador lo validará pronto.');

            // Refrescar datos
            await _cargarPagosContrato();
            await _cargarTodosPagos();
            _renderResumen();
            _renderBannerProximoPago();
            _renderTab();

        } catch (err) {
            console.error('[PAGOS-INQ] Error al reportar pago:', err);
            AUTH.setLoading(btn, false);
            _alertaModal(alertEl, err.message || 'No se pudo reportar el pago. Intenta de nuevo.');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers UI
    // ──────────────────────────────────────────────────────────────
    function _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
    }

    function _alertaModal(box, msg) {
        if (!box) return;
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box?.classList.add('hidden'), 4500);
    }

    function _htmlVacio(msg) {
        return `
            <div class="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                    <i class="fa-solid fa-receipt text-blue-500 text-xl"></i>
                </div>
                <p class="text-slate-700 font-semibold mb-1">Sin resultados</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    function _renderMensaje(msg) {
        const cont = document.getElementById('tab-content');
        if (cont) cont.innerHTML = _htmlVacio(msg);
    }

    return { init };
})();

window.PAGOS_INQUILINO = PAGOS_INQUILINO;