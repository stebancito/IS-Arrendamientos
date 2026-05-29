/* ============================================
   PROPIEDADES E INQUILINOS — Dev 2
   CRUD de propiedades + jerarquía + listado
   de inquilinos del sistema.
   ============================================ */

const Propiedades = {

    // ---------- CRUD ----------
    async listar(duenioId) {
        const { data, error } = await window.supabaseClient
            .from('propiedades')
            .select('*, propiedad_padre:propiedad_padre_id(nombre)')
            .eq('duenio_id', duenioId)
            .eq('activa', true)
            .order('creado_en', { ascending: false });
        if (error) console.error(error);
        return data || [];
    },

    async obtener(id) {
        const { data } = await window.supabaseClient
            .from('propiedades').select('*').eq('propiedad_id', id).single();
        return data;
    },

    async crear(datos) {
        return await window.supabaseClient
            .from('propiedades').insert(datos).select().single();
    },

    async actualizar(id, datos) {
        return await window.supabaseClient
            .from('propiedades').update(datos).eq('propiedad_id', id).select().single();
    },

    async eliminar(id) {
        const { count } = await window.supabaseClient
            .from('contratos')
            .select('*', { count: 'exact', head: true })
            .eq('propiedad_id', id)
            .eq('estado', 'ACTIVO');
        if (count > 0) {
            return { error: { message: 'No se puede eliminar: tiene contratos activos' } };
        }
        return await this.actualizar(id, { activa: false });
    },

    // ---------- UI ----------
    async montar(contenedor, usuario) {
        window._usuarioActual = usuario;
        contenedor.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h2><i class="bi bi-houses"></i> Mis propiedades</h2>
                <button class="btn btn-primary" id="btn-nueva-propiedad">
                    <i class="bi bi-plus"></i> Nueva propiedad
                </button>
            </div>
            <div id="lista-propiedades" class="row g-3">Cargando...</div>
            ${this._modalHtml()}
        `;
        await this._refrescar(usuario);
        document.getElementById('btn-nueva-propiedad')
            .addEventListener('click', () => this._abrirFormulario(usuario));
        document.getElementById('form-propiedad')
            .addEventListener('submit', (e) => this._guardar(e, usuario));
    },

    async _refrescar(usuario) {
        const props = await this.listar(usuario.usuario_id);
        const cont = document.getElementById('lista-propiedades');
        if (!props.length) {
            cont.innerHTML = '<p class="text-muted">Aún no tienes propiedades registradas.</p>';
            return;
        }
        cont.innerHTML = props.map(p => `
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-body">
                        <h5 class="card-title">${esc(p.nombre)}</h5>
                        <p class="small text-muted mb-2">
                            <i class="bi bi-geo-alt"></i> ${esc(p.direccion)}
                        </p>
                        <span class="badge bg-info">${esc(p.tipo_propiedad)}</span>
                        ${p.propiedad_padre ? `<span class="badge bg-secondary">en ${esc(p.propiedad_padre.nombre)}</span>` : ''}
                        <p class="mt-2 mb-3">${esc(p.descripcion || '')}</p>
                        <button class="btn btn-sm btn-outline-primary"
                                onclick="Propiedades._abrirFormulario(window._usuarioActual, ${p.propiedad_id})">
                            <i class="bi bi-pencil"></i> Editar
                        </button>
                        <button class="btn btn-sm btn-outline-danger"
                                onclick="Propiedades._eliminar(${p.propiedad_id})">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    },

    async _abrirFormulario(usuario, id = null) {
        const form = document.getElementById('form-propiedad');
        form.reset();
        form.propiedad_id.value = '';

        const props = await this.listar(usuario.usuario_id);
        form.propiedad_padre_id.innerHTML = '<option value="">— Ninguna —</option>' +
            props.filter(p => p.propiedad_id !== id)
                 .map(p => `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('');

        if (id) {
            const p = await this.obtener(id);
            form.propiedad_id.value = p.propiedad_id;
            form.nombre.value = p.nombre;
            form.direccion.value = p.direccion;
            form.tipo_propiedad.value = p.tipo_propiedad;
            form.propiedad_padre_id.value = p.propiedad_padre_id || '';
            form.descripcion.value = p.descripcion || '';
            form.querySelector('.modal-title').textContent = 'Editar propiedad';
        } else {
            form.querySelector('.modal-title').textContent = 'Nueva propiedad';
        }
        new bootstrap.Modal(document.getElementById('modal-propiedad')).show();
    },

    async _guardar(e, usuario) {
        e.preventDefault();
        const form = e.target;
        const datos = {
            nombre: form.nombre.value,
            direccion: form.direccion.value,
            tipo_propiedad: form.tipo_propiedad.value,
            propiedad_padre_id: form.propiedad_padre_id.value || null,
            descripcion: form.descripcion.value,
            duenio_id: usuario.usuario_id
        };
        const id = form.propiedad_id.value;
        const { error } = id ? await this.actualizar(id, datos) : await this.crear(datos);
        if (error) return alert('Error: ' + error.message);

        bootstrap.Modal.getInstance(document.getElementById('modal-propiedad')).hide();
        await this._refrescar(usuario);
    },

    async _eliminar(id) {
        if (!confirm('¿Eliminar esta propiedad?')) return;
        const { error } = await this.eliminar(id);
        if (error) return alert(error.message);
        await this._refrescar(window._usuarioActual);
    },

    _modalHtml() {
        return `
            <div class="modal fade" id="modal-propiedad" tabindex="-1">
                <div class="modal-dialog">
                    <form class="modal-content" id="form-propiedad">
                        <div class="modal-header">
                            <h5 class="modal-title">Nueva propiedad</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" name="propiedad_id">
                            <div class="mb-3">
                                <label class="form-label">Nombre</label>
                                <input class="form-control" name="nombre" required>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Dirección</label>
                                <textarea class="form-control" name="direccion" required></textarea>
                            </div>
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Tipo</label>
                                    <select class="form-select" name="tipo_propiedad" required>
                                        <option value="EDIFICIO">Edificio</option>
                                        <option value="DEPARTAMENTO">Departamento</option>
                                        <option value="CASA">Casa</option>
                                        <option value="LOCAL">Local</option>
                                        <option value="TERRENO">Terreno</option>
                                    </select>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Propiedad padre</label>
                                    <select class="form-select" name="propiedad_padre_id">
                                        <option value="">— Ninguna —</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Descripción</label>
                                <textarea class="form-control" name="descripcion"></textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" class="btn btn-primary">Guardar</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    },

    // ============================================
    // SUB-MÓDULO: Inquilinos
    // ============================================
    async listarInquilinos() {
        const { data } = await window.supabaseClient
            .from('inquilinos')
            .select('*, usuario:usuario_id(nombre_completo, correo, telefono)');
        return data || [];
    },

    async montarInquilinos(contenedor) {
        contenedor.innerHTML = `
            <h2 class="mb-3"><i class="bi bi-people"></i> Inquilinos del sistema</h2>
            <div id="lista-inquilinos">Cargando...</div>
        `;
        const inquilinos = await this.listarInquilinos();
        const html = !inquilinos.length
            ? '<p class="text-muted">Aún no hay inquilinos registrados.</p>'
            : `<table class="table table-hover bg-white">
                <thead><tr>
                    <th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Contacto Emergencia</th>
                </tr></thead>
                <tbody>${inquilinos.map(i => `
                    <tr>
                        <td>${esc(i.usuario?.nombre_completo) || '—'}</td>
                        <td>${esc(i.usuario?.correo) || '—'}</td>
                        <td>${esc(i.usuario?.telefono) || '—'}</td>
                        <td>${esc(i.contacto_emergencia) || '—'}</td>
                    </tr>
                `).join('')}</tbody>
            </table>`;
        document.getElementById('lista-inquilinos').innerHTML = html;
    }
};

window.Propiedades = Propiedades;
