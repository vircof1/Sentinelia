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

        // Ruta directa al destino (misma carpeta donde está index.php)
        $rutaVariables = realpath(__DIR__ . '/../..') . '/Variables.php';

        // Escapar valores
        $host   = addslashes($datosBBDD['db_host']);
        $user   = addslashes($datosBBDD['db_usuario']);
        $pass   = addslashes($datosBBDD['db_pass']);
        $dbname = addslashes($datosBBDD['db_nombre']);
        
        // calculamos el directorio del framework:
        $framework_path = realpath(__DIR__ . '/../..') . '/VirsoftFramework2/';

        // Contenido del archivo
        $contenido = <<<PHP
<?php

\$configuracionVirsoft = [
    'framework_path' => '$framework_path',           // Patch absoluto del Framework
    'frameworkDebug' => false,                                        // Modo Debug: de una version anterior.
    'frameworkDebugHTML' => "",                                       // Variable log salida debug

                                                                      // Datos Mariadb:
    'db_host_mariaDB' => '$host',								
    'db_user_mariaDB' => '$user',
    'db_password_mariaDB' => '$pass',
    'db_name_mariaDB' => '$dbname',

                                                                      // Otras configuraciones...
                                                                      // Scripts que se cargaran al principio y al final:
    'scriptsHead' => '',
    'scriptsFooter' => '',
];

\$templateTextoJsLog = '';

?>
PHP;

        if (file_put_contents($rutaVariables, $contenido) === false) {
            throw new Exception("No se pudo escribir Variables.php en $rutaVariables");
        }

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Archivo <strong>Variables.php</strong> generado correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al generar Variables.php: ' . $e->getMessage()
        ];
    }
}
?>
