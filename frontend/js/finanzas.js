// ================================================================
// finanzas.js  –  Módulo del Dev 5 (Dashboard Financiero y Evaluaciones)
// ================================================================
// Vista del ARRENDADOR. Responsabilidades:
//   - RF-26 : Métricas financieras (ingresos cobrados, pendientes, vencidos,
//             tasa de cobro).
//   - RF-27 : Gráfico de flujo de efectivo (Chart.js): esperado vs cobrado
//             por mes + distribución de estados de pago.
//   - RF-28 : Calificación del comportamiento financiero de cada inquilino
//             (puntaje 0-100 + nivel: Excelente/Bueno/Regular/En riesgo).
//
// Todo se calcula del lado del cliente a partir de calendario_pagos y
// registros_pago (mismo enfoque que el resto del proyecto). El semáforo
// reutiliza el criterio del dashboard del inquilino para consistencia.
//
// Dependencias (cargadas antes en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js · Chart.js (CDN)
// ================================================================

const FINANZAS = (() => {

    // ── Estado del módulo ──────────────────────────────────────────
    let _usuario  = null;
    let _charts   = {};   // instancias de Chart.js (para destruir en re-render)

    // ── Helpers de formato ─────────────────────────────────────────
    const fmtMoney = v => new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', maximumFractionDigits: 0
    }).format(Number(v) || 0);

    const fmtMoneyExacto = v => new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(Number(v) || 0);

    const MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        try { await window.supabaseClient.rpc('actualizar_pagos_vencidos'); }
        catch (err) { console.warn('[FINANZAS] RPC vencidos no disponible:', err); }

        await _cargarYRender();
    }

    // ──────────────────────────────────────────────────────────────
    // Carga de datos: contratos del arrendador + calendario + registros
    // ──────────────────────────────────────────────────────────────
    async function _cargarYRender() {
        // 1. Propiedades del arrendador
        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id')
            .eq('duenio_id', _usuario.usuario_id);

        const propIds = (props || []).map(p => p.propiedad_id);
        if (!propIds.length) return _renderVacio();

        // 2. Contratos con calendario (ACTIVO / FINALIZADO / TERMINADO)
        const { data: contratos, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, monto_renta, estado, inquilino_id,
                inquilinos (
                    inquilino_id,
                    usuarios ( usuario_id, nombre_completo, correo )
                )
            `)
            .in('propiedad_id', propIds)
            .in('estado', ['ACTIVO', 'FINALIZADO', 'TERMINADO']);

        if (error) {
            console.error('[FINANZAS] Error al cargar contratos:', error);
            return _renderVacio();
        }
        if (!contratos?.length) return _renderVacio();

        const contIds = contratos.map(c => c.contrato_id);

        // 3. Calendario de pagos
        const { data: pagos } = await window.supabaseClient
            .from('calendario_pagos')
            .select('calendario_id, contrato_id, fecha_limite, monto_esperado, anio, mes, estado, fecha_pagado')
            .in('contrato_id', contIds);

        const lista = pagos || [];
        if (!lista.length) return _renderVacio();

        // 4. Registros de pago (monto realmente recibido)
        const calIds = lista.map(p => p.calendario_id);
        const regPorCal = {};
        if (calIds.length) {
            const { data: regs } = await window.supabaseClient
                .from('registros_pago')
                .select('calendario_id, monto_recibido, fecha_recibido')
                .in('calendario_id', calIds);
            (regs || []).forEach(r => { regPorCal[r.calendario_id] = r; });
        }

        // Mapa contrato → inquilino (usuario)
        const contMap = {};
        contratos.forEach(c => { contMap[c.contrato_id] = c; });

        // ── Cálculos ───────────────────────────────────────────────
        const metricas = _calcularMetricas(lista, regPorCal);
        const flujo    = _calcularFlujoMensual(lista, regPorCal);
        const ranking  = _calcularComportamiento(lista, regPorCal, contMap);

        // ── Render ─────────────────────────────────────────────────
        _renderMetricas(metricas);
        _renderGraficoFlujo(flujo);
        _renderGraficoEstados(metricas);
        _renderRanking(ranking);
    }

    // ──────────────────────────────────────────────────────────────
    // Métricas globales
    // ──────────────────────────────────────────────────────────────
    function _calcularMetricas(lista, regPorCal) {
        let esperado = 0, cobrado = 0, pendiente = 0, vencido = 0;
        let nPagados = 0, nPendientes = 0, nVencidos = 0, nReportados = 0;

        lista.forEach(p => {
            const monto = Number(p.monto_esperado) || 0;
            esperado += monto;
            if (p.estado === 'PAGADO') {
                const reg = regPorCal[p.calendario_id];
                cobrado += Number(reg?.monto_recibido ?? monto) || 0;
                nPagados++;
            } else if (p.estado === 'VENCIDO') {
                vencido += monto;
                nVencidos++;
            } else if (p.estado === 'REPORTADO') {
                // Reportado por el inquilino, aún sin confirmar: no es cobrado.
                pendiente += monto;
                nReportados++;
            } else {
                pendiente += monto;
                nPendientes++;
            }
        });

        const tasaCobro = esperado > 0 ? Math.round((cobrado / esperado) * 100) : 0;

        return { esperado, cobrado, pendiente, vencido, tasaCobro,
                 nPagados, nPendientes, nVencidos, nReportados };
    }

    // ──────────────────────────────────────────────────────────────
    // Flujo de efectivo mensual: esperado vs cobrado por (año, mes)
    // ──────────────────────────────────────────────────────────────
    function _calcularFlujoMensual(lista, regPorCal) {
        const map = {};   // 'YYYY-MM' → { esperado, cobrado, anio, mes }

        lista.forEach(p => {
            const key = `${p.anio}-${String(p.mes).padStart(2, '0')}`;
            if (!map[key]) map[key] = { esperado: 0, cobrado: 0, anio: p.anio, mes: p.mes };
            const monto = Number(p.monto_esperado) || 0;
            map[key].esperado += monto;
            if (p.estado === 'PAGADO') {
                const reg = regPorCal[p.calendario_id];
                map[key].cobrado += Number(reg?.monto_recibido ?? monto) || 0;
            }
        });

        // Ordenar cronológicamente y quedarnos con los últimos 12 periodos
        const claves = Object.keys(map).sort();
        const recientes = claves.slice(-12);

        return recientes.map(k => ({
            label:    `${MESES_CORTO[map[k].mes - 1]} ${String(map[k].anio).slice(2)}`,
            esperado: map[k].esperado,
            cobrado:  map[k].cobrado,
        }));
    }

    // ──────────────────────────────────────────────────────────────
    // Comportamiento financiero por inquilino
    // ──────────────────────────────────────────────────────────────
    function _calcularComportamiento(lista, regPorCal, contMap) {
        // Agrupar pagos por usuario_id del inquilino
        const porInq = {};   // usuario_id → acumulador

        lista.forEach(p => {
            const cont = contMap[p.contrato_id];
            const inqUsr = cont?.inquilinos?.usuarios;
            if (!inqUsr?.usuario_id) return;

            const id = inqUsr.usuario_id;
            if (!porInq[id]) {
                porInq[id] = {
                    usuario_id: id,
                    nombre: inqUsr.nombre_completo || 'Inquilino',
                    correo: inqUsr.correo || '',
                    total: 0, pagados: 0, pendientes: 0, vencidos: 0,
                    cobrado: 0, esperado: 0,
                };
            }
            const acc = porInq[id];
            const monto = Number(p.monto_esperado) || 0;
            acc.total++;
            acc.esperado += monto;
            if (p.estado === 'PAGADO') {
                acc.pagados++;
                const reg = regPorCal[p.calendario_id];
                acc.cobrado += Number(reg?.monto_recibido ?? monto) || 0;
            } else if (p.estado === 'VENCIDO') {
                acc.vencidos++;
            } else {
                acc.pendientes++;
            }
        });

        // Calcular puntaje + nivel
        const ranking = Object.values(porInq).map(acc => {
            const cumplimiento = acc.total > 0 ? Math.round((acc.pagados / acc.total) * 100) : 0;
            // Puntaje 0-100: cumplimiento penalizado por vencidos (10 pts c/u)
            const puntaje = acc.total > 0
                ? Math.max(0, Math.min(100, cumplimiento - acc.vencidos * 10))
                : null;

            let nivel = 'NEUTRO';
            if (acc.total > 0) {
                if (acc.vencidos > 2 || cumplimiento < 60)      nivel = 'ROJO';
                else if (acc.vencidos >= 1 || cumplimiento < 90) nivel = 'AMARILLO';
                else                                             nivel = 'VERDE';
            }
            return { ...acc, cumplimiento, puntaje, nivel };
        });

        // Ordenar: mejor puntaje primero (los sin historial al final)
        ranking.sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1));
        return ranking;
    }

    // ──────────────────────────────────────────────────────────────
    // Render: tarjetas de métricas
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas(m) {
        _set('f-ingresos',  fmtMoney(m.cobrado));
        _set('f-pendiente', fmtMoney(m.pendiente));
        _set('f-vencido',   fmtMoney(m.vencido));
        _set('f-tasa',      `${m.tasaCobro}%`);

        // Barra de tasa de cobro
        const bar = document.getElementById('f-tasa-bar');
        if (bar) setTimeout(() => { bar.style.width = `${m.tasaCobro}%`; }, 80);
    }

    // ──────────────────────────────────────────────────────────────
    // Render: gráfico de flujo de efectivo (barras + línea)
    // ──────────────────────────────────────────────────────────────
    function _renderGraficoFlujo(flujo) {
        const canvas = document.getElementById('chart-flujo');
        if (!canvas || !window.Chart) return;

        if (_charts.flujo) _charts.flujo.destroy();

        if (!flujo.length) {
            _placeholderCanvas('chart-flujo', 'Sin datos de flujo todavía.');
            return;
        }

        _charts.flujo = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: flujo.map(f => f.label),
                datasets: [
                    {
                        label: 'Esperado',
                        data: flujo.map(f => f.esperado),
                        backgroundColor: 'rgba(148, 163, 184, 0.35)',
                        borderRadius: 6,
                        order: 2,
                    },
                    {
                        label: 'Cobrado',
                        data: flujo.map(f => f.cobrado),
                        type: 'line',
                        borderColor: '#2563eb',
                        backgroundColor: 'rgba(37, 99, 235, 0.12)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointRadius: 3,
                        pointBackgroundColor: '#2563eb',
                        order: 1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyExacto(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (v) => fmtMoney(v), font: { size: 11 } },
                        grid: { color: 'rgba(148,163,184,0.15)' }
                    },
                    x: { grid: { display: false }, ticks: { font: { size: 11 } } }
                }
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Render: gráfico de distribución de estados (doughnut)
    // ──────────────────────────────────────────────────────────────
    function _renderGraficoEstados(m) {
        const canvas = document.getElementById('chart-estados');
        if (!canvas || !window.Chart) return;

        if (_charts.estados) _charts.estados.destroy();

        const total = m.nPagados + m.nPendientes + m.nVencidos + m.nReportados;
        if (!total) {
            _placeholderCanvas('chart-estados', 'Sin pagos registrados.');
            return;
        }

        // Construir segmentos dinámicamente (Reportados solo si existen)
        const segmentos = [
            { label: 'Pagados',    valor: m.nPagados,    color: '#22c55e' },
            { label: 'Reportados', valor: m.nReportados, color: '#6366f1' },
            { label: 'Pendientes', valor: m.nPendientes, color: '#f59e0b' },
            { label: 'Vencidos',   valor: m.nVencidos,   color: '#ef4444' },
        ].filter(s => s.valor > 0);

        _charts.estados = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: segmentos.map(s => s.label),
                datasets: [{
                    data: segmentos.map(s => s.valor),
                    backgroundColor: segmentos.map(s => s.color),
                    borderWidth: 0,
                    hoverOffset: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pct = total ? Math.round((ctx.parsed / total) * 100) : 0;
                                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Render: tabla de calificación de inquilinos
    // ──────────────────────────────────────────────────────────────
    function _renderRanking(ranking) {
        const cont = document.getElementById('tabla-comportamiento');
        if (!cont) return;

        if (!ranking.length) {
            cont.innerHTML = `<p class="text-slate-400 text-sm text-center py-8">Aún no hay inquilinos con historial de pagos.</p>`;
            return;
        }

        const nivelCfg = {
            VERDE:    { label:'Excelente', bg:'bg-green-50',  text:'text-green-700',  dot:'bg-green-500',  ring:'ring-green-200'  },
            AMARILLO: { label:'Regular',   bg:'bg-amber-50',  text:'text-amber-700',  dot:'bg-amber-500',  ring:'ring-amber-200'  },
            ROJO:     { label:'En riesgo', bg:'bg-red-50',    text:'text-red-700',    dot:'bg-red-500',    ring:'ring-red-200'    },
            NEUTRO:   { label:'Sin datos', bg:'bg-slate-50',  text:'text-slate-500',  dot:'bg-slate-400',  ring:'ring-slate-200'  },
        };

        cont.innerHTML = ranking.map(r => {
            const cfg = nivelCfg[r.nivel] || nivelCfg.NEUTRO;
            const iniciales = (r.nombre || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
            const puntajeTxt = r.puntaje != null ? r.puntaje : '—';

            return `
            <div class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition rounded-xl">
                <!-- Puntaje circular -->
                <div class="relative w-12 h-12 flex-shrink-0">
                    <div class="w-12 h-12 rounded-full ${cfg.bg} ring-2 ${cfg.ring} flex items-center justify-center">
                        <span class="${cfg.text} font-extrabold text-sm">${puntajeTxt}</span>
                    </div>
                </div>
                <!-- Identidad -->
                <div class="flex items-center gap-2.5 flex-1 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="min-w-0">
                        <p class="text-slate-900 font-semibold text-sm truncate">${esc(r.nombre)}</p>
                        <p class="text-slate-400 text-xs truncate">${esc(r.correo)}</p>
                    </div>
                </div>
                <!-- Métricas -->
                <div class="hidden sm:flex items-center gap-4 text-center text-xs flex-shrink-0">
                    <div>
                        <p class="font-bold text-slate-800">${r.cumplimiento}%</p>
                        <p class="text-slate-400 text-[10px] uppercase">Cumpl.</p>
                    </div>
                    <div>
                        <p class="font-bold text-green-600">${r.pagados}</p>
                        <p class="text-slate-400 text-[10px] uppercase">Pagados</p>
                    </div>
                    <div>
                        <p class="font-bold ${r.vencidos > 0 ? 'text-red-600' : 'text-slate-700'}">${r.vencidos}</p>
                        <p class="text-slate-400 text-[10px] uppercase">Vencidos</p>
                    </div>
                </div>
                <!-- Nivel -->
                <span class="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text} text-[11px] font-bold">
                    <span class="w-1.5 h-1.5 rounded-full ${cfg.dot}"></span>${cfg.label}
                </span>
            </div>`;
        }).join('');
    }

    // ──────────────────────────────────────────────────────────────
    // Estado vacío (sin propiedades / contratos / pagos)
    // ──────────────────────────────────────────────────────────────
    function _renderVacio() {
        _set('f-ingresos',  fmtMoney(0));
        _set('f-pendiente', fmtMoney(0));
        _set('f-vencido',   fmtMoney(0));
        _set('f-tasa',      '0%');

        ['chart-flujo', 'chart-estados'].forEach(id =>
            _placeholderCanvas(id, 'Aún no hay datos financieros. Crea contratos y registra pagos.'));

        const cont = document.getElementById('tabla-comportamiento');
        if (cont) {
            cont.innerHTML = `
                <div class="text-center py-10">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-chart-line text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin datos para evaluar</p>
                    <p class="text-slate-400 text-sm">Cuando tus inquilinos tengan pagos, aquí verás su calificación.</p>
                </div>`;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de UI
    // ──────────────────────────────────────────────────────────────
    function _set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value ?? '—');
    }

    /** Sustituye un <canvas> vacío por un mensaje centrado. */
    function _placeholderCanvas(canvasId, msg) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const wrap = canvas.parentElement;
        if (wrap) {
            wrap.innerHTML = `
                <div class="h-full flex flex-col items-center justify-center text-center py-8">
                    <i class="fa-solid fa-chart-simple text-slate-300 text-3xl mb-2"></i>
                    <p class="text-slate-400 text-sm max-w-xs">${esc(msg)}</p>
                </div>`;
        }
    }

    return { init };
})();

window.FINANZAS = FINANZAS;
