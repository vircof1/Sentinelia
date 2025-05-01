<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Prueba");





var_dump(  PoWProtector::calcularDificultad() );

$contenido = 'hola mundo';
die;
$templateContent->setContenido($contenido);
?>
