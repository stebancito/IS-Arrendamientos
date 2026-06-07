// ================================================================
// buscar-propiedad.js  –  Página "Buscar propiedad" (INQUILINO)
// ================================================================
// Lista las propiedades disponibles para rentar (activas y sin
// contrato ACTIVO). El panel de la DERECHA muestra un mapa; al
// hacer clic en una tarjeta de la IZQUIERDA, ese panel cambia al
// Street View de la dirección de la propiedad, y debajo se muestran
// los datos del inmueble y del arrendador.
//
// 100% con iframes embebidos de Google Maps → NO requiere API key.
// Para posicionar el Street View se necesitan coordenadas, que se
// obtienen con OpenStreetMap/Nominatim (gratuito, sin key) y se
// cachean en localStorage. El modo "Mapa" funciona solo con la
// dirección, sin geocodificar.
// ================================================================

const BUSCAR_PROPIEDAD = (() => {

    const CIUDAD_DEFAULT = 'Ciudad de México';   // mapa inicial del panel
    const GEO_CACHE_KEY  = 'bp_geocache_v1';

    const TIPO_META = {
        DEPARTAMENTO: { label: 'Departamento', clase: 'bg-blue-100 text-blue-700' },
        CASA:         { label: 'Casa',         clase: 'bg-green-100 text-green-700' },
        LOCAL:        { label: 'Local',        clase: 'bg-purple-100 text-purple-700' },
        TERRENO:      { label: 'Terreno',      clase: 'bg-amber-100 text-amber-700' },
        EDIFICIO:     { label: 'Edificio',     clase: 'bg-slate-100 text-slate-700' },
    };

    let _usuario = null;
    let _unidades = [];          // propiedades disponibles (planas)
    let _filtroTexto = '';
    let _filtroTipo = '';
    let _seleccion = null;       // propiedad seleccionada
    let _modoPanel = 'mapa';     // 'mapa' | 'street'

    // ── INIT ────────────────────────────────────────────────────
    async function init(usuario) {
        _usuario = usuario;
        _bindFiltros();
        _bindListaClicks();
        _bindPanelToggle();
        _renderPanel();          // estado inicial: mapa de la ciudad + hint
        await _cargarDatos();
    }

    // ── Carga de datos ──────────────────────────────────────────
    async function _cargarDatos() {
        const cont = document.getElementById('lista-resultados');

        // Propiedades activas (excluimos EDIFICIO: es contenedor, no se renta)
        const { data: props, error } = await window.supabaseClient
            .from('propiedades')
            .select(`
                propiedad_id, nombre, direccion, tipo_propiedad, descripcion, beneficios, propiedad_padre_id,
                duenio:usuarios!propiedades_duenio_id_fkey ( usuario_id, nombre_completo, correo, telefono )
            `)
            .eq('activa', true)
            .neq('tipo_propiedad', 'EDIFICIO')
            .order('creado_en', { ascending: false });

        if (error) {
            console.error('[BUSCAR-PROP] Error al cargar propiedades:', error);
            if (cont) cont.innerHTML = _bloqueMensaje('No se pudieron cargar las propiedades. Intenta de nuevo.');
            return;
        }

        // Marcar las ocupadas (con contrato ACTIVO) para excluirlas
        const ids = (props || []).map(p => p.propiedad_id);
        let ocupados = new Set();
        if (ids.length) {
            const { data: contratos } = await window.supabaseClient
                .from('contratos')
                .select('propiedad_id')
                .eq('estado', 'ACTIVO')
                .in('propiedad_id', ids);
            ocupados = new Set((contratos || []).map(c => c.propiedad_id));
        }

        _unidades = (props || []).filter(p => !ocupados.has(p.propiedad_id));

        _renderStats();
        _aplicarFiltros();
    }

    // ── Filtros ─────────────────────────────────────────────────
    function _bindFiltros() {
        const fBuscar = document.getElementById('f-buscar');
        const fTipo   = document.getElementById('f-tipo');
        if (fBuscar) fBuscar.addEventListener('input',  e => { _filtroTexto = e.target.value; _aplicarFiltros(); });
        if (fTipo)   fTipo.addEventListener('change',   e => { _filtroTipo  = e.target.value; _aplicarFiltros(); });
    }

    function _unidadesFiltradas() {
        const texto = _filtroTexto.trim().toLowerCase();
        const tipo  = _filtroTipo;
        return _unidades.filter(u => {
            const okTexto = !texto
                || (u.nombre    || '').toLowerCase().includes(texto)
                || (u.direccion || '').toLowerCase().includes(texto);
            const okTipo = !tipo || u.tipo_propiedad === tipo;
            return okTexto && okTipo;
        });
    }

    function _aplicarFiltros() {
        const cont = document.getElementById('lista-resultados');
        const lista = _unidadesFiltradas();

        if (cont) {
            cont.innerHTML = lista.length
                ? lista.map(u => _cardUnidad(u)).join('')
                : _bloqueMensaje('No hay propiedades que coincidan con tu búsqueda.');
        }
        _set('count-resultados', lista.length === 1 ? '1 resultado' : `${lista.length} resultados`);

        // Reaplicar resaltado si la propiedad seleccionada sigue visible
        if (_seleccion) _resaltarTarjeta(_seleccion.propiedad_id);
    }

    // ── Tarjeta ─────────────────────────────────────────────────
    function _cardUnidad(u) {
        const meta  = TIPO_META[u.tipo_propiedad] || { label: u.tipo_propiedad, clase: 'bg-slate-100 text-slate-700' };
        const benes = Array.isArray(u.beneficios) ? u.beneficios.slice(0, 4) : [];

        const benesHTML = benes.length
            ? `<div class="flex flex-wrap gap-1 mt-2">
                   ${benes.map(b => `<span class="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">${esc(b)}</span>`).join('')}
               </div>`
            : '';

        return `
        <div data-prop="${u.propiedad_id}" tabindex="0" role="button"
             class="prop-card stat-card bg-white rounded-2xl border border-slate-100 shadow-sm p-4 cursor-pointer transition
                    hover:border-blue-300 anim-fade-in-up">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="text-slate-900 font-bold text-sm truncate">${esc(u.nombre)}</p>
                    <p class="text-slate-500 text-xs mt-0.5 flex items-start gap-1">
                        <svg class="w-3.5 h-3.5 mt-px flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        <span class="truncate">${esc(u.direccion)}</span>
                    </p>
                </div>
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${meta.clase}">
                    ${esc(meta.label)}
                </span>
            </div>

            ${u.descripcion ? `<p class="text-slate-600 text-xs mt-2 line-clamp-2">${esc(u.descripcion)}</p>` : ''}
            ${benesHTML}

            <div class="flex items-center justify-end mt-3 pt-3 border-t border-slate-100">
                <span class="text-blue-600 text-xs font-medium whitespace-nowrap">Ver Street View →</span>
            </div>
        </div>`;
    }

    // ── Selección de propiedad ──────────────────────────────────
    function _bindListaClicks() {
        const cont = document.getElementById('lista-resultados');
        if (!cont) return;

        cont.addEventListener('click', (e) => {
            const card = e.target.closest('[data-prop]');
            if (card) _seleccionar(card.getAttribute('data-prop'));
        });
        cont.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('[data-prop]');
            if (card) { e.preventDefault(); _seleccionar(card.getAttribute('data-prop')); }
        });
    }

    function _seleccionar(propId) {
        const u = _unidades.find(x => String(x.propiedad_id) === String(propId));
        if (!u) return;
        _seleccion = u;
        _modoPanel = 'street';        // al hacer clic mostramos Street View
        _resaltarTarjeta(propId);
        _renderPanel();
        // En móvil, llevar la vista al panel del mapa
        document.getElementById('mapa-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function _resaltarTarjeta(propId) {
        document.querySelectorAll('#lista-resultados [data-prop]').forEach(el => {
            const on = el.getAttribute('data-prop') === String(propId);
            el.classList.toggle('ring-2', on);
            el.classList.toggle('ring-blue-500', on);
            el.classList.toggle('border-blue-300', on);
        });
    }

    // ── Panel derecho (iframe + toggle + detalle) ───────────────
    function _bindPanelToggle() {
        document.getElementById('btn-mapa')?.addEventListener('click',   () => { _modoPanel = 'mapa';   _renderPanel(); });
        document.getElementById('btn-street')?.addEventListener('click', () => { _modoPanel = 'street'; _renderPanel(); });
    }

    async function _renderPanel() {
        const iframe  = document.getElementById('panel-iframe');
        const hint    = document.getElementById('panel-hint');
        const toggle  = document.getElementById('panel-toggle');
        const detalle = document.getElementById('panel-detalle');
        if (!iframe) return;

        // Sin selección: mapa de la ciudad + hint, sin toggle ni detalle
        if (!_seleccion) {
            iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(CIUDAD_DEFAULT)}&z=11&output=embed`;
            hint?.classList.remove('hidden');
            toggle?.classList.add('hidden');  toggle?.classList.remove('flex');
            detalle?.classList.add('hidden');
            _set('panel-titulo', 'Mapa');
            _set('panel-direccion', '');
            return;
        }

        const dir = _seleccion.direccion || '';
        hint?.classList.add('hidden');
        toggle?.classList.remove('hidden');  toggle?.classList.add('flex');

        _set('panel-titulo', _seleccion.nombre || 'Propiedad');
        _set('panel-direccion', dir);
        _renderDetalle(_seleccion);

        if (_modoPanel === 'street') {
            // Street View necesita coordenadas → geocodificamos (OSM)
            const coord = await _geocodificar(dir);
            if (coord) {
                iframe.src = `https://maps.google.com/maps?q=&layer=c&cbll=${coord.lat},${coord.lng}&cbp=11,0,0,0,0&output=svembed`;
            } else {
                // Sin coordenadas: caemos a "Mapa" por dirección
                _modoPanel = 'mapa';
                iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(dir)}&z=16&output=embed`;
                _toast('No encontramos Street View para esta dirección; mostrando el mapa.', 'info');
            }
        } else {
            iframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(dir)}&z=16&output=embed`;
        }

        _actualizarToggle();
    }

    function _actualizarToggle() {
        const setActive = (id, active) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle('bg-blue-600', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('shadow-sm', active);
            btn.classList.toggle('text-slate-600', !active);
        };
        setActive('btn-mapa',   _modoPanel === 'mapa');
        setActive('btn-street', _modoPanel === 'street');
    }

    function _renderDetalle(u) {
        const cont = document.getElementById('panel-detalle');
        if (!cont) return;

        const meta  = TIPO_META[u.tipo_propiedad] || { label: u.tipo_propiedad, clase: 'bg-slate-100 text-slate-700' };
        const d     = u.duenio || {};
        const benes = Array.isArray(u.beneficios) ? u.beneficios : [];

        const benesHTML = benes.length
            ? `<div class="flex flex-wrap gap-1.5 mt-2">
                   ${benes.map(b => `<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">${esc(b)}</span>`).join('')}
               </div>`
            : '';

        const tel = d.telefono
            ? `<a href="tel:${esc(d.telefono)}" class="text-blue-600 hover:underline">${esc(d.telefono)}</a>`
            : '—';
        const correo = d.correo
            ? `<a href="mailto:${esc(d.correo)}" class="text-blue-600 hover:underline break-all">${esc(d.correo)}</a>`
            : '—';

        cont.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <h4 class="text-slate-900 font-bold text-base">${esc(u.nombre)}</h4>
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${meta.clase}">${esc(meta.label)}</span>
            </div>
            <p class="text-slate-500 text-xs mt-0.5">${esc(u.direccion || '')}</p>
            ${u.descripcion ? `<p class="text-slate-600 text-sm mt-2">${esc(u.descripcion)}</p>` : ''}
            ${benesHTML}
            <div class="mt-3 pt-3 border-t border-slate-100">
                <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Arrendador</p>
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        ${esc(_iniciales(d.nombre_completo))}
                    </div>
                    <div class="min-w-0">
                        <p class="text-slate-800 text-sm font-semibold truncate">${esc(d.nombre_completo || '—')}</p>
                        <p class="text-xs text-slate-500 mt-0.5">Tel: ${tel}</p>
                        <p class="text-xs text-slate-500 break-all">Correo: ${correo}</p>
                    </div>
                </div>
            </div>`;
        cont.classList.remove('hidden');
    }

    // ── Geocodificación con OpenStreetMap (sin API key) + caché ──
    function _getCache() {
        try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY)) || {}; }
        catch { return {}; }
    }
    function _setCache(c) {
        try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(c)); } catch { /* storage no disponible */ }
    }

    async function _geocodificar(direccion) {
        const key = (direccion || '').trim().toLowerCase();
        if (!key) return null;

        const cache = _getCache();
        if (cache[key]) return cache[key];

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(direccion)}`;
            const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!resp.ok) return null;
            const arr = await resp.json();
            if (Array.isArray(arr) && arr.length) {
                const coord = { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
                cache[key] = coord;
                _setCache(cache);
                return coord;
            }
        } catch (e) {
            console.warn('[BUSCAR-PROP] No se pudo geocodificar la dirección:', e);
        }
        return null;
    }

    // ── Helpers ─────────────────────────────────────────────────
    function _renderStats() {
        const deptos = _unidades.filter(u => u.tipo_propiedad === 'DEPARTAMENTO').length;
        const casas  = _unidades.filter(u => u.tipo_propiedad === 'CASA').length;
        const otros  = _unidades.filter(u => u.tipo_propiedad === 'LOCAL' || u.tipo_propiedad === 'TERRENO').length;
        _set('m-disponibles', _unidades.length);
        _set('m-deptos', deptos);
        _set('m-casas', casas);
        _set('m-otros', otros);
    }

    function _bloqueMensaje(txt) {
        return `<div class="col-span-full bg-white rounded-2xl border border-slate-100 p-8 text-center">
                    <p class="text-slate-400 text-sm">${esc(txt)}</p>
                </div>`;
    }

    function _iniciales(nombre) {
        return (nombre || 'A').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    }

    function _set(id, valor) {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    }

    function _toast(msg, tipo = 'info') {
        if (window.TOAST) {
            if (tipo === 'error') TOAST.error(msg);
            else if (tipo === 'success') TOAST.success(msg);
            else TOAST.info(msg);
        } else {
            console.log('[BUSCAR-PROP]', msg);
        }
    }

    return { init };
})();

window.BUSCAR_PROPIEDAD = BUSCAR_PROPIEDAD;