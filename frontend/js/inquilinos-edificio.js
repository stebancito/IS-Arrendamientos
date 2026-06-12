// ================================================================
// inquilinos-edificio.js  –  Módulo Dev 5 (Evaluación de Inquilinos)
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
                    <div class="w-16 h-16 mx-auto rounded-2xl bg-[#FFC533]/20 border border-[#FFE788] flex items-center justify-center mb-4">
                        <i class="fa-solid fa-users-slash text-[#13243E] text-2xl"></i>
                    </div>
                    <p class="text-[#13243E] font-bold mb-1">Sin inquilinos</p>
                    <p class="text-[#6F88A1] text-sm">No hay inquilinos que coincidan con los filtros o aún no tienes contratos.</p>
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

        const pct = parseFloat(i.cumplimiento_pct) || 0;
        const barColor = i.nivel === 'VERDE' ? 'from-green-400 to-green-600'
                       : i.nivel === 'AMARILLO' ? 'from-amber-400 to-[#FFC533]'
                       : i.nivel === 'ROJO' ? 'from-red-400 to-red-600'
                       : 'from-slate-300 to-slate-400';

        const estadoContrato = {
            ACTIVO:     { label: 'Activo',     badge: 'bg-[#FFFBEB] text-[#13243E] border-[#FFE788] shadow-sm' },
            FINALIZADO: { label: 'Finalizado', badge: 'bg-slate-100 text-[#6F88A1] border-slate-200' },
            TERMINADO:  { label: 'Terminado',  badge: 'bg-red-50 text-red-700 border-red-200' }
        };
        const ec = estadoContrato[i.contrato_estado] || estadoContrato.ACTIVO;

        return `
        <div data-inquilino-card="${i.inquilino_id}"
             class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden
                    hover:shadow-md hover:border-slate-200 hover:-translate-y-1 transition-all duration-200 cursor-pointer
                    anim-fade-in-up flex flex-col">

            <div class="${sem.bgSoft} ${sem.borderColor} border-b px-5 py-3 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full ${sem.dot} ${i.nivel !== 'SIN_DATOS' ? 'animate-pulse' : ''} shadow-sm"></span>
                    <span class="${sem.textColor} text-[10px] font-extrabold uppercase tracking-widest">${esc(sem.label)}</span>
                </div>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md ${ec.badge} border text-[9px] font-bold uppercase">
                    ${esc(ec.label)}
                </span>
            </div>

            <div class="p-5 flex-1 flex flex-col">
                <div class="flex items-center gap-3 mb-5">
                    <div class="w-12 h-12 rounded-xl ${sem.avatarBg} ${sem.textColor}
                                flex items-center justify-center font-extrabold text-sm flex-shrink-0
                                shadow-sm border border-white/50">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[#13243E] font-bold text-sm truncate">${esc(i.nombre_completo)}</p>
                        <p class="text-[#6F88A1] font-medium text-xs truncate mt-0.5">
                            <i class="fa-solid fa-envelope text-[10px] mr-1"></i>${esc(i.correo || '—')}
                        </p>
                        <p class="text-[#255FA4] font-semibold text-[10px] truncate mt-0.5">
                            <i class="fa-solid fa-house text-[9px] mr-1"></i>${esc(i.propiedad_nombre || '—')}
                        </p>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-2 text-center text-xs mb-4">
                    <div class="rounded-xl bg-green-50 py-2.5 border border-green-100/50">
                        <p class="text-green-700 font-bold text-base">${i.pagados}</p>
                        <p class="text-green-600/70 text-[9px] uppercase font-bold tracking-wide">Pagados</p>
                    </div>
                    <div class="rounded-xl bg-[#FFFBEB] py-2.5 border border-[#FFE788]/50">
                        <p class="text-amber-600 font-bold text-base">${i.pendientes}</p>
                        <p class="text-amber-500/80 text-[9px] uppercase font-bold tracking-wide">Pend.</p>
                    </div>
                    <div class="rounded-xl bg-red-50 py-2.5 border border-red-100/50">
                        <p class="text-red-600 font-bold text-base">${i.vencidos}</p>
                        <p class="text-red-500/70 text-[9px] uppercase font-bold tracking-wide">Vencidos</p>
                    </div>
                </div>

                <div class="mt-auto">
                    <div class="flex justify-between text-[10px] mb-1.5">
                        <span class="text-[#6F88A1] font-bold uppercase tracking-wider">Cumplimiento</span>
                        <span class="${sem.textColor} font-bold">${pct}%</span>
                    </div>
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-700"
                             style="width:${pct}%"></div>
                    </div>
                </div>

                <div class="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span class="text-[#6F88A1] text-[10px] font-bold uppercase tracking-widest">Renta mensual</span>
                    <span class="text-[#13243E] font-extrabold text-sm">${fmtMoney(i.monto_renta)}</span>
                </div>

                <div class="mt-3 w-full py-2 bg-[#F5F7F9] rounded-lg text-center text-[#6F88A1] text-[10px] font-semibold uppercase tracking-wider">
                    Toca para ver detalle
                </div>
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

        let evaluacionHTML = '';
        if (!i.tiene_historial) {
            evaluacionHTML = `
                <div class="bg-[#F5F7F9] border border-slate-200 rounded-xl p-5 text-center">
                    <i class="fa-solid fa-circle-info text-[#6F88A1] text-2xl mb-3"></i>
                    <p class="text-[#13243E] text-sm font-bold">Sin historial suficiente</p>
                    <p class="text-[#6F88A1] text-xs mt-2 font-medium">
                        <strong>RN-19:</strong> La evaluación requiere al menos un pago en estado "Pagado" o "Vencido".
                    </p>
                </div>`;
        } else {
            const barColor = i.nivel === 'VERDE' ? 'from-green-400 to-green-600'
                           : i.nivel === 'AMARILLO' ? 'from-amber-400 to-[#FFC533]'
                           : 'from-red-400 to-red-600';

            evaluacionHTML = `
                <div class="${sem.bgSoft} rounded-2xl p-6 text-center border ${sem.borderColor} shadow-sm">
                    <span class="inline-flex w-16 h-16 rounded-2xl ${sem.avatarBg} ${sem.textColor}
                                items-center justify-center mb-4 shadow-md border border-white/50">
                        <i class="fa-solid ${sem.icon} text-3xl"></i>
                    </span>
                    <p class="${sem.textColor} font-extrabold text-2xl uppercase tracking-wider">${esc(sem.label)}</p>
                    <p class="${sem.textColor}/80 text-xs mt-1.5 font-medium">${esc(sem.desc)}</p>
                </div>

                <div class="mt-6">
                    <div class="flex justify-between text-[11px] mb-2">
                        <span class="text-[#6F88A1] font-bold uppercase tracking-widest">Tasa de cumplimiento</span>
                        <span class="${sem.textColor} font-extrabold text-lg leading-none">${pct}%</span>
                    </div>
                    <div class="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                        <div class="h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-1000"
                             style="width:${pct}%"></div>
                    </div>
                </div>

                <div class="grid grid-cols-4 gap-2 mt-5 text-center">
                    <div class="rounded-xl bg-[#F5F7F9] py-3.5 border border-slate-100">
                        <p class="text-[#13243E] font-extrabold text-lg">${i.total_cuotas}</p>
                        <p class="text-[#6F88A1] text-[9px] uppercase font-bold tracking-widest">Total</p>
                    </div>
                    <div class="rounded-xl bg-green-50 py-3.5 border border-green-100/50">
                        <p class="text-green-700 font-extrabold text-lg">${i.pagados}</p>
                        <p class="text-green-600/70 text-[9px] uppercase font-bold tracking-widest">Pagados</p>
                    </div>
                    <div class="rounded-xl bg-[#FFFBEB] py-3.5 border border-[#FFE788]/50">
                        <p class="text-amber-600 font-extrabold text-lg">${i.pendientes}</p>
                        <p class="text-amber-500/80 text-[9px] uppercase font-bold tracking-widest">Pend.</p>
                    </div>
                    <div class="rounded-xl bg-red-50 py-3.5 border border-red-100/50">
                        <p class="text-red-600 font-extrabold text-lg">${i.vencidos}</p>
                        <p class="text-red-500/70 text-[9px] uppercase font-bold tracking-widest">Vencidos</p>
                    </div>
                </div>

                <div class="mt-5 bg-[#F5F7F9] rounded-xl p-4 text-[11px] text-[#6F88A1] space-y-2 leading-relaxed font-medium">
                    <p class="font-bold text-[#13243E] text-xs mb-2 uppercase tracking-wide">
                        <i class="fa-solid fa-list-check mr-1.5 text-[#FFC533]"></i> Criterios de evaluación
                    </p>
                    <div class="flex items-center gap-2.5">
                        <span class="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 shadow-sm shadow-green-500/50"></span>
                        <span><strong>Excelente:</strong> Cumplimiento ≥ 90% y máx. 1 pago vencido.</span>
                    </div>
                    <div class="flex items-center gap-2.5">
                        <span class="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 shadow-sm shadow-amber-500/50"></span>
                        <span><strong>Regular:</strong> Cumplimiento ≥ 60% y máx. 3 pagos vencidos.</span>
                    </div>
                    <div class="flex items-center gap-2.5">
                        <span class="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 shadow-sm shadow-red-500/50"></span>
                        <span><strong>En riesgo:</strong> Cumplimiento &lt; 60% o más de 3 vencidos.</span>
                    </div>
                </div>`;
        }

        const modalHTML = `
        <div id="modal-evaluacion-inquilino"
             class="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-[#13243E]/60 backdrop-blur-sm p-0 sm:p-4 anim-fade-in-up">
            <div class="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl
                        shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

                <div class="px-6 py-5 bg-[#13243E] text-white relative">
                    <div class="absolute -right-6 -top-6 w-24 h-24 bg-[#FFC533]/15 rounded-full blur-2xl pointer-events-none"></div>
                    <div class="flex items-center gap-4 relative z-10">
                        <div class="w-12 h-12 rounded-xl bg-[#FFC533] text-[#13243E]
                                    flex items-center justify-center font-extrabold text-lg flex-shrink-0 shadow-sm">
                            ${esc(iniciales)}
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-extrabold text-base leading-tight truncate text-white">${esc(i.nombre_completo)}</p>
                            <p class="text-[#6F88A1] font-medium text-xs truncate mt-0.5">${esc(i.correo || '—')}</p>
                            <p class="text-[#FFC533] font-bold text-[10px] uppercase tracking-wider mt-1 truncate">
                                <i class="fa-solid fa-house mr-1"></i>${esc(i.propiedad_nombre)}
                            </p>
                        </div>
                        <button onclick="document.getElementById('modal-evaluacion-inquilino').remove()"
                                class="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors flex-shrink-0">
                            <i class="fa-solid fa-xmark text-white"></i>
                        </button>
                    </div>
                </div>

                <div class="p-6">
                    ${evaluacionHTML}

                    <div class="mt-5 flex items-start gap-2.5 p-3.5 bg-[#FFFBEB] border border-[#FFE788] rounded-xl text-xs text-[#13243E]/80 font-medium">
                        <i class="fa-solid fa-circle-info flex-shrink-0 mt-0.5 text-[#FFC533]"></i>
                        <span>
                            <strong class="text-[#13243E]">RN-18:</strong> Esta evaluación solo considera contratos activos, finalizados
                            o terminados. Los contratos pendientes o rechazados no influyen.
                        </span>
                    </div>

                    <div class="flex gap-3 mt-6 pt-5 border-t border-slate-100">
                        <button onclick="document.getElementById('modal-evaluacion-inquilino').remove()"
                                class="flex-1 px-4 py-3 rounded-xl bg-[#F5F7F9] text-[#13243E] hover:bg-slate-200
                                       text-sm font-bold transition-colors">
                            Cerrar
                        </button>
                        <a href="detalle-contrato.html?contratoId=${i.contrato_id}"
                           class="flex-1 px-4 py-3 rounded-xl bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E]
                                  text-sm font-extrabold shadow-sm shadow-[#FFC533]/30 text-center transition-colors">
                            <i class="fa-solid fa-file-contract mr-1.5"></i> Ver contrato
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
                // Adaptado al ámbar primario de la paleta
                label: 'Regular', desc: 'Algunos pagos con retraso. Atención requerida.',
                dot: 'bg-amber-500', textColor: 'text-amber-700',
                bgSoft: 'bg-[#FFFBEB]', borderColor: 'border-[#FFE788]',
                avatarBg: 'bg-[#FFE788]', icon: 'fa-triangle-exclamation'
            },
            ROJO: {
                label: 'En riesgo', desc: 'Alta morosidad. Acción urgente recomendada.',
                dot: 'bg-red-500', textColor: 'text-red-600',
                bgSoft: 'bg-red-50', borderColor: 'border-red-200',
                avatarBg: 'bg-red-100', icon: 'fa-circle-xmark'
            },
            SIN_DATOS: {
                label: 'Sin historial', desc: 'No hay datos suficientes para evaluar.',
                dot: 'bg-slate-300', textColor: 'text-[#6F88A1]',
                bgSoft: 'bg-slate-50', borderColor: 'border-slate-200',
                avatarBg: 'bg-slate-200', icon: 'fa-circle-question'
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