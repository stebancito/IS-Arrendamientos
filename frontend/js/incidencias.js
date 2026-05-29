/* ============================================
   INCIDENCIAS Y NOTIFICACIONES — Dev 6
   Tickets de incidencias del inquilino y
   notificaciones del usuario.
   ============================================ */

const Incidencias = {

    async listar({ duenio_id, inquilino_id, estado } = {}) {
        let q = window.supabaseClient
            .from('incidencias')
            .select(`
                *,
                propiedad:propiedad_id!inner(nombre, duenio_id),
                reportado_por:reportado_por_id(inquilino_id, usuario:usuario_id(nombre_completo))
            `)
            .order('creado_en', { ascending: false });
        if (estado) q = q.eq('estado', estado);
        if (inquilino_id) q = q.eq('reportado_por_id', inquilino_id);
        // Filtro por dueño en el servidor (no traer incidencias de otros arrendadores).
        if (duenio_id) q = q.eq('propiedad.duenio_id', duenio_id);
        const { data, error } = await q;
        if (error) console.error(error);
        return data || [];
    },

    async crear(datos) {
        return await window.supabaseClient
            .from('incidencias').insert(datos).select().single();
    },

    async cambiarEstado(id, estado, resolucion_notas = null) {
        const update = { estado };
        if (estado === 'RESUELTA') {
            update.resuelto_en = new Date().toISOString();
            update.resolucion_notas = resolucion_notas;
        }
        return await window.supabaseClient
            .from('incidencias').update(update).eq('incidencia_id', id);
    },

    // ---------- UI: Arrendador ----------
    async montar(contenedor, usuario) {
        window._usuarioActual = usuario;
        contenedor.innerHTML = `
            <h2 class="mb-3"><i class="bi bi-exclamation-triangle"></i> Incidencias</h2>
            <div id="lista-incidencias">Cargando...</div>
        `;
        const inc = await this.listar({ duenio_id: usuario.usuario_id });
        const cont = document.getElementById('lista-incidencias');
        if (!inc.length) {
            cont.innerHTML = '<p class="text-muted">No hay incidencias reportadas.</p>';
            return;
        }
        cont.innerHTML = inc.map(i => `
            <div class="card mb-2">
                <div class="card-body">
                    <div class="d-flex justify-content-between">
                        <div>
                            <h6>${esc(i.titulo)} <span class="badge bg-info">${esc(i.categoria)}</span></h6>
                            <p class="text-muted small mb-2">
                                ${esc(i.propiedad?.nombre)} · reportado por ${esc(i.reportado_por?.usuario?.nombre_completo)}
                                · ${new Date(i.creado_en).toLocaleDateString()}
                            </p>
                            <p class="mb-2">${esc(i.descripcion)}</p>
                            <span class="badge badge-${esc(i.estado)}">${esc(i.estado)}</span>
                        </div>
                        <div class="text-end">
                            ${i.estado === 'ABIERTA' ? `
                                <button class="btn btn-sm btn-primary mb-1"
                                        onclick="Incidencias._cambiar(${i.incidencia_id}, 'EN_PROCESO')">
                                    En proceso
                                </button><br>` : ''}
                            ${i.estado !== 'RESUELTA' ? `
                                <button class="btn btn-sm btn-success"
                                        onclick="Incidencias._resolver(${i.incidencia_id})">
                                    Resolver
                                </button>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    async _cambiar(id, estado) {
        await this.cambiarEstado(id, estado);
        await this.montar(document.getElementById('contenido'), window._usuarioActual);
    },

    async _resolver(id) {
        const notas = prompt('Notas de resolución:') || '';
        await this.cambiarEstado(id, 'RESUELTA', notas);
        await this.montar(document.getElementById('contenido'), window._usuarioActual);
    },

    // ---------- UI: Inquilino ----------
    async montarMisIncidencias(contenedor, inquilino) {
        window._inquilinoActual = inquilino;
        contenedor.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2><i class="bi bi-exclamation-triangle"></i> Mis incidencias</h2>
                <button class="btn btn-primary" id="btn-nueva-incidencia">
                    <i class="bi bi-plus"></i> Reportar incidencia
                </button>
            </div>
            <div id="lista-mis-incidencias">Cargando...</div>
            ${this._modalHtml()}
        `;
        document.getElementById('btn-nueva-incidencia')
            .addEventListener('click', () => this._abrirFormulario(inquilino));
        document.getElementById('form-incidencia')
            .addEventListener('submit', (e) => this._guardar(e, inquilino));

        await this._refrescarInquilino(inquilino);
    },

    async _refrescarInquilino(inquilino) {
        const inc = await this.listar({ inquilino_id: inquilino.inquilino_id });
        const cont = document.getElementById('lista-mis-incidencias');
        if (!inc.length) {
            cont.innerHTML = '<p class="text-muted">No has reportado incidencias.</p>';
            return;
        }
        cont.innerHTML = inc.map(i => `
            <div class="card mb-2">
                <div class="card-body">
                    <h6>${esc(i.titulo)} <span class="badge badge-${esc(i.estado)}">${esc(i.estado)}</span></h6>
                    <p class="text-muted small">${esc(i.propiedad?.nombre)} · ${esc(i.categoria)}</p>
                    <p>${esc(i.descripcion)}</p>
                    ${i.resolucion_notas ? `<small class="text-success"><strong>Resolución:</strong> ${esc(i.resolucion_notas)}</small>` : ''}
                </div>
            </div>
        `).join('');
    },

    async _abrirFormulario(inquilino) {
        const form = document.getElementById('form-incidencia');
        form.reset();
        const { data: contratos } = await window.supabaseClient
            .from('contratos')
            .select('propiedad:propiedad_id(propiedad_id, nombre)')
            .eq('inquilino_id', inquilino.inquilino_id)
            .eq('estado', 'ACTIVO');
        const opciones = (contratos || [])
            .filter(c => c.propiedad)
            .map(c => `<option value="${c.propiedad.propiedad_id}">${esc(c.propiedad.nombre)}</option>`).join('');
        if (!opciones) {
            alert('No tienes un contrato activo, así que no puedes reportar incidencias todavía.');
            return;
        }
        form.propiedad_id.innerHTML = opciones;
        new bootstrap.Modal(document.getElementById('modal-incidencia')).show();
    },

    async _guardar(e, inquilino) {
        e.preventDefault();
        const form = e.target;
        const { error } = await this.crear({
            propiedad_id: parseInt(form.propiedad_id.value),
            reportado_por_id: inquilino.inquilino_id,
            titulo: form.titulo.value,
            descripcion: form.descripcion.value,
            categoria: form.categoria.value
        });
        if (error) return alert('Error: ' + error.message);
        bootstrap.Modal.getInstance(document.getElementById('modal-incidencia')).hide();
        await this._refrescarInquilino(inquilino);
    },

    _modalHtml() {
        return `
            <div class="modal fade" id="modal-incidencia" tabindex="-1">
                <div class="modal-dialog">
                    <form class="modal-content" id="form-incidencia">
                        <div class="modal-header">
                            <h5 class="modal-title">Reportar incidencia</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label">Propiedad</label>
                                <select class="form-select" name="propiedad_id" required></select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Categoría</label>
                                <select class="form-select" name="categoria" required>
                                    <option value="PLOMERIA">Plomería</option>
                                    <option value="ELECTRICIDAD">Electricidad</option>
                                    <option value="ESTRUCTURA">Estructura</option>
                                    <option value="LIMPIEZA">Limpieza</option>
                                    <option value="SEGURIDAD">Seguridad</option>
                                    <option value="OTRO">Otro</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Título</label>
                                <input class="form-control" name="titulo" required maxlength="200">
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Descripción</label>
                                <textarea class="form-control" name="descripcion" rows="4" required></textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" class="btn btn-primary">Enviar</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }
};

window.Incidencias = Incidencias;


/* ============================================
   NOTIFICACIONES (parte de Dev 6)
   Inline aquí para mantener la estructura del
   README (no se crea archivo separado).
   ============================================ */
const Notificaciones = {

    async listar(usuarioId, soloNoLeidas = false) {
        let q = window.supabaseClient
            .from('notificaciones')
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('creado_en', { ascending: false });
        if (soloNoLeidas) q = q.eq('leida', false);
        const { data } = await q;
        return data || [];
    },

    async marcarLeida(id) {
        return await window.supabaseClient
            .from('notificaciones')
            .update({ leida: true, leida_en: new Date().toISOString() })
            .eq('notificacion_id', id);
    },

    async marcarTodasLeidas(usuarioId) {
        return await window.supabaseClient
            .from('notificaciones')
            .update({ leida: true, leida_en: new Date().toISOString() })
            .eq('usuario_id', usuarioId)
            .eq('leida', false);
    },

    async contarNoLeidas(usuarioId) {
        const { count } = await window.supabaseClient
            .from('notificaciones')
            .select('*', { count: 'exact', head: true })
            .eq('usuario_id', usuarioId)
            .eq('leida', false);
        return count || 0;
    },

    async montar(contenedor, usuario) {
        contenedor.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2><i class="bi bi-bell"></i> Notificaciones</h2>
                <button class="btn btn-sm btn-outline-primary" id="btn-marcar-todas">
                    Marcar todas como leídas
                </button>
            </div>
            <div id="lista-notificaciones">Cargando...</div>
        `;
        document.getElementById('btn-marcar-todas').addEventListener('click', async () => {
            await this.marcarTodasLeidas(usuario.usuario_id);
            await this.montar(contenedor, usuario);
        });
        await this._refrescar(usuario);
    },

    async _refrescar(usuario) {
        const notifs = await this.listar(usuario.usuario_id);
        const cont = document.getElementById('lista-notificaciones');
        if (!notifs.length) {
            cont.innerHTML = '<p class="text-muted">Sin notificaciones.</p>';
            return;
        }
        cont.innerHTML = notifs.map(n => `
            <div class="notificacion-item ${n.leida ? '' : 'no-leida'}"
                 onclick="Notificaciones._marcar(${n.notificacion_id}, ${Number(usuario.usuario_id)})">
                <div class="d-flex justify-content-between">
                    <strong>${esc(n.titulo)}</strong>
                    <small class="text-muted">${new Date(n.creado_en).toLocaleString()}</small>
                </div>
                <p class="mb-0 small">${esc(n.mensaje)}</p>
            </div>
        `).join('');
    },

    async _marcar(id, usuarioId) {
        await this.marcarLeida(id);
        const usuario = { usuario_id: parseInt(usuarioId) };
        await this._refrescar(usuario);
    }
};

window.Notificaciones = Notificaciones;
