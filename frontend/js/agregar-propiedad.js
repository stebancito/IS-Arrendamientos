// ================================================================
// agregar-propiedad.js  –  Módulo del Dev 2 (Gestión de Propiedades)
// ================================================================
// Responsabilidades:
//   - RF-06: Registrar una nueva propiedad con datos básicos.
//   - RF-10: Estructurar jerárquicamente (edificio → departamentos).
//
// Consultas jerárquicas en Supabase:
//   El campo `propiedad_padre_id` (NULLABLE) es auto-referencial a
//   `propiedades.propiedad_id`. Para listar edificios disponibles:
//     supabaseClient.from('propiedades').select(...).is('propiedad_padre_id', null)
//   Para listar departamentos de un edificio:
//     supabaseClient.from('propiedades').select(...).eq('propiedad_padre_id', idEdif)
// ================================================================

const AGREGAR_PROPIEDAD = (() => {

    let _usuario = null;

    // ──────────────────────────────────────────────────────────────
    // INIT — punto de entrada
    // ──────────────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;

        _bindTipoCards();
        _bindDeptosControls();
        _bindInputs();
        _bindGuardar();
        _renderGridDepartamentos(parseInt(_getCantidadDeptos(), 10));

        // Cargar edificios disponibles (útil cuando el usuario elige DEPARTAMENTO)
        await _cargarEdificiosDisponibles();

        // Estado inicial visual (tipo EDIFICIO seleccionado por defecto)
        _setTipoVisual('EDIFICIO');
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
        // Pintar la tarjeta seleccionada y resetear las demás
        document.querySelectorAll('.tipo-option').forEach(opt => {
            const card = opt.querySelector('.tipo-card');
            if (!card) return;
            if (opt.getAttribute('data-tipo') === tipo) {
                card.className = 'tipo-card flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all border-blue-500 bg-blue-50 text-blue-700';
            } else {
                card.className = 'tipo-card flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all border-slate-200 bg-white text-slate-500 hover:border-slate-300';
            }
        });

        // Mostrar/ocultar bloques contextuales
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

        // Preview del tipo
        const labels = { EDIFICIO:'Edificio', DEPARTAMENTO:'Departamento', CASA:'Casa', LOCAL:'Local', TERRENO:'Terreno' };
        const el = document.getElementById('preview-tipo');
        if (el) el.textContent = labels[tipo] || tipo;
    }

    // ──────────────────────────────────────────────────────────────
    // Controles de cantidad de departamentos
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
        const previewDeptos = document.getElementById('preview-deptos');
        if (previewDeptos) previewDeptos.textContent = n;
        _renderGridDepartamentos(n);
    }

    function _getCantidadDeptos() {
        return document.getElementById('cantidad-departamentos').value;
    }

    function _renderGridDepartamentos(n) {
        const grid = document.getElementById('grid-departamentos');
        if (!grid) return;
        if (n <= 0) {
            grid.innerHTML = `<p class="text-slate-400 text-xs col-span-full text-center py-4">Sin departamentos por ahora.</p>`;
            return;
        }
        const items = [];
        for (let i = 1; i <= n; i++) {
            items.push(`
                <div class="aspect-square flex flex-col items-center justify-center rounded-xl
                            bg-white border-2 border-blue-100 text-blue-700 shadow-sm
                            transition hover:border-blue-400 hover:shadow-md">
                    <svg class="w-5 h-5 mb-1 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.6">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10"/>
                    </svg>
                    <span class="text-[10px] font-semibold">Dept ${i}</span>
                </div>
            `);
        }
        grid.innerHTML = items.join('');
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar lista de edificios del arrendador (jerarquía)
    // ──────────────────────────────────────────────────────────────
    async function _cargarEdificiosDisponibles() {
        // Consulta jerárquica: edificios = propiedades sin padre y tipo EDIFICIO
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
        nombre.addEventListener('input', () => {
            document.getElementById('preview-nombre').textContent = nombre.value.trim() || 'Sin nombre';
        });
        dir.addEventListener('input', () => {
            document.getElementById('preview-direccion').textContent = dir.value.trim() || 'Dirección…';
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Guardar propiedad
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
        const cantidadDeptos = parseInt(_getCantidadDeptos() || 0, 10);
        const padreSel = document.getElementById('propiedad-padre-id').value;
        const propiedadPadreId = padreSel ? parseInt(padreSel, 10) : null;

        // ── Validaciones (RF-06) ─────────────────────────────────
        if (!nombre || nombre.length < 3) { _alerta('Indica un nombre de al menos 3 caracteres.', 'error'); return; }
        if (!direccion || direccion.length < 5) { _alerta('La dirección es obligatoria.', 'error'); return; }
        if (!tipo) { _alerta('Selecciona el tipo de inmueble.', 'error'); return; }

        AUTH.setLoading(btn, true);

        try {
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

            // 2. Si es EDIFICIO + cantidadDeptos > 0 → crear hijas (jerarquía RF-10)
            if (tipo === 'EDIFICIO' && cantidadDeptos > 0) {
                const hijas = [];
                for (let i = 1; i <= cantidadDeptos; i++) {
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
            setTimeout(() => { window.location.href = 'propiedades.html'; }, 900);

        } catch (err) {
            console.error('[AGREGAR-PROP] Error:', err);
            AUTH.setLoading(btn, false);
            _alerta(err.message || 'No se pudo guardar la propiedad.', 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helper de alertas
    // ──────────────────────────────────────────────────────────────
    function _alerta(msg, tipo = 'error') {
        const el = document.getElementById('form-alert');
        if (!el) return;
        const esError = tipo === 'error';
        el.className = `mb-4 px-4 py-3 rounded-xl text-sm font-medium flex items-start gap-2 ${
            esError ? 'bg-red-50 border border-red-200 text-red-700'
                    : 'bg-green-50 border border-green-200 text-green-700'
        }`;
        el.innerHTML = `<span>${esc(msg)}</span>`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 5000);
    }

    return { init };
})();

window.AGREGAR_PROPIEDAD = AGREGAR_PROPIEDAD;