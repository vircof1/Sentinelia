# Sentinelia

**Sentinelia** es un sistema de monitorización GPL en desarrollo activo, diseñado para entornos técnicos reales. Su objetivo es proporcionar una base sólida, funcional y extensible para controlar tareas automáticas, con enfoque en delegación, visibilidad y control operativo.  

Actualmente se encuentra en fase Alpha funcional.

---

## ✅ Funcionalidades implementadas

- 🔒 **Prueba de trabajo (PoW)** dinámica en login, con ajuste por IP y detección de proxies
- 📡 **Monitorización básica**:  
  - Tarea tipo `ping`  
  - Tarea tipo `tcp`  
- 🌐 **Tiempos expresados en horario local**, vía JavaScript en frontend
- 🛠 **Permisos globales por usuario**:  
  - Lectura  
  - Edición  
  - Auditoría  
  - Configuración del portal
- 📊 **Visor de eventos con gráficos** generados mediante Chart.js
- 📤 **Delegación de tickets** a otras plataformas vía HTTP POST (no requiere que la otra parte tenga Sentinelia)
- 🔑 **Política de contraseñas personalizable** (mínimo de caracteres, etc.)

---

## 🧭 En desarrollo (planificado para próximas versiones)

- 🧩 Sistema completo de **ACLs personalizadas** (por grupos, tareas, usuarios)
- 🔍 Monitor web con expresiones regulares sobre respuesta HTTP (`webregexp`)
- 🧮 Tareas SQL con umbrales personalizados (alertas por resultados)
- 📣 Sistema de **distribución de notificaciones** entre nodos y destinatarios
- 🧠 Agrupación lógica de tareas (AND/OR) para alertas compuestas
- ⚙️ **Triggers automáticos** para ejecutar acciones cuando se detectan estados definidos
- 🌍 Integración de **DDNS local** para resolución dinámica dentro de red

---

## ⚙️ Requisitos mínimos

- PHP >= 7.4 (recomendado 8.x)
- MariaDB / MySQL
- Cron funcional en Linux
- Servidor web (Apache, Nginx, etc.)

---

## 🛡 Filosofía del proyecto

- Diseño modular y comprensible
- Sin dependencias externas innecesarias
- No fuerza integración con terceros (ERP, cloud, etc.)
- Licencia **GPL v3**: libertad para modificar, usar y redistribuir
- Documentación clara, estructura orientada a técnicos reales

---

## 🚀 Instalación

1. Subir los archivos al servidor
2. Visitar `/Install` desde navegador y seguir el asistente
3. Eliminar la carpeta `/Install` al finalizar
4. Añadir la tarea cron:
```bash
* * * * * /usr/bin/php /var/www/crontab.php >> /dev/null 2>&1