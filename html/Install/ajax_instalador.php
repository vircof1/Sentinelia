<?php
session_start();
header('Content-Type: application/json');

// Seguridad mínima
if (!isset($_SESSION['sentinelia_instalador']) || !isset($_SESSION['sentinelia_instalador_usuario'])) {
    echo json_encode(['estado' => 'error', 'mensaje' => 'Sesión inválida.']);
    exit;
}


$controlIncludes = true;

// Simulación: número total de pasos
if (isset($_GET['getPasos'])) {
    echo json_encode([
        'estado' => 'ok',
        'total' => 10  // Puedes cambiar este valor para probar distintos escenarios
    ]);
    exit;
}

// Simulación: ejecución de paso específico
if (isset($_GET['paso'])) {
    $paso = intval($_GET['paso']);

    // Simulación de retardo artificial para mayor realismo
    //usleep(1000000); // 1 segundos

    switch ($paso) {
        case 1:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Creada tabla de usuarios']);
            require __DIR__ . '/includes/instalar_paso1_usuarios_tablaNEW.php';
            echo json_encode( ejecutarPaso() );
            break;
        case 2:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Insertada configuración inicial']);
            require __DIR__ . '/includes/instalar_paso2_usuario_admin.php';
			echo json_encode(ejecutarPaso());
            break;
        case 3:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Creada tabla de logs']);
            require __DIR__ . '/includes/instalar_paso3_tabla_configuracion.php';
			echo json_encode(ejecutarPaso());
            break;
        case 4:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Creada tabla de monitoreo']);
            require __DIR__ . '/includes/instalar_paso4_insertar_configuracion.php';
			echo json_encode(ejecutarPaso());
            break;
        case 5:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Creada tabla pow_actors']);
			require __DIR__ . '/includes/instalar_paso5_tabla_powactors.php';
			echo json_encode(ejecutarPaso());
            break;
        case 6:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Omitido el paso 6 Tabla log']);
            require __DIR__ . '/includes/instalar_paso6_tabla_log.php';
			echo json_encode(ejecutarPaso());
            break;
		case 7:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Omitido el paso 7 tabla de monitoreo']);
			$controlIncludes = true;
			require __DIR__ . '/includes/instalar_paso7_tabla_monitoreo.php';
			echo json_encode(ejecutarPaso());
			break;
		case 8:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Omitido el paso 8 Ejemplos de tareas']);
			$controlIncludes = true;
			require __DIR__ . '/includes/instalar_paso8_insertar_tareas_ejemplo.php';
			echo json_encode(ejecutarPaso());
			break;
		case 9:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Omitido el paso 9 Creaccion del index.php']);
			require __DIR__ . '/includes/instalar_paso9_generar_index.php';
			echo json_encode(ejecutarPaso());
			break;		
		case 10:
			// -- Posible simulacion de paso
            //echo json_encode(['estado' => 'ok', 'mensaje' => 'Omitido el paso 10 Creaccion del Variables.php']);
			require __DIR__ . '/includes/instalar_paso10_variables_php.php';
			echo json_encode(ejecutarPaso());
			break;
						
        default:
            echo json_encode(['estado' => 'error', 'mensaje' => 'Paso no válido o fuera de rango']);
            break;
    }
    exit;
}

// Fallback
echo json_encode(['estado' => 'error', 'mensaje' => 'Petición inválida']);
exit;
