<?php
//if (!isset($virsoftControlInclude)) { die; }
//if (!$virsoftControlInclude) { die; }
defined('VIRSOFT_CONTROL_INCLUDE') or die();



$intTarea = (int)$_GET['Tarea'];
if( !$usuario->puedeEditarTarea($intTarea) ){
    $usuario->debugLog('No tienes permisos para eliminar', 'Permisos:');
    $templateContent->setToastForNextPage('No tienes permisos para eliminar esta tarea', 'warning');
    header("Location: ./", true, 302);
    exit;
}



// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Eliminar Tarea");


// Verificamos que se haya pasado una ID de tarea válida por GET
if (isset($_GET['Tarea']) && is_numeric($_GET['Tarea'])) {
    $idTarea = (int)$_GET['Tarea'];

    // Obtenemos la información de la tarea
    $sql = "SELECT * FROM `monitoreo` WHERE `id_monitoreo` = ? LIMIT 1;";
    $params = [['type' => 'i', 'value' => $idTarea]];
    $datosTarea = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

    if (is_array($datosTarea)) {
		switch ($datosTarea['tipo_prueba']){
			case 'ping':
				$tarea = new TareaPing($datosTarea);
				$urlCancelar = "./?pagina=MonitoresPING";
			break;
			
			case 'tcp':
				$tarea = new TareaTCP($datosTarea);
				$urlCancelar = "./?pagina=MonitoresTCP";
				//echo 'hola';
			break;
			
			default:
				die('Tipo de tarea no contemplado en EliminarTarea.php');
			break;
			
		}
		
        $nombreServicio = htmlspecialchars($tarea->getNombreServicio());

		// Si el usuario ha confirmado la eliminación
		if (isset($_POST['confirmar'])) {
			if ($tarea->eliminarTarea()) {
				// Redirigir según el tipo de tarea
				//echo $tarea->getTipoTarea();
				//var_dump( $tarea );
				
				
				switch ($tarea->getTipoTarea()) {
					case 'ping':
						header('Location: ./?pagina=MonitoresPING&mensaje=eliminado');
						break;
					case 'tcp':
						header('Location: ./?pagina=MonitoresTCP&mensaje=eliminado');
						break;
					default:
						header('Location: ./?pagina=Dashboard&mensaje=eliminado');
						break;
				}
				exit;
				
				
			} else {
				$mensajeError = 'Hubo un problema al intentar eliminar la tarea.';
			}
		}

        // Formulario de confirmación
        $contenido = ' 
        <div class="container mt-4">
            <div class="card">
                <div class="card-header bg-danger text-white text-center">
                    <h4>¿Seguro que deseas eliminar esta tarea?</h4>
                </div>
                <div class="card-body text-center">
                    <p>Estás a punto de eliminar la tarea: <strong>' . $nombreServicio . '</strong></p>
                    <p>Esta acción no se puede deshacer.</p>

                    <form method="POST">
						<input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
                        <button type="submit" name="confirmar" class="btn btn-danger">✅ Sí, eliminar</button>
                        <a href="'. $urlCancelar .'" class="btn btn-secondary">❌ Cancelar</a>
                        <!--<button class="btn btn-secondary" onclick="window.history.back();">❌ Cancelar</button>-->
                    </form>
                </div>
            </div>
        </div>';

    } else {
        $contenido = '<div class="alert alert-danger text-center">Tarea no encontrada.</div>';
    }

} else {
    $contenido = '<div class="alert alert-warning text-center">ID de tarea no válido.</div>';
}

$templateContent->setContenido($contenido);
?>
