# IS - Sistema Web de Gestión de Arrendamientos

Sistema web orientado a la gestión integral de propiedades en arrendamiento, desarrollado como proyecto académico de ingeniería de software.

## Objetivo

Centralizar y digitalizar la administración de:
- Propiedades
- Contratos
- Pagos simulados
- Incidencias
- Notificaciones internas

El sistema contará con dos roles principales:
- Arrendador
- Inquilino

---

# Stack Tecnológico

## Frontend
- HTML5
- CSS3
- Bootstrap 5
- JavaScript Vanilla
- Chart.js

## Backend
- Node.js
- Express.js

## Base de Datos
- Supabase
- PostgreSQL

---

# Estructura del Proyecto

```txt
arrendamientos-app/
│
├── frontend/
│   ├── assets/
│   ├── css/
│   ├── js/
│   ├── pages/
│   └── index.html
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── middlewares/
│   │   ├── utils/
│   │   ├── app.js
│   │   └── server.js
│   │
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   └── .gitignore
│
├── database/
│   ├── schema.sql
│   ├── seed.sql
│   └── triggers.sql
│
├── docs/
│
├── .gitignore
└── README.md
```

---

# Instalación del Proyecto

## Clonar repositorio

```bash
git clone https://github.com/stebancito/IS-Arrendamientos.git
```

---

## Instalar dependencias backend

```bash
cd backend
npm install
```

---

## Ejecutar backend

```bash
npm run dev
```

---

## Ejecutar frontend

Abrir:

```txt
frontend/index.html
```

o usar Live Server.

---

# Flujo de Trabajo Git

## Ramas principales

```txt
main
develop
```

---

## Ramas por funcionalidad

```txt
feature/auth
feature/properties
feature/contracts
feature/payments
feature/dashboard
feature/incidents
feature/frontend
```

---

# Flujo recomendado

```txt
feature/* -> develop -> main
```

---

# Convención de Commits

## Nuevas funcionalidades

```bash
feat: add contract creation endpoint
```

## Corrección de errores

```bash
fix: validate contract dates
```

## Refactorización

```bash
refactor: improve payment calculation logic
```

## Estilos

```bash
style: improve dashboard responsiveness
```

