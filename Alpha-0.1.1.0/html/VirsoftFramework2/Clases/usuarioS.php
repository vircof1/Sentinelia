<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class usuarioS {
	
    private function __construct() {} // Clase 100% estática
    
    private static function camposUsuario(){
		return implode(", ", [
			"ID", "Usuario", "Email", "Nombre", "Apellidos", "EstadoCuenta",
			"DefaultEdit", "DefaultRead", "DefaultAudit", "DefaultAdminUserS", "SuperUsuario",
			"FechaRegistro", "UltimaFechaInicioSesion", "ContadorInicioSesion", "sidebarHide",
			"telefono", "fechaNacimiento", "defaultAdminSettings"
		]);
	}

    // 🔐 Solo superusuarios o admins pueden acceder a manipular usuarios
    private static function checkPermisoAdminUserS() {
        if (!isset($GLOBALS['usuario'])) {
            throw new Exception("Permiso denegado: no tienes autorización para modificar usuarios.");
        }
    }

    // ✅ Obtener listado de usuarios (básico, sin passwords)
    public static function listarUsuarios() {
        //self::checkPermisoAdminUserS();
        global $virsoft;
        
        $sql = "SELECT " . self::camposUsuario() ." 
                FROM Usuarios WHERE 1=?
                ORDER BY Usuario ASC";
		// Debemos pasar almenos un parametro a virsoft.
		$params = [
			['type' => 'i', 'value' => 1 ],
		];
		$resultadoSQL = $virsoft->ejecutarConsultaPreparada($sql, $params);
		
		
		$salidaDatos = [];
		foreach ($resultadoSQL as $filaUsuario){
			// Liveramos la informacion sensible.
			//unset( $filaUsuario['Pass'] );
			//unset( $filaUsuario['SaltOfPass'] );
			
			// reconvertimos los tinyINT a bool
			$filaUsuario['SuperUsuario'] = (int)$filaUsuario['SuperUsuario'] === 1;
			$filaUsuario['DefaultAdminUserS'] = (int)$filaUsuario['DefaultAdminUserS'] === 1;
			$filaUsuario['DefaultEdit'] = (int)$filaUsuario['DefaultEdit'] === 1;
			$filaUsuario['DefaultRead'] = (int)$filaUsuario['DefaultRead'] === 1;
			$filaUsuario['DefaultAudit'] = (int)$filaUsuario['DefaultAudit'] === 1;
			$salidaDatos []=$filaUsuario;
			//Solo damos la info de la base de datos....
		}
        return $salidaDatos;
    }

    // ✅ Obtener info pública de un usuario
    public static function getInfoPublica($idUsuario) {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $sql = "SELECT ID, Usuario, Email, Nombre, Apellidos, EstadoCuenta, 
                       DefaultEdit, DefaultRead, DefaultAudit, DefaultAdminUserS, SuperUsuario 
                FROM Usuarios 
                WHERE ID = ?";
        $params = [
            ['type' => 'i', 'value' => $idUsuario]
        ];

        return $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
    }
    
    
    
	public static function getInfoUsuario($idUsuario) {
		self::checkPermisoAdminUserS();

		global $virsoft;
		$sql = "SELECT ".
				self::camposUsuario()
				."
				FROM Usuarios 
				WHERE ID = ?";
		$params = [
			['type' => 'i', 'value' => $idUsuario]
		];

		return $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
	}

    // ✅ Crear nuevo usuario
    public static function crearUsuario(
		string $usuario,
		string $email,
		string $nombre,
		string $apellidos,
		string $passPlano,
		array $roles = [],
		string $telefono = '',
		?string $fechaNacimiento = null,
		string $estadoCuenta = 'pendiente',
		int $sidebarHide = 1
	): array {
		self::checkPermisoAdminUserS();
		global $virsoft;

		$salida = ["estado" => false, "motivo" => []];

		// Comprobación previa: usuario y email únicos
		$sql = "SELECT ID FROM Usuarios WHERE Usuario = ? OR Email = ?";
		$params = [
			['type' => 's', 'value' => $usuario],
			['type' => 's', 'value' => $email]
		];
		$existe = $virsoft->ejecutarConsultaPreparada($sql, $params);
		if (is_array($existe)) {
			$salida['motivo'] = "El usuario o email ya existe.";
			return $salida;
		}

		// Generar salt y hash
		$salt = $virsoft->generarSaltAleatorio();
		$passSalt = $virsoft->generarHashSalt($passPlano, $salt);
		$fechaActual = date('Y-m-d H:i:s');

		// Preparar consulta
		$sql = "INSERT INTO Usuarios (
			Usuario, Email, Pass, SaltOfPass,
			Nombre, Apellidos, telefono, fechaNacimiento, EstadoCuenta,
			DefaultEdit, DefaultRead, DefaultAudit,
			DefaultAdminUserS, defaultAdminSettings,
			SuperUsuario,
			FechaRegistro, UltimaFechaInicioSesion,
			ContadorInicioSesion, sidebarHide
		) VALUES (
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?,
			?, ?,
			0,
			?, ?,
			0, ?
		)";

		$params = [
			['type' => 's', 'value' => $usuario],
			['type' => 's', 'value' => $email],
			['type' => 's', 'value' => $passSalt],
			['type' => 's', 'value' => $salt],
			['type' => 's', 'value' => $nombre],
			['type' => 's', 'value' => $apellidos],
			['type' => 's', 'value' => $telefono],
			['type' => 's', 'value' => ($fechaNacimiento ?: null)],
			['type' => 's', 'value' => $estadoCuenta],
			['type' => 'i', 'value' => isset($roles['edit']) ? 1 : 0],
			['type' => 'i', 'value' => isset($roles['read']) ? 1 : 0],
			['type' => 'i', 'value' => isset($roles['audit']) ? 1 : 0],
			['type' => 'i', 'value' => isset($roles['adminUserS']) ? 1 : 0],
			['type' => 'i', 'value' => isset($roles['adminSettings']) ? 1 : 0],
			['type' => 's', 'value' => $fechaActual],
			['type' => 's', 'value' => $fechaActual],
			['type' => 'i', 'value' => $sidebarHide],
		];

		$ok = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
		if ($ok) {
			$salida['estado'] = true;
		} else {
			$salida['motivo'] = "Error al insertar el usuario en la base de datos.";
		}

		return $salida;
	}


    // ✅ Actualizar info general (nombre, email, roles, estado)
    public static function actualizarUsuario($id, $email, $nombre, $apellidos, $estado, $roles = []) {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $sql = "UPDATE Usuarios SET 
                    Email = ?, Nombre = ?, Apellidos = ?, EstadoCuenta = ?, 
                    DefaultEdit = ?, DefaultRead = ?, DefaultAudit = ?, DefaultAdminUserS = ? 
                WHERE ID = ?";
        $params = [
            ['type' => 's', 'value' => $email],
            ['type' => 's', 'value' => $nombre],
            ['type' => 's', 'value' => $apellidos],
            ['type' => 's', 'value' => $estado],
            ['type' => 'i', 'value' => isset($roles['edit']) ? 1 : 0],
            ['type' => 'i', 'value' => isset($roles['read']) ? 1 : 0],
            ['type' => 'i', 'value' => isset($roles['audit']) ? 1 : 0],
            ['type' => 'i', 'value' => isset($roles['adminUserS']) ? 1 : 0],
            ['type' => 'i', 'value' => $id]
        ];

        return $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
    }

    // ✅ Cambiar solo la contraseña
    public static function cambiarPassword($id, $nuevaPassword) {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $salt = $virsoft->generarSaltAleatorio();
        $passSalt = $virsoft->generarHashSalt($nuevaPassword, $salt);

        $sql = "UPDATE Usuarios SET Pass = ?, SaltOfPass = ? WHERE ID = ?";
        $params = [
            ['type' => 's', 'value' => $passSalt],
            ['type' => 's', 'value' => $salt],
            ['type' => 'i', 'value' => $id]
        ];

        return $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
    }

    // ✅ Eliminar usuario
    public static function eliminarUsuario($id) {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $sql = "DELETE FROM Usuarios WHERE ID = ?";
        $params = [
            ['type' => 'i', 'value' => $id]
        ];
        return $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
    }

    // ✅ Buscar usuarios por texto libre (usuario, nombre, email)
    public static function buscarUsuarios($texto) {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $sql = "SELECT ID, Usuario, Nombre, Apellidos, Email, EstadoCuenta 
                FROM Usuarios 
                WHERE Usuario LIKE ? OR Email LIKE ? OR Nombre LIKE ? OR Apellidos LIKE ?
                ORDER BY Usuario ASC";
        $like = "%" . $texto . "%";
        $params = [
            ['type' => 's', 'value' => $like],
            ['type' => 's', 'value' => $like],
            ['type' => 's', 'value' => $like],
            ['type' => 's', 'value' => $like]
        ];
        return $virsoft->ejecutarConsultaPreparada($sql, $params);
    }

    // ✅ Contar total de usuarios (para paginar)
    public static function contarUsuarios() {
        self::checkPermisoAdminUserS();

        global $virsoft;
        $sql = "SELECT COUNT(*) AS total FROM Usuarios";
        $fila = $virsoft->ejecutarConsultaSQLSimple($sql);
        return intval($fila['total']);
    }
    
 public static function procesarPostEdicionCreaccion( $post ){
	$salida = [
		'estado' => false,
		'motivo' => [],
	];


	// Saneado de datos básico:
	$idUsuario = (int) trim($post['ID']);
	$nombre = trim($post['nombre'] ?? '');
	$apellidos = trim($post['apellidos'] ?? '');
	$telefono = trim($post['telefono'] ?? '');
	$email = trim($post['email'] ?? '');
	$fechaNacimiento = trim($post['fechaNacimiento'] ?? '');
	$estadoCuenta = $post['EstadoCuenta'] ?? 'Activa';
	$sidebarHide = isset($post['sidebarHide']) ? 1 : 0;

	// Permisos
	$defaultRead = isset($post['DefaultRead']) ? 1 : 0;
	$defaultEdit = isset($post['DefaultEdit']) ? 1 : 0;
	$defaultAudit = isset($post['DefaultAudit']) ? 1 : 0;
	$permAdminUserS = isset($post['permAdminUserS']) ? 1 : 0;
	$permAdminSettings = isset($post['permAdminSettings']) ? 1 : 0;

	// Validaciones:
	if ($nombre === '') {
		$salida['motivo'][] = "El nombre no puede estar vacío.";
	} elseif ( mb_strlen($nombre) > 100) {
		$salida['motivo'][] = "El nombre no puede tener más de 100 caracteres.";
	}

	if ($apellidos === '') {
		$salida['motivo'][] = "Los apellidos no pueden estar vacíos.";
	} elseif ( mb_strlen($apellidos) > 100) {
		$salida['motivo'][] = "Los apellidos no pueden tener más de 100 caracteres.";
	}

	if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
		$salida['motivo'][] = "El correo electrónico no es válido.";
	} elseif ( mb_strlen($email) > 254) {
		$salida['motivo'][] = "El correo electrónico no puede tener más de 254 caracteres.";
	}

	if ($telefono !== '' && mb_strlen($telefono) > 64) {
		$salida['motivo'][] = "El teléfono no puede tener más de 64 caracteres.";
	}

	if ( mb_strlen($estadoCuenta) > 64) {
		$salida['motivo'][] = "El estado de cuenta no puede tener más de 64 caracteres.";
	}

	if ($fechaNacimiento !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaNacimiento)) {
		$salida['motivo'][] = "La fecha de nacimiento debe estar en formato YYYY-MM-DD.";
	}
	
	global $usuario, $virsoft;
	if (!$usuario->puedeEditarUsuario($idUsuario)) {
		$salida['motivo'][] = "No tienes permisos para modificar el usuario.";
	}

	// Si hay errores, devolvemos
	if (count($salida['motivo']) > 0){
		return $salida;
	}

	// Cambio de contraseña:
	$nuevaPassword = trim($post['nuevaPassword'] ?? '');
	$repetirPassword = trim($post['repetirPassword'] ?? '');
	
	// Valor por defecto de bool cambio de clave...
	$hayCambioPassword = false;

	if ($nuevaPassword !== '' || $repetirPassword !== '') {
		if ($nuevaPassword !== $repetirPassword) {
			$salida['motivo'][] = "Las contraseñas no coinciden.";
		} else {
			$verificacion = self::validarContrasena($nuevaPassword);
			if (!$verificacion['estado']) {
				$salida['motivo'] = array_merge($salida['motivo'], $verificacion['motivo']);
			} else {
				$salt = $virsoft->generarSaltAleatorio();
				$passSalt = $virsoft->generarHashSalt($nuevaPassword, $salt);
				$hayCambioPassword = true;
			}
		}
	}

	// Ejecutamos actualización si no hay errores:
	if (count($salida['motivo']) > 0){
		return $salida;
	}





	// 🔄 Si es un nuevo usuario, llamamos a crearUsuario()
	if ($idUsuario === 0) {
		$usuarioNuevo = trim($post['usuario'] ?? '');
		if ($usuarioNuevo === '') {
			$salida['motivo'][] = "El campo 'Usuario' no puede estar vacío.";
			return $salida;
		}

		if ($nuevaPassword === '') {
			$salida['motivo'][] = "Debes establecer una contraseña inicial.";
			return $salida;
		}

		$roles = [
			'read' => $defaultRead,
			'edit' => $defaultEdit,
			'audit' => $defaultAudit,
			'adminUserS' => $permAdminUserS,
			'adminSettings' => $permAdminSettings
		];

		if ($fechaNacimiento === '') {
			$fechaNacimiento = null;
		}

		$res = self::crearUsuario(
			$usuarioNuevo,
			$email,
			$nombre,
			$apellidos,
			$nuevaPassword,
			$roles,
			$telefono,
			$fechaNacimiento,
			$estadoCuenta,
			$sidebarHide
		);

		if (!$res['estado']) {
			$salida['motivo'][] = $res['motivo'];
			return $salida;
		}

		$salida['estado'] = true;
		return $salida;
	}






	$sql = "
		UPDATE Usuarios SET
			Nombre = ?,
			Apellidos = ?,
			telefono = ?,
			Email = ?,
			fechaNacimiento = ?,
			EstadoCuenta = ?,
			sidebarHide = ?,
			DefaultRead = ?,
			DefaultEdit = ?,
			DefaultAudit = ?,
			DefaultAdminUserS = ?,
			defaultAdminSettings = ?
			" . ($hayCambioPassword ? ", Pass = ?, SaltOfPass = ?" : "") . "
		WHERE ID = ?
	";

	if ($fechaNacimiento === ''){$fechaNacimiento = null;}

	$params = [
		['type' => 's', 'value' => $nombre],
		['type' => 's', 'value' => $apellidos],
		['type' => 's', 'value' => $telefono],
		['type' => 's', 'value' => $email],
		['type' => 's', 'value' => $fechaNacimiento],
		['type' => 's', 'value' => $estadoCuenta],
		['type' => 'i', 'value' => $sidebarHide],
		['type' => 'i', 'value' => $defaultRead],
		['type' => 'i', 'value' => $defaultEdit],
		['type' => 'i', 'value' => $defaultAudit],
		['type' => 'i', 'value' => $permAdminUserS],
		['type' => 'i', 'value' => $permAdminSettings]
	];

	if ($hayCambioPassword) {
		$params[] = ['type' => 's', 'value' => $passSalt];
		$params[] = ['type' => 's', 'value' => $salt];
	}

	$params[] = ['type' => 'i', 'value' => $idUsuario];

	$resultado = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
	if (!$resultado){
		$salida['motivo'][] = "Error en la consulta SQL.";
		$usuario->debugLog($sql, 'SQL preparada UPDATE');
		$usuario->debugLog($params, 'Parámetros UPDATE');
	}

	if(count($salida['motivo']) === 0){
		$salida['estado'] = true;
	}
	return $salida;
}
	
	private static function validarContrasena($pass): array {
		global $configuracionWeb;

		$salida = array(
			'estado' => false,
			'motivo' => array()
		);

		if (mb_strlen($pass) < $configuracionWeb->getLongitudMinimaPassword()) {
			$salida['motivo'][] = 'La contraseña debe tener al menos ' . $configuracionWeb->getLongitudMinimaPassword() . ' caracteres.';
		}

		if ($configuracionWeb->getConplejidadContraseñas()) {

			if ($configuracionWeb->getRequerirNumeros() && !preg_match('/\d/', $pass)) {
				$salida['motivo'][] = 'Debe contener al menos un número.';
			}

			if ($configuracionWeb->getRequerirMayusculas() && !preg_match('/[A-Z]/', $pass)) {
				$salida['motivo'][] = 'Debe contener al menos una letra mayúscula.';
			}

			if ($configuracionWeb->getRequerirSimbolos() && !preg_match('/[\W_]/', $pass)) {
				$salida['motivo'][] = 'Debe contener al menos un símbolo o carácter especial.';
			}
		}

		// Si no se acumularon errores
		if (count($salida['motivo']) === 0) {
			$salida['estado'] = true;
		}

		return $salida;
	}
	
}
?>
