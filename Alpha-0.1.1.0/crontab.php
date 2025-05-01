<?php
## Cargamos el framework
include "/var/www/html/Variables.php";
$virsoftControlInclude = true;

## include del framework:
require $configuracionVirsoft['framework_path'] . "Clases/virsoft.php";

## include de las clases personalizadas para ejecutar rateas.
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/index.php";

# Calculamos las tareas pendientes:
$fechaActual = date("Y-m-d H:i:s");  
$consulta_menu = "SELECT * FROM `monitoreo` WHERE `proxima_ejecucion` <= ? AND `TareaHabilitada` = ?";
$params = [
	['type' => 's', 'value' => $fechaActual],
	['type' => 'i', 'value' => 1],
	
];
$resultTareasPendientes = $virsoft->ejecutarConsultaPreparada($consulta_menu, $params);
unset($fechaActual);
//var_dump($resultTareasPendientes);


if( is_array($resultTareasPendientes) ){
	foreach ($resultTareasPendientes as $tareaData) {
		// Según el tipo de tarea, instanciamos la clase correcta
		//echo $tareaData['tipo_prueba'];
		switch ($tareaData['tipo_prueba']) {
			case 'ping':
				$tarea = new TareaPing($tareaData);
				break;
			case 'tcp':
				//echo "se detecto tarea tcp";
				$tarea = new TareaTCP($tareaData);
				break;
			case 'consulta':
				// Aún no programada del todo:
				//$tarea = new TareaSQL($tareaData);
				break;
			default:
				break; // Si no es un tipo reconocido, continuamos el loop
		}
		
		// Ejecutar la tarea
		##$tarea->ejecutar(); Aún no ejecutamos que no e visto el codigo.
		if( isset($tarea) ){
			$tarea->ejecutar();
			//var_dump($tarea);
			unset($tarea);
		}
	}
}



?>
