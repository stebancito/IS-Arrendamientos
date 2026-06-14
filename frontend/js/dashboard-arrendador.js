// Llamar a esta función después de verificar la sesión en tu init
async function cargarDashboardArrendador(usuarioId) {
    await cargarPropiedadesSlider(usuarioId);
    await cargarContratosRecientes(usuarioId);
}

// Lógica de los botones de navegación Izquierda / Derecha
function moverSlider(idSlider, direccion) {
    const slider = document.getElementById(idSlider);
    if (slider) {
        // Desplaza 260px (ancho de una tarjeta aprox) por cada click
        slider.scrollBy({ left: direccion * 260, behavior: 'smooth' });
    }
}

// 1. Llenar el Slider de Propiedades con la Paleta de Colores
// 1. Llenar el Slider de Propiedades con la Paleta de Colores y botón para Generar Contrato directo
async function cargarPropiedadesSlider(duenioId) {
    const { data: propiedades, error } = await window.supabaseClient
        .from('propiedades')
        .select('*')
        .eq('duenio_id', duenioId)
        .eq('activa', true)
        .limit(6);

    const contenedor = document.getElementById('slider-propiedades');

    if (error || !propiedades || propiedades.length === 0) {
        contenedor.innerHTML = `<div class="w-full text-center py-6 text-slate-400 text-sm">No tienes propiedades registradas aún.</div>`;
        return;
    }

    const iconos = {
        'DEPARTAMENTO': `<path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>`,
        'CASA': `<path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>`
    };

    contenedor.innerHTML = propiedades.map(prop => `
        <div class="snap-start flex-shrink-0 w-[240px] bg-[#FFFBEB] rounded-2xl border border-[#FFE788] shadow-sm p-5 flex flex-col transition-transform hover:-translate-y-1">
            <div class="w-10 h-10 rounded-xl bg-[#FFC533] flex items-center justify-center mb-3 text-[#13243E] shadow-sm shadow-[#FFC533]/40">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    ${iconos[prop.tipo_propiedad] || iconos['CASA']}
                </svg>
            </div>
            <h4 class="text-[#13243E] font-bold text-base truncate" title="${esc(prop.nombre)}">${esc(prop.nombre)}</h4>
            <p class="text-[#13243E]/70 text-xs mb-4 truncate">${esc(prop.direccion)}</p>

            <div class="mt-auto">
                <span class="inline-block px-2.5 py-1 bg-white border border-[#FFE788] text-[#13243E] text-[10px] font-bold uppercase rounded-md mb-3">
                    ${esc(prop.tipo_propiedad)}
                </span>

                <a href="nuevo-contrato.html?propiedad_id=${prop.propiedad_id}"
                   class="block w-full text-center py-2 bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] text-xs font-bold rounded-xl transition-colors shadow-sm">
                    Generar contrato
                </a>
            </div>
        </div>
    `).join('');
}

// 2. Llenar el NUEVO Slider de Contratos
async function cargarContratosRecientes(duenioId) {
    const { data: contratos, error } = await window.supabaseClient
        .from('contratos')
        .select(`
            contrato_id, monto_renta, estado, fecha_fin,
            inquilinos!inner( usuarios!inner(nombre_completo) ),
            propiedades!inner(nombre, duenio_id)
        `)
        .eq('propiedades.duenio_id', duenioId)
        .order('creado_en', { ascending: false })
        .limit(6);

    const contenedor = document.getElementById('slider-contratos');

    if (error || !contratos || contratos.length === 0) {
        contenedor.innerHTML = `<div class="w-full text-center py-6 text-slate-400 text-sm">No hay contratos recientes.</div>`;
        return;
    }

    const formatDinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

    contenedor.innerHTML = contratos.map(c => {
        const fecha = new Date(c.fecha_fin);
        const fechaStr = `vence ${fecha.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })}`;
        const nombreInquilino = c.inquilinos.usuarios.nombre_completo;
        const nombrePropiedad = c.propiedades.nombre;

        // Iniciales para el avatar circular
        const iniciales = nombreInquilino.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        const estadoHTML = c.estado === 'ACTIVO'
            ? `<span class="inline-flex items-center gap-1.5 bg-[#FFFBEB] border border-[#FFE788] text-[#13243E] px-2.5 py-1 rounded-full text-[10px] font-bold uppercase">
                 <span class="w-1.5 h-1.5 rounded-full bg-[#FFC533]"></span> Activo
               </span>`
            : `<span class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase">
                 <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ${esc(c.estado)}
               </span>`;

        return `
            <div class="snap-start flex-shrink-0 w-[240px] bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col transition-transform hover:-translate-y-1">
                <div class="flex justify-between items-start mb-3">
                    <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-[#13243E] font-bold text-sm border border-slate-200">
                        ${iniciales}
                    </div>
                    ${estadoHTML}
                </div>

                <h4 class="text-[#13243E] font-bold text-sm truncate" title="${esc(nombreInquilino)}">${esc(nombreInquilino)}</h4>
                <p class="text-[#255FA4] text-xs font-semibold mb-2 truncate">${esc(nombrePropiedad)}</p>

                <p class="text-[#13243E] font-extrabold text-xl mt-2">${formatDinero.format(c.monto_renta)}</p>
                <p class="text-slate-400 text-[10px] uppercase tracking-widest mb-4">${fechaStr}</p>

                <div class="mt-auto">
                    <button onclick="verDetalleContrato(${c.contrato_id})" class="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[#13243E] text-xs font-bold rounded-xl transition-colors">
                        Gestionar contrato
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Funciones dummy para los botones
function verDetallePropiedad(id) { window.location.href = `propiedad-detalle.html?id=${id}`; }
function verDetalleContrato(id) { window.location.href = `contrato-detalle.html?id=${id}`; }