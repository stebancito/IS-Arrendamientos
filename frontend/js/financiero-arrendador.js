// ================================================================
// financiero-arrendador.js  –  Módulo Dev 5 (Dashboard Financiero)
// ================================================================
// Responsabilidades:
//   - RF-26    : Calcular ingresos totales del arrendador.
//   - RF-27    : Mostrar pagos pendientes y montos.
//   - RF-28    : Mostrar pagos vencidos y montos.
//   - RF-29/30 : Comparativa de flujo de efectivo con Chart.js.
//   - RN-17    : Cálculo basado exclusivamente en pagos del sistema.
//   - RNF-09   : Agregaciones se hacen en BD vía RPC.
//
// Consume dos funciones RPC de Supabase:
//   obtener_metricas_financieras(p_duenio_id)
//   obtener_flujo_mensual(p_duenio_id)
//
// Además, para el mapa de calor (propiedad × mes) y el scoring por
// inquilino, carga datos granulares (calendario_pagos + registros_pago)
// en UNA sola pasada y los reutiliza en ambos bloques.
//
// Dependencias (CDN en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js
//   Chart.js (https://cdn.jsdelivr.net/npm/chart.js)
// ================================================================

const FINANCIERO_ARRENDADOR = (() => {

    const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    let _usuario     = null;
    let _chartFlujo  = null;
    let _chartDonut  = null;

    // Estado de la gráfica de flujo (controles interactivos)
    let _flujoAll   = [];
    let _flujoState = { period: 12, type: 'bar' };

    // Estado del ranking de inquilinos (orden / filtro)
    let _rankingAll = [];
    let _rankState  = { sort: 'score', filter: 'all', expanded: null };

    // Estado de la tabla de desglose mensual (búsqueda / paginación)
    let _tablaState = { search: '', page: 0, perPage: 6 };

    // Datos del mapa de calor
    let _heat = null;

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;
        _ensureTooltip();

        // Marcar pagos vencidos antes de calcular
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[FINANCIERO] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        // Cargar datos en paralelo
        const [metricas, flujo, granular] = await Promise.all([
            _cargarMetricas(),
            _cargarFlujoMensual(),
            _cargarGranular()
        ]);

        _flujoAll = flujo || [];

        // Derivados de los datos granulares (se construyen antes de los
        // insights, porque estos referencian la propiedad de mayor riesgo).
        _heat = _construirHeatmap(granular);
        _rankingAll = _calcularComportamiento(granular);
        const avanzado = _construirAvanzado(granular);

        _renderMetricas(metricas);
        _renderChartFlujo();
        _renderChartDonut(metricas);
        _renderTablaResumen();
        _renderInsights(metricas, flujo);
        _renderAvanzado(avanzado);
        _renderHeatmap();
        _renderRanking();

        _bindControles();
        _initTilt();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar datos desde RPCs
    // ──────────────────────────────────────────────────────────────
    async function _cargarMetricas() {
        const { data, error } = await window.supabaseClient
            .rpc('obtener_metricas_financieras', { p_duenio_id: _usuario.usuario_id });

        if (error) {
            console.error('[FINANCIERO] Error métricas:', error);
            return null;
        }
        return data?.[0] || data || null;
    }

    async function _cargarFlujoMensual() {
        const { data, error } = await window.supabaseClient
            .rpc('obtener_flujo_mensual', { p_duenio_id: _usuario.usuario_id });

        if (error) {
            console.error('[FINANCIERO] Error flujo mensual:', error);
            return [];
        }
        return data || [];
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar datos granulares (una sola pasada)
    // Devuelve { props, contratos, contMap, pagos, regPorCal }
    // ──────────────────────────────────────────────────────────────
    async function _cargarGranular() {
        try {
            const { data: props } = await window.supabaseClient
                .from('propiedades')
                .select('propiedad_id, nombre, tipo_propiedad')
                .eq('duenio_id', _usuario.usuario_id);

            const propIds = (props || []).map(p => p.propiedad_id);
            if (!propIds.length) return null;

            const propMap = {};
            (props || []).forEach(p => { propMap[p.propiedad_id] = p; });

            const { data: contratos, error } = await window.supabaseClient
                .from('contratos')
                .select(`
                    contrato_id, estado, inquilino_id, propiedad_id,
                    inquilinos (
                        inquilino_id,
                        usuarios ( usuario_id, nombre_completo, correo )
                    )
                `)
                .in('propiedad_id', propIds)
                .in('estado', ['ACTIVO', 'FINALIZADO', 'TERMINADO']);

            if (error || !contratos?.length) return { props, propMap, contratos: [], contMap: {}, pagos: [], regPorCal: {} };

            const contIds = contratos.map(c => c.contrato_id);
            const contMap = {};
            contratos.forEach(c => { contMap[c.contrato_id] = c; });

            const { data: pagos } = await window.supabaseClient
                .from('calendario_pagos')
                .select('calendario_id, contrato_id, monto_esperado, estado, anio, mes, fecha_limite')
                .in('contrato_id', contIds);

            const lista = pagos || [];

            const calIds = lista.map(p => p.calendario_id);
            const regPorCal = {};
            if (calIds.length) {
                const { data: regs } = await window.supabaseClient
                    .from('registros_pago')
                    .select('calendario_id, monto_recibido, metodo_pago, fecha_recibido')
                    .in('calendario_id', calIds);
                (regs || []).forEach(r => { regPorCal[r.calendario_id] = r; });
            }

            return { props, propMap, contratos, contMap, pagos: lista, regPorCal };
        } catch (err) {
            console.error('[FINANCIERO] Error datos granulares:', err);
            return null;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Render de tarjetas de métricas
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas(m) {
        if (!m) return;

        _animCounter('metric-ingresos',     m.ingresos_totales,  true);
        _animCounter('metric-pendientes',   m.pendientes_monto,  true);
        _animCounter('metric-vencidos',     m.vencidos_monto,    true);
        _animCounter('metric-morosidad',    m.tasa_morosidad,    false, '%');
        _animCounter('metric-cumplimiento', m.tasa_cumplimiento, false, '%');

        // Barra de progreso de la tasa de cumplimiento (cobro)
        const cumplBar = document.getElementById('metric-cumplimiento-bar');
        if (cumplBar) {
            const pct = Math.max(0, Math.min(100, parseFloat(m.tasa_cumplimiento) || 0));
            setTimeout(() => { cumplBar.style.width = `${pct}%`; }, 80);
        }

        // Subtextos
        _set('sub-pendientes', `${m.pendientes_count || 0} cuota(s)`);
        _set('sub-vencidos',   `${m.vencidos_count || 0} cuota(s)`);
        _set('sub-pagados',    `${m.pagados_count || 0} de ${m.total_cuotas || 0} cuotas`);
        _set('sub-reportados', `${m.reportados_count || 0} por validar`);

        // Color dinámico de morosidad
        const moroEl = document.getElementById('metric-morosidad');
        if (moroEl) {
            if (m.tasa_morosidad > 20) moroEl.classList.add('text-red-600');
            else if (m.tasa_morosidad > 5) moroEl.classList.add('text-amber-600');
            else moroEl.classList.add('text-green-600');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Chart.js — Flujo esperado vs recibido (interactivo)
    // Lee _flujoState (periodo + tipo de gráfica).
    // ──────────────────────────────────────────────────────────────
    function _renderChartFlujo() {
        const canvas = document.getElementById('chart-flujo');
        if (!canvas) return;

        if (!_flujoAll.length) {
            _mostrarVacioChart('No hay datos mensuales para graficar aún.');
            return;
        }

        const ctx = canvas.getContext('2d');

        // Recorte por periodo seleccionado (6 / 12 / todo)
        const datos = _flujoState.period === 'all'
            ? _flujoAll
            : _flujoAll.slice(-_flujoState.period);

        const labels   = datos.map(d => d.mes_label);
        const esperado = datos.map(d => parseFloat(d.esperado) || 0);
        const recibido = datos.map(d => parseFloat(d.recibido) || 0);

        if (_chartFlujo) _chartFlujo.destroy();

        const esArea = _flujoState.type === 'area';
        const esLinea = _flujoState.type === 'line' || esArea;

        const datasetEsperado = esLinea
            ? {
                label: 'Esperado', data: esperado, type: 'line',
                borderColor: '#94a3b8', borderWidth: 2, borderDash: [6, 4],
                pointRadius: 0, pointHoverRadius: 5, tension: 0.35, fill: false, order: 2
            }
            : {
                label: 'Esperado', data: esperado,
                backgroundColor: 'rgba(30, 58, 138, 0.12)', borderColor: '#1e3a8a',
                borderWidth: 2, borderRadius: 8, barPercentage: 0.6, categoryPercentage: 0.7, order: 2
            };

        const datasetRecibido = {
            label: 'Recibido', data: recibido, type: 'line',
            borderColor: '#3b82f6',
            backgroundColor: esArea ? _gradiente(ctx) : 'rgba(59, 130, 246, 0.08)',
            borderWidth: 3, pointRadius: 5, pointBackgroundColor: '#3b82f6',
            pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 7,
            tension: 0.35, fill: esArea || !esLinea, order: 1
        };

        _chartFlujo = new Chart(ctx, {
            type: esLinea ? 'line' : 'bar',
            data: { labels, datasets: [datasetEsperado, datasetRecibido] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                animation: { duration: 600 },
                plugins: {
                    legend: {
                        position: 'top', align: 'end',
                        labels: {
                            usePointStyle: true, pointStyle: 'rectRounded', padding: 20,
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0f2557',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13, weight: '700' },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        padding: 14, cornerRadius: 12, displayColors: true,
                        callbacks: {
                            label: (c) => ` ${c.dataset.label}: ${_fmtMoney(c.parsed.y)}`,
                            afterBody: (items) => {
                                if (items.length < 2) return '';
                                const esp = items.find(i => i.dataset.label === 'Esperado')?.parsed.y || 0;
                                const rec = items.find(i => i.dataset.label === 'Recibido')?.parsed.y || 0;
                                const pct = esp > 0 ? Math.round((rec / esp) * 100) : 0;
                                return `\n Cobrado: ${pct}% del esperado`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '500' },
                            color: '#64748b', maxRotation: 0, autoSkipPadding: 12
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
                        ticks: {
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
                            color: '#94a3b8', callback: v => _fmtMoneyShort(v)
                        }
                    }
                }
            }
        });
    }

    function _gradiente(ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
        g.addColorStop(1, 'rgba(59, 130, 246, 0.01)');
        return g;
    }

    // ──────────────────────────────────────────────────────────────
    // Chart.js — Donut de distribución de estados
    // ──────────────────────────────────────────────────────────────
    function _renderChartDonut(m) {
        const canvas = document.getElementById('chart-donut');
        if (!canvas || !m) return;

        const ctx = canvas.getContext('2d');

        const valores = [
            parseInt(m.pagados_count) || 0,
            parseInt(m.pendientes_count) || 0,
            parseInt(m.vencidos_count) || 0,
            parseInt(m.reportados_count) || 0
        ];

        if (valores.every(v => v === 0)) return;

        if (_chartDonut) _chartDonut.destroy();

        const total = valores.reduce((a, b) => a + b, 0);

        // Plugin que dibuja el total de cuotas en el centro del donut
        const centerText = {
            id: 'centerTextDonut',
            afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                const cx = (chartArea.left + chartArea.right) / 2;
                const cy = (chartArea.top + chartArea.bottom) / 2;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#0f2557';
                ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
                ctx.fillText(String(total), cx, cy - 7);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '700 9px "Plus Jakarta Sans", system-ui, sans-serif';
                ctx.fillText('CUOTAS', cx, cy + 12);
                ctx.restore();
            }
        };

        _chartDonut = new Chart(ctx, {
            type: 'doughnut',
            plugins: [centerText],
            data: {
                labels: ['Pagados', 'Pendientes', 'Vencidos', 'Reportados'],
                datasets: [{
                    data: valores,
                    backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', '#3b82f6'],
                    borderWidth: 3, borderColor: '#ffffff', hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                animation: { animateRotate: true, animateScale: true },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true, pointStyle: 'circle', padding: 16,
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0f2557',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13, weight: '700' },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        padding: 12, cornerRadius: 10,
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                                return ` ${context.label}: ${context.parsed} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // MAPA DE CALOR — Propiedad × Mes (salud de cobro)
    // ──────────────────────────────────────────────────────────────
    function _construirHeatmap(g) {
        if (!g || !g.pagos?.length) return { meses: [], filas: [] };

        // 1. Conjunto de meses (anio, mes) presentes → ordenados
        const mesesSet = new Map();   // 'a-m' → {anio, mes}
        g.pagos.forEach(p => {
            const k = `${p.anio}-${p.mes}`;
            if (!mesesSet.has(k)) mesesSet.set(k, { anio: p.anio, mes: p.mes });
        });
        let meses = Array.from(mesesSet.values())
            .sort((a, b) => a.anio - b.anio || a.mes - b.mes);
        // Mantener los últimos 12 meses como máximo
        if (meses.length > 12) meses = meses.slice(-12);
        const mesKeys = meses.map(m => `${m.anio}-${m.mes}`);
        const mesIndex = {};
        mesKeys.forEach((k, i) => { mesIndex[k] = i; });

        // 2. Agregar por propiedad × mes
        const porProp = {};   // propId → { nombre, celdas: {mesKey: acc}, totEsp, totRec }
        g.pagos.forEach(p => {
            const mk = `${p.anio}-${p.mes}`;
            if (!(mk in mesIndex)) return;   // fuera de la ventana de 12

            const cont = g.contMap[p.contrato_id];
            if (!cont) return;
            const propId = cont.propiedad_id;
            const prop = g.propMap[propId];
            const nombre = prop?.nombre || `Propiedad ${propId}`;

            if (!porProp[propId]) {
                porProp[propId] = { propId, nombre, tipo: prop?.tipo_propiedad || 'DEPARTAMENTO', celdas: {}, totEsp: 0, totRec: 0 };
            }
            const fila = porProp[propId];
            if (!fila.celdas[mk]) {
                fila.celdas[mk] = { esp: 0, rec: 0, pagados: 0, vencidos: 0, pendientes: 0 };
            }
            const cel = fila.celdas[mk];
            const esp = Number(p.monto_esperado) || 0;
            cel.esp += esp;
            fila.totEsp += esp;
            if (p.estado === 'PAGADO') {
                cel.pagados++;
                const rec = Number(g.regPorCal[p.calendario_id]?.monto_recibido ?? esp) || 0;
                cel.rec += rec;
                fila.totRec += rec;
            } else if (p.estado === 'VENCIDO') {
                cel.vencidos++;
            } else {
                cel.pendientes++;
            }
        });

        const filas = Object.values(porProp)
            .sort((a, b) => {
                // Peor salud de cobro primero (más útil para el arrendador)
                const ra = a.totEsp > 0 ? a.totRec / a.totEsp : 1;
                const rb = b.totEsp > 0 ? b.totRec / b.totEsp : 1;
                return ra - rb;
            });

        return { meses, mesKeys, filas };
    }

    function _bucketCelda(cel) {
        if (!cel || cel.esp === 0) return 'heat-0';
        // Mes futuro sin vencidos ni pagos → pendiente
        if (cel.vencidos === 0 && cel.pagados === 0 && cel.pendientes > 0) return 'heat-pending';
        const r = cel.rec / cel.esp;
        if (r >= 0.999) return 'heat-5';
        if (r >= 0.75)  return 'heat-4';
        if (r >= 0.40)  return 'heat-3';
        if (r > 0)      return 'heat-2';
        return 'heat-1';
    }

    function _renderHeatmap() {
        const cont = document.getElementById('heatmap-container');
        if (!cont) return;

        if (!_heat || !_heat.filas.length) {
            cont.innerHTML = `
                <div class="text-center py-10">
                    <div class="w-14 h-14 mx-auto rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-table-cells text-blue-400 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin actividad para el mapa</p>
                    <p class="text-slate-400 text-sm">Cuando tus propiedades tengan cuotas, verás aquí su salud de cobro mes a mes.</p>
                </div>`;
            return;
        }

        const { meses, mesKeys, filas } = _heat;
        const cols = `minmax(130px, 1fr) repeat(${meses.length}, minmax(28px, 54px))`;

        // Cabecera
        let cells = `<div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-end pb-1">Propiedad</div>`;
        meses.forEach((m, ci) => {
            cells += `<div class="heat-collabel text-center transition-colors" data-col="${ci}">
                        <div class="text-[10px] font-bold text-slate-500 leading-none">${MESES[m.mes - 1]}</div>
                        <div class="text-[9px] text-slate-300 leading-none mt-0.5">'${String(m.anio).slice(-2)}</div>
                      </div>`;
        });

        const tipoIcon = {
            EDIFICIO: 'fa-building', DEPARTAMENTO: 'fa-door-closed',
            CASA: 'fa-house', LOCAL: 'fa-store', TERRENO: 'fa-mountain-sun'
        };

        // Filas
        filas.forEach((fila, ri) => {
            const ratio = fila.totEsp > 0 ? Math.round((fila.totRec / fila.totEsp) * 100) : 0;
            const ratioColor = ratio >= 90 ? 'text-green-600' : ratio >= 50 ? 'text-amber-600' : 'text-red-600';
            const ico = tipoIcon[fila.tipo] || 'fa-house';
            cells += `
                <div class="heat-rowlabel flex items-center gap-1.5 min-w-0 pr-1 px-1.5 py-1 transition-colors" data-row="${ri}" title="${esc(fila.nombre)}">
                    <i class="fa-solid ${ico} text-slate-300 text-[11px] flex-shrink-0"></i>
                    <span class="text-xs font-semibold text-slate-700 truncate">${esc(fila.nombre)}</span>
                    <span class="ml-auto text-[10px] font-bold ${ratioColor} flex-shrink-0">${ratio}%</span>
                </div>`;
            mesKeys.forEach((mk, ci) => {
                const cel = fila.celdas[mk];
                const bucket = _bucketCelda(cel);
                const m = meses[ci];
                const payload = cel
                    ? `${esc(fila.nombre)}|${MESES[m.mes - 1]} ${m.anio}|${cel.esp}|${cel.rec}|${cel.pagados}|${cel.pendientes}|${cel.vencidos}`
                    : `${esc(fila.nombre)}|${MESES[m.mes - 1]} ${m.anio}|0|0|0|0|0`;
                const delay = (ri + ci) * 22;   // entrada escalonada (efecto oleada)
                cells += `<div class="heat-cell heat-pop ${bucket}" tabindex="0" role="img"
                               style="animation-delay:${delay}ms"
                               data-row="${ri}" data-col="${ci}"
                               data-tip="${payload}"
                               aria-label="${esc(fila.nombre)} ${MESES[m.mes - 1]} ${m.anio}"></div>`;
            });
        });

        cont.innerHTML = `<div class="heatmap-grid" id="heatmap-grid" style="grid-template-columns:${cols}">${cells}</div>`;

        const grid = document.getElementById('heatmap-grid');

        // Eventos de tooltip + resaltado cruzado (fila/columna)
        cont.querySelectorAll('.heat-cell').forEach(el => {
            el.addEventListener('mouseenter', (e) => { _onHeatEnter(e); _heatCross(grid, el, true); });
            el.addEventListener('mousemove', _onHeatMove);
            el.addEventListener('mouseleave', (e) => { _hideTip(); _heatCross(grid, el, false); });
            el.addEventListener('focus', (e) => { _onHeatEnter(e); _heatCross(grid, el, true); });
            el.addEventListener('blur', (e) => { _hideTip(); _heatCross(grid, el, false); });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // MÉTRICAS AVANZADAS (estilo Power BI)
    //   1. Antigüedad de la cartera vencida (aging buckets).
    //   2. Distribución por método de pago.
    //   3. Proyección de ingresos de los próximos meses + días
    //      promedio de cobro.
    // ──────────────────────────────────────────────────────────────
    function _construirAvanzado(g) {
        if (!g || !g.pagos?.length) return null;

        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

        const aging = [
            { label: '1–30 días',  monto: 0, count: 0, color: '#f59e0b' },
            { label: '31–60 días', monto: 0, count: 0, color: '#fb923c' },
            { label: '61–90 días', monto: 0, count: 0, color: '#f87171' },
            { label: '+90 días',   monto: 0, count: 0, color: '#dc2626' },
        ];
        const metodos = {};                 // metodo → { monto, count }
        const proj = {};                    // 'anio-mes' → monto
        let totalCobrado = 0, diasAcum = 0, diasCount = 0;

        g.pagos.forEach(p => {
            const monto = Number(p.monto_esperado) || 0;

            if (p.estado === 'VENCIDO') {
                const fl = p.fecha_limite ? new Date(p.fecha_limite + 'T00:00:00') : null;
                const dias = fl ? Math.floor((hoy - fl) / 86400000) : 0;
                const b = dias <= 30 ? aging[0] : dias <= 60 ? aging[1] : dias <= 90 ? aging[2] : aging[3];
                b.monto += monto; b.count++;
            } else if (p.estado === 'PAGADO') {
                const reg = g.regPorCal[p.calendario_id];
                const rec = Number(reg?.monto_recibido ?? monto) || 0;
                totalCobrado += rec;
                const met = reg?.metodo_pago || 'OTRO';
                if (!metodos[met]) metodos[met] = { monto: 0, count: 0 };
                metodos[met].monto += rec; metodos[met].count++;
                if (reg?.fecha_recibido && p.fecha_limite) {
                    const d = Math.round((new Date(reg.fecha_recibido) - new Date(p.fecha_limite)) / 86400000);
                    diasAcum += d; diasCount++;
                }
            } else { // PENDIENTE / REPORTADO
                const key = `${p.anio}-${String(p.mes).padStart(2, '0')}`;
                proj[key] = (proj[key] || 0) + monto;
            }
        });

        const agingTotal = aging.reduce((a, b) => a + b.monto, 0);
        const metodosArr = Object.entries(metodos)
            .map(([metodo, v]) => ({ metodo, ...v }))
            .sort((a, b) => b.monto - a.monto);

        const curKey = hoy.getFullYear() * 12 + hoy.getMonth();
        const projFut = Object.entries(proj)
            .map(([k, monto]) => { const [a, m] = k.split('-').map(Number); return { anio: a, mes: m, monto }; })
            .filter(d => (d.anio * 12 + (d.mes - 1)) >= curKey)
            .sort((a, b) => a.anio - b.anio || a.mes - b.mes)
            .slice(0, 6);

        const diasProm = diasCount ? Math.round(diasAcum / diasCount) : null;

        return { aging, agingTotal, metodosArr, totalCobrado, projFut, diasProm };
    }

    function _renderAvanzado(av) {
        _renderAging(av);
        _renderMetodos(av);
        _renderProyeccion(av);
    }

    function _renderAging(av) {
        const cont = document.getElementById('aging-container');
        if (!cont) return;

        if (!av || av.agingTotal === 0) {
            cont.innerHTML = `
                <div class="flex flex-col items-center justify-center text-center py-6">
                    <div class="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mb-2">
                        <i class="fa-solid fa-shield-heart text-green-500 text-lg"></i>
                    </div>
                    <p class="text-slate-700 font-semibold text-sm">Sin saldos vencidos</p>
                    <p class="text-slate-400 text-xs">Toda tu cartera está al corriente.</p>
                </div>`;
            return;
        }

        const seg = av.aging.map(b => {
            const w = av.agingTotal > 0 ? (b.monto / av.agingTotal * 100) : 0;
            return w > 0 ? `<div class="adv-seg" style="width:${w}%;background:${b.color}" title="${b.label}: ${_fmtMoney(b.monto)}"></div>` : '';
        }).join('');

        const list = av.aging.map(b => `
            <div class="flex items-center justify-between text-xs py-1.5">
                <span class="flex items-center gap-2 text-slate-600">
                    <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${b.color}"></span>${b.label}
                </span>
                <span class="font-semibold text-slate-700">${_fmtMoney(b.monto)}
                    <span class="text-slate-400 font-normal text-[10px]">· ${b.count}</span>
                </span>
            </div>`).join('');

        cont.innerHTML = `
            <p class="text-2xl font-extrabold text-slate-900 leading-none mb-0.5">${_fmtMoney(av.agingTotal)}</p>
            <p class="text-[11px] text-slate-400 mb-3">total vencido por cobrar</p>
            <div class="flex h-2.5 rounded-full overflow-hidden bg-slate-100 mb-3">${seg}</div>
            ${list}`;
    }

    function _renderMetodos(av) {
        const cont = document.getElementById('metodos-container');
        if (!cont) return;

        if (!av || !av.metodosArr.length) {
            cont.innerHTML = `
                <div class="flex flex-col items-center justify-center text-center py-6">
                    <div class="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-2">
                        <i class="fa-solid fa-wallet text-blue-400 text-lg"></i>
                    </div>
                    <p class="text-slate-700 font-semibold text-sm">Aún sin cobros</p>
                    <p class="text-slate-400 text-xs">Cuando registres pagos verás aquí su método.</p>
                </div>`;
            return;
        }

        const labelMap = { TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo', DEPOSITO: 'Depósito', TARJETA: 'Tarjeta', CHEQUE: 'Cheque', OTRO: 'Otro' };
        const iconMap  = { TRANSFERENCIA: 'fa-building-columns', EFECTIVO: 'fa-money-bill-wave', DEPOSITO: 'fa-piggy-bank', TARJETA: 'fa-credit-card', CHEQUE: 'fa-money-check-dollar', OTRO: 'fa-ellipsis' };
        const total = av.totalCobrado || 1;

        cont.innerHTML = `
            <p class="text-2xl font-extrabold text-slate-900 leading-none mb-0.5">${_fmtMoney(av.totalCobrado)}</p>
            <p class="text-[11px] text-slate-400 mb-3">cobrado en total</p>
            ${av.metodosArr.map(m => {
                const pct = Math.round(m.monto / total * 100);
                return `
                <div class="mb-3 last:mb-0">
                    <div class="flex items-center justify-between text-xs mb-1">
                        <span class="flex items-center gap-2 text-slate-600 font-medium">
                            <i class="fa-solid ${iconMap[m.metodo] || 'fa-ellipsis'} text-slate-400 w-4 text-center"></i>
                            ${labelMap[m.metodo] || esc(m.metodo)}
                        </span>
                        <span class="font-semibold text-slate-700">${_fmtMoney(m.monto)} · ${pct}%</span>
                    </div>
                    <div class="adv-bar h-2 bg-slate-100 rounded-full overflow-hidden">
                        <span class="bg-gradient-to-r from-blue-500 to-blue-600" style="width:${pct}%"></span>
                    </div>
                </div>`;
            }).join('')}`;
    }

    function _renderProyeccion(av) {
        const cont = document.getElementById('proyeccion-container');
        if (!cont) return;

        const diasHtml = (av && av.diasProm != null) ? `
            <div class="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 mb-3 text-xs">
                <span class="text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-stopwatch text-slate-400"></i> Días prom. de cobro</span>
                <span class="font-bold ${av.diasProm > 0 ? 'text-amber-600' : 'text-green-600'}">${av.diasProm > 0 ? '+' : ''}${av.diasProm} d</span>
            </div>` : '';

        if (!av || !av.projFut.length) {
            cont.innerHTML = `${diasHtml}
                <div class="flex flex-col items-center justify-center text-center py-5">
                    <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-2">
                        <i class="fa-solid fa-binoculars text-indigo-400 text-lg"></i>
                    </div>
                    <p class="text-slate-700 font-semibold text-sm">Sin cuotas futuras</p>
                    <p class="text-slate-400 text-xs">No hay pagos pendientes programados.</p>
                </div>`;
            return;
        }

        const totalProj = av.projFut.reduce((a, d) => a + d.monto, 0);
        const maxMonto = Math.max(...av.projFut.map(d => d.monto), 1);

        const rows = av.projFut.map(d => {
            const w = Math.round(d.monto / maxMonto * 100);
            return `
            <div class="py-1.5">
                <div class="flex items-center justify-between text-xs mb-1">
                    <span class="text-slate-600 font-medium">${MESES[d.mes - 1]} ${d.anio}</span>
                    <span class="font-semibold text-slate-800">${_fmtMoney(d.monto)}</span>
                </div>
                <div class="adv-bar h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <span class="bg-gradient-to-r from-indigo-400 to-indigo-600" style="width:${w}%"></span>
                </div>
            </div>`;
        }).join('');

        cont.innerHTML = `${diasHtml}
            <p class="text-2xl font-extrabold text-slate-900 leading-none mb-0.5">${_fmtMoney(totalProj)}</p>
            <p class="text-[11px] text-slate-400 mb-3">esperado próximos ${av.projFut.length} mes(es)</p>
            ${rows}`;
    }

    // Resalta la fila y columna de la celda activa (efecto cruz)
    function _heatCross(grid, cell, on) {
        if (!grid) return;
        const ri = cell.getAttribute('data-row');
        const ci = cell.getAttribute('data-col');
        grid.classList.toggle('dimmed', on);
        grid.querySelectorAll('.heat-cell').forEach(c => {
            const match = c.getAttribute('data-row') === ri || c.getAttribute('data-col') === ci;
            c.classList.toggle('heat-cross', on && match);
        });
        grid.querySelector(`.heat-rowlabel[data-row="${ri}"]`)?.classList.toggle('hl', on);
        grid.querySelector(`.heat-collabel[data-col="${ci}"]`)?.classList.toggle('hl', on);
    }

    function _onHeatEnter(e) {
        const raw = e.currentTarget.getAttribute('data-tip');
        if (!raw) return;
        const [nombre, periodo, esp, rec, pag, pen, ven] = raw.split('|');
        const espN = Number(esp), recN = Number(rec);
        const pct = espN > 0 ? Math.round((recN / espN) * 100) : 0;
        const sinCuota = espN === 0;
        const html = `
            <div class="tt-title">${esc(nombre)}</div>
            <div class="tt-muted" style="margin-bottom:5px">${esc(periodo)}</div>
            ${sinCuota
                ? '<div>Sin cuota este mes</div>'
                : `<div class="tt-row"><span class="tt-muted">Esperado</span><span>${_fmtMoney(espN)}</span></div>
                   <div class="tt-row"><span class="tt-muted">Cobrado</span><span>${_fmtMoney(recN)} · ${pct}%</span></div>
                   <div class="tt-bar"><span style="width:${Math.min(100, pct)}%"></span></div>
                   <div class="tt-row" style="margin-top:6px"><span class="tt-muted">Estados</span>
                       <span>${pag}✓ · ${pen}⏳ · ${ven}⚠</span></div>`
            }`;
        _showTip(html, e);
    }

    function _onHeatMove(e) { _moveTip(e); }

    // ──────────────────────────────────────────────────────────────
    // Tabla de resumen mensual
    // ──────────────────────────────────────────────────────────────
    function _renderTablaResumen() {
        const cont = document.getElementById('tabla-resumen');
        if (!cont) return;

        if (!_flujoAll.length) {
            cont.innerHTML = `<p class="text-slate-400 text-sm text-center py-6">Sin datos mensuales aún.</p>`;
            return;
        }

        // Filtro por búsqueda (sobre el nombre del periodo)
        const q = _tablaState.search.toLowerCase().trim();
        const filtrados = q
            ? _flujoAll.filter(d => (d.mes_label || '').toLowerCase().includes(q))
            : _flujoAll.slice();

        // Más reciente primero
        const ordenados = filtrados.slice().reverse();

        if (!ordenados.length) {
            cont.innerHTML = `
                <div class="text-center py-8">
                    <i class="fa-solid fa-magnifying-glass text-slate-300 text-xl mb-2"></i>
                    <p class="text-slate-500 text-sm">Ningún periodo coincide con “${esc(_tablaState.search)}”.</p>
                </div>`;
            return;
        }

        // Totales sobre el conjunto filtrado
        const totEsp = filtrados.reduce((a, d) => a + (parseFloat(d.esperado) || 0), 0);
        const totRec = filtrados.reduce((a, d) => a + (parseFloat(d.recibido) || 0), 0);
        const totDiff = totRec - totEsp;

        // Paginación
        const perPage = _tablaState.perPage;
        const totalPages = Math.max(1, Math.ceil(ordenados.length / perPage));
        if (_tablaState.page >= totalPages) _tablaState.page = totalPages - 1;
        if (_tablaState.page < 0) _tablaState.page = 0;
        const inicio = _tablaState.page * perPage;
        const pagina = ordenados.slice(inicio, inicio + perPage);

        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="border-b border-slate-100 bg-slate-50/50">
                            <th class="text-left py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Periodo</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Esperado</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Recibido</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Diferencia</th>
                            <th class="text-center py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Estado</th>
                        </tr>
                    </thead>
                    <tbody>`;

        pagina.forEach(d => {
            const esp = parseFloat(d.esperado) || 0;
            const rec = parseFloat(d.recibido) || 0;
            const diff = rec - esp;
            const diffColor = diff >= 0 ? 'text-green-600' : 'text-red-600';
            const diffSign  = diff >= 0 ? '+' : '';

            let estadoBadge = '';
            if (parseInt(d.vencidos) > 0) {
                estadoBadge = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 text-[9px] font-bold">
                    <span class="w-1 h-1 rounded-full bg-red-500"></span> ${d.vencidos} vencido(s)
                </span>`;
            } else if (parseInt(d.pendientes) > 0) {
                estadoBadge = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[9px] font-bold">
                    <span class="w-1 h-1 rounded-full bg-amber-500"></span> ${d.pendientes} pendiente(s)
                </span>`;
            } else {
                estadoBadge = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 text-[9px] font-bold">
                    <span class="w-1 h-1 rounded-full bg-green-500"></span> Al día
                </span>`;
            }

            html += `
                <tr class="border-b border-slate-50 hover:bg-blue-50/40 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(d.mes_label)}</td>
                    <td class="py-2.5 px-3 text-right text-slate-600">${_fmtMoney(esp)}</td>
                    <td class="py-2.5 px-3 text-right font-semibold text-slate-800">${_fmtMoney(rec)}</td>
                    <td class="py-2.5 px-3 text-right font-semibold ${diffColor}">${diffSign}${_fmtMoney(Math.abs(diff))}</td>
                    <td class="py-2.5 px-3 text-center">${estadoBadge}</td>
                </tr>`;
        });

        const totDiffColor = totDiff >= 0 ? 'text-green-600' : 'text-red-600';
        const totDiffSign  = totDiff >= 0 ? '+' : '';

        html += `
                    </tbody>
                    <tfoot>
                        <tr class="border-t-2 border-slate-100 bg-slate-50/70">
                            <td class="py-2.5 px-3 font-bold text-slate-700 text-[11px] uppercase tracking-wide">Totales${q ? ' (filtro)' : ''}</td>
                            <td class="py-2.5 px-3 text-right font-bold text-slate-800">${_fmtMoney(totEsp)}</td>
                            <td class="py-2.5 px-3 text-right font-bold text-slate-800">${_fmtMoney(totRec)}</td>
                            <td class="py-2.5 px-3 text-right font-bold ${totDiffColor}">${totDiffSign}${_fmtMoney(Math.abs(totDiff))}</td>
                            <td class="py-2.5 px-3 text-center text-[10px] text-slate-400 font-semibold">${filtrados.length} mes(es)</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;

        // Controles de paginación
        if (totalPages > 1) {
            let nums = '';
            for (let i = 0; i < totalPages; i++) {
                nums += `<button class="page-btn" data-page="${i}" aria-current="${i === _tablaState.page ? 'true' : 'false'}">${i + 1}</button>`;
            }
            html += `
                <div class="flex items-center justify-between gap-2 px-3 py-3 border-t border-slate-100">
                    <p class="text-[11px] text-slate-400 font-medium">Mostrando ${inicio + 1}–${Math.min(inicio + perPage, ordenados.length)} de ${ordenados.length}</p>
                    <div class="flex items-center gap-1.5">
                        <button class="page-btn" data-page="prev" ${_tablaState.page === 0 ? 'disabled' : ''} aria-label="Anterior">‹</button>
                        ${nums}
                        <button class="page-btn" data-page="next" ${_tablaState.page >= totalPages - 1 ? 'disabled' : ''} aria-label="Siguiente">›</button>
                    </div>
                </div>`;
        }

        cont.innerHTML = html;

        // Bind de paginación
        cont.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-page');
                if (v === 'prev') _tablaState.page = Math.max(0, _tablaState.page - 1);
                else if (v === 'next') _tablaState.page = _tablaState.page + 1;
                else _tablaState.page = parseInt(v, 10);
                _renderTablaResumen();
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Insights / análisis inteligente
    // ──────────────────────────────────────────────────────────────
    function _renderInsights(m, flujo) {
        const cont = document.getElementById('insights-container');
        if (!cont || !m) return;

        const insights = [];

        if (m.total_cuotas > 0 && parseFloat(m.esperado_total) > 0) {
            const tasaCobro = parseFloat(m.ingresos_totales) / parseFloat(m.esperado_total) * 100;
            if (tasaCobro >= 95) {
                insights.push({ icon: 'fa-trophy', color: 'green',
                    titulo: 'Excelente tasa de cobro',
                    texto: `Has cobrado el ${Math.round(tasaCobro)}% del total esperado. Tu gestión de cobros es sobresaliente.` });
            } else if (tasaCobro >= 70) {
                insights.push({ icon: 'fa-chart-line', color: 'amber',
                    titulo: 'Tasa de cobro mejorable',
                    texto: `Has cobrado ${Math.round(tasaCobro)}% del total esperado. Revisa los pagos pendientes y vencidos.` });
            } else {
                insights.push({ icon: 'fa-triangle-exclamation', color: 'red',
                    titulo: 'Atención: tasa de cobro baja',
                    texto: `Solo has cobrado ${Math.round(tasaCobro)}% del esperado. Hay ${m.vencidos_count} cuota(s) vencida(s) por atender.` });
            }
        }

        if (parseFloat(m.tasa_morosidad) > 15) {
            insights.push({ icon: 'fa-exclamation-circle', color: 'red',
                titulo: 'Morosidad elevada',
                texto: `La tasa de morosidad es del ${m.tasa_morosidad}%. Considera contactar a los inquilinos con pagos vencidos.` });
        } else if (parseFloat(m.tasa_morosidad) === 0 && m.total_cuotas > 0) {
            insights.push({ icon: 'fa-shield-heart', color: 'green',
                titulo: 'Cartera sana',
                texto: 'No tienes cuotas vencidas. Tu cartera de cobranza está completamente al día.' });
        }

        // Inquilinos en riesgo (del scoring por inquilino)
        if (_rankingAll && _rankingAll.length) {
            const enRiesgo = _rankingAll.filter(r => r.nivel === 'ROJO').length;
            if (enRiesgo > 0) {
                insights.push({ icon: 'fa-user-clock', color: 'amber',
                    titulo: `${enRiesgo} inquilino(s) en riesgo`,
                    texto: 'Acumulan cuotas vencidas o bajo cumplimiento. Revisa su calificación en la tabla de comportamiento.' });
            }
        }

        // Propiedad con peor salud de cobro (del mapa de calor)
        if (_heat && _heat.filas.length) {
            const peor = _heat.filas[0];
            const ratio = peor.totEsp > 0 ? Math.round((peor.totRec / peor.totEsp) * 100) : 100;
            if (ratio < 50 && peor.totEsp > 0) {
                insights.push({ icon: 'fa-house-circle-exclamation', color: 'red',
                    titulo: 'Propiedad de mayor riesgo',
                    texto: `“${peor.nombre}” solo ha cobrado ${ratio}% de lo esperado. Es la que más arrastra tus finanzas.` });
            }
        }

        if (flujo.length >= 2) {
            const ultimos = flujo.slice(-2);
            const recAnterior = parseFloat(ultimos[0].recibido) || 0;
            const recActual   = parseFloat(ultimos[1].recibido) || 0;
            if (recActual > recAnterior && recAnterior > 0) {
                const cambio = Math.round(((recActual - recAnterior) / recAnterior) * 100);
                insights.push({ icon: 'fa-arrow-trend-up', color: 'green',
                    titulo: 'Ingresos en alza',
                    texto: `Los ingresos recibidos subieron ${cambio}% respecto al mes anterior.` });
            } else if (recActual < recAnterior && recAnterior > 0) {
                const cambio = Math.round(((recAnterior - recActual) / recAnterior) * 100);
                insights.push({ icon: 'fa-arrow-trend-down', color: 'red',
                    titulo: 'Ingresos en baja',
                    texto: `Los ingresos cayeron ${cambio}% respecto al mes anterior. Revisa pagos pendientes.` });
            }
        }

        if (!insights.length) {
            cont.innerHTML = `
                <div class="text-center py-4">
                    <i class="fa-solid fa-sparkles text-blue-400 text-xl mb-2"></i>
                    <p class="text-slate-500 text-xs">Los insights aparecerán cuando haya suficientes datos.</p>
                </div>`;
            return;
        }

        const colorMap = {
            green: { bg: 'bg-green-50', border: 'border-green-100', icon: 'text-green-600', text: 'text-green-800' },
            amber: { bg: 'bg-amber-50', border: 'border-amber-100', icon: 'text-amber-600', text: 'text-amber-800' },
            red:   { bg: 'bg-red-50',   border: 'border-red-100',   icon: 'text-red-600',   text: 'text-red-800' }
        };

        cont.innerHTML = insights.slice(0, 4).map(ins => {
            const c = colorMap[ins.color] || colorMap.green;
            return `
                <div class="${c.bg} ${c.border} border rounded-xl p-3.5 flex items-start gap-3">
                    <div class="w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center flex-shrink-0">
                        <i class="fa-solid ${ins.icon} ${c.icon} text-sm"></i>
                    </div>
                    <div class="min-w-0">
                        <p class="${c.text} font-bold text-xs">${esc(ins.titulo)}</p>
                        <p class="text-slate-600 text-[11px] mt-0.5 leading-relaxed">${esc(ins.texto)}</p>
                    </div>
                </div>`;
        }).join('');
    }

    // ──────────────────────────────────────────────────────────────
    // Comportamiento financiero por inquilino (puntaje 0-100)
    // ──────────────────────────────────────────────────────────────
    function _calcularComportamiento(g) {
        if (!g || !g.pagos?.length) return [];

        const porInq = {};

        g.pagos.forEach(p => {
            const cont = g.contMap[p.contrato_id];
            const inqUsr = cont?.inquilinos?.usuarios;
            if (!inqUsr?.usuario_id) return;

            const id = inqUsr.usuario_id;
            if (!porInq[id]) {
                porInq[id] = {
                    usuario_id: id,
                    nombre: inqUsr.nombre_completo || 'Inquilino',
                    correo: inqUsr.correo || '',
                    total: 0, pagados: 0, pendientes: 0, vencidos: 0,
                    cobrado: 0, esperado: 0, puntualidad: 0,
                };
            }
            const acc = porInq[id];
            const monto = Number(p.monto_esperado) || 0;
            acc.total++;
            acc.esperado += monto;
            if (p.estado === 'PAGADO') {
                acc.pagados++;
                const reg = g.regPorCal[p.calendario_id];
                acc.cobrado += Number(reg?.monto_recibido ?? monto) || 0;
            } else if (p.estado === 'VENCIDO') {
                acc.vencidos++;
            } else {
                acc.pendientes++;
            }
        });

        const ranking = Object.values(porInq).map(acc => {
            const cumplimiento = acc.total > 0 ? Math.round((acc.pagados / acc.total) * 100) : 0;
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

        return ranking;
    }

    function _ordenarFiltrar() {
        let arr = _rankingAll.slice();

        // Filtro
        if (_rankState.filter === 'riesgo') arr = arr.filter(r => r.nivel === 'ROJO');
        else if (_rankState.filter === 'aldia') arr = arr.filter(r => r.nivel === 'VERDE');

        // Orden
        if (_rankState.sort === 'score') {
            arr.sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1));
        } else if (_rankState.sort === 'riesgo') {
            arr.sort((a, b) => (a.puntaje ?? 101) - (b.puntaje ?? 101));
        } else if (_rankState.sort === 'vencidos') {
            arr.sort((a, b) => b.vencidos - a.vencidos);
        } else if (_rankState.sort === 'nombre') {
            arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
        }
        return arr;
    }

    function _renderRanking() {
        const cont = document.getElementById('tabla-comportamiento');
        if (!cont) return;

        const ranking = _ordenarFiltrar();

        if (!ranking.length) {
            cont.innerHTML = `
                <div class="text-center py-10">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-chart-line text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin inquilinos en esta vista</p>
                    <p class="text-slate-400 text-sm">Ajusta el filtro o registra pagos para ver calificaciones.</p>
                </div>`;
            return;
        }

        const nivelCfg = {
            VERDE:    { label:'Excelente', bg:'bg-green-50',  text:'text-green-700',  dot:'bg-green-500',  ring:'#22c55e', track:'bg-green-100' },
            AMARILLO: { label:'Regular',   bg:'bg-amber-50',  text:'text-amber-700',  dot:'bg-amber-500',  ring:'#f59e0b', track:'bg-amber-100' },
            ROJO:     { label:'En riesgo', bg:'bg-red-50',    text:'text-red-700',    dot:'bg-red-500',    ring:'#ef4444', track:'bg-red-100'   },
            NEUTRO:   { label:'Sin datos', bg:'bg-slate-50',  text:'text-slate-500',  dot:'bg-slate-400',  ring:'#94a3b8', track:'bg-slate-100' },
        };

        const R = 18, C = 2 * Math.PI * R;

        cont.innerHTML = ranking.map((r, i) => {
            const cfg = nivelCfg[r.nivel] || nivelCfg.NEUTRO;
            const iniciales = (r.nombre || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            const puntaje = r.puntaje != null ? r.puntaje : 0;
            const puntajeTxt = r.puntaje != null ? r.puntaje : '—';
            const offset = C - (puntaje / 100) * C;
            const pctCobro = r.esperado > 0 ? Math.round((r.cobrado / r.esperado) * 100) : 0;
            const expanded = _rankState.expanded === r.usuario_id;

            return `
            <div class="row-clickable" data-uid="${r.usuario_id}">
              <div class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition rounded-xl">
                <!-- Anillo de puntaje -->
                <div class="relative w-12 h-12 flex-shrink-0" title="Puntaje ${puntajeTxt}/100">
                    <svg class="ring-progress w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r="${R}" fill="none" stroke="#f1f5f9" stroke-width="4"></circle>
                        <circle cx="22" cy="22" r="${R}" fill="none" stroke="${cfg.ring}" stroke-width="4"
                                stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}"
                                stroke-dashoffset="${r.puntaje != null ? offset.toFixed(1) : C.toFixed(1)}"></circle>
                    </svg>
                    <span class="absolute inset-0 flex items-center justify-center ${cfg.text} font-extrabold text-sm">${puntajeTxt}</span>
                </div>
                <!-- Identidad -->
                <div class="flex items-center gap-2.5 flex-1 min-w-0">
                    <div class="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="min-w-0 flex-1">
                        <p class="text-slate-900 font-semibold text-sm truncate">${esc(r.nombre)}</p>
                        <div class="flex items-center gap-2 mt-1">
                            <div class="score-track flex-1 max-w-[160px]">
                                <div class="score-fill ${cfg.dot}" style="width:${puntaje}%"></div>
                            </div>
                            <span class="text-[10px] text-slate-400 truncate hidden sm:inline">${esc(r.correo)}</span>
                        </div>
                    </div>
                </div>
                <!-- Métricas (rejilla detallada en sm+) -->
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
                <!-- Nivel + chevron -->
                <span class="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text} text-[11px] font-bold">
                    <span class="w-1.5 h-1.5 rounded-full ${cfg.dot}"></span>${cfg.label}
                </span>
                <i class="fa-solid fa-chevron-down text-slate-300 text-[10px] transition-transform ${expanded ? 'rotate-180' : ''}"></i>
              </div>
              <!-- Detalle expandible -->
              <div class="row-detail ${expanded ? '' : 'hidden'} px-4 pb-3">
                <div class="bg-slate-50 rounded-xl p-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div><p class="text-slate-400 text-[10px] uppercase tracking-wide">Cuotas</p><p class="font-bold text-slate-800 text-sm">${r.total}</p></div>
                    <div><p class="text-slate-400 text-[10px] uppercase tracking-wide">Pendientes</p><p class="font-bold text-amber-600 text-sm">${r.pendientes}</p></div>
                    <div><p class="text-slate-400 text-[10px] uppercase tracking-wide">Esperado</p><p class="font-bold text-slate-800 text-sm">${_fmtMoney(r.esperado)}</p></div>
                    <div><p class="text-slate-400 text-[10px] uppercase tracking-wide">Cobrado</p><p class="font-bold text-green-600 text-sm">${_fmtMoney(r.cobrado)} · ${pctCobro}%</p></div>
                </div>
                <div class="flex items-center gap-2 mt-2.5">
                    <a href="pagos.html" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f2557] text-white text-[11px] font-semibold hover:bg-[#15346f] transition">
                        <i class="fa-solid fa-money-bill-wave text-[10px]"></i> Registrar pago
                    </a>
                    ${r.correo ? `<a href="mailto:${esc(r.correo)}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold hover:bg-slate-100 transition">
                        <i class="fa-solid fa-envelope text-[10px]"></i> Contactar
                    </a>` : ''}
                </div>
              </div>
            </div>`;
        }).join('');

        // Toggle de detalle al hacer click en la fila
        cont.querySelectorAll('.row-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('a')) return;   // no togglear si se clickeó un enlace
                const uid = Number(row.getAttribute('data-uid'));
                _rankState.expanded = (_rankState.expanded === uid) ? null : uid;
                _renderRanking();
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Controles interactivos (toggles, filtros, export)
    // ──────────────────────────────────────────────────────────────
    function _bindControles() {
        // Periodo de la gráfica de flujo
        document.querySelectorAll('[data-flujo-period]').forEach(btn => {
            btn.addEventListener('click', () => {
                const v = btn.getAttribute('data-flujo-period');
                _flujoState.period = v === 'all' ? 'all' : parseInt(v);
                _segActivar('[data-flujo-period]', btn);
                _renderChartFlujo();
            });
        });

        // Tipo de gráfica
        document.querySelectorAll('[data-flujo-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                _flujoState.type = btn.getAttribute('data-flujo-type');
                _segActivar('[data-flujo-type]', btn);
                _renderChartFlujo();
            });
        });

        // Orden del ranking
        const sortSel = document.getElementById('rank-sort');
        if (sortSel) sortSel.addEventListener('change', () => {
            _rankState.sort = sortSel.value;
            _renderRanking();
        });

        // Filtros del ranking
        document.querySelectorAll('[data-rank-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                _rankState.filter = btn.getAttribute('data-rank-filter');
                _segActivar('[data-rank-filter]', btn);
                _renderRanking();
            });
        });

        // Búsqueda en el desglose mensual
        const desgInput = document.getElementById('desglose-search');
        if (desgInput) desgInput.addEventListener('input', () => {
            _tablaState.search = desgInput.value;
            _tablaState.page = 0;
            _renderTablaResumen();
        });

        // Exportar CSV
        const expBtn = document.getElementById('btn-export-csv');
        if (expBtn) expBtn.addEventListener('click', _exportarCSV);
    }

    function _segActivar(selector, activeBtn) {
        document.querySelectorAll(selector).forEach(b => {
            b.setAttribute('aria-pressed', b === activeBtn ? 'true' : 'false');
        });
    }

    function _exportarCSV() {
        if (!_flujoAll.length) {
            window.TOAST?.mostrar?.('No hay datos para exportar.', 'warning');
            return;
        }
        const filas = [['Periodo', 'Esperado', 'Recibido', 'Diferencia', 'Pagados', 'Pendientes', 'Vencidos']];
        _flujoAll.forEach(d => {
            const esp = parseFloat(d.esperado) || 0;
            const rec = parseFloat(d.recibido) || 0;
            filas.push([d.mes_label, esp, rec, (rec - esp), d.pagados || 0, d.pendientes || 0, d.vencidos || 0]);
        });
        const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(["﻿" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flujo-efectivo-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        window.TOAST?.mostrar?.('Reporte exportado a CSV.', 'success');
    }

    // ──────────────────────────────────────────────────────────────
    // Efecto TILT 3D: las tarjetas se inclinan siguiendo al puntero.
    // Se aplica a los elementos con clase .tilt. Respeta "reducir
    // movimiento" y se desactiva en pantallas pequeñas / táctiles.
    // ──────────────────────────────────────────────────────────────
    function _initTilt() {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;

        const MAX = 7;   // grados máximos de inclinación
        document.querySelectorAll('.tilt').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                if (window.innerWidth < 768) return;
                const r = card.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width - 0.5;    // -0.5 … 0.5
                const py = (e.clientY - r.top) / r.height - 0.5;
                card.style.transform =
                    `perspective(850px) rotateY(${(px * MAX).toFixed(2)}deg) rotateX(${(-py * MAX).toFixed(2)}deg) scale(1.025)`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Tooltip flotante reutilizable
    // ──────────────────────────────────────────────────────────────
    function _ensureTooltip() {
        if (document.getElementById('fin-tooltip')) return;
        const t = document.createElement('div');
        t.id = 'fin-tooltip';
        document.body.appendChild(t);
    }
    function _showTip(html, e) {
        const t = document.getElementById('fin-tooltip');
        if (!t) return;
        t.innerHTML = html;
        t.classList.add('show');
        _moveTip(e);
    }
    function _moveTip(e) {
        const t = document.getElementById('fin-tooltip');
        if (!t) return;
        const pad = 14;
        let x = e.clientX + pad;
        let y = e.clientY + pad;
        const rect = t.getBoundingClientRect();
        if (x + rect.width > window.innerWidth - 8)  x = e.clientX - rect.width - pad;
        if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
        t.style.left = `${Math.max(8, x)}px`;
        t.style.top  = `${Math.max(8, y)}px`;
    }
    function _hideTip() {
        document.getElementById('fin-tooltip')?.classList.remove('show');
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    function _fmtMoney(v) {
        if (v === null || v === undefined) return '$0';
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', maximumFractionDigits: 0
        }).format(v);
    }

    function _fmtMoneyShort(v) {
        if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
        if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k';
        return '$' + v;
    }

    function _set(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? '—');
    }

    function _animCounter(elId, target, isMoney = false, suffix = '') {
        const el = document.getElementById(elId);
        if (!el) return;
        const numTarget = parseFloat(target) || 0;
        const steps = 30;
        const increment = numTarget / steps;
        let current = 0;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            current = Math.min(current + increment, numTarget);
            if (isMoney) {
                el.textContent = _fmtMoney(current);
            } else {
                el.textContent = Math.round(current * 10) / 10 + suffix;
            }
            if (step >= steps) {
                clearInterval(timer);
                if (isMoney) el.textContent = _fmtMoney(numTarget);
                else el.textContent = (Math.round(numTarget * 10) / 10) + suffix;
            }
        }, 30);
    }

    function _mostrarVacioChart(msg) {
        const cont = document.getElementById('chart-flujo')?.parentElement;
        if (cont) {
            cont.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <div class="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-chart-bar text-blue-400 text-xl"></i>
                    </div>
                    <p class="text-slate-500 text-sm">${esc(msg)}</p>
                </div>`;
        }
    }

    return { init };
})();

window.FINANCIERO_ARRENDADOR = FINANCIERO_ARRENDADOR;
