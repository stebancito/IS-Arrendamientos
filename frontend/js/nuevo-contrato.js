// ================================================================
// nuevo-contrato.js  –  Módulo del Dev 3 (Gestión de Contratos)
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

        // Soportar IDs en la URL (al venir desde "Crear contrato" o desde Notificaciones)
        const params = new URLSearchParams(window.location.search);
        _propiedadPreset = params.get('propiedadId') || params.get('deptoId') || params.get('propiedad_id');
        const inquilinoPreset = params.get('inquilino_id');

        // Fecha de inicio por defecto: hoy
        const hoy = new Date().toISOString().slice(0, 10);
        document.getElementById('fecha-inicio').value = hoy;

        await _cargarPropiedadesDisponibles();
        _bindEventos();

        // Cargar inquilino si viene desde la solicitud del modal de buscar-propiedad
        if (inquilinoPreset) {
            await _cargarInquilinoPreset(inquilinoPreset);
        }
    }

    async function _cargarInquilinoPreset(inqId) {
        try {
            const { data, error } = await window.supabaseClient
                .from('inquilinos')
                .select('inquilino_id, usuario_id')
                .eq('inquilino_id', inqId)
                .maybeSingle();

            if (data?.usuario_id) {
                const { data: usrData } = await window.supabaseClient
                    .from('usuarios')
                    .select('usuario_id, nombre_completo, correo, telefono, rol, activo')
                    .eq('usuario_id', data.usuario_id)
                    .maybeSingle();

                if (usrData) {
                    await _seleccionarInquilino(usrData);
                }
            }
        } catch (err) {
            console.warn('[NUEVO-CONTRATO] Error al pre-cargar inquilino:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 1. Cargar propiedades del arrendador SIN contratos activos/pendientes
    // ──────────────────────────────────────────────────────────────
    async function _cargarPropiedadesDisponibles() {
        const { data: props, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion, tipo_propiedad, propiedad_padre_id, beneficios')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('activa', true)
            .neq('tipo_propiedad', 'EDIFICIO')
            .order('nombre', { ascending: true });

        if (error) {
            console.error('[NUEVO-CONTRATO] Error cargando propiedades:', error);
            _alerta('No se pudieron cargar las propiedades.', 'error');
            return;
        }

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

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#resultados-busqueda') && !e.target.closest('#busqueda-inquilino')) {
                document.getElementById('resultados-busqueda').classList.add('hidden');
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // 3. Búsqueda de inquilinos
    // ──────────────────────────────────────────────────────────────
    async function _buscarInquilino(query) {
        const cont = document.getElementById('resultados-busqueda');
        if (!query || query.length < 3) {
            cont.classList.add('hidden');
            cont.innerHTML = '';
            return;
        }

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
            cont.innerHTML = `<p class="p-4 text-xs text-[#6F88A1] font-medium text-center">
                Sin coincidencias para <span class="font-bold text-[#13243E]">${esc(query)}</span>.
                Pídele al inquilino que se registre primero.
            </p>`;
            cont.classList.remove('hidden');
            return;
        }

        cont.innerHTML = data.map(u => {
            const iniciales = (u.nombre_completo || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
            return `
                <button type="button" data-id="${u.usuario_id}"
                        class="resultado-inq w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F7F9] text-left transition-colors border-b border-slate-100 last:border-0">
                    <div class="w-10 h-10 rounded-xl bg-[#FFC533]/20 text-[#13243E] flex items-center justify-center font-extrabold text-sm flex-shrink-0 border border-[#FFE788]">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[#13243E] text-sm font-bold truncate">${esc(u.nombre_completo)}</p>
                        <p class="text-[#6F88A1] font-medium text-xs truncate mt-0.5">
                            <i class="fa-solid fa-envelope text-[10px] mr-1"></i>${esc(u.correo)}
                            ${u.telefono ? `<span class="ml-2"><i class="fa-solid fa-phone text-[10px] mr-1"></i>${esc(u.telefono)}</span>` : ''}
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
    // ──────────────────────────────────────────────────────────────
    async function _seleccionarInquilino(usr) {
        const { data: existente } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id, usuario_id')
            .eq('usuario_id', usr.usuario_id)
            .maybeSingle();

        let inquilino_id = existente?.inquilino_id;
        if (!inquilino_id) {
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
    // 5. Cambio de propiedad → actualizar preview y checkboxes
    // ──────────────────────────────────────────────────────────────
    function _onCambioPropiedad() {
        _mostrarStatusPropiedad('', null);
        _actualizarPreview();

        const selectPropiedad = document.getElementById('propiedad-id');
        if (!selectPropiedad || !selectPropiedad.value) return;

        const propInfo = _propiedades.find(p => String(p.propiedad_id) === String(selectPropiedad.value));

        if (propInfo) {
            document.querySelectorAll('input[name="beneficios"]').forEach(cb => cb.checked = false);

            if (Array.isArray(propInfo.beneficios)) {
                const propBeneficiosStr = propInfo.beneficios.join(' ').toLowerCase();

                document.querySelectorAll('input[name="beneficios"]').forEach(cb => {
                    const keyword = cb.value.replace('_', ' ').toLowerCase();
                    if (propBeneficiosStr.includes(keyword)) {
                        cb.checked = true;
                    }
                });
            }
        }
    }

    function _mostrarStatusPropiedad(msg, tipo) {
        const el = document.getElementById('prop-status');
        if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        const color = tipo === 'error' ? 'text-red-600' : 'text-[#6F88A1]';
        el.className = `mt-2 text-xs font-bold ${color}`;
        el.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i> ${msg}`;
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

        const propiedadId = parseInt(document.getElementById('propiedad-id').value, 10);
        const fechaInicio = document.getElementById('fecha-inicio').value;
        const fechaFin    = document.getElementById('fecha-fin').value;
        const montoRenta  = parseFloat(document.getElementById('monto-renta').value);
        const frecuencia  = document.getElementById('frecuencia-pago').value;
        const observaciones = document.getElementById('observaciones').value.trim();

        const beneficios = Array.from(document.querySelectorAll('input[name="beneficios"]:checked')).map(cb => cb.value);

        if (!_inquilinoSeleccionado || !propiedadId || !fechaInicio || !fechaFin || isNaN(montoRenta) || !frecuencia) {
            if (window.TOAST) TOAST.error('Completa todos los campos obligatorios primero.');
            else _alerta('Completa todos los campos obligatorios primero.', 'error');
            return;
        }

        if (new Date(fechaFin) <= new Date(fechaInicio)) {
            document.getElementById('fechas-error').classList.remove('hidden');
            setTimeout(() => document.getElementById('fechas-error').classList.add('hidden'), 4000);
            _alerta('La fecha de término debe ser posterior a la de inicio.', 'error');
            return;
        }

        if (isNaN(montoRenta) || montoRenta <= 0) {
            document.getElementById('monto-error').classList.remove('hidden');
            setTimeout(() => document.getElementById('monto-error').classList.add('hidden'), 4000);
            _alerta('El monto debe ser mayor a cero.', 'error');
            return;
        }

        AUTH.setLoading(btn, true);

        try {
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
                    beneficios: beneficios.length > 0 ? beneficios : null,
                    observaciones: observaciones || null
                })
                .select('contrato_id')
                .single();

            if (error) throw error;

            if (window.TOAST) {
                TOAST.success('Contrato creado. El inquilino recibirá la solicitud para aceptarlo.');
            }

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

    function _alerta(msg, tipo = 'error') {
        const el = document.getElementById('form-alert');
        if (!el) return;
        const colores = {
            error:   'bg-red-50 border border-red-200 text-red-700',
            success: 'bg-[#FFFBEB] border border-[#FFE788] text-[#13243E]',
            info:    'bg-[#5A97D6]/10 border border-[#5A97D6]/20 text-[#255FA4]',
        };
        el.className = `mb-5 px-4 py-3 rounded-xl text-sm font-bold ${colores[tipo] || colores.error}`;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    return { init };
})();

window.NUEVO_CONTRATO = NUEVO_CONTRATO;