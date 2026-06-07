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
    let _propiedades = [];         // propiedades del arrendador
    let _propiedadIds = [];        // IDs para filtrar
    let _contratosActivos = [];    // contratos activos con datos de inquilino
    let _pagosReportados = [];     // pagos en estado REPORTADO
    let _todosLosPagos = [];       // todos los pagos para historial
    let _tabActiva = 'validar';
    let _histPage = 0;             // página actual del historial
    const _HIST_PER_PAGE = 8;      // resultados por página en historial

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // 1. Marcar pagos vencidos (función RPC)
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[PAGOS-ARR] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        // 2. Cargar propiedades del arrendador
        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion, tipo_propiedad')
            .eq('duenio_id', usuario.usuario_id)
            .eq('activa', true);

        _propiedades = props || [];
        _propiedadIds = _propiedades.map(p => p.propiedad_id);

        // Detectar tab de la URL (ej. ?tab=calendario)
        const params = new URLSearchParams(window.location.search);
        const tabURL = params.get('tab');
        if (tabURL && ['validar', 'registrar', 'historial', 'calendario'].includes(tabURL)) {
            _tabActiva = tabURL === 'calendario' ? 'historial' : tabURL;
        }

        // 3. Cargar contratos activos (para el registro manual)
        await _cargarContratosActivos();

        // 4. Cargar datos según la tab
        await _cargarPagosReportados();
        await _cargarTodosLosPagos();

        // 5. Bind
        _bindTabs();
        _bindFiltros();
        _pintarTabActiva();

        // 6. Render
        _renderMetricas();
        _renderTab();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar datos
    // ──────────────────────────────────────────────────────────────
    async function _cargarContratosActivos() {
        if (!_propiedadIds.length) { _contratosActivos = []; return; }

        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, monto_renta, frecuencia_pago, estado,
                propiedades ( propiedad_id, nombre, direccion ),
                inquilinos (
                    inquilino_id,
                    usuarios ( usuario_id, nombre_completo, correo, telefono )
                )
            `)
            .in('propiedad_id', _propiedadIds)
            .eq('estado', 'ACTIVO');

        if (error) console.error('[PAGOS-ARR] Error cargando contratos:', error);
        _contratosActivos = data || [];
    }

    async function _cargarPagosReportados() {
        if (!_propiedadIds.length) { _pagosReportados = []; return; }

        // Obtener IDs de contratos del arrendador
        const contratoIds = _contratosActivos.map(c => c.contrato_id);
        if (!contratoIds.length) { _pagosReportados = []; return; }

        // Pagos REPORTADOS con datos del registro de pago y del contrato
        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                registros_pago (
                    pago_id, fecha_recibido, monto_recibido, metodo_pago,
                    referencia, notas, validado, registrado_por_id,
                    creado_en
                ),
                contratos (
                    contrato_id, monto_renta,
                    propiedades ( propiedad_id, nombre, direccion ),
                    inquilinos (
                        inquilino_id,
                        usuarios ( usuario_id, nombre_completo, correo )
                    )
                )
            `)
            .in('contrato_id', contratoIds)
            .eq('estado', 'REPORTADO')
            .order('reportado_en', { ascending: false });

        if (error) console.error('[PAGOS-ARR] Error cargando reportados:', error);
        _pagosReportados = data || [];
    }

    async function _cargarTodosLosPagos() {
        if (!_propiedadIds.length) { _todosLosPagos = []; return; }

        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id')
            .in('propiedad_id', _propiedadIds);

        const ids = (contratos || []).map(c => c.contrato_id);
        if (!ids.length) { _todosLosPagos = []; return; }

        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                registros_pago ( pago_id, fecha_recibido, monto_recibido, metodo_pago, referencia, validado ),
                contratos (
                    contrato_id, monto_renta,
                    propiedades ( nombre, direccion ),
                    inquilinos ( usuarios ( nombre_completo ) )
                )
            `)
            .in('contrato_id', ids)
            .order('fecha_limite', { ascending: false })
            .limit(100);

        if (error) console.error('[PAGOS-ARR] Error cargando historial:', error);
        _todosLosPagos = data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Métricas
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas() {
        const reportados = _pagosReportados.length;
        const pagados    = _todosLosPagos.filter(p => p.estado === 'PAGADO').length;
        const vencidos   = _todosLosPagos.filter(p => p.estado === 'VENCIDO').length;
        const pendientes = _todosLosPagos.filter(p => p.estado === 'PENDIENTE').length;

        _set('m-reportados', reportados);
        _set('m-pagados', pagados);
        _set('m-vencidos', vencidos);
        _set('m-pendientes', pendientes);
    }

    // ──────────────────────────────────────────────────────────────
    // Tabs
    // ──────────────────────────────────────────────────────────────
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
            btn.className = 'tab-pagos-arr flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-all ' +
                (activa ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700');
        });
    }

    function _renderTab() {
        switch (_tabActiva) {
            case 'validar':   _renderPorValidar(); break;
            case 'registrar': _renderRegistroManual(); break;
            case 'historial': _renderHistorial(); break;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        // Al cambiar cualquier filtro, volver a la primera página del historial
        const handler = () => { _histPage = 0; _renderTab(); };
        ['f-buscar', 'f-estado'].forEach(id => {
            document.getElementById(id)?.addEventListener('input',  handler);
            document.getElementById(id)?.addEventListener('change', handler);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 1: Por validar
    // ──────────────────────────────────────────────────────────────
    function _renderPorValidar() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;
        const H = CALENDARIO_HELPER;

        if (!_pagosReportados.length) {
            cont.innerHTML = _htmlVacio('No hay pagos pendientes de validación.', 'fa-inbox');
            return;
        }

        let html = `
            <div class="space-y-3">
                <p class="text-slate-500 text-xs mb-2">
                    <i class="fa-solid fa-circle-info mr-1"></i>
                    Tienes <strong class="text-blue-700">${_pagosReportados.length}</strong> pago(s) reportados por tus inquilinos esperando validación.
                </p>`;

        _pagosReportados.forEach(p => {
            const c = H.colorPorEstado('REPORTADO');
            const reg = p.registros_pago;
            const inqNombre = p.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';
            const periodo = H.formatearPeriodo(p);

            // Métodos de pago legibles
            const metodoLabels = {
                TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo',
                DEPOSITO: 'Depósito', TARJETA: 'Tarjeta', OTRO: 'Otro'
            };

            html += `
                <div class="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <!-- Cabecera con estado -->
                    <div class="bg-blue-50 border-b border-blue-100 px-5 py-3 flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse"></span>
                        <span class="text-blue-700 text-xs font-bold uppercase tracking-wider">Pago reportado</span>
                        <span class="ml-auto text-[10px] text-slate-400 font-mono">${H.fmtFecha(p.reportado_en)}</span>
                    </div>

                    <div class="p-5">
                        <!-- Inquilino y propiedad -->
                        <div class="flex items-start gap-3 mb-3">
                            <div class="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                                ${esc((inqNombre).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase())}
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-slate-900 font-bold text-sm truncate">${esc(inqNombre)}</p>
                                <p class="text-slate-500 text-xs truncate">
                                    <i class="fa-solid fa-house text-[10px] mr-0.5"></i>${esc(propNombre)}
                                </p>
                            </div>
                        </div>

                        <!-- Datos del reporte -->
                        <div class="grid grid-cols-2 gap-2 text-xs bg-slate-50 rounded-xl p-3 mb-3">
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Monto esperado</p>
                                <p class="text-slate-800 font-bold">${H.fmtMoney(p.monto_esperado)}</p>
                            </div>
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Monto reportado</p>
                                <p class="text-blue-700 font-bold">${H.fmtMoney(reg?.monto_recibido)}</p>
                            </div>
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Método</p>
                                <p class="text-slate-800 font-semibold">${metodoLabels[reg?.metodo_pago] || reg?.metodo_pago || '—'}</p>
                            </div>
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Referencia</p>
                                <p class="text-slate-800 font-semibold truncate">${esc(reg?.referencia || 'Sin referencia')}</p>
                            </div>
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Periodo</p>
                                <p class="text-slate-800 font-semibold">${esc(periodo)}</p>
                            </div>
                            <div>
                                <p class="text-slate-400 text-[10px] uppercase font-semibold">Fecha de pago</p>
                                <p class="text-slate-800 font-semibold">${H.fmtFecha(reg?.fecha_recibido)}</p>
                            </div>
                        </div>

                        ${reg?.notas ? `
                        <p class="text-slate-600 text-xs bg-slate-50 rounded-xl px-3 py-2 mb-3">
                            <i class="fa-solid fa-comment text-[10px] mr-1 text-slate-400"></i>
                            ${esc(reg.notas)}
                        </p>` : ''}

                        <!-- Diferencia de monto (alerta si no coincide) -->
                        ${reg?.monto_recibido && Math.abs(reg.monto_recibido - p.monto_esperado) > 0.01 ? `
                        <div class="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3">
                            <i class="fa-solid fa-triangle-exclamation flex-shrink-0"></i>
                            <span>El monto reportado difiere del esperado en <strong>${H.fmtMoney(Math.abs(reg.monto_recibido - p.monto_esperado))}</strong>.</span>
                        </div>` : ''}

                        <!-- Acciones: Aprobar / Rechazar -->
                        <div class="flex gap-2">
                            <button data-action="rechazar" data-cal-id="${p.calendario_id}" data-pago-id="${reg?.pago_id}"
                                    class="flex-1 px-3 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition border border-red-100">
                                <i class="fa-solid fa-xmark mr-1"></i> Rechazar
                            </button>
                            <button data-action="aprobar" data-cal-id="${p.calendario_id}" data-pago-id="${reg?.pago_id}"
                                    class="flex-1 px-3 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-semibold shadow-md shadow-green-600/25 transition">
                                <i class="fa-solid fa-check mr-1"></i> Aprobar pago
                            </button>
                        </div>
                    </div>
                </div>`;
        });

        html += `</div>`;
        cont.innerHTML = html;

        // Bind acciones
        cont.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const calId  = parseInt(btn.getAttribute('data-cal-id'), 10);
                const pagoId = parseInt(btn.getAttribute('data-pago-id'), 10);
                const action = btn.getAttribute('data-action');

                if (action === 'aprobar') {
                    await _aprobarPago(calId, pagoId, btn);
                } else if (action === 'rechazar') {
                    _abrirModalRechazo(calId, pagoId);
                }
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // APROBAR pago
    //   1. UPDATE registros_pago SET validado = true, validado_por_id
    //   2. UPDATE calendario_pagos SET estado = 'PAGADO', fecha_pagado, validado_en
    //
    //   Prevención de colisiones: el WHERE incluye estado = 'REPORTADO'
    //   para evitar aprobar un pago que ya fue procesado concurrentemente.
    // ──────────────────────────────────────────────────────────────
    async function _aprobarPago(calendarioId, pagoId, btnEl) {
        AUTH.setLoading(btnEl, true);

        try {
            // ── 1. Validar con condición WHERE estado = 'REPORTADO' ──
            // Si otro arrendador/pestaña ya procesó este pago, el UPDATE
            // no afecta filas y detectamos la condición de carrera.
            const { data: updatedCal, error: errCal } = await window.supabaseClient
                .from('calendario_pagos')
                .update({
                    estado:      'PAGADO',
                    fecha_pagado: new Date().toISOString().slice(0, 10),
                    validado_en: new Date().toISOString(),
                })
                .eq('calendario_id', calendarioId)
                .eq('estado', 'REPORTADO')   // ← prevención de colisión
                .select('calendario_id');

            if (errCal) throw errCal;

            if (!updatedCal || updatedCal.length === 0) {
                throw new Error('El pago ya fue procesado por otra sesión. Recarga la página.');
            }

            // ── 2. Marcar el registro de pago como validado ──
            if (pagoId) {
                const { error: errReg } = await window.supabaseClient
                    .from('registros_pago')
                    .update({
                        validado:        true,
                        validado_por_id: _usuario.usuario_id,
                    })
                    .eq('pago_id', pagoId);

                if (errReg) {
                    console.warn('[PAGOS-ARR] Error actualizando registros_pago (no crítico):', errReg);
                }
            }

            // ── 3. Notificación al inquilino ──
            const pagoInfo = _pagosReportados.find(p => p.calendario_id === calendarioId);
            const inqUserId = pagoInfo?.contratos?.inquilinos?.usuarios?.usuario_id;
            const propNombre = pagoInfo?.contratos?.propiedades?.nombre || 'la propiedad';

            if (inqUserId) {
                await window.supabaseClient.from('notificaciones').insert({
                    usuario_id: inqUserId,
                    titulo: '¡Tu pago fue validado!',
                    mensaje: `El arrendador aprobó tu pago para "${propNombre}". Tu historial se actualizó.`,
                    tipo: 'PAGO_PROXIMO',
                    metadatos: { calendario_id: calendarioId },
                });
            }

            if (window.TOAST) TOAST.success('Pago aprobado correctamente.');

            // Refrescar
            await _cargarPagosReportados();
            await _cargarTodosLosPagos();
            _renderMetricas();
            _renderTab();

        } catch (err) {
            console.error('[PAGOS-ARR] Error al aprobar pago:', err);
            AUTH.setLoading(btnEl, false);
            if (window.TOAST) TOAST.error(err.message || 'No se pudo aprobar el pago.');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: Rechazar pago reportado
    //   1. UPDATE calendario_pagos SET estado = 'PENDIENTE'
    //   2. DELETE registros_pago (para que el inquilino pueda reportar de nuevo)
    // ──────────────────────────────────────────────────────────────
    function _abrirModalRechazo(calendarioId, pagoId) {
        document.getElementById('modal-rechazar-pago')?.remove();

        const html = `
        <div id="modal-rechazar-pago" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 bg-gradient-to-r from-red-600 to-red-700 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-xmark text-lg"></i>
                        </div>
                        <div>
                            <p class="font-bold text-base leading-tight">Rechazar pago reportado</p>
                            <p class="text-white/70 text-xs">El inquilino podrá reportar de nuevo</p>
                        </div>
                    </div>
                </div>

                <div class="p-5">
                    <div id="rechazo-alert" class="hidden mb-3"></div>

                    <p class="text-slate-600 text-sm mb-4">
                        Al rechazar, el estado del pago volverá a <strong>Pendiente</strong> y se eliminará el registro
                        del reporte. El inquilino será notificado y podrá enviar un nuevo reporte.
                    </p>

                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1.5">Motivo del rechazo *</label>
                        <textarea id="motivo-rechazo-pago" rows="3" maxlength="300"
                                  placeholder="Ej. No se encontró la transferencia con esa referencia…"
                                  class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                    </div>

                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-rechazar-pago').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cancelar
                        </button>
                        <button id="btn-confirmar-rechazo" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold shadow-md">
                            Confirmar rechazo
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirmar-rechazo').addEventListener('click', async () => {
            await _rechazarPago(calendarioId, pagoId);
        });
    }

    async function _rechazarPago(calendarioId, pagoId) {
        const btn     = document.getElementById('btn-confirmar-rechazo');
        const alertEl = document.getElementById('rechazo-alert');
        const motivo  = document.getElementById('motivo-rechazo-pago')?.value.trim();

        if (!motivo) {
            _alertaModal(alertEl, 'Indica el motivo del rechazo.');
            return;
        }

        AUTH.setLoading(btn, true);

        try {
            // ── 1. Revertir el estado del pago a PENDIENTE ──
            const { error: errCal } = await window.supabaseClient
                .from('calendario_pagos')
                .update({
                    estado:       'PENDIENTE',
                    reportado_en: null,
                    validado_en:  null,
                })
                .eq('calendario_id', calendarioId)
                .eq('estado', 'REPORTADO');   // ← prevención de colisión

            if (errCal) throw errCal;

            // ── 2. Eliminar el registro de registros_pago ──
            //   Esto libera la constraint UNIQUE para que el inquilino
            //   pueda enviar un nuevo reporte.
            if (pagoId) {
                const { error: errDel } = await window.supabaseClient
                    .from('registros_pago')
                    .delete()
                    .eq('pago_id', pagoId);

                if (errDel) {
                    console.warn('[PAGOS-ARR] Error al eliminar registros_pago:', errDel);
                }
            }

            // ── 3. Notificación al inquilino ──
            const pagoInfo = _pagosReportados.find(p => p.calendario_id === calendarioId);
            const inqUserId = pagoInfo?.contratos?.inquilinos?.usuarios?.usuario_id;
            const propNombre = pagoInfo?.contratos?.propiedades?.nombre || 'la propiedad';

            if (inqUserId) {
                await window.supabaseClient.from('notificaciones').insert({
                    usuario_id: inqUserId,
                    titulo: 'Tu reporte de pago fue rechazado',
                    mensaje: `El arrendador rechazó tu reporte de pago para "${propNombre}". Motivo: ${motivo}. Puedes enviar un nuevo reporte.`,
                    tipo: 'PAGO_VENCIDO',
                    metadatos: { calendario_id: calendarioId, motivo_rechazo: motivo },
                });
            }

            document.getElementById('modal-rechazar-pago')?.remove();
            if (window.TOAST) TOAST.info('Pago rechazado. El inquilino fue notificado.');

            // Refrescar
            await _cargarPagosReportados();
            await _cargarTodosLosPagos();
            _renderMetricas();
            _renderTab();

        } catch (err) {
            console.error('[PAGOS-ARR] Error al rechazar pago:', err);
            AUTH.setLoading(btn, false);
            _alertaModal(alertEl, err.message || 'No se pudo rechazar el pago.');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 2: Registro manual de pagos
    //   Para pagos en efectivo o fuera de plataforma. El arrendador
    //   selecciona contrato, cuota pendiente/vencida y registra.
    // ──────────────────────────────────────────────────────────────
    function _renderRegistroManual() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;

        if (!_contratosActivos.length) {
            cont.innerHTML = _htmlVacio('No tienes contratos activos para registrar pagos.', 'fa-file-invoice-dollar');
            return;
        }

        const optsContratos = _contratosActivos.map(c => {
            const inq  = c.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const prop = c.propiedades?.nombre || 'Propiedad';
            return `<option value="${c.contrato_id}">${esc(prop)} — ${esc(inq)}</option>`;
        }).join('');

        cont.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div class="flex items-center gap-2 mb-4">
                    <div class="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                        <i class="fa-solid fa-hand-holding-dollar text-green-700 text-sm"></i>
                    </div>
                    <h4 class="text-slate-800 font-semibold text-sm">Registrar pago manual</h4>
                </div>

                <p class="text-slate-500 text-xs mb-4">
                    Usa esta opción para registrar pagos recibidos en efectivo o por otros medios fuera de la plataforma.
                    Selecciona el contrato y la cuota correspondiente.
                </p>

                <div id="registro-alert" class="hidden mb-3"></div>

                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1.5">Contrato *</label>
                        <select id="rm-contrato"
                                class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                            <option value="">— Selecciona un contrato —</option>
                            ${optsContratos}
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1.5">Cuota a pagar *</label>
                        <select id="rm-cuota" disabled
                                class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                            <option value="">Selecciona primero un contrato</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Fecha de recepción *</label>
                            <input id="rm-fecha" type="date" value="${new Date().toISOString().slice(0, 10)}"
                                   class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Monto recibido *</label>
                            <div class="relative">
                                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                                <input id="rm-monto" type="number" min="1" step="0.01" placeholder="0.00"
                                       class="input-brand w-full pl-7 pr-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1.5">Método de pago *</label>
                        <select id="rm-metodo"
                                class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                            <option value="EFECTIVO">Efectivo</option>
                            <option value="TRANSFERENCIA">Transferencia bancaria</option>
                            <option value="DEPOSITO">Depósito bancario</option>
                            <option value="TARJETA">Tarjeta</option>
                            <option value="OTRO">Otro</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-medium text-slate-600 mb-1.5">Notas (opcional)</label>
                        <textarea id="rm-notas" rows="2" maxlength="300"
                                  placeholder="Observaciones adicionales…"
                                  class="input-brand w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                    </div>
                </div>

                <div class="flex justify-end mt-5 pt-4 border-t border-slate-100">
                    <button id="btn-registrar-manual" type="button"
                            class="btn-primary px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm shadow-md shadow-green-600/25">
                        <i class="fa-solid fa-check mr-1.5"></i> Registrar pago
                    </button>
                </div>
            </div>`;

        // Bind: al seleccionar contrato, cargar cuotas pendientes
        document.getElementById('rm-contrato')?.addEventListener('change', async () => {
            const contratoId = parseInt(document.getElementById('rm-contrato').value, 10);
            const cuotaSel = document.getElementById('rm-cuota');
            if (!contratoId) {
                cuotaSel.innerHTML = '<option value="">Selecciona primero un contrato</option>';
                cuotaSel.disabled = true;
                return;
            }

            // Cargar cuotas PENDIENTE o VENCIDO de este contrato
            const { data: cuotas } = await window.supabaseClient
                .from('calendario_pagos')
                .select('calendario_id, fecha_limite, monto_esperado, estado, periodo_inicio, periodo_fin, anio, mes')
                .eq('contrato_id', contratoId)
                .in('estado', ['PENDIENTE', 'VENCIDO'])
                .order('fecha_limite', { ascending: true });

            const H = CALENDARIO_HELPER;
            if (!cuotas?.length) {
                cuotaSel.innerHTML = '<option value="">No hay cuotas pendientes</option>';
                cuotaSel.disabled = true;
                return;
            }

            cuotaSel.innerHTML = `<option value="">— Selecciona una cuota —</option>` +
                cuotas.map(q => {
                    const periodo = H.formatearPeriodo(q);
                    const est = q.estado === 'VENCIDO' ? ' ⚠️ Vencido' : '';
                    return `<option value="${q.calendario_id}" data-monto="${q.monto_esperado}">
                        ${esc(periodo)} — ${H.fmtMoney(q.monto_esperado)}${est}
                    </option>`;
                }).join('');
            cuotaSel.disabled = false;

            // Pre-rellenar monto al seleccionar cuota
            cuotaSel.addEventListener('change', () => {
                const opt = cuotaSel.selectedOptions[0];
                const monto = opt?.getAttribute('data-monto');
                if (monto) document.getElementById('rm-monto').value = monto;
            });
        });

        // Bind: botón de registro manual
        document.getElementById('btn-registrar-manual')?.addEventListener('click', async () => {
            await _registrarPagoManual();
        });
    }

    // ──────────────────────────────────────────────────────────────
    // _registrarPagoManual()
    //   1. INSERT en registros_pago (validado = true desde el inicio)
    //   2. UPDATE en calendario_pagos (estado → 'PAGADO')
    // ──────────────────────────────────────────────────────────────
    async function _registrarPagoManual() {
        const btn     = document.getElementById('btn-registrar-manual');
        const alertEl = document.getElementById('registro-alert');

        const calendarioId = parseInt(document.getElementById('rm-cuota')?.value, 10);
        const fecha     = document.getElementById('rm-fecha')?.value;
        const monto     = parseFloat(document.getElementById('rm-monto')?.value);
        const metodo    = document.getElementById('rm-metodo')?.value;
        const notas     = document.getElementById('rm-notas')?.value.trim();

        // Validaciones
        if (!calendarioId) { _alertaModal(alertEl, 'Selecciona una cuota.'); return; }
        if (!fecha)        { _alertaModal(alertEl, 'Indica la fecha de recepción.'); return; }
        if (isNaN(monto) || monto <= 0) { _alertaModal(alertEl, 'El monto debe ser mayor a cero.'); return; }

        AUTH.setLoading(btn, true);

        try {
            // ── 1. INSERT en registros_pago ──
            const { data: registro, error: errIns } = await window.supabaseClient
                .from('registros_pago')
                .insert({
                    calendario_id:     calendarioId,
                    registrado_por_id: _usuario.usuario_id,
                    fecha_recibido:    fecha,
                    monto_recibido:    monto,
                    metodo_pago:       metodo,
                    notas:             notas || null,
                    validado:          true,
                    validado_por_id:   _usuario.usuario_id,
                })
                .select('pago_id')
                .single();

            if (errIns) {
                if (errIns.code === '23505') {
                    throw new Error('Ya existe un registro de pago para esta cuota.');
                }
                throw errIns;
            }

            // ── 2. UPDATE en calendario_pagos ──
            const { error: errUpd } = await window.supabaseClient
                .from('calendario_pagos')
                .update({
                    estado:       'PAGADO',
                    fecha_pagado: fecha,
                    validado_en:  new Date().toISOString(),
                })
                .eq('calendario_id', calendarioId);

            if (errUpd) {
                // Compensación
                await window.supabaseClient.from('registros_pago').delete().eq('pago_id', registro.pago_id);
                throw errUpd;
            }

            if (window.TOAST) TOAST.success('Pago registrado y validado. Lo verás en el Historial.');

            // Refrescar datos
            await _cargarPagosReportados();
            await _cargarTodosLosPagos();
            _renderMetricas();

            // Un pago manual queda validado de inmediato (no pasa por
            // "Por validar"). Llevamos al usuario al Historial para que vea
            // el pago recién registrado y no piense que se perdió.
            _histPage = 0;
            _tabActiva = 'historial';
            _pintarTabActiva();
            _renderTab();
            document.getElementById('tab-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (err) {
            console.error('[PAGOS-ARR] Error registro manual:', err);
            AUTH.setLoading(btn, false);
            _alertaModal(alertEl, err.message || 'No se pudo registrar el pago.');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // TAB 3: Historial completo
    // ──────────────────────────────────────────────────────────────
    function _renderHistorial() {
        const cont = document.getElementById('tab-content');
        if (!cont) return;
        const H = CALENDARIO_HELPER;

        // Aplicar filtros
        const q = (document.getElementById('f-buscar')?.value || '').toLowerCase().trim();
        const filtroEstado = document.getElementById('f-estado')?.value || '';

        let lista = _todosLosPagos.filter(p => {
            if (filtroEstado && p.estado !== filtroEstado) return false;
            if (!q) return true;
            const inq  = p.contratos?.inquilinos?.usuarios?.nombre_completo?.toLowerCase() || '';
            const prop = p.contratos?.propiedades?.nombre?.toLowerCase() || '';
            return inq.includes(q) || prop.includes(q);
        });

        if (!lista.length) {
            cont.innerHTML = _htmlVacio('No hay pagos que coincidan con los filtros.', 'fa-receipt');
            return;
        }

        // Paginación
        const totalPages = Math.max(1, Math.ceil(lista.length / _HIST_PER_PAGE));
        if (_histPage >= totalPages) _histPage = totalPages - 1;
        if (_histPage < 0) _histPage = 0;
        const inicio = _histPage * _HIST_PER_PAGE;
        const pagina = lista.slice(inicio, inicio + _HIST_PER_PAGE);

        let html = `
            <div class="flex items-center justify-between gap-2 mb-2 px-1">
                <p class="text-[11px] text-slate-400 font-medium">
                    <i class="fa-solid fa-receipt mr-1"></i>${lista.length} pago(s) encontrados
                </p>
                <p class="text-[11px] text-slate-400 font-medium">Página ${_histPage + 1} de ${totalPages}</p>
            </div>
            <div class="space-y-2">`;
        pagina.forEach(p => {
            const c = H.colorPorEstado(p.estado);
            const inqNombre = p.contratos?.inquilinos?.usuarios?.nombre_completo || 'Inquilino';
            const propNombre = p.contratos?.propiedades?.nombre || 'Propiedad';
            const periodo = H.formatearPeriodo(p);
            const reg = p.registros_pago;

            html += `
                <div class="flex items-center gap-3 bg-white rounded-xl border border-slate-100 shadow-sm p-3.5 hover:shadow-md transition-shadow">
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
                        <p class="text-slate-500 text-xs truncate">${esc(inqNombre)} · ${esc(propNombre)}</p>
                        <p class="text-slate-400 text-[10px]">${esc(periodo)} · Vence: ${H.fmtFecha(p.fecha_limite)}</p>
                    </div>
                    ${reg?.monto_recibido ? `
                    <div class="text-right flex-shrink-0">
                        <p class="text-green-700 font-bold text-sm">${H.fmtMoney(reg.monto_recibido)}</p>
                        <p class="text-slate-400 text-[10px]">${H.fmtFecha(reg.fecha_recibido)}</p>
                    </div>` : ''}
                </div>`;
        });
        html += `</div>`;

        // Controles de paginación
        if (totalPages > 1) {
            let nums = '';
            const maxBtns = 7;
            let desde = Math.max(0, _histPage - 3);
            let hasta = Math.min(totalPages, desde + maxBtns);
            desde = Math.max(0, hasta - maxBtns);
            for (let i = desde; i < hasta; i++) {
                nums += `<button class="page-btn" data-page="${i}" aria-current="${i === _histPage ? 'true' : 'false'}">${i + 1}</button>`;
            }
            html += `
                <div class="flex items-center justify-center gap-1.5 mt-4">
                    <button class="page-btn" data-page="prev" ${_histPage === 0 ? 'disabled' : ''} aria-label="Anterior">‹</button>
                    ${nums}
                    <button class="page-btn" data-page="next" ${_histPage >= totalPages - 1 ? 'disabled' : ''} aria-label="Siguiente">›</button>
                </div>`;
        }

        cont.innerHTML = html;

        // Bind de paginación
        cont.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-page');
                if (v === 'prev') _histPage = Math.max(0, _histPage - 1);
                else if (v === 'next') _histPage = _histPage + 1;
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
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs font-medium bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box?.classList.add('hidden'), 4500);
    }

    function _htmlVacio(msg, icon = 'fa-receipt') {
        return `
            <div class="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                    <i class="fa-solid ${icon} text-blue-500 text-xl"></i>
                </div>
                <p class="text-slate-700 font-semibold mb-1">Sin resultados</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    return { init };
})();

window.PAGOS_ARRENDADOR = PAGOS_ARRENDADOR;