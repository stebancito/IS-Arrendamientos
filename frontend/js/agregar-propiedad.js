// ================================================================
// agregar-propiedad.js  –  Módulo del Dev 2 (Gestión de Propiedades)
// ================================================================
// Responsabilidades:
//   - RF-06: Registrar una nueva propiedad con datos básicos.
//   - RF-07: Modificar una propiedad existente (modo edición).
//   - RF-10: Estructurar jerárquicamente (edificio → departamentos).
//
// Modos de operación:
//   • Modo CREAR  → URL sin ?editId. Inserta nueva propiedad. Si es edificio,
//                   crea también las hijas según el contador.
//   • Modo EDITAR → URL con ?editId=<id>. Carga datos existentes en el form.
//                   Si es edificio, lista los deptos hijos (con opción de quitar
//                   uno SI Y SOLO SI no tiene un contrato activo). El contador
//                   numérico representa los deptos NUEVOS a crear, no el total.
//
// Consultas jerárquicas en Supabase:
//   .from('propiedades').select(...).is('propiedad_padre_id', null) → raíces
//   .from('propiedades').select(...).eq('propiedad_padre_id', X)    → hijos
// ================================================================

const AGREGAR_PROPIEDAD = (() => {

    let _usuario = null;

    // ── Estado de edición ──
    let _modoEdicion = false;
    let _propiedadEditId = null;
    let _propiedadOriginal = null;        // registro original cargado de la BD
    let _deptosExistentes = [];           // [{ propiedad_id, nombre, _ocupado }]
    let _deptosAEliminar = new Set();     // ids de deptos existentes que el usuario marcó para quitar

    // ──────────────────────────────────────────────────────────────
    // INIT — punto de entrada
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        _bindTipoCards();
        _bindDeptosControls();
        _bindInputs();
        _bindGuardar();

        // Detectar si venimos con ?editId=N
        const params = new URLSearchParams(window.location.search);
        const editIdParam = params.get('editId');
        _modoEdicion = !!editIdParam;
        _propiedadEditId = editIdParam ? parseInt(editIdParam, 10) : null;

        // Cargar edificios disponibles (para el selector cuando se elige DEPARTAMENTO)
        await _cargarEdificiosDisponibles();

        if (_modoEdicion && _propiedadEditId) {
            await _cargarParaEditar(_propiedadEditId);
        } else {
            // Modo crear: estado inicial visual y preview limpio
            _renderGridDepartamentos(parseInt(_getCantidadDeptos(), 10));
            _setTipoVisual('EDIFICIO');
            _actualizarTextosPagina(); // textos por defecto
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Selección de tipo de propiedad
    // ──────────────────────────────────────────────────────────────
    function _bindTipoCards() {
        document.querySelectorAll('.tipo-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const tipo = opt.getAttribute('data-tipo');
                const radio = opt.querySelector('input[type=radio]');
                if (radio) radio.checked = true;
                _setTipoVisual(tipo);
            });
        });
    }

    function _setTipoVisual(tipo) {
        document.querySelectorAll('.tipo-option').forEach(opt => {
            const card = opt.querySelector('.tipo-card');
            if (!card) return;
            if (opt.getAttribute('data-tipo') === tipo) {
                card.className = 'tipo-card flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all border-blue-500 bg-blue-50 text-blue-700';
            } else {
                card.className = 'tipo-card flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all border-slate-200 bg-white text-slate-500 hover:border-slate-300';
            }
        });

        const bloqueDeptos = document.getElementById('bloque-departamentos');
        const bloquePadre  = document.getElementById('bloque-padre');
        const previewRow   = document.getElementById('preview-deptos-row');

        if (tipo === 'EDIFICIO') {
            bloqueDeptos.classList.remove('hidden');
            bloquePadre.classList.add('hidden');
            previewRow.classList.remove('hidden');
        } else if (tipo === 'DEPARTAMENTO') {
            bloqueDeptos.classList.add('hidden');
            bloquePadre.classList.remove('hidden');
            previewRow.classList.add('hidden');
        } else {
            bloqueDeptos.classList.add('hidden');
            bloquePadre.classList.add('hidden');
            previewRow.classList.add('hidden');
        }

        const labels = { EDIFICIO:'Edificio', DEPARTAMENTO:'Departamento', CASA:'Casa', LOCAL:'Local', TERRENO:'Terreno' };
        const el = document.getElementById('preview-tipo');
        if (el) el.textContent = labels[tipo] || tipo;
    }

    // ──────────────────────────────────────────────────────────────
    // Controles de cantidad de departamentos (a CREAR)
    // ──────────────────────────────────────────────────────────────
    function _bindDeptosControls() {
        const input  = document.getElementById('cantidad-departamentos');
        const btnSub = document.getElementById('btn-restar-deptos');
        const btnAdd = document.getElementById('btn-sumar-deptos');

        btnSub.addEventListener('click', () => {
            const v = Math.max(0, parseInt(input.value || 0, 10) - 1);
            input.value = v; _onCambiaCantidad(v);
        });
        btnAdd.addEventListener('click', () => {
            const v = Math.min(60, parseInt(input.value || 0, 10) + 1);
            input.value = v; _onCambiaCantidad(v);
        });
        input.addEventListener('input', () => {
            let v = parseInt(input.value || 0, 10);
            if (isNaN(v) || v < 0) v = 0;
            if (v > 60) v = 60;
            input.value = v; _onCambiaCantidad(v);
        });
    }

    function _onCambiaCantidad(n) {
        const lbl = document.getElementById('cantidad-label');
        lbl.textContent = n === 1 ? '1 departamento' : `${n} departamentos`;
        _actualizarPreviewUnidades();
        _renderGridDepartamentos(n);
    }

    function _getCantidadDeptos() {
        return document.getElementById('cantidad-departamentos').value;
    }

    function _renderGridDepartamentos(n) {
        const grid = document.getElementById('grid-departamentos');
        if (!grid) return;
        if (n <= 0) {
            grid.innerHTML = `<p class="text-slate-400 text-xs col-span-full text-center py-4">Sin departamentos nuevos por agregar.</p>`;
            return;
        }
        const items = [];
        for (let i = 1; i <= n; i++) {
            items.push(`
                <div class="aspect-square flex flex-col items-center justify-center rounded-xl
                            bg-white border-2 border-green-100 text-green-700 shadow-sm
                            transition hover:border-green-400 hover:shadow-md">
                    <svg class="w-5 h-5 mb-1 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                    <span class="text-[10px] font-semibold">Nuevo ${i}</span>
                </div>
            `);
        }
        grid.innerHTML = items.join('');
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar lista de edificios del arrendador (selector "padre")
    // ──────────────────────────────────────────────────────────────
    async function _cargarEdificiosDisponibles() {
        const { data, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre')
            .eq('duenio_id', _usuario.usuario_id)
            .eq('tipo_propiedad', 'EDIFICIO')
            .eq('activa', true)
            .is('propiedad_padre_id', null)
            .order('nombre', { ascending: true });

        const select = document.getElementById('propiedad-padre-id');
        if (!select) return;
        if (error) {
            console.error('[AGREGAR-PROP] No se cargaron edificios:', error);
            return;
        }
        const opciones = (data || []).map(p => `<option value="${p.propiedad_id}">${esc(p.nombre)}</option>`).join('');
        select.innerHTML = `<option value="">— Independiente (sin edificio) —</option>${opciones}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Bind: actualizar preview en tiempo real
    // ──────────────────────────────────────────────────────────────
    function _bindInputs() {
        const nombre = document.getElementById('prop-nombre');
        const dir    = document.getElementById('prop-direccion');
        const mapaIframe = document.getElementById('mapa-iframe');
        let timeoutId; // Variable para el debounce del mapa

        nombre.addEventListener('input', () => {
            document.getElementById('preview-nombre').textContent = nombre.value.trim() || 'Sin nombre';
        });

        dir.addEventListener('input', () => {
            const val = dir.value.trim();
            document.getElementById('preview-direccion').textContent = val || 'Dirección…';

            // Debounce: Espera 800ms sin que el usuario escriba antes de recargar el iframe del mapa
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                const query = val ? encodeURIComponent(val) : 'Mexico';
                if (mapaIframe) {
                    mapaIframe.src = `https://maps.google.com/maps?q=${query}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
                }
            }, 800);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Textos dinámicos según modo (crear vs editar)
    // ──────────────────────────────────────────────────────────────
    function _actualizarTextosPagina() {
        const tit = document.getElementById('pagina-titulo');
        const sub = document.getElementById('pagina-subtitulo');
        const btn = document.getElementById('btn-guardar');
        const avisoTipo = document.getElementById('aviso-tipo-edicion');

        if (_modoEdicion) {
            if (tit) tit.textContent = 'Editar propiedad';
            if (sub) sub.textContent = 'Actualiza los datos de tu propiedad. Recuerda guardar al terminar.';
            if (btn) btn.textContent = 'Guardar cambios';
            if (avisoTipo) avisoTipo.classList.remove('hidden');
            LAYOUT?.setPageTitle?.('Editar propiedad');
        } else {
            if (tit) tit.textContent = 'Agregar nueva propiedad';
            if (sub) sub.textContent = 'Registra un inmueble en tu portafolio. Puedes asignarle departamentos si es un edificio.';
            if (btn) btn.textContent = 'Guardar propiedad';
            if (avisoTipo) avisoTipo.classList.add('hidden');
            LAYOUT?.setPageTitle?.('Agregar propiedad');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ╔══════════════════════════════════════════════════════════════╗
    // ║  MODO EDICIÓN — carga, render de existentes, validaciones    ║
    // ╚══════════════════════════════════════════════════════════════╝
    // ──────────────────────────────────────────────────────────────
    async function _cargarParaEditar(id) {
        _actualizarTextosPagina();

        // 1. Cargar el registro principal
        const { data: prop, error } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, duenio_id, nombre, direccion, descripcion, tipo_propiedad, propiedad_padre_id, activa')
            .eq('propiedad_id', id)
            .maybeSingle();

        if (error || !prop) {
            _alerta('No se encontró la propiedad solicitada.', 'error');
            setTimeout(() => { window.location.href = 'propiedades.html'; }, 1500);
            return;
        }

        // 2. Validar pertenencia (que sea del arrendador actual)
        if (prop.duenio_id !== _usuario.usuario_id) {
            _alerta('No tienes permiso para editar esta propiedad.', 'error');
            setTimeout(() => { window.location.href = 'propiedades.html'; }, 1500);
            return;
        }

        _propiedadOriginal = prop;

        // 3. Pre-rellenar campos básicos
        document.getElementById('prop-nombre').value      = prop.nombre || '';
        document.getElementById('prop-direccion').value   = prop.direccion || '';
        document.getElementById('prop-descripcion').value = prop.descripcion || '';

        // Disparar actualización de mapa al editar
        if (prop.direccion) {
            const mapaIframe = document.getElementById('mapa-iframe');
            if (mapaIframe) {
                mapaIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(prop.direccion)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
            }
        }
        
        // Preview
        document.getElementById('preview-nombre').textContent    = prop.nombre || 'Sin nombre';
        document.getElementById('preview-direccion').textContent = prop.direccion || 'Dirección…';

        // 4. Seleccionar el tipo correcto
        document.querySelectorAll('input[name="tipo_propiedad"]').forEach(r => {
            r.checked = (r.value === prop.tipo_propiedad);
        });
        _setTipoVisual(prop.tipo_propiedad);

        // 5. Si es DEPARTAMENTO, marcar el edificio padre en el selector
        if (prop.tipo_propiedad === 'DEPARTAMENTO' && prop.propiedad_padre_id) {
            const sel = document.getElementById('propiedad-padre-id');
            if (sel) sel.value = String(prop.propiedad_padre_id);
        }

        // 6. Si es EDIFICIO, cargar los departamentos existentes (hijos)
        if (prop.tipo_propiedad === 'EDIFICIO') {
            await _cargarDeptosExistentes(prop.propiedad_id);
        }

        // En edición, el contador inicia en 0 (no queremos crear más por defecto)
        const input = document.getElementById('cantidad-departamentos');
        if (input) { input.value = 0; }
        _onCambiaCantidad(0);

        // Ajustar el copy del bloque de "agregar nuevos"
        const lbl = document.getElementById('label-cantidad-nuevos');
        if (lbl && prop.tipo_propiedad === 'EDIFICIO') {
            lbl.textContent = '¿Quieres agregar más departamentos a este edificio? Indica la cantidad.';
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar departamentos existentes de un edificio + estado de contrato
    // ──────────────────────────────────────────────────────────────
    async function _cargarDeptosExistentes(edificioId) {
        const bloque = document.getElementById('bloque-deptos-existentes');
        const cont = document.getElementById('lista-deptos-existentes');
        if (!bloque || !cont) return;

        bloque.classList.remove('hidden');
        cont.innerHTML = `<p class="text-slate-400 text-xs col-span-full text-center py-3">Cargando departamentos…</p>`;

        // Hijos: propiedad_padre_id = edificioId, activos
        const { data: hijos } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id, nombre, direccion')
            .eq('propiedad_padre_id', edificioId)
            .eq('activa', true)
            .order('propiedad_id', { ascending: true });

        _deptosExistentes = (hijos || []).map(h => ({ ...h, _ocupado: false }));

        // Cruzar con contratos activos para saber cuáles tienen inquilino
        if (_deptosExistentes.length) {
            const ids = _deptosExistentes.map(d => d.propiedad_id);
            const { data: contratos } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id, estado')
                .in('propiedad_id', ids)
                .eq('estado', 'ACTIVO');
            const ocupados = new Set((contratos || []).map(c => c.propiedad_id));
            _deptosExistentes.forEach(d => { d._ocupado = ocupados.has(d.propiedad_id); });
        }

        _renderDeptosExistentes();
        _actualizarPreviewUnidades();
    }

    function _renderDeptosExistentes() {
        const cont = document.getElementById('lista-deptos-existentes');
        if (!cont) return;

        if (!_deptosExistentes.length) {
            cont.innerHTML = `<p class="text-slate-400 text-xs col-span-full text-center py-3">Este edificio no tiene departamentos registrados aún.</p>`;
            return;
        }

        cont.innerHTML = _deptosExistentes.map(d => {
            const marcado = _deptosAEliminar.has(d.propiedad_id);
            const ocupado = d._ocupado;

            // Estilos según estado
            const borde = marcado
                ? 'border-red-300 bg-red-50/60'
                : ocupado
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-slate-200 bg-white';

            const badge = ocupado
                ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-wider">
                       <span class="w-1 h-1 rounded-full bg-amber-500"></span> Con contrato
                   </span>`
                : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[9px] font-bold uppercase tracking-wider">
                       <span class="w-1 h-1 rounded-full bg-green-500"></span> Libre
                   </span>`;

            // El botón cambia según si está marcado para eliminar o no
            const boton = marcado
                ? `<button type="button" data-action="restaurar-depto" data-id="${d.propiedad_id}"
                            class="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-semibold">
                       Restaurar
                   </button>`
                : `<button type="button" data-action="quitar-depto" data-id="${d.propiedad_id}"
                            class="px-2 py-1 rounded-lg ${ocupado ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-red-50 hover:bg-red-100 text-red-600'} text-[10px] font-semibold"
                            ${ocupado ? 'title="Tiene contrato activo: no se puede quitar"' : ''}>
                       Quitar
                   </button>`;

            const tachado = marcado ? 'line-through text-slate-400' : 'text-slate-800';

            return `
                <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl border-2 ${borde} transition-all">
                    <div class="min-w-0 flex-1">
                        <p class="${tachado} font-semibold text-xs truncate">${esc(d.nombre)}</p>
                        <div class="mt-0.5">${badge}</div>
                    </div>
                    ${boton}
                </div>`;
        }).join('');

        // Bind acciones
        cont.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                const id = parseInt(btn.getAttribute('data-id'), 10);
                if (action === 'quitar-depto')    _intentarQuitarDepto(id);
                if (action === 'restaurar-depto') _restaurarDepto(id);
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Validación al quitar un departamento existente
    //   RN-01 aplicada a nivel de hijo: no se puede quitar un depto
    //   con contrato ACTIVO. La consulta se hace en VIVO para evitar
    //   condiciones de carrera (un contrato pudo crearse mientras
    //   el usuario tenía el formulario abierto).
    // ──────────────────────────────────────────────────────────────
    async function _intentarQuitarDepto(propId) {
        const dep = _deptosExistentes.find(d => d.propiedad_id === propId);
        if (!dep) return;

        // Validación en vivo contra la BD (no confiamos solo en _ocupado cacheado)
        const { count, error } = await window.supabaseClient
            .from('contratos')
            .select('contrato_id', { count: 'exact', head: true })
            .eq('propiedad_id', propId)
            .eq('estado', 'ACTIVO');

        if (error) {
            _toastOAlerta('No se pudo validar el contrato. Intenta de nuevo.', 'error');
            return;
        }

        if ((count || 0) > 0) {
            // ⛔ Bloqueamos: tiene contrato activo
            dep._ocupado = true; // refrescar cache
            _renderDeptosExistentes();
            _toastOAlerta(
                `"${dep.nombre}" tiene un contrato activo. Finaliza el contrato antes de quitar el departamento.`,
                'error'
            );
            return;
        }

        // ✅ OK: marcamos para eliminación al guardar
        _deptosAEliminar.add(propId);
        _renderDeptosExistentes();
        _actualizarPreviewUnidades();
        _toastOAlerta(`"${dep.nombre}" se quitará al guardar los cambios.`, 'info');
    }

    function _restaurarDepto(propId) {
        _deptosAEliminar.delete(propId);
        _renderDeptosExistentes();
        _actualizarPreviewUnidades();
    }

    // ──────────────────────────────────────────────────────────────
    // Preview lateral: total de unidades = existentes (no eliminadas) + nuevas
    // ──────────────────────────────────────────────────────────────
    function _actualizarPreviewUnidades() {
        const previewDeptos = document.getElementById('preview-deptos');
        if (!previewDeptos) return;
        const nuevos = parseInt(_getCantidadDeptos() || 0, 10);
        const restantesExistentes = _deptosExistentes.filter(d => !_deptosAEliminar.has(d.propiedad_id)).length;
        previewDeptos.textContent = _modoEdicion
            ? `${restantesExistentes + nuevos}`
            : `${nuevos}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Guardar (crear o actualizar)
    // ──────────────────────────────────────────────────────────────
    function _bindGuardar() {
        document.getElementById('btn-guardar').addEventListener('click', _onGuardar);
    }

    async function _onGuardar() {
        const btn = document.getElementById('btn-guardar');
        const nombre = document.getElementById('prop-nombre').value.trim();
        const direccion = document.getElementById('prop-direccion').value.trim();
        const descripcion = document.getElementById('prop-descripcion').value.trim();
        const tipo = document.querySelector('input[name="tipo_propiedad"]:checked')?.value;
        const cantidadNuevosDeptos = parseInt(_getCantidadDeptos() || 0, 10);
        const padreSel = document.getElementById('propiedad-padre-id').value;
        const propiedadPadreId = padreSel ? parseInt(padreSel, 10) : null;

        // ── Validaciones ──
        if (!nombre || nombre.length < 3) { _alerta('Indica un nombre de al menos 3 caracteres.', 'error'); return; }
        if (!direccion || direccion.length < 5) { _alerta('La dirección es obligatoria.', 'error'); return; }
        if (!tipo) { _alerta('Selecciona el tipo de inmueble.', 'error'); return; }

        AUTH.setLoading(btn, true);

        try {
            if (_modoEdicion) {
                await _guardarEdicion({ nombre, direccion, descripcion, tipo, cantidadNuevosDeptos, propiedadPadreId });
            } else {
                await _guardarNueva({ nombre, direccion, descripcion, tipo, cantidadNuevosDeptos, propiedadPadreId });
            }
        } catch (err) {
            console.error('[AGREGAR-PROP] Error:', err);
            AUTH.setLoading(btn, false);
            _alerta(err.message || 'No se pudo guardar la propiedad.', 'error');
        }
    }

    // ── Crear nueva propiedad ────────────────────────────────────
    async function _guardarNueva({ nombre, direccion, descripcion, tipo, cantidadNuevosDeptos, propiedadPadreId }) {
        // 1. Insertar la propiedad principal
        const { data: insertada, error: errPad } = await window.supabaseClient
            .from('propiedades')
            .insert({
                duenio_id: _usuario.usuario_id,
                nombre,
                direccion,
                descripcion: descripcion || null,
                tipo_propiedad: tipo,
                propiedad_padre_id: tipo === 'DEPARTAMENTO' ? propiedadPadreId : null,
                activa: true
            })
            .select()
            .single();
        if (errPad) throw errPad;

        // 2. Si es EDIFICIO + N deptos > 0 → crear hijas (jerarquía RF-10)
        if (tipo === 'EDIFICIO' && cantidadNuevosDeptos > 0) {
            const hijas = [];
            for (let i = 1; i <= cantidadNuevosDeptos; i++) {
                hijas.push({
                    duenio_id: _usuario.usuario_id,
                    nombre: `Depto ${i} — ${nombre}`,
                    direccion,
                    tipo_propiedad: 'DEPARTAMENTO',
                    propiedad_padre_id: insertada.propiedad_id,
                    activa: true
                });
            }
            const { error: errHijas } = await window.supabaseClient
                .from('propiedades')
                .insert(hijas);
            if (errHijas) throw errHijas;
        }

        _alerta('Propiedad registrada con éxito. Redirigiendo…', 'success');
        if (window.TOAST) TOAST.success('Propiedad registrada con éxito.');
        setTimeout(() => { window.location.href = 'propiedades.html'; }, 900);
    }

    // ── Actualizar propiedad existente ───────────────────────────
    async function _guardarEdicion({ nombre, direccion, descripcion, tipo, cantidadNuevosDeptos, propiedadPadreId }) {
        // 1. UPDATE de la propiedad principal
        const updPayload = {
            nombre,
            direccion,
            descripcion: descripcion || null,
            tipo_propiedad: tipo,
            propiedad_padre_id: tipo === 'DEPARTAMENTO' ? propiedadPadreId : null,
        };
        const { error: errUpd } = await window.supabaseClient
            .from('propiedades')
            .update(updPayload)
            .eq('propiedad_id', _propiedadEditId);
        if (errUpd) throw errUpd;

        // 2. Eliminar (soft) deptos marcados, RE-VALIDANDO contra contratos activos
        //    (defensa final por si el estado cambió desde que el usuario marcó la baja)
        if (tipo === 'EDIFICIO' && _deptosAEliminar.size > 0) {
            const idsAQuitar = Array.from(_deptosAEliminar);

            const { data: contratosActivos } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id')
                .in('propiedad_id', idsAQuitar)
                .eq('estado', 'ACTIVO');

            const conContrato = new Set((contratosActivos || []).map(c => c.propiedad_id));
            const idsSeguros = idsAQuitar.filter(id => !conContrato.has(id));
            const idsBloqueados = idsAQuitar.filter(id => conContrato.has(id));

            if (idsSeguros.length) {
                const { error: errSoft } = await window.supabaseClient
                    .from('propiedades')
                    .update({ activa: false })
                    .in('propiedad_id', idsSeguros);
                if (errSoft) throw errSoft;
            }

            // Si alguno fue bloqueado en la validación final, informamos al usuario
            if (idsBloqueados.length) {
                const nombresBloqueados = _deptosExistentes
                    .filter(d => idsBloqueados.includes(d.propiedad_id))
                    .map(d => `"${d.nombre}"`)
                    .join(', ');
                _toastOAlerta(
                    `No se pudo(n) quitar ${nombresBloqueados}: tiene(n) contratos activos.`,
                    'error'
                );
            }
        }

        // 3. Crear los nuevos deptos (si es EDIFICIO y el usuario pidió agregar)
        if (tipo === 'EDIFICIO' && cantidadNuevosDeptos > 0) {
            // Calculamos un índice inicial para nombrarlos (continuación del último)
            const usadosCount = _deptosExistentes.filter(d => !_deptosAEliminar.has(d.propiedad_id)).length;
            const hijas = [];
            for (let i = 1; i <= cantidadNuevosDeptos; i++) {
                hijas.push({
                    duenio_id: _usuario.usuario_id,
                    nombre: `Depto ${usadosCount + i} — ${nombre}`,
                    direccion,
                    tipo_propiedad: 'DEPARTAMENTO',
                    propiedad_padre_id: _propiedadEditId,
                    activa: true
                });
            }
            const { error: errHijas } = await window.supabaseClient
                .from('propiedades')
                .insert(hijas);
            if (errHijas) throw errHijas;
        }

        _alerta('Cambios guardados correctamente. Redirigiendo…', 'success');
        if (window.TOAST) TOAST.success('Cambios guardados correctamente.');
        setTimeout(() => { window.location.href = 'propiedades.html'; }, 900);
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de feedback (alerta del form + toast global)
    // ──────────────────────────────────────────────────────────────
    function _alerta(msg, tipo = 'error') {
        const el = document.getElementById('form-alert');
        if (!el) return;
        const esError = tipo === 'error';
        const esInfo  = tipo === 'info';
        el.className = `mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-start gap-2 ${
            esError ? 'bg-red-50 border border-red-200 text-red-700'
                    : esInfo ? 'bg-blue-50 border border-blue-200 text-blue-700'
                             : 'bg-green-50 border border-green-200 text-green-700'
        }`;
        el.innerHTML = `<span>${esc(msg)}</span>`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    function _toastOAlerta(msg, tipo = 'info') {
        if (window.TOAST) {
            if (tipo === 'error') TOAST.error(msg);
            else if (tipo === 'info') TOAST.info(msg);
            else TOAST.success(msg);
        } else {
            _alerta(msg, tipo);
        }
    }

    return { init };
})();

window.AGREGAR_PROPIEDAD = AGREGAR_PROPIEDAD;