// ================================================================
// nuevo-contrato.js  –  Módulo del Dev 3 (Gestión de Contratos)
// ================================================================
// Historial de cambios:
//
//  v2 – feature/servicios-incluidos-contrato
//   - Checkboxes name="servicios" (agua, luz, internet, gas).
//
//  v3 – feature/clausulas-personalizadas-contrato (FINAL)
//   - Servicios (agua, luz, internet, gas) → columna `beneficios` (text)
//     junto con los beneficios del inmueble, como texto legible separado
//     por comas. Ej: "Estacionamiento, Gimnasio, Agua, Internet"
//   - Cláusulas predefinidas + personalizadas → columna `observaciones`
//     (text), formateadas con guion: "- Cláusula 1\n- Cláusula 2\n..."
//     Si el usuario también escribió observaciones libres, estas se
//     anteponen antes de las cláusulas, separadas por una línea en blanco.
//
// Qué va a cada columna de la tabla contratos (sin migraciones):
//   `beneficios`    text  → "Estacionamiento, Agua, Internet"
//   `observaciones` text  → texto libre + cláusulas formateadas con -
//
// Compatibilidad total con módulos existentes:
//   detalle-contrato.js → muestra ambos campos como string (whitespace-pre-line) ✓
//   pdf-contrato.js     → los imprime como texto plano ✓
//   contratos-inquilino.js → no renderiza ninguno de los dos ✓
// ================================================================

const NUEVO_CONTRATO = (() => {

    let _usuario               = null;
    let _inquilinoSeleccionado = null;
    let _propiedades           = [];
    let _debounceBuscar        = null;
    let _propiedadPreset       = null;

    // ── Cláusulas personalizadas en memoria ─────────────────────
    let _clausulasCustom = [];   // [{ id: String, texto: String }]

    // ── Etiquetas legibles ───────────────────────────────────────
    const BENEFICIOS_LABEL = {
        estacionamiento: 'Estacionamiento',
        gimnasio:        'Gimnasio',
        area_social:     'Área Social',
        jardin:          'Jardín',
        mascotas:        'Mascotas',
    };

    const SERVICIOS_LABEL = {
        agua:     'Agua',
        luz:      'Luz',
        internet: 'Internet',
        gas:      'Gas',
    };

    // Las claves deben coincidir EXACTAMENTE con los value="" del HTML,
    // que incluyen el prefijo "clpre:" (ej. <input value="clpre:no_mascotas">).
    const CLAUSULAS_PRE_LABEL = {
        'clpre:no_mascotas'       : 'No se permiten mascotas',
        'clpre:no_subarrendar'    : 'No subarrendar',
        'clpre:no_modificar'      : 'Prohibido modificar la propiedad',
        'clpre:solo_transferencia': 'Pago únicamente por transferencia',
    };

    // ──────────────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        const params          = new URLSearchParams(window.location.search);
        _propiedadPreset      = params.get('propiedadId') || params.get('deptoId') || params.get('propiedad_id');
        const inquilinoPreset = params.get('inquilino_id');

        document.getElementById('fecha-inicio').value = new Date().toISOString().slice(0, 10);

        await _cargarPropiedadesDisponibles();
        _bindEventos();

        if (inquilinoPreset) {
            await _cargarInquilinoPreset(inquilinoPreset);
        }

        _renderClausulasCustom();
        _actualizarPreview();
    }

    // ──────────────────────────────────────────────────────────────
    // Pre-carga de inquilino desde URL
    // ──────────────────────────────────────────────────────────────
    async function _cargarInquilinoPreset(inqId) {
        try {
            const { data } = await window.supabaseClient
                .from('inquilinos')
                .select('inquilino_id, usuario_id')
                .eq('inquilino_id', inqId)
                .maybeSingle();

            if (data?.usuario_id) {
                const { data: usr } = await window.supabaseClient
                    .from('usuarios')
                    .select('usuario_id, nombre_completo, correo, telefono, rol, activo')
                    .eq('usuario_id', data.usuario_id)
                    .maybeSingle();
                if (usr) await _seleccionarInquilino(usr);
            }
        } catch (err) {
            console.warn('[NUEVO-CONTRATO] Error al pre-cargar inquilino:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 1. Cargar propiedades disponibles
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

        const ids      = (props || []).map(p => p.propiedad_id);
        const ocupadas = new Set();
        if (ids.length) {
            const { data: contratos } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id')
                .in('propiedad_id', ids)
                .in('estado', ['ACTIVO', 'PENDIENTE']);
            (contratos || []).forEach(c => ocupadas.add(c.propiedad_id));
        }

        _propiedades = (props || []).filter(p => !ocupadas.has(p.propiedad_id));

        const select  = document.getElementById('propiedad-id');
        const tipoLbl = { DEPARTAMENTO:'Depto', CASA:'Casa', LOCAL:'Local', TERRENO:'Terreno' };
        select.innerHTML = `<option value="">— Selecciona una propiedad —</option>` +
            _propiedades.map(p =>
                `<option value="${p.propiedad_id}">${esc(p.nombre)} (${tipoLbl[p.tipo_propiedad] || p.tipo_propiedad})</option>`
            ).join('');

        if (_propiedadPreset) {
            const idNum = parseInt(_propiedadPreset, 10);
            if (_propiedades.some(p => p.propiedad_id === idNum)) {
                select.value = String(idNum);
                _onCambioPropiedad();
            } else {
                _mostrarStatusPropiedad('La propiedad solicitada no está disponible.', 'error');
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 2. Bind de eventos
    // ──────────────────────────────────────────────────────────────
    function _bindEventos() {
        document.getElementById('busqueda-inquilino').addEventListener('input', (e) => {
            clearTimeout(_debounceBuscar);
            _debounceBuscar = setTimeout(() => _buscarInquilino(e.target.value.trim()), 280);
        });
        document.getElementById('btn-cambiar-inquilino').addEventListener('click', _limpiarSeleccionInquilino);
        document.getElementById('propiedad-id').addEventListener('change', _onCambioPropiedad);

        ['fecha-inicio', 'fecha-fin', 'monto-renta'].forEach(id => {
            document.getElementById(id).addEventListener('input',  _actualizarPreview);
            document.getElementById(id).addEventListener('change', _actualizarPreview);
        });

        // Todos los checkboxes y el textarea de observaciones actualizan el preview
        ['input[name="beneficios"]', 'input[name="servicios"]', 'input[name="clausulas-pre"]']
            .forEach(sel =>
                document.querySelectorAll(sel).forEach(cb =>
                    cb.addEventListener('change', _actualizarPreview)
                )
            );
        document.getElementById('observaciones').addEventListener('input', _actualizarPreview);

        document.getElementById('btn-agregar-clausula').addEventListener('click', _agregarClausulaCustom);
        document.getElementById('clausula-custom-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); _agregarClausulaCustom(); }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#resultados-busqueda') && !e.target.closest('#busqueda-inquilino')) {
                document.getElementById('resultados-busqueda').classList.add('hidden');
            }
        });

        document.getElementById('btn-crear').addEventListener('click', _crearContrato);
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

        if (error) { console.error('[NUEVO-CONTRATO] Error búsqueda:', error); return; }

        if (!data?.length) {
            cont.innerHTML = `<p class="p-4 text-xs text-[#6F88A1] font-medium text-center">
                Sin coincidencias para <span class="font-bold text-[#13243E]">${esc(query)}</span>.
                Pídele al inquilino que se registre primero.
            </p>`;
            cont.classList.remove('hidden');
            return;
        }

        cont.innerHTML = data.map(u => {
            const ini = (u.nombre_completo || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return `
                <button type="button" data-id="${u.usuario_id}"
                        class="resultado-inq w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F5F7F9]
                               text-left transition-colors border-b border-slate-100 last:border-0">
                    <div class="w-10 h-10 rounded-xl bg-[#FFC533]/20 text-[#13243E] flex items-center
                                justify-center font-extrabold text-sm flex-shrink-0 border border-[#FFE788]">
                        ${esc(ini)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[#13243E] text-sm font-bold truncate">${esc(u.nombre_completo)}</p>
                        <p class="text-[#6F88A1] font-medium text-xs truncate mt-0.5">
                            <i class="fa-solid fa-envelope text-[10px] mr-1"></i>${esc(u.correo)}
                            ${u.telefono
                                ? `<span class="ml-2"><i class="fa-solid fa-phone text-[10px] mr-1"></i>${esc(u.telefono)}</span>`
                                : ''}
                        </p>
                    </div>
                    <i class="fa-solid fa-chevron-right text-slate-300 text-xs"></i>
                </button>`;
        }).join('');
        cont.classList.remove('hidden');

        cont.querySelectorAll('.resultado-inq').forEach(btn => {
            btn.addEventListener('click', async () => {
                const usr = data.find(x => x.usuario_id === parseInt(btn.getAttribute('data-id'), 10));
                if (usr) await _seleccionarInquilino(usr);
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
                _alerta('No se pudo registrar al inquilino. Intenta de nuevo.', 'error');
                return;
            }
            inquilino_id = nuevo.inquilino_id;
        }

        _inquilinoSeleccionado = {
            inquilino_id,
            usuario_id      : usr.usuario_id,
            nombre_completo : usr.nombre_completo,
            correo          : usr.correo,
            telefono        : usr.telefono,
        };

        document.getElementById('resultados-busqueda').classList.add('hidden');
        document.getElementById('busqueda-inquilino').value = '';

        const ini = (usr.nombre_completo || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        document.getElementById('inq-sel-avatar').textContent = ini;
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
    // 5. Cambio de propiedad → restaurar beneficios del inmueble
    //    Solo se restauran los beneficios de propiedades.beneficios
    //    (jsonb). Los servicios y cláusulas son condiciones del
    //    contrato, no de la propiedad, y no se pre-rellenan.
    // ──────────────────────────────────────────────────────────────
    function _onCambioPropiedad() {
        _mostrarStatusPropiedad('', null);

        document.querySelectorAll('input[name="beneficios"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('input[name="servicios"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('input[name="clausulas-pre"]').forEach(cb => cb.checked = false);
        _clausulasCustom = [];
        _renderClausulasCustom();

        const propId = document.getElementById('propiedad-id').value;
        const prop   = _propiedades.find(p => String(p.propiedad_id) === propId);

        if (prop && Array.isArray(prop.beneficios)) {
            prop.beneficios.forEach(b => {
                const el = document.querySelector(`input[name="beneficios"][value="${b}"]`);
                if (el) el.checked = true;
            });
        }

        _actualizarPreview();
    }

    function _mostrarStatusPropiedad(msg, tipo) {
        const el = document.getElementById('prop-status');
        if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        el.className = `mt-2 text-xs font-bold ${tipo === 'error' ? 'text-red-600' : 'text-[#6F88A1]'}`;
        el.innerHTML = `<i class="fa-solid fa-circle-info mr-1"></i> ${msg}`;
        el.classList.remove('hidden');
    }

    // ──────────────────────────────────────────────────────────────
    // 6. Cláusulas personalizadas: agregar, eliminar, render
    // ──────────────────────────────────────────────────────────────
    function _uid() {
        return Math.random().toString(36).slice(2, 10);
    }

    function _agregarClausulaCustom() {
        const input   = document.getElementById('clausula-custom-input');
        const errorEl = document.getElementById('clausula-error');
        const texto   = input.value.trim();

        if (!texto) {
            errorEl.classList.remove('hidden');
            setTimeout(() => errorEl.classList.add('hidden'), 3000);
            input.focus();
            return;
        }

        const yaExiste = _clausulasCustom.some(c => c.texto.toLowerCase() === texto.toLowerCase());
        if (yaExiste) {
            if (window.TOAST) TOAST.warning('Esa cláusula ya fue agregada.');
            input.value = '';
            input.focus();
            return;
        }

        _clausulasCustom.push({ id: _uid(), texto });
        input.value = '';
        input.focus();
        errorEl.classList.add('hidden');
        _renderClausulasCustom();
        _actualizarPreview();
    }

    function _eliminarClausulaCustom(id) {
        _clausulasCustom = _clausulasCustom.filter(c => c.id !== id);
        _renderClausulasCustom();
        _actualizarPreview();
    }

    function _renderClausulasCustom() {
        const lista = document.getElementById('clausulas-custom-lista');
        if (!lista) return;

        if (!_clausulasCustom.length) {
            lista.classList.add('hidden');
            lista.innerHTML = '';
            return;
        }

        lista.classList.remove('hidden');
        lista.innerHTML = _clausulasCustom.map(c => `
            <div class="flex items-center justify-between gap-3 px-4 py-3 rounded-xl
                        bg-[#F5F7F9] border border-slate-200 shadow-sm">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <i class="fa-solid fa-gavel text-[#FFC533] text-sm flex-shrink-0"></i>
                    <span class="text-[#13243E] text-xs font-semibold truncate">${esc(c.texto)}</span>
                </div>
                <button type="button"
                        data-clausula-id="${c.id}"
                        title="Eliminar cláusula"
                        class="btn-eliminar-clausula flex-shrink-0 w-7 h-7 rounded-lg flex items-center
                               justify-center text-[#6F88A1] hover:bg-red-50 hover:text-red-600 transition-colors">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>`).join('');

        lista.querySelectorAll('.btn-eliminar-clausula').forEach(btn => {
            btn.addEventListener('click', () =>
                _eliminarClausulaCustom(btn.getAttribute('data-clausula-id'))
            );
        });
    }

    // ──────────────────────────────────────────────────────────────
    // 7. Vista previa en tiempo real
    // ──────────────────────────────────────────────────────────────
    function _actualizarPreview() {
        // Inquilino y propiedad
        document.getElementById('pv-inquilino').textContent =
            _inquilinoSeleccionado?.nombre_completo || 'Sin inquilino seleccionado';

        const propId = document.getElementById('propiedad-id').value;
        const prop   = _propiedades.find(p => String(p.propiedad_id) === propId);
        document.getElementById('pv-propiedad').textContent = prop ? prop.nombre : 'Sin propiedad asignada';

        // Fechas y duración
        const fmtF = d => d
            ? new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
            : '—';
        const fi = document.getElementById('fecha-inicio').value;
        const ff = document.getElementById('fecha-fin').value;
        document.getElementById('pv-inicio').textContent = fmtF(fi);
        document.getElementById('pv-fin').textContent    = fmtF(ff);

        let durTxt = '—';
        if (fi && ff) {
            const a = new Date(fi), b = new Date(ff);
            if (b > a) {
                const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
                durTxt = m >= 12 ? `${(m / 12).toFixed(1)} año(s)` : `${m} mes(es)`;
            }
        }
        document.getElementById('pv-duracion').textContent = durTxt;

        // Monto
        const monto = parseFloat(document.getElementById('monto-renta').value) || 0;
        document.getElementById('pv-monto').textContent = monto > 0
            ? new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:0 }).format(monto)
            : '—';

        // Servicios (van a `beneficios` junto con los beneficios del inmueble)
        const servicios = Array.from(document.querySelectorAll('input[name="servicios"]:checked'))
            .map(cb => SERVICIOS_LABEL[cb.value] || cb.value);
        const pvServicios = document.getElementById('pv-servicios');
        if (pvServicios) {
            pvServicios.textContent = servicios.length
                ? '• ' + servicios.join(' • ')
                : 'No especificados';
        }

        // Cláusulas (van a `observaciones` con formato "- clausula")
        const clausulasTexto = [
            ...Array.from(document.querySelectorAll('input[name="clausulas-pre"]:checked'))
                .map(cb => CLAUSULAS_PRE_LABEL[cb.value] || cb.value),
            ..._clausulasCustom.map(c => c.texto),
        ];
        const pvClausulas = document.getElementById('pv-clausulas');
        if (pvClausulas) {
            pvClausulas.textContent = clausulasTexto.length
                ? clausulasTexto.map(t => `- ${t}`).join('\n')
                : 'No especificadas';
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de lectura para el INSERT
    // ──────────────────────────────────────────────────────────────

    /**
     * Columna `beneficios` (text).
     * Combina beneficios del inmueble + servicios incluidos como texto
     * legible separado por comas.
     * Ejemplo: "Estacionamiento, Gimnasio, Agua, Internet"
     * Devuelve null si no hay ninguno seleccionado.
     */
    function _leerBeneficiosTexto() {
        const inmueble  = Array.from(document.querySelectorAll('input[name="beneficios"]:checked'))
            .map(cb => BENEFICIOS_LABEL[cb.value] || cb.value);
        const servicios = Array.from(document.querySelectorAll('input[name="servicios"]:checked'))
            .map(cb => SERVICIOS_LABEL[cb.value] || cb.value);
        const todos = [...inmueble, ...servicios];
        return todos.length > 0 ? todos.join(', ') : null;
    }

    /**
     * Columna `observaciones` (text).
     * Combina el texto libre del textarea con las cláusulas formateadas.
     *
     * Estructura del string resultante:
     *   [texto libre del textarea]          ← solo si el usuario escribió algo
     *   [línea en blanco separadora]        ← solo si hay texto libre Y cláusulas
     *   - Cláusula 1
     *   - Cláusula 2
     *   ...
     *
     * Ejemplo con texto y cláusulas:
     *   "Piso 3, sin elevador\n\n- No subarrendar\n- Máximo 3 ocupantes"
     *
     * Ejemplo solo con cláusulas:
     *   "- No subarrendar\n- Pago únicamente por transferencia"
     *
     * Devuelve null si no hay texto ni cláusulas.
     */
    function _leerObservacionesTexto() {
        const textoLibre = document.getElementById('observaciones').value.trim();

        const clausulasTexto = [
            ...Array.from(document.querySelectorAll('input[name="clausulas-pre"]:checked'))
                .map(cb => CLAUSULAS_PRE_LABEL[cb.value] || cb.value),
            ..._clausulasCustom.map(c => c.texto),
        ];

        if (!textoLibre && clausulasTexto.length === 0) return null;

        const partes = [];
        if (textoLibre) partes.push(textoLibre);
        if (clausulasTexto.length > 0) {
            partes.push(clausulasTexto.map(t => `- ${t}`).join('\n'));
        }

        // Unir con línea en blanco si hay texto libre y cláusulas
        return partes.join('\n\n');
    }

    // ──────────────────────────────────────────────────────────────
    // 8. Crear el contrato
    // ──────────────────────────────────────────────────────────────
    async function _crearContrato() {
        const btn         = document.getElementById('btn-crear');
        const propiedadId = parseInt(document.getElementById('propiedad-id').value, 10);
        const fechaInicio = document.getElementById('fecha-inicio').value;
        const fechaFin    = document.getElementById('fecha-fin').value;
        const montoRenta  = parseFloat(document.getElementById('monto-renta').value);
        const frecuencia  = document.getElementById('frecuencia-pago').value;

        // Valores para las columnas
        const beneficiosTexto    = _leerBeneficiosTexto();    // → `beneficios` text
        const observacionesTexto = _leerObservacionesTexto(); // → `observaciones` text

        // ── Validaciones ───────────────────────────────────────────
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

            // ── INSERT ─────────────────────────────────────────────
            // `beneficios`    (text) ← "Estacionamiento, Agua, Internet"
            // `observaciones` (text) ← "texto libre\n\n- cláusula 1\n- cláusula 2"
            const { data: nuevo, error } = await window.supabaseClient
                .from('contratos')
                .insert({
                    propiedad_id   : propiedadId,
                    inquilino_id   : _inquilinoSeleccionado.inquilino_id,
                    fecha_inicio   : fechaInicio,
                    fecha_fin      : fechaFin,
                    monto_renta    : montoRenta,
                    frecuencia_pago: frecuencia,
                    estado         : 'PENDIENTE',
                    beneficios     : beneficiosTexto,     // null si no hay nada
                    observaciones  : observacionesTexto,  // null si no hay nada
                })
                .select('contrato_id')
                .single();

            if (error) throw error;

            if (window.TOAST) TOAST.success('Contrato creado. El inquilino recibirá la solicitud para aceptarlo.');

            await window.supabaseClient.from('notificaciones').insert({
                usuario_id : _inquilinoSeleccionado.usuario_id,
                titulo     : 'Nuevo contrato pendiente de tu aceptación',
                mensaje    : 'Tienes un nuevo contrato de arrendamiento esperando tu aprobación. Revísalo desde "Mi Contrato".',
                tipo       : 'RECORDATORIO',
                metadatos  : { contrato_id: nuevo.contrato_id },
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
    // Helper UI
    // ──────────────────────────────────────────────────────────────
    function _alerta(msg, tipo = 'error') {
        const el = document.getElementById('form-alert');
        if (!el) return;
        const colores = {
            error  : 'bg-red-50 border border-red-200 text-red-700',
            success: 'bg-[#FFFBEB] border border-[#FFE788] text-[#13243E]',
            info   : 'bg-[#5A97D6]/10 border border-[#5A97D6]/20 text-[#255FA4]',
        };
        el.className = `mb-5 px-4 py-3 rounded-xl text-sm font-bold ${colores[tipo] || colores.error}`;
        el.textContent = msg;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    return { init };
})();

window.NUEVO_CONTRATO = NUEVO_CONTRATO;
