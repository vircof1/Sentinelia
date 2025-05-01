<?php
function generarHashSalt($contrasena, $salt) {
	// Parámetros de PBKDF2
	$algoritmo = 'sha256';
	$iteraciones = 1000000;
	$tamanioClave = 32; // En bytes

	// Generar clave derivada con PBKDF2
	$claveDerivada = hash_pbkdf2($algoritmo, $contrasena, $salt, $iteraciones, $tamanioClave, true);

	// Convertir la clave derivada a una representación legible (hexadecimal)
	$claveHex = bin2hex($claveDerivada);

	return $claveHex;
	/*
	Ejemplo de uso:
	$contrasena = 'password123';
	$salt = 'uniquesalt';

	$claveDerivada = $virsoft->generarHashSalt($contrasena, $salt);
	*/
		
}











if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json');

// CSRF
if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
    echo json_encode(['estado' => 'error', 'motivo' => 'Token CSRF inválido.']);
    exit;
}

// Datos de sesión
if (!isset($_SESSION['sentinelia_instalador']) || !isset($_SESSION['sentinelia_instalador_usuario'])) {
    echo json_encode(['estado' => 'error', 'motivo' => 'Sesión incompleta. Reinicie la instalación.']);
    exit;
}

$bbdd = $_SESSION['sentinelia_instalador'];
$user = $_SESSION['sentinelia_instalador_usuario'];

try {
    mysqli_report(MYSQLI_REPORT_STRICT | MYSQLI_REPORT_ERROR);

    $mysqli = new mysqli(
        $bbdd['db_host'],
        $bbdd['db_usuario'],
        $bbdd['db_pass'],
        $bbdd['db_nombre']
    );

    // ⚙️ Crear tabla Usuarios si no existe
    $sqlUsuarios = "
    CREATE TABLE IF NOT EXISTS Usuarios (
        ID INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        Usuario VARCHAR(254) NOT NULL UNIQUE,
        Email VARCHAR(254) NOT NULL UNIQUE,
        telefono VARCHAR(64) NOT NULL DEFAULT '',
        fechaNacimiento DATE DEFAULT NULL,
        Pass VARCHAR(255) NOT NULL,
        SaltOfPass VARCHAR(255) NOT NULL,
        SuperUsuario TINYINT(1) NOT NULL DEFAULT 0,
        DefaultAdminUserS TINYINT(1) NOT NULL DEFAULT 0,
        defaultAdminSettings TINYINT(4) NOT NULL DEFAULT 0,
        DefaultEdit TINYINT(1) NOT NULL DEFAULT 0,
        DefaultRead TINYINT(1) NOT NULL DEFAULT 0,
        DefaultAudit TINYINT(4) NOT NULL DEFAULT 0,
        Nombre VARCHAR(100) NOT NULL,
        Apellidos VARCHAR(100) NOT NULL,
        FechaRegistro DATETIME NOT NULL,
        UltimaFechaInicioSesion DATETIME DEFAULT NULL,
        ContadorInicioSesion INT(32) DEFAULT 0,
        EstadoCuenta VARCHAR(64) NOT NULL,
        sidebarHide INT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    ";
    $mysqli->query($sqlUsuarios);

    // ⚙️ Crear tabla Configuracion si no existe
    $sqlConfiguracion = "
    CREATE TABLE IF NOT EXISTS configuracion (
        id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        clave VARCHAR(64) NOT NULL,
        valor TEXT NOT NULL,
        tipo ENUM('bool','int','string','array') NOT NULL,
        descripcion TEXT DEFAULT NULL,
        actualizado TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY clave_idx (clave)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ";
    $mysqli->query($sqlConfiguracion);

    // Variables locales necesarias para bind_param
    $usuario         = $user['usuario'];
    $email           = $user['email'];
    $nombre          = $user['nombre'];
    $apellidos       = $user['apellidos'];
    $estadoCuenta    = 'Activa';

    $superUsuario    = 0;
    $adminUser       = 1;
    $adminSettings   = 1;
    $permEdit        = 1;
    $permRead        = 1;
    $permAudit       = 1;




    // Salt y password con salt (hash ya predefinido)
    $salt = bin2hex(random_bytes(32));
    $pass = generarHashSalt($user['pass'], $salt); // Debes tener esta función disponible

    // Insert primer usuario
    $stmt = $mysqli->prepare("
        INSERT INTO Usuarios (
            Usuario, Email, Pass, SaltOfPass,
            SuperUsuario, DefaultAdminUserS, defaultAdminSettings,
            DefaultEdit, DefaultRead, DefaultAudit,
            Nombre, Apellidos, FechaRegistro, EstadoCuenta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    ");

    if (!$stmt) {
        throw new Exception("Error preparando la inserción de usuario.");
    }

	$stmt->bind_param(
		'ssssiiiisssss',
        $usuario,
        $email,
        $pass,
        $salt,
        $superUsuario,
        $adminUser,
        $adminSettings,
        $permEdit,
        $permRead,
        $permAudit,
        $nombre,
        $apellidos,
        $estadoCuenta
    );
    // Tabla Log
   $sqlLog = "
	CREATE TABLE IF NOT EXISTS log (
		id_log BIGINT(20) NOT NULL AUTO_INCREMENT PRIMARY KEY,
		id_monitoreo INT(11) NOT NULL,
		tipo_tarea VARCHAR(50) NOT NULL,
		estado_actual VARCHAR(10) NOT NULL,
		cantidad_eventos BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
		cantidadMaximaDeEventos INT(11) DEFAULT NULL,
		fecha_inicio_estado DATETIME NOT NULL,
		fecha_fin_estado DATETIME DEFAULT NULL,
		motivo_estado TEXT DEFAULT NULL,
		nivel_alerta VARCHAR(20) DEFAULT 'información',
		ultima_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		KEY idx_id_monitoreo (id_monitoreo)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	";
	$mysqli->query($sqlLog);
	
	// Tabla Monitoreo
	$sqlMonitoreo = "
	CREATE TABLE IF NOT EXISTS monitoreo (
		id_monitoreo INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
		nombre_servicio VARCHAR(255) NOT NULL,
		url_servicio VARCHAR(255) NOT NULL,
		usuario_SQL VARCHAR(255) DEFAULT NULL,
		pass_SQL VARCHAR(255) DEFAULT NULL,
		NombreBaseDeDatos_SQL VARCHAR(255) DEFAULT NULL,
		tipo_prueba ENUM('ping','tcp','consulta') NOT NULL,
		umbral INT(11) DEFAULT NULL,
		puerto_tcp INT(11) DEFAULT NULL,
		texto_consulta TEXT DEFAULT NULL,
		intervalo_minutos INT(11) UNSIGNED NOT NULL,
		ultima_ejecucion TIMESTAMP NULL DEFAULT NULL,
		estado_resultado ENUM('éxito','fallo') NOT NULL,
		tiempo_respuesta DECIMAL(10,2) DEFAULT NULL,
		texto_resultado TEXT DEFAULT NULL,
		mensaje_alerta VARCHAR(255) DEFAULT NULL,
		nivel_alerta ENUM('información','advertencia','crítico') DEFAULT NULL,
		hora_alerta TIMESTAMP NULL DEFAULT NULL,
		creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
		proxima_ejecucion DATETIME DEFAULT CURRENT_TIMESTAMP,
		intentos_permitidos INT(11) UNSIGNED DEFAULT 3,
		intentos_fallidos_actuales INT(11) DEFAULT 0,
		TareaHabilitada TINYINT(2) NOT NULL DEFAULT 1,
		descripcion_fallo VARCHAR(256) NOT NULL DEFAULT '',
		posible_causa VARCHAR(256) NOT NULL DEFAULT '',
		TareaNegada TINYINT(1) NOT NULL DEFAULT 0,
		registrar_ip TINYINT(1) NOT NULL DEFAULT 0,
		fechaCreacionMonitor DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		KEY idx_proxima_ejecucion (proxima_ejecucion),
		KEY idx_TareaHabilitada (TareaHabilitada)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	";
	$mysqli->query($sqlMonitoreo);
	
	
	// Actores PoW
	$sqlPowActors = "
	CREATE TABLE IF NOT EXISTS pow_actors (
		ip VARCHAR(45) NOT NULL PRIMARY KEY,
		reintentos INT(10) UNSIGNED NOT NULL DEFAULT 0,
		ultimo_nonce BIGINT(20) UNSIGNED DEFAULT NULL,
		tiempo_resolucion INT(10) UNSIGNED DEFAULT NULL,
		hashes_por_segundo FLOAT DEFAULT NULL,
		fecha_ultimo_intento DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		KEY idx_fecha_ultimo_intento (fecha_ultimo_intento)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	";
	$mysqli->query($sqlPowActors);

    $stmt->execute();
    $stmt->close();

    // ⚙️ Insertar valores por defecto en configuracion (solo si está vacía)
    $resultado = $mysqli->query("SELECT COUNT(*) as total FROM configuracion");
    $fila = $resultado->fetch_assoc();

    if ((int)$fila['total'] === 0) {
        $sqlDefaults = "
        INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES
        ('requirePassComplexity', '0', 'bool', '¿Requiere complejidad de contraseña?'),
        ('minPassLength', '3', 'int', 'Longitud mínima de contraseña'),
        ('passRequireNumbers', '1', 'bool', '¿Requiere números en contraseña?'),
        ('passRequireUppercase', '1', 'bool', '¿Requiere mayúsculas en contraseña?'),
        ('passRequireSymbols', '0', 'bool', '¿Requiere símbolos en contraseña?'),
        ('configuracionVersion', '1', 'int', 'Versión inicial de configuración'),
        ('ultimoDelayLogin', '0', 'int', 'Tiempo de login más lento registrado'),
        ('PoW_dificultadMinima', '17', 'int', 'Dificultad mínima para la prueba de trabajo'),
        ('PoW_dificultadMaxima', '35', 'int', 'Dificultad máxima para la prueba de trabajo'),
        ('PoW_tiempoObjetivoMaximo', '30', 'int', 'Tiempo objetivo límite para PoW'),
        ('PoW_reintentosMaximos', '15', 'int', 'Máximo histórico de reintentos'),
        ('PoW_reintentosSinEscalar', '5', 'int', 'Reintentos sin escalar dificultad'),
        ('PoW_tiempoPerdonIP', '30', 'int', 'Minutos sin reintentos para reiniciar dificultad'),
        ('InfoNombreServidor', 'Sentinelia', 'string', 'Nombre del servidor'),
        ('InfoNombreEmpresa', 'Nombre Empresa', 'string', 'Nombre de la empresa'),
        ('InfoPais', 'País', 'string', 'País de la instancia'),
        ('InfoPoblacion', 'Ciudad', 'string', 'Población de la instancia'),
        ('InfoDataCenter', 'Centro de datos', 'string', 'Nombre del CPD'),
        ('InfoArmarioRack', 'Armario Rack', 'string', 'Descripción de la ubicación'),
        ('urlNotificacionTiket', './ReceptorTiket.php', 'string', 'URL para envío de tickets'),
        ('metodoEnvioTiket', 'POST', 'string', 'Método HTTP para enviar tickets'),
        ('poW_dificultadMinimaPenalizada', '26', 'int', 'Dificultad en penalización máxima'),
        ('sentineliaVersion', 'Alpha 0.1.1.0', 'string', 'Versión actual del sistema')
        ";
        $mysqli->query($sqlDefaults);
    }

    echo json_encode(['estado' => 'ok']);
    exit;

} catch (mysqli_sql_exception $e) {
    echo json_encode(['estado' => 'error', 'motivo' => 'MySQL error: ' . $e->getMessage()]);
    exit;
} catch (Exception $e) {
    echo json_encode(['estado' => 'error', 'motivo' => 'Error: ' . $e->getMessage()]);
    exit;
}

