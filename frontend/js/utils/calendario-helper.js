// ================================================================
// utils/calendario-helper.js  –  Utilidades puras para el calendario de pagos
// ================================================================
// Funciones reutilizables por pagos-inquilino.js y pagos-arrendador.js.
// NO dependen de Supabase ni del DOM. Son funciones puras y testeables.
//
// API pública:
//   CALENDARIO_HELPER.obtenerMatrizMes(anio, mes)
//   CALENDARIO_HELPER.agruparPagosPorFecha(pagos)
//   CALENDARIO_HELPER.formatearPeriodo(pago)
//   CALENDARIO_HELPER.colorPorEstado(estado)
//   CALENDARIO_HELPER.fmtFecha(d)
//   CALENDARIO_HELPER.fmtMoney(v)
//   CALENDARIO_HELPER.nombreMes(mes)
//   CALENDARIO_HELPER.iconoEstado(estado)
// ================================================================

const CALENDARIO_HELPER = (() => {

    // ──────────────────────────────────────────────────────────────
    // obtenerMatrizMes(anio, mes)
    // ──────────────────────────────────────────────────────────────
    // Devuelve una matriz de 6 semanas (filas) × 7 días (columnas)
    // para renderizar una grilla de calendario. Cada celda es un
    // objeto { dia, fecha, esMesActual, esHoy }.
    //
    // @param {number} anio  – Año (ej. 2025)
    // @param {number} mes   – Mes 1-based (1=Ene … 12=Dic)
    // @returns {Array<Array<Object>>}
    // ──────────────────────────────────────────────────────────────
    function obtenerMatrizMes(anio, mes) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Primer día del mes (Date usa mes 0-based)
        const primerDia = new Date(anio, mes - 1, 1);
        // Último día del mes
        const ultimoDia = new Date(anio, mes, 0);

        // Día de la semana del primer día (0=Dom, 1=Lun … 6=Sab)
        // Ajustamos para que la semana empiece en Lunes:
        //   Lun=0, Mar=1, … Dom=6
        const diaInicio = (primerDia.getDay() + 6) % 7;
        const totalDias = ultimoDia.getDate();

        // Construir la matriz
        const matriz = [];
        let diaActual = 1 - diaInicio; // puede empezar en negativo (días del mes anterior)

        for (let semana = 0; semana < 6; semana++) {
            const fila = [];
            for (let col = 0; col < 7; col++) {
                const fechaObj = new Date(anio, mes - 1, diaActual);
                const esMesActual = diaActual >= 1 && diaActual <= totalDias;
                const esHoy = fechaObj.getTime() === hoy.getTime();

                fila.push({
                    dia: fechaObj.getDate(),
                    fecha: _formatoISO(fechaObj),  // 'YYYY-MM-DD'
                    esMesActual,
                    esHoy,
                    fechaObj
                });

                diaActual++;
            }
            matriz.push(fila);

            // Si ya pasamos el último día y la fila siguiente sería toda del mes siguiente,
            // podemos parar (pero mantenemos 6 filas para consistencia visual)
        }

        return matriz;
    }

    // ──────────────────────────────────────────────────────────────
    // agruparPagosPorFecha(pagos)
    // ──────────────────────────────────────────────────────────────
    // Recibe un array de pagos (cada uno con .fecha_limite en 'YYYY-MM-DD')
    // y devuelve un Map<string, Array<pago>> donde la clave es la fecha ISO.
    //
    // Útil para cruzar con la matriz del calendario y pintar indicadores
    // en los días que tienen pagos.
    //
    // @param {Array<Object>} pagos
    // @returns {Map<string, Array<Object>>}
    // ──────────────────────────────────────────────────────────────
    function agruparPagosPorFecha(pagos) {
        const mapa = new Map();
        (pagos || []).forEach(p => {
            const fecha = (p.fecha_limite || '').slice(0, 10); // 'YYYY-MM-DD'
            if (!fecha) return;
            if (!mapa.has(fecha)) mapa.set(fecha, []);
            mapa.get(fecha).push(p);
        });
        return mapa;
    }

    // ──────────────────────────────────────────────────────────────
    // formatearPeriodo(pago)
    // ──────────────────────────────────────────────────────────────
    // Devuelve un string legible del periodo de cobertura del pago.
    // Usa los campos periodo_inicio y periodo_fin si existen.
    //
    // Ejemplo: "01 Ene 2025 → 31 Ene 2025"
    //          "01 Ene → 15 Ene"  (si mismo año)
    //
    // @param {Object} pago – objeto con { periodo_inicio, periodo_fin, fecha_limite, anio, mes }
    // @returns {string}
    // ──────────────────────────────────────────────────────────────
    function formatearPeriodo(pago) {
        if (!pago) return '—';

        // Si tiene periodo_inicio y periodo_fin explícitos
        if (pago.periodo_inicio && pago.periodo_fin) {
            const ini = new Date(pago.periodo_inicio + 'T00:00:00');
            const fin = new Date(pago.periodo_fin + 'T00:00:00');
            const optsCorto = { day: '2-digit', month: 'short' };
            const optsLargo = { day: '2-digit', month: 'short', year: 'numeric' };

            if (ini.getFullYear() === fin.getFullYear()) {
                return `${ini.toLocaleDateString('es-MX', optsCorto)} → ${fin.toLocaleDateString('es-MX', optsLargo)}`;
            }
            return `${ini.toLocaleDateString('es-MX', optsLargo)} → ${fin.toLocaleDateString('es-MX', optsLargo)}`;
        }

        // Fallback: usar anio + mes para mostrar el mes completo
        if (pago.anio && pago.mes) {
            const nombre = nombreMes(pago.mes);
            return `${nombre} ${pago.anio}`;
        }

        // Último fallback: fecha_limite
        if (pago.fecha_limite) {
            return fmtFecha(pago.fecha_limite);
        }

        return '—';
    }

    // ──────────────────────────────────────────────────────────────
    // colorPorEstado(estado)
    // ──────────────────────────────────────────────────────────────
    // Devuelve un objeto con las clases de Tailwind para cada estado
    // de pago. Útil para badges, bordes y fondos.
    //
    // @param {string} estado – 'PENDIENTE'|'PAGADO'|'VENCIDO'|'REPORTADO'
    // @returns {{ bg, border, text, dot, label, icon, bgSoft }}
    // ──────────────────────────────────────────────────────────────
    function colorPorEstado(estado) {
        const estilos = {
            PENDIENTE: {
                bg:     'bg-amber-100',
                bgSoft: 'bg-amber-50',
                border: 'border-amber-200',
                text:   'text-amber-700',
                dot:    'bg-amber-500',
                label:  'Pendiente',
                icon:   'fa-clock',
            },
            PAGADO: {
                bg:     'bg-green-100',
                bgSoft: 'bg-green-50',
                border: 'border-green-200',
                text:   'text-green-700',
                dot:    'bg-green-500',
                label:  'Pagado',
                icon:   'fa-circle-check',
            },
            VENCIDO: {
                bg:     'bg-red-100',
                bgSoft: 'bg-red-50',
                border: 'border-red-200',
                text:   'text-red-700',
                dot:    'bg-red-500',
                label:  'Vencido',
                icon:   'fa-triangle-exclamation',
            },
            REPORTADO: {
                bg:     'bg-blue-100',
                bgSoft: 'bg-blue-50',
                border: 'border-blue-200',
                text:   'text-blue-700',
                dot:    'bg-blue-500',
                label:  'Reportado',
                icon:   'fa-paper-plane',
            },
        };

        return estilos[estado] || estilos.PENDIENTE;
    }

    // ──────────────────────────────────────────────────────────────
    // iconoEstado(estado)
    // ──────────────────────────────────────────────────────────────
    // Devuelve la clase FontAwesome del ícono para el estado.
    // ──────────────────────────────────────────────────────────────
    function iconoEstado(estado) {
        return colorPorEstado(estado).icon;
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers de formato generales
    // ──────────────────────────────────────────────────────────────
    function fmtFecha(d) {
        if (!d) return '—';
        return new Date(d + (d.length === 10 ? 'T00:00:00' : ''))
            .toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function fmtMoney(v) {
        if (v === null || v === undefined) return '—';
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
            maximumFractionDigits: 0,
        }).format(v);
    }

    function nombreMes(mes) {
        const nombres = [
            '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        return nombres[mes] || `Mes ${mes}`;
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers privados
    // ──────────────────────────────────────────────────────────────
    function _formatoISO(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // ── API pública ───────────────────────────────────────────────
    return {
        obtenerMatrizMes,
        agruparPagosPorFecha,
        formatearPeriodo,
        colorPorEstado,
        iconoEstado,
        fmtFecha,
        fmtMoney,
        nombreMes,
    };

})();

window.CALENDARIO_HELPER = CALENDARIO_HELPER;