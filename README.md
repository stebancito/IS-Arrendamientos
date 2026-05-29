# Arrendamientos App - Gestión de Propiedades en Arrendamiento

**Proyecto académico** – Sistema web para la gestión integral de arrendamientos, desarrollado con frontend vanilla (HTML, CSS, JS) y **Supabase** como backend (base de datos, autenticación, API REST). No requiere backend propio (Node.js/Express). La API de Supabase se consume directamente desde el navegador.

--- 
## Estrategia de Trabajo en Equipo (Frontend + Supabase)
* Gestión de Ramas (Git): Nadie debe trabajar en la rama main. Cada desarrollador creará una rama por módulo (ej. feature/modulo-contratos, feature/auth). Solo se hará merge a main cuando el módulo esté funcional y probado.

* Framework de UI Unificado: Para que el sistema sea "funcional y atractivo" rápidamente, utilicen una librería de componentes de interfaz (como Bootstrap 5 o TailwindCSS) cargada vía CDN. Esto evita conflictos de diseño y unifica la apariencia sin perder tiempo escribiendo CSS desde cero.

* Cliente Supabase Centralizado: Mantengan un único archivo supabase-config.js (como ya tienen estructurado) que inicialice la conexión. Todos los demás scripts de JavaScript simplemente llamarán a window.supabaseClient.

* Mockups y Pruebas en SQL Editor: Antes de escribir el código JavaScript para consultas complejas, prueben las sentencias SQL en el panel de Supabase. Si una consulta es muy difícil de hacer en JS, creen una Vista (CREATE VIEW) en Supabase y consúltenla desde el frontend como si fuera una tabla normal.
---
## Repartición de trabajo

| Desarrollador | Módulo Asignado | Responsabilidades Principales |
|---|---|---|
| Dev 1 | Core, Autenticación y Layout | - Integrar Supabase Auth (Registro, Login, Logout).<br>- Proteger rutas: redirigir si no hay sesión o si el rol no corresponde.<br>- Crear el "Layout" maestro (Barra de navegación lateral/superior) que los demás usarán.<br>- Gestión de la tabla usuarios y perfiles. |
| Dev 2 | Gestión de Propiedades e Inquilinos | - CRUD de Propiedades (alta, baja, modificación, listar).<br>- Lógica de jerarquía de propiedades (ej. Edificio → Departamentos).<br>- CRUD de Inquilinos (registro y modificación de contactos). |
| Dev 3 | Gestión de Contratos | - Interfaz para vincular Propiedad + Inquilino en un nuevo contrato.<br>- Validar fechas (fin posterior a inicio) y montos.<br>- Listado de contratos activos e historial.<br>- Lógica para finalizar contratos anticipadamente. |
| Dev 4 | Motor de Pagos y Simulación | - Generar registros de pagos esperados en `calendario_pagos` al crear un contrato.<br>- Pantalla para registrar recepción de pagos manuales.<br>- Lógica para cambiar estados de pago ("Pendiente", "Pagado", "Vencido").<br>- Historial de pagos por inquilino/propiedad. |
| Dev 5 | Dashboard Financiero y Evaluaciones | - Integrar Chart.js para mostrar el flujo de efectivo.<br>- Calcular métricas: ingresos totales, pagos pendientes y vencidos.<br>- Generar la calificación del comportamiento financiero del inquilino. |
| Dev 6 | Incidencias y Notificaciones | - Interfaz del Inquilino para levantar tickets (Incidencias).<br>- Panel del Arrendador para cambiar estados ("Abierta", "En proceso", "Resuelta").<br>- Sistema de notificaciones en tiempo real o al cargar la página (alertas de pagos próximos, cambios en incidencias). |

---

## Estructura del proyecto
```text
arrendamientos-app/
│
├── frontend/          ← Código del cliente (estático)
│   ├── index.html     ← Página principal (redirige según sesión)
│   ├── pages/         ← Vistas HTML separadas
│   │   ├── login.html
│   │   ├── dashboard-arrendador.html
│   │   └── dashboard-inquilino.html
│   ├── css/
│   │   └── styles.css ← Estilos personalizados
│   ├── js/
│   │   ├── supabase-config.js ← Cliente de Supabase (URL + anon key)
│   │   ├── auth.js            ← login, logout, sesión
│   │   ├── propiedades.js     ← CRUD propiedades
│   │   ├── contratos.js
│   │   ├── pagos.js
│   │   ├── incidencias.js
│   │   └── dashboard.js       ← gráficos (Chart.js) y cálculos
│   └── assets/        ← imágenes, íconos, etc. (opcional)
│
├── database/          ← Scripts SQL (solo referencia)
│   ├── schema.sql     ← Creación de tablas (ya ejecutado)
│   ├── seed.sql       ← Datos de prueba (opcional)
│   └── functions.sql  ← Funciones RPC y triggers (opcional)
│
├── docs/              ← Documentación adicional
│
├── .gitignore
└── README.md          ← Este archivo
```
---

## Configuración inicial (solo una vez)

### 1. Clonar el repositorio
```bash
git clone <url-del-repo>
cd arrendamientos-app
```


### 2. Levantar el servidor frontend (cada miembro en su máquina)
Como el proyecto solo contiene archivos estáticos, necesitas un servidor HTTP local. Recomendamos:
* **VS Code + Live Server (extensión):** abre `frontend/index.html` y haz clic derecho → "Open with Live Server".
* **Python:** dentro de la carpeta `frontend/` ejecuta `python -m http.server 8000` y accede a `http://localhost:8000`.
* **Node.js:** ejecuta `npx serve frontend`.


---

## Consultas a la API de Supabase (CRUD)
Desde cualquier archivo JS puedes usar `window.supabaseClient` ya configurado globalmente.

**Ejemplos básicos:**
```javascript
// Obtener propiedades del arrendador
const { data, error } = await window.supabaseClient
    .from('propiedades')
    .select('*')
    .eq('duenio_id', usuario.usuario_id);

// Insertar una nueva propiedad
const { data: nueva, error: insertError } = await window.supabaseClient
    .from('propiedades')
    .insert({
        duenio_id: usuario.usuario_id,
        nombre: 'Departamento Centro',
        direccion: 'Av. Reforma 123',
        tipo_propiedad: 'DEPARTAMENTO'
    })
    .select();

// Actualizar una propiedad
await window.supabaseClient
    .from('propiedades')
    .update({ nombre: 'Nuevo nombre' })
    .eq('propiedad_id', id);

// Eliminar una propiedad (solo si no tiene contratos activos)
await window.supabaseClient
    .from('propiedades')
    .delete()
    .eq('propiedad_id', id);
```

**Consultas más complejas (vistas y funciones RPC):**
Para agregaciones y reportes, la base de datos ya tiene vistas como `comportamiento_inquilino` y funciones RPC. Se consultan así:
```javascript
// Vista
const { data: viewData } = await window.supabaseClient
    .from('comportamiento_inquilino')
    .select('*')
    .eq('usuario_id', usuario.usuario_id);

// Función RPC
const { data: rpcData } = await window.supabaseClient
    .rpc('obtener_resumen_financiero', { p_arrendador_id: usuario.usuario_id });
```

---

## Trabajo en equipo
Cada miembro trabajará en su propia rama de Git y hará *merge* a `main` cuando su módulo esté listo.

**Reparto de módulos sugerido:**
* Autenticación y sesión (`auth.js` + `login.html`)
* Gestión de propiedades (CRUD, jerarquía)
* Gestión de inquilinos y contratos
* Módulo financiero (pagos, dashboard con Chart.js)
* Incidencias (reporte y seguimiento)
* Notificaciones (alertas visuales)

**Base de datos:** Si alguien necesita modificar el esquema (agregar columna, nueva vista, función RPC), debe escribir el script SQL, probarlo en su propio proyecto de Supabase y luego comunicarlo al equipo. El administrador ejecutará los cambios en el proyecto compartido.

---

## Dependencias externas
El proyecto utiliza las siguientes librerías CDN (ya incluidas en las páginas HTML):
* **Bootstrap 5** – estilos y componentes.
* **Chart.js** – gráficos para el dashboard.
* **Supabase JS** – cliente de Supabase.

> No es necesario instalar nada con npm. Solo incluir los scripts en cada página.

---

##  Archivos importantes
* `frontend/js/supabase-config.js` – no subir a GitHub si el repositorio es público. Por ser proyecto académico y privado, puede incluirse.
* `database/schema.sql` – definición completa de la base de datos (ejecutada una vez).


**¿Cómo probamos consultas complejas antes de codificarlas?**
Usa el SQL Editor de Supabase. Allí puedes escribir y probar cualquier consulta, vista o función RPC.
