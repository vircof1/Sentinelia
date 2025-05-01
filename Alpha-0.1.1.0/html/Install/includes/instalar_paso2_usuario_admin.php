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
        $datosUsuario = $_SESSION['sentinelia_instalador_usuario'] ?? null;

        if (!$datosBBDD || !$datosUsuario) {
            throw new Exception("Datos de sesión incompletos.");
        }

        mysqli_report(MYSQLI_REPORT_STRICT | MYSQLI_REPORT_ERROR);

        $mysqli = new mysqli(
            $datosBBDD['db_host'],
            $datosBBDD['db_usuario'],
            $datosBBDD['db_pass'],
            $datosBBDD['db_nombre']
        );

        // Preparar datos básicos
        $usuario         = $datosUsuario['usuario'];
        $email           = $datosUsuario['email'];
        $nombre          = $datosUsuario['nombre'];
        $apellidos       = $datosUsuario['apellidos'];
        $estadoCuenta    = 'Activa';
        $superUsuario    = 0;
        $adminUser       = 1;
        $adminSettings   = 1;
        $permEdit        = 1;
        $permRead        = 1;
        $permAudit       = 1;

		$check = $mysqli->prepare("SELECT Usuario, Email, Pass, SaltOfPass FROM Usuarios WHERE Usuario = ? OR Email = ?");
		$check->bind_param('ss', $usuario, $email);
		$check->execute();
		$resultado = $check->get_result();

		if ($fila = $resultado->fetch_assoc()) {
			// Coinciden exactamente usuario y email
			if ($fila['Usuario'] === $usuario && $fila['Email'] === $email) {
				$hashCheck = hash_pbkdf2('sha256', $datosUsuario['pass'], $fila['SaltOfPass'], 1000000, 32, true);
				if (bin2hex($hashCheck) === $fila['Pass']) {
					// Todo coincide, consideramos válido y continuamos
					return [
						'estado' => 'ok',
						'mensaje' => '✅ Usuario ya existente con credenciales válidas. Continuamos.'
					];
				} else {
					return [
						'estado' => 'error',
						'mensaje' => '🔒 Usuario ya existe pero la contraseña no coincide.'
					];
				}
			} else {
				return [
					'estado' => 'error',
					'mensaje' => '⚠️ Ya existe otro usuario con el mismo nombre o email.'
				];
			}
		}
        $check->close();

        // Cifrar contraseña
        $salt = bin2hex(random_bytes(32));
        $hash = hash_pbkdf2('sha256', $datosUsuario['pass'], $salt, 1000000, 32, true);
        $passHash = bin2hex($hash);

        // Insertar
        $stmt = $mysqli->prepare("
            INSERT INTO Usuarios (
                Usuario, Email, Pass, SaltOfPass,
                SuperUsuario, DefaultAdminUserS, defaultAdminSettings,
                DefaultEdit, DefaultRead, DefaultAudit,
                Nombre, Apellidos, FechaRegistro, EstadoCuenta
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
        ");

        if (!$stmt) {
            throw new Exception("No se pudo preparar la sentencia SQL.");
        }

        $stmt->bind_param(
            'ssssiiiiiiiss',
            $usuario,
            $email,
            $passHash,
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

        $stmt->execute();
        $stmt->close();

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Usuario administrador creado y contraseña cifrada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear el usuario admin: ' . $e->getMessage()
        ];
    }
}
?>
