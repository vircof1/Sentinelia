<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start(); // Inicia la sesión solo si no está ya iniciada.
}

// Lee el cuerpo de la solicitud
$json = file_get_contents('php://input');
$data = json_decode($json, true); // Decodifica el JSON a un array asociativo

// Verifica si se recibió un JSON válido
if (json_last_error() === JSON_ERROR_NONE) {
    // Puedes usar var_dump($data) para depurar si lo necesitas
    //var_dump($data);

    // Asegúrate de que el método de la solicitud es POST
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (isset($data['sidebarHide'])) {
            $_SESSION['templateSidebarHide'] = $data['sidebarHide'] === true; // Asegúrate de que sea booleano
        }

        // Opcional: Puedes devolver una respuesta JSON
        echo json_encode(['status' => 'success', 'NuevoValor' => $_SESSION['templateSidebarHide']]);
        exit;
    }
} else {
    // Maneja el error de JSON si es necesario
    echo json_encode(['status' => 'error', 'message' => 'Invalid JSON']);
    exit;
}
?>
