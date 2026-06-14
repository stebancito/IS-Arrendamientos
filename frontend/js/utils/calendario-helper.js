// ================================================================
// utils/calendario-helper.js  –  Utilidades puras para el calendario de pagos
// ================================================================

const CALENDARIO_HELPER = (() => {

    function obtenerMatrizMes(anio, mes) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        const primerDia = new Date(anio, mes - 1, 1);
        const ultimoDia = new Date(anio, mes, 0);
        const diaInicio = (primerDia.getDay() + 6) % 7;
        const totalDias = ultimoDia.getDate();

        const matriz = [];
        let diaActual = 1 - diaInicio;

        for (let semana = 0; semana < 6; semana++) {
            const fila = [];
            for (let col = 0; col < 7; col++) {
                const fechaObj = new Date(anio, mes - 1, diaActual);
                const esMesActual = diaActual >= 1 && diaActual <= totalDias;
                const esHoy = fechaObj.getTime() === hoy.getTime();

                fila.push({
                    dia: fechaObj.getDate(),
                    fecha: _formatoISO(fechaObj),
                    esMesActual,
                    esHoy,
                    fechaObj
                });

                diaActual++;
            }
            matriz.push(fila);
        }
        return matriz;
    }

    function agruparPagosPorFecha(pagos) {
        const mapa = new Map();
        (pagos || []).forEach(p => {
            const fecha = (p.fecha_limite || '').slice(0, 10);
            if (!fecha) return;
            if (!mapa.has(fecha)) mapa.set(fecha, []);
            mapa.get(fecha).push(p);
        });
        return mapa;
    }

    function formatearPeriodo(pago) {
        if (!pago) return '—';

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

        if (pago.anio && pago.mes) {
            const nombre = nombreMes(pago.mes);
            return `${nombre} ${pago.anio}`;
        }

        if (pago.fecha_limite) {
            return fmtFecha(pago.fecha_limite);
        }

        return '—';
    }

    // ──────────────────────────────────────────────────────────────
    // 🎨 INTEGRACIÓN PALETA DESIGN SYSTEM
    // ──────────────────────────────────────────────────────────────
    function colorPorEstado(estado) {
        const estilos = {
            PENDIENTE: {
                bg:     'bg-[#FFFBEB]',
                bgSoft: 'bg-[#FFFBEB]',
                border: 'border-[#FFE788]',
                text:   'text-[#13243E]',
                dot:    'bg-[#FFC533]',
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
                bg:     'bg-[#5A97D6]/15',
                bgSoft: 'bg-[#5A97D6]/10',
                border: 'border-[#5A97D6]/30',
                text:   'text-[#255FA4]',
                dot:    'bg-[#255FA4]',
                label:  'Reportado',
                icon:   'fa-paper-plane',
            },
        };

        return estilos[estado] || estilos.PENDIENTE;
    }

    function iconoEstado(estado) {
        return colorPorEstado(estado).icon;
    }

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

    function _formatoISO(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

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