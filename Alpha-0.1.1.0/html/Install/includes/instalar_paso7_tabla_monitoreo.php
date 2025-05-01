<?php
if (!isset($controlIncludes) || !$controlIncludes) {
    exit;
}

function ejecutarPaso()
{
    try {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        $datosBBDD = $_SESSION['sentinelia_instalador'] ?? null;
        if (!$datosBBDD) {
            throw new Exception("Datos de conexión no disponibles.");
        }

        mysqli_report(MYSQLI_REPORT_STRICT | MYSQLI_REPORT_ERROR);
        $mysqli = new mysqli(
            $datosBBDD['db_host'],
            $datosBBDD['db_usuario'],
            $datosBBDD['db_pass'],
            $datosBBDD['db_nombre']
        );

        $sql = "
        CREATE TABLE IF NOT EXISTS monitoreo (
            id_monitoreo INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre_servicio VARCHAR(255) NOT NULL,
            url_servicio VARCHAR(255) NOT NULL,
            usuario_SQL VARCHAR(255) DEFAULT NULL,
            pass_SQL VARCHAR(255) DEFAULT NULL,
            NombreBaseDeDatos_SQL VARCHAR(255) DEFAULT NULL,
            tipo_prueba ENUM('ping','tcp','consulta') NOT NULL,
            umbral INT(11) DEFAULT NULL,
            puerto_tcp INT(11) DEFAULT NULL,
            texto_consulta TEXT DEFAULT NULL,
            intervalo_minutos INT(11) UNSIGNED NOT NULL,
            ultima_ejecucion TIMESTAMP NULL DEFAULT NULL,
            estado_resultado ENUM('éxito','fallo') NOT NULL,
            tiempo_respuesta DECIMAL(10,2) DEFAULT NULL,
            texto_resultado TEXT DEFAULT NULL,
            mensaje_alerta VARCHAR(255) DEFAULT NULL,
            nivel_alerta ENUM('información','advertencia','crítico') DEFAULT NULL,
            hora_alerta TIMESTAMP NULL DEFAULT NULL,
            creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            proxima_ejecucion DATETIME DEFAULT CURRENT_TIMESTAMP,
            intentos_permitidos INT(11) UNSIGNED DEFAULT 3,
            intentos_fallidos_actuales INT(11) DEFAULT 0,
            TareaHabilitada TINYINT(2) NOT NULL DEFAULT 1,
            descripcion_fallo VARCHAR(256) NOT NULL DEFAULT '',
            posible_causa VARCHAR(256) NOT NULL DEFAULT '',
            TareaNegada TINYINT(1) NOT NULL DEFAULT 0,
            registrar_ip TINYINT(1) NOT NULL DEFAULT 0,
            fechaCreacionMonitor DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_proxima_ejecucion (proxima_ejecucion),
            KEY idx_TareaHabilitada (TareaHabilitada)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";

        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tabla <strong>monitoreo</strong> creada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear tabla monitoreo: ' . $e->getMessage()
        ];
    }
}
?>
