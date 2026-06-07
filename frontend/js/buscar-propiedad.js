// ================================================================
// buscar-propiedad.js  –  Búsqueda, Estimación de Precio y Solicitudes
// ================================================================

const BUSCAR_PROPIEDAD = (() => {

    // ---------- CONSTANTES ----------
    const TIPO_META = {
        DEPARTAMENTO: { label: 'Departamento', icono: 'fa-building', clase: 'bg-blue-100 text-blue-700 border-blue-200' },
        CASA:         { label: 'Casa',         icono: 'fa-house', clase: 'bg-green-100 text-green-700 border-green-200' },
        LOCAL:        { label: 'Local',        icono: 'fa-store', clase: 'bg-purple-100 text-purple-700 border-purple-200' },
        TERRENO:      { label: 'Terreno',      icono: 'fa-tree',  clase: 'bg-amber-100 text-amber-700 border-amber-200' },
        EDIFICIO:     { label: 'Edificio',     icono: 'fa-city',  clase: 'bg-slate-100 text-slate-700 border-slate-200' },
    };

    let _usuario = null;
    let _inquilinoId = null; // ID real del inquilino de la tabla inquilinos
    let _unidades = [];                 
    let _unidadesFiltradas = [];       
    let _seleccion = null;

    // Filtros actuales
    let _filtroTexto = '';
    let _filtroTipo = '';
    let _filtroPrecioMin = null;
    let _filtroPrecioMax = null;
    let _filtroBeneficios = new Set();   

    // ---------- HELPERS ----------
    function esc(str) {
        if (!str) return '';
        return String(str).replace(/[&<>]/g, m => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[m]));
    }

    // Mapeo inteligente de palabras a iconos de FontAwesome
    function _getIconoBeneficio(nombre) {
        const str = nombre.toLowerCase();
        if(str.includes('wifi') || str.includes('internet')) return 'fa-wifi';
        if(str.includes('estacionamiento') || str.includes('cochera')) return 'fa-car';
        if(str.includes('muebl')) return 'fa-couch';
        if(str.includes('mascota') || str.includes('perro')) return 'fa-paw';
        if(str.includes('seguridad') || str.includes('vigilancia')) return 'fa-shield-halved';
        if(str.includes('gimnasio') || str.includes('gym')) return 'fa-dumbbell';
        if(str.includes('alberca') || str.includes('piscina')) return 'fa-water-ladder';
        if(str.includes('jardin') || str.includes('verde')) return 'fa-tree';
        if(str.includes('elevador') || str.includes('ascensor')) return 'fa-elevator';
        if(str.includes('balcon') || str.includes('terraza')) return 'fa-cloud-sun';
        if(str.includes('limpieza')) return 'fa-broom';
        return 'fa-check'; // Icono por defecto
    }

    // Formateador de moneda
    function formatoDinero(cantidad) {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cantidad);
    }

    // ---------- INICIALIZACIÓN ----------
    async function init(usuario) {
        _usuario = usuario;
        await _obtenerInquilinoId();
        await _cargarDatosYCalcularPrecios();           
        _extraerBeneficiosUnicos();     
        _bindFiltros();
        _bindListaClicks();
        _aplicarFiltros();
    }

    async function _obtenerInquilinoId() {
        const { data, error } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', _usuario.usuario_id)
            .single();
        if (data) _inquilinoId = data.inquilino_id;
    }

    // ---------- LÓGICA CORE: Carga y Estimación de Precios ----------
    async function _cargarDatosYCalcularPrecios() {
        try {
            // 1. Cargar todas las propiedades activas
            const { data: props, error: errP } = await window.supabaseClient
                .from('propiedades')
                .select(`
                    propiedad_id, nombre, direccion, tipo_propiedad, descripcion, beneficios,
                    propiedad_padre_id,
                    duenio:usuarios!propiedades_duenio_id_fkey ( usuario_id, nombre_completo, correo, telefono )
                `)
                .eq('activa', true)
                .neq('tipo_propiedad', 'EDIFICIO')
                .order('creado_en', { ascending: false });

            if (errP) throw errP;

            // 2. Cargar TODOS los contratos históricos para deducir precios matemáticamente
            const { data: contratos, error: errC } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id, monto_renta, estado');
            
            if (errC) throw errC;

            // Mapear rentas históricas por ID de propiedad
            const rentasPorPropiedad = {};
            // Mapear qué propiedades pertenecen a qué edificio padre
            const propsPorPadre = {};

            contratos.forEach(c => {
                if(!rentasPorPropiedad[c.propiedad_id]) rentasPorPropiedad[c.propiedad_id] = [];
                if(c.monto_renta > 0) rentasPorPropiedad[c.propiedad_id].push(Number(c.monto_renta));
            });

            props.forEach(p => {
                if (p.propiedad_padre_id) {
                    if(!propsPorPadre[p.propiedad_padre_id]) propsPorPadre[p.propiedad_padre_id] = [];
                    propsPorPadre[p.propiedad_padre_id].push(p.propiedad_id);
                }
            });

            // 3. Evaluar cada propiedad
            _unidades = props.map(p => {
                // Sacar el historial de rentas de ESTA propiedad
                let rentas = rentasPorPropiedad[p.propiedad_id] || [];
                
                // Si nunca se ha rentado, buscar propiedades hermanas (ej. otros depas del mismo edificio)
                if (rentas.length === 0 && p.propiedad_padre_id && propsPorPadre[p.propiedad_padre_id]) {
                    propsPorPadre[p.propiedad_padre_id].forEach(hermanoId => {
                        if (rentasPorPropiedad[hermanoId]) {
                            rentas = rentas.concat(rentasPorPropiedad[hermanoId]);
                        }
                    });
                }

                // Calcular promedio
                let precio_estimado = null;
                if (rentas.length > 0) {
                    const sum = rentas.reduce((a,b) => a + b, 0);
                    precio_estimado = Math.round(sum / rentas.length);
                }

                // Verificar si está ocupada actualmente
                const ocupada = contratos.some(c => c.propiedad_id === p.propiedad_id && c.estado === 'ACTIVO');

                return { ...p, precio_estimado, ocupada };
            }).filter(p => !p.ocupada); // Excluir las ocupadas
            
        } catch (err) {
            console.error('[BUSCAR-PROP] Error:', err);
            TOAST?.error('No se pudieron cargar los datos.');
        }
    }

    // ---------- UI: Beneficios Dinámicos con Iconos ----------
    function _extraerBeneficiosUnicos() {
        // Vinculamos los eventos a los checkboxes estáticos que pasaste en el HTML
        document.querySelectorAll('input[name="beneficios"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const val = e.target.value.toLowerCase();
                if (e.target.checked) {
                    _filtroBeneficios.add(val);
                } else {
                    _filtroBeneficios.delete(val);
                }
                _aplicarFiltros();
            });
        });
    }

    // ---------- FILTROS ----------
    function _bindFiltros() {
        ['f-buscar', 'f-tipo', 'f-precio-min', 'f-precio-max'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.addEventListener('input', () => {
                if(id==='f-buscar') _filtroTexto = el.value;
                if(id==='f-tipo') _filtroTipo = el.value;
                if(id==='f-precio-min') _filtroPrecioMin = el.value ? Number(el.value) : null;
                if(id==='f-precio-max') _filtroPrecioMax = el.value ? Number(el.value) : null;
                _aplicarFiltros();
            });
        });
    }

    function _aplicarFiltros() {
        _unidadesFiltradas = _unidades.filter(prop => {
            const texto = _filtroTexto.trim().toLowerCase();
            if (texto && !(prop.nombre?.toLowerCase().includes(texto) || prop.direccion?.toLowerCase().includes(texto))) return false;
            if (_filtroTipo && prop.tipo_propiedad !== _filtroTipo) return false;

            // Filtro de precio (Solo aplica si la propiedad tiene un estimado, si no, se oculta para no mentir)
            const pEst = prop.precio_estimado;
            if (_filtroPrecioMin !== null && (pEst === null || pEst < _filtroPrecioMin)) return false;
            if (_filtroPrecioMax !== null && (pEst === null || pEst > _filtroPrecioMax)) return false;

            // Filtro flexible de beneficios
            if (_filtroBeneficios.size > 0) {
                // Convertimos todos los beneficios que vengan de la BD a un solo string en minúsculas
                const propBeneficiosStr = Array.isArray(prop.beneficios) 
                    ? prop.beneficios.join(' ').toLowerCase() 
                    : '';
                
                let hasAll = true;
                for (let b of _filtroBeneficios) {
                    // Reemplazamos guiones bajos por espacios ("area_social" -> "area social")
                    const keyword = b.replace('_', ' ');
                    if (!propBeneficiosStr.includes(keyword)) { 
                        hasAll = false; 
                        break; 
                    }
                }
                if (!hasAll) return false;
            }
            return true;
        });

        _renderLista();
        const cont = document.getElementById('count-resultados');
        if(cont) cont.textContent = `${_unidadesFiltradas.length} Resultados`;
    }

    // ---------- RENDER DE TARJETAS ----------
    function _renderLista() {
        const cont = document.getElementById('lista-resultados');
        if (!cont) return;
        if (_unidadesFiltradas.length === 0) {
            cont.innerHTML = `<div class="col-span-full p-10 text-center text-slate-500">No encontramos coincidencias</div>`;
            return;
        }
        cont.innerHTML = _unidadesFiltradas.map(prop => _cardUnidad(prop)).join('');
        if (_seleccion) _resaltarTarjeta(_seleccion.propiedad_id);
    }

    function _cardUnidad(p) {
        const meta = TIPO_META[p.tipo_propiedad] || { label: p.tipo_propiedad, icono: 'fa-building', clase: 'bg-slate-100 text-slate-700' };
        
        // Mostrar etiqueta inteligente de precio
        const precioBadge = p.precio_estimado 
            ? `<span class="text-blue-700 bg-blue-50 px-2 py-1 rounded-lg font-bold text-xs border border-blue-100 shadow-sm" title="Promedio histórico">Est. ${formatoDinero(p.precio_estimado)}</span>`
            : `<span class="text-slate-600 bg-slate-100 px-2 py-1 rounded-lg font-bold text-[10px] border border-slate-200">Consultar precio</span>`;
            
        return `
        <div data-prop="${p.propiedad_id}" class="prop-card relative bg-white rounded-2xl border border-slate-200 shadow-sm p-4 cursor-pointer transition-all hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5 group">
            <div class="absolute left-0 top-0 bottom-0 w-1 bg-transparent group-hover:bg-blue-500 transition-colors"></div>
            <div class="flex items-start justify-between gap-2 pl-1">
                <div class="min-w-0 flex-1">
                    <p class="text-slate-900 font-extrabold text-base truncate">${esc(p.nombre)}</p>
                    <p class="text-slate-500 text-xs mt-1 flex items-start gap-1.5">
                        <i class="fas fa-map-marker-alt text-red-400 text-[10px] mt-0.5"></i>
                        <span class="line-clamp-2 leading-tight">${esc(p.direccion)}</span>
                    </p>
                </div>
                <div class="flex flex-col items-end gap-2 flex-shrink-0">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase ${meta.clase}">
                        <i class="fas ${meta.icono}"></i> ${esc(meta.label)}
                    </span>
                    ${precioBadge}
                </div>
            </div>
            
            <div class="pl-1 mt-3 flex justify-between items-end">
                <div class="flex gap-1.5">
                    ${(p.beneficios || []).slice(0,3).map(b => `<span class="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-600 font-bold" title="${esc(b)}"><i class="fas ${_getIconoBeneficio(b)}"></i></span>`).join('')}
                    ${p.beneficios && p.beneficios.length > 3 ? `<span class="px-2 py-1 rounded border border-slate-100 bg-slate-50 text-[10px] text-slate-400 font-bold">+${p.beneficios.length - 3}</span>` : ''}
                </div>
                <button onclick="BUSCAR_PROPIEDAD.abrirModal('${p.propiedad_id}')" class="text-blue-600 hover:text-blue-800 text-xs font-bold transition-colors">Ver Detalles <i class="fas fa-arrow-right ml-1"></i></button>
            </div>
        </div>`;
    }

    // ---------- SELECCIÓN Y MAPA ----------
    function _bindListaClicks() {
        const cont = document.getElementById('lista-resultados');
        if (!cont) return;
        cont.addEventListener('click', (e) => {
            const card = e.target.closest('[data-prop]');
            // Evitar doble accion si dio clic en el botón de "Ver Detalles"
            if (card && !e.target.closest('button')) _seleccionar(card.getAttribute('data-prop'));
        });
    }

    function _seleccionar(propId) {
        const prop = _unidadesFiltradas.find(p => String(p.propiedad_id) === String(propId));
        if (!prop) return;
        _seleccion = prop;
        _resaltarTarjeta(propId);

        const mapIframe = document.getElementById('map-iframe');
        if (mapIframe && prop.direccion) {
            mapIframe.src = `https://maps.google.com/maps?q=$${encodeURIComponent(prop.direccion)}&t=m&z=16&output=embed&iwloc=near`;
        }
    }

    function _resaltarTarjeta(propId) {
        document.querySelectorAll('#lista-resultados [data-prop]').forEach(el => {
            const isSelected = el.getAttribute('data-prop') === String(propId);
            el.classList.toggle('ring-2', isSelected);
            el.classList.toggle('ring-blue-500', isSelected);
            el.classList.toggle('border-blue-500', isSelected);
            el.classList.toggle('bg-blue-50/30', isSelected);
            const cinta = el.querySelector('.absolute');
            if(cinta) cinta.classList.toggle('bg-blue-600', isSelected);
        });
    }

    // ---------- MODAL DETALLES Y SOLICITUD ----------
    function abrirModal(propId) {
        const prop = _unidadesFiltradas.find(p => String(p.propiedad_id) === String(propId));
        console.log('Abriendo modal para propiedad:', prop);
        if (!prop) return;
        _seleccionar(propId); // Para que se centre en el mapa

        // FIX: Si el contenedor no existe en el HTML, lo creamos dinámicamente
        let contenedor = document.getElementById('modal-container');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'modal-container';
            document.body.appendChild(contenedor);
        }

        const meta = TIPO_META[prop.tipo_propiedad] || { label: prop.tipo_propiedad, icono: 'fa-building', clase: 'text-slate-600' }
        
        let benesHtml = (prop.beneficios || []).map(b => `
            <div class="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                <i class="fas ${_getIconoBeneficio(b)} text-blue-500 text-lg mb-1"></i>
                <span class="text-[10px] font-bold text-slate-600 uppercase tracking-wide">${esc(b)}</span>
            </div>
        `).join('');

        if(!benesHtml) benesHtml = '<p class="text-sm text-slate-500 col-span-full">No se han registrado beneficios específicos.</p>';

        const precioTxt = prop.precio_estimado 
            ? `<div class="bg-blue-50 rounded-lg p-3 text-center border border-blue-100"><p class="text-[10px] text-blue-600 font-bold uppercase tracking-wide">Precio Estimado</p><p class="text-xl font-extrabold text-blue-800">${formatoDinero(prop.precio_estimado)}</p></div>` 
            : `<div class="bg-slate-50 rounded-lg p-3 text-center border border-slate-200"><p class="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Precio Mensual</p><p class="text-sm mt-1 font-bold text-slate-700">Tratar con dueño</p></div>`;

        contenedor.innerHTML = `
            <div class="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden anim-scale-in">
                    
                    <div class="flex justify-between items-center p-5 border-b border-slate-100">
                        <div>
                            <span class="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest ${meta.clase} mb-1">
                                <i class="fas ${meta.icono}"></i> ${esc(meta.label)}
                            </span>
                            <h3 class="text-2xl font-extrabold text-slate-900 leading-tight">${esc(prop.nombre)}</h3>
                        </div>
                        <button onclick="BUSCAR_PROPIEDAD.cerrarModal()" class="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors">
                            <i class="fas fa-times text-lg"></i>
                        </button>
                    </div>

                    <div class="p-6 overflow-y-auto custom-scrollbar flex-1">
                        <p class="text-slate-600 text-sm flex items-start gap-2 mb-6">
                            <i class="fas fa-map-marker-alt text-red-500 mt-1"></i>
                            <span>${esc(prop.direccion)}</span>
                        </p>

                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                            ${precioTxt}
                            <div class="bg-slate-50 rounded-lg p-3 text-center border border-slate-200 col-span-1 sm:col-span-2 flex items-center justify-center">
                                <p class="text-sm text-slate-600 italic">"Esta propiedad actualmente no tiene un contrato activo, ¡está disponible para ti!"</p>
                            </div>
                        </div>

                        ${prop.descripcion ? `
                        <div class="mb-6">
                            <h4 class="text-sm font-bold text-slate-800 mb-2">Acerca del lugar</h4>
                            <p class="text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">${esc(prop.descripcion)}</p>
                        </div>` : ''}

                        <div>
                            <h4 class="text-sm font-bold text-slate-800 mb-3">Beneficios y Amenidades</h4>
                            <div class="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                ${benesHtml}
                            </div>
                        </div>
                    </div>

                    <div class="p-5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-white rounded-full shadow flex items-center justify-center text-blue-600 text-lg border border-slate-200">
                                <i class="fas fa-user-tie"></i>
                            </div>
                            <div class="flex flex-col">
                                <p class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Arrendador</p>
                                <p class="text-sm font-extrabold text-slate-800 leading-tight">${esc(prop.duenio.nombre_completo)}</p>
                                <div class="flex items-center gap-3 mt-1">
                                    ${prop.duenio.telefono ? `<a href="tel:${esc(prop.duenio.telefono)}" class="text-[11px] font-bold text-green-600 hover:text-green-700 transition-colors"><i class="fas fa-phone-alt mr-1"></i>${esc(prop.duenio.telefono)}</a>` : ''}
                                    ${prop.duenio.correo ? `<a href="mailto:${esc(prop.duenio.correo)}" class="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition-colors"><i class="fas fa-envelope mr-1"></i>${esc(prop.duenio.correo)}</a>` : ''}
                                </div>
                            </div>
                        </div>
                        
                        <button id="btn-solicitar" onclick="BUSCAR_PROPIEDAD.enviarSolicitud('${prop.propiedad_id}')" 
                                class="w-full sm:w-auto bg-[#0f2557] hover:bg-blue-800 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2">
                            <i class="fas fa-paper-plane"></i> Solicitar Contrato
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function cerrarModal() {
        document.getElementById('modal-container').innerHTML = '';
    }

    async function enviarSolicitud(propId) {
        if (!_inquilinoId) {
            TOAST?.error('Error de cuenta: No se encontró tu perfil de inquilino.');
            return;
        }

        const prop = _unidadesFiltradas.find(p => String(p.propiedad_id) === String(propId));
        if (!prop) return;

        const btn = document.getElementById('btn-solicitar');
        if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        try {
            // USAMOS TIPO 'RECORDATORIO' para no romper la base de datos que ya tiene su Enum estricto.
            // Los metadatos permitirán al frontend del arrendador armar el contrato con campos prellenados.
            const payload = {
                usuario_id: prop.duenio.usuario_id,
                titulo: '¡Nueva solicitud de arrendamiento!',
                mensaje: `El inquilino ${_usuario.nombre_completo} está interesado en rentar la propiedad "${prop.nombre}". Comunicate con él o redacta un contrato directamente.`,
                tipo: 'RECORDATORIO', 
                leida: false,
                metadatos: {
                    accion: "SOLICITUD_CONTRATO",
                    propiedad_id: prop.propiedad_id,
                    inquilino_id: _inquilinoId,
                    url_accion: `nuevo-contrato.html?propiedad_id=${prop.propiedad_id}&inquilino_id=${_inquilinoId}`
                }
            };

            const { error } = await window.supabaseClient.from('notificaciones').insert([payload]);
            if (error) throw error;

            TOAST?.success('¡Solicitud enviada al arrendador con éxito!');
            setTimeout(() => cerrarModal(), 1500);

        } catch (err) {
            console.error('[BUSCAR-PROP] Error al solicitar:', err);
            TOAST?.error('No se pudo enviar la solicitud.');
            if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Solicitar Contrato'; }
        }
    }

    return { 
        init, 
        abrirModal, 
        cerrarModal, 
        enviarSolicitud 
    };
})();