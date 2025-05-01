<?php
if (!isset($controlIncludes) || !$controlIncludes) {
    exit;
}

function ejecutarPaso()
{
    try {
        $rutaDestino = realpath(__DIR__ . '/../..') . '/index.php';

        $contenido = <<<PHP
<?php
\$GLOBALS['virsoft'] = null;

require "./Variables.php";
\$virsoftControlInclude = true;
define('VIRSOFT_CONTROL_INCLUDE', true);
require \$configuracionVirsoft['framework_path'] . "framework.php" ;
?>
PHP;

        if (file_put_contents($rutaDestino, $contenido) === false) {
            throw new Exception("No se pudo escribir el archivo en $rutaDestino");
        }

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Archivo <strong>index.php</strong> generado correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al generar index.php: ' . $e->getMessage()
        ];
    }
}
?>
