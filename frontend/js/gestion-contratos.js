// ================================================================
// gestion-contratos.js  –  Listado para el arrendador
// ================================================================
// Implementa:
//   - RF-17: Mostrar contratos activos (y por extensión, todos).
//   - RF-18: Consultar historial de contratos finalizados.
//   - Filtrado por estado y búsqueda libre.
//   - Click sobre una tarjeta → detalle-contrato.html?contratoId=N
//
// Consulta principal:
//   .from('contratos')
//   .select('..., propiedades(...), inquilinos(usuarios(...))')
//   .in('propiedad_id', propiedades_del_arrendador)
// ================================================================

const GESTION_CONTRATOS = (() => {

    let _usuario = null;
    let _contratos = [];

    async function init(usuario) {
        _usuario = usuario;
        _bindFiltros();
        await _cargarContratos();
    }

    // ──────────────────────────────────────────────────────────────
    // Cargar contratos del arrendador
    // ──────────────────────────────────────────────────────────────
    async function _cargarContratos() {
        // Primero: ids de propiedades del arrendador
        const { data: props } = await window.supabaseClient
            .from('propiedades')
            .select('propiedad_id')
            .eq('duenio_id', _usuario.usuario_id);

        const propIds = (props || []).map(p => p.propiedad_id);
        if (!propIds.length) {
            _contratos = [];
            _renderMetricas(); _renderLista();
            return;
        }

        const { data, error } = await window.supabaseClient
            .from('contratos')
            .select(`
                contrato_id, fecha_inicio, fecha_fin, fecha_terminacion, monto_renta,
                frecuencia_pago, estado, observaciones, beneficios, aceptado_en, creado_en,
                propiedades ( propiedad_id, nombre, direccion, tipo_propiedad ),
                inquilinos (
                    inquilino_id,
                    usuarios ( usuario_id, nombre_completo, correo, telefono )
                )
            `)
            .in('propiedad_id', propIds)
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[GESTION-CONTRATOS] Error:', error);
            return;
        }
        _contratos = data || [];

        _renderMetricas();
        _renderLista();
    }

    // ──────────────────────────────────────────────────────────────
    // Métricas
    // ──────────────────────────────────────────────────────────────
    function _renderMetricas() {
        const pendientes  = _contratos.filter(c => c.estado === 'PENDIENTE').length;
        const activos     = _contratos.filter(c => c.estado === 'ACTIVO').length;
        const finalizados = _contratos.filter(c => c.estado === 'FINALIZADO').length;
        // Terminados o rechazados cuentan como cancelados
        const cancelados  = _contratos.filter(c => c.estado === 'TERMINADO' || c.estado === 'RECHAZADO').length;

        document.getElementById('m-pendientes').textContent  = pendientes;
        document.getElementById('m-activos').textContent     = activos;
        document.getElementById('m-finalizados').textContent = finalizados;
        document.getElementById('m-cancelados').textContent  = cancelados;
    }

    // ──────────────────────────────────────────────────────────────
    // Filtros
    // ──────────────────────────────────────────────────────────────
    function _bindFiltros() {
        ['f-buscar', 'f-estado', 'f-orden'].forEach(id => {
            document.getElementById(id)?.addEventListener('input',  _renderLista);
            document.getElementById(id)?.addEventListener('change', _renderLista);
        });
    }

    function _aplicarFiltros() {
        const q     = (document.getElementById('f-buscar')?.value || '').toLowerCase().trim();
        const est   = document.getElementById('f-estado')?.value || '';
        const orden = document.getElementById('f-orden')?.value || 'reciente';

        let lista = _contratos.filter(c => {
            if (est && c.estado !== est) return false;
            if (!q) return true;
            const folio = String(c.contrato_id).padStart(6, '0');
            const inquilino = c.inquilinos?.usuarios?.nombre_completo?.toLowerCase() || '';
            const propiedad = c.propiedades?.nombre?.toLowerCase() || '';
            return folio.includes(q) || inquilino.includes(q) || propiedad.includes(q);
        });

        // Orden
        if (orden === 'antiguo')      lista.sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
        else if (orden === 'monto-desc') lista.sort((a, b) => b.monto_renta - a.monto_renta);
        else if (orden === 'monto-asc')  lista.sort((a, b) => a.monto_renta - b.monto_renta);
        // 'reciente' es el orden por defecto

        return lista;
    }

    // ──────────────────────────────────────────────────────────────
    // Render del listado
    // ──────────────────────────────────────────────────────────────
    function _renderLista() {
        const cont = document.getElementById('lista-contratos');
        const lista = _aplicarFiltros();

        if (!lista.length) {
            cont.innerHTML = `
                <div class="col-span-full p-12 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-16 h-16 mx-auto rounded-2xl bg-[#FFC533]/20 border border-[#FFE788] flex items-center justify-center mb-4">
                        <i class="fa-solid fa-file-contract text-[#13243E] text-2xl"></i>
                    </div>
                    <p class="text-[#13243E] font-bold mb-1 text-lg">Sin contratos</p>
                    <p class="text-[#6F88A1] text-sm mb-5 font-medium">No hay coincidencias con los filtros actuales.</p>
                    <a href="nuevo-contrato.html" class="inline-block px-5 py-2.5 rounded-xl bg-[#FFC533] hover:bg-[#FFD44A] text-[#13243E] text-sm font-bold shadow-sm shadow-[#FFC533]/30 transition-colors">
                        <i class="fa-solid fa-plus mr-1.5"></i> Crear primer contrato
                    </a>
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(_renderCard).join('');

        // Toda la tarjeta es clickable → ir al detalle
        cont.querySelectorAll('[data-contrato-card]').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-contrato-card');
                window.location.href = `detalle-contrato.html?contratoId=${id}`;
            });
        });
    }

    function _renderCard(c) {
        const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : '—';
        const fmtMoney = v => new Intl.NumberFormat('es-MX', {style:'currency', currency:'MXN', maximumFractionDigits:0}).format(v);

        const inq  = c.inquilinos?.usuarios || {};
        const prop = c.propiedades || {};

        // Paleta Design System aplicada a los estados
        const estadoCfg = {
            PENDIENTE:  { bg:'bg-[#FFFBEB]', border:'border-[#FFE788]', text:'text-[#13243E]', dot:'bg-[#FFC533]', label:'Pendiente', icon:'fa-hourglass-half' },
            ACTIVO:     { bg:'bg-green-50',  border:'border-green-200', text:'text-green-700', dot:'bg-green-500', label:'Activo',    icon:'fa-circle-check' },
            FINALIZADO: { bg:'bg-[#F5F7F9]', border:'border-slate-200', text:'text-[#6F88A1]', dot:'bg-slate-400', label:'Finalizado', icon:'fa-flag-checkered' },
            TERMINADO:  { bg:'bg-orange-50', border:'border-orange-200', text:'text-orange-700', dot:'bg-orange-500', label:'Cancelado', icon:'fa-ban' },
            RECHAZADO:  { bg:'bg-red-50',    border:'border-red-200',   text:'text-red-700',   dot:'bg-red-500',   label:'Rechazado', icon:'fa-circle-xmark' },
        };
        const s = estadoCfg[c.estado] || estadoCfg.FINALIZADO;
        const iniciales = (inq.nombre_completo || '?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();

        // Progreso del contrato (solo aplica a ACTIVO)
        let progresoHTML = '';
        if (c.estado === 'ACTIVO') {
            const ini = new Date(c.fecha_inicio);
            const fin = new Date(c.fecha_fin);
            const total = fin - ini;
            const trans = Math.min(Math.max(Date.now() - ini, 0), total);
            const pct = total > 0 ? Math.round((trans / total) * 100) : 0;
            progresoHTML = `
                <div class="mt-4">
                    <div class="flex justify-between text-[10px] text-[#6F88A1] font-bold uppercase tracking-wider mb-1.5">
                        <span>Progreso</span>
                        <span class="text-[#255FA4]">${pct}%</span>
                    </div>
                    <div class="h-1.5 bg-[#F5F7F9] rounded-full overflow-hidden shadow-inner">
                        <div class="h-full bg-gradient-to-r from-[#5A97D6] to-[#255FA4] rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }

        return `
        <div data-contrato-card="${c.contrato_id}"
             class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col
                    hover:shadow-md hover:border-slate-200 hover:-translate-y-1 transition-all duration-200 cursor-pointer anim-fade-in-up">

            <div class="${s.bg} ${s.border} border-b px-5 py-3 flex items-center gap-2">
                <i class="fa-solid ${s.icon} ${s.text} text-xs"></i>
                <span class="${s.text} text-[10px] font-extrabold uppercase tracking-widest">${s.label}</span>
                <span class="ml-auto text-[10px] font-bold text-[#6F88A1] bg-white/50 px-2 py-0.5 rounded-md border border-white/50">
                    #${String(c.contrato_id).padStart(6, '0')}
                </span>
            </div>

            <div class="p-5 flex-1 flex flex-col">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-12 h-12 rounded-xl bg-[#FFC533] text-[#13243E] flex items-center justify-center font-extrabold text-sm flex-shrink-0 shadow-sm border border-white/50">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[#13243E] font-bold text-sm truncate">${esc(inq.nombre_completo || 'Inquilino')}</p>
                        <p class="text-[#6F88A1] text-xs font-medium truncate">
                            <i class="fa-solid fa-envelope text-[10px] mr-1"></i>${esc(inq.correo || '')}
                        </p>
                    </div>
                </div>

                <div class="rounded-xl bg-[#F5F7F9] border border-slate-100 px-3.5 py-3 mb-4">
                    <p class="text-[9px] text-[#6F88A1] uppercase font-bold tracking-widest mb-0.5">Propiedad vinculada</p>
                    <p class="text-[#13243E] text-sm font-bold truncate">${esc(prop.nombre || '—')}</p>
                    <p class="text-[#6F88A1] text-xs font-medium truncate mt-0.5">
                        <i class="fa-solid fa-location-dot text-[10px] mr-1 text-[#255FA4]"></i>${esc(prop.direccion || '')}
                    </p>
                </div>

                <div class="grid grid-cols-3 gap-2 text-center text-xs mt-auto">
                    <div class="rounded-xl border border-slate-100 py-2">
                        <p class="text-[#6F88A1] text-[9px] uppercase font-bold tracking-widest mb-0.5">Inicio</p>
                        <p class="font-extrabold text-[#13243E] text-[11px]">${fmtFecha(c.fecha_inicio)}</p>
                    </div>
                    <div class="rounded-xl border border-slate-100 py-2">
                        <p class="text-[#6F88A1] text-[9px] uppercase font-bold tracking-widest mb-0.5">Término</p>
                        <p class="font-extrabold text-[#13243E] text-[11px]">${fmtFecha(c.fecha_fin)}</p>
                    </div>
                    <div class="rounded-xl border border-blue-100 bg-blue-50/50 py-2">
                        <p class="text-[#6F88A1] text-[9px] uppercase font-bold tracking-widest mb-0.5">Renta</p>
                        <p class="font-extrabold text-[#255FA4] text-[11px]">${fmtMoney(c.monto_renta)}</p>
                    </div>
                </div>

                ${progresoHTML}

                <div class="mt-4 pt-3 border-t border-slate-100 w-full text-center">
                    <p class="text-[#6F88A1] text-[10px] font-semibold uppercase tracking-wider group-hover:text-[#13243E] transition-colors">
                        Toca para ver detalle <i class="fa-solid fa-arrow-right text-[9px] ml-0.5"></i>
                    </p>
                </div>
            </div>
        </div>`;
    }

    return { init };
})();

window.GESTION_CONTRATOS = GESTION_CONTRATOS;