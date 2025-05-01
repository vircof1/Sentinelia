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
        CREATE TABLE IF NOT EXISTS log (
            id_log BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
            id_monitoreo INT(11) NOT NULL,
            tipo_tarea VARCHAR(50) NOT NULL,
            estado_actual VARCHAR(10) NOT NULL,
            cantidad_eventos BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
            cantidadMaximaDeEventos INT(11) DEFAULT NULL,
            fecha_inicio_estado DATETIME NOT NULL,
            fecha_fin_estado DATETIME DEFAULT NULL,
            motivo_estado TEXT DEFAULT NULL,
            nivel_alerta VARCHAR(20) DEFAULT 'información',
            ultima_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_id_monitoreo (id_monitoreo)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";

        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tabla <strong>log</strong> creada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear tabla log: ' . $e->getMessage()
        ];
    }
}
?>
