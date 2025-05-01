<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Editar Crear Tarea TCP");

if(isset($_GET['Tarea'])){
	$intTarea = (int)$_GET['Tarea'];
}else{
	$intTarea = 0;
}

if( !$usuario->puedeEditarTarea($intTarea) ){
    $usuario->debugLog('No tienes permisos para eliminar', 'Permisos:');
    $templateContent->setToastForNextPage('No tienes permisos para editar esta tarea', 'warning');
    header("Location: ?pagina=MonitoresTCP", true, 302);
    exit;
}


// Seteamos los valores por defecto:
$idServicio = '0';
$nombreServicio = '';
$hostServicio = '';
$puertoTCP = '';
$intervaloMinutos = '';
$intentosPermitidos = '';
$tareaHabilidata = ' checked';
$tareaNegadaChecked= '';
$descripcion_fallo = '';
$posible_causa = '';
$registrarIpChecked = '';

// Control de errores:
$mostrarErrores = false;
$mensageErrorForm = '';
$cssDivError=' style="display: none;"';



if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	// Nos ha llegado un POST para crear o editar una tarea TCP.
	$resultadoTarea = TareaTCP::editarCrear($_POST);
	if ($resultadoTarea['Estado']){
		// Si todo va bien...
		header('Location: ./?pagina=MonitoresTCP');
		die();
	}else{
		// Si algo no pasó el filtro:
		$mostrarErrores = true;
		$mensageErrorForm = $resultadoTarea['Motivo'];
		$idServicio = $_POST['idTarea'];
		$nombreServicio = $_POST['nombreServicio'];
		$hostServicio = $_POST['hostServicio'];
		$puertoTCP = $_POST['puertoTCP'];
		$intervaloMinutos = $_POST['intervalo'];
		$intentosPermitidos = $_POST['intentosPermitidos'];

		// añado estas dos lineas: Ahora elimino este comentario :P
		$descripcion_fallo = htmlspecialchars($_POST['descripcion_fallo']);
		$posible_causa = htmlspecialchars($_POST['posible_causa']);
		
		if (isset($_POST['habilitada'])) {
			$tareaHabilidata = ' checked';
		}else{
			$tareaHabilidata = '';
		} 
		
		if (isset($_POST['tareaNegada'])){
			$tareaNegadaChecked= ' checked';
		}else{
			$tareaNegadaChecked= '';
		}
		
		if (isset($_POST['registrarIp'])) {
			$registrarIpChecked = ' checked';
		} else {
			$registrarIpChecked = '';
		}
		
		
	}
}


// Obtener valores del GET para formar el objeto tarea y dar forma al formulario.
if (isset($_GET['Tarea'])){
	$intTareaBusqueda = (int)$_GET['Tarea'];
	$sql = "SELECT * FROM `monitoreo` WHERE `id_monitoreo` = ?;";
	$params = [
		['type' => 'i', 'value' => $intTareaBusqueda],
	];
	$arrayTareaSQL = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

	if(is_array($arrayTareaSQL)){
		$tareaTCPForm = new TareaTCP($arrayTareaSQL);
		$usuario->debugLog($tareaTCPForm, 'Tarea TCP');
		
		$idServicio = (int)$tareaTCPForm->getId();
		$nombreServicio = htmlspecialchars($tareaTCPForm->getNombreServicio());
		$hostServicio = htmlspecialchars($tareaTCPForm->getHost());
		$puertoTCP = (int)$tareaTCPForm->getPuerto();
		$intervaloMinutos = (int)$tareaTCPForm->getIntervaloMinutos();
		$intentosPermitidos = (int)$tareaTCPForm->getIntentosPermitidos();
		$descripcion_fallo = htmlspecialchars($tareaTCPForm->getDescripcionFallo());
		$posible_causa = htmlspecialchars($tareaTCPForm->getPosibleCausa());
		
		if ($tareaTCPForm->getHabilitada()){
			$tareaHabilidata = ' checked';
		}else{
			$tareaHabilidata = '';
		}
		
		if ( $tareaTCPForm -> getTareaNegada() ){
			$tareaNegadaChecked = ' checked';
		}else{
			$tareaNegadaChecked = '';
		}
		
		
		if ( $tareaTCPForm->getRegistrarIp() ) {
			$registrarIpChecked = ' checked';
		} else {
			$registrarIpChecked = '';
		}
		
		
		
	}
}

if ($mostrarErrores){
	$cssDivError = '';
}

$contenido = '
<div class="container mt-5">
    <div class="card">
        <div class="card-header">
            <h2>Formulario de Tarea TCP</h2>
        </div>
        <div class="card-body">
            <div id="error-message" class="alert alert-danger"'.$cssDivError.'>
                '.$mensageErrorForm.'
            </div>
            
            <form method="POST" action="./?pagina=MonitoresTCPEdit">
                <input type="hidden" id="idTarea" name="idTarea" value="'.$idServicio.'">
                <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">

                <div class="row mb-3">
                    <label for="nombreServicio" class="col-sm-2 col-form-label">Nombre del Servicio</label>
                    <div class="col-sm-10">
                        <input maxlength="255" type="text" class="form-control" id="nombreServicio" name="nombreServicio" placeholder="Ingrese el nombre del servicio" value="'.$nombreServicio.'" required>
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="hostServicio" class="col-sm-2 col-form-label">Host del Servicio</label>
                    <div class="col-sm-10">
                        <input maxlength="255 type="text" class="form-control" id="hostServicio" name="hostServicio" placeholder="Ingrese el host del servicio" value="'.$hostServicio.'" required>
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="puertoTCP" class="col-sm-2 col-form-label">Puerto TCP</label>
                    <div class="col-sm-10">
                        <input type="number" class="form-control" id="puertoTCP" name="puertoTCP" placeholder="Ingrese el puerto TCP" value="'.$puertoTCP.'" required min="1" max="65535">
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="intervalo" class="col-sm-2 col-form-label">Intervalo (min)</label>
                    <div class="col-sm-10">
                        <input type="number" class="form-control" id="intervalo" name="intervalo" placeholder="Ingrese el intervalo en minutos" value="'.$intervaloMinutos.'" required min="1">
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="intentosPermitidos" class="col-sm-2 col-form-label">Intentos Permitidos</label>
                    <div class="col-sm-10">
                        <input type="number" class="form-control" id="intentosPermitidos" name="intentosPermitidos" placeholder="Ingrese la cantidad de intentos permitidos" value="'.$intentosPermitidos.'" required min="1">
                    </div>
                </div>

                <div class="row mb-3">
                    <label for="descripcion_fallo" class="col-sm-2 col-form-label">Descripción del Fallo</label>
                    <div class="col-sm-10">
                        <textarea maxlength="255" class="form-control" id="descripcion_fallo" name="descripcion_fallo" placeholder="Describe el fallo esperado en caso de error" rows="3">'.$descripcion_fallo.'</textarea>
                    </div>
                </div>

                <div class="row mb-3">
                    <label for="posible_causa" class="col-sm-2 col-form-label">Posible Causa</label>
                    <div class="col-sm-10">
                        <textarea maxlength="255" class="form-control" id="posible_causa" name="posible_causa" placeholder="Describe la posible causa del fallo" rows="3">'.$posible_causa.'</textarea>
                    </div>
                </div>

                <div class="row mb-3">
                    <label for="habilitada" class="col-sm-2 col-form-label">Habilitada</label>
                    <div class="col-sm-10">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="habilitada" name="habilitada"'.$tareaHabilidata.'>
                            <label class="form-check-label" for="habilitada">
                                Marcar si el servicio está habilitado
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="row mb-3">
					<label for="tareaNegada" class="col-sm-2 col-form-label">Negar Condición</label>
					<div class="col-sm-10">
						<div class="form-check">
							<input class="form-check-input" type="checkbox" id="tareaNegada" name="tareaNegada"'. $tareaNegadaChecked .'>
							<label class="form-check-label" for="tareaNegada">
								Marcar si se debe **invertir la lógica de éxito**
							</label>
						</div>
					</div>
				</div>
				
				
				<div class="row mb-3">
					<label for="registrarIp" class="col-sm-2 col-form-label">Registrar IP en Log</label>
					<div class="col-sm-10">
						<div class="form-check">
							<input class="form-check-input" type="checkbox" id="registrarIp" name="registrarIp"'. $registrarIpChecked.' >
							<label class="form-check-label" for="registrarIp">
								Guardar la IP de destino en el registro de eventos
							</label>
						</div>
					</div>
				</div>				
				
				
                

                <div class="row mb-3">
                    <div class="col-sm-10 offset-sm-2">
                        <button type="submit" class="btn btn-primary">Guardar</button>
                        <button type="reset" class="btn btn-secondary">Restaurar valores</button>
                        <a href="./?pagina=MonitoresTCP" class="btn btn-secondary">Volver a Tareas TCP</a>
                    </div>
                </div>
            </form>
        </div>
    </div>
</div>';

$templateContent->setContenido($contenido);
?>
