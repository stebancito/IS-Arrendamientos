// ================================================================
// utils/pdf-contrato.js  –  Generador de PDF del contrato
// ================================================================
// Genera un documento de arrendamiento usando jsPDF (cargado por CDN
// en las páginas que lo necesiten):
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
//
// API:
//   PDF_CONTRATO.generar(contratoDetallado)
//   PDF_CONTRATO.descargar(contratoDetallado, nombreArchivo?)
//
// El objeto contratoDetallado debe tener forma:
// {
//     contrato_id, fecha_inicio, fecha_fin, monto_renta, frecuencia_pago,
//     estado, observaciones, beneficios, aceptado_en, fecha_terminacion,
//     motivo_terminacion,
//     propiedades: { nombre, direccion, tipo_propiedad, descripcion, ... },
//     inquilinos:  { usuarios: { nombre_completo, correo, telefono }, ... },
//     arrendador:  { nombre_completo, correo, telefono }
// }
// ================================================================

const PDF_CONTRATO = (() => {

    // ─── Paleta corporativa (replica de custom.css) ────────────
    const COLOR_PRIMARY    = '#0f2557'; // Navy 800
    const COLOR_ACCENT     = '#3b82f6'; // Brand blue
    const COLOR_TEXT       = '#1f2937';
    const COLOR_MUTED      = '#64748b';
    const COLOR_DIVIDER    = '#e2e8f0';

    // ─── Helpers de formato ────────────────────────────────────
    const fmtFecha = (d) => {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('es-MX', {
            day: '2-digit', month: 'long', year: 'numeric'
        });
    };

    const fmtMoneda = (v) => {
        if (v === null || v === undefined) return '—';
        return new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN', minimumFractionDigits: 2
        }).format(v);
    };

    const fmtMontoEnLetra = (v) => {
        // Pequeño helper informativo (no formal). Para uso meramente visual.
        return fmtMoneda(v) + ' M.N.';
    };

    const frecuenciaLabel = (f) => {
        return { MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal' }[f] || f;
    };

    const tipoLabel = (t) => {
        return {
            EDIFICIO: 'Edificio', DEPARTAMENTO: 'Departamento',
            CASA: 'Casa', LOCAL: 'Local Comercial', TERRENO: 'Terreno'
        }[t] || t;
    };

    // ─── Renderizar texto con auto-wrap y control de salto de página ────
    function _writeText(doc, text, x, y, opts = {}) {
        const maxWidth = opts.maxWidth || 170;
        const size     = opts.size || 11;
        const style    = opts.style || 'normal';
        const color    = opts.color || COLOR_TEXT;

        doc.setFont('helvetica', style);
        doc.setFontSize(size);
        doc.setTextColor(color);

        const lines = doc.splitTextToSize(text, maxWidth);
        doc.text(lines, x, y);
        // Devolver la nueva Y luego de escribir
        return y + (lines.length * size * 0.4);
    }

    // ─── Función principal de generación ────────────────────────
    function generar(c) {
        // jsPDF se expone como window.jspdf.jsPDF cuando se carga la UMD
        if (typeof window.jspdf === 'undefined') {
            throw new Error('jsPDF no está cargado. Incluye el script de jsPDF por CDN antes de invocar PDF_CONTRATO.');
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const marginX = 20;
        let y = 22;

        // ╔══════════════ ENCABEZADO ══════════════╗
        // Banda azul superior
        doc.setFillColor(COLOR_PRIMARY);
        doc.rect(0, 0, pageW, 14, 'F');
        doc.setTextColor('#ffffff');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('ARRENDAMIENTOS APP · Plataforma de Gestión', marginX, 9);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text(`Documento generado el ${fmtFecha(new Date())}`, pageW - marginX, 9, { align: 'right' });

        // Título principal
        y = 28;
        doc.setTextColor(COLOR_PRIMARY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text('CONTRATO DE ARRENDAMIENTO', marginX, y);

        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_MUTED);
        doc.text(`Folio: ARR-${String(c.contrato_id).padStart(6, '0')}`, marginX, y);

        // Separador
        y += 5;
        doc.setDrawColor(COLOR_DIVIDER);
        doc.setLineWidth(0.4);
        doc.line(marginX, y, pageW - marginX, y);
        y += 8;

        // ╔══════════════ PROEMIO ══════════════╗
        const arrend = c.arrendador || {};
        const inqUser = c.inquilinos?.usuarios || {};
        const prop = c.propiedades || {};

        const proemio = `En la Ciudad de México, a los ${fmtFecha(c.aceptado_en || c.fecha_inicio)}, comparecen por una parte ${arrend.nombre_completo || '[Arrendador]'} en su carácter de ARRENDADOR, y por la otra ${inqUser.nombre_completo || '[Inquilino]'} en su carácter de ARRENDATARIO, quienes celebran el presente CONTRATO DE ARRENDAMIENTO sujetándose a las siguientes cláusulas y declaraciones.`;
        y = _writeText(doc, proemio, marginX, y, { maxWidth: pageW - marginX * 2, size: 10 });
        y += 6;

        // ╔══════════════ DECLARACIONES (partes) ══════════════╗
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(COLOR_PRIMARY);
        doc.text('I. DECLARACIONES DE LAS PARTES', marginX, y);
        y += 6;

        // Bloque arrendador
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_TEXT);
        doc.text('Arrendador', marginX, y); y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(`Nombre:  ${arrend.nombre_completo || '—'}`, marginX, y); y += 5;
        doc.text(`Correo:  ${arrend.correo || '—'}`,           marginX, y); y += 5;
        doc.text(`Teléfono: ${arrend.telefono || '—'}`,         marginX, y); y += 7;

        // Bloque inquilino
        doc.setFont('helvetica', 'bold');
        doc.text('Arrendatario', marginX, y); y += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(`Nombre:  ${inqUser.nombre_completo || '—'}`, marginX, y); y += 5;
        doc.text(`Correo:  ${inqUser.correo || '—'}`,           marginX, y); y += 5;
        doc.text(`Teléfono: ${inqUser.telefono || '—'}`,         marginX, y); y += 8;

        // ╔══════════════ INMUEBLE ══════════════╗
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(COLOR_PRIMARY);
        doc.text('II. DESCRIPCIÓN DEL INMUEBLE', marginX, y);
        y += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(COLOR_TEXT);
        doc.text(`Tipo:       ${tipoLabel(prop.tipo_propiedad)}`, marginX, y); y += 5;
        doc.text(`Nombre:    ${prop.nombre || '—'}`,               marginX, y); y += 5;
        y = _writeText(doc, `Dirección: ${prop.direccion || '—'}`, marginX, y, {
            maxWidth: pageW - marginX * 2, size: 10
        });
        y += 2;

        if (prop.descripcion) {
            y = _writeText(doc, `Beneficios del inmueble: ${prop.descripcion}`, marginX, y, {
                maxWidth: pageW - marginX * 2, size: 9, color: COLOR_MUTED
            });
            y += 4;
        }
        y += 4;

        // ╔══════════════ CLÁUSULAS ══════════════╗
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(COLOR_PRIMARY);
        doc.text('III. CLÁUSULAS', marginX, y);
        y += 7;

        const clausulas = [
            {
                titulo: 'PRIMERA. Objeto del contrato',
                texto:  `El ARRENDADOR da en arrendamiento al ARRENDATARIO el inmueble descrito en la sección II, y éste lo recibe en las condiciones en que se encuentra para destinarlo única y exclusivamente a uso habitacional, comercial o aquel que su naturaleza permita.`
            },
            {
                titulo: 'SEGUNDA. Vigencia',
                texto:  `La vigencia del presente contrato inicia el ${fmtFecha(c.fecha_inicio)} y concluye de manera natural el ${fmtFecha(c.fecha_fin)}.`
            },
            {
                titulo: 'TERCERA. Renta y forma de pago',
                texto:  `El ARRENDATARIO se obliga a pagar al ARRENDADOR la cantidad de ${fmtMontoEnLetra(c.monto_renta)} con periodicidad ${frecuenciaLabel(c.frecuencia_pago).toLowerCase()}. El pago deberá realizarse dentro de los primeros cinco (5) días naturales del periodo correspondiente.`
            },
            {
                titulo: 'CUARTA. Mora y vencimiento',
                texto:  `En caso de que el ARRENDATARIO no realice el pago en la fecha límite, el sistema marcará automáticamente el adeudo como vencido a las 00:00 horas del día siguiente y se generará el registro respectivo en el historial financiero.`
            },
            {
                titulo: 'QUINTA. Mantenimiento e incidencias',
                texto:  `El ARRENDATARIO podrá reportar incidencias o requerimientos de mantenimiento a través de la plataforma. El ARRENDADOR se obliga a darles seguimiento dentro de un plazo razonable.`
            },
            {
                titulo: 'SEXTA. Terminación anticipada',
                texto:  `Cualquiera de las partes podrá dar por terminado el presente contrato de manera anticipada notificando con al menos una (1) semana de anticipación e indicando el motivo correspondiente. Los pagos previamente registrados permanecerán como parte del historial financiero del ARRENDATARIO.`
            },
            {
                titulo: 'SÉPTIMA. Naturaleza simulada de los pagos',
                texto:  `Las partes reconocen que la plataforma opera bajo una lógica de "simulación de registro" y que no realiza transferencias bancarias ni cobros reales; los registros de pago son a efectos de control y trazabilidad.`
            },
            {
                titulo: 'OCTAVA. Conformidad',
                texto:  `Las partes manifiestan que han leído, comprendido y aceptado el contenido del presente contrato, así como los beneficios y observaciones particulares que se detallan al pie del documento.`
            }
        ];

        // Si nos quedamos sin espacio en la primera página, hacemos salto
        for (const cl of clausulas) {
            if (y > pageH - 50) {
                doc.addPage();
                y = 25;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(COLOR_PRIMARY);
            doc.text(cl.titulo, marginX, y);
            y += 5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(COLOR_TEXT);
            y = _writeText(doc, cl.texto, marginX, y, { maxWidth: pageW - marginX * 2, size: 10 });
            y += 4;
        }

        // ╔══════════════ BENEFICIOS / OBSERVACIONES ══════════════╗
        if (c.beneficios || c.observaciones) {
            if (y > pageH - 55) { doc.addPage(); y = 25; }
            y += 2;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(COLOR_PRIMARY);
            doc.text('IV. BENEFICIOS Y OBSERVACIONES', marginX, y);
            y += 6;

            if (c.beneficios) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(COLOR_TEXT);
                doc.text('Beneficios incluidos:', marginX, y);
                y += 5;
                doc.setFont('helvetica', 'normal');
                y = _writeText(doc, c.beneficios, marginX, y, { maxWidth: pageW - marginX * 2, size: 10 });
                y += 3;
            }

            if (c.observaciones) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(COLOR_TEXT);
                doc.text('Observaciones particulares:', marginX, y);
                y += 5;
                doc.setFont('helvetica', 'normal');
                y = _writeText(doc, c.observaciones, marginX, y, { maxWidth: pageW - marginX * 2, size: 10 });
                y += 3;
            }
        }

        // ╔══════════════ FIRMAS (simuladas) ══════════════╗
        // Asegurar espacio suficiente
        if (y > pageH - 55) { doc.addPage(); y = 25; }
        y = Math.max(y + 10, pageH - 55);

        doc.setDrawColor(COLOR_TEXT);
        doc.setLineWidth(0.3);

        // Línea izquierda — Arrendador
        const lineY = y + 12;
        doc.line(marginX, lineY, marginX + 70, lineY);
        // Línea derecha — Inquilino
        doc.line(pageW - marginX - 70, lineY, pageW - marginX, lineY);

        // Etiquetas debajo de las líneas
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(COLOR_PRIMARY);
        doc.text('ARRENDADOR', marginX + 35, lineY + 5, { align: 'center' });
        doc.text('ARRENDATARIO', pageW - marginX - 35, lineY + 5, { align: 'center' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(COLOR_MUTED);
        doc.text(arrend.nombre_completo || '—',  marginX + 35, lineY + 10, { align: 'center' });
        doc.text(inqUser.nombre_completo || '—', pageW - marginX - 35, lineY + 10, { align: 'center' });

        // Sello digital simulado encima de las líneas
        if (c.aceptado_en) {
            doc.setTextColor(COLOR_ACCENT);
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(11);
            doc.text(`✓ Firma digital — ${arrend.nombre_completo || ''}`,
                     marginX + 35, lineY - 3, { align: 'center' });
            doc.text(`✓ Firma digital — ${inqUser.nombre_completo || ''}`,
                     pageW - marginX - 35, lineY - 3, { align: 'center' });
        }

        // Footer común
        const footerY = pageH - 10;
        doc.setDrawColor(COLOR_DIVIDER);
        doc.setLineWidth(0.2);
        doc.line(marginX, footerY - 4, pageW - marginX, footerY - 4);

        doc.setTextColor(COLOR_MUTED);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.text(
            'Documento de simulación generado por Arrendamientos App (proyecto académico). Sin validez legal criptográfica.',
            pageW / 2, footerY, { align: 'center' }
        );

        return doc;
    }

    // ─── Descargar como archivo ───────────────────────────────
    function descargar(c, nombreArchivo) {
        try {
            const doc = generar(c);
            const fname = nombreArchivo || `Contrato-${String(c.contrato_id).padStart(6, '0')}.pdf`;
            doc.save(fname);
            return true;
        } catch (err) {
            console.error('[PDF_CONTRATO] Error al generar PDF:', err);
            if (window.TOAST) TOAST.error('No se pudo generar el PDF: ' + (err.message || ''));
            return false;
        }
    }

    return { generar, descargar };
})();

window.PDF_CONTRATO = PDF_CONTRATO;