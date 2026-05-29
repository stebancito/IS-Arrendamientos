# Arrendamientos App - Gestión de Propiedades en Arrendamiento

**Proyecto académico** – Sistema web para la gestión integral de arrendamientos, desarrollado con frontend vanilla (HTML, CSS, JS) y **Supabase** como backend (base de datos, autenticación, API REST). No requiere backend propio (Node.js/Express). La API de Supabase se consume directamente desde el navegador.

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
