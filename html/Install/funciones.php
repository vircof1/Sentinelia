<?php

function verificarModulosPHPRequeridos() {
    $requeridos = [
        'mysqli' => 'Extensión mysqli (requerida para conexión con la base de datos)',
        'json' => 'Extensión json (para manejo de datos)',
        'mbstring' => 'Extensión mbstring (para UTF-8)',
        'openssl' => 'Extensión openssl (para cifrado y funciones hash)',
        'pdo_mysql' => 'Extensión pdo_mysql (para acceso alternativo a BD)',
        'date' => 'Extensión date (necesaria para manipulación de fechas y zona horaria)',
    ];

    $faltantes = [];

    foreach ($requeridos as $modulo => $descripcion) {
        if (!extension_loaded($modulo)) {
            $faltantes[] = "❌ $descripcion no está cargada.";
        }
    }

    if (empty($faltantes)) {
        return ['estado' => true, 'mensaje' => 'Todos los módulos PHP requeridos están presentes.'];
    } else {
        return ['estado' => false, 'mensaje' => $faltantes];
    }
}

function comprobarPermisoArchivoRaiz($fileRaiz): array
{
    $archivo = __DIR__ . '/../' . $fileRaiz;
    
    if (file_exists($archivo)) {
        if (is_writable($archivo)) {
            return ['estado' => true, 'mensaje' => 'Archivo '.$fileRaiz.' disponible para escritura.'];
        } else {
            return ['estado' => false, 'mensaje' => 'El archivo '.$fileRaiz.' existe, pero no tiene permiso de escritura.'];
        }
    } else {
        if (is_writable(__DIR__)) {
            return ['estado' => true, 'mensaje' => 'No existe '.$fileRaiz.', pero se puede crear en el directorio.'];
        } else {
            return ['estado' => false, 'mensaje' => 'No existe '.$fileRaiz.' y no se puede crear porque el directorio no es escribible.'];
        }
    }
}



function calcularHashesDirectorio(string $directorio): array
{
    $hashes = [];

    $directorioReal = realpath($directorio);
    if ($directorioReal === false || !is_dir($directorioReal)) {
        return $hashes;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directorioReal, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $archivo) {
        if ($archivo->isFile()) {
            $rutaRelativa = str_replace($directorioReal . DIRECTORY_SEPARATOR, '', $archivo->getPathname());
            $hash = hash_file('sha256', $archivo->getPathname());
            $hashes[$rutaRelativa] = $hash;
        }
    }

    return $hashes;
}

function calcularHashMaestro(array $hashes): string
{
    ksort($hashes); // Ordenamos por ruta para que sea siempre igual, aunque el sistema de archivos sea diferente

    $concat = '';

    foreach ($hashes as $ruta => $hash) {
        $concat .= $ruta . ':' . $hash . "\n"; // Unimos ruta y hash, separados por dos puntos
    }

    return hash('sha256', $concat);
}

function verificarHashDirectorio(string $directorio, string $hashEsperado): bool
{
    $hashes = calcularHashesDirectorio($directorio);
    $hashCalculado = calcularHashMaestro($hashes);
    
    return ($hashCalculado === $hashEsperado);
}

?>
