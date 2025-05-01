<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


echo json_encode( PoWProtector::generarDesafio());
exit;


// Configuración general
header('Content-Type: application/json');

// Puedes añadir cabeceras CORS si fuera necesario para pruebas:
// header("Access-Control-Allow-Origin: *");

$dificultad = 20;
$timeoutMs = 20000;

// Generar semilla única
$timestamp = time();
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$semilla = $virsoft -> generarSaltAleatorio();

// Aquí podrías guardar en la base de datos la semilla y el idPrueba
// para validación posterior (si vas a recibir el resultado)

// Salida
echo json_encode([
    'estado'      => true,
    'semilla'     => $semilla,
    'dificultad'  => $dificultad,
]);


?>
