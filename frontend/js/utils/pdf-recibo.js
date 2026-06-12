// ================================================================
// utils/pdf-recibo.js  –  Comprobante de pago (recibo) en PDF
// ================================================================
// Genera un recibo de un pago validado, reutilizando la identidad
// visual de pdf-contrato.js. Requiere jsPDF cargado por CDN:
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
//
// API:
//   PDF_RECIBO.descargar(data, nombreArchivo?)
//
// `data` es un objeto tolerante a campos faltantes:
// {
//   folio,                // p.ej. calendario_id o pago_id
//   propiedad,            // nombre de la propiedad
//   inquilino,            // nombre del inquilino
//   arrendador,           // nombre del arrendador (opcional)
//   periodo,              // texto del periodo de cobertura
//   monto_esperado,
//   monto_recibido,
//   metodo,               // 'EFECTIVO' | 'TRANSFERENCIA' | ...
//   referencia,
//   fecha_pago,           // 'YYYY-MM-DD'
//   estado,               // 'PAGADO' (se asume validado)
// }
// ================================================================

const PDF_RECIBO = (() => {

    const COLOR_PRIMARY = '#0f2557';
    const COLOR_ACCENT  = '#16a34a'; // verde "pagado"
    const COLOR_TEXT    = '#1f2937';
    const COLOR_MUTED   = '#64748b';
    const COLOR_DIVIDER = '#e2e8f0';
    const COLOR_SOFT    = '#f1f5f9';

    const METODO_LABEL = {
        TRANSFERENCIA: 'Transferencia bancaria', EFECTIVO: 'Efectivo',
        DEPOSITO: 'Depósito bancario', TARJETA: 'Tarjeta', OTRO: 'Otro',
    };

    const fmtFecha = (d) => {
        if (!d) return '-';
        return new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''))
            .toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    const fmtMoneda = (v) => {
        if (v === null || v === undefined || v === '') return '-';
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
        }).format(v);
    };

    // jsPDF usa codificación Latin-1 con la fuente estándar: caracteres
    // Unicode como la flecha "→" o los guiones largos se imprimen como
    // basura. Los sustituimos por equivalentes ASCII antes de dibujar.
    const _txt = (s) => String(s ?? '')
        .replace(/→/g, '-')        // → (separador de periodo)
        .replace(/[–—]/g, '-') // – —
        .replace(/[‘’]/g, "'") // ' '
        .replace(/[“”]/g, '"'); // " "

    function generar(d) {
        if (typeof window.jspdf === 'undefined') {
            throw new Error('jsPDF no está cargado. Incluye el script de jsPDF por CDN.');
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });

        const pageW = doc.internal.pageSize.getWidth();
        const marginX = 20;
        const folio = `REC-${String(d.folio ?? 0).padStart(6, '0')}`;

        // ── Banda superior ──
        doc.setFillColor(COLOR_PRIMARY);
        doc.rect(0, 0, pageW, 14, 'F');
        doc.setTextColor('#ffffff');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('ARRENDAMIENTOS APP · Plataforma de Gestión', marginX, 9);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Emitido el ${fmtFecha(new Date().toISOString().slice(0, 10))}`, pageW - marginX, 9, { align: 'right' });

        // ── Título + folio + sello PAGADO ──
        let y = 30;
        doc.setTextColor(COLOR_PRIMARY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.text('COMPROBANTE DE PAGO', marginX, y);

        y += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_MUTED);
        doc.text(`Folio: ${folio}`, marginX, y);

        // Sello "PAGADO" a la derecha
        doc.setDrawColor(COLOR_ACCENT);
        doc.setLineWidth(0.8);
        doc.roundedRect(pageW - marginX - 42, 22, 42, 13, 2, 2, 'S');
        doc.setTextColor(COLOR_ACCENT);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('PAGADO', pageW - marginX - 21, 30.5, { align: 'center' });

        y += 5;
        doc.setDrawColor(COLOR_DIVIDER);
        doc.setLineWidth(0.4);
        doc.line(marginX, y, pageW - marginX, y);
        y += 10;

        // ── Monto destacado ──
        doc.setFillColor(COLOR_SOFT);
        doc.roundedRect(marginX, y, pageW - marginX * 2, 22, 3, 3, 'F');
        doc.setTextColor(COLOR_MUTED);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('MONTO RECIBIDO', marginX + 6, y + 8);
        doc.setTextColor(COLOR_PRIMARY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text(fmtMoneda(d.monto_recibido ?? d.monto_esperado), marginX + 6, y + 17);
        doc.setTextColor(COLOR_MUTED);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Fecha de pago: ${fmtFecha(d.fecha_pago)}`, pageW - marginX - 6, y + 17, { align: 'right' });
        y += 32;

        // ── Tabla de detalle ──
        const filas = [
            ['Inquilino', d.inquilino || '—'],
            ['Propiedad', d.propiedad || '—'],
            ['Periodo', d.periodo || '—'],
            ['Método de pago', METODO_LABEL[d.metodo] || d.metodo || '—'],
            ['Referencia', d.referencia || 'Sin referencia'],
            ['Monto esperado', fmtMoneda(d.monto_esperado)],
            ['Monto recibido', fmtMoneda(d.monto_recibido ?? d.monto_esperado)],
        ];
        if (d.arrendador) filas.splice(2, 0, ['Arrendador', d.arrendador]);

        doc.setFontSize(11);
        filas.forEach((f, i) => {
            if (i % 2 === 0) {
                doc.setFillColor('#f8fafc');
                doc.rect(marginX, y - 5, pageW - marginX * 2, 9, 'F');
            }
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(COLOR_MUTED);
            doc.text(_txt(f[0]), marginX + 3, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(COLOR_TEXT);
            doc.text(_txt(f[1]), pageW - marginX - 3, y, { align: 'right' });
            y += 9;
        });

        // Diferencia si el monto recibido != esperado
        const rec = d.monto_recibido;
        if (rec != null && d.monto_esperado != null && Math.abs(rec - d.monto_esperado) > 0.01) {
            y += 2;
            const diff = rec - d.monto_esperado;
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9);
            doc.setTextColor(COLOR_MUTED);
            doc.text(`Nota: el monto recibido difiere del esperado en ${fmtMoneda(Math.abs(diff))} (${diff < 0 ? 'de menos' : 'de más'}).`,
                marginX + 3, y);
            y += 6;
        }

        // ── Sello de validación ──
        y += 8;
        doc.setDrawColor(COLOR_DIVIDER);
        doc.setLineWidth(0.3);
        doc.line(marginX, y, pageW - marginX, y);
        y += 8;
        // Checkmark vectorial (la fuente estándar de jsPDF no tiene el glifo ✓)
        doc.setDrawColor(COLOR_ACCENT);
        doc.setLineWidth(0.6);
        doc.line(marginX, y - 1.4, marginX + 1.4, y);
        doc.line(marginX + 1.4, y, marginX + 3.4, y - 3.4);
        doc.setTextColor(COLOR_ACCENT);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Pago validado por el arrendador', marginX + 5.5, y);
        y += 6;
        doc.setTextColor(COLOR_MUTED);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Este comprobante certifica el registro del pago en la plataforma.', marginX, y);

        // ── Footer ──
        const footerY = doc.internal.pageSize.getHeight() - 10;
        doc.setDrawColor(COLOR_DIVIDER);
        doc.setLineWidth(0.2);
        doc.line(marginX, footerY - 4, pageW - marginX, footerY - 4);
        doc.setTextColor(COLOR_MUTED);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.text(
            'Comprobante de simulación generado por Arrendamientos App (proyecto académico). Sin validez fiscal.',
            pageW / 2, footerY, { align: 'center' }
        );

        return doc;
    }

    function descargar(data, nombreArchivo) {
        try {
            const doc = generar(data);
            const fname = nombreArchivo || `Recibo-${String(data.folio ?? 0).padStart(6, '0')}.pdf`;
            doc.save(fname);
            return true;
        } catch (err) {
            console.error('[PDF_RECIBO] Error al generar recibo:', err);
            if (window.TOAST) TOAST.error('No se pudo generar el recibo: ' + (err.message || ''));
            return false;
        }
    }

    return { generar, descargar };
})();

window.PDF_RECIBO = PDF_RECIBO;
