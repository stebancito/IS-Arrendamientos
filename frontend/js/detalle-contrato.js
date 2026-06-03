// ================================================================
// detalle-contrato.js  –  Vista detalle de un contrato (Arrendador)
// ================================================================
// Responsabilidades:
//   - RF-17/18 : Mostrar el detalle completo de un contrato con sus
//                partes (inquilino, propiedad, arrendador) y estadísticas
//                de pagos en tiempo real.
//   - RF-19    : Terminar anticipadamente (ACTIVO → TERMINADO) o
//                retirar una oferta (PENDIENTE → TERMINADO) mediante
//                un modal dinámico inyectado en el DOM.
//   - RN-08    : Si el contrato está ACTIVO no se ofrecen ni se renderizan
//                controles para modificar monto, fechas ni frecuencia.
//   - RN-09    : La terminación es siempre un UPDATE de estado a 'TERMINADO'.
//                NUNCA se ejecuta un DELETE. El historial de pagos y el
//                propio contrato se conservan íntegros.
//   - PDF      : Delega en PDF_CONTRATO.descargar() (jsPDF via CDN).
//
// URL requerida: detalle-contrato.html?contratoId=N
//
// Dependencias (cargadas antes en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js · pdf-contrato.js
// ================================================================

const DETALLE_CONTRATO = (() => {

    // ── Estado del módulo ──────────────────────────────────────────
    let _usuario  = null;   // Perfil del arrendador autenticado
    let _contrato = null;   // Objeto enriquecido con arrendador + _stats

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: INIT
    //   Punto de entrada llamado desde el bloque <script> del HTML.
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        const params      = new URLSearchParams(window.location.search);
        const contratoId  = parseInt(params.get('contratoId'), 10);

        if (!contratoId || isNaN(contratoId)) {
            _renderError('No se especificó un contrato válido en la URL.');
            return;
        }

        await _cargarContrato(contratoId);
    }

    // ──────────────────────────────────────────────────────────────
    // PASO 1: Consulta principal a Supabase
    //   JOIN: contratos → propiedades → usuarios (arrendador)
    //                    → inquilinos  → usuarios (inquilino)
    // ──────────────────────────────────────────────────────────────
    async function _cargarContrato(contratoId) {
        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id,
                fecha_inicio,
                fecha_fin,
                fecha_terminacion,
                monto_renta,
                frecuencia_pago,
                estado,
                observaciones,
                beneficios,
                aceptado_en,
                rechazado_en,
                motivo_terminacion,
                creado_en,
                propiedades (
                    propiedad_id,
                    nombre,
                    direccion,
                    tipo_propiedad,
                    descripcion,
                    duenio_id
                ),
                inquilinos (
                    inquilino_id,
                    usuarios (
                        usuario_id,
                        nombre_completo,
                        correo,
                        telefono
                    )
                )
            `)
            .eq('contrato_id', contratoId)
            .single();

        if (error || !data) {
            console.error('[DETALLE-CONTRATO] Error al cargar:', error);
            _renderError('No se encontró el contrato solicitado o la conexión falló.');
            return;
        }

        // ── Guardia de seguridad: el contrato debe pertenecer al arrendador ──
        // Comprobamos que el duenio_id de la propiedad coincida con el usuario
        // autenticado. Si no, mostramos un error genérico (sin revelar datos).
        if (data.propiedades?.duenio_id !== _usuario.usuario_id) {
            _renderError('No tienes permiso para ver este contrato.');
            return;
        }

        // ── Enriquecer con los datos del arrendador (el propio usuario) ──
        // Evitamos una segunda consulta reutilizando el perfil en memoria.
        data.arrendador = {
            nombre_completo : _usuario.nombre_completo,
            correo          : _usuario.correo,
            telefono        : _usuario.telefono,
        };

        // ── Cargar estadísticas de pagos del contrato ──
        data._stats = await _cargarStatsPagos(contratoId);

        _contrato = data;
        _renderDetalle(data);
    }

    // ──────────────────────────────────────────────────────────────
    // PASO 2: Consulta de estadísticas del calendario de pagos
    // ──────────────────────────────────────────────────────────────
    async function _cargarStatsPagos(contratoId) {
        const { data: pagos } = await window.supabaseClient
            .from('calendario_pagos')
            .select('calendario_id, estado, fecha_limite, monto_esperado')
            .eq('contrato_id', contratoId)
            .order('fecha_limite', { ascending: true });

        const lista      = pagos || [];
        const total      = lista.length;
        const pagados    = lista.filter(p => p.estado === 'PAGADO').length;
        const vencidos   = lista.filter(p => p.estado === 'VENCIDO').length;
        const pendientes = lista.filter(p => p.estado === 'PENDIENTE').length;
        const cumplimiento = total > 0 ? Math.round((pagados / total) * 100) : null;

        return { total, pagados, vencidos, pendientes, cumplimiento, lista };
    }

    // ──────────────────────────────────────────────────────────────
    // PASO 3: Poblar todos los elementos del DOM
    // ──────────────────────────────────────────────────────────────
    function _renderDetalle(c) {
        // ── Helpers de formato ─────────────────────────────────────
        const fmtFecha = d => d
            ? new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' })
            : '—';

        const fmtMoney = v => new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', minimumFractionDigits: 2
        }).format(v);

        const FRECUENCIA_LBL = { MENSUAL:'Mensual', QUINCENAL:'Quincenal', SEMANAL:'Semanal' };
        const TIPO_LBL = {
            EDIFICIO:'Edificio', DEPARTAMENTO:'Departamento',
            CASA:'Casa', LOCAL:'Local Comercial', TERRENO:'Terreno'
        };

        const prop   = c.propiedades || {};
        const inqUsr = c.inquilinos?.usuarios || {};

        // ── 1. Resetear bloques condicionales (necesario en re-renders) ──
        ['aviso-pendiente', 'bloque-progreso', 'bloque-cancelacion', 'bloque-pagos']
            .forEach(id => document.getElementById(id)?.classList.add('hidden'));

        // ── 2. Cabecera ────────────────────────────────────────────
        _set('folio-titulo',    `#${String(c.contrato_id).padStart(6, '0')}`);
        _set('estado-subtitle', _estadoLabel(c.estado));

        // ── 3. Condiciones financieras ─────────────────────────────
        _set('d-monto',      fmtMoney(c.monto_renta));
        _set('d-frecuencia', FRECUENCIA_LBL[c.frecuencia_pago] || c.frecuencia_pago);
        _set('d-inicio',     fmtFecha(c.fecha_inicio));
        _set('d-fin',        fmtFecha(c.fecha_fin));

        // ── 4. Barra de progreso (solo para contratos ACTIVOS) ─────
        //   RN-08 implícito: no mostrar acciones de edición en contratos
        //   activos, pero sí informar visualmente el avance.
        if (c.estado === 'ACTIVO') {
            const ini   = new Date(c.fecha_inicio);
            const fin   = new Date(c.fecha_fin);
            const total = fin - ini;
            const trans = Math.min(Math.max(Date.now() - ini, 0), total);
            const pct   = total > 0 ? Math.round((trans / total) * 100) : 0;

            _show('bloque-progreso');
            _set('d-progreso-pct', `${pct}%`);
            // Usar setTimeout para que el CSS transition funcione correctamente
            setTimeout(() => {
                const bar = document.getElementById('d-progreso-bar');
                if (bar) bar.style.width = `${pct}%`;
            }, 80);
        }

        // ── 5. Inmueble ────────────────────────────────────────────
        _set('d-prop-nombre',    prop.nombre       || '—');
        _set('d-prop-direccion', prop.direccion    || '—');
        _set('d-prop-tipo',      TIPO_LBL[prop.tipo_propiedad] || prop.tipo_propiedad || '—');

        // ── 6. Inquilino ───────────────────────────────────────────
        const iniciales = (inqUsr.nombre_completo || '?')
            .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        _set('d-inq-avatar', iniciales);
        _set('d-inq-nombre', inqUsr.nombre_completo || '—');

        // correo y tel tienen un <span> anidado junto a un <i> de FontAwesome;
        // usamos querySelector para no destruir el ícono al asignar textContent.
        const correoSpan = document.querySelector('#d-inq-correo span');
        const telSpan    = document.querySelector('#d-inq-tel span');
        if (correoSpan) correoSpan.textContent = inqUsr.correo   || '—';
        if (telSpan)    telSpan.textContent    = inqUsr.telefono || 'No registrado';

        // ── 7. Beneficios y observaciones ─────────────────────────
        _set('d-beneficios',    c.beneficios    || 'Sin beneficios adicionales especificados.');
        _set('d-observaciones', c.observaciones || 'Sin observaciones particulares.');

        // ── 8. Avisos condicionales por estado ─────────────────────
        if (c.estado === 'PENDIENTE') {
            _show('aviso-pendiente');
        }

        if (c.estado === 'TERMINADO' && c.fecha_terminacion) {
            _show('bloque-cancelacion');
            _set('d-fecha-terminacion',
                `Fecha de terminación registrada: ${fmtFecha(c.fecha_terminacion)}`);
            _set('d-motivo-cancel', c.motivo_terminacion || 'No especificado');
        }

        // ── 9. Banner lateral de estado ────────────────────────────
        _renderBannerEstado(c);

        // ── 10. Estadísticas de pagos (visible si hay pagos) ───────
        if (c._stats?.total > 0) {
            _show('bloque-pagos');
            _set('pagos-total',    c._stats.total);
            _set('pagos-pagados',  c._stats.pagados);
            _set('pagos-vencidos', c._stats.vencidos);
        }

        // ── 11. Botones de acción según el estado del contrato ─────
        _renderAcciones(c);

        // ── 12. Botón de descarga de PDF ───────────────────────────
        // Usamos .onclick (no addEventListener) para que los re-renders
        // no acumulen múltiples listeners sobre el mismo elemento.
        const btnPdf = document.getElementById('btn-pdf');
        if (btnPdf) {
            btnPdf.onclick = () => PDF_CONTRATO.descargar(c);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Banner lateral: color e información resumen del estado
    // ──────────────────────────────────────────────────────────────
    function _renderBannerEstado(c) {
        const CFG = {
            PENDIENTE:  { label:'Pendiente',  desc:'Esperando aceptación del inquilino. Aún no está en vigor.' },
            ACTIVO:     { label:'Activo',     desc:'Contrato en vigor y con calendario de pagos generado.' },
            FINALIZADO: { label:'Finalizado', desc:'El contrato llegó a su término natural.' },
            TERMINADO:  { label:'Cancelado',  desc:'El contrato fue terminado anticipadamente.' },
            RECHAZADO:  { label:'Rechazado',  desc:'El inquilino rechazó esta oferta de contrato.' },
        };
        const cfg = CFG[c.estado] || { label: c.estado, desc: '' };
        _set('banner-estado-label', cfg.label);
        _set('banner-estado-desc',  cfg.desc);
    }

    // ──────────────────────────────────────────────────────────────
    // Acciones dinámicas por estado del contrato
    //
    //   RN-08 aplicado:  cuando el estado es ACTIVO solo se ofrecen
    //   acciones operativas (registrar pago, terminar). NO hay ningún
    //   control para editar monto, fechas o frecuencia de pago. Un
    //   aviso explícito informa al arrendador sobre esta restricción.
    //
    //   RN-09 aplicado: el botón de terminación llama a _abrirModalTerminacion
    //   que internamente hace un UPDATE; nunca un DELETE.
    // ──────────────────────────────────────────────────────────────
    function _renderAcciones(c) {
        const cont = document.getElementById('acciones-container');
        if (!cont) return;

        let html = '';

        switch (c.estado) {

            // ── Contrato pendiente: el arrendador puede retirar la oferta ──
            case 'PENDIENTE':
                html = `
                    <button id="btn-retirar-oferta"
                            class="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl
                                   bg-orange-50 hover:bg-orange-100 text-orange-700
                                   text-sm font-semibold transition border border-orange-100">
                        <i class="fa-solid fa-ban w-4 text-center"></i>
                        Retirar oferta de contrato
                    </button>
                    <p class="text-slate-400 text-[11px] leading-relaxed mt-2">
                        Si retiras la oferta, el contrato pasará a estado "Cancelado" y el
                        inquilino ya no podrá aceptarla.
                    </p>`;
                break;

            // ── Contrato activo: RN-08 aplica; solo acciones operativas ──
            case 'ACTIVO':
                html = `
                    <!-- Aviso RN-08: ningún control de edición de condiciones -->
                    <div class="flex items-start gap-2 text-[11px] text-blue-800 bg-blue-50
                                border border-blue-100 rounded-xl px-3 py-2.5 mb-3">
                        <i class="fa-solid fa-lock mt-0.5 flex-shrink-0"></i>
                        <span>
                            <strong>RN-08:</strong> Las condiciones financieras de un contrato
                            activo <strong>no son modificables</strong>. Para cambiar monto o
                            fechas, termina el actual y crea uno nuevo.
                        </span>
                    </div>

                    <a href="pagos.html?contratoId=${esc(String(c.contrato_id))}"
                       class="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl
                              bg-blue-50 hover:bg-blue-100 text-blue-700
                              text-sm font-semibold transition border border-blue-100">
                        <i class="fa-solid fa-money-bill-wave w-4 text-center"></i>
                        Registrar pago recibido
                    </a>

                    <button id="btn-terminar-activo"
                            class="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl mt-2
                                   bg-red-50 hover:bg-red-100 text-red-700
                                   text-sm font-semibold transition border border-red-100">
                        <i class="fa-solid fa-file-circle-xmark w-4 text-center"></i>
                        Terminar anticipadamente
                    </button>

                    <p class="text-slate-400 text-[11px] leading-relaxed mt-2">
                        El historial de pagos y el contrato se conservarán íntegros (RN-09).
                    </p>`;
                break;

            // ── Contrato rechazado: opción de crear uno nuevo ──
            case 'RECHAZADO':
                html = `
                    <a href="nuevo-contrato.html?propiedadId=${esc(String(c.propiedades?.propiedad_id || ''))}"
                       class="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl
                              bg-blue-600 hover:bg-blue-700 text-white
                              text-sm font-semibold shadow-sm shadow-blue-600/25 transition">
                        <i class="fa-solid fa-file-circle-plus w-4 text-center"></i>
                        Crear nueva oferta de contrato
                    </a>
                    <p class="text-slate-400 text-[11px] leading-relaxed mt-2">
                        El inquilino rechazó la propuesta anterior. Puedes crear una nueva
                        oferta para la misma propiedad.
                    </p>`;
                break;

            // ── Contratos cerrados (FINALIZADO / TERMINADO): solo navegación ──
            case 'FINALIZADO':
            case 'TERMINADO':
            default:
                html = `
                    <div class="py-3 text-center">
                        <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2">
                            <i class="fa-solid fa-circle-check text-slate-400"></i>
                        </div>
                        <p class="text-slate-500 text-xs">Este contrato ya no tiene acciones disponibles.</p>
                    </div>
                    <a href="gestion-contratos.html"
                       class="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl mt-1
                              bg-slate-100 hover:bg-slate-200 text-slate-700
                              text-sm font-semibold transition">
                        <i class="fa-solid fa-arrow-left w-4 text-center"></i>
                        Volver a contratos
                    </a>`;
                break;
        }

        cont.innerHTML = html;

        // Bind de botones que acaban de inyectarse
        document.getElementById('btn-retirar-oferta')?.addEventListener('click', () => {
            _abrirModalTerminacion(c, 'retirar');
        });

        document.getElementById('btn-terminar-activo')?.addEventListener('click', () => {
            _abrirModalTerminacion(c, 'terminar');
        });
    }

    // ──────────────────────────────────────────────────────────────
    // MODAL DINÁMICO: Retirar oferta  /  Terminar anticipadamente
    //
    //   El modal se inyecta en el DOM en tiempo de ejecución para no
    //   contaminar el HTML estático (patrón del proyecto).
    //
    //   El modal de terminación anticipada:
    //   - Solicita MOTIVO (select + campo libre).
    //   - Solicita FECHA efectiva de terminación (mín. 7 días desde hoy,
    //     máx. la fecha_fin original del contrato).
    //   - Al confirmar llama a _terminarContrato() que hace un UPDATE.
    //
    //   RN-09 garantizado:
    //   - _terminarContrato solo actualiza el campo `estado` y meta-datos
    //     de terminación; nunca ejecuta un DELETE sobre contratos ni pagos.
    // ──────────────────────────────────────────────────────────────
    function _abrirModalTerminacion(c, tipo) {
        // Limpiar modal previo si existe
        document.getElementById('modal-terminacion-contrato')?.remove();

        const esRetirar  = tipo === 'retirar';
        const propNombre = esc(c.propiedades?.nombre || 'la propiedad');
        const inqNombre  = esc(c.inquilinos?.usuarios?.nombre_completo || 'el inquilino');

        // Estilos dinámicos según tipo de acción
        const colorHeader = esRetirar
            ? 'from-orange-500 to-orange-600'
            : 'from-red-600 to-red-700';
        const colorBtn    = esRetirar
            ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-600/20'
            : 'bg-red-600 hover:bg-red-700 shadow-red-600/20';
        const icono       = esRetirar ? 'fa-ban' : 'fa-file-circle-xmark';
        const titulo      = esRetirar
            ? 'Retirar oferta de contrato'
            : 'Terminar contrato anticipadamente';
        const descripcion = esRetirar
            ? `¿Confirmas que deseas retirar la oferta para <strong>${propNombre}</strong>? El inquilino ya no podrá aceptarla.`
            : `¿Confirmas la terminación anticipada del contrato de <strong>${inqNombre}</strong> en <strong>${propNombre}</strong>? El historial de pagos se conservará.`;

        // Fecha mínima de terminación: hoy + 7 días
        const hoy         = new Date();
        const minDate     = new Date(hoy);
        minDate.setDate(hoy.getDate() + 7);
        const minDateStr  = minDate.toISOString().slice(0, 10);
        const maxDateStr  = c.fecha_fin;
        const minDateHum  = minDate.toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' });

        // Motivos disponibles según el tipo de acción
        const motivosRetirar = [
            'Error en las condiciones del contrato',
            'Propiedad ya no disponible',
            'El inquilino no cumplió requisitos previos',
            'Decisión administrativa',
        ];
        const motivosTerminar = [
            'Incumplimiento reiterado de pagos',
            'Daños graves a la propiedad',
            'Venta de la propiedad',
            'Acuerdo mutuo con el inquilino',
            'Uso inadecuado del inmueble',
        ];
        const motivosOpts = (esRetirar ? motivosRetirar : motivosTerminar)
            .map(m => `<option value="${esc(m)}">${esc(m)}</option>`)
            .join('');

        // Bloque de fecha (solo para terminación anticipada, no para retirar)
        const campoFecha = !esRetirar ? `
            <div>
                <label class="block text-xs font-medium text-slate-600 mb-1.5">
                    Fecha efectiva de terminación *
                </label>
                <input id="term-fecha" type="date"
                       min="${esc(minDateStr)}" max="${esc(maxDateStr)}" value="${esc(minDateStr)}"
                       class="input-brand w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm" />
                <p class="text-slate-400 text-xs mt-1.5">
                    <i class="fa-solid fa-circle-info text-[10px] mr-1"></i>
                    Mínimo <strong>${esc(minDateHum)}</strong> (7 días de anticipación).
                </p>
            </div>` : '';

        const modalHTML = `
        <div id="modal-terminacion-contrato"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl
                        shadow-2xl overflow-hidden">

                <!-- Cabecera del modal -->
                <div class="px-5 py-4 bg-gradient-to-r ${colorHeader} text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur
                                    flex items-center justify-center flex-shrink-0">
                            <i class="fa-solid ${icono} text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <p class="font-bold text-base leading-tight">${esc(titulo)}</p>
                            <p class="text-white/70 text-xs">
                                Folio #${String(c.contrato_id).padStart(6, '0')}
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Cuerpo del modal -->
                <div class="p-5">

                    <!-- Alerta de validación inline (hidden por defecto) -->
                    <div id="term-alert" class="hidden mb-3"></div>

                    <p class="text-slate-700 text-sm leading-relaxed mb-4">${descripcion}</p>

                    <div class="space-y-3">

                        <!-- Motivo (select) -->
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">
                                Motivo *
                            </label>
                            <select id="term-motivo-select"
                                    class="input-brand w-full px-3 py-2 rounded-xl
                                           border border-slate-200 bg-slate-50 text-sm">
                                <option value="">— Selecciona una razón —</option>
                                ${motivosOpts}
                                <option value="OTRO">Otro (especificar abajo)</option>
                            </select>
                        </div>

                        <!-- Detalle libre -->
                        <div>
                            <label class="block text-xs font-medium text-slate-600 mb-1.5">
                                Detalles adicionales
                            </label>
                            <textarea id="term-motivo-detalle" rows="2" maxlength="400"
                                      placeholder="Descripción complementaria (opcional)…"
                                      class="input-brand w-full px-3 py-2 rounded-xl border
                                             border-slate-200 bg-slate-50 text-sm resize-none">
                            </textarea>
                        </div>

                        <!-- Fecha de terminación (solo si NO es retirar oferta) -->
                        ${campoFecha}

                    </div>

                    <!-- Aviso RN-09 -->
                    <div class="mt-4 flex items-start gap-2 p-3 bg-amber-50 border
                                border-amber-100 rounded-xl text-amber-800 text-xs leading-relaxed">
                        <i class="fa-solid fa-triangle-exclamation flex-shrink-0 mt-0.5"></i>
                        <span>
                            <strong>RN-09:</strong> El contrato y todos sus registros de pago
                            <strong>se conservarán como historial</strong>. Solo cambiará el
                            estado a "Cancelado". Esta acción no se puede deshacer.
                        </span>
                    </div>

                    <!-- Botones de acción -->
                    <div class="flex gap-2 mt-5">
                        <button type="button"
                                onclick="document.getElementById('modal-terminacion-contrato').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700
                                       hover:bg-slate-100 text-sm font-semibold transition">
                            No, volver
                        </button>
                        <button id="btn-confirm-terminacion" type="button"
                                class="flex-1 px-4 py-2.5 rounded-xl ${colorBtn}
                                       text-white text-sm font-semibold shadow-md transition">
                            ${esRetirar ? 'Sí, retirar oferta' : 'Sí, terminar contrato'}
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // ── Bind del botón de confirmación ─────────────────────────
        document.getElementById('btn-confirm-terminacion').addEventListener('click', async () => {
            const btn           = document.getElementById('btn-confirm-terminacion');
            const alertBox      = document.getElementById('term-alert');
            const motivoSel     = document.getElementById('term-motivo-select')?.value   || '';
            const motivoDetalle = document.getElementById('term-motivo-detalle')?.value.trim() || '';

            // ── Validaciones del formulario ─────────────────────────
            if (!motivoSel) {
                _alertaModal(alertBox, 'Debes seleccionar un motivo para continuar.');
                return;
            }

            let fechaTerminacion = null;
            if (!esRetirar) {
                fechaTerminacion = document.getElementById('term-fecha')?.value || '';
                if (!fechaTerminacion) {
                    _alertaModal(alertBox, 'Indica la fecha efectiva de terminación.');
                    return;
                }
                if (new Date(fechaTerminacion) < new Date(minDateStr)) {
                    _alertaModal(alertBox,
                        `La fecha debe ser mínimo ${minDateHum} (7 días de anticipación).`);
                    return;
                }
                if (c.fecha_fin && new Date(fechaTerminacion) > new Date(c.fecha_fin)) {
                    _alertaModal(alertBox, 'La fecha de terminación no puede ser posterior al vencimiento del contrato.');
                    return;
                }
            }

            // Construir el texto final del motivo
            const motivoFinal = motivoSel === 'OTRO'
                ? (motivoDetalle || 'Otro motivo no especificado')
                : (motivoDetalle ? `${motivoSel} — ${motivoDetalle}` : motivoSel);

            // ── Ejecutar la actualización ───────────────────────────
            if (window.AUTH?.setLoading) AUTH.setLoading(btn, true);
            try {
                await _terminarContrato(c, motivoFinal, fechaTerminacion);
                document.getElementById('modal-terminacion-contrato')?.remove();
                // Recargar la pantalla para reflejar el nuevo estado
                await _cargarContrato(c.contrato_id);
            } catch (err) {
                if (window.AUTH?.setLoading) AUTH.setLoading(btn, false);
                _alertaModal(alertBox, err.message || 'No se pudo realizar la operación. Intenta de nuevo.');
                console.error('[DETALLE-CONTRATO] Error en terminación:', err);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // UPDATE: cambiar estado a TERMINADO (arrendador)
    //
    //   RN-09 ESTRICTO: Solo se ejecuta un UPDATE sobre la fila del
    //   contrato. Nunca se eliminan registros de pagos ni el contrato.
    //   El campo `motivo_terminacion` y `fecha_terminacion` quedan
    //   persistidos en la BD como evidencia auditada.
    // ──────────────────────────────────────────────────────────────
    async function _terminarContrato(c, motivo, fechaTerminacion) {
        // Construir payload base
        const payload = {
            estado             : 'TERMINADO',
            motivo_terminacion : motivo,
        };
        // Agregar fecha_terminacion solo si se especificó (no aplica en retiro de oferta)
        if (fechaTerminacion) {
            payload.fecha_terminacion = fechaTerminacion;
        }

        // ── UPDATE principal: solo cambia estado y metadatos ───────
        const { error } = await window.supabaseClient
            .from('contratos')
            .update(payload)
            .eq('contrato_id', c.contrato_id);

        if (error) {
            throw new Error(`Error al actualizar el contrato: ${error.message}`);
        }

        // ── Notificación interna al inquilino ──────────────────────
        const inqUsuarioId = c.inquilinos?.usuarios?.usuario_id;
        if (inqUsuarioId) {
            const propNombre = c.propiedades?.nombre || 'la propiedad';
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id : inqUsuarioId,
                titulo     : 'Tu contrato ha sido terminado por el arrendador',
                mensaje    : `El arrendador ha dado por terminado el contrato del inmueble "${propNombre}". Motivo: ${motivo}`,
                tipo       : 'CONTRATO_TERMINADO',
                metadatos  : {
                    contrato_id       : c.contrato_id,
                    fecha_terminacion : fechaTerminacion || null,
                }
            });
        }

        if (window.TOAST) {
            TOAST.success('Contrato terminado. El historial se conserva íntegro (RN-09).');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de UI
    // ──────────────────────────────────────────────────────────────

    /** Asigna textContent a un elemento por su id. No-op si no existe. */
    function _set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value ?? '—');
    }

    /** Elimina la clase 'hidden' de un elemento por su id. */
    function _show(id) {
        document.getElementById(id)?.classList.remove('hidden');
    }

    /** Texto legible para cada estado del contrato. */
    function _estadoLabel(estado) {
        const LABELS = {
            PENDIENTE  : 'Pendiente de aceptación por el inquilino',
            ACTIVO     : 'Contrato activo y en vigor',
            FINALIZADO : 'Contrato finalizado (término natural)',
            TERMINADO  : 'Contrato terminado anticipadamente',
            RECHAZADO  : 'Contrato rechazado por el inquilino',
        };
        return LABELS[estado] || estado;
    }

    /**
     * Muestra un mensaje de error inline dentro de un modal.
     * El mensaje desaparece automáticamente a los 4 s.
     */
    function _alertaModal(box, msg) {
        if (!box) return;
        box.className = 'mb-3 px-3 py-2 rounded-xl text-xs font-medium ' +
                        'bg-red-50 border border-red-200 text-red-700';
        box.textContent = msg;
        box.classList.remove('hidden');
        setTimeout(() => box.classList.add('hidden'), 4000);
    }

    /**
     * Reemplaza el contenido de #main-content con un mensaje de error.
     * Se llama cuando el contratoId es inválido o el arrendador no tiene
     * permiso para ver el contrato.
     */
    function _renderError(msg) {
        const main = document.getElementById('main-content');
        if (!main) return;
        main.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-center px-4">
                <div class="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4 border border-red-100">
                    <i class="fa-solid fa-triangle-exclamation text-red-500 text-2xl"></i>
                </div>
                <p class="text-slate-900 font-bold text-lg mb-1">Error al cargar el contrato</p>
                <p class="text-slate-500 text-sm mb-6 max-w-sm">${esc(msg)}</p>
                <a href="gestion-contratos.html"
                   class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl
                          bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold
                          shadow-md shadow-blue-600/25 transition">
                    <i class="fa-solid fa-arrow-left"></i>
                    Volver a contratos
                </a>
            </div>`;
    }

    // ── API pública del módulo ─────────────────────────────────────
    return { init };

})();

// Exponer globalmente (patrón del proyecto)
window.DETALLE_CONTRATO = DETALLE_CONTRATO;