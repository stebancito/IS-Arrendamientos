// ================================================================
// inquilinos-edificio.js  –  Módulo Dev 5 (Evaluación de Inquilinos)
// ================================================================
// Responsabilidades:
//   - RF-31    : Calcular porcentaje de pagos a tiempo por inquilino.
//   - RF-32    : Histórico de pagos vencidos por inquilino.
//   - RF-33    : Generar calificación/semáforo de confianza.
//   - RN-18    : Solo contratos ACTIVO / FINALIZADO / TERMINADO.
//   - RN-19    : Evaluación solo si hay al menos 1 pago PAGADO o VENCIDO.
//
// Consume la función RPC de Supabase:
//   obtener_evaluaciones_inquilinos_arrendador(p_duenio_id)
//
// Patrones:
//   - Listado con búsqueda y filtro por semáforo.
//   - Click en tarjeta → modal con detalle de evaluación.
//   - Semáforo visual (VERDE / AMARILLO / ROJO / SIN_DATOS).
//
// Dependencias:
//   supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const INQUILINOS_EDIFICIO = (() => {

    let _usuario = null;
    let _inquilinos = [];    // lista enriquecida con evaluación

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // Marcar pagos vencidos
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[INQUILINOS] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        await _cargarInquilinos();
        _bindFiltros();
        _renderMetricas();
        _renderLista();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar evaluaciones masivas desde RPC
    // ──────────────────────────────────────────────────────────────
    async function _cargarInquilinos() {
        const { data, error } = await window.supabaseClient
            .rpc('obtener_evaluaciones_inquilinos_arrendador', {
                p_duenio_id: _usuario.usuario_id
            });

        if (error) {
            console.error('[INQUILINOS] Error cargando evaluaciones:', error);
            _inquilinos = [];
            return;
        }

        _inquilinos = data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Métricas del header
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas() {
        const total   = _inquilinos.length;
        const verdes  = _inquilinos.filter(i => i.nivel === 'VERDE').length;
        const amarillos = _inquilinos.filter(i => i.nivel === 'AMARILLO').length;
        const rojos   = _inquilinos.filter(i => i.nivel === 'ROJO').length;
        const sinDatos = _inquilinos.filter(i => i.nivel === 'SIN_DATOS').length;

        _set('m-total',      total);
        _set('m-verdes',     verdes);
        _set('m-amarillos',  amarillos);
        _set('m-rojos',      rojos);
        _set('m-sin-datos',  sinDatos);
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        ['f-buscar', 'f-nivel'].forEach(id => {
            document.getElementById(id)?.addEventListener('input',  _renderLista);
            document.getElementById(id)?.addEventListener('change', _renderLista);
        });
    }

    function _aplicarFiltros() {
        const q     = (document.getElementById('f-buscar')?.value || '').toLowerCase().trim();
        const nivel = document.getElementById('f-nivel')?.value || '';

        return _inquilinos.filter(i => {
            if (nivel && i.nivel !== nivel) return false;
            if (!q) return true;
            const nombre = (i.nombre_completo || '').toLowerCase();
            const correo = (i.correo || '').toLowerCase();
            const prop   = (i.propiedad_nombre || '').toLowerCase();
            return nombre.includes(q) || correo.includes(q) || prop.includes(q);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Render del listado
    // ──────────────────────────────────────────────────────────────
    function _renderLista() {
        const cont = document.getElementById('lista-inquilinos');
        if (!cont) return;

        const lista = _aplicarFiltros();

        if (!lista.length) {
            cont.innerHTML = `
                <div class="col-span-full p-12 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-16 h-16 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                        <i class="fa-solid fa-users-slash text-blue-400 text-2xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin inquilinos</p>
                    <p class="text-slate-400 text-sm">No hay inquilinos que coincidan con los filtros o aún no tienes contratos.</p>
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(i => _renderCard(i)).join('');

        // Bind click en tarjetas
        cont.querySelectorAll('[data-inquilino-card]').forEach(card => {
            card.addEventListener('click', () => {
                const id = parseInt(card.getAttribute('data-inquilino-card'), 10);
                const inq = _inquilinos.find(x => x.inquilino_id === id);
                if (inq) _abrirModalDetalle(inq);
            });
        });
    }

    function _renderCard(i) {
        const iniciales = (i.nombre_completo || '?')
            .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

        const sem = _semaforoConfig(i.nivel);
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);

        // Barra de cumplimiento visual
        const pct = parseFloat(i.cumplimiento_pct) || 0;
        const barColor = i.nivel === 'VERDE' ? 'from-green-400 to-green-600'
                       : i.nivel === 'AMARILLO' ? 'from-amber-400 to-amber-600'
                       : i.nivel === 'ROJO' ? 'from-red-400 to-red-600'
                       : 'from-slate-300 to-slate-400';

        // Estado del contrato
        const estadoContrato = {
            ACTIVO:     { label: 'Activo',     badge: 'bg-green-50 text-green-700 border-green-200' },
            FINALIZADO: { label: 'Finalizado', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
            TERMINADO:  { label: 'Terminado',  badge: 'bg-orange-50 text-orange-700 border-orange-200' }
        };
        const ec = estadoContrato[i.contrato_estado] || estadoContrato.ACTIVO;

        return `
        <div data-inquilino-card="${i.inquilino_id}"
             class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden
                    hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer
                    anim-fade-in-up">

            <!-- Semáforo header -->
            <div class="${sem.bgSoft} ${sem.borderColor} border-b px-5 py-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full ${sem.dot} ${i.nivel !== 'SIN_DATOS' ? 'animate-pulse' : ''}"></span>
                    <span class="${sem.textColor} text-xs font-bold uppercase tracking-wider">${esc(sem.label)}</span>
                </div>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${ec.badge} border text-[9px] font-bold uppercase">
                    ${esc(ec.label)}
                </span>
            </div>

            <div class="p-5">
                <!-- Inquilino -->
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-12 h-12 rounded-xl ${sem.avatarBg} ${sem.textColor}
                                flex items-center justify-center font-bold text-sm flex-shrink-0
                                shadow-sm">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-900 font-bold text-sm truncate">${esc(i.nombre_completo)}</p>
                        <p class="text-slate-500 text-xs truncate">
                            <i class="fa-solid fa-envelope text-[10px] mr-0.5"></i>${esc(i.correo || '—')}
                        </p>
                        <p class="text-slate-400 text-[10px] truncate">
                            <i class="fa-solid fa-house text-[9px] mr-0.5"></i>${esc(i.propiedad_nombre || '—')}
                        </p>
                    </div>
                </div>

                <!-- Estadísticas -->
                <div class="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                    <div class="rounded-xl bg-green-50 py-2">
                        <p class="text-green-700 font-bold text-base">${i.pagados}</p>
                        <p class="text-green-500 text-[9px] uppercase font-semibold">Pagados</p>
                    </div>
                    <div class="rounded-xl bg-amber-50 py-2">
                        <p class="text-amber-700 font-bold text-base">${i.pendientes}</p>
                        <p class="text-amber-500 text-[9px] uppercase font-semibold">Pend.</p>
                    </div>
                    <div class="rounded-xl bg-red-50 py-2">
                        <p class="text-red-700 font-bold text-base">${i.vencidos}</p>
                        <p class="text-red-500 text-[9px] uppercase font-semibold">Vencidos</p>
                    </div>
                </div>

                <!-- Barra de cumplimiento -->
                <div class="mt-3">
                    <div class="flex justify-between text-[10px] mb-1">
                        <span class="text-slate-400 font-semibold uppercase tracking-wider">Cumplimiento</span>
                        <span class="${sem.textColor} font-bold">${pct}%</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-700"
                             style="width:${pct}%"></div>
                    </div>
                </div>

                <!-- Renta -->
                <div class="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span class="text-slate-400 text-[10px] font-semibold uppercase">Renta</span>
                    <span class="text-slate-800 font-bold text-sm">${fmtMoney(i.monto_renta)}</span>
                </div>

                <p class="mt-2 text-center text-[10px] text-slate-400">
                    <i class="fa-solid fa-arrow-right text-[9px] mr-1"></i> Toca para ver evaluación detallada
                </p>
            </div>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Modal: Detalle de evaluación del inquilino
    // ──────────────────────────────────────────────────────────────
    function _abrirModalDetalle(i) {
        document.getElementById('modal-evaluacion-inquilino')?.remove();

        const sem = _semaforoConfig(i.nivel);
        const iniciales = (i.nombre_completo || '?')
            .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        const pct = parseFloat(i.cumplimiento_pct) || 0;
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);

        // Determinar mensaje de evaluación según RN-19
        let evaluacionHTML = '';
        if (!i.tiene_historial) {
            evaluacionHTML = `
                <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                    <i class="fa-solid fa-circle-info text-slate-400 text-xl mb-2"></i>
                    <p class="text-slate-600 text-sm font-semibold">Sin historial suficiente</p>
                    <p class="text-slate-400 text-xs mt-1">
                        <strong>RN-19:</strong> La evaluación requiere al menos un pago en estado "Pagado" o "Vencido".
                    </p>
                </div>`;
        } else {
            const barColor = i.nivel === 'VERDE' ? 'from-green-400 to-green-600'
                           : i.nivel === 'AMARILLO' ? 'from-amber-400 to-amber-600'
                           : 'from-red-400 to-red-600';

            evaluacionHTML = `
                <!-- Semáforo grande -->
                <div class="${sem.bgSoft} rounded-xl p-5 text-center border ${sem.borderColor}">
                    <span class="inline-flex w-16 h-16 rounded-2xl ${sem.avatarBg} ${sem.textColor}
                                items-center justify-center mb-3 shadow-lg">
                        <i class="fa-solid ${sem.icon} text-2xl"></i>
                    </span>
                    <p class="${sem.textColor} font-extrabold text-2xl">${esc(sem.label)}</p>
                    <p class="text-slate-500 text-xs mt-1">${esc(sem.desc)}</p>
                </div>

                <!-- Barra de progreso grande -->
                <div class="mt-4">
                    <div class="flex justify-between text-xs mb-1.5">
                        <span class="text-slate-500 font-semibold">Tasa de cumplimiento</span>
                        <span class="${sem.textColor} font-bold text-lg">${pct}%</span>
                    </div>
                    <div class="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-1000"
                             style="width:${pct}%"></div>
                    </div>
                </div>

                <!-- Detalle numérico -->
                <div class="grid grid-cols-4 gap-2 mt-4 text-center">
                    <div class="rounded-xl bg-slate-50 py-3">
                        <p class="text-slate-800 font-bold text-lg">${i.total_cuotas}</p>
                        <p class="text-slate-400 text-[9px] uppercase font-semibold">Total</p>
                    </div>
                    <div class="rounded-xl bg-green-50 py-3">
                        <p class="text-green-700 font-bold text-lg">${i.pagados}</p>
                        <p class="text-green-500 text-[9px] uppercase font-semibold">Pagados</p>
                    </div>
                    <div class="rounded-xl bg-amber-50 py-3">
                        <p class="text-amber-700 font-bold text-lg">${i.pendientes}</p>
                        <p class="text-amber-500 text-[9px] uppercase font-semibold">Pend.</p>
                    </div>
                    <div class="rounded-xl bg-red-50 py-3">
                        <p class="text-red-700 font-bold text-lg">${i.vencidos}</p>
                        <p class="text-red-500 text-[9px] uppercase font-semibold">Vencidos</p>
                    </div>
                </div>

                <!-- Criterios del semáforo -->
                <div class="mt-4 bg-slate-50 rounded-xl p-3 text-[11px] text-slate-600 space-y-1.5 leading-relaxed">
                    <p class="font-bold text-slate-700 text-xs mb-1.5">
                        <i class="fa-solid fa-list-check mr-1"></i> Criterios de evaluación
                    </p>
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></span>
                        <span><strong>Excelente:</strong> Cumplimiento ≥ 90% y máx. 1 pago vencido.</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"></span>
                        <span><strong>Regular:</strong> Cumplimiento ≥ 60% y máx. 3 pagos vencidos.</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0"></span>
                        <span><strong>En riesgo:</strong> Cumplimiento &lt; 60% o más de 3 vencidos.</span>
                    </div>
                </div>`;
        }

        const modalHTML = `
        <div id="modal-evaluacion-inquilino"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/50 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl
                        shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

                <!-- Cabecera -->
                <div class="px-5 py-4 bg-gradient-to-r from-[#0f2557] to-[#1d4ed8] text-white">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl bg-white/20 backdrop-blur
                                    flex items-center justify-center font-bold text-lg flex-shrink-0">
                            ${esc(iniciales)}
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-bold text-base leading-tight truncate">${esc(i.nombre_completo)}</p>
                            <p class="text-blue-200/80 text-xs truncate">${esc(i.correo || '—')}</p>
                            <p class="text-blue-200/60 text-[10px] truncate">
                                <i class="fa-solid fa-house mr-0.5"></i>${esc(i.propiedad_nombre)} · ${fmtMoney(i.monto_renta)}/mes
                            </p>
                        </div>
                        <button onclick="document.getElementById('modal-evaluacion-inquilino').remove()"
                                class="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0">
                            <i class="fa-solid fa-xmark text-white"></i>
                        </button>
                    </div>
                </div>

                <!-- Cuerpo: Evaluación -->
                <div class="p-5">
                    ${evaluacionHTML}

                    <!-- Aviso RN-18 -->
                    <div class="mt-4 flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-800">
                        <i class="fa-solid fa-info-circle flex-shrink-0 mt-0.5"></i>
                        <span>
                            <strong>RN-18:</strong> Esta evaluación solo considera contratos activos, finalizados
                            o terminados. Los contratos pendientes o rechazados no influyen.
                        </span>
                    </div>

                    <!-- Acciones -->
                    <div class="flex gap-2 mt-5">
                        <button onclick="document.getElementById('modal-evaluacion-inquilino').remove()"
                                class="flex-1 px-4 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100
                                       text-sm font-semibold transition">
                            Cerrar
                        </button>
                        <a href="detalle-contrato.html?contratoId=${i.contrato_id}"
                           class="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700
                                  text-white text-sm font-semibold shadow-md text-center transition">
                            <i class="fa-solid fa-file-contract mr-1"></i> Ver contrato
                        </a>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // ──────────────────────────────────────────────────────────────
    // Configuración visual del semáforo
    // ──────────────────────────────────────────────────────────────
    function _semaforoConfig(nivel) {
        const configs = {
            VERDE: {
                label: 'Excelente', desc: 'Pagos al día. Inquilino confiable.',
                dot: 'bg-green-500', textColor: 'text-green-700',
                bgSoft: 'bg-green-50', borderColor: 'border-green-200',
                avatarBg: 'bg-green-100', icon: 'fa-shield-check'
            },
            AMARILLO: {
                label: 'Regular', desc: 'Algunos pagos con retraso. Atención requerida.',
                dot: 'bg-amber-500', textColor: 'text-amber-700',
                bgSoft: 'bg-amber-50', borderColor: 'border-amber-200',
                avatarBg: 'bg-amber-100', icon: 'fa-exclamation-triangle'
            },
            ROJO: {
                label: 'En riesgo', desc: 'Alta morosidad. Acción urgente recomendada.',
                dot: 'bg-red-500', textColor: 'text-red-700',
                bgSoft: 'bg-red-50', borderColor: 'border-red-200',
                avatarBg: 'bg-red-100', icon: 'fa-circle-xmark'
            },
            SIN_DATOS: {
                label: 'Sin historial', desc: 'No hay datos suficientes para evaluar.',
                dot: 'bg-slate-400', textColor: 'text-slate-600',
                bgSoft: 'bg-slate-50', borderColor: 'border-slate-200',
                avatarBg: 'bg-slate-100', icon: 'fa-circle-question'
            }
        };
        return configs[nivel] || configs.SIN_DATOS;
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    function _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
    }

    return { init };
})();

window.INQUILINOS_EDIFICIO = INQUILINOS_EDIFICIO;