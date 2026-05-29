/* ============================================
   DASHBOARD FINANCIERO Y EVALUACIONES — Dev 5
   Métricas globales + Chart.js + calificación
   de comportamiento del inquilino.
   ============================================ */

const Dashboard = {

    async obtenerResumen(arrendadorId) {
        const { data, error } = await window.supabaseClient
            .rpc('obtener_resumen_financiero', { p_arrendador_id: arrendadorId });
        if (error) { console.error(error); return null; }
        return data?.[0] || null;
    },

    async obtenerIngresosMensuales(arrendadorId) {
        const { data } = await window.supabaseClient
            .from('ingresos_mensuales_arrendador')
            .select('*')
            .eq('arrendador_id', arrendadorId)
            .order('anio')
            .order('mes');
        return data || [];
    },

    async obtenerComportamientoInquilino(usuarioId) {
        const { data } = await window.supabaseClient
            .from('comportamiento_inquilino')
            .select('*')
            .eq('usuario_id', usuarioId)
            .maybeSingle();
        return data;
    },

    // Solo los inquilinos que tienen contratos con propiedades de este arrendador,
    // y con métricas calculadas sobre los contratos de ese arrendador.
    async obtenerComportamientoTodos(arrendadorId) {
        const { data } = await window.supabaseClient
            .from('comportamiento_inquilino_por_arrendador')
            .select('*')
            .eq('duenio_id', arrendadorId);
        return data || [];
    },

    // ---------- UI: Inicio Arrendador ----------
    async montarInicio(contenedor, usuario) {
        contenedor.innerHTML = `
            <h2 class="mb-4">Bienvenido, ${esc(usuario.nombre_completo)}</h2>
            <div class="row g-3 mb-4" id="metricas">Cargando...</div>
            <div class="row g-3">
                <div class="col-md-8">
                    <div class="card">
                        <div class="card-body">
                            <h6 class="text-muted">Flujo de ingresos mensual</h6>
                            <canvas id="grafico-flujo" height="100"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card">
                        <div class="card-body">
                            <h6 class="text-muted">Distribución de pagos</h6>
                            <canvas id="grafico-distribucion" height="200"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const resumen = await this.obtenerResumen(usuario.usuario_id);
        this._renderMetricas(resumen);
        await this._renderGraficos(usuario.usuario_id, resumen);
    },

    _renderMetricas(r) {
        if (!r) {
            document.getElementById('metricas').innerHTML =
                '<p class="text-muted">Aún no hay datos. Comienza registrando propiedades y contratos.</p>';
            return;
        }
        const cards = [
            { label: 'Propiedades activas', valor: r.total_propiedades, icono: 'houses', color: 'primary' },
            { label: 'Contratos activos', valor: r.total_contratos_activos, icono: 'file-earmark-text', color: 'info' },
            { label: 'Ingresos mes actual', valor: '$' + Number(r.ingresos_mes_actual).toLocaleString(), icono: 'cash-stack', color: 'success' },
            { label: 'Pagos pendientes', valor: r.pagos_pendientes, icono: 'hourglass', color: 'warning' },
            { label: 'Pagos vencidos', valor: r.pagos_vencidos, icono: 'exclamation-circle', color: 'danger' },
            { label: 'Monto vencido', valor: '$' + Number(r.monto_vencido).toLocaleString(), icono: 'cash', color: 'danger' }
        ];
        document.getElementById('metricas').innerHTML = cards.map(c => `
            <div class="col-md-4 col-lg-2">
                <div class="card metrica-card">
                    <div class="card-body">
                        <div class="metrica-label"><i class="bi bi-${c.icono}"></i> ${esc(c.label)}</div>
                        <div class="metrica-valor text-${c.color}">${esc(c.valor)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    async _renderGraficos(arrendadorId, resumen) {
        // Gráfico de líneas: ingresos mensuales
        const ingresos = await this.obtenerIngresosMensuales(arrendadorId);
        const labels = ingresos.map(i => `${i.mes}/${i.anio}`);
        new Chart(document.getElementById('grafico-flujo'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Recibidos',
                        data: ingresos.map(i => i.ingresos_recibidos || 0),
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22,163,74,0.1)',
                        fill: true,
                        tension: 0.3
                    },
                    {
                        label: 'Esperados',
                        data: ingresos.map(i => i.ingresos_esperados || 0),
                        borderColor: '#0d6efd',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.3
                    }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });

        // Gráfico de dona: distribución de pagos (todos por CANTIDAD de períodos).
        if (resumen) {
            new Chart(document.getElementById('grafico-distribucion'), {
                type: 'doughnut',
                data: {
                    labels: ['Pagados', 'Pendientes', 'Vencidos'],
                    datasets: [{
                        data: [
                            resumen.pagos_pagados || 0,
                            resumen.pagos_pendientes || 0,
                            resumen.pagos_vencidos || 0
                        ],
                        backgroundColor: ['#16a34a', '#f59e0b', '#dc2626']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    },

    // ---------- UI: Reportes (calificación de inquilinos) ----------
    async montarReportes(contenedor, usuario) {
        contenedor.innerHTML = `
            <h2 class="mb-3"><i class="bi bi-graph-up"></i> Calificación de inquilinos</h2>
            <div id="tabla-comportamiento">Cargando...</div>
        `;
        const datos = await this.obtenerComportamientoTodos(usuario.usuario_id);
        const cont = document.getElementById('tabla-comportamiento');
        if (!datos.length) {
            cont.innerHTML = '<p class="text-muted">Aún no hay datos de comportamiento.</p>';
            return;
        }
        const colorCalif = {
            EXCELENTE: 'success', BUENO: 'primary', REGULAR: 'warning', MALO: 'danger'
        };
        cont.innerHTML = `
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Inquilino</th>
                    <th>Pagos realizados</th>
                    <th>Pendientes</th>
                    <th>Vencidos</th>
                    <th>% Cumplimiento</th>
                    <th>Calificación</th>
                </tr></thead>
                <tbody>${datos.map(d => `
                    <tr>
                        <td>${esc(d.nombre_completo)}</td>
                        <td>${esc(d.pagos_realizados) || 0}</td>
                        <td>${esc(d.pagos_pendientes) || 0}</td>
                        <td>${esc(d.pagos_vencidos) || 0}</td>
                        <td>${esc(d.porcentaje_cumplimiento) || 0}%</td>
                        <td><span class="badge bg-${colorCalif[d.calificacion] || 'secondary'}">${esc(d.calificacion) || 'SIN DATOS'}</span></td>
                    </tr>
                `).join('')}</tbody>
            </table>`;
    },

    // ---------- UI: Inicio Inquilino ----------
    async montarInicioInquilino(contenedor, inquilino) {
        const comp = await this.obtenerComportamientoInquilino(inquilino.usuario.usuario_id);
        contenedor.innerHTML = `
            <h2 class="mb-4">Hola, ${esc(inquilino.usuario.nombre_completo)}</h2>
            <div class="row g-3">
                <div class="col-md-3">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Pagos al día</div>
                            <div class="metrica-valor text-success">${esc(comp?.pagos_realizados) || 0}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Pendientes</div>
                            <div class="metrica-valor text-warning">${esc(comp?.pagos_pendientes) || 0}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Vencidos</div>
                            <div class="metrica-valor text-danger">${esc(comp?.pagos_vencidos) || 0}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Calificación</div>
                            <div class="metrica-valor">${esc(comp?.calificacion) || '—'}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

window.Dashboard = Dashboard;
