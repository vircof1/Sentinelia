# Scripts de verificación y operación

## Ejecutar todos los gates en Docker

Desde `NodeJS`, con la instancia Docker en ejecución:

```sh
npm run gates:todas
```

El ejecutor descubre todos los comandos `gate:*` de `package.json`, respeta su
orden y los ejecuta secuencialmente. Incluye los gates agregados y sus posibles
repeticiones; no descarta pruebas equivalentes. El comando `gates:todas` no se
incluye a sí mismo.

Utiliza la imagen de `sentinelia-app` y su red Docker. El código del checkout se
monta en modo lectura. MariaDB y Redis son los servicios de la instancia, pero
cada gate recibe una base SQL temporal, un espacio de claves Redis propio y un
BIND privado en el contenedor de pruebas. No se montan los volúmenes BIND de la
instancia. La base y las claves asignadas se eliminan al terminar cada gate.
El fixture aplica el esquema inicial y materializa una identidad de instalación
mediante el bootstrap de federación, para admitir también diagnósticos de una
instalación ya arrancada. No copia datos de negocio de la instancia.

Se necesitan Docker con Compose, `NodeJS/.env` y las dependencias locales de
NodeJS instaladas. El usuario SQL necesita permisos para crear y eliminar bases.
El CLI de Docker y su plugin Compose se montan para validar los manifiestos; el
socket Docker no se comparte con las pruebas. El contenedor usa root para las
pruebas de artefactos BIND protegidos y devuelve al usuario anfitrión la propiedad
de los logs.

Por defecto continúa tras los fallos y devuelve código 1 si alguno falla. Cada
gate tiene un plazo máximo de 900 segundos; al agotarse se termina su grupo de
procesos. Ctrl+C cancela el gate activo, limpia los recursos asignados y devuelve
130. Los escenarios internos de cada gate siguen siendo responsables de limpiar
sus propios recursos adicionales.

```sh
npm run gates:todas -- --listar
npm run gates:todas -- --solo gate:base,gate:ddns:publicacion
npm run gates:todas -- --timeout 1200 --parar-al-fallar
npm run gates:todas -- --salida /ruta/a/directorio-vacio
```

Las evidencias se guardan en `NodeJS/logs/gates/<identificador>/`: un log por
gate, su log BIND y un `resumen.json` con estados, códigos, duración y pendientes.
El resumen se actualiza después de cada gate y al finalizar. Los directorios y
logs tienen permisos restringidos y quedan fuera de Git. Un directorio de salida
con contenido se rechaza para no sobrescribir evidencias anteriores.

Los comandos `npm run gate:...` agrupan verificaciones y terminan con error si
falla una de ellas. Los lotes se ejecutan secuencialmente. La presencia de un
script en un gate no implica que todos los gates se ejecuten en un único comando.

## Correo

| Gate | Verificaciones de la serie 5.27 |
| --- | --- |
| `gate:correo:autoridad` | 1a–1d |
| `gate:correo:audiencia-renderizado` | 2a–2b, 3a–3c, 4a–4b |
| `gate:correo:cola-despacho` | 6a–6d, 7a–7b |
| `gate:correo:aceptacion-portal` | 8a–8c, 9a–9b |
| `gate:correo:retencion-bajas` | 10a–10b, 11a–11c |
| `gate:correo:federacion` | 12a–12b |
| `gate:correo:activacion` | 13a–13e |
| `gate:correo:cierre` | Matriz de las 34 verificaciones anteriores, instalación limpia, segundo arranque y ciclo integral 14b |

El cierre de correo necesita MariaDB real y permisos para crear y eliminar
bases temporales. Cada escenario SQL limpia su propia base. Sus transportes SMTP
son simulados; no requieren un servidor SMTP externo. Las pruebas de Redis de
esta familia usan colaboradores controlados.

## Organizaciones y alertas

| Gate | Verificaciones |
| --- | --- |
| `gate:organizacion:autorizacion-impacto` | 5.26.5a–5c |
| `gate:organizacion:ejecucion-notificaciones` | 5.26.6a–6b, 7a–7b, 10a, 11b |
| `gate:organizacion:portal-despliegue` | 5.26.12a–12b, 13b |
| `gate:alertas:identidad-vencimientos` | Identidad UUIDv7, segundo arranque, recaídas, vencimientos y leases |

Los tres lotes de organizaciones usan colaboradores controlados. El de alertas
necesita MariaDB real y crea una base temporal. La instalación se verifica con
`0001_esquema_inicial.sql`.

## Entradas agregadas

`gate:despliegue:arranque` comprueba con MariaDB real la espera por SQL al
arrancar: disponibilidad tardía, plazo agotado, rechazo de credenciales inválidas
y conexión antes de crear la base. Usa un proxy TCP local temporal y no modifica
datos. El supervisor espera hasta 60 segundos ante errores transitorios de red
antes de ejecutar las migraciones; los errores de autenticación se propagan.

`federacion:smoke-5-22-9` ejecuta `gate:federacion:nucleo`.
`usuarios:verificar-recuperacion-5-30-1` ejecuta los gates de generaciones y
auditoría de recuperación; este último prepara una base SQL temporal para sus
verificaciones. Estas entradas reutilizan los gates en lugar de mantener otro
ejecutor o contrato paralelo.

## Utilidades fuera de los gates

Estas seis entradas son herramientas operativas, no pruebas automáticas:

| Comando npm | Función |
| --- | --- |
| `usuarios:asignar-scope` | Actualiza el scope del usuario indicado por `USUARIO_OBJETIVO` y `SCOPE_*`. |
| `auditoria:outbox -- listar [limite]` | Lista obligaciones bloqueadas. |
| `auditoria:outbox -- rehabilitar <obligacionId>` | Rehabilita una obligación bloqueada. |
| `migraciones:ejecutar` | Ejecuta las migraciones contra la base configurada. |
| `monitores:exportar-runtime` | Exporta las definiciones de monitores a JSON. |
| `runtime:diagnostico` | Arranca el runtime, recoge su diagnóstico y lo detiene. |
| `triggers:diagnostico-bindings-scope` | Consulta vínculos y resume discrepancias de scope. |

El comando de outbox tiene dos acciones en un mismo script. Asignar scope,
rehabilitar obligaciones y ejecutar migraciones modifican la instancia
configurada. El diagnóstico de runtime realiza un arranque real y puede ejecutar
trabajo operativo. No deben incorporarse indiscriminadamente a una batería de
pruebas.

La configuración se carga mediante el módulo de configuración de la aplicación.
No es necesario ejecutar `.env` como un script de shell. Para gates con SQL o
Redis reales, los hosts deben ser accesibles desde el entorno donde se lance
Node; los nombres internos de Docker se resuelven dentro de su red.
