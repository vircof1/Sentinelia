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

        // Verificar si ya existen tareas similares
        $res = $mysqli->query("SELECT COUNT(*) as total FROM monitoreo WHERE url_servicio = '127.0.0.1'");
        $row = $res->fetch_assoc();

        if ((int)$row['total'] > 0) {
            return [
                'estado' => 'ok',
                'mensaje' => 'ℹ️ Tareas de ejemplo ya estaban insertadas.'
            ];
        }

        // Insertar ejemplos
        $sql = "
        INSERT INTO monitoreo (
            nombre_servicio, url_servicio, tipo_prueba, intervalo_minutos,
            estado_resultado, TareaHabilitada, descripcion_fallo, posible_causa,
            puerto_tcp
        ) VALUES
        (
            'Ping local a localhost', '127.0.0.1', 'ping', 1,
            'éxito', 1, 'No responde el ping local', 'El servicio local o red no responde al ICMP',
            NULL
        ),
        (
            'TCP a localhost puerto 80', '127.0.0.1', 'tcp', 1,
            'éxito', 1, 'No responde el puerto 80 local', 'No hay servicio web activo en el puerto 80',
            80
        );
        ";
        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tareas de ejemplo insertadas correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al insertar tareas de ejemplo: ' . $e->getMessage()
        ];
    }
}
?>
