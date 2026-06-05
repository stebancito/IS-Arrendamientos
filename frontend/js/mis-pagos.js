// ================================================================
// mis-pagos.js  –  Módulo del Dev 4 (Motor de Pagos) · vista INQUILINO
// ================================================================
// Responsabilidades:
//   - RF-24 : Historial de pagos del inquilino por contrato.
//   - RF-25 : Mostrar próximo pago, totales pagado/pendiente/vencido.
//   - Solo lectura: el inquilino consulta; el arrendador es quien
//     registra la recepción de los pagos manuales (ver pagos.js).
//   - RN-13 : Antes de leer, se intenta marcar los vencidos (RPC).
//
// Dependencias (cargadas antes en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js
// ================================================================

const MIS_PAGOS = (() => {

    let _usuario     = null;
    let _inquilinoId = null;
    let _contratos   = [];   // contratos con calendario
    let _pagosPorCont = {};  // { contrato_id: [ ...calendario_pagos ] }

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

        // Resolver el inquilino_id del usuario
        const { data: inq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();

        if (!inq) {
            _renderVacio('Aún no tienes contratos con pagos. Cuando aceptes un contrato, aquí verás tu calendario.');
            return;
        }
        _inquilinoId = inq.inquilino_id;

        try { await window.supabaseClient.rpc('actualizar_pagos_vencidos'); }
        catch (err) { console.warn('[MIS-PAGOS] RPC vencidos no disponible:', err); }

        await _cargarDatos();
    }

    // ──────────────────────────────────────────────────────────────
    // Carga: contratos del inquilino + su calendario de pagos
    // ──────────────────────────────────────────────────────────────
    async function _cargarDatos() {
        const { data: contratos, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, monto_renta, frecuencia_pago, estado,
                propiedades ( propiedad_id, nombre, direccion, duenio_id )
            `)
            .eq('inquilino_id', _inquilinoId)
            .in('estado', ['ACTIVO', 'FINALIZADO', 'TERMINADO'])
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[MIS-PAGOS] Error al cargar contratos:', error);
            _renderVacio('No se pudieron cargar tus pagos.');
            return;
        }

        _contratos = contratos || [];
        const contIds = _contratos.map(c => c.contrato_id);

        _pagosPorCont = {};
        if (contIds.length) {
            const { data: pagos } = await window.supabaseClient
                .from('calendario_pagos')
                .select('calendario_id, contrato_id, fecha_limite, monto_esperado, anio, mes, estado, fecha_pagado')
                .in('contrato_id', contIds)
                .order('fecha_limite', { ascending: true });
            (pagos || []).forEach(p => {
                (_pagosPorCont[p.contrato_id] = _pagosPorCont[p.contrato_id] || []).push(p);
            });
        }

        // Solo contratos con calendario
        _contratos = _contratos.filter(c => (_pagosPorCont[c.contrato_id] || []).length);

        _renderResumen();
        _renderContratos();
    }

    // ──────────────────────────────────────────────────────────────
    // Resumen superior: próximo pago + totales
    // ──────────────────────────────────────────────────────────────
    function _renderResumen() {
        const todos = Object.values(_pagosPorCont).flat();

        let pagado = 0, pendiente = 0, vencido = 0;
        todos.forEach(p => {
            const monto = Number(p.monto_esperado) || 0;
            if (p.estado === 'PAGADO') pagado += monto;
            else if (p.estado === 'VENCIDO') vencido += monto;
            else pendiente += monto;   // PENDIENTE y REPORTADO (aún sin confirmar)
        });

        _set('r-pagado', fmtMoney(pagado));
        _set('r-pendiente', fmtMoney(pendiente));
        _set('r-vencido', fmtMoney(vencido));

        // Próximo pago: el PENDIENTE/VENCIDO con fecha_limite más cercana.
        // Los REPORTADO se excluyen: el inquilino ya los declaró y esperan confirmación.
        const porPagar = todos
            .filter(p => p.estado !== 'PAGADO' && p.estado !== 'REPORTADO')
            .sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite));

        const proxBox = document.getElementById('proximo-pago');
        if (!proxBox) return;

        if (!porPagar.length) {
            proxBox.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
                        <i class="fa-solid fa-circle-check text-xl"></i>
                    </div>
                    <div>
                        <p class="text-blue-200/80 text-xs uppercase font-semibold tracking-wider">Próximo pago</p>
                        <p class="font-bold text-base">¡Estás al corriente!</p>
                    </div>
                </div>`;
            return;
        }

        const prox = porPagar[0];
        const vencidoYa = prox.estado === 'VENCIDO' || prox.fecha_limite < hoyStr();
        proxBox.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="w-11 h-11 rounded-xl ${vencidoYa ? 'bg-red-400/30' : 'bg-white/15'} flex items-center justify-center">
                    <i class="fa-solid ${vencidoYa ? 'fa-triangle-exclamation' : 'fa-calendar-day'} text-xl"></i>
                </div>
                <div class="min-w-0">
                    <p class="text-blue-200/80 text-xs uppercase font-semibold tracking-wider">
                        ${vencidoYa ? 'Pago vencido' : 'Próximo pago'}
                    </p>
                    <p class="font-bold text-base truncate">
                        ${fmtMoney(prox.monto_esperado)}
                        <span class="font-medium text-blue-200/80 text-sm">· ${MESES[prox.mes] || prox.mes} ${prox.anio}</span>
                    </p>
                    <p class="text-blue-200/70 text-xs">Vence el ${fmtFecha(prox.fecha_limite)}</p>
                </div>
            </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Listado de contratos con su calendario de pagos
    // ──────────────────────────────────────────────────────────────
    function _renderContratos() {
        const cont = document.getElementById('lista-mis-pagos');
        if (!cont) return;

        if (!_contratos.length) {
            _renderVacio('Aún no tienes pagos registrados. Cuando aceptes un contrato se generará tu calendario.');
            return;
        }

        cont.innerHTML = _contratos.map(_renderTarjetaContrato).join('');
    }

    function _renderTarjetaContrato(c) {
        const pagos   = _pagosPorCont[c.contrato_id] || [];
        const prop    = c.propiedades || {};
        const total   = pagos.length;
        const pagados = pagos.filter(p => p.estado === 'PAGADO').length;
        const pct     = total ? Math.round((pagados / total) * 100) : 0;

        const filas = pagos.map(p => {
            const cfg = {
                PAGADO:    { bg:'bg-green-50',  text:'text-green-700',  dot:'bg-green-500',   label:'Pagado'    },
                REPORTADO: { bg:'bg-indigo-50', text:'text-indigo-700', dot:'bg-indigo-500',  label:'Reportado' },
                VENCIDO:   { bg:'bg-red-50',    text:'text-red-700',    dot:'bg-red-500',     label:'Vencido'   },
                PENDIENTE: { bg:'bg-amber-50',  text:'text-amber-700',  dot:'bg-amber-500',   label:'Pendiente' },
            }[p.estado] || { bg:'bg-slate-50', text:'text-slate-600', dot:'bg-slate-400', label:p.estado };

            let detalle;
            if (p.estado === 'PAGADO') {
                detalle = `<span class="text-green-600"><i class="fa-solid fa-circle-check mr-1"></i>Pagado el ${fmtFecha(p.fecha_pagado)}</span>`;
            } else if (p.estado === 'REPORTADO') {
                detalle = `<span class="text-indigo-600"><i class="fa-solid fa-hourglass-half mr-1"></i>Reportado · en revisión del arrendador</span>`;
            } else {
                detalle = `<span class="text-slate-500">Vence el ${fmtFecha(p.fecha_limite)}</span>`;
            }

            return `
            <tr class="hover:bg-slate-50/60 transition">
                <td class="px-4 py-2.5">
                    <p class="font-semibold text-slate-800 text-sm">${MESES[p.mes] || p.mes} ${p.anio}</p>
                    <p class="text-[11px]">${detalle}</p>
                </td>
                <td class="px-3 py-2.5 text-right font-semibold text-slate-800 text-sm">
                    ${fmtMoney(p.monto_esperado)}
                </td>
                <td class="px-4 py-2.5 text-right">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text} text-[11px] font-bold">
                        <span class="w-1.5 h-1.5 rounded-full ${cfg.dot}"></span>${cfg.label}
                    </span>
                </td>
            </tr>`;
        }).join('');

        const estadoCfg = {
            ACTIVO:     { text:'text-green-700',  label:'Activo' },
            FINALIZADO: { text:'text-slate-600',  label:'Finalizado' },
            TERMINADO:  { text:'text-orange-700', label:'Cancelado' },
        }[c.estado] || { text:'text-slate-600', label:c.estado };

        return `
        <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden anim-fade-in-up">
            <!-- Cabecera del contrato -->
            <div class="px-5 py-4 border-b border-slate-100">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="min-w-0">
                        <p class="text-slate-900 font-bold text-base truncate">${esc(prop.nombre || 'Propiedad')}</p>
                        <p class="text-slate-400 text-xs truncate">
                            <i class="fa-solid fa-location-dot text-[10px] mr-0.5"></i>${esc(prop.direccion || '')}
                        </p>
                    </div>
                    <span class="flex-shrink-0 text-[11px] font-bold uppercase tracking-wider ${estadoCfg.text}">
                        ${estadoCfg.label}
                    </span>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'} rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                    <span class="text-xs font-semibold text-slate-500">${pagados}/${total} pagados</span>
                </div>
            </div>

            <!-- Tabla de periodos -->
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                            <th class="px-4 py-2.5 font-semibold">Periodo</th>
                            <th class="px-3 py-2.5 font-semibold text-right">Monto</th>
                            <th class="px-4 py-2.5 font-semibold text-right">Estado</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-50">${filas}</tbody>
                </table>
            </div>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de UI
    // ──────────────────────────────────────────────────────────────
    function _set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value ?? '—');
    }

    function _renderVacio(msg) {
        const cont = document.getElementById('lista-mis-pagos');
        if (cont) {
            cont.innerHTML = `
                <div class="p-10 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-receipt text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin pagos</p>
                    <p class="text-slate-400 text-sm">${esc(msg)}</p>
                </div>`;
        }
        // Resumen en ceros
        ['r-pagado','r-pendiente','r-vencido'].forEach(id => _set(id, fmtMoney(0)));
        const proxBox = document.getElementById('proximo-pago');
        if (proxBox) {
            proxBox.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
                        <i class="fa-solid fa-calendar-day text-xl"></i>
                    </div>
                    <div>
                        <p class="text-blue-200/80 text-xs uppercase font-semibold tracking-wider">Próximo pago</p>
                        <p class="font-bold text-base">Sin pagos programados</p>
                    </div>
                </div>`;
        }
    }

    return { init };
})();

window.MIS_PAGOS = MIS_PAGOS;
