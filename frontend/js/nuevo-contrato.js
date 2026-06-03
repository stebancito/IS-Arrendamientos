// ================================================================
// nuevo-contrato.js  –  Módulo del Dev 3 (Gestión de Contratos)
// ================================================================
// Responsabilidades:
//   - RF-11/12 : Vincular un inquilino existente con una propiedad.
//   - RF-15/16 : Crear contrato con fecha inicio/fin, monto y frecuencia.
//   - RN-05    : fecha_fin estrictamente posterior a fecha_inicio.
//   - RN-06    : monto_renta > 0.
//   - RN-03/10 : Una propiedad no puede tener otro contrato ACTIVO/PENDIENTE.
//   - Lógica   : El contrato nace en estado PENDIENTE, esperando la aceptación
//                explícita del inquilino antes de pasar a ACTIVO.
//
// Consulta clave de validación (RN-03 + RN-10):
//   .from('contratos')
//   .select('contrato_id', { count: 'exact', head: true })
//   .eq('propiedad_id', X)
//   .in('estado', ['ACTIVO', 'PENDIENTE'])
//
// Búsqueda de inquilino (RF-11/12):
//   .from('usuarios')
//   .select(...)
//   .eq('rol', 'INQUILINO')
//   .or(`correo.ilike.%${q}%,telefono.ilike.%${q}%`)
// ================================================================

const NUEVO_CONTRATO = (() => {

    let _usuario = null;
    let _inquilinoSeleccionado = null;
    let _propiedades = [];          // unidades habitables disponibles
    let _debounceBuscar = null;
    let _propiedadPreset = null;    // si llega por ?propiedadId=N

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        // Soportar ?propiedadId=N en la URL (al venir desde "Crear contrato"
        // en la tarjeta de una propiedad disponible)
        const params = new URLSearchParams(window.location.search);
        _propiedadPreset = params.get('propiedadId') || params.get('deptoId');

        // Fecha de inicio por defecto: hoy
        const hoy = new Date().toISOString().slice(0, 10);
        document.getElementById('fecha-inicio').value = hoy;

        await _cargarPropiedadesDisponibles();
        _bindEventos();
    }

    // ──────────────────────────────────────────────────────────────
    // 1. Cargar propiedades del arrendador SIN contratos activos/pendientes
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedadesDisponibles() {
        // a) Todas las propiedades del arrendador (solo unidades habitables)
        const { data: props, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion, tipo_propiedad, propiedad_padre_id')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('activa', true)
            .neq('tipo_propiedad', 'EDIFICIO')     // los edificios no se rentan, solo sus deptos
            .order('nombre', { ascending: true });

        if (error) {
            console.error('[NUEVO-CONTRATO] Error cargando propiedades:', error);
            _alerta('No se pudieron cargar las propiedades.', 'error');
            return;
        }

        // b) Contratos activos/pendientes para excluir esas propiedades
        const ids = (props || []).map(p => p.propiedad_id);
        let ocupadas = new Set();
        if (ids.length) {
            const { data: contratos } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id, estado')
                .in('propiedad_id', ids)
                .in('estado', ['ACTIVO', 'PENDIENTE']);
            (contratos || []).forEach(c => ocupadas.add(c.propiedad_id));
        }

        _propiedades = (props || []).filter(p => !ocupadas.has(p.propiedad_id));

        const select = document.getElementById('propiedad-id');
        const tipoLbl = { DEPARTAMENTO:'Depto', CASA:'Casa', LOCAL:'Local', TERRENO:'Terreno' };
        select.innerHTML = `<option value="">— Selecciona una propiedad —</option>` +
            _propiedades.map(p => `
                <option value="${p.propiedad_id}">
                    ${esc(p.nombre)} (${tipoLbl[p.tipo_propiedad] || p.tipo_propiedad})
                </option>`).join('');

        // Si llegó preseleccionada por URL, intentar marcarla
        if (_propiedadPreset) {
            const idNum = parseInt(_propiedadPreset, 10);
            const existe = _propiedades.some(p => p.propiedad_id === idNum);
            if (existe) {
                select.value = String(idNum);
                _onCambioPropiedad();
            } else {
                _mostrarStatusPropiedad(
                    'La propiedad solicitada no está disponible (puede tener otro contrato activo).',
                    'error'
                );
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 2. Bind de eventos
    // ──────────────────────────────────────────────────────────────
    function _bindEventos() {
        const input = document.getElementById('busqueda-inquilino');
        input.addEventListener('input', () => {
            clearTimeout(_debounceBuscar);
            _debounceBuscar = setTimeout(() => _buscarInquilino(input.value.trim()), 280);
        });

        document.getElementById('btn-cambiar-inquilino').addEventListener('click', _limpiarSeleccionInquilino);

        document.getElementById('propiedad-id').addEventListener('change', _onCambioPropiedad);

        ['fecha-inicio', 'fecha-fin'].forEach(id => {
            document.getElementById(id).addEventListener('change', _actualizarPreview);
            document.getElementById(id).addEventListener('input',  _actualizarPreview);
        });
        document.getElementById('monto-renta').addEventListener('input', _actualizarPreview);

        document.getElementById('btn-crear').addEventListener('click', _crearContrato);

        // Cerrar resultados al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#resultados-busqueda') && !e.target.closest('#busqueda-inquilino')) {
                document.getElementById('resultados-busqueda').classList.add('hidden');
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // 3. Búsqueda de inquilinos (correo / teléfono)
    // ──────────────────────────────────────────────────────────────
    async function _buscarInquilino(query) {
        const cont = document.getElementById('resultados-busqueda');
        if (!query || query.length < 3) {
            cont.classList.add('hidden');
            cont.innerHTML = '';
            return;
        }

        // Consulta: buscar por correo O teléfono, solo usuarios con rol INQUILINO
        // Limitamos a 8 resultados para no sobrepoblar el dropdown.
        const { data, error } = await window.supabaseClient
            .from('usuarios')
            .select('usuario_id, nombre_completo, correo, telefono, rol, activo')
            .eq('rol', 'INQUILINO')
            .eq('activo', true)
            .or(`correo.ilike.%${query}%,telefono.ilike.%${query}%,nombre_completo.ilike.%${query}%`)
            .limit(8);

        if (error) {
            console.error('[NUEVO-CONTRATO] Error en búsqueda:', error);
            return;
        }

        if (!data?.length) {
            cont.innerHTML = `<p class="p-4 text-xs text-slate-400 text-center">
                Sin coincidencias para <span class="font-semibold">${esc(query)}</span>.
                Pídele al inquilino que se registre primero.
            </p>`;
            cont.classList.remove('hidden');
            return;
        }

        cont.innerHTML = data.map(u => {
            const iniciales = (u.nombre_completo || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
            return `
                <button type="button" data-id="${u.usuario_id}"
                        class="resultado-inq w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-100 last:border-0">
                    <div class="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-800 text-sm font-semibold truncate">${esc(u.nombre_completo)}</p>
                        <p class="text-slate-400 text-xs truncate">
                            <i class="fa-solid fa-envelope text-[10px] mr-0.5"></i>${esc(u.correo)}
                            ${u.telefono ? `<span class="ml-2"><i class="fa-solid fa-phone text-[10px] mr-0.5"></i>${esc(u.telefono)}</span>` : ''}
                        </p>
                    </div>
                    <i class="fa-solid fa-chevron-right text-slate-300 text-xs"></i>
                </button>`;
        }).join('');
        cont.classList.remove('hidden');

        cont.querySelectorAll('.resultado-inq').forEach(btn => {
            btn.addEventListener('click', async () => {
                const usuarioId = parseInt(btn.getAttribute('data-id'), 10);
                const usr = data.find(x => x.usuario_id === usuarioId);
                await _seleccionarInquilino(usr);
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // 4. Selección de inquilino
    //    Verificamos que tenga registro en la tabla `inquilinos`;
    //    si no, lo creamos en el momento (extensión de RF-11).
    // ──────────────────────────────────────────────────────────────
    async function _seleccionarInquilino(usr) {
        const { data: existente } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id, usuario_id')
            .eq('usuario_id', usr.usuario_id)
            .maybeSingle();

        let inquilino_id = existente?.inquilino_id;
        if (!inquilino_id) {
            // Crear el registro mínimo en la tabla inquilinos
            const { data: nuevo, error } = await window.supabaseClient
                .from('inquilinos')
                .insert({ usuario_id: usr.usuario_id })
                .select('inquilino_id')
                .single();
            if (error) {
                console.error('[NUEVO-CONTRATO] No se pudo crear inquilino:', error);
                _alerta('No se pudo registrar al inquilino. Intenta de nuevo.', 'error');
                return;
            }
            inquilino_id = nuevo.inquilino_id;
        }

        _inquilinoSeleccionado = {
            inquilino_id,
            usuario_id: usr.usuario_id,
            nombre_completo: usr.nombre_completo,
            correo: usr.correo,
            telefono: usr.telefono
        };

        // UI
        document.getElementById('resultados-busqueda').classList.add('hidden');
        document.getElementById('busqueda-inquilino').value = '';

        const iniciales = (usr.nombre_completo || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
        document.getElementById('inq-sel-avatar').textContent = iniciales;
        document.getElementById('inq-sel-nombre').textContent = usr.nombre_completo;
        document.getElementById('inq-sel-correo').textContent = usr.correo;
        document.getElementById('inquilino-seleccionado').classList.remove('hidden');

        _actualizarPreview();
    }

    function _limpiarSeleccionInquilino() {
        _inquilinoSeleccionado = null;
        document.getElementById('inquilino-seleccionado').classList.add('hidden');
        document.getElementById('busqueda-inquilino').focus();
        _actualizarPreview();
    }

    // ──────────────────────────────────────────────────────────────
    // 5. Cambio de propiedad → actualizar preview
    // ──────────────────────────────────────────────────────────────
    function _onCambioPropiedad() {
        _mostrarStatusPropiedad('', null);
        _actualizarPreview();
    }

    function _mostrarStatusPropiedad(msg, tipo) {
        const el = document.getElementById('prop-status');
        if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        const color = tipo === 'error' ? 'text-red-600' : 'text-slate-500';
        el.className = `mt-2 text-xs ${color}`;
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    // ──────────────────────────────────────────────────────────────
    // 6. Preview lateral en tiempo real
    // ──────────────────────────────────────────────────────────────
    function _actualizarPreview() {
        const inq = _inquilinoSeleccionado?.nombre_completo;
        document.getElementById('pv-inquilino').textContent = inq || 'Sin inquilino seleccionado';

        const propId = document.getElementById('propiedad-id').value;
        const prop = _propiedades.find(p => String(p.propiedad_id) === propId);
        document.getElementById('pv-propiedad').textContent = prop ? prop.nombre : 'Sin propiedad asignada';

        const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : '—';
        const fi = document.getElementById('fecha-inicio').value;
        const ff = document.getElementById('fecha-fin').value;
        document.getElementById('pv-inicio').textContent = fmtFecha(fi);
        document.getElementById('pv-fin').textContent    = fmtFecha(ff);

        // Duración
        let durTxt = '—';
        if (fi && ff) {
            const a = new Date(fi), b = new Date(ff);
            if (b > a) {
                const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
                durTxt = months >= 12
                    ? `${(months / 12).toFixed(1)} año(s)`
                    : `${months} mes(es)`;
            }
        }
        document.getElementById('pv-duracion').textContent = durTxt;

        const monto = parseFloat(document.getElementById('monto-renta').value) || 0;
        document.getElementById('pv-monto').textContent = monto > 0
            ? new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:0 }).format(monto)
            : '—';
    }

    // ──────────────────────────────────────────────────────────────
    // 7. Crear el contrato
    // ──────────────────────────────────────────────────────────────
    async function _crearContrato() {
        const btn = document.getElementById('btn-crear');

        // Validaciones de UI
        if (!_inquilinoSeleccionado) {
            _alerta('Selecciona primero a un inquilino registrado.', 'error');
            return;
        }
        const propiedadId = parseInt(document.getElementById('propiedad-id').value, 10);
        if (!propiedadId) { _alerta('Selecciona una propiedad.', 'error'); return; }

        const fechaInicio = document.getElementById('fecha-inicio').value;
        const fechaFin    = document.getElementById('fecha-fin').value;
        const montoRenta  = parseFloat(document.getElementById('monto-renta').value);
        const frecuencia  = document.getElementById('frecuencia-pago').value;
        const beneficios  = document.getElementById('beneficios').value.trim();
        const observaciones = document.getElementById('observaciones').value.trim();

        if (!fechaInicio || !fechaFin) {
            _alerta('Indica las fechas de inicio y término.', 'error');
            return;
        }

        // RN-05: fecha_fin estrictamente posterior a fecha_inicio
        if (new Date(fechaFin) <= new Date(fechaInicio)) {
            document.getElementById('fechas-error').classList.remove('hidden');
            setTimeout(() => document.getElementById('fechas-error').classList.add('hidden'), 4000);
            _alerta('La fecha de término debe ser posterior a la de inicio.', 'error');
            return;
        }

        // RN-06: monto > 0
        if (isNaN(montoRenta) || montoRenta <= 0) {
            document.getElementById('monto-error').classList.remove('hidden');
            setTimeout(() => document.getElementById('monto-error').classList.add('hidden'), 4000);
            _alerta('El monto debe ser mayor a cero.', 'error');
            return;
        }

        AUTH.setLoading(btn, true);

        try {
            // ── Validación final en vivo: RN-03 + RN-10 ──
            // (Defensa contra condiciones de carrera: otro arrendador o este mismo
            //  pudo haber creado un contrato mientras el formulario estaba abierto.)
            const { count } = await window.supabaseClient
                .from('contratos')
                .select('contrato_id', { count: 'exact', head: true })
                .eq('propiedad_id', propiedadId)
                .in('estado', ['ACTIVO', 'PENDIENTE']);

            if ((count || 0) > 0) {
                AUTH.setLoading(btn, false);
                _alerta('Esta propiedad ya tiene un contrato activo o pendiente. Recarga la lista.', 'error');
                return;
            }

            // Insertar el contrato en estado PENDIENTE
            const { data: nuevo, error } = await window.supabaseClient
                .from('contratos')
                .insert({
                    propiedad_id: propiedadId,
                    inquilino_id: _inquilinoSeleccionado.inquilino_id,
                    fecha_inicio: fechaInicio,
                    fecha_fin: fechaFin,
                    monto_renta: montoRenta,
                    frecuencia_pago: frecuencia,
                    estado: 'PENDIENTE',
                    beneficios: beneficios || null,
                    observaciones: observaciones || null
                })
                .select('contrato_id')
                .single();

            if (error) throw error;

            if (window.TOAST) {
                TOAST.success('Contrato creado. El inquilino recibirá la solicitud para aceptarlo.');
            }

            // Crear notificación interna para el inquilino (RF-38 análogo)
            await window.supabaseClient.from('notificaciones').insert({
                usuario_id: _inquilinoSeleccionado.usuario_id,
                titulo: 'Nuevo contrato pendiente de tu aceptación',
                mensaje: `Tienes un nuevo contrato de arrendamiento esperando tu aprobación. Revísalo desde "Mi Contrato".`,
                tipo: 'RECORDATORIO',
                metadatos: { contrato_id: nuevo.contrato_id }
            });

            setTimeout(() => {
                window.location.href = `detalle-contrato.html?contratoId=${nuevo.contrato_id}`;
            }, 800);

        } catch (err) {
            console.error('[NUEVO-CONTRATO] Error al crear contrato:', err);
            AUTH.setLoading(btn, false);
            _alerta('No se pudo crear el contrato: ' + (err.message || 'error desconocido'), 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helper de alerta inline
    // ──────────────────────────────────────────────────────────────
    function _alerta(msg, tipo = 'error') {
        const el = document.getElementById('form-alert');
        if (!el) return;
        const colores = {
            error:   'bg-red-50 border border-red-200 text-red-700',
            success: 'bg-green-50 border border-green-200 text-green-700',
            info:    'bg-blue-50 border border-blue-200 text-blue-700',
        };
        el.className = `mb-4 px-4 py-3 rounded-xl text-sm font-medium ${colores[tipo] || colores.error}`;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    return { init };
})();

window.NUEVO_CONTRATO = NUEVO_CONTRATO;