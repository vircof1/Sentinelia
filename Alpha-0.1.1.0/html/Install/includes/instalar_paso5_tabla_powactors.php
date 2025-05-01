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
        CREATE TABLE IF NOT EXISTS pow_actors (
            ip VARCHAR(45) NOT NULL PRIMARY KEY,
            reintentos INT(10) UNSIGNED NOT NULL DEFAULT 0,
            ultimo_nonce BIGINT(20) UNSIGNED DEFAULT NULL,
            tiempo_resolucion INT(10) UNSIGNED DEFAULT NULL,
            hashes_por_segundo FLOAT DEFAULT NULL,
            fecha_ultimo_intento DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_fecha_ultimo_intento (fecha_ultimo_intento)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";

        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tabla <strong>pow_actors</strong> creada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear tabla pow_actors: ' . $e->getMessage()
        ];
    }
}
?>
