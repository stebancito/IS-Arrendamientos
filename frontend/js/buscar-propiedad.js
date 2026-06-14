// ================================================================
// buscar-propiedad.js  –  Búsqueda, Estimación de Precio y Solicitudes
// ================================================================

const BUSCAR_PROPIEDAD = (() => {

    // ---------- CONSTANTES ----------
    const TIPO_META = {
        DEPARTAMENTO: { label: 'Departamento', icono: 'fa-building', clase: 'bg-[#5A97D6]/10 text-[#255FA4] border-[#5A97D6]/20' },
        CASA:         { label: 'Casa',         icono: 'fa-house',    clase: 'bg-green-50 text-green-700 border-green-200' },
        LOCAL:        { label: 'Local',        icono: 'fa-store',    clase: 'bg-purple-50 text-purple-700 border-purple-200' },
        TERRENO:      { label: 'Terreno',      icono: 'fa-tree',     clase: 'bg-[#FFFBEB] text-[#13243E] border-[#FFE788]' },
        EDIFICIO:     { label: 'Edificio',     icono: 'fa-city',     clase: 'bg-[#F5F7F9] text-[#6F88A1] border-slate-200' },
    };

    let _usuario = null;
    let _inquilinoId = null;
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
        return String(str).replace(/[&<>]/g, m => ({'&': '&', '<': '<', '>': '>'}[m]));
    }

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
        return 'fa-check';
    }

    function formatoDinero(cantidad) {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cantidad);
    }

    // ---------- INICIALIZACIÓN ----------
    async function init(usuario) {
        _usuario = usuario;

        // 1. Obtener o crear inquilino_id usando maybeSingle para evitar el error 406
        let { data: inqData, error: errInq } = await window.supabaseClient
            .from('inquilinos')
            .select('inquilino_id')
            .eq('usuario_id', usuario.usuario_id)
            .maybeSingle();

        if (errInq) {
            console.error('[BUSCAR-PROP] Error obteniendo inquilino_id:', errInq);
        } else if (!inqData) {
            const { data: nuevoInq, error: errInsert } = await window.supabaseClient
                .from('inquilinos')
                .insert([{ usuario_id: usuario.usuario_id }])
                .select('inquilino_id')
                .single();
            if (nuevoInq) _inquilinoId = nuevoInq.inquilino_id;
        } else {
            _inquilinoId = inqData.inquilino_id;
        }

        // 2. Ejecutar la función con el nombre CORRECTO
        await _cargarDatosYCalcularPrecios();

        _extraerBeneficiosUnicos();
        _bindFiltros();
        _bindListaClicks();
        _aplicarFiltros();
    }

    // ---------- LÓGICA CORE: Carga y Estimación de Precios ----------
    async function _cargarDatosYCalcularPrecios() {
        try {
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

            const { data: contratos, error: errC } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id, monto_renta, estado');

            if (errC) throw errC;

            const rentasPorPropiedad = {};
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

            _unidades = props.map(p => {
                let rentas = rentasPorPropiedad[p.propiedad_id] || [];

                if (rentas.length === 0 && p.propiedad_padre_id && propsPorPadre[p.propiedad_padre_id]) {
                    propsPorPadre[p.propiedad_padre_id].forEach(hermanoId => {
                        if (rentasPorPropiedad[hermanoId]) {
                            rentas = rentas.concat(rentasPorPropiedad[hermanoId]);
                        }
                    });
                }

                let precio_estimado = null;
                if (rentas.length > 0) {
                    const sum = rentas.reduce((a,b) => a + b, 0);
                    precio_estimado = Math.round(sum / rentas.length);
                }

                const ocupada = contratos.some(c => c.propiedad_id === p.propiedad_id && c.estado === 'ACTIVO');
                return { ...p, precio_estimado, ocupada };
            }).filter(p => !p.ocupada);

        } catch (err) {
            console.error('[BUSCAR-PROP] Error:', err);
            if(window.TOAST) TOAST.error('No se pudieron cargar los datos.');
        }
    }

    // ---------- UI: Beneficios Dinámicos ----------
    function _extraerBeneficiosUnicos() {
        document.querySelectorAll('input[name="beneficios"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const val = e.target.value.toLowerCase();
                if (e.target.checked) _filtroBeneficios.add(val);
                else _filtroBeneficios.delete(val);
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

            const pEst = prop.precio_estimado;
            if (_filtroPrecioMin !== null && (pEst === null || pEst < _filtroPrecioMin)) return false;
            if (_filtroPrecioMax !== null && (pEst === null || pEst > _filtroPrecioMax)) return false;

            if (_filtroBeneficios.size > 0) {
                const propBeneficiosStr = Array.isArray(prop.beneficios) ? prop.beneficios.join(' ').toLowerCase() : '';
                let hasAll = true;
                for (let b of _filtroBeneficios) {
                    const keyword = b.replace('_', ' ');
                    if (!propBeneficiosStr.includes(keyword)) { hasAll = false; break; }
                }
                if (!hasAll) return false;
            }
            return true;
        });

        _renderLista();
        const cont = document.getElementById('count-resultados');
        if(cont) cont.textContent = `${_unidadesFiltradas.length} Propiedad${_unidadesFiltradas.length !== 1 ? 'es' : ''}`;
    }

    // ---------- RENDER DE TARJETAS ----------
    function _renderLista() {
        const cont = document.getElementById('lista-resultados');
        if (!cont) return;
        if (_unidadesFiltradas.length === 0) {
            cont.innerHTML = `
                <div class="col-span-full p-10 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-[#FFC533]/20 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-house-circle-xmark text-[#13243E] text-xl"></i>
                    </div>
                    <p class="text-[#13243E] font-bold">No hay coincidencias</p>
                    <p class="text-[#6F88A1] text-xs">Intenta ajustar tus filtros de búsqueda.</p>
                </div>`;
            return;
        }
        cont.innerHTML = _unidadesFiltradas.map(prop => _cardUnidad(prop)).join('');
        if (_seleccion) _resaltarTarjeta(_seleccion.propiedad_id);
    }

    function _cardUnidad(p) {
        const meta = TIPO_META[p.tipo_propiedad] || { label: p.tipo_propiedad, icono: 'fa-building', clase: 'bg-slate-100 text-slate-700' };

        const precioBadge = p.precio_estimado
            ? `<span class="text-[#255FA4] bg-[#5A97D6]/10 px-2 py-1 rounded-lg font-bold text-[11px] border border-[#5A97D6]/20" title="Promedio histórico">~ ${formatoDinero(p.precio_estimado)}</span>`
            : `<span class="text-[#6F88A1] bg-[#F5F7F9] px-2 py-1 rounded-lg font-bold text-[10px] border border-slate-200">Consultar precio</span>`;

        return `
        <div data-prop="${p.propiedad_id}" class="relative bg-white rounded-2xl border border-slate-200 shadow-sm p-4 cursor-pointer transition-all hover:shadow-md hover:border-[#FFC533] hover:-translate-y-0.5 overflow-hidden">
            <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-transparent transition-colors indicator-bar"></div>
            <div class="flex items-start justify-between gap-2 pl-2">
                <div class="min-w-0 flex-1">
                    <p class="text-[#13243E] font-bold text-base truncate">${esc(p.nombre)}</p>
                    <p class="text-[#6F88A1] text-[11px] mt-1 flex items-start gap-1.5">
                        <i class="fas fa-location-dot text-[#255FA4] mt-0.5"></i>
                        <span class="line-clamp-2 leading-tight">${esc(p.direccion)}</span>
                    </p>
                </div>
                <div class="flex flex-col items-end gap-2 flex-shrink-0">
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-extrabold uppercase tracking-wider ${meta.clase}">
                        <i class="fas ${meta.icono}"></i> ${esc(meta.label)}
                    </span>
                    ${precioBadge}
                </div>
            </div>

            <div class="pl-2 mt-4 flex justify-between items-end border-t border-slate-50 pt-3">
                <div class="flex gap-1.5">
                    ${(p.beneficios || []).slice(0,3).map(b => `<span class="w-6 h-6 flex items-center justify-center rounded-md border border-slate-200 bg-[#F5F7F9] text-[10px] text-[#13243E] font-bold shadow-sm" title="${esc(b)}"><i class="fas ${_getIconoBeneficio(b)}"></i></span>`).join('')}
                    ${p.beneficios && p.beneficios.length > 3 ? `<span class="px-2 h-6 flex items-center justify-center rounded-md border border-slate-100 bg-[#F5F7F9] text-[9px] text-[#6F88A1] font-bold">+${p.beneficios.length - 3}</span>` : ''}
                </div>
                <button onclick="BUSCAR_PROPIEDAD.abrirModal('${p.propiedad_id}')" class="text-[#13243E] hover:text-[#FFC533] bg-[#FFC533]/20 hover:bg-[#FFC533] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
                    Ver Detalles
                </button>
            </div>
        </div>`;
    }

    // ---------- SELECCIÓN Y MAPA ----------
    function _bindListaClicks() {
        const cont = document.getElementById('lista-resultados');
        if (!cont) return;
        cont.addEventListener('click', (e) => {
            const card = e.target.closest('[data-prop]');
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
            mapIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(prop.direccion)}&t=m&z=16&output=embed&iwloc=near`;
        }
    }

    function _resaltarTarjeta(propId) {
        document.querySelectorAll('#lista-resultados [data-prop]').forEach(el => {
            const isSelected = el.getAttribute('data-prop') === String(propId);
            el.classList.toggle('border-[#FFC533]', isSelected);
            el.classList.toggle('bg-[#FFFBEB]', isSelected);

            const barra = el.querySelector('.indicator-bar');
            if(barra) {
                barra.classList.toggle('bg-[#FFC533]', isSelected);
                barra.classList.toggle('bg-transparent', !isSelected);
            }
        });
    }

    // ---------- MODAL DETALLES Y SOLICITUD ----------
    function abrirModal(propId) {
        const prop = _unidadesFiltradas.find(p => String(p.propiedad_id) === String(propId));
        if (!prop) return;
        _seleccionar(propId);

        let contenedor = document.getElementById('modal-container');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'modal-container';
            document.body.appendChild(contenedor);
        }

        const meta = TIPO_META[prop.tipo_propiedad] || { label: prop.tipo_propiedad, icono: 'fa-building', clase: 'bg-slate-100 text-slate-600' }

        let benesHtml = (prop.beneficios || []).map(b => `
            <div class="flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-[#FFE788] shadow-sm text-center">
                <i class="fas ${_getIconoBeneficio(b)} text-[#FFC533] text-xl mb-1.5"></i>
                <span class="text-[9px] font-bold text-[#13243E] uppercase tracking-wider">${esc(b)}</span>
            </div>
        `).join('');

        if(!benesHtml) benesHtml = '<p class="text-sm text-[#6F88A1] col-span-full">No se han registrado beneficios específicos.</p>';

        const precioTxt = prop.precio_estimado
            ? `<div class="bg-[#FFFBEB] rounded-xl p-4 text-center border border-[#FFE788] shadow-sm"><p class="text-[10px] text-[#13243E]/80 font-bold uppercase tracking-widest mb-1">Estimación Histórica</p><p class="text-2xl font-extrabold text-[#13243E]">${formatoDinero(prop.precio_estimado)}</p></div>`
            : `<div class="bg-[#F5F7F9] rounded-xl p-4 text-center border border-slate-200 shadow-sm"><p class="text-[10px] text-[#6F88A1] font-bold uppercase tracking-widest mb-1">Precio Mensual</p><p class="text-base mt-1 font-bold text-[#13243E]">Tratar con dueño</p></div>`;

        contenedor.innerHTML = `
            <div class="fixed inset-0 z-[100] bg-[#13243E]/60 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in-up">
                <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">

                    <div class="px-6 py-5 bg-[#13243E] text-white relative flex justify-between items-center border-b border-slate-800">
                        <div class="absolute -left-6 -top-6 w-32 h-32 bg-[#FFC533]/15 rounded-full blur-3xl pointer-events-none"></div>
                        <div class="relative z-10 min-w-0">
                            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider ${meta.clase} mb-2 shadow-sm">
                                <i class="fas ${meta.icono}"></i> ${esc(meta.label)}
                            </span>
                            <h3 class="text-2xl font-extrabold text-white leading-tight truncate">${esc(prop.nombre)}</h3>
                        </div>
                        <button onclick="BUSCAR_PROPIEDAD.cerrarModal()" class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors relative z-10 flex-shrink-0">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="p-6 overflow-y-auto custom-scrollbar flex-1 bg-[#F5F7F9]">
                        <p class="text-[#13243E] text-sm flex items-start gap-2 mb-6 font-medium bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                            <i class="fas fa-location-dot text-[#255FA4] mt-0.5"></i>
                            <span>${esc(prop.direccion)}</span>
                        </p>

                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                            ${precioTxt}
                            <div class="bg-green-50 rounded-xl p-4 border border-green-200 col-span-1 sm:col-span-2 flex items-center gap-3 shadow-sm">
                                <div class="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 text-green-600"><i class="fas fa-check-double"></i></div>
                                <p class="text-sm text-green-800 font-medium">Esta propiedad actualmente no tiene un contrato activo, <strong class="font-bold">¡está disponible para ti!</strong></p>
                            </div>
                        </div>

                        ${prop.descripcion ? `
                        <div class="mb-6 bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                            <h4 class="text-sm font-extrabold text-[#13243E] uppercase tracking-wider mb-3"><i class="fa-solid fa-align-left text-[#FFC533] mr-1"></i> Acerca del lugar</h4>
                            <p class="text-sm text-[#6F88A1] leading-relaxed">${esc(prop.descripcion)}</p>
                        </div>` : ''}

                        <div class="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                            <h4 class="text-sm font-extrabold text-[#13243E] uppercase tracking-wider mb-4"><i class="fa-solid fa-star text-[#FFC533] mr-1"></i> Beneficios</h4>
                            <div class="grid grid-cols-3 sm:grid-cols-5 gap-3">
                                ${benesHtml}
                            </div>
                        </div>
                    </div>

                    <div class="p-5 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div class="flex items-center gap-3 w-full sm:w-auto">
                            <div class="w-12 h-12 bg-[#FFC533] rounded-xl shadow-sm flex items-center justify-center text-[#13243E] font-extrabold text-lg border border-[#FFE788]">
                                ${esc(prop.duenio.nombre_completo).substring(0,2).toUpperCase()}
                            </div>
                            <div class="flex flex-col flex-1 min-w-0">
                                <p class="text-[10px] text-[#6F88A1] font-bold uppercase tracking-wider">Dueño</p>
                                <p class="text-sm font-extrabold text-[#13243E] leading-tight truncate">${esc(prop.duenio.nombre_completo)}</p>
                                <div class="flex items-center gap-3 mt-0.5">
                                    ${prop.duenio.telefono ? `<span class="text-[10px] font-bold text-[#6F88A1]"><i class="fas fa-phone mr-1"></i>${esc(prop.duenio.telefono)}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <button id="btn-solicitar" onclick="BUSCAR_PROPIEDAD.enviarSolicitud('${prop.propiedad_id}')"
                                class="w-full sm:w-auto bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] px-6 py-3.5 rounded-xl font-extrabold text-sm transition-colors shadow-sm shadow-[#FFC533]/30 flex items-center justify-center gap-2 flex-shrink-0">
                            <i class="fas fa-paper-plane"></i> Solicitar Contrato
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function cerrarModal() {
        const cont = document.getElementById('modal-container');
        if(cont) cont.innerHTML = '';
    }

    async function enviarSolicitud(propId) {
        if (!_inquilinoId) {
            if(window.TOAST) TOAST.error('Error de cuenta: No se encontró tu perfil de inquilino.');
            else alert('Error de cuenta: No se encontró tu perfil de inquilino.');
            return;
        }

        const prop = _unidadesFiltradas.find(p => String(p.propiedad_id) === String(propId));
        if (!prop) return;

        const btn = document.getElementById('btn-solicitar');
        if(btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; }

        try {
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

            if(window.TOAST) TOAST.success('¡Solicitud enviada al arrendador con éxito!');
            setTimeout(() => cerrarModal(), 1500);

        } catch (err) {
            console.error('[BUSCAR-PROP] Error al solicitar:', err);
            if(window.TOAST) TOAST.error('No se pudo enviar la solicitud.');
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

window.BUSCAR_PROPIEDAD = BUSCAR_PROPIEDAD;