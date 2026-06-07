// ================================================================
// components/layout.js  –  Layout Maestro Dinámico
// ================================================================
// Inyecta el sidebar + topbar en páginas protegidas.
//
// USO EN CADA PÁGINA PROTEGIDA:
//   1. HTML body debe contener: <div id="page-template">...contenido...</div>
//   2. En el script de init: await LAYOUT.inyectarLayout({ paginaActiva: 'dashboard' })
//   3. Luego llamar LAYOUT.setPageTitle('Título visible en topbar')
// ================================================================

const LAYOUT = (() => {

    // ──────────────────────────────────────────────────────────────
    // Definición de menús por rol
    // ──────────────────────────────────────────────────────────────
    const ICONS = {
        home:       `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
        building:   `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>`,
        users:      `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
        document:   `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
        credit:     `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>`,
        bell:       `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`,
        chart:      `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
        logout:     `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>`,
        hamburger:  `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>`,
        close:      `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
        mapPin: `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
    };

    const NAV_ARRENDADOR = [
        { icon: ICONS.home,     label: 'Dashboard',     href: 'dashboard-arrendador.html', id: 'dashboard'    },
        { icon: ICONS.building, label: 'Propiedades',   href: 'propiedades.html',          id: 'propiedades'  },
        { icon: ICONS.users,    label: 'Inquilinos',    href: 'inquilinos-edificio.html',  id: 'inquilinos'   },
        { icon: ICONS.document, label: 'Contratos',     href: 'gestion-contratos.html',    id: 'contratos'    },
        { icon: ICONS.credit,   label: 'Pagos',         href: 'pagos.html',                id: 'pagos'        },
        { icon: ICONS.chart,    label: 'Finanzas',      href: 'finanzas.html',             id: 'finanzas'     },
        { icon: ICONS.bell,     label: 'Incidencias',   href: 'incidencias.html',          id: 'incidencias'  },
    ];

    const NAV_INQUILINO = [
        { icon: ICONS.home,     label: 'Mi Dashboard',     href: 'dashboard-inquilino.html', id: 'dashboard'    },
        { icon: ICONS.mapPin,   label: 'Buscar propiedad', href: 'buscar-propiedad.html',    id: 'buscar'       },
        { icon: ICONS.document, label: 'Mi Contrato',      href: 'contratos-inquilinos.html',id: 'contratos'    },
        { icon: ICONS.credit,   label: 'Mis Pagos',        href: 'mis-pagos.html',           id: 'pagos'        },
        { icon: ICONS.bell,     label: 'Incidencias',      href: 'mis-incidencias.html',     id: 'incidencias'  },
    ];

    // ──────────────────────────────────────────────────────────────
    // Generador del HTML del sidebar (VERSIÓN COLAPSABLE)
    // ──────────────────────────────────────────────────────────────
    function _buildSidebar(usuario, navItems, activePage) {
        const iniciales = (usuario.nombre_completo || 'U')
            .split(' ')
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

        const navHTML = navItems.map(item => {
            const active = activePage === item.id;
            return `
            <a href="${esc(item.href)}"
               class="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                      ${active
                          ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                          : 'text-blue-100/80 hover:bg-white/10 hover:text-white'}">
                <span class="flex-shrink-0 w-5 flex justify-center">${item.icon}</span>
                <span class="truncate sb-label">${esc(item.label)}</span>
                ${active ? '<span class="ml-auto w-1.5 h-1.5 rounded-full bg-white/80 sb-label"></span>' : ''}
            </a>`;
        }).join('');

        const rolLabel   = usuario.rol === 'ARRENDADOR' ? 'Arrendador' : 'Inquilino';
        const navSection = usuario.rol === 'ARRENDADOR' ? 'Administración' : 'Mi cuenta';

        return `
        <aside id="sidebar"
               class="fixed left-0 top-0 h-full w-64 lg:w-[4.5rem] lg:hover:w-64 z-40 flex flex-col overflow-hidden
                      bg-gradient-to-b from-[#0c1f4a] via-[#0f2557] to-[#1a3680]
                      transform -translate-x-full lg:translate-x-0
                      transition-[width,transform] duration-300 ease-in-out shadow-2xl">

            <!-- ── Logo ───────────────────────────────────────── -->
            <div class="flex items-center gap-3 px-4 py-5 border-b border-white/10">
                <div class="w-9 h-9 bg-blue-400 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/30">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
                    </svg>
                </div>
                <div class="min-w-0 sb-label">
                    <h1 class="text-white font-bold text-sm leading-none tracking-tight whitespace-nowrap">Arrendamientos</h1>
                    <p class="text-blue-300/70 text-xs mt-0.5 whitespace-nowrap">Gestión de propiedades</p>
                </div>
                <!-- Botón cerrar en móvil -->
                <button onclick="LAYOUT.cerrarSidebar()"
                        class="ml-auto lg:hidden p-1 rounded-lg text-blue-300/70 hover:text-white hover:bg-white/10 transition-colors">
                    ${ICONS.close}
                </button>
            </div>

            <!-- ── Pista visual: expandir al hover (solo desktop) ── -->
            <div class="hidden lg:flex justify-center py-1.5 text-blue-300/40 transition-opacity group-hover/sidebar:opacity-0">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                </svg>
            </div>

            <!-- ── Navegación ─────────────────────────────────── -->
            <nav class="flex-1 px-3 py-2 lg:py-4 space-y-0.5 overflow-y-auto overflow-x-hidden custom-scrollbar">
                <p class="text-blue-300/40 text-[10px] font-bold uppercase tracking-widest px-3 mb-2 whitespace-nowrap sb-label">
                    ${esc(navSection)}
                </p>
                ${navHTML}
            </nav>

            <!-- ── Usuario + Logout ───────────────────────────── -->
            <div class="px-3 py-4 border-t border-white/10 space-y-2">
                <div class="flex items-center gap-3 px-1.5 py-2">
                    <div class="w-9 h-9 rounded-xl bg-blue-400/25 border border-blue-300/30
                                flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        ${esc(iniciales)}
                    </div>
                    <div class="flex-1 min-w-0 sb-label">
                        <p class="text-white text-sm font-semibold truncate leading-none mb-0.5 whitespace-nowrap">
                            ${esc(usuario.nombre_completo)}
                        </p>
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-400/20 text-blue-200 text-[10px] font-medium">
                            ${esc(rolLabel)}
                        </span>
                    </div>
                </div>
                <button onclick="AUTH.cerrarSesion()"
                        class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm overflow-hidden
                               bg-red-600/95 text-white hover:bg-red-500 active:bg-red-700
                               shadow-lg shadow-red-900/40 ring-1 ring-red-400/30
                               transition-all duration-200 font-semibold">
                    <span class="flex-shrink-0 w-4 flex justify-center">${ICONS.logout}</span>
                    <span class="whitespace-nowrap sb-label">Cerrar sesión</span>
                </button>
            </div>
        </aside>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Generador del HTML completo del layout (con ajuste de margen)
    // ──────────────────────────────────────────────────────────────
    function _buildLayout(usuario, navItems, activePage, contenidoPagina, iniciales) {
        const sidebar  = _buildSidebar(usuario, navItems, activePage);
        const nombre1  = (usuario.nombre_completo || '').split(' ')[0];

        // Fecha actual para el topbar
        const hoy = new Date();
        let fechaLarga = '', fechaCorta = '';
        try {
            fechaLarga = hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            fechaCorta = hoy.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (_) {
            fechaCorta = hoy.toISOString().slice(0, 10);
            fechaLarga = fechaCorta;
        }

        return `
        ${sidebar}

        <!-- ── Overlay móvil ─────────────────────────────────── -->
        <div id="sidebar-overlay"
             class="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 hidden lg:hidden"
             onclick="LAYOUT.cerrarSidebar()">
        </div>

        <!-- ── Área principal (margen izquierdo dinámico) ────── -->
        <div id="main-shell" class="lg:ml-[4.5rem] flex flex-col min-h-screen bg-slate-50/80 transition-[margin] duration-300 ease-in-out">

            <!-- Top bar -->
            <header class="sticky top-0 z-20 flex items-center gap-3 px-4 lg:px-6 h-16
                           bg-white/80 backdrop-blur-md border-b border-slate-200/70 shadow-sm">

                <!-- Hamburger (solo móvil) -->
                <button id="hamburger-btn"
                        onclick="LAYOUT.abrirSidebar()"
                        class="lg:hidden p-2 -ml-1 rounded-xl text-slate-500 hover:text-slate-700
                               hover:bg-slate-100 transition-colors">
                    ${ICONS.hamburger}
                </button>

                <!-- Título + fecha -->
                <div class="flex-1 min-w-0">
                    <h2 id="page-title" class="text-slate-800 font-bold text-sm lg:text-base truncate leading-tight">
                        &nbsp;
                    </h2>
                    <p class="hidden sm:block text-[11px] text-slate-400 font-medium capitalize truncate -mt-0.5">
                        ${esc(fechaLarga)}
                    </p>
                </div>

                <!-- Chip de fecha -->
                <div class="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/80 text-slate-500 text-xs font-semibold">
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    <span>${esc(fechaCorta)}</span>
                </div>

                <!-- Badge usuario -->
                <div class="flex items-center gap-2.5 pl-1 sm:pl-3 sm:border-l sm:border-slate-200">
                    <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center
                                text-white text-xs font-bold shadow-sm shadow-blue-600/30">
                        ${esc(iniciales)}
                    </div>
                    <span class="hidden sm:inline text-slate-600 text-sm font-medium">${esc(nombre1)}</span>
                </div>
            </header>

            <!-- Contenido de la página -->
            <main id="main-content" class="flex-1 p-4 lg:p-6">
                ${contenidoPagina}
            </main>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // PRIVADO: cargar dinámicamente un script (una sola vez)
    // ──────────────────────────────────────────────────────────────
    function _cargarScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-dyn="${src}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.setAttribute('data-dyn', src);
            s.onload  = () => resolve();
            s.onerror = () => reject(new Error('No se pudo cargar ' + src));
            document.head.appendChild(s);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Proximidad: expande el sidebar cuando el mouse se acerca al borde
    // izquierdo (solo desktop). Sin errores de async.
    // ──────────────────────────────────────────────────────────────
    let _proxActive = false;
    function _initProximidadSidebar() {
        if (_proxActive) return;
        _proxActive = true;
        let rafId = null;
        document.addEventListener('mousemove', (e) => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const sb = document.getElementById('sidebar');
                if (!sb || window.innerWidth < 1024) return;
                const x = e.clientX;
                // Si el cursor está a menos de 120px del borde izquierdo, añadimos una clase temporal.
                // Para no interferir con el hover normal, usamos una clase que fuerza la expansión.
                if (x <= 120) {
                    sb.classList.add('proximity-expand');
                } else {
                    sb.classList.remove('proximity-expand');
                }
            });
        });
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: inyectarLayout (con notificaciones + proximidad)
    // ──────────────────────────────────────────────────────────────
    async function inyectarLayout(opciones = {}) {
        // 1. Verificar sesión
        const session = await window.AUTH.verificarSesion();
        if (!session) return;

        // 2. Obtener perfil
        const usuario = await window.AUTH.obtenerUsuarioActual();
        if (!usuario) {
            window.location.replace('../index.html');
            return;
        }

        // 3. Leer contenido de la página antes de limpiar el DOM
        const templateEl = document.getElementById('page-template');
        const contenidoPagina = templateEl ? templateEl.innerHTML : '';

        // 4. Calcular iniciales
        const iniciales = (usuario.nombre_completo || 'U')
            .split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        // 5. Elegir menú según rol
        const navItems = usuario.rol === 'ARRENDADOR' ? NAV_ARRENDADOR : NAV_INQUILINO;

        // 6. Construir y volcar el layout
        document.body.className = 'font-sans antialiased';
        document.body.innerHTML = _buildLayout(
            usuario,
            navItems,
            opciones.paginaActiva || '',
            contenidoPagina,
            iniciales
        );

        // 7. Escape cierra el sidebar en móvil
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cerrarSidebar();
        });

        // 8. Inicializar el efecto de proximidad (solo desktop)
        _initProximidadSidebar();

        // 9. NOTIFICACIONES: exactamente igual que en tu versión main
        try {
            const base = window.location.pathname.includes('/pages/') ? '../' : '';
            if (!window.TOAST) {
                await _cargarScript(base + 'js/components/toast.js');
            }
            if (!window.NOTIFICACIONES) {
                await _cargarScript(base + 'js/notificaciones.js');
            }
            if (window.NOTIFICACIONES) window.NOTIFICACIONES.init(usuario);
        } catch (err) {
            console.warn('[LAYOUT] No se pudo montar el centro de notificaciones:', err);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // PUBLIC: helpers de UI
    // ──────────────────────────────────────────────────────────────
    function abrirSidebar() {
        document.getElementById('sidebar')?.classList.remove('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function cerrarSidebar() {
        document.getElementById('sidebar')?.classList.add('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    function setPageTitle(titulo) {
        const el = document.getElementById('page-title');
        if (el) el.textContent = titulo;
    }

    function setContent(html) {
        const el = document.getElementById('main-content');
        if (el) el.innerHTML = html;
    }

    return { inyectarLayout, abrirSidebar, cerrarSidebar, setPageTitle, setContent };
})();

window.LAYOUT = LAYOUT;

// Pequeño CSS adicional para que la clase proximity-expand funcione
// (puedes ponerlo en tu CSS global o en un <style> inline)
(function addProximityStyle() {
    const style = document.createElement('style');
    style.textContent = `
        #sidebar.proximity-expand {
            width: 16rem !important; /* 64 en Tailwind */
        }
        @media (min-width: 1024px) {
            #sidebar.proximity-expand + #main-shell {
                margin-left: 16rem !important;
            }
        }
    `;
    document.head.appendChild(style);
})();