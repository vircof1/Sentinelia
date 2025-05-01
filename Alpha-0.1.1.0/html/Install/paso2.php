<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}



$errores = procesarPost();

$hostBBDD = '';
$nombreBBDD = '';
$usuarioBBDD = '';
$passBBDD = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Si nos ha llegado un POST, recordamos los valores introducidos por el usuario.
    if (isset($_POST['db_host'])) { $hostBBDD = trim($_POST['db_host']); }
    if (isset($_POST['db_nombre'])) { $nombreBBDD = trim($_POST['db_nombre']);  }
    if (isset($_POST['db_usuar_db'])) { $usuarioBBDD = trim($_POST['db_usuar_db']); }
    if (isset($_POST['db_pas_db'])) { $passBBDD = trim($_POST['db_pas_db']); }
}



?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Instalador de Sentinelia - Conexión Base de Datos</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container py-5">
    <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 2 de 5</div>
    <h2 class="mb-4">Configuración de la Base de Datos MariaDB</h2>

    <?php if (!empty($errores)): ?>
        <div class="alert alert-danger">
            <h5 class="alert-heading">Se encontraron los siguientes errores:</h5>
            <ul class="mb-0">
                <?php foreach ($errores as $error): ?>
                    <li><?php echo htmlspecialchars($error); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="" class="card p-4 shadow-sm" autocomplete="off">
		<input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($_SESSION['csrf_token']); ?>">
		<input type="hidden" name="formularioBBDD" value="yes">

        <div class="mb-3">
            <label for="db_host" class="form-label">Servidor de Base de Datos (host)</label>
            <input type="text" class="form-control" id="db_host" name="db_host" placeholder="Ejemplo: localhost" autocomplete="off" value="<?php echo htmlspecialchars($hostBBDD); ?>" required>
        </div>

        <div class="mb-3">
            <label for="db_nombre" class="form-label">Nombre de la Base de Datos con cotejamiento <strong>utf8mb4_unicode_ci</strong></label>
            <input type="text" class="form-control" id="db_nombre" name="db_nombre" placeholder="Ejemplo: sentinelia_db" autocomplete="off" value="<?php echo htmlspecialchars($nombreBBDD); ?>" required>
        </div>

        <div class="mb-3">
            <label for="db_usuario" class="form-label">Usuario de base de datos</label>
            <input type="text" class="form-control" id="db_usuar_db" name="db_usuar_db" placeholder="Usuario de la base de datos" autocomplete="off" value="<?php echo htmlspecialchars($usuarioBBDD); ?>" required>
        </div>

        <div class="mb-3">
            <label for="db_password" class="form-label">Contraseña de base de datos</label>
            <input type="password" class="form-control" id="db_pas_db" name="db_pas_db" placeholder="Contraseña de la base de datos" autocomplete="off" value="<?php //echo htmlspecialchars($passBBDD); ?>">
        </div>

        <div class="text-center">
            <button type="submit" class="btn btn-success">Probar conexión y continuar</button>
        </div>

    </form>
</div>

</body>
</html>
<?php


function procesarPost() {
    // Iniciar sesión si no está iniciada
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    $errores = [];
    $hostBBDD = '';
    $nombreBBDD = '';
    $usuarioBBDD = '';
    $passBBDD = '';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {

        // Verificación del CSRF Token
        if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
            $errores[] = 'Error de seguridad: Token CSRF inválido.';
        }

        // Verificación del formulario correcto
        if (!isset($_POST['formularioBBDD']) || $_POST['formularioBBDD'] !== 'yes') {
            $errores[] = 'Error interno: formulario incorrecto.';
        }

        // Solo seguimos si no hay errores de seguridad
        if (empty($errores)) {

            // Recogemos datos
            $hostBBDD = isset($_POST['db_host']) ? trim($_POST['db_host']) : '';
            $nombreBBDD = isset($_POST['db_nombre']) ? trim($_POST['db_nombre']) : '';
            $usuarioBBDD = isset($_POST['db_usuar_db']) ? trim($_POST['db_usuar_db']) : '';
            $passBBDD = isset($_POST['db_pas_db']) ? trim($_POST['db_pas_db']) : '';

            // Comprobamos que no falten campos
            if ($hostBBDD === '' || $nombreBBDD === '' || $usuarioBBDD === '') {
                $errores[] = 'Faltan campos obligatorios. Revise el formulario.';
            }

            // Intentamos conexión a MySQL
            if (empty($errores)) {
                try {
                    mysqli_report(MYSQLI_REPORT_STRICT | MYSQLI_REPORT_ERROR); // Forzar excepciones en mysqli

                    $mysqli = new mysqli($hostBBDD, $usuarioBBDD, $passBBDD, $nombreBBDD);

                    // Conexión OK, verificamos cotejamiento
                    $consulta = $mysqli->prepare("SELECT DEFAULT_COLLATION_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?");
                    if ($consulta) {
                        $consulta->bind_param('s', $nombreBBDD);
                        $consulta->execute();
                        $resultado = $consulta->get_result();
                        if ($fila = $resultado->fetch_assoc()) {
                            if ($fila['DEFAULT_COLLATION_NAME'] !== 'utf8mb4_unicode_ci') {
                                $errores[] = 'La base de datos existe pero no usa el cotejamiento utf8mb4_unicode_ci. Cotejamiento actual: ' . htmlspecialchars($fila['DEFAULT_COLLATION_NAME']);
                            }
                        } else {
                            $errores[] = 'No se pudo verificar el cotejamiento de la base de datos.';
                        }
                        $consulta->close();
                    } else {
                        $errores[] = 'Error preparando la consulta de verificación de collation.';
                    }

                } catch (mysqli_sql_exception $e) {
                    $errores[] = 'Excepción de conexión MySQL: ' . $e->getMessage();
                }
            }
        }



		if (count($errores) === 0) {

			// 🔥 Verificamos sincronización horaria con la base de datos


			// Consulta de zona horaria configurada
			$consultaZona = $mysqli->query("SELECT @@global.time_zone AS zona_horaria");
			if ($consultaZona) {
				$filaZona = $consultaZona->fetch_assoc();
				if ($filaZona && isset($filaZona['zona_horaria'])) {
					$zonaHoraria = $filaZona['zona_horaria'];

					if ($zonaHoraria !== 'UTC' && $zonaHoraria !== '+00:00') {
						$errores[] = 'La base de datos no está configurada para usar UTC. Zona horaria actual: ' . htmlspecialchars($zonaHoraria);
					}
				} else {
					$errores[] = 'No se pudo obtener la zona horaria actual de la base de datos.';
				}
			} else {
				$errores[] = 'Error ejecutando consulta de zona horaria en la base de datos.';
			}



			// Consulta de hora actual
			$consultaHora = $mysqli->query("SELECT NOW() AS fecha_hora");
			if ($consultaHora) {
				$filaHora = $consultaHora->fetch_assoc();
				if ($filaHora && isset($filaHora['fecha_hora'])) {
					$horaPHP = time(); // Timestamp PHP
					$timestampMySQL = strtotime($filaHora['fecha_hora']); // Timestamp MySQL

					$diferenciaSegundos = abs($horaPHP - $timestampMySQL);

					if ($diferenciaSegundos > 30) { // Permitimos 30 segundos máximo de diferencia
						$errores[] = 'La hora del servidor de base de datos no está sincronizada con PHP. Diferencia de ' . $diferenciaSegundos . ' segundos. Es posible que tengas la base de datos en otro uso horario que no sea UTC.';
					}
				} else {
					$errores[] = 'No se pudo obtener la hora actual de la base de datos.';
				}
			} else {
				$errores[] = 'Error ejecutando consulta de hora en la base de datos.';
			}
			
			
			// Verificamos permisos en la base de datos:
			
			if (count($errores) === 0) {
				try {
					$resultadoGrants = $mysqli->query("SHOW GRANTS FOR CURRENT_USER()");
					if ($resultadoGrants) {
						$permisos = '';
						while ($filaGrant = $resultadoGrants->fetch_row()) {
							$permisos .= strtoupper($filaGrant[0]) . ' ';
							echo $permisos;
						}

						// Ahora buscamos si están los permisos críticos
						if (strpos($permisos, 'ALL PRIVILEGES') === false) {
							// Solo buscamos permisos individuales si no tiene ALL PRIVILEGES
							$permisosNecesarios = ['CREATE', 'INSERT', 'ALTER', 'SELECT', 'UPDATE', 'DELETE'];
							foreach ($permisosNecesarios as $permiso) {
								if (strpos($permisos, $permiso) === false) {
									$errores[] = 'El usuario de la base de datos no tiene el privilegio necesario: ' . $permiso;
								}
							}
						}
					} else {
						$errores[] = 'No se pudieron comprobar los privilegios del usuario en la base de datos.';
					}
				} catch (mysqli_sql_exception $e) {
					$errores[] = 'Error verificando privilegios: ' . $e->getMessage();
				}
			}			


		}




		if (count($errores) === 0) {
			$_SESSION['sentinelia_instalador'] = [
				'db_host'   => $hostBBDD,
				'db_nombre' => $nombreBBDD,
				'db_usuario'=> $usuarioBBDD,
				'db_pass'   => $passBBDD,
			];

			header('Location: paso3.php');
			exit;
		}
        
    }
    return $errores;
}






?>
