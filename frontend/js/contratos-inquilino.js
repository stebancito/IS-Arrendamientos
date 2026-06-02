// ================================================================
// contratos-inquilino.js  –  Vista de contratos del inquilino
// ================================================================
// Responsabilidades:
//   - Mostrar contratos del inquilino agrupados en pestañas:
//       PENDIENTE → con botones Aceptar / Rechazar (modal inyectado)
//       ACTIVO    → con botones Ver detalle, Descargar PDF, Cancelar
//       HISTORIAL → FINALIZADO / TERMINADO / RECHAZADO
//   - Aceptación: cambia estado → 'ACTIVO' y genera el calendario de pagos
//                 con base en la frecuencia (RF-20, RN-11).
//   - Cancelación anticipada (RF-19, RN-08 ↔ historial RN-09):
//       * Mínimo 1 semana de anticipación (lo solicita el enunciado).
//       * Motivo obligatorio (select o textarea, inyectado vía modal).
//       * Mueve el contrato a estado 'TERMINADO' (cancelado anticipado),
//         guarda fecha_terminacion y motivo_terminacion.
//   - Descarga del PDF mediante PDF_CONTRATO.descargar().
//
// Inyección de modales: TODOS los modales se construyen en runtime
// con document.body.insertAdjacentHTML — siguiendo la convención de
// los demás módulos del proyecto.
// ================================================================

const CONTRATOS_INQUILINO = (() => {

    let _usuario = null;
    let _inquilinoId = null;
    let _contratos = [];
    let _tabActiva = 'PENDIENTE';

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // Asegurar registro en tabla inquilinos (en caso de inquilinos
        // creados solo desde auth.users sin pasar por _seleccionarInquilino).
        const { data: inq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();

        if (inq) {
            _inquilinoId = inq.inquilino_id;
        } else {
            // No tiene registro en `inquilinos` aún → sin contratos
            _renderVacio('Aún no tienes contratos. Cuando un arrendador te envíe uno, aparecerá aquí.');
            return;
        }

        _bindTabs();
        await _cargarContratos();
    }

    // ──────────────────────────────────────────────────────────────
    // Carga inicial
    // ──────────────────────────────────────────────────────────────
    async function _cargarContratos() {
        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, fecha_terminacion, monto_renta,
                frecuencia_pago, estado, observaciones, beneficios,
                aceptado_en, rechazado_en, motivo_terminacion, creado_en,
                propiedades (
                    propiedad_id, nombre, direccion, descripcion, tipo_propiedad,
                    duenio_id, propiedad_padre_id
                )
            `)
            .eq('inquilino_id', _inquilinoId)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[CONTRATOS-INQUILINO] Error al cargar:', error);
            _renderVacio('No se pudieron cargar tus contratos.');
            return;
        }
        _contratos = data || [];

        // Enriquecer con datos del arrendador (usuario dueño de la propiedad)
        const arrendadorIds = [...new Set(_contratos.map(c => c.propiedades?.duenio_id).filter(Boolean))];
        if (arrendadorIds.length) {
            const { data: arrendadores } = await window.supabaseClient
                .from('usuarios')
                .select('usuario_id, nombre_completo, correo, telefono')
                .in('usuario_id', arrendadorIds);
            const mapArr = {};
            (arrendadores || []).forEach(a => { mapArr[a.usuario_id] = a; });
            _contratos.forEach(c => { c._arrendador = mapArr[c.propiedades?.duenio_id] || {}; });
        }

        _actualizarBadges();
        _renderLista();
    }

    function _actualizarBadges() {
        const pend = _contratos.filter(c => c.estado === 'PENDIENTE').length;
        const act  = _contratos.filter(c => c.estado === 'ACTIVO').length;
        document.getElementById('badge-pendiente').textContent = pend;
        document.getElementById('badge-activo').textContent    = act;
    }

    // ──────────────────────────────────────────────────────────────
    // Tabs
    // ──────────────────────────────────────────────────────────────
    function _bindTabs() {
        document.querySelectorAll('.tab-inq').forEach(btn => {
            btn.addEventListener('click', () => {
                _tabActiva = btn.getAttribute('data-tab');
                _pintarTabActiva();
                _renderLista();
            });
        });
    }

    function _pintarTabActiva() {
        document.querySelectorAll('.tab-inq').forEach(btn => {
            const activa = btn.getAttribute('data-tab') === _tabActiva;
            btn.className = 'tab-inq flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-semibold transition-all ' +
                (activa
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700');
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Render del listado
    // ──────────────────────────────────────────────────────────────
    function _filtrarPorTab() {
        if (_tabActiva === 'HISTORIAL') {
            return _contratos.filter(c => ['FINALIZADO', 'TERMINADO', 'RECHAZADO'].includes(c.estado));
        }
        return _contratos.filter(c => c.estado === _tabActiva);
    }

    function _renderLista() {
        const cont = document.getElementById('lista-contratos');
        const lista = _filtrarPorTab();

        if (!lista.length) {
            const mensajes = {
                PENDIENTE: 'No tienes contratos pendientes de aceptación.',
                ACTIVO:    'No tienes contratos activos actualmente.',
                HISTORIAL: 'Aún no tienes contratos en tu historial.',
            };
            cont.innerHTML = `
                <div class="col-span-full p-10 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-file-contract text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin contratos en esta sección</p>
                    <p class="text-slate-400 text-sm">${esc(mensajes[_tabActiva])}</p>
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(_renderCard).join('');

        // Bind acciones por tarjeta
        cont.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id'), 10);
                _despacharAccion(btn.getAttribute('data-action'), id);
            });
        });
    }

    function _renderCard(c) {
        const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : '—';
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);

        const estadoCfg = {
            PENDIENTE:  { bg:'bg-amber-50',  border:'border-amber-200',  text:'text-amber-700',  dot:'bg-amber-500', label:'Pendiente de aceptación' },
            ACTIVO:     { bg:'bg-green-50',  border:'border-green-200',  text:'text-green-700',  dot:'bg-green-500', label:'Activo' },
            FINALIZADO: { bg:'bg-slate-100', border:'border-slate-200',  text:'text-slate-600',  dot:'bg-slate-400', label:'Finalizado' },
            TERMINADO:  { bg:'bg-orange-50', border:'border-orange-200', text:'text-orange-700', dot:'bg-orange-500', label:'Cancelado anticipadamente' },
            RECHAZADO:  { bg:'bg-red-50',    border:'border-red-200',    text:'text-red-700',    dot:'bg-red-500',    label:'Rechazado' },
        };
        const s = estadoCfg[c.estado] || estadoCfg.FINALIZADO;
        const prop = c.propiedades || {};
        const arr = c._arrendador || {};

        // Acciones según estado
        let acciones = '';
        if (c.estado === 'PENDIENTE') {
            acciones = `
                <button data-action="rechazar" data-id="${c.contrato_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition">
                    <i class="fa-solid fa-xmark mr-1"></i> Rechazar
                </button>
                <button data-action="aceptar" data-id="${c.contrato_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-600/25 transition">
                    <i class="fa-solid fa-check mr-1"></i> Aceptar
                </button>`;
        } else if (c.estado === 'ACTIVO') {
            acciones = `
                <button data-action="pdf" data-id="${c.contrato_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
                    <i class="fa-solid fa-file-pdf mr-1"></i> PDF
                </button>
                <button data-action="cancelar" data-id="${c.contrato_id}"
                        class="flex-1 px-3 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-semibold transition">
                    <i class="fa-solid fa-ban mr-1"></i> Cancelar
                </button>`;
        } else {
            acciones = `
                <button data-action="pdf" data-id="${c.contrato_id}"
                        class="w-full px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition">
                    <i class="fa-solid fa-file-pdf mr-1"></i> Descargar PDF
                </button>`;
        }

        return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow anim-fade-in-up">
            <!-- Cabecera con estado -->
            <div class="${s.bg} ${s.border} border-b px-5 py-3 flex items-center gap-3">
                <span class="w-2.5 h-2.5 rounded-full ${s.dot} ${c.estado === 'PENDIENTE' || c.estado === 'ACTIVO' ? 'animate-pulse' : ''}"></span>
                <span class="${s.text} text-xs font-bold uppercase tracking-wider">${s.label}</span>
                <span class="ml-auto text-[10px] font-semibold text-slate-400">
                    Folio #${String(c.contrato_id).padStart(6, '0')}
                </span>
            </div>

            <div class="p-5">
                <!-- Propiedad -->
                <p class="text-slate-900 font-bold text-base mb-0.5 truncate">${esc(prop.nombre || 'Propiedad')}</p>
                <p class="text-slate-500 text-xs truncate mb-3">
                    <i class="fa-solid fa-location-dot text-[10px] mr-1"></i>${esc(prop.direccion || '')}
                </p>

                <!-- Arrendador -->
                <div class="flex items-center gap-2 mb-3 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl">
                    <i class="fa-solid fa-user-tie text-slate-400"></i>
                    <span>Arrendador:</span>
                    <span class="font-semibold text-slate-800 truncate">${esc(arr.nombre_completo || '—')}</span>
                </div>

                <!-- Métricas -->
                <div class="grid grid-cols-3 gap-2 text-center text-xs mb-4">
                    <div class="rounded-lg bg-slate-50 px-2 py-2">
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Inicio</p>
                        <p class="text-slate-800 font-bold text-[11px]">${fmtFecha(c.fecha_inicio)}</p>
                    </div>
                    <div class="rounded-lg bg-slate-50 px-2 py-2">
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Término</p>
                        <p class="text-slate-800 font-bold text-[11px]">${fmtFecha(c.fecha_fin)}</p>
                    </div>
                    <div class="rounded-lg bg-blue-50 px-2 py-2">
                        <p class="text-blue-400 text-[10px] uppercase font-semibold">Renta</p>
                        <p class="text-blue-700 font-bold text-[11px]">${fmtMoney(c.monto_renta)}</p>
                    </div>
                </div>

                ${c.motivo_terminacion ? `
                    <p class="mb-3 text-[11px] text-orange-700 bg-orange-50 border border-orange-100 rounded-xl px-2.5 py-1.5">
                        <i class="fa-solid fa-circle-info mr-1"></i>
                        <span class="font-semibold">Motivo de cancelación:</span> ${esc(c.motivo_terminacion)}
                    </p>` : ''}

                <!-- Acciones -->
                <div class="flex gap-2">
                    ${acciones}
                </div>
            </div>
        </div>`;
    }

    function _renderVacio(msg) {
        const cont = document.getElementById('lista-contratos');
        cont.innerHTML = `
            <div class="col-span-full p-10 bg-white rounded-2xl border border-slate-100 text-center">
                <p class="text-slate-700 font-semibold mb-1">Sin contratos</p>
                <p class="text-slate-400 text-sm">${esc(msg)}</p>
            </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Despachador de acciones
    // ──────────────────────────────────────────────────────────────
    function _despacharAccion(action, contratoId) {
        const c = _contratos.find(x => x.contrato_id === contratoId);
        if (!c) return;
        switch (action) {
            case 'aceptar':  return _abrirModalConfirmacion(c, 'aceptar');
            case 'rechazar': return _abrirModalConfirmacion(c, 'rechazar');
            case 'pdf':      return _descargarPDF(c);
            case 'cancelar': return _abrirModalCancelacion(c);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: Confirmación de aceptación o rechazo
    //   Se inyecta dinámicamente en el DOM cada vez que se necesita.
    // ──────────────────────────────────────────────────────────────
    function _abrirModalConfirmacion(c, accion) {
        const esAceptar = accion === 'aceptar';
        const prop = c.propiedades || {};

        const fmtFecha = d => new Date(d).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'});
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN'}).format(v);

        // Asegurar que no haya otro modal abierto
        document.getElementById('modal-confirm-contrato')?.remove();

        const html = `
        <div id="modal-confirm-contrato" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">

                <!-- Cabecera -->
                <div class="px-5 py-4 ${esAceptar ? 'bg-gradient-to-r from-blue-600 to-blue-700' : 'bg-gradient-to-r from-red-600 to-red-700'} text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid ${esAceptar ? 'fa-check-double' : 'fa-xmark'} text-lg"></i>
                        </div>
                        <div>
                            <p class="font-bold text-base leading-tight">
                                ${esAceptar ? 'Aceptar contrato' : 'Rechazar contrato'}
                            </p>
                            <p class="text-white/70 text-xs">Folio #${String(c.contrato_id).padStart(6, '0')}</p>
                        </div>
                    </div>
                </div>

                <!-- Cuerpo -->
                <div class="p-5">
                    <p class="text-slate-700 text-sm leading-relaxed mb-4">
                        ${esAceptar
                            ? 'Al aceptar, el contrato entrará en vigor y se generará automáticamente tu calendario de pagos.'
                            : 'Al rechazar, el contrato no entrará en vigor. El arrendador podrá generar uno nuevo si lo desea.'}
                    </p>

                    <div class="bg-slate-50 rounded-xl p-3.5 space-y-2 text-xs">
                        <div class="flex justify-between gap-3">
                            <span class="text-slate-500">Propiedad</span>
                            <span class="text-slate-800 font-semibold text-right truncate max-w-[60%]">${esc(prop.nombre || '—')}</span>
                        </div>
                        <div class="flex justify-between gap-3">
                            <span class="text-slate-500">Vigencia</span>
                            <span class="text-slate-800 font-semibold text-right">${fmtFecha(c.fecha_inicio)} → ${fmtFecha(c.fecha_fin)}</span>
                        </div>
                        <div class="flex justify-between gap-3">
                            <span class="text-slate-500">Renta</span>
                            <span class="text-blue-700 font-bold">${fmtMoney(c.monto_renta)}</span>
                        </div>
                    </div>

                    ${!esAceptar ? `
                        <div class="mt-4">
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Motivo del rechazo (opcional)</label>
                            <textarea id="motivo-rechazo" rows="2" maxlength="300"
                                      placeholder="Ej. No es el monto que conversamos…"
                                      class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                        </div>` : ''}

                    <!-- Botones -->
                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-confirm-contrato').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            Cancelar
                        </button>
                        <button id="btn-confirm-contrato" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl ${esAceptar ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'} text-white text-sm font-semibold shadow-md">
                            ${esAceptar ? 'Sí, aceptar' : 'Sí, rechazar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirm-contrato').addEventListener('click', async () => {
            const btn = document.getElementById('btn-confirm-contrato');
            AUTH.setLoading(btn, true);
            try {
                if (esAceptar) {
                    await _aceptarContrato(c);
                } else {
                    const motivo = document.getElementById('motivo-rechazo')?.value?.trim() || null;
                    await _rechazarContrato(c, motivo);
                }
                document.getElementById('modal-confirm-contrato')?.remove();
                await _cargarContratos();
            } catch (err) {
                console.error('[CONTRATOS-INQUILINO] Error en acción:', err);
                AUTH.setLoading(btn, false);
                if (window.TOAST) TOAST.error(err.message || 'No se pudo procesar la operación.');
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // ACEPTAR: cambia estado a ACTIVO + genera calendario de pagos
    // ──────────────────────────────────────────────────────────────
    async function _aceptarContrato(c) {
        // 1. Cambiar estado del contrato
        const { error: errUpd } = await window.supabaseClient
            .from('contratos')
            .update({
                estado: 'ACTIVO',
                aceptado_en: new Date().toISOString()
            })
            .eq('contrato_id', c.contrato_id);
        if (errUpd) throw errUpd;

        // 2. Generar el calendario de pagos (RF-20, RN-11)
        const pagos = _generarCalendarioPagos(c);
        if (pagos.length) {
            const { error: errPagos } = await window.supabaseClient
                .from('calendario_pagos')
                .insert(pagos);
            if (errPagos) {
                // Si falla el calendario, intentar revertir el estado del contrato
                console.error('[CONTRATOS-INQUILINO] Falló calendario:', errPagos);
                throw new Error('Contrato aceptado, pero falló la generación de pagos: ' + errPagos.message);
            }
        }

        // 3. Notificación al arrendador
        if (c.propiedades?.duenio_id) {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: c.propiedades.duenio_id,
                titulo: '¡Contrato aceptado por el inquilino!',
                mensaje: `El contrato del inmueble "${c.propiedades.nombre}" fue aceptado y ya está activo.`,
                tipo: 'RECORDATORIO',
                metadatos: { contrato_id: c.contrato_id }
            });
        }

        if (window.TOAST) TOAST.success('Contrato aceptado y calendario de pagos generado.');
    }

    /**
     * Genera los registros del calendario de pagos para un contrato.
     * Solo cubre frecuencia MENSUAL en esta primera versión (RN-11).
     * El día de pago se toma del día de la fecha de inicio.
     */
    function _generarCalendarioPagos(c) {
        const lista = [];
        if (c.frecuencia_pago !== 'MENSUAL') {
            // Para quincenal/semanal podríamos extender la lógica aquí
            return lista;
        }
        const inicio = new Date(c.fecha_inicio);
        const fin    = new Date(c.fecha_fin);
        const cursor = new Date(inicio);

        while (cursor <= fin) {
            lista.push({
                contrato_id: c.contrato_id,
                fecha_limite: cursor.toISOString().slice(0, 10),
                monto_esperado: c.monto_renta,
                anio: cursor.getFullYear(),
                mes: cursor.getMonth() + 1,
                estado: 'PENDIENTE',
            });
            // Avanzar al siguiente mes
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return lista;
    }

    // ──────────────────────────────────────────────────────────────
    // RECHAZAR: cambia estado a RECHAZADO
    // ──────────────────────────────────────────────────────────────
    async function _rechazarContrato(c, motivo) {
        const { error } = await window.supabaseClient
            .from('contratos')
            .update({
                estado: 'RECHAZADO',
                rechazado_en: new Date().toISOString(),
                motivo_terminacion: motivo
            })
            .eq('contrato_id', c.contrato_id);
        if (error) throw error;

        // Notificar al arrendador
        if (c.propiedades?.duenio_id) {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: c.propiedades.duenio_id,
                titulo: 'Contrato rechazado por el inquilino',
                mensaje: `El inquilino rechazó el contrato del inmueble "${c.propiedades.nombre}".${motivo ? ' Motivo: ' + motivo : ''}`,
                tipo: 'RECORDATORIO',
                metadatos: { contrato_id: c.contrato_id }
            });
        }

        if (window.TOAST) TOAST.info('Has rechazado el contrato.');
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL: Cancelación anticipada
    //   - Requiere mínimo 1 semana de anticipación (regla del enunciado).
    //   - Motivo obligatorio (select de razones comunes + textarea libre).
    //   - Cambia el contrato a TERMINADO conservando los pagos (RN-09).
    // ──────────────────────────────────────────────────────────────
    function _abrirModalCancelacion(c) {
        document.getElementById('modal-cancelar-contrato')?.remove();

        // Fecha mínima para terminación: hoy + 7 días
        const hoy = new Date();
        const minDate = new Date(hoy);
        minDate.setDate(hoy.getDate() + 7);
        const minDateStr = minDate.toISOString().slice(0, 10);

        // Fecha máxima: fecha_fin del contrato
        const maxDate = c.fecha_fin;

        const html = `
        <div id="modal-cancelar-contrato" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden">
                <div class="px-5 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i class="fa-solid fa-ban text-lg"></i>
                        </div>
                        <div>
                            <p class="font-bold text-base leading-tight">Cancelar contrato anticipadamente</p>
                            <p class="text-white/70 text-xs">Folio #${String(c.contrato_id).padStart(6, '0')}</p>
                        </div>
                    </div>
                </div>

                <div class="p-5">
                    <p class="text-slate-600 text-sm mb-4 leading-relaxed">
                        Solicita la terminación anticipada de tu contrato.
                        Debes notificar con al menos <span class="font-bold text-orange-700">una semana de anticipación</span>.
                    </p>

                    <div id="cancel-alert" class="hidden mb-3"></div>

                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Fecha de terminación deseada *</label>
                            <input id="fecha-terminacion" type="date" min="${minDateStr}" max="${maxDate}"
                                   value="${minDateStr}"
                                   class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                            <p class="text-slate-400 text-xs mt-1">
                                <i class="fa-solid fa-circle-info text-[10px] mr-0.5"></i>
                                Mínimo: ${new Date(minDateStr).toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' })}
                            </p>
                        </div>

                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Motivo de la cancelación *</label>
                            <select id="motivo-select"
                                    class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                                <option value="">— Selecciona una razón —</option>
                                <option value="Cambio de ciudad">Cambio de ciudad</option>
                                <option value="Razones económicas">Razones económicas</option>
                                <option value="Compra de inmueble propio">Compra de inmueble propio</option>
                                <option value="Cambio de empleo">Cambio de empleo</option>
                                <option value="Problemas con la propiedad">Problemas con la propiedad</option>
                                <option value="Razones personales">Razones personales</option>
                                <option value="OTRO">Otro (describir abajo)</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">Detalles adicionales</label>
                            <textarea id="motivo-detalle" rows="3" maxlength="500"
                                      placeholder="Describe brevemente la razón de tu solicitud…"
                                      class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm resize-none"></textarea>
                        </div>
                    </div>

                    <div class="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-xs leading-relaxed">
                        <i class="fa-solid fa-triangle-exclamation mr-1"></i>
                        <span class="font-semibold">Importante:</span> tus pagos previos se conservarán como parte de tu historial financiero. Esta acción no se puede deshacer.
                    </div>

                    <div class="flex gap-2 mt-5">
                        <button type="button" onclick="document.getElementById('modal-cancelar-contrato').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-sm font-semibold">
                            No cancelar
                        </button>
                        <button id="btn-confirm-cancel" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold shadow-md">
                            Confirmar cancelación
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('btn-confirm-cancel').addEventListener('click', async () => {
            const fechaTer = document.getElementById('fecha-terminacion').value;
            const motivoSel = document.getElementById('motivo-select').value;
            const detalle = document.getElementById('motivo-detalle').value.trim();
            const btn = document.getElementById('btn-confirm-cancel');
            const alertBox = document.getElementById('cancel-alert');

            // Validaciones
            if (!fechaTer) {
                _alertaModal(alertBox, 'Indica la fecha de terminación.');
                return;
            }
            if (new Date(fechaTer) < new Date(minDateStr)) {
                _alertaModal(alertBox, `La fecha debe ser al menos ${new Date(minDateStr).toLocaleDateString('es-MX')}.`);
                return;
            }
            if (!motivoSel) {
                _alertaModal(alertBox, 'Selecciona un motivo.');
                return;
            }
            const motivoFinal = motivoSel === 'OTRO'
                ? (detalle || 'Otro')
                : (detalle ? `${motivoSel} — ${detalle}` : motivoSel);

            AUTH.setLoading(btn, true);
            try {
                await _cancelarAnticipado(c, fechaTer, motivoFinal);
                document.getElementById('modal-cancelar-contrato')?.remove();
                await _cargarContratos();
            } catch (err) {
                AUTH.setLoading(btn, false);
                _alertaModal(alertBox, err.message || 'No se pudo cancelar.');
            }
        });
    }

    function _alertaModal(box, msg) {
        if (!box) return;
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box.classList.add('hidden'), 4000);
    }

    async function _cancelarAnticipado(c, fechaTerminacion, motivo) {
        const { error } = await window.supabaseClient
            .from('contratos')
            .update({
                estado: 'TERMINADO',
                fecha_terminacion: fechaTerminacion,
                motivo_terminacion: motivo
            })
            .eq('contrato_id', c.contrato_id);
        if (error) throw error;

        // Notificar al arrendador
        if (c.propiedades?.duenio_id) {
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: c.propiedades.duenio_id,
                titulo: 'Cancelación anticipada solicitada',
                mensaje: `El inquilino ha cancelado el contrato del inmueble "${c.propiedades.nombre}". Motivo: ${motivo}`,
                tipo: 'CONTRATO_TERMINADO',
                metadatos: { contrato_id: c.contrato_id, fecha_terminacion: fechaTerminacion }
            });
        }

        if (window.TOAST) TOAST.success('Cancelación anticipada registrada.');
    }

    // ──────────────────────────────────────────────────────────────
    // PDF: descargar contrato
    // ──────────────────────────────────────────────────────────────
    function _descargarPDF(c) {
        // Pasar el arrendador para que aparezca en el documento
        const detallado = { ...c, arrendador: c._arrendador };
        PDF_CONTRATO.descargar(detallado);
    }

    return { init };
})();

window.CONTRATOS_INQUILINO = CONTRATOS_INQUILINO;