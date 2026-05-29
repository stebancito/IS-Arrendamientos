-- ======================================================
-- DATOS DE PRUEBA (seed)
-- ======================================================
-- IMPORTANTE: este seed asume que los usuarios ya fueron
-- creados desde la UI (Registro) o desde Supabase Auth.
-- El trigger handle_new_user() ya creó las filas en
-- `usuarios`. Aquí solo agregamos propiedades, inquilinos
-- y contratos.
--
-- Pasos sugeridos:
--   1. Registra desde el frontend dos cuentas:
--      - arrendador@test.com  (rol ARRENDADOR)
--      - inquilino@test.com   (rol INQUILINO)
--   2. Ejecuta este script en el SQL Editor de Supabase.
-- ======================================================


-- ------------------------------------------------------
-- Propiedades del arrendador de prueba
-- ------------------------------------------------------
INSERT INTO propiedades (duenio_id, nombre, direccion, tipo_propiedad, descripcion)
SELECT usuario_id, 'Edificio Central', 'Av. Reforma 100, Col. Centro', 'EDIFICIO',
       'Edificio de 4 niveles con departamentos'
FROM usuarios WHERE correo = 'arrendador@test.com'
ON CONFLICT DO NOTHING;

INSERT INTO propiedades (duenio_id, nombre, direccion, tipo_propiedad, propiedad_padre_id, descripcion)
SELECT u.usuario_id, 'Depto 101', 'Av. Reforma 100 - 101', 'DEPARTAMENTO',
       (SELECT propiedad_id FROM propiedades WHERE nombre = 'Edificio Central' LIMIT 1),
       'Departamento en planta baja, 2 recámaras'
FROM usuarios u WHERE u.correo = 'arrendador@test.com'
ON CONFLICT DO NOTHING;

INSERT INTO propiedades (duenio_id, nombre, direccion, tipo_propiedad, descripcion)
SELECT usuario_id, 'Casa Tetlán', 'Calle Río Nilo 250', 'CASA',
       'Casa de una planta, 3 recámaras'
FROM usuarios WHERE correo = 'arrendador@test.com'
ON CONFLICT DO NOTHING;


-- ------------------------------------------------------
-- Datos extra del inquilino de prueba
-- ------------------------------------------------------
UPDATE inquilinos
SET contacto_emergencia = 'Pedro García',
    telefono_emergencia = '5559876543',
    notas               = 'Sin mascotas'
WHERE usuario_id = (SELECT usuario_id FROM usuarios WHERE correo = 'inquilino@test.com');


-- ------------------------------------------------------
-- Contrato de prueba
-- (el trigger generar_calendario_pagos creará el calendario)
-- ------------------------------------------------------
INSERT INTO contratos (
    propiedad_id, inquilino_id, fecha_inicio, fecha_fin,
    monto_renta, frecuencia_pago, observaciones
)
SELECT
    (SELECT propiedad_id FROM propiedades WHERE nombre = 'Depto 101' LIMIT 1),
    (SELECT i.inquilino_id FROM inquilinos i JOIN usuarios u ON u.usuario_id = i.usuario_id
        WHERE u.correo = 'inquilino@test.com' LIMIT 1),
    CURRENT_DATE - INTERVAL '2 months',
    CURRENT_DATE + INTERVAL '10 months',
    15000.00,
    'MENSUAL',
    'Depósito en garantía recibido'
WHERE NOT EXISTS (
    SELECT 1 FROM contratos
    WHERE propiedad_id = (SELECT propiedad_id FROM propiedades WHERE nombre = 'Depto 101' LIMIT 1)
      AND estado = 'ACTIVO'
);


-- ------------------------------------------------------
-- Simular un pago ya recibido (el primero del contrato)
-- ------------------------------------------------------
DO $$
DECLARE
    v_cal_id BIGINT;
    v_usr_id BIGINT;
BEGIN
    SELECT calendario_id INTO v_cal_id
    FROM calendario_pagos
    ORDER BY fecha_limite
    LIMIT 1;

    SELECT usuario_id INTO v_usr_id
    FROM usuarios WHERE correo = 'arrendador@test.com';

    IF v_cal_id IS NOT NULL AND v_usr_id IS NOT NULL THEN
        INSERT INTO registros_pago (
            calendario_id, registrado_por_id, fecha_recibido, monto_recibido, notas
        ) VALUES (
            v_cal_id, v_usr_id, CURRENT_DATE - INTERVAL '30 days', 15000.00,
            'Pago en efectivo'
        ) ON CONFLICT DO NOTHING;

        UPDATE calendario_pagos
        SET estado = 'PAGADO', fecha_pagado = CURRENT_DATE - INTERVAL '30 days'
        WHERE calendario_id = v_cal_id;
    END IF;
END $$;


-- ------------------------------------------------------
-- Incidencia de prueba
-- ------------------------------------------------------
INSERT INTO incidencias (
    propiedad_id, reportado_por_id, titulo, descripcion, categoria
)
SELECT
    (SELECT propiedad_id FROM propiedades WHERE nombre = 'Depto 101' LIMIT 1),
    (SELECT i.inquilino_id FROM inquilinos i JOIN usuarios u ON u.usuario_id = i.usuario_id
        WHERE u.correo = 'inquilino@test.com' LIMIT 1),
    'Fuga en el lavabo del baño',
    'Hay una fuga constante debajo del lavabo principal. Necesita revisión urgente.',
    'PLOMERIA'
WHERE NOT EXISTS (
    SELECT 1 FROM incidencias WHERE titulo = 'Fuga en el lavabo del baño'
);


-- Marcar pagos vencidos según fecha actual
SELECT actualizar_pagos_vencidos();
