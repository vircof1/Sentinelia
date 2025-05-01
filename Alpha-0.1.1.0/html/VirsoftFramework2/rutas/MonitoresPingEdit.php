<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Editar Crear Tarea Ping");


if(isset($_GET['Tarea'])){
	$intTarea = (int)$_GET['Tarea'];
}else{
	$intTarea = 0;
}
		
if( !$usuario -> puedeEditarTarea( $intTarea ) ){
	// Debug, sin lo posterior:
	$usuario->debugLog('No tienes Permisos','Permisos:');
	
	// Damos info al usuario, sin titulo: (toast title aleatorio....)
	$templateContent->setToastForNextPage('No tienes permisos para editar esta tarea','warning');
	
	// redirigimos:
	header("Location: ?pagina=MonitoresPING", true, 302);
	exit;
}

// seteamos los valores por defecto:
$idServicio = '0';
$nombreServicio = '';
$urlServicio = '';
$intervaloMinutos = '';
$intentosPermitidos = '';
$tareaHabilidata = ' checked';
$tareaNegadaChecked= '';
$descripcion_fallo = '';
$posible_causa = '';
$registrarIpChecked = '';


//Control de errores:
$mostrarErrores = false;
$mensageErrorForm = '';
$cssDivError=' style="display: none;"';





if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	// Nos a llegado un POST para crear o editar una tarea ping.
	$resultadoTarea = TareaPing::editarCrear($_POST);
	if ($resultadoTarea['Estado']){
		// Si todo va bien....
		header('Location: ./?pagina=MonitoresPING');
		die();
	}else{
		// Si algo no pasó el filtro:
		$mostrarErrores = true;
		$mensageErrorForm = $resultadoTarea['Motivo'];
		$idServicio = $_POST['idTarea'];
		$nombreServicio = $_POST['nombreServicio'];
		$urlServicio = $_POST['urlServicio'];
		$intervaloMinutos = $_POST['intervalo'];
		$intentosPermitidos = $_POST['intentosPermitidos'];
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
		
		if ( isset( $_POST['registrarIp'] ) ) {
			$registrarIpChecked = ' checked';
		}// No hay else, porque es el valor por defecto.
		
		
	}
}



// Obtener valores del GET para formar el objeto tarea y dar forma al formulario.
if (isset( $_GET['Tarea'] )){
	$intTareaBusqueda = (int)$_GET['Tarea'];
	$sql = "SELECT *  FROM `monitoreo` WHERE `id_monitoreo` = ?;";
	$params = [
		['type' => 'i', 'value' => $intTareaBusqueda],
	];
	$arrayTareaSQL = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
	
	// Esta funcion esta pensada para que de un array si encuentra algo o un boolean:
	if( is_array($arrayTareaSQL) ){
		// Definimos las variables de formulario desde la variable GET:
		$tareaPingForm = new TareaPing($arrayTareaSQL);
		
		// Pasamos la tarea al debuger a ver que pasa:
		$usuario->debugLog($tareaPingForm, 'Monitor Ping');
		
		$idServicio = (int)$tareaPingForm -> getId();
		$nombreServicio = htmlspecialchars( $tareaPingForm -> getNombreServicio() );
		$urlServicio = htmlspecialchars( $tareaPingForm -> getURL() );
		$intervaloMinutos = (int)$tareaPingForm -> getIntervaloMinutos();
		$intentosPermitidos = (int)$tareaPingForm -> getIntentosPermitidos();
		$descripcion_fallo = htmlspecialchars($tareaPingForm->getDescripcionFallo());
		$posible_causa = htmlspecialchars($tareaPingForm->getPosibleCausa());
		
		if ( $tareaPingForm -> getHabilitada() ){
			$tareaHabilidata = ' checked';
		}else{
			$tareaHabilidata = '';
		}
		
		if ( $tareaPingForm -> getTareaNegada() ){
			$tareaNegadaChecked = ' checked';
		}else{
			$tareaNegadaChecked = '';
		}
		
		if ( $tareaPingForm -> getRegistrarIp() ){
			$registrarIpChecked = ' checked';
		}// No hay else porque es el valor por defecto.
		
		
	}
}


// Control de errores
if ($mostrarErrores){
	$cssDivError = '';
}


$contenido = '
<div class="container mt-5">
    <div class="card">
        <div class="card-header">
            <h2>Formulario de Tarea Ping</h2>
        </div>
        <div class="card-body">
            <!-- Div para mostrar errores -->
            <div id="error-message" class="alert alert-danger"'. $cssDivError .'>
                '.$mensageErrorForm.'
            </div>
            
            <form method="POST" action="./?pagina=MonitoresPingEdit">
                <!-- Input hidden para la ID de la tarea -->
                <input type="hidden" id="idTarea" name="idTarea" value="'.$idServicio.'">
                
                <!-- Input hidden para el token CSRF -->
                <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
                
                <div class="row mb-3">
                    <label for="nombreServicio" class="col-sm-2 col-form-label">Nombre del Servicio</label>
                    <div class="col-sm-10">
                        <input maxlength="255" type="text" class="form-control" id="nombreServicio" name="nombreServicio" placeholder="Ingrese el nombre del servicio" value="'. $nombreServicio .'" required>
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="urlServicio" class="col-sm-2 col-form-label">URL del Servicio</label>
                    <div class="col-sm-10">
                        <input maxlength="255" type="text" class="form-control" id="urlServicio" name="urlServicio" placeholder="Ingrese la URL del servicio" value="'.$urlServicio.'" required>
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="intervalo" class="col-sm-2 col-form-label">Intervalo (min)</label>
                    <div class="col-sm-10">
                        <input maxlength="255" type="number" class="form-control" id="intervalo" name="intervalo" placeholder="Ingrese el intervalo en minutos" value="'.$intervaloMinutos.'" required min="1">
                    </div>
                </div>
                <div class="row mb-3">
                    <label for="intentosPermitidos" class="col-sm-2 col-form-label">Intentos Permitidos</label>
                    <div class="col-sm-10">
                        <input type="number" class="form-control" id="intentosPermitidos" name="intentosPermitidos" placeholder="Ingrese la cantidad de intentos permitidos" value="'.$intentosPermitidos.'" required min="1">
                    </div>
                </div>

                <!-- Campo para Descripción del Fallo -->
                <div class="row mb-3">
                    <label for="descripcion_fallo" class="col-sm-2 col-form-label">Descripción del Fallo</label>
                    <div class="col-sm-10">
                        <textarea maxlength="255" class="form-control" id="descripcion_fallo" name="descripcion_fallo" placeholder="Describe el fallo esperado en caso de error" rows="3">'.$descripcion_fallo.'</textarea>
                    </div>
                </div>

                <!-- Campo para Posible Causa -->
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
					<label for="registrarIp" class="col-sm-2 col-form-label">Registrar IP</label>
					<div class="col-sm-10">
						<div class="form-check">
							<input class="form-check-input" type="checkbox" id="registrarIp" name="registrarIp"'. $registrarIpChecked .' >
							<label class="form-check-label" for="registrarIp">
								Marcar para registrar la IP detectada en el ping
							</label>
						</div>
					</div>
				</div>
                
                
                
                
                <div class="row mb-3">
					<div class="col-sm-10 offset-sm-2">
						<button type="submit" class="btn btn-primary">Guardar</button>
						<button type="reset" class="btn btn-secondary">Restaurar valores</button>
						<a href="./?pagina=MonitoresPING" class="btn btn-secondary">Volver a Tareas Ping</a>
					</div>
                </div>
            </form>
        </div>
    </div>
</div>';


$templateContent -> setContenido($contenido);

?>
