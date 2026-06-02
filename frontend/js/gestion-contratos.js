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
        const cancelados  = _contratos.filter(c => c.estado === 'TERMINADO').length;

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
                <div class="col-span-full p-10 bg-white rounded-2xl border border-slate-100 text-center">
                    <div class="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
                        <i class="fa-solid fa-file-contract text-blue-500 text-xl"></i>
                    </div>
                    <p class="text-slate-700 font-semibold mb-1">Sin contratos</p>
                    <p class="text-slate-400 text-sm mb-4">No hay coincidencias con los filtros actuales.</p>
                    <a href="nuevo-contrato.html" class="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
                        <i class="fa-solid fa-plus mr-1"></i> Crear primer contrato
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

        const estadoCfg = {
            PENDIENTE:  { bg:'bg-amber-50',  border:'border-amber-200',  text:'text-amber-700',  dot:'bg-amber-500', label:'Pendiente', icon:'fa-hourglass-half' },
            ACTIVO:     { bg:'bg-green-50',  border:'border-green-200',  text:'text-green-700',  dot:'bg-green-500', label:'Activo',    icon:'fa-circle-check' },
            FINALIZADO: { bg:'bg-slate-100', border:'border-slate-200',  text:'text-slate-600',  dot:'bg-slate-400', label:'Finalizado', icon:'fa-flag-checkered' },
            TERMINADO:  { bg:'bg-orange-50', border:'border-orange-200', text:'text-orange-700', dot:'bg-orange-500', label:'Cancelado', icon:'fa-ban' },
            RECHAZADO:  { bg:'bg-red-50',    border:'border-red-200',    text:'text-red-700',    dot:'bg-red-500',    label:'Rechazado', icon:'fa-circle-xmark' },
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
                <div class="mt-3">
                    <div class="flex justify-between text-[10px] text-slate-500 mb-1">
                        <span>Progreso</span>
                        <span class="font-semibold">${pct}%</span>
                    </div>
                    <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }

        return `
        <div data-contrato-card="${c.contrato_id}"
             class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden
                    hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer anim-fade-in-up">
            <!-- Cabecera con estado -->
            <div class="${s.bg} ${s.border} border-b px-5 py-3 flex items-center gap-2">
                <i class="fa-solid ${s.icon} ${s.text} text-xs"></i>
                <span class="${s.text} text-xs font-bold uppercase tracking-wider">${s.label}</span>
                <span class="ml-auto text-[10px] font-mono text-slate-400">
                    #${String(c.contrato_id).padStart(6, '0')}
                </span>
            </div>

            <div class="p-5">
                <!-- Inquilino -->
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-900 font-bold text-sm truncate">${esc(inq.nombre_completo || 'Inquilino')}</p>
                        <p class="text-slate-500 text-xs truncate">${esc(inq.correo || '')}</p>
                    </div>
                </div>

                <!-- Propiedad -->
                <div class="rounded-xl bg-slate-50 px-3 py-2 mb-3">
                    <p class="text-[10px] text-slate-400 uppercase font-semibold">Propiedad</p>
                    <p class="text-slate-800 text-sm font-semibold truncate">${esc(prop.nombre || '—')}</p>
                    <p class="text-slate-400 text-xs truncate">
                        <i class="fa-solid fa-location-dot text-[10px] mr-0.5"></i>${esc(prop.direccion || '')}
                    </p>
                </div>

                <!-- Métricas -->
                <div class="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Inicio</p>
                        <p class="font-bold text-slate-800 text-[11px]">${fmtFecha(c.fecha_inicio)}</p>
                    </div>
                    <div>
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Término</p>
                        <p class="font-bold text-slate-800 text-[11px]">${fmtFecha(c.fecha_fin)}</p>
                    </div>
                    <div>
                        <p class="text-slate-400 text-[10px] uppercase font-semibold">Renta</p>
                        <p class="font-bold text-blue-700">${fmtMoney(c.monto_renta)}</p>
                    </div>
                </div>

                ${progresoHTML}

                <p class="mt-3 text-center text-[10px] text-slate-400">
                    <i class="fa-solid fa-arrow-right text-[9px] mr-1"></i> Toca para ver detalle
                </p>
            </div>
        </div>`;
    }

    return { init };
})();

window.GESTION_CONTRATOS = GESTION_CONTRATOS;