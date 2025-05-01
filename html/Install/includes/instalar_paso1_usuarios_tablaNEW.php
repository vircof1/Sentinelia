<?php
if (!isset($controlIncludes) || !$controlIncludes) {
    die('Include no valido');
}

function ejecutarPaso()
{
    try {
		// la sesion ya esta activa.....
        //session_start();
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

        $sql = "
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

        $mysqli->query($sql);

        return [
            'estado' => 'ok',
            'mensaje' => '✅ Tabla <strong>Usuarios</strong> creada correctamente.'
        ];

    } catch (Exception $e) {
        return [
            'estado' => 'error',
            'mensaje' => '❌ Error al crear tabla Usuarios: ' . $e->getMessage()
        ];
    }
}

?>
