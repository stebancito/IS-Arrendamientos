// ================================================================
// COMPONENTE GLOBAL DE NOTIFICACIONES (TOAST)
// ================================================================
// Uso:
//   TOAST.mostrar('Mensaje', 'success'|'error'|'warning'|'info');
//   TOAST.mostrar('Texto', 'success', 5000);  // duración personalizada
// ================================================================

const TOAST = (() => {
    let timeoutId = null;

    // Configuración de estilos e iconos por tipo
    const config = {
        success: {
            bg: 'bg-gradient-to-r from-green-600 to-emerald-600',
            icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>`,
            border: 'border-green-400'
        },
        error: {
            bg: 'bg-gradient-to-r from-red-600 to-rose-600',
            icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>`,
            border: 'border-red-400'
        },
        warning: {
            bg: 'bg-gradient-to-r from-yellow-500 to-amber-600',
            icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>`,
            border: 'border-yellow-400'
        },
        info: {
            bg: 'bg-gradient-to-r from-blue-600 to-indigo-600',
            icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>`,
            border: 'border-blue-400'
        }
    };

    // Icono por defecto (propiedades/arrendamiento)
    const defaultIcon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                         </svg>`;

    function mostrar(mensaje, tipo = 'info', duracion = 4000) {
        // Eliminar toast anterior si existe
        const toastAnterior = document.querySelector('.global-toast');
        if (toastAnterior) {
            toastAnterior.remove();
            if (timeoutId) clearTimeout(timeoutId);
        }

        const cfg = config[tipo] || config.info;
        const icono = cfg.icon || defaultIcon;

        // Crear elemento toast
        const toast = document.createElement('div');
        toast.className = `global-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-50 
                           flex items-center gap-3 px-5 py-3 rounded-xl 
                           shadow-2xl border-l-4 ${cfg.border}
                           text-white text-sm font-semibold backdrop-blur-sm
                           transform transition-all duration-300 ease-out
                           animate-slide-up`;
        toast.style.background = `${cfg.bg}cc`; // semi-transparente
        toast.style.background = `linear-gradient(135deg, ${cfg.bg.split(' ')[2]} 0%, ${cfg.bg.split(' ')[4]} 100%)`;
        
        // Mejoramos el fondo con opacidad controlada
        toast.style.backgroundColor = cfg.bg.includes('red') ? 'rgba(220,38,38,0.95)' :
                                     cfg.bg.includes('green') ? 'rgba(22,163,74,0.95)' :
                                     cfg.bg.includes('yellow') ? 'rgba(234,179,8,0.95)' :
                                     'rgba(37,99,235,0.95)';
        
        toast.innerHTML = `
            <div class="flex-shrink-0 bg-white/20 rounded-full p-1.5">
                ${icono}
            </div>
            <span class="flex-1">${mensaje}</span>
            <button class="toast-close ml-2 text-white/70 hover:text-white transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        `;

        document.body.appendChild(toast);

        // Animación de entrada
        setTimeout(() => toast.classList.add('opacity-100', 'translate-y-0'), 10);

        // Cerrar con botón
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            toast.remove();
            if (timeoutId) clearTimeout(timeoutId);
        });

        // Auto-cerrar
        timeoutId = setTimeout(() => {
            if (toast && toast.parentNode) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
                setTimeout(() => toast.remove(), 300);
            }
        }, duracion);
    }

    // Exponemos también un método rápido
    return {
        mostrar,
        success: (msg, duration) => mostrar(msg, 'success', duration),
        error: (msg, duration) => mostrar(msg, 'error', duration),
        warning: (msg, duration) => mostrar(msg, 'warning', duration),
        info: (msg, duration) => mostrar(msg, 'info', duration)
    };
})();

// Exponer globalmente
window.TOAST = TOAST;