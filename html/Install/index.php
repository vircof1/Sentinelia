<?php
include "./funciones.php";

// Llamamos a la función para comprobar permisos
$permisoVariables_php = comprobarPermisoArchivoRaiz('Variables.php');
$permisoIndex_php = comprobarPermisoArchivoRaiz('index.php');
$permisoReceptorTiket_php = comprobarPermisoArchivoRaiz('ReceptorTiket.php');





// verificamos la integridad del instalador... que no podemos validar porque la estamos tocando.... ya veremos luego que hacemos....
$hashesTMP = calcularHashesDirectorio(__DIR__ . '/../Install/' );
$hashMaestroTMP = calcularHashMaestro($hashesTMP);
$hashValidoINSTALL = verificarHashDirectorio(__DIR__ . '/../Install/', $hashMaestroTMP);

// Verificamos integridad del framework:
$hashValidoEnFramework = verificarHashDirectorio(__DIR__ . '/../VirsoftFramework2/', '2e56925cc5bf0dc301dec0d95e1e7fec3e55e5e43e265ee856e9384336d54047');

// Verificamos la integridad del template:
$hashValidoTemplate = verificarHashDirectorio(__DIR__ . '/../Template/', 'accf703190ad665832c659552b27e4c7b8d1b99e2b0e2d3b11269975fe820f79');

// Carpeta AJAX
$hashValidoAJAX = verificarHashDirectorio(__DIR__ . '/../AJAX/', '4b5f0ca62ede36f6eef8de0744c571a0c9882c77e9894d05a54c6e47904156f9');


// Zona horaria del sistema:
$timezone = date_default_timezone_get();
if ($timezone === 'UTC') {
    $timeZoneUTC = true;
} else {
    $timeZoneUTC = false;
}

// verificamos modulos php instalados
$modulosPHP = verificarModulosPHPRequeridos();

?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Instalador de Sentinelia - Comprobación Inicial</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container py-5">
    <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 1 de 5</div>
    <h2 class="mb-4">Verificacion de permisos e integridad</h2>
    

    <div class="card mb-4">
        <div class="card-header">
            Comprobación de permisos
        </div>
        <ul class="list-group list-group-flush">
            <?php
            $todosPermisos = [$permisoVariables_php, $permisoIndex_php, $permisoReceptorTiket_php];
            $permisosOk = true;

            foreach ($todosPermisos as $permiso) {
                if ($permiso['estado'] === true) {
                    echo '<li class="list-group-item text-success">' . htmlspecialchars($permiso['mensaje']) . '</li>';
                } else {
                    echo '<li class="list-group-item text-danger">' . htmlspecialchars($permiso['mensaje']) . '</li>';
                    $permisosOk = false;
                }
            }
            ?>
        </ul>
    </div>

    <div class="card mb-4">
        <div class="card-header">
            Comprobación de integridad
        </div>
        <ul class="list-group list-group-flush">
            <?php
            $integridadOk = true;

            if ($hashValidoINSTALL === true) {
                echo '<li class="list-group-item text-success">Integridad del instalador: OK</li>';
            } else {
                echo '<li class="list-group-item text-danger">Integridad del instalador: FALLIDA</li>';
                $integridadOk = false;
            }

            if ($hashValidoEnFramework === true) {
                echo '<li class="list-group-item text-success">Integridad del Framework: OK</li>';
            } else {
                echo '<li class="list-group-item text-danger">Integridad del Framework: FALLIDA</li>';
                $integridadOk = false;
            }

            if ($hashValidoTemplate === true) {
                echo '<li class="list-group-item text-success">Integridad del Template: OK</li>';
            } else {
                echo '<li class="list-group-item text-danger">Integridad del Template: FALLIDA</li>';
                $integridadOk = false;
            }

            if ($hashValidoAJAX === true) {
                echo '<li class="list-group-item text-success">Integridad de la carpeta AJAX: OK</li>';
            } else {
                echo '<li class="list-group-item text-danger">Integridad de la carpeta AJAX: FALLIDA</li>';
                $integridadOk = false;
            }
            
            
            
            ?>
        </ul>
    </div>
    
  
    <div class="card mb-4">
        <div class="card-header">
            Zona horaria del sistema:
        </div>
        <ul class="list-group list-group-flush">
			

		<?php	
		//$timeZoneUTC = false;
		if ($timeZoneUTC === true) {
			echo '<li class="list-group-item text-success">Zona horaria del sistema en UTC: OK</li>';
		} else {
			echo '<li class="list-group-item text-danger"> El sistema donde se ejecuta PHP NO está en UTC. Zona actual: ' . htmlspecialchars($timezone).'</li>';
			$integridadOk = false;
		}
        ?>
        
        
        </ul>
    </div>
    
    
    
	<div class="card mb-4">
		<div class="card-header">
			Verificación de módulos PHP
		</div>
		<ul class="list-group list-group-flush">
			<?php
			if ($modulosPHP['estado'] === true) {
				echo '<li class="list-group-item text-success">' . htmlspecialchars($modulosPHP['mensaje']) . '</li>';
			} else {
				foreach ($modulosPHP['mensaje'] as $error) {
					echo '<li class="list-group-item text-danger">' . htmlspecialchars($error) . '</li>';
				}
				$integridadOk = false;
			}
			?>
		</ul>
	</div>
    
    
    
    

    <div class="text-center">
        <?php if ($permisosOk === true && $integridadOk === true): ?>
            <form method="GET" action="paso2.php">
                <button type="submit" class="btn btn-success">Continuar instalación</button>
            </form>
        <?php else: ?>
            <div class="alert alert-danger" role="alert">
                No puede continuar. Corrija los errores detectados antes de seguir con la instalación.
            </div>
        <?php endif; ?>
    </div>
</div>

</body>
</html>
