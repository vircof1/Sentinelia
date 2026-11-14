# Sentinelia Community

Sentinelia es una plataforma libre y autoalojable de monitorización y respuesta
operativa. Supervisa servicios, recibe telemetría de agentes y combina estados
para generar alertas y ejecutar acciones de correo, HTTP/API y DNS.

Esta distribución contiene el código fuente del servidor web y del runtime.
La versión está en **beta**.

## Capacidades

- Monitores Ping, TCP con verificación TLS opcional, de telemetría y lógicos.
- Alertas, histórico y contexto humano para interpretar y resolver fallos.
- Recepción de señales de agentes y evaluación de reglas de telemetría.
- Acciones de correo, HTTP/API y cambios DNS vinculadas a monitores.
- DNS autoritativo y DDNS de agentes mediante BIND.
- Organización por empresas y sitios, permisos y auditoría operativa.
- Federación de información autorizada entre instalaciones.

Attacus es el agente oficial y se instala por separado. Tiene licencia privada;
su SDK se distribuye bajo MIT. No forma parte de este código fuente.

## Requisitos

- **Node.js 24 LTS** y npm.
- Para el despliegue incluido: Linux, Bash, Docker y Docker Compose v2 con
  soporte para `up --wait`.
- Para ejecución sin Docker: MariaDB o MySQL y Redis accesibles desde la
  aplicación; BIND9 y las utilidades de red si habilitas sus capacidades.
- Un servidor SMTP si quieres enviar correo.

Todos los comandos siguientes se ejecutan desde la carpeta que contiene
este README y `package.json`.

## Inicio con Docker

El despliegue incluido construye Sentinelia desde el fuente y levanta la
aplicación, MariaDB y Redis. La imagen de aplicación incluye BIND y ejecuta
el portal web y el runtime.

```bash
bash despliegue/docker/node-bind/levantar.sh
```

El script crea `.env` desde `.env.ejemplo`, genera contraseñas y claves propias,
aplica las migraciones durante el arranque y espera a que los servicios estén
saludables. Necesita Node.js en el host para preparar ese entorno.

Abre **http://127.0.0.1:3001**. En una base nueva se crea el administrador
indicado por `USUARIO_ADMIN_INICIAL`, `PASSWORD_ADMIN_INICIAL` y
`EMAIL_ADMIN_INICIAL`. Consulta su contraseña generada en tu archivo `.env`.

El puerto web se publica por defecto solo en la interfaz local. Para acceder
desde otras máquinas, configura el acceso y HTTPS mediante un reverse proxy.
El Compose también publica TCP/UDP 53 para DNS; comprueba que estén libres.
DNS y federación están desactivados inicialmente en la plantilla de entorno.

Comandos de operación:

```bash
# Ver registros
bash despliegue/docker/node-bind/logs.sh

# Reconstruir la aplicación después de actualizar el código
bash despliegue/docker/node-bind/reload.sh

# Detener los servicios
bash despliegue/docker/node-bind/parar.sh
```

Conserva `.env` y los volúmenes de MariaDB, Redis y BIND. Actualizar el fuente
no sustituye una copia de seguridad de los datos y de las claves de la instancia.

## Ejecución sin Docker

Instala las dependencias fijadas y genera el entorno:

```bash
npm ci
node despliegue/docker/node-bind/preparar-entorno.mjs .env .env.ejemplo
```

Edita `.env` antes de arrancar. La plantilla está orientada a Docker: cambia
`SQL_HOST`, `SQL_PUERTO`, `SQL_USUARIO`, `SQL_PASSWORD`, `SQL_BASE_DATOS` y
`REDIS_URL` para utilizar tus servicios. La contraseña SQL debe corresponder
a un usuario real con los permisos necesarios para aplicar las migraciones.
Revisa también las tres variables del administrador inicial.

Aplica el esquema e inicia el portal:

```bash
npm run migraciones:ejecutar
npm start
```

En otra terminal, desde la misma carpeta, inicia el runtime:

```bash
npm run runtime:start
```

Con `PUERTO_WEB=3000`, el portal utiliza el puerto 3000. El runtime ejecuta los
monitores y el trabajo operativo; debes mantener ambos procesos activos.
Para desarrollar con recarga automática usa `npm run dev` y
`npm run runtime:dev`.

La ejecución sin Docker no prepara BIND ni sus permisos automáticamente.
Mantén `DNS_ACTIVO=false` hasta configurar esa integración.

## Configuración

`.env.ejemplo` describe las variables de entorno y sus valores iniciales.
El preparador genera los secretos pendientes y preserva los que ya existen.
No compartas `.env` ni sustituyas las claves de una instalación existente
por otras nuevas sin planificar su recuperación.

Parte de la configuración se guarda en SQL y se administra desde el portal.
En esos casos, el entorno aporta el valor inicial; cambiarlo después no
sustituye necesariamente el valor persistido.

## Verificaciones

```bash
npm run gate:base
npm run gate:ejecutor
```

`npm run gates:todas` ejecuta la batería completa; algunas verificaciones
requieren servicios e infraestructura adicionales. Los comandos disponibles
están en `package.json`.

## Estructura

```text
apps/           Portal web y runtime
paquetes/       Dominio, servicios e integraciones compartidas
migraciones/    Esquema SQL y migraciones
openapi/        Contratos de la API
scripts/        Administración, diagnósticos y verificaciones
despliegue/     Docker, BIND y herramientas de despliegue
```

## Proyecto y guías

- [Proyecto Attacus](https://www.attacus.es/)
- [Guías de Sentinelia](https://www.attacus.es/documentacion/)
- [Alcance de la beta](https://www.attacus.es/beta/)
- [Attacus para Windows](https://www.attacus.es/attacus/)

## Licencia

El código propio de Sentinelia Community se distribuye bajo
**AGPL-3.0-only**. El texto completo está en [LICENSE](LICENSE).
Los componentes de terceros conservan sus licencias y avisos originales;
consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
