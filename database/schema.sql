-- ======================================================
-- 1. TIPOS ENUM
-- ======================================================
CREATE TYPE rol_usuario_enum AS ENUM ('ARRENDADOR', 'INQUILINO');
CREATE TYPE tipo_propiedad_enum AS ENUM ('EDIFICIO', 'DEPARTAMENTO', 'CASA', 'LOCAL', 'TERRENO');
CREATE TYPE frecuencia_enum AS ENUM ('MENSUAL', 'QUINCENAL', 'SEMANAL');
CREATE TYPE estado_contrato_enum AS ENUM ('ACTIVO', 'FINALIZADO', 'TERMINADO');
CREATE TYPE estado_pago_enum AS ENUM ('PENDIENTE', 'PAGADO', 'VENCIDO');
CREATE TYPE categoria_incidencia_enum AS ENUM ('PLOMERIA', 'ELECTRICIDAD', 'ESTRUCTURA', 'LIMPIEZA', 'SEGURIDAD', 'OTRO');
CREATE TYPE estado_incidencia_enum AS ENUM ('ABIERTA', 'EN_PROCESO', 'RESUELTA');
CREATE TYPE tipo_notificacion_enum AS ENUM ('PAGO_PROXIMO', 'PAGO_VENCIDO', 'INCIDENCIA_ACTUALIZADA', 'CONTRATO_TERMINADO', 'RECORDATORIO');

-- ======================================================
-- 2. TABLAS (con integración a auth.users)
-- ======================================================

-- Tabla usuarios (vinculada a auth.users mediante auth_user_id)
CREATE TABLE usuarios (
    usuario_id BIGSERIAL PRIMARY KEY,
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    correo VARCHAR(255) NOT NULL,
    rol rol_usuario_enum NOT NULL DEFAULT 'INQUILINO',
    nombre_completo VARCHAR(100) NOT NULL,
    telefono VARCHAR(20),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_acceso TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Tabla propiedades
CREATE TABLE propiedades (
    propiedad_id BIGSERIAL PRIMARY KEY,
    duenio_id BIGINT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    direccion TEXT NOT NULL,
    tipo_propiedad tipo_propiedad_enum NOT NULL,
    propiedad_padre_id BIGINT REFERENCES propiedades(propiedad_id) ON DELETE SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    descripcion TEXT
);

-- Tabla inquilinos
CREATE TABLE inquilinos (
    inquilino_id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL UNIQUE REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
    contacto_emergencia VARCHAR(100),
    telefono_emergencia VARCHAR(20),
    notas TEXT
);

-- Tabla contratos
CREATE TABLE contratos (
    contrato_id BIGSERIAL PRIMARY KEY,
    propiedad_id BIGINT NOT NULL REFERENCES propiedades(propiedad_id) ON DELETE RESTRICT,
    inquilino_id BIGINT NOT NULL REFERENCES inquilinos(inquilino_id) ON DELETE RESTRICT,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    monto_renta NUMERIC(12,2) NOT NULL CHECK (monto_renta > 0),
    frecuencia_pago frecuencia_enum NOT NULL DEFAULT 'MENSUAL',
    estado estado_contrato_enum NOT NULL DEFAULT 'ACTIVO',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_terminacion DATE,
    observaciones TEXT,
    CHECK (fecha_fin > fecha_inicio)
);
CREATE UNIQUE INDEX idx_unico_activo_por_propiedad ON contratos (propiedad_id) WHERE estado = 'ACTIVO';

-- Tabla calendario_pagos
CREATE TABLE calendario_pagos (
    calendario_id BIGSERIAL PRIMARY KEY,
    contrato_id BIGINT NOT NULL REFERENCES contratos(contrato_id) ON DELETE CASCADE,
    fecha_limite DATE NOT NULL,
    monto_esperado NUMERIC(12,2) NOT NULL CHECK (monto_esperado > 0),
    anio SMALLINT NOT NULL,
    mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    estado estado_pago_enum NOT NULL DEFAULT 'PENDIENTE',
    fecha_pagado DATE,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_unico_periodo_por_contrato ON calendario_pagos (contrato_id, anio, mes);

-- Tabla registros_pago
CREATE TABLE registros_pago (
    pago_id BIGSERIAL PRIMARY KEY,
    calendario_id BIGINT NOT NULL UNIQUE REFERENCES calendario_pagos(calendario_id) ON DELETE RESTRICT,
    registrado_por_id BIGINT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE RESTRICT,
    fecha_recibido DATE NOT NULL,
    monto_recibido NUMERIC(12,2) NOT NULL,
    notas TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla incidencias
CREATE TABLE incidencias (
    incidencia_id BIGSERIAL PRIMARY KEY,
    propiedad_id BIGINT NOT NULL REFERENCES propiedades(propiedad_id) ON DELETE CASCADE,
    reportado_por_id BIGINT NOT NULL REFERENCES inquilinos(inquilino_id) ON DELETE CASCADE,
    titulo VARCHAR(200) NOT NULL,
    descripcion TEXT NOT NULL,
    categoria categoria_incidencia_enum NOT NULL,
    estado estado_incidencia_enum NOT NULL DEFAULT 'ABIERTA',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resuelto_en TIMESTAMPTZ,
    resolucion_notas TEXT
);

-- Tabla notificaciones
CREATE TABLE notificaciones (
    notificacion_id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(usuario_id) ON DELETE CASCADE,
    titulo VARCHAR(200) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo tipo_notificacion_enum NOT NULL,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    leida_en TIMESTAMPTZ,
    metadatos JSONB
);

-- ======================================================
-- 3. FUNCIONES Y TRIGGERS
-- ======================================================

-- Actualizar timestamp automáticamente
CREATE OR REPLACE FUNCTION actualizar_timestamp_columna()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuarios_actualizado BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_propiedades_actualizado BEFORE UPDATE ON propiedades FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_contratos_actualizado BEFORE UPDATE ON contratos FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_calendario_actualizado BEFORE UPDATE ON calendario_pagos FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_incidencias_actualizado BEFORE UPDATE ON incidencias FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();

-- Función para marcar pagos vencidos (ejecutar manual o con cron)
CREATE OR REPLACE FUNCTION actualizar_pagos_vencidos()
RETURNS void AS $$
BEGIN
    UPDATE calendario_pagos
    SET estado = 'VENCIDO',
        actualizado_en = NOW()
    WHERE estado = 'PENDIENTE'
      AND fecha_limite < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================================================
-- 4. TRIGGER PARA SINCRONIZAR auth.users CON TABLA usuarios
-- ======================================================

-- Función que se ejecuta cuando se crea un nuevo usuario en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.usuarios (auth_user_id, correo, rol, nombre_completo, activo)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'rol')::rol_usuario_enum, 'INQUILINO'),
        COALESCE(NEW.raw_user_meta_data->>'nombre_completo', split_part(NEW.email, '@', 1)),
        true
    );
    RETURN NEW;
END;
$$;

-- Trigger que se activa después de cada inserción en auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Dar permisos de uso del esquema public al rol anon
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Dar permisos para tablas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;


-- Desactivar RLS en todas las tablas (ya lo hicimos, pero por si acaso)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE propiedades DISABLE ROW LEVEL SECURITY;
ALTER TABLE inquilinos DISABLE ROW LEVEL SECURITY;
ALTER TABLE contratos DISABLE ROW LEVEL SECURITY;
ALTER TABLE calendario_pagos DISABLE ROW LEVEL SECURITY;
ALTER TABLE registros_pago DISABLE ROW LEVEL SECURITY;
ALTER TABLE incidencias DISABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones DISABLE ROW LEVEL SECURITY;

-- Conceder todos los privilegios al rol anon (como en la solución 1)
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;

CREATE POLICY "anon puede todo" ON usuarios FOR ALL USING (true) WITH CHECK (true);
-- repite para cada tabla, o simplemente asegúrate de que RLS esté desactivado.