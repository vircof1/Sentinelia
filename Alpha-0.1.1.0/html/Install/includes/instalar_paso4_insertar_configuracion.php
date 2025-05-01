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

        // Definir claves por defecto
        $clavesPorDefecto = [
            ['requirePassComplexity', '0', 'bool', '¿Requiere complejidad de contraseña?'],
            ['minPassLength', '3', 'int', 'Longitud mínima de contraseña'],
            ['passRequireNumbers', '1', 'bool', '¿Requiere números en contraseña?'],
            ['passRequireUppercase', '1', 'bool', '¿Requiere mayúsculas en contraseña?'],
            ['passRequireSymbols', '0', 'bool', '¿Requiere símbolos en contraseña?'],
            ['configuracionVersion', '1', 'int', 'Versión inicial de configuración'],
            ['ultimoDelayLogin', '0', 'int', 'Tiempo de login más lento registrado'],
            ['PoW_dificultadMinima', '17', 'int', 'Dificultad mínima para la prueba de trabajo'],
            ['PoW_dificultadMaxima', '35', 'int', 'Dificultad máxima para la prueba de trabajo'],
            ['PoW_tiempoObjetivoMaximo', '30', 'int', 'Tiempo objetivo límite para PoW'],
            ['PoW_reintentosMaximos', '15', 'int', 'Máximo histórico de reintentos'],
            ['PoW_reintentosSinEscalar', '5', 'int', 'Reintentos sin escalar dificultad'],
            ['PoW_tiempoPerdonIP', '30', 'int', 'Minutos sin reintentos para reiniciar dificultad'],
            ['InfoNombreServidor', 'Sentinelia', 'string', 'Nombre del servidor'],
            ['InfoNombreEmpresa', 'Nombre Empresa', 'string', 'Nombre de la empresa'],
            ['InfoPais', 'País', 'string', 'País de la instancia'],
            ['InfoPoblacion', 'Ciudad', 'string', 'Población de la instancia'],
            ['InfoDataCenter', 'Centro de datos', 'string', 'Nombre del CPD'],
            ['InfoArmarioRack', 'Armario Rack', 'string', 'Descripción de la ubicación'],
            ['urlNotificacionTiket', './ReceptorTiket.php', 'string', 'URL para envío de tickets'],
            ['metodoEnvioTiket', 'POST', 'string', 'Método HTTP para enviar tickets'],
            ['poW_dificultadMinimaPenalizada', '26', 'int', 'Dificultad en penalización máxima'],
            ['sentineliaVersion', 'Alpha 0.1.1.0', 'string', 'Versión actual del sistema'],
        ];

        // Obtener claves ya existentes
        $res = $mysqli->query("SELECT clave FROM configuracion");
        $clavesExistentes = [];
        while ($row = $res->fetch_assoc()) {
            $clavesExistentes[] = $row['clave'];
        }

        $insertadas = 0;

        foreach ($clavesPorDefecto as $clave) {
            if (!in_array($clave[0], $clavesExistentes)) {
                $stmt = $mysqli->prepare("INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES (?, ?, ?, ?)");
                $stmt->bind_param('ssss', $clave[0], $clave[1], $clave[2], $clave[3]);
                $stmt->execute();
                $stmt->close();
                $insertadas++;
            }
        }

        if ($insertadas > 0) {
            return [
                'estado' => 'ok',
                'mensaje' => "✅ Se insertaron $insertadas claves nuevas en la tabla <strong>configuracion</strong>."
            ];
        } else {
            return [
                'estado' => 'ok',
                'mensaje' => 'ℹ️ Todas las claves por defecto ya estaban presentes.'
            ];
        }

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al insertar claves: ' . $e->getMessage()
        ];
    }
}
?>
