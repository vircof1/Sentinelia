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
        CREATE TABLE IF NOT EXISTS configuracion (
            id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
            clave VARCHAR(64) NOT NULL,
            valor TEXT NOT NULL,
            tipo ENUM('bool','int','string','array') NOT NULL,
            descripcion TEXT DEFAULT NULL,
            actualizado TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY clave_idx (clave)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";

        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tabla <strong>configuracion</strong> creada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear tabla configuracion: ' . $e->getMessage()
        ];
    }
}
?>
