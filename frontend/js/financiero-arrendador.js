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
// Dependencias (CDN en el HTML):
//   supabase-config.js · auth.js · layout.js · toast.js
//   Chart.js (https://cdn.jsdelivr.net/npm/chart.js)
// ================================================================

const FINANCIERO_ARRENDADOR = (() => {

    let _usuario = null;
    let _chartFlujo = null;
    let _chartDonut = null;

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // Marcar pagos vencidos antes de calcular
        try {
            await window.supabaseClient.rpc('actualizar_pagos_vencidos');
        } catch (err) {
            console.warn('[FINANCIERO] No se pudo ejecutar actualizar_pagos_vencidos:', err);
        }

        // Cargar datos en paralelo
        const [metricas, flujo] = await Promise.all([
            _cargarMetricas(),
            _cargarFlujoMensual()
        ]);

        _renderMetricas(metricas);
        _renderChartFlujo(flujo);
        _renderChartDonut(metricas);
        _renderTablaResumen(flujo);
        _renderInsights(metricas, flujo);
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
    // Render de tarjetas de métricas
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas(m) {
        if (!m) return;

        _animCounter('metric-ingresos',     m.ingresos_totales,  true);
        _animCounter('metric-pendientes',   m.pendientes_monto,  true);
        _animCounter('metric-vencidos',     m.vencidos_monto,    true);
        _animCounter('metric-morosidad',    m.tasa_morosidad,    false, '%');
        _animCounter('metric-cumplimiento', m.tasa_cumplimiento, false, '%');

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
    // Chart.js — Flujo esperado vs recibido (barras + línea)
    // ──────────────────────────────────────────────────────────────
    function _renderChartFlujo(flujo) {
        const canvas = document.getElementById('chart-flujo');
        if (!canvas || !flujo.length) {
            _mostrarVacioChart('No hay datos mensuales para graficar aún.');
            return;
        }

        const ctx = canvas.getContext('2d');

        // Últimos 12 meses máximo
        const datos = flujo.slice(-12);
        const labels   = datos.map(d => d.mes_label);
        const esperado = datos.map(d => parseFloat(d.esperado) || 0);
        const recibido = datos.map(d => parseFloat(d.recibido) || 0);

        if (_chartFlujo) _chartFlujo.destroy();

        _chartFlujo = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Esperado',
                        data: esperado,
                        backgroundColor: 'rgba(30, 58, 138, 0.15)',
                        borderColor: '#1e3a8a',
                        borderWidth: 2,
                        borderRadius: 8,
                        barPercentage: 0.6,
                        categoryPercentage: 0.7,
                        order: 2
                    },
                    {
                        label: 'Recibido',
                        data: recibido,
                        type: 'line',
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        borderWidth: 3,
                        pointRadius: 5,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 7,
                        tension: 0.35,
                        fill: true,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'rectRounded',
                            padding: 20,
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0f2557',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13, weight: '700' },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        padding: 14,
                        cornerRadius: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                return ` ${context.dataset.label}: ${_fmtMoney(context.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '500' },
                            color: '#64748b'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
                        ticks: {
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
                            color: '#94a3b8',
                            callback: v => _fmtMoneyShort(v)
                        }
                    }
                }
            }
        });
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

        _chartDonut = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Pagados', 'Pendientes', 'Vencidos', 'Reportados'],
                datasets: [{
                    data: valores,
                    backgroundColor: [
                        '#22c55e',   // green
                        '#f59e0b',   // amber
                        '#ef4444',   // red
                        '#3b82f6'    // blue
                    ],
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 16,
                            font: { family: "'Plus Jakarta Sans', sans-serif", size: 11, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0f2557',
                        titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13, weight: '700' },
                        bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        padding: 12,
                        cornerRadius: 10,
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
    // Tabla de resumen mensual (debajo de la gráfica)
    // ──────────────────────────────────────────────────────────────
    function _renderTablaResumen(flujo) {
        const cont = document.getElementById('tabla-resumen');
        if (!cont) return;

        if (!flujo.length) {
            cont.innerHTML = `<p class="text-slate-400 text-sm text-center py-6">Sin datos mensuales aún.</p>`;
            return;
        }

        const datos = flujo.slice(-12);

        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="border-b border-slate-100">
                            <th class="text-left py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Periodo</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Esperado</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Recibido</th>
                            <th class="text-right py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Diferencia</th>
                            <th class="text-center py-2.5 px-3 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">Estado</th>
                        </tr>
                    </thead>
                    <tbody>`;

        datos.forEach(d => {
            const esp = parseFloat(d.esperado) || 0;
            const rec = parseFloat(d.recibido) || 0;
            const diff = rec - esp;
            const diffColor = diff >= 0 ? 'text-green-600' : 'text-red-600';
            const diffSign  = diff >= 0 ? '+' : '';

            // Estado del mes
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
                <tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(d.mes_label)}</td>
                    <td class="py-2.5 px-3 text-right text-slate-600">${_fmtMoney(esp)}</td>
                    <td class="py-2.5 px-3 text-right font-semibold text-slate-800">${_fmtMoney(rec)}</td>
                    <td class="py-2.5 px-3 text-right font-semibold ${diffColor}">${diffSign}${_fmtMoney(Math.abs(diff))}</td>
                    <td class="py-2.5 px-3 text-center">${estadoBadge}</td>
                </tr>`;
        });

        html += `</tbody></table></div>`;
        cont.innerHTML = html;
    }

    // ──────────────────────────────────────────────────────────────
    // Insights / análisis inteligente
    // ──────────────────────────────────────────────────────────────
    function _renderInsights(m, flujo) {
        const cont = document.getElementById('insights-container');
        if (!cont || !m) return;

        const insights = [];

        // Insight 1: Tasa de cobro
        if (m.total_cuotas > 0) {
            const tasaCobro = parseFloat(m.ingresos_totales) / parseFloat(m.esperado_total) * 100;
            if (tasaCobro >= 95) {
                insights.push({
                    icon: 'fa-trophy', color: 'green',
                    titulo: 'Excelente tasa de cobro',
                    texto: `Has cobrado el ${Math.round(tasaCobro)}% del total esperado. Tu gestión de cobros es sobresaliente.`
                });
            } else if (tasaCobro >= 70) {
                insights.push({
                    icon: 'fa-chart-line', color: 'amber',
                    titulo: 'Tasa de cobro mejorable',
                    texto: `Has cobrado ${Math.round(tasaCobro)}% del total esperado. Revisa los pagos pendientes y vencidos.`
                });
            } else {
                insights.push({
                    icon: 'fa-triangle-exclamation', color: 'red',
                    titulo: 'Atención: tasa de cobro baja',
                    texto: `Solo has cobrado ${Math.round(tasaCobro)}% del esperado. Hay ${m.vencidos_count} cuota(s) vencida(s) por atender.`
                });
            }
        }

        // Insight 2: Morosidad
        if (parseFloat(m.tasa_morosidad) > 15) {
            insights.push({
                icon: 'fa-exclamation-circle', color: 'red',
                titulo: 'Morosidad elevada',
                texto: `La tasa de morosidad es del ${m.tasa_morosidad}%. Considera contactar a los inquilinos con pagos vencidos.`
            });
        }

        // Insight 3: Tendencia de flujo
        if (flujo.length >= 2) {
            const ultimos = flujo.slice(-2);
            const recAnterior = parseFloat(ultimos[0].recibido) || 0;
            const recActual   = parseFloat(ultimos[1].recibido) || 0;
            if (recActual > recAnterior && recAnterior > 0) {
                const cambio = Math.round(((recActual - recAnterior) / recAnterior) * 100);
                insights.push({
                    icon: 'fa-arrow-trend-up', color: 'green',
                    titulo: 'Ingresos en alza',
                    texto: `Los ingresos recibidos subieron ${cambio}% respecto al mes anterior.`
                });
            } else if (recActual < recAnterior && recAnterior > 0) {
                const cambio = Math.round(((recAnterior - recActual) / recAnterior) * 100);
                insights.push({
                    icon: 'fa-arrow-trend-down', color: 'red',
                    titulo: 'Ingresos en baja',
                    texto: `Los ingresos cayeron ${cambio}% respecto al mes anterior. Revisa pagos pendientes.`
                });
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

        cont.innerHTML = insights.map(ins => {
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