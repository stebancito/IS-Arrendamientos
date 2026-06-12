// ================================================================
// pagos-arrendador.js  –  Módulo Dev 4 (Gestión de Pagos – Arrendador)
// ================================================================
// Responsabilidades:
//   - RF-23    : Validar pagos reportados por inquilinos (aprobar/rechazar).
//   - RF-25    : Registrar pagos manuales (efectivo, fuera de plataforma).
//   - RF-26    : Ver historial completo de pagos de todas las propiedades.
//   - RN-12    : No aprobar un pago que no esté en estado 'REPORTADO'.
//   - RN-13    : Al rechazar, el estado vuelve a PENDIENTE y se elimina
//                el registro de registros_pago (para que el inquilino pueda
//                reportar de nuevo).
//
// Tabs:
//   1. Por Validar   → Pagos REPORTADO esperando aprobación.
//   2. Registrar     → Registro manual de pagos (efectivo, etc).
//   3. Historial     → Todos los pagos de todas las propiedades.
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

const PAGOS_ARRENDADOR = (() => {

    let _usuario = null;
    let _propiedadesIds = [];
    let _todosPagos = [];
    let _tabActiva = 'validar';

    // Paginación para historial
    let _histPage = 1;
    const _HIST_LIMIT = 20;

    async function init(usuario) {
        _usuario = usuario;

        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[PAGOS-ARR] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id')
            .eq('duenio_id', usuario.usuario_id);

        _propiedadesIds = (props || []).map(p => p.propiedad_id);

        if (!_propiedadesIds.length) {
            _renderMensaje('No tienes propiedades registradas.', 'fa-house-circle-xmark');
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const tabURL = params.get('tab');
        if (tabURL && ['validar', 'registrar', 'historial'].includes(tabURL)) {
            _tabActiva = tabURL;
        }

        _bindTabs();
        _bindFiltros();
        await _cargarPagos();
    }

    async function _cargarPagos() {
        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id')
            .in('propiedad_id', _propiedadesIds);

        const cIds = (contratos || []).map(c => c.contrato_id);

        if (!cIds.length) {
            _todosPagos = [];
            _renderMetricas();
            _renderTab();
            return;
        }

        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                contratos (
                    contrato_id, monto_renta,
                    propiedades ( nombre, direccion ),
                    inquilinos ( usuarios ( usuario_id, nombre_completo, correo, telefono ) )
                ),
                registros_pago (
                    pago_id, fecha_recibido, monto_recibido, metodo_pago, referencia, notas, validado, registrado_por_id
                )
            `)
            .in('contrato_id', cIds)
            .order('fecha_limite', { ascending: false });

        if (error) {
            console.error('[PAGOS-ARR] Error cargando pagos:', error);
            _todosPagos = [];
        } else {
            _todosPagos = data || [];
        }

        _renderMetricas();
        _pintarTabActiva();
        _renderTab();
    }

    function _bindTabs() {
        document.querySelectorAll('.tab-pagos-arr').forEach(btn => {
            btn.addEventListener('click', () => {
                _tabActiva = btn.getAttribute('data-tab');
                _pintarTabActiva();
                _renderTab();
            });
        });
    }

    function _pintarTabActiva() {
        document.querySelectorAll('.tab-pagos-arr').forEach(btn => {
            const activa = btn.getAttribute('data-tab') === _tabActiva;
            btn.className = 'tab-pagos-arr flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all ' +
                (activa ? 'bg-[#FFC533] text-[#13243E] shadow-sm' : 'text-[#6F88A1] hover:bg-slate-200/60 hover:text-[#13243E]');
        });
    }

    function _renderTab() {
        switch (_tabActiva) {
            case 'validar':   _renderListaValidar(); break;
            case 'registrar': _renderListaRegistrar(); break;
            case 'historial': _renderHistorial(); break;
        }
    }

    function _renderMetricas() {
        const reportados = _todosPagos.filter(p => p.estado === 'REPORTADO').length;
        const pagados    = _todosPagos.filter(p => p.estado === 'PAGADO').length;
        const vencidos   = _todosPagos.filter(p => p.estado === 'VENCIDO').length;
        const pendientes = _todosPagos.filter(p => p.estado === 'PENDIENTE').length;

        _set('m-reportados', reportados);
        _set('m-pagados', pagados);
        _set('m-vencidos', vencidos);
        _set('m-pendientes', pendientes);
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 1: POR VALIDAR (Pagos REPORTADO)
    // ──────────────────────────────────────────────────────────────
    function _renderListaValidar() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;

        const reportados = _todosPagos.filter(p => p.estado === 'REPORTADO');

        if (!reportados.length) {
            cont.innerHTML = _htmlVacio('No tienes pagos pendientes de validación en este momento.', 'fa-inbox');
            return;
        }

        const H = CALENDARIO_HELPER;
        let html = `<div class="space-y-3">`;

        reportados.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const inqNombre = p.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';
            const periodo = H.formatearPeriodo(p);
            const reg = p.registros_pago?.[0]; // Último reporte
            const metodo = reg ? reg.metodo_pago : 'N/D';

            html += `
                <div class="flex flex-col sm:flex-row sm:items-center gap-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md hover:border-[#FFE788] transition-all duration-200">
                    <div class="w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 border ${c.border}">
                        <i class="fa-solid ${c.icon} ${c.text} text-xl"></i>
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <p class="text-[#13243E] font-extrabold text-base">${H.fmtMoney(p.monto_esperado)}</p>
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md ${c.bg} border ${c.border} ${c.text} text-[9px] font-bold uppercase tracking-wider">
                                <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span> ${c.label}
                            </span>
                        </div>
                        <p class="text-[#6F88A1] font-bold text-xs truncate">${esc(inqNombre)} · <span class="text-[#255FA4]">${esc(propNombre)}</span></p>
                        <p class="text-slate-400 text-[10px] mt-1 font-medium"><i class="fa-solid fa-wallet mr-1"></i> Vía: ${esc(metodo)} · Periodo: ${esc(periodo)}</p>
                    </div>

                    <button data-action="abrir-validar" data-id="${p.calendario_id}"
                            class="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] text-xs font-extrabold shadow-sm shadow-[#FFC533]/30 transition-colors flex items-center justify-center flex-shrink-0">
                        Revisar y Validar <i class="fa-solid fa-arrow-right ml-2 text-[10px]"></i>
                    </button>
                </div>`;
        });
        html += `</div>`;
        cont.innerHTML = html;

        cont.querySelectorAll('[data-action="abrir-validar"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const pago = _todosPagos.find(p => p.calendario_id === id);
                if (pago) _abrirModalValidar(pago);
            });
        });
    }

    function _abrirModalValidar(pago) {
        if (pago.estado !== 'REPORTADO') return;

        const reg = pago.registros_pago?.[0];
        if (!reg) {
            if (window.TOAST) TOAST.error('No se encontró el reporte de pago en la base de datos.');
            return;
        }

        document.getElementById('modal-validar-pago')?.remove();
        const H = CALENDARIO_HELPER;
        const inqNombre = pago.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
        const propNombre = pago.contratos?.propiedades?.nombre || 'Propiedad';
        const iniciales = inqNombre.substring(0,2).toUpperCase();

        const html = `
        <div id="modal-validar-pago" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#13243E]/60 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

                <div class="px-6 py-5 bg-[#13243E] text-white relative">
                    <div class="absolute -right-6 -top-6 w-24 h-24 bg-[#FFC533]/15 rounded-full blur-2xl pointer-events-none"></div>
                    <div class="flex items-center gap-4 relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-[#FFC533] text-[#13243E] flex items-center justify-center text-xl shadow-md border border-[#FFE788]">
                            <i class="fa-solid fa-clipboard-check"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-extrabold text-base leading-tight">Validar pago reportado</p>
                            <p class="text-[#6F88A1] font-semibold text-xs mt-0.5 truncate">${esc(propNombre)}</p>
                        </div>
                        <button onclick="document.getElementById('modal-validar-pago').remove()" class="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <div class="p-6 bg-[#F5F7F9]">
                    <div id="validar-alert" class="hidden mb-4"></div>

                    <div class="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm mb-5">
                        <div class="w-10 h-10 rounded-xl bg-[#FFC533]/20 text-[#13243E] flex items-center justify-center font-extrabold text-sm flex-shrink-0 border border-[#FFE788]">
                            ${esc(iniciales)}
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[#13243E] font-extrabold text-sm truncate">${esc(inqNombre)}</p>
                            <p class="text-[#6F88A1] text-[11px] font-bold uppercase tracking-wider truncate">${H.formatearPeriodo(pago)}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3 mb-5">
                        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                            <p class="text-[#6F88A1] text-[10px] uppercase font-bold tracking-widest mb-1.5">Monto reportado</p>
                            <p class="text-[#255FA4] font-extrabold text-xl">${H.fmtMoney(reg.monto_recibido)}</p>
                        </div>
                        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-center">
                            <p class="text-[#6F88A1] text-[10px] uppercase font-bold tracking-widest mb-1.5">Fecha reportada</p>
                            <p class="text-[#13243E] font-extrabold text-sm mt-1">${H.fmtFecha(reg.fecha_recibido)}</p>
                        </div>
                        <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm col-span-2">
                            <p class="text-[#6F88A1] text-[10px] uppercase font-bold tracking-widest mb-1.5">Detalles del método</p>
                            <p class="text-[#13243E] font-bold text-sm"><i class="fa-solid fa-wallet mr-1 text-[#255FA4]"></i> ${esc(reg.metodo_pago)}</p>
                            ${reg.referencia ? `<p class="text-[#6F88A1] text-xs mt-1.5"><span class="font-bold">Ref:</span> ${esc(reg.referencia)}</p>` : ''}
                        </div>
                        ${reg.notas ? `
                        <div class="bg-[#FFFBEB] p-4 rounded-xl border border-[#FFE788] col-span-2 shadow-sm">
                            <p class="text-[#13243E]/70 text-[10px] uppercase font-bold tracking-widest mb-1.5"><i class="fa-solid fa-comment-dots text-[#FFC533] mr-1"></i> Notas del inquilino</p>
                            <p class="text-[#13243E] text-xs font-medium italic">"${esc(reg.notas)}"</p>
                        </div>` : ''}
                    </div>

                    <div class="flex gap-3 pt-5 border-t border-slate-200">
                        <button id="btn-rechazar-pago" class="flex-1 px-4 py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 text-sm font-extrabold transition-colors">
                            <i class="fa-solid fa-ban mr-1"></i> Rechazar
                        </button>
                        <button id="btn-aprobar-pago" class="flex-1 px-4 py-3 rounded-xl bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] text-sm font-extrabold shadow-sm shadow-[#FFC533]/30 transition-colors">
                            <i class="fa-solid fa-check-double mr-1"></i> Aprobar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-aprobar-pago').addEventListener('click', () => _procesarValidacion(pago, true));
        document.getElementById('btn-rechazar-pago').addEventListener('click', () => _procesarValidacion(pago, false));
    }

    async function _procesarValidacion(pago, aprobado) {
        const btnAprobar = document.getElementById('btn-aprobar-pago');
        const btnRechazar = document.getElementById('btn-rechazar-pago');
        const alertBox = document.getElementById('validar-alert');
        const reg = pago.registros_pago?.[0];

        AUTH.setLoading(aprobado ? btnAprobar : btnRechazar, true);
        if (aprobado) btnRechazar.disabled = true; else btnAprobar.disabled = true;

        try {
            // RN-12 y RN-13 implementadas
            if (aprobado) {
                const { error: e1 } = await window.supabaseClient
                    .from('calendario_pagos')
                    .update({ estado: 'PAGADO', fecha_pagado: reg.fecha_recibido })
                    .eq('calendario_id', pago.calendario_id);
                if (e1) throw e1;

                const { error: e2 } = await window.supabaseClient
                    .from('registros_pago')
                    .update({ validado: true })
                    .eq('pago_id', reg.pago_id);
                if (e2) throw e2;

                _enviarNotificacion(pago, 'Pago aprobado', 'Tu arrendador ha validado tu pago. ¡Gracias!', 'PAGO_PROXIMO');

            } else {
                // Rechazado: Vuelve a PENDIENTE y se elimina el registro
                // NOTA: Para no perder el registro del rechazo, podríamos mantenerlo con validado=false
                // pero la RN-13 dice que el inquilino pueda reportar de nuevo. Si hay constraint UNIQUE
                // (calendario_id), es mejor borrarlo o hacer un soft delete. Lo borramos para liberar la cuota.
                const { error: e1 } = await window.supabaseClient
                    .from('calendario_pagos')
                    .update({ estado: 'PENDIENTE', reportado_en: null })
                    .eq('calendario_id', pago.calendario_id);
                if (e1) throw e1;

                const { error: e2 } = await window.supabaseClient
                    .from('registros_pago')
                    .delete()
                    .eq('pago_id', reg.pago_id);
                if (e2) throw e2;

                _enviarNotificacion(pago, 'Pago rechazado', 'Tu arrendador ha rechazado el comprobante. Por favor vuelve a reportarlo.', 'PAGO_VENCIDO');
            }

            document.getElementById('modal-validar-pago')?.remove();
            if (window.TOAST) TOAST.success(aprobado ? 'Pago aprobado con éxito.' : 'Pago rechazado. El inquilino deberá reportarlo nuevamente.');
            await _cargarPagos();

        } catch (err) {
            console.error('[PAGOS-ARR] Error validando:', err);
            _alertaModal(alertBox, 'Ocurrió un error. Intenta de nuevo.');
            AUTH.setLoading(aprobado ? btnAprobar : btnRechazar, false);
            if (aprobado) btnRechazar.disabled = false; else btnAprobar.disabled = false;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 2: REGISTRAR MANUAL (Pagos PENDIENTE/VENCIDO)
    // ──────────────────────────────────────────────────────────────
    function _renderListaRegistrar() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;

        const manuales = _todosPagos.filter(p => p.estado === 'PENDIENTE' || p.estado === 'VENCIDO');

        if (!manuales.length) {
            cont.innerHTML = _htmlVacio('No hay cuotas pendientes ni vencidas para registrar pagos manuales.', 'fa-hand-holding-dollar');
            return;
        }

        const H = CALENDARIO_HELPER;
        let html = `<div class="space-y-3">`;

        manuales.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const inqNombre = p.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';

            html += `
                <div class="flex flex-col sm:flex-row sm:items-center gap-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md hover:border-slate-200 transition-all duration-200">
                    <div class="w-12 h-12 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 border ${c.border}">
                        <i class="fa-solid ${c.icon} ${c.text} text-xl"></i>
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <p class="text-[#13243E] font-extrabold text-base">${H.fmtMoney(p.monto_esperado)}</p>
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md ${c.bg} border ${c.border} ${c.text} text-[9px] font-bold uppercase tracking-wider">
                                <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span> ${c.label}
                            </span>
                        </div>
                        <p class="text-[#13243E] font-bold text-xs truncate">${esc(inqNombre)} · <span class="text-[#6F88A1] font-medium">${esc(propNombre)}</span></p>
                        <p class="text-[#6F88A1] text-[10px] mt-1 font-semibold uppercase tracking-wider">Período: ${esc(H.formatearPeriodo(p))}</p>
                    </div>

                    <button data-action="abrir-registrar" data-id="${p.calendario_id}"
                            class="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#13243E] hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid fa-plus mr-1.5 text-[#FFC533]"></i> Registrar
                    </button>
                </div>`;
        });
        html += `</div>`;
        cont.innerHTML = html;

        cont.querySelectorAll('[data-action="abrir-registrar"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.getAttribute('data-id'), 10);
                const pago = _todosPagos.find(p => p.calendario_id === id);
                if (pago) _abrirModalRegistrar(pago);
            });
        });
    }

    function _abrirModalRegistrar(pago) {
        if (pago.estado !== 'PENDIENTE' && pago.estado !== 'VENCIDO') return;

        const H = CALENDARIO_HELPER;
        const inqNombre = pago.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
        const hoy = new Date().toISOString().slice(0, 10);

        document.getElementById('modal-registrar-pago')?.remove();

        const html = `
        <div id="modal-registrar-pago" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#13243E]/60 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

                <div class="px-6 py-5 bg-[#13243E] text-white relative">
                    <div class="absolute -right-6 -top-6 w-24 h-24 bg-[#FFC533]/15 rounded-full blur-2xl pointer-events-none"></div>
                    <div class="flex items-center gap-4 relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-[#FFC533] text-[#13243E] flex items-center justify-center text-xl shadow-md border border-[#FFE788]">
                            <i class="fa-solid fa-hand-holding-dollar"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-extrabold text-base leading-tight">Registrar pago manual</p>
                            <p class="text-[#6F88A1] font-semibold text-[11px] uppercase tracking-wider mt-1 truncate">${H.formatearPeriodo(pago)}</p>
                        </div>
                        <button onclick="document.getElementById('modal-registrar-pago').remove()" class="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <div class="p-6 bg-[#F5F7F9]">
                    <div id="registrar-alert" class="hidden mb-4"></div>

                    <div class="mb-5 p-4 bg-white rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-[#6F88A1] text-[10px] uppercase font-bold tracking-widest mb-1">Inquilino</p>
                            <p class="text-[#13243E] font-extrabold text-sm truncate max-w-[180px]">${esc(inqNombre)}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-[#6F88A1] text-[10px] uppercase font-bold tracking-widest mb-1">Monto esperado</p>
                            <p class="text-[#255FA4] font-extrabold text-base">${H.fmtMoney(pago.monto_esperado)}</p>
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-[10px] font-bold text-[#6F88A1] uppercase tracking-wider mb-1.5">Monto recibido *</label>
                            <div class="relative">
                                <span class="absolute left-4 top-1/2 -translate-y-1/2 text-[#6F88A1] font-bold text-sm">$</span>
                                <input id="rm-monto" type="number" min="1" step="0.01" value="${pago.monto_esperado}"
                                       class="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 bg-white focus:bg-white focus:border-[#FFC533] focus:ring-2 focus:ring-[#FFC533]/20 text-sm text-[#13243E] font-extrabold outline-none transition-all shadow-sm" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-[#6F88A1] uppercase tracking-wider mb-1.5">Fecha de recepción *</label>
                                <input id="rm-fecha" type="date" value="${hoy}" max="${hoy}"
                                       class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:bg-white focus:border-[#FFC533] focus:ring-2 focus:ring-[#FFC533]/20 text-sm text-[#13243E] font-bold outline-none transition-all shadow-sm" />
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-[#6F88A1] uppercase tracking-wider mb-1.5">Método *</label>
                                <select id="rm-metodo" class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:bg-white focus:border-[#FFC533] focus:ring-2 focus:ring-[#FFC533]/20 text-sm text-[#13243E] font-bold outline-none transition-all shadow-sm">
                                    <option value="EFECTIVO">Efectivo</option>
                                    <option value="TRANSFERENCIA">Transferencia</option>
                                    <option value="DEPOSITO">Depósito</option>
                                    <option value="OTRO">Otro</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-[#6F88A1] uppercase tracking-wider mb-1.5">Notas / Referencia (opcional)</label>
                            <textarea id="rm-notas" rows="2" maxlength="200" placeholder="Añade algún comentario..."
                                      class="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white focus:bg-white focus:border-[#FFC533] focus:ring-2 focus:ring-[#FFC533]/20 text-sm text-[#13243E] font-medium outline-none transition-all resize-none shadow-sm"></textarea>
                        </div>
                    </div>

                    <div class="flex gap-3 mt-6 pt-5 border-t border-slate-200">
                        <button type="button" onclick="document.getElementById('modal-registrar-pago').remove()"
                                class="flex-1 px-4 py-3 rounded-xl bg-white text-[#13243E] border border-slate-200 hover:bg-slate-50 text-sm font-bold transition-colors">
                            Cancelar
                        </button>
                        <button id="btn-guardar-manual" type="button"
                                class="flex-1 px-4 py-3 rounded-xl bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] text-sm font-extrabold shadow-sm shadow-[#FFC533]/30 transition-colors">
                            <i class="fa-solid fa-save mr-1"></i> Registrar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-guardar-manual').addEventListener('click', async () => {
            const btn = document.getElementById('btn-guardar-manual');
            const alertBox = document.getElementById('registrar-alert');

            const monto = parseFloat(document.getElementById('rm-monto').value);
            const fecha = document.getElementById('rm-fecha').value;
            const metodo = document.getElementById('rm-metodo').value;
            const notas = document.getElementById('rm-notas').value.trim();

            if (isNaN(monto) || monto <= 0) { _alertaModal(alertBox, 'Monto inválido.'); return; }
            if (!fecha) { _alertaModal(alertBox, 'Selecciona una fecha.'); return; }

            AUTH.setLoading(btn, true);

            try {
                // RF-25: Registrar el pago como validado automáticamente
                const { error: e1 } = await window.supabaseClient
                    .from('registros_pago')
                    .insert({
                        calendario_id: pago.calendario_id,
                        registrado_por_id: _usuario.usuario_id,
                        fecha_recibido: fecha,
                        monto_recibido: monto,
                        metodo_pago: metodo,
                        notas: notas || null,
                        validado: true
                    });
                if (e1) throw e1;

                const { error: e2 } = await window.supabaseClient
                    .from('calendario_pagos')
                    .update({ estado: 'PAGADO', fecha_pagado: fecha })
                    .eq('calendario_id', pago.calendario_id);
                if (e2) throw e2;

                _enviarNotificacion(pago, 'Pago registrado', 'Tu arrendador ha registrado un pago a tu favor.', 'PAGO_PROXIMO');

                document.getElementById('modal-registrar-pago')?.remove();
                if (window.TOAST) TOAST.success('Pago registrado manualmente.');
                await _cargarPagos();

            } catch (err) {
                console.error('[PAGOS-ARR] Error registro manual:', err);
                _alertaModal(alertBox, 'Error guardando el registro.');
                AUTH.setLoading(btn, false);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 3: HISTORIAL (Todos los pagos con paginación local)
    // ──────────────────────────────────────────────────────────────
    function _renderHistorial() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;

        const q = (document.getElementById('f-buscar')?.value || '').toLowerCase().trim();
        const est = document.getElementById('f-estado')?.value || '';

        let filtrados = _todosPagos.filter(p => {
            if (est && p.estado !== est) return false;
            if (!q) return true;
            const inq = (p.contratos?.inquilinos?.usuarios?.nombre_completo || '').toLowerCase();
            const prop = (p.contratos?.propiedades?.nombre || '').toLowerCase();
            return inq.includes(q) || prop.includes(q);
        });

        if (!filtrados.length) {
            cont.innerHTML = _htmlVacio('No hay registros en el historial con estos filtros.', 'fa-folder-open');
            return;
        }

        const totalPages = Math.ceil(filtrados.length / _HIST_LIMIT);
        if (_histPage > totalPages) _histPage = 1;
        const offset = (_histPage - 1) * _HIST_LIMIT;
        const paginaActual = filtrados.slice(offset, offset + _HIST_LIMIT);

        const H = CALENDARIO_HELPER;
        let html = `<div class="space-y-2">`;

        paginaActual.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const inqNombre = p.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';
            const reg = p.registros_pago?.[0];

            html += `
                <div class="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <div class="w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 border ${c.border}">
                        <i class="fa-solid ${c.icon} ${c.text}"></i>
                    </div>

                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <p class="text-[#13243E] font-extrabold text-sm">${H.fmtMoney(p.monto_esperado)}</p>
                            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ${c.bg} border ${c.border} ${c.text} text-[9px] font-bold uppercase tracking-wider">
                                <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span> ${c.label}
                            </span>
                        </div>
                        <p class="text-[#13243E] font-bold text-xs truncate">${esc(inqNombre)} · <span class="text-[#6F88A1] font-medium">${esc(propNombre)}</span></p>
                        <p class="text-slate-400 text-[10px] mt-0.5 font-medium truncate">
                            Periodo: ${H.formatearPeriodo(p)}
                            ${p.fecha_pagado ? ` · Pagado: ${H.fmtFecha(p.fecha_pagado)}` : ''}
                        </p>
                    </div>

                    ${reg?.metodo_pago ? `
                    <div class="hidden sm:block text-right flex-shrink-0">
                        <p class="text-[#6F88A1] text-[9px] uppercase font-bold tracking-widest">Vía</p>
                        <p class="text-[#13243E] text-xs font-bold mt-0.5"><i class="fa-solid fa-wallet mr-1 text-[#FFC533]"></i>${esc(reg.metodo_pago)}</p>
                    </div>` : ''}
                </div>`;
        });
        html += `</div>`;

        // Controles de Paginación
        if (totalPages > 1) {
            html += `
                <div class="flex items-center justify-between mt-5 pt-4 border-t border-slate-200">
                    <p class="text-[#6F88A1] text-xs font-medium">Página <strong>${_histPage}</strong> de <strong>${totalPages}</strong></p>
                    <div class="flex gap-2">
                        <button ${ _histPage === 1 ? 'disabled' : `data-page="${_histPage - 1}"` }
                                class="px-3 py-2 rounded-lg bg-white border border-slate-200 text-[#13243E] disabled:opacity-50 hover:bg-[#F5F7F9] transition-colors text-xs font-bold">
                            <i class="fa-solid fa-chevron-left mr-1"></i> Ant
                        </button>
                        <button ${ _histPage === totalPages ? 'disabled' : `data-page="${_histPage + 1}"` }
                                class="px-3 py-2 rounded-lg bg-white border border-slate-200 text-[#13243E] disabled:opacity-50 hover:bg-[#F5F7F9] transition-colors text-xs font-bold">
                            Sig <i class="fa-solid fa-chevron-right ml-1"></i>
                        </button>
                    </div>
                </div>`;
        }

        cont.innerHTML = html;

        cont.querySelectorAll('[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-page');
                if (!v) return;
                if (v === 'prev') _histPage = Math.max(1, _histPage - 1);
                else if (v === 'next') _histPage = Math.min(totalPages, _histPage + 1);
                else _histPage = parseInt(v, 10);
                _renderHistorial();
                document.getElementById('tab-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
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
        box.className = 'mb-4 px-4 py-3 rounded-xl text-xs font-bold bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box?.classList.add('hidden'), 4500);
    }

    function _htmlVacio(msg, icon = 'fa-receipt') {
        return `
            <div class="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-sm">
                <div class="w-16 h-16 mx-auto rounded-2xl bg-[#F5F7F9] border border-slate-200 flex items-center justify-center mb-4">
                    <i class="fa-solid ${icon} text-[#6F88A1] text-2xl"></i>
                </div>
                <p class="text-[#13243E] font-extrabold text-lg mb-1">Sin resultados</p>
                <p class="text-[#6F88A1] text-sm font-medium">${esc(msg)}</p>
            </div>`;
    }

    function _renderMensaje(msg, icon) {
        const cont = document.getElementById('tab-content');
        if (cont) cont.innerHTML = _htmlVacio(msg, icon);
    }

    // Bind para historial filtros
    function _bindFiltros() {
        ['f-buscar', 'f-estado'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                _histPage = 1;
                _renderHistorial();
            });
            document.getElementById(id)?.addEventListener('change', () => {
                _histPage = 1;
                _renderHistorial();
            });
        });
    }

    async function _enviarNotificacion(pago, titulo, msg, tipo) {
        const usrInqId = pago.contratos?.inquilinos?.usuarios?.usuario_id;
        if (!usrInqId) return;

        try {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: usrInqId,
                titulo: titulo,
                mensaje: msg,
                tipo: tipo,
                metadatos: { calendario_id: pago.calendario_id }
            });
        } catch (e) {
            console.error('[PAGOS-ARR] Error enviando notif:', e);
        }
    }

    return { init };
})();

window.PAGOS_ARRENDADOR = PAGOS_ARRENDADOR;