/* ============================================
   PAGOS Y CALENDARIO — Dev 4
   "Motor de Pagos y Simulación"

   Responsabilidades (según README):
   1. Generar calendario_pagos al crear contrato
      (delegado al trigger SQL del schema).
   2. Pantalla para registrar pagos manuales.
   3. Lógica de estados (Pendiente/Pagado/Vencido).
   4. Historial por inquilino y por propiedad.
   + Saldos por contrato, cobranza con días de
     atraso, simulador de calendario.
   ============================================ */

const Pagos = {

    // ============================================
    // CAPA DE DATOS
    // ============================================

    async listarCalendario({ inquilino_id, duenio_id, contrato_id, estado } = {}) {
        let q = window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                contrato:contrato_id!inner(
                    contrato_id, monto_renta, frecuencia_pago, inquilino_id,
                    propiedad:propiedad_id!inner(propiedad_id, nombre, duenio_id),
                    inquilino:inquilino_id(inquilino_id, usuario:usuario_id(nombre_completo))
                ),
                registro:registros_pago(*)
            `)
            .order('fecha_limite');
        if (estado) q = q.eq('estado', estado);
        if (contrato_id) q = q.eq('contrato_id', contrato_id);
        // Filtros en el servidor: solo el calendario del inquilino o del dueño correspondiente.
        if (inquilino_id) q = q.eq('contrato.inquilino_id', inquilino_id);
        if (duenio_id)    q = q.eq('contrato.propiedad.duenio_id', duenio_id);
        const { data, error } = await q;
        if (error) console.error(error);
        return data || [];
    },

    async actualizarVencidos() {
        return await window.supabaseClient.rpc('actualizar_pagos_vencidos');
    },

    async registrarPago({ calendario_id, monto_recibido, fecha_recibido, registrado_por_id, notas }) {
        // No marcar como PAGADO si el monto recibido no cubre lo esperado:
        // el esquema no tiene estado "PARCIAL", así que exigimos el monto completo.
        const { data: cp } = await window.supabaseClient
            .from('calendario_pagos')
            .select('monto_esperado')
            .eq('calendario_id', calendario_id).single();
        if (cp && Number(monto_recibido) < Number(cp.monto_esperado)) {
            return { error: { message:
                `El monto recibido ($${Number(monto_recibido).toLocaleString()}) es menor al esperado ` +
                `($${Number(cp.monto_esperado).toLocaleString()}). Registra el monto completo del período.` } };
        }

        const { data: pago, error } = await window.supabaseClient
            .from('registros_pago')
            .insert({ calendario_id, monto_recibido, fecha_recibido, registrado_por_id, notas })
            .select().single();
        if (error) return { error };

        await window.supabaseClient
            .from('calendario_pagos')
            .update({ estado: 'PAGADO', fecha_pagado: fecha_recibido })
            .eq('calendario_id', calendario_id);

        return { data: pago };
    },

    // Deshacer un pago registrado por error
    async revertirPago(calendario_id) {
        await window.supabaseClient
            .from('registros_pago')
            .delete()
            .eq('calendario_id', calendario_id);
        const { data: cp } = await window.supabaseClient
            .from('calendario_pagos')
            .select('fecha_limite')
            .eq('calendario_id', calendario_id).single();
        if (!cp) return { error: { message: 'No se encontró el período a revertir.' } };
        const hoy = new Date().toISOString().slice(0, 10);
        const nuevoEstado = cp.fecha_limite < hoy ? 'VENCIDO' : 'PENDIENTE';
        return await window.supabaseClient
            .from('calendario_pagos')
            .update({ estado: nuevoEstado, fecha_pagado: null })
            .eq('calendario_id', calendario_id);
    },

    // ---- Vistas SQL ----
    async obtenerSaldosArrendador(duenio_id) {
        const { data } = await window.supabaseClient
            .from('saldos_contrato').select('*').eq('duenio_id', duenio_id);
        return data || [];
    },

    async obtenerCobranza(duenio_id) {
        const { data } = await window.supabaseClient
            .from('cobranza_pendiente').select('*')
            .eq('duenio_id', duenio_id)
            .order('dias_atraso', { ascending: false });
        return data || [];
    },

    // ---- Historial ----
    async historialInquilino(inquilino_id) {
        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                contrato:contrato_id!inner(
                    propiedad:propiedad_id(nombre),
                    inquilino_id
                ),
                registro:registros_pago(monto_recibido, fecha_recibido, notas)
            `)
            .eq('estado', 'PAGADO')
            .eq('contrato.inquilino_id', inquilino_id)
            .order('fecha_pagado', { ascending: false });
        if (error) console.error(error);
        return data || [];
    },

    async historialPropiedad(propiedad_id) {
        const { data, error } = await window.supabaseClient
            .from('calendario_pagos')
            .select(`
                *,
                contrato:contrato_id!inner(
                    propiedad_id,
                    inquilino:inquilino_id(usuario:usuario_id(nombre_completo))
                ),
                registro:registros_pago(monto_recibido, fecha_recibido)
            `)
            .eq('contrato.propiedad_id', propiedad_id)
            .order('fecha_limite', { ascending: false });
        if (error) console.error(error);
        return data || [];
    },

    // ---- Simulación pura en JS (sin tocar BD) ----
    simularCalendario({ fecha_inicio, fecha_fin, monto_renta, frecuencia_pago }) {
        const avanzar = {
            MENSUAL:   d => { const x = new Date(d); x.setMonth(x.getMonth() + 1); return x; },
            QUINCENAL: d => { const x = new Date(d); x.setDate(x.getDate() + 15); return x; },
            SEMANAL:   d => { const x = new Date(d); x.setDate(x.getDate() + 7);  return x; }
        }[frecuencia_pago];
        if (!avanzar) return [];

        const fin = new Date(fecha_fin);
        let fecha = new Date(fecha_inicio);
        const periodos = [];
        let n = 0;
        while (fecha <= fin) {
            n++;
            periodos.push({
                numero: n,
                fecha_limite: fecha.toISOString().slice(0, 10),
                anio: fecha.getFullYear(),
                mes: fecha.getMonth() + 1,
                monto_esperado: monto_renta
            });
            fecha = avanzar(fecha);
        }
        return periodos;
    },

    // ============================================
    // UI — ARRENDADOR (con sub-pestañas)
    // ============================================
    async montar(contenedor, usuario) {
        window._usuarioActual = usuario;
        await this.actualizarVencidos();
        contenedor.innerHTML = `
            <h2 class="mb-3"><i class="bi bi-cash-stack"></i> Motor de Pagos</h2>
            <ul class="nav nav-pills mb-3" id="pagos-subtabs">
                <li class="nav-item"><a class="nav-link active" data-subtab="calendario" href="#">Calendario</a></li>
                <li class="nav-item"><a class="nav-link" data-subtab="cobranza" href="#">Cobranza</a></li>
                <li class="nav-item"><a class="nav-link" data-subtab="saldos" href="#">Saldos por contrato</a></li>
                <li class="nav-item"><a class="nav-link" data-subtab="historial" href="#">Historial</a></li>
                <li class="nav-item"><a class="nav-link" data-subtab="simulador" href="#">Simulador</a></li>
            </ul>
            <div id="pagos-panel"></div>
            ${this._modalRegistroHtml()}
        `;
        document.querySelectorAll('#pagos-subtabs [data-subtab]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('#pagos-subtabs [data-subtab]').forEach(x => x.classList.remove('active'));
                a.classList.add('active');
                this._renderTab(a.dataset.subtab, usuario);
            });
        });
        document.getElementById('form-pago')
            .addEventListener('submit', (e) => this._guardarRegistro(e, usuario));
        this._renderTab('calendario', usuario);
    },

    async _renderTab(tab, usuario) {
        const panel = document.getElementById('pagos-panel');
        panel.innerHTML = '<div class="text-muted">Cargando...</div>';
        if (tab === 'calendario') return this._renderCalendario(panel, usuario);
        if (tab === 'cobranza')   return this._renderCobranza(panel, usuario);
        if (tab === 'saldos')     return this._renderSaldos(panel, usuario);
        if (tab === 'historial')  return this._renderHistorial(panel, usuario);
        if (tab === 'simulador')  return this._renderSimulador(panel);
    },

    // -------- Tab Calendario --------
    async _renderCalendario(panel, usuario) {
        const pagos = await this.listarCalendario({ duenio_id: usuario.usuario_id });
        if (!pagos.length) {
            panel.innerHTML = '<p class="text-muted">No hay pagos en el calendario.</p>';
            return;
        }
        panel.innerHTML = `
            <div class="btn-group mb-3" role="group">
                <button class="btn btn-sm btn-outline-secondary active" data-fc="">Todos</button>
                <button class="btn btn-sm btn-outline-warning"   data-fc="PENDIENTE">Pendientes</button>
                <button class="btn btn-sm btn-outline-danger"    data-fc="VENCIDO">Vencidos</button>
                <button class="btn btn-sm btn-outline-success"   data-fc="PAGADO">Pagados</button>
            </div>
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Propiedad</th><th>Inquilino</th><th>Periodo</th>
                    <th>Vence</th><th>Monto</th><th>Estado</th><th></th>
                </tr></thead>
                <tbody id="tbody-calendario">${this._renderFilasCalendario(pagos)}</tbody>
            </table>
        `;
        document.querySelectorAll('[data-fc]').forEach(b => {
            b.addEventListener('click', () => {
                document.querySelectorAll('[data-fc]').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                const e = b.dataset.fc;
                const filtrados = e ? pagos.filter(p => p.estado === e) : pagos;
                document.getElementById('tbody-calendario').innerHTML = this._renderFilasCalendario(filtrados);
            });
        });
    },

    _renderFilasCalendario(pagos) {
        return pagos.map(p => `
            <tr>
                <td>${esc(p.contrato?.propiedad?.nombre) || '—'}</td>
                <td>${esc(p.contrato?.inquilino?.usuario?.nombre_completo) || '—'}</td>
                <td>${esc(p.mes)}/${esc(p.anio)}</td>
                <td>${esc(p.fecha_limite)}</td>
                <td>$${Number(p.monto_esperado).toLocaleString()}</td>
                <td><span class="badge badge-${esc(p.estado)}">${esc(p.estado)}</span></td>
                <td>
                    ${p.estado !== 'PAGADO' ? `
                        <button class="btn btn-sm btn-success"
                                onclick="Pagos._abrirRegistro(${p.calendario_id}, ${Number(p.monto_esperado)})">
                            <i class="bi bi-check"></i> Registrar
                        </button>` : `
                        <button class="btn btn-sm btn-outline-danger"
                                onclick="Pagos._revertir(${p.calendario_id})">
                            <i class="bi bi-arrow-counterclockwise"></i> Revertir
                        </button>`}
                </td>
            </tr>
        `).join('');
    },

    // -------- Tab Cobranza --------
    async _renderCobranza(panel, usuario) {
        const cobranza = await this.obtenerCobranza(usuario.usuario_id);
        if (!cobranza.length) {
            panel.innerHTML = '<p class="text-success">¡Todo al corriente! No hay cobranza pendiente.</p>';
            return;
        }
        const sum = (cond) => cobranza.filter(cond).reduce((s, c) => s + Number(c.monto_esperado), 0);
        const totalVencido    = sum(c => c.estado === 'VENCIDO');
        const totalPendiente  = sum(c => c.estado === 'PENDIENTE');

        panel.innerHTML = `
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Monto vencido</div>
                            <div class="metrica-valor text-danger">$${totalVencido.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Por vencer</div>
                            <div class="metrica-valor text-warning">$${totalPendiente.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            </div>
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Gravedad</th><th>Inquilino</th><th>Contacto</th><th>Propiedad</th>
                    <th>Periodo</th><th>Vence</th><th>Días atraso</th><th>Monto</th><th></th>
                </tr></thead>
                <tbody>${cobranza.map(c => `
                    <tr>
                        <td><span class="badge bg-${this._colorGravedad(c.gravedad)}">${esc(c.gravedad)}</span></td>
                        <td>${esc(c.inquilino_nombre)}</td>
                        <td>${esc(c.inquilino_telefono || c.inquilino_correo)}</td>
                        <td>${esc(c.propiedad_nombre)}</td>
                        <td>${esc(c.mes)}/${esc(c.anio)}</td>
                        <td>${esc(c.fecha_limite)}</td>
                        <td>${esc(c.dias_atraso)}</td>
                        <td>$${Number(c.monto_esperado).toLocaleString()}</td>
                        <td>
                            <button class="btn btn-sm btn-success"
                                    onclick="Pagos._abrirRegistro(${c.calendario_id}, ${Number(c.monto_esperado)})">
                                Registrar
                            </button>
                        </td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
    },

    _colorGravedad(g) {
        return {
            AL_DIA: 'success',
            ATRASO_LEVE: 'warning',
            ATRASO_MODERADO: 'orange',
            ATRASO_GRAVE: 'danger'
        }[g] || 'secondary';
    },

    // -------- Tab Saldos --------
    async _renderSaldos(panel, usuario) {
        const saldos = await this.obtenerSaldosArrendador(usuario.usuario_id);
        if (!saldos.length) {
            panel.innerHTML = '<p class="text-muted">Aún no hay contratos.</p>';
            return;
        }
        panel.innerHTML = `
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Propiedad</th><th>Inquilino</th><th>Renta</th>
                    <th>Períodos</th><th>Esperado</th><th>Pagado</th>
                    <th>Por cobrar</th><th>% Avance</th>
                </tr></thead>
                <tbody>${saldos.map(s => {
                    const avance = s.monto_total_esperado > 0
                        ? Math.round(100 * s.monto_pagado / s.monto_total_esperado) : 0;
                    return `
                    <tr>
                        <td>${esc(s.propiedad_nombre)}</td>
                        <td>${esc(s.inquilino_nombre)}</td>
                        <td>$${Number(s.monto_renta).toLocaleString()}<br><small class="text-muted">${esc(s.frecuencia_pago)}</small></td>
                        <td>
                            <span class="badge badge-PAGADO">${esc(s.periodos_pagados)}</span>
                            <span class="badge badge-PENDIENTE">${esc(s.periodos_pendientes)}</span>
                            <span class="badge badge-VENCIDO">${esc(s.periodos_vencidos)}</span>
                        </td>
                        <td>$${Number(s.monto_total_esperado).toLocaleString()}</td>
                        <td class="text-success">$${Number(s.monto_pagado).toLocaleString()}</td>
                        <td class="text-danger">$${Number(s.saldo_por_cobrar).toLocaleString()}</td>
                        <td style="min-width: 120px;">
                            <div class="progress" style="height: 18px;">
                                <div class="progress-bar bg-success" style="width: ${avance}%">${avance}%</div>
                            </div>
                        </td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        `;
    },

    // -------- Tab Historial --------
    async _renderHistorial(panel, usuario) {
        const [props, inquilinos] = await Promise.all([
            window.Propiedades.listar(usuario.usuario_id),
            window.Propiedades.listarInquilinos()
        ]);
        panel.innerHTML = `
            <p class="text-muted">Consulta pagos cobrados por inquilino o por propiedad.</p>
            <div class="row g-2 mb-3">
                <div class="col-md-5">
                    <label class="form-label">Por inquilino</label>
                    <select class="form-select" id="filtro-historial-inq">
                        <option value="">— Selecciona —</option>
                        ${inquilinos.map(i => `<option value="${i.inquilino_id}">${esc(i.usuario?.nombre_completo)}</option>`).join('')}
                    </select>
                </div>
                <div class="col-md-5">
                    <label class="form-label">Por propiedad</label>
                    <select class="form-select" id="filtro-historial-prop">
                        <option value="">— Selecciona —</option>
                        ${props.map(p => `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="resultado-historial"><p class="text-muted">Selecciona un filtro arriba.</p></div>
        `;
        document.getElementById('filtro-historial-inq').addEventListener('change', async (e) => {
            if (!e.target.value) return;
            document.getElementById('filtro-historial-prop').value = '';
            const datos = await this.historialInquilino(parseInt(e.target.value));
            this._renderTablaHistorial(datos, 'inquilino');
        });
        document.getElementById('filtro-historial-prop').addEventListener('change', async (e) => {
            if (!e.target.value) return;
            document.getElementById('filtro-historial-inq').value = '';
            const datos = await this.historialPropiedad(parseInt(e.target.value));
            this._renderTablaHistorial(datos, 'propiedad');
        });
    },

    _renderTablaHistorial(datos, contexto) {
        const cont = document.getElementById('resultado-historial');
        if (!datos.length) {
            cont.innerHTML = '<p class="text-muted">Sin pagos registrados.</p>';
            return;
        }
        const total = datos.reduce((s, d) =>
            s + Number(d.registro?.[0]?.monto_recibido || d.monto_esperado), 0);
        cont.innerHTML = `
            <p>
                <strong>Total cobrado:</strong> $${total.toLocaleString()}
                en ${datos.length} pago${datos.length === 1 ? '' : 's'}
            </p>
            <table class="table table-sm bg-white">
                <thead><tr>
                    <th>Fecha pago</th><th>Periodo</th>
                    <th>${contexto === 'inquilino' ? 'Propiedad' : 'Inquilino'}</th>
                    <th>Monto</th><th>Notas</th>
                </tr></thead>
                <tbody>${datos.map(d => `
                    <tr>
                        <td>${esc(d.fecha_pagado) || '—'}</td>
                        <td>${esc(d.mes)}/${esc(d.anio)}</td>
                        <td>${contexto === 'inquilino'
                            ? (esc(d.contrato?.propiedad?.nombre) || '—')
                            : (esc(d.contrato?.inquilino?.usuario?.nombre_completo) || '—')}</td>
                        <td>$${Number(d.registro?.[0]?.monto_recibido || d.monto_esperado).toLocaleString()}</td>
                        <td>${esc(d.registro?.[0]?.notas) || '—'}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
    },

    // -------- Tab Simulador --------
    _renderSimulador(panel) {
        panel.innerHTML = `
            <p class="text-muted">Previsualiza el calendario de pagos de un contrato hipotético antes de crearlo.</p>
            <form id="form-sim" class="row g-3 mb-3 bg-white p-3 rounded">
                <div class="col-md-3">
                    <label class="form-label">Fecha inicio</label>
                    <input type="date" class="form-control" name="fecha_inicio" required>
                </div>
                <div class="col-md-3">
                    <label class="form-label">Fecha fin</label>
                    <input type="date" class="form-control" name="fecha_fin" required>
                </div>
                <div class="col-md-3">
                    <label class="form-label">Monto renta</label>
                    <input type="number" step="0.01" class="form-control" name="monto_renta" required>
                </div>
                <div class="col-md-3">
                    <label class="form-label">Frecuencia</label>
                    <select class="form-select" name="frecuencia_pago" required>
                        <option value="MENSUAL">Mensual</option>
                        <option value="QUINCENAL">Quincenal</option>
                        <option value="SEMANAL">Semanal</option>
                    </select>
                </div>
                <div class="col-12">
                    <button class="btn btn-primary"><i class="bi bi-calculator"></i> Simular</button>
                </div>
            </form>
            <div id="resultado-sim"></div>
        `;
        document.getElementById('form-sim').addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const periodos = this.simularCalendario({
                fecha_inicio: fd.get('fecha_inicio'),
                fecha_fin: fd.get('fecha_fin'),
                monto_renta: parseFloat(fd.get('monto_renta')),
                frecuencia_pago: fd.get('frecuencia_pago')
            });
            const total = periodos.reduce((s, p) => s + Number(p.monto_esperado), 0);
            document.getElementById('resultado-sim').innerHTML = `
                <div class="alert alert-info">
                    <strong>${periodos.length}</strong> períodos · Total esperado:
                    <strong>$${total.toLocaleString()}</strong>
                </div>
                <table class="table table-sm table-striped bg-white">
                    <thead><tr><th>#</th><th>Fecha límite</th><th>Periodo</th><th>Monto</th></tr></thead>
                    <tbody>${periodos.map(p => `
                        <tr>
                            <td>${p.numero}</td>
                            <td>${esc(p.fecha_limite)}</td>
                            <td>${p.mes}/${p.anio}</td>
                            <td>$${Number(p.monto_esperado).toLocaleString()}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            `;
        });
    },

    // ============================================
    // Modal — registro de pago
    // ============================================
    _abrirRegistro(calendarioId, montoEsperado) {
        const form = document.getElementById('form-pago');
        form.reset();
        form.calendario_id.value = calendarioId;
        form.monto_recibido.value = montoEsperado;
        form.fecha_recibido.value = new Date().toISOString().slice(0, 10);
        new bootstrap.Modal(document.getElementById('modal-pago')).show();
    },

    async _guardarRegistro(e, usuario) {
        e.preventDefault();
        const form = e.target;
        const { error } = await this.registrarPago({
            calendario_id: parseInt(form.calendario_id.value),
            monto_recibido: parseFloat(form.monto_recibido.value),
            fecha_recibido: form.fecha_recibido.value,
            registrado_por_id: usuario.usuario_id,
            notas: form.notas.value
        });
        if (error) return alert('Error: ' + error.message);
        bootstrap.Modal.getInstance(document.getElementById('modal-pago')).hide();
        const tabActiva = document.querySelector('#pagos-subtabs .active')?.dataset.subtab || 'calendario';
        this._renderTab(tabActiva, usuario);
    },

    async _revertir(calendario_id) {
        if (!confirm('¿Revertir este pago? Se eliminará el registro y el período volverá a estar pendiente/vencido.')) return;
        await this.revertirPago(calendario_id);
        const tabActiva = document.querySelector('#pagos-subtabs .active')?.dataset.subtab || 'calendario';
        this._renderTab(tabActiva, window._usuarioActual);
    },

    _modalRegistroHtml() {
        return `
            <div class="modal fade" id="modal-pago" tabindex="-1">
                <div class="modal-dialog">
                    <form class="modal-content" id="form-pago">
                        <div class="modal-header">
                            <h5 class="modal-title">Registrar pago</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" name="calendario_id">
                            <div class="mb-3">
                                <label class="form-label">Monto recibido</label>
                                <input type="number" step="0.01" class="form-control" name="monto_recibido" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Fecha recibido</label>
                                <input type="date" class="form-control" name="fecha_recibido" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Notas</label>
                                <textarea class="form-control" name="notas"
                                    placeholder="Ej: transferencia, efectivo, número de referencia..."></textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" class="btn btn-success">Confirmar</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    // ============================================
    // UI — INQUILINO
    // ============================================
    async montarMisPagos(contenedor, inquilino) {
        await this.actualizarVencidos();
        contenedor.innerHTML = `
            <h2 class="mb-3"><i class="bi bi-cash-stack"></i> Mis pagos</h2>
            <div id="mis-pagos">Cargando...</div>
        `;
        const pagos = await this.listarCalendario({ inquilino_id: inquilino.inquilino_id });
        const cont = document.getElementById('mis-pagos');
        if (!pagos.length) {
            cont.innerHTML = '<p class="text-muted">Aún no hay pagos en tu calendario.</p>';
            return;
        }
        const sum = (cond) => pagos.filter(cond).reduce((s, p) => s + Number(p.monto_esperado), 0);
        const totalPagado    = sum(p => p.estado === 'PAGADO');
        const totalPendiente = sum(p => p.estado !== 'PAGADO');
        cont.innerHTML = `
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Total pagado</div>
                            <div class="metrica-valor text-success">$${totalPagado.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card metrica-card">
                        <div class="card-body">
                            <div class="metrica-label">Por pagar</div>
                            <div class="metrica-valor text-warning">$${totalPendiente.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            </div>
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Periodo</th><th>Fecha límite</th><th>Monto</th>
                    <th>Estado</th><th>Fecha de pago</th>
                </tr></thead>
                <tbody>${pagos.map(p => `
                    <tr>
                        <td>${esc(p.mes)}/${esc(p.anio)}</td>
                        <td>${esc(p.fecha_limite)}</td>
                        <td>$${Number(p.monto_esperado).toLocaleString()}</td>
                        <td><span class="badge badge-${esc(p.estado)}">${esc(p.estado)}</span></td>
                        <td>${esc(p.fecha_pagado) || '—'}</td>
                    </tr>
                `).join('')}</tbody>
            </table>
        `;
    }
};

window.Pagos = Pagos;
