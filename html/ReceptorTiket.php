<?php

// Solo aceptamos POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo "Método no permitido. Usa POST.";
    exit;
}

// Obtenemos el campo enviado
$json = $_POST['ticketJson'] ?? null;

if (!$json) {
    http_response_code(400);
    echo "No se ha recibido el campo 'ticketJson'.";
    exit;
}

// Intentamos decodificarlo
$data = json_decode($json, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(422);
    echo "Error al decodificar JSON: " . json_last_error_msg();
    exit;
}

// ✅ Si todo está bien, lo mostramos
echo "<pre>";
var_dump($data);
echo "</pre>";
