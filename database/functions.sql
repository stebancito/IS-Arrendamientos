-- ======================================================
-- FUNCIONES RPC, VISTAS Y TRIGGERS DE NEGOCIO
-- Ejecutar después de schema.sql
-- ======================================================


-- ======================================================
-- 1. VISTA: Comportamiento financiero del inquilino
-- ======================================================
CREATE OR REPLACE VIEW comportamiento_inquilino AS
SELECT
    i.inquilino_id,
    u.usuario_id,
    u.nombre_completo,
    u.correo,
    COUNT(cp.calendario_id) AS pagos_totales,
    COUNT(*) FILTER (WHERE cp.estado = 'PAGADO')    AS pagos_realizados,
    COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO')   AS pagos_vencidos,
    COUNT(*) FILTER (WHERE cp.estado = 'PENDIENTE') AS pagos_pendientes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE cp.estado = 'PAGADO')
        / NULLIF(COUNT(cp.calendario_id), 0),
        2
    ) AS porcentaje_cumplimiento,
    CASE
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') = 0
             AND COUNT(*) FILTER (WHERE cp.estado = 'PAGADO') > 0 THEN 'EXCELENTE'
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') <= 1 THEN 'BUENO'
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') <= 3 THEN 'REGULAR'
        ELSE 'MALO'
    END AS calificacion
FROM inquilinos i
JOIN usuarios u ON u.usuario_id = i.usuario_id
LEFT JOIN contratos c ON c.inquilino_id = i.inquilino_id
LEFT JOIN calendario_pagos cp ON cp.contrato_id = c.contrato_id
GROUP BY i.inquilino_id, u.usuario_id, u.nombre_completo, u.correo;


-- ======================================================
-- 2. VISTA: Ingresos mensuales por arrendador
-- ======================================================
CREATE OR REPLACE VIEW ingresos_mensuales_arrendador AS
SELECT
    p.duenio_id AS arrendador_id,
    cp.anio,
    cp.mes,
    COALESCE(SUM(cp.monto_esperado) FILTER (WHERE cp.estado = 'PAGADO'), 0)    AS ingresos_recibidos,
    COALESCE(SUM(cp.monto_esperado) FILTER (WHERE cp.estado = 'PENDIENTE'), 0) AS ingresos_pendientes,
    COALESCE(SUM(cp.monto_esperado) FILTER (WHERE cp.estado = 'VENCIDO'), 0)   AS ingresos_vencidos,
    COALESCE(SUM(cp.monto_esperado), 0) AS ingresos_esperados
FROM calendario_pagos cp
JOIN contratos c   ON c.contrato_id   = cp.contrato_id
JOIN propiedades p ON p.propiedad_id  = c.propiedad_id
GROUP BY p.duenio_id, cp.anio, cp.mes
ORDER BY cp.anio, cp.mes;


-- ======================================================
-- 3. RPC: Resumen financiero para el dashboard
-- ======================================================
-- La firma de retorno cambió (se agregó pagos_pagados), por eso hay que
-- eliminar la versión anterior antes de recrearla.
DROP FUNCTION IF EXISTS obtener_resumen_financiero(BIGINT);
CREATE OR REPLACE FUNCTION obtener_resumen_financiero(p_arrendador_id BIGINT)
RETURNS TABLE (
    total_propiedades        BIGINT,
    total_contratos_activos  BIGINT,
    ingresos_mes_actual      NUMERIC,
    pagos_pendientes         BIGINT,
    pagos_vencidos           BIGINT,
    monto_vencido            NUMERIC,
    pagos_pagados            BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM propiedades
            WHERE duenio_id = p_arrendador_id AND activa)::BIGINT,
        (SELECT COUNT(*) FROM contratos c
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id AND c.estado = 'ACTIVO')::BIGINT,
        COALESCE((
            SELECT SUM(cp.monto_esperado) FROM calendario_pagos cp
            JOIN contratos c   ON c.contrato_id  = cp.contrato_id
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id
              AND cp.estado = 'PAGADO'
              AND cp.anio = EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT
              AND cp.mes  = EXTRACT(MONTH FROM CURRENT_DATE)::SMALLINT
        ), 0),
        (SELECT COUNT(*) FROM calendario_pagos cp
            JOIN contratos c   ON c.contrato_id  = cp.contrato_id
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id AND cp.estado = 'PENDIENTE')::BIGINT,
        (SELECT COUNT(*) FROM calendario_pagos cp
            JOIN contratos c   ON c.contrato_id  = cp.contrato_id
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id AND cp.estado = 'VENCIDO')::BIGINT,
        COALESCE((
            SELECT SUM(cp.monto_esperado) FROM calendario_pagos cp
            JOIN contratos c   ON c.contrato_id  = cp.contrato_id
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id AND cp.estado = 'VENCIDO'
        ), 0),
        (SELECT COUNT(*) FROM calendario_pagos cp
            JOIN contratos c   ON c.contrato_id  = cp.contrato_id
            JOIN propiedades p ON p.propiedad_id = c.propiedad_id
            WHERE p.duenio_id = p_arrendador_id AND cp.estado = 'PAGADO')::BIGINT;
END;
$$;


-- ======================================================
-- 4. RPC: Generar calendario de pagos para un contrato
--     Llamado por trigger al crear un contrato ACTIVO.
-- ======================================================
CREATE OR REPLACE FUNCTION generar_calendario_pagos(p_contrato_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_contrato  contratos%ROWTYPE;
    v_fecha     DATE;
    v_intervalo INTERVAL;
    v_count     INTEGER := 0;
BEGIN
    SELECT * INTO v_contrato FROM contratos WHERE contrato_id = p_contrato_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contrato % no existe', p_contrato_id;
    END IF;

    v_intervalo := CASE v_contrato.frecuencia_pago
        WHEN 'MENSUAL'   THEN INTERVAL '1 month'
        WHEN 'QUINCENAL' THEN INTERVAL '15 days'
        WHEN 'SEMANAL'   THEN INTERVAL '7 days'
    END;

    v_fecha := v_contrato.fecha_inicio;
    WHILE v_fecha <= v_contrato.fecha_fin LOOP
        INSERT INTO calendario_pagos (
            contrato_id, fecha_limite, monto_esperado, anio, mes
        ) VALUES (
            p_contrato_id,
            v_fecha,
            v_contrato.monto_renta,
            EXTRACT(YEAR  FROM v_fecha)::SMALLINT,
            EXTRACT(MONTH FROM v_fecha)::SMALLINT
        )
        ON CONFLICT (contrato_id, anio, mes) DO NOTHING;

        v_count := v_count + 1;
        v_fecha := v_fecha + v_intervalo;
    END LOOP;

    RETURN v_count;
END;
$$;


-- Trigger: al crear contrato ACTIVO, generar su calendario automáticamente.
CREATE OR REPLACE FUNCTION trigger_generar_calendario()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.estado = 'ACTIVO' THEN
        PERFORM generar_calendario_pagos(NEW.contrato_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_contratos_calendario ON contratos;
CREATE TRIGGER trigger_contratos_calendario
    AFTER INSERT ON contratos
    FOR EACH ROW EXECUTE FUNCTION trigger_generar_calendario();


-- ======================================================
-- 5. RPC: Notificar pagos próximos a vencer (3 días)
--     Llamar manualmente o desde cron de Supabase.
-- ======================================================
CREATE OR REPLACE FUNCTION notificar_pagos_proximos()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        SELECT cp.calendario_id, cp.fecha_limite, cp.monto_esperado, i.usuario_id
        FROM calendario_pagos cp
        JOIN contratos c  ON c.contrato_id  = cp.contrato_id
        JOIN inquilinos i ON i.inquilino_id = c.inquilino_id
        WHERE cp.estado = 'PENDIENTE'
          AND cp.fecha_limite BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
          AND NOT EXISTS (
              SELECT 1 FROM notificaciones n
              WHERE n.usuario_id = i.usuario_id
                AND n.tipo = 'PAGO_PROXIMO'
                AND n.metadatos->>'calendario_id' = cp.calendario_id::TEXT
          )
    LOOP
        INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo, metadatos)
        VALUES (
            r.usuario_id,
            'Pago próximo a vencer',
            'Tienes un pago de $' || r.monto_esperado || ' que vence el ' || r.fecha_limite,
            'PAGO_PROXIMO',
            jsonb_build_object('calendario_id', r.calendario_id, 'fecha_limite', r.fecha_limite)
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;


-- ======================================================
-- 6. RPC: Notificar pagos vencidos
-- ======================================================
CREATE OR REPLACE FUNCTION notificar_pagos_vencidos()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INTEGER := 0;
    r RECORD;
BEGIN
    -- Primero actualizar los estados
    PERFORM actualizar_pagos_vencidos();

    FOR r IN
        SELECT cp.calendario_id, cp.fecha_limite, cp.monto_esperado, i.usuario_id
        FROM calendario_pagos cp
        JOIN contratos c  ON c.contrato_id  = cp.contrato_id
        JOIN inquilinos i ON i.inquilino_id = c.inquilino_id
        WHERE cp.estado = 'VENCIDO'
          AND NOT EXISTS (
              SELECT 1 FROM notificaciones n
              WHERE n.usuario_id = i.usuario_id
                AND n.tipo = 'PAGO_VENCIDO'
                AND n.metadatos->>'calendario_id' = cp.calendario_id::TEXT
          )
    LOOP
        INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo, metadatos)
        VALUES (
            r.usuario_id,
            'Pago vencido',
            'Tu pago de $' || r.monto_esperado || ' venció el ' || r.fecha_limite,
            'PAGO_VENCIDO',
            jsonb_build_object('calendario_id', r.calendario_id)
        );
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;


-- ======================================================
-- 7. Trigger: notificar al inquilino cuando cambia el
--    estado de una incidencia
-- ======================================================
CREATE OR REPLACE FUNCTION trigger_notificar_incidencia()
RETURNS TRIGGER AS $$
DECLARE
    v_usuario_id BIGINT;
BEGIN
    IF NEW.estado <> OLD.estado THEN
        SELECT usuario_id INTO v_usuario_id
        FROM inquilinos WHERE inquilino_id = NEW.reportado_por_id;

        INSERT INTO notificaciones (usuario_id, titulo, mensaje, tipo, metadatos)
        VALUES (
            v_usuario_id,
            'Tu incidencia fue actualizada',
            'La incidencia "' || NEW.titulo || '" cambió a estado ' || NEW.estado,
            'INCIDENCIA_ACTUALIZADA',
            jsonb_build_object('incidencia_id', NEW.incidencia_id, 'estado', NEW.estado)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_incidencias_notificar ON incidencias;
CREATE TRIGGER trigger_incidencias_notificar
    AFTER UPDATE ON incidencias
    FOR EACH ROW EXECUTE FUNCTION trigger_notificar_incidencia();


-- ======================================================
-- 8. VISTA: Saldos consolidados por contrato (Dev 4)
--    Sumariza pagos esperados vs cobrados por contrato.
-- ======================================================
CREATE OR REPLACE VIEW saldos_contrato AS
SELECT
    c.contrato_id,
    c.propiedad_id,
    p.duenio_id,
    p.nombre AS propiedad_nombre,
    c.inquilino_id,
    u.nombre_completo AS inquilino_nombre,
    c.monto_renta,
    c.frecuencia_pago,
    c.estado AS contrato_estado,
    c.fecha_inicio,
    c.fecha_fin,
    COUNT(cp.calendario_id) AS total_periodos,
    COUNT(*) FILTER (WHERE cp.estado = 'PAGADO')    AS periodos_pagados,
    COUNT(*) FILTER (WHERE cp.estado = 'PENDIENTE') AS periodos_pendientes,
    COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO')   AS periodos_vencidos,
    COALESCE(SUM(cp.monto_esperado), 0) AS monto_total_esperado,
    COALESCE(SUM(cp.monto_esperado) FILTER (WHERE cp.estado = 'PAGADO'), 0) AS monto_pagado,
    COALESCE(SUM(cp.monto_esperado) FILTER (WHERE cp.estado IN ('PENDIENTE','VENCIDO')), 0) AS saldo_por_cobrar
FROM contratos c
JOIN propiedades p ON p.propiedad_id = c.propiedad_id
JOIN inquilinos  i ON i.inquilino_id = c.inquilino_id
JOIN usuarios    u ON u.usuario_id   = i.usuario_id
LEFT JOIN calendario_pagos cp ON cp.contrato_id = c.contrato_id
GROUP BY c.contrato_id, p.duenio_id, p.nombre, u.nombre_completo;


-- ======================================================
-- 9. VISTA: Cobranza pendiente con días de atraso (Dev 4)
--    Cada periodo no pagado, con cuántos días de atraso
--    lleva y su clasificación de gravedad.
-- ======================================================
CREATE OR REPLACE VIEW cobranza_pendiente AS
SELECT
    cp.calendario_id,
    cp.contrato_id,
    c.propiedad_id,
    p.duenio_id,
    p.nombre AS propiedad_nombre,
    c.inquilino_id,
    u.usuario_id AS inquilino_usuario_id,
    u.nombre_completo AS inquilino_nombre,
    u.correo AS inquilino_correo,
    u.telefono AS inquilino_telefono,
    cp.anio,
    cp.mes,
    cp.fecha_limite,
    cp.monto_esperado,
    cp.estado,
    GREATEST(0, (CURRENT_DATE - cp.fecha_limite))::INT AS dias_atraso,
    CASE
        WHEN cp.fecha_limite >= CURRENT_DATE          THEN 'AL_DIA'
        WHEN CURRENT_DATE - cp.fecha_limite <= 7      THEN 'ATRASO_LEVE'
        WHEN CURRENT_DATE - cp.fecha_limite <= 30     THEN 'ATRASO_MODERADO'
        ELSE                                               'ATRASO_GRAVE'
    END AS gravedad
FROM calendario_pagos cp
JOIN contratos    c ON c.contrato_id  = cp.contrato_id
JOIN propiedades  p ON p.propiedad_id = c.propiedad_id
JOIN inquilinos   i ON i.inquilino_id = c.inquilino_id
JOIN usuarios     u ON u.usuario_id   = i.usuario_id
WHERE cp.estado IN ('PENDIENTE', 'VENCIDO');


-- ======================================================
-- 10. RPC: Simular calendario (Dev 4)
--    Devuelve filas SIN insertarlas. Útil para preview
--    desde el frontend antes de crear el contrato.
-- ======================================================
CREATE OR REPLACE FUNCTION simular_calendario_pagos(
    p_fecha_inicio DATE,
    p_fecha_fin    DATE,
    p_monto        NUMERIC,
    p_frecuencia   frecuencia_enum
)
RETURNS TABLE (
    numero_periodo INTEGER,
    fecha_limite   DATE,
    anio           SMALLINT,
    mes            SMALLINT,
    monto_esperado NUMERIC
)
LANGUAGE plpgsql AS $$
DECLARE
    v_intervalo INTERVAL;
    v_fecha     DATE;
    v_n         INTEGER := 0;
BEGIN
    v_intervalo := CASE p_frecuencia
        WHEN 'MENSUAL'   THEN INTERVAL '1 month'
        WHEN 'QUINCENAL' THEN INTERVAL '15 days'
        WHEN 'SEMANAL'   THEN INTERVAL '7 days'
    END;
    v_fecha := p_fecha_inicio;
    WHILE v_fecha <= p_fecha_fin LOOP
        v_n := v_n + 1;
        RETURN QUERY SELECT
            v_n,
            v_fecha,
            EXTRACT(YEAR  FROM v_fecha)::SMALLINT,
            EXTRACT(MONTH FROM v_fecha)::SMALLINT,
            p_monto;
        v_fecha := v_fecha + v_intervalo;
    END LOOP;
    RETURN;
END;
$$;


-- ======================================================
-- 11. VISTA: Comportamiento del inquilino POR arrendador
--    Igual que comportamiento_inquilino, pero acotado al
--    dueño de las propiedades (un mismo inquilino puede
--    rentarle a varios arrendadores). Se filtra por
--    duenio_id desde el frontend para que cada arrendador
--    solo vea a SUS inquilinos.
-- ======================================================
CREATE OR REPLACE VIEW comportamiento_inquilino_por_arrendador AS
SELECT
    p.duenio_id,
    i.inquilino_id,
    u.usuario_id,
    u.nombre_completo,
    u.correo,
    COUNT(cp.calendario_id) AS pagos_totales,
    COUNT(*) FILTER (WHERE cp.estado = 'PAGADO')    AS pagos_realizados,
    COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO')   AS pagos_vencidos,
    COUNT(*) FILTER (WHERE cp.estado = 'PENDIENTE') AS pagos_pendientes,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE cp.estado = 'PAGADO')
        / NULLIF(COUNT(cp.calendario_id), 0),
        2
    ) AS porcentaje_cumplimiento,
    CASE
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') = 0
             AND COUNT(*) FILTER (WHERE cp.estado = 'PAGADO') > 0 THEN 'EXCELENTE'
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') <= 1 THEN 'BUENO'
        WHEN COUNT(*) FILTER (WHERE cp.estado = 'VENCIDO') <= 3 THEN 'REGULAR'
        ELSE 'MALO'
    END AS calificacion
FROM contratos c
JOIN propiedades p ON p.propiedad_id = c.propiedad_id
JOIN inquilinos  i ON i.inquilino_id = c.inquilino_id
JOIN usuarios    u ON u.usuario_id   = i.usuario_id
LEFT JOIN calendario_pagos cp ON cp.contrato_id = c.contrato_id
GROUP BY p.duenio_id, i.inquilino_id, u.usuario_id, u.nombre_completo, u.correo;
