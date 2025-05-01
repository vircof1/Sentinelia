<?php
session_start();
header('Content-Type: application/json');

$datos = $_SESSION['sentinelia_instalador'] ?? null;
if (!$datos) {
    echo json_encode(['estado' => 'error', 'mensaje' => 'Sesión inválida']);
    exit;
}

try {
    mysqli_report(MYSQLI_REPORT_STRICT | MYSQLI_REPORT_ERROR);
    $mysqli = new mysqli(
        $datos['db_host'],
        $datos['db_usuario'],
        $datos['db_pass'],
        $datos['db_nombre']
    );

    $sql = "SELECT COUNT(*) AS total FROM monitoreo WHERE ultima_ejecucion IS NOT NULL";
    $res = $mysqli->query($sql);
    $fila = $res->fetch_assoc();

    if ((int)$fila['total'] > 0) {
        echo json_encode(['estado' => 'ok']);
    } else {
        echo json_encode(['estado' => 'esperando']);
    }

} catch (Exception $e) {
    echo json_encode(['estado' => 'error', 'mensaje' => $e->getMessage()]);
}
