/* ============================================
   CONTRATOS — Dev 3
   Vinculación Propiedad + Inquilino + montos
   + estados + terminación anticipada.
   ============================================ */

const Contratos = {

    // ---------- CRUD ----------
    async listar(filtros = {}) {
        let q = window.supabaseClient
            .from('contratos')
            .select(`
                *,
                propiedad:propiedad_id!inner(propiedad_id, nombre, direccion, duenio_id),
                inquilino:inquilino_id(inquilino_id, usuario:usuario_id(nombre_completo, correo))
            `)
            .order('creado_en', { ascending: false });
        if (filtros.estado) q = q.eq('estado', filtros.estado);
        if (filtros.inquilino_id) q = q.eq('inquilino_id', filtros.inquilino_id);
        // Filtro por dueño en el servidor (no traer contratos de otros arrendadores).
        if (filtros.duenio_id) q = q.eq('propiedad.duenio_id', filtros.duenio_id);
        const { data, error } = await q;
        if (error) console.error(error);
        return data || [];
    },

    async obtener(id) {
        const { data } = await window.supabaseClient
            .from('contratos')
            .select(`*, propiedad:propiedad_id(*), inquilino:inquilino_id(*, usuario:usuario_id(*))`)
            .eq('contrato_id', id).single();
        return data;
    },

    async crear(datos) {
        if (new Date(datos.fecha_fin) <= new Date(datos.fecha_inicio)) {
            return { error: { message: 'La fecha fin debe ser posterior a la fecha de inicio' } };
        }
        if (!Number.isFinite(datos.monto_renta) || datos.monto_renta <= 0) {
            return { error: { message: 'El monto debe ser un número mayor a 0' } };
        }
        return await window.supabaseClient
            .from('contratos').insert(datos).select().single();
    },

    async finalizar(id, fecha_terminacion, observaciones = '') {
        return await window.supabaseClient
            .from('contratos')
            .update({
                estado: 'TERMINADO',
                fecha_terminacion: fecha_terminacion,
                observaciones
            })
            .eq('contrato_id', id);
    },

    // ---------- UI ----------
    async montar(contenedor, usuario) {
        window._usuarioActual = usuario;
        contenedor.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2><i class="bi bi-file-earmark-text"></i> Contratos</h2>
                <button class="btn btn-primary" id="btn-nuevo-contrato">
                    <i class="bi bi-plus"></i> Nuevo contrato
                </button>
            </div>
            <ul class="nav nav-tabs mb-3">
                <li class="nav-item"><a class="nav-link active" data-filtro="ACTIVO" href="#">Activos</a></li>
                <li class="nav-item"><a class="nav-link" data-filtro="TERMINADO" href="#">Terminados</a></li>
                <li class="nav-item"><a class="nav-link" data-filtro="" href="#">Todos</a></li>
            </ul>
            <div id="lista-contratos">Cargando...</div>
            ${this._modalHtml()}
        `;

        document.querySelectorAll('[data-filtro]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('[data-filtro]').forEach(x => x.classList.remove('active'));
                a.classList.add('active');
                this._refrescar(usuario, a.dataset.filtro);
            });
        });
        document.getElementById('btn-nuevo-contrato')
            .addEventListener('click', () => this._abrirFormulario(usuario));
        document.getElementById('form-contrato')
            .addEventListener('submit', (e) => this._guardar(e, usuario));

        await this._refrescar(usuario, 'ACTIVO');
    },

    async _refrescar(usuario, estado) {
        const filtros = { duenio_id: usuario.usuario_id };
        if (estado) filtros.estado = estado;
        const contratos = await this.listar(filtros);
        const cont = document.getElementById('lista-contratos');
        if (!contratos.length) {
            cont.innerHTML = '<p class="text-muted">No hay contratos en este estado.</p>';
            return;
        }
        cont.innerHTML = `
            <table class="table table-hover bg-white">
                <thead><tr>
                    <th>Propiedad</th><th>Inquilino</th><th>Periodo</th>
                    <th>Monto</th><th>Estado</th><th></th>
                </tr></thead>
                <tbody>${contratos.map(c => `
                    <tr>
                        <td>${esc(c.propiedad?.nombre) || '—'}</td>
                        <td>${esc(c.inquilino?.usuario?.nombre_completo) || '—'}</td>
                        <td>${esc(c.fecha_inicio)} → ${esc(c.fecha_fin)}</td>
                        <td>$${Number(c.monto_renta).toLocaleString()} / ${esc(c.frecuencia_pago.toLowerCase())}</td>
                        <td><span class="badge badge-${esc(c.estado)}">${esc(c.estado)}</span></td>
                        <td>
                            ${c.estado === 'ACTIVO' ? `
                                <button class="btn btn-sm btn-outline-danger"
                                        onclick="Contratos._terminar(${c.contrato_id})">
                                    Terminar
                                </button>` : ''}
                        </td>
                    </tr>
                `).join('')}</tbody>
            </table>`;
    },

    async _abrirFormulario(usuario) {
        const form = document.getElementById('form-contrato');
        form.reset();

        const [props, inquilinos] = await Promise.all([
            window.Propiedades.listar(usuario.usuario_id),
            window.Propiedades.listarInquilinos()
        ]);

        form.propiedad_id.innerHTML = props
            .map(p => `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('');
        form.inquilino_id.innerHTML = inquilinos
            .map(i => `<option value="${i.inquilino_id}">${esc(i.usuario?.nombre_completo)} (${esc(i.usuario?.correo)})</option>`).join('');

        new bootstrap.Modal(document.getElementById('modal-contrato')).show();
    },

    async _guardar(e, usuario) {
        e.preventDefault();
        const form = e.target;
        const datos = {
            propiedad_id: parseInt(form.propiedad_id.value),
            inquilino_id: parseInt(form.inquilino_id.value),
            fecha_inicio: form.fecha_inicio.value,
            fecha_fin: form.fecha_fin.value,
            monto_renta: parseFloat(form.monto_renta.value),
            frecuencia_pago: form.frecuencia_pago.value,
            observaciones: form.observaciones.value
        };
        const { error } = await this.crear(datos);
        if (error) return alert('Error: ' + error.message);

        bootstrap.Modal.getInstance(document.getElementById('modal-contrato')).hide();
        const tabActiva = document.querySelector('[data-filtro].active')?.dataset.filtro || 'ACTIVO';
        await this._refrescar(usuario, tabActiva);
        alert('Contrato creado. El calendario de pagos se generó automáticamente.');
    },

    async _terminar(id) {
        const fecha = prompt('Fecha de terminación (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
        if (!fecha) return;
        const obs = prompt('Observaciones (opcional):') || '';
        await this.finalizar(id, fecha, obs);
        const tabActiva = document.querySelector('[data-filtro].active')?.dataset.filtro || 'ACTIVO';
        await this._refrescar(window._usuarioActual, tabActiva);
    },

    _modalHtml() {
        return `
            <div class="modal fade" id="modal-contrato" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <form class="modal-content" id="form-contrato">
                        <div class="modal-header">
                            <h5 class="modal-title">Nuevo contrato</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Propiedad</label>
                                    <select class="form-select" name="propiedad_id" required></select>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Inquilino</label>
                                    <select class="form-select" name="inquilino_id" required></select>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Fecha inicio</label>
                                    <input type="date" class="form-control" name="fecha_inicio" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Fecha fin</label>
                                    <input type="date" class="form-control" name="fecha_fin" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Monto de renta</label>
                                    <input type="number" step="0.01" class="form-control" name="monto_renta" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Frecuencia</label>
                                    <select class="form-select" name="frecuencia_pago" required>
                                        <option value="MENSUAL">Mensual</option>
                                        <option value="QUINCENAL">Quincenal</option>
                                        <option value="SEMANAL">Semanal</option>
                                    </select>
                                </div>
                                <div class="col-12 mb-3">
                                    <label class="form-label">Observaciones</label>
                                    <textarea class="form-control" name="observaciones"></textarea>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" class="btn btn-primary">Crear contrato</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    // ---------- Vista del inquilino ----------
    async montarMiContrato(contenedor, inquilino) {
        contenedor.innerHTML = `<h2><i class="bi bi-file-earmark-text"></i> Mi contrato</h2><div id="mi-contrato">Cargando...</div>`;
        const contratos = await this.listar({ inquilino_id: inquilino.inquilino_id, estado: 'ACTIVO' });
        const cont = document.getElementById('mi-contrato');
        if (!contratos.length) {
            cont.innerHTML = '<p class="text-muted">No tienes un contrato activo en este momento.</p>';
            return;
        }
        const c = contratos[0];
        cont.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5>${esc(c.propiedad?.nombre)}</h5>
                    <p class="text-muted">${esc(c.propiedad?.direccion)}</p>
                    <hr>
                    <p><strong>Periodo:</strong> ${esc(c.fecha_inicio)} → ${esc(c.fecha_fin)}</p>
                    <p><strong>Renta:</strong> $${Number(c.monto_renta).toLocaleString()} (${esc(c.frecuencia_pago)})</p>
                    <p><strong>Estado:</strong> <span class="badge badge-${esc(c.estado)}">${esc(c.estado)}</span></p>
                </div>
            </div>
        `;
    }
};

window.Contratos = Contratos;
