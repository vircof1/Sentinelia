<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Eventos de tarea");

// Sacamos el entero del GET y lo pasamos como entero:
$intTarea = intval($_GET['Tarea']);

$scriptFooter = '';
$contenido ='';


// Primero verificamos si la tarea existe. De no existir, lo redirigimos al visor de eventos, general:
if (!Tarea::existen($intTarea)) {
    // Redirigir o mostrar mensaje
    header("Location: ?pagina=VisorEventos");
    exit;
}

// Seguido, verificamos si tiene permisos, para ver esta tarea:
if ( !$usuario -> puedeAuditar($intTarea) ){
    // Redirigir o mostrar mensaje
    header("Location: ?pagina=VisorEventos");
    exit;
}





/*
use Virsoft\Utilidades\Fecha;

// Simulamos el POST recibido del cliente:
$fechaReferenciaUTC         = '2025-03-21 21:56:10';  // Campo oculto fijo en UTC
$fechaReferenciaLocal       = '2025-03-21 22:56:10';  // Calculado por JS y enviado al servidor
$fechaIndicadaPorElUsuario  = '2025-03-14 18:00:00';  // El usuario marcó esta fecha como "inicio"

$fechaUTCreal = Fecha::convertirFechaLocalAUTC(
    $fechaReferenciaUTC,
    $fechaReferenciaLocal,
    $fechaIndicadaPorElUsuario
);

echo '[DEBUG] Fecha UTC real de ese valor local: ' . $fechaUTCreal->format('Y-m-d H:i:s');
*/


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	
	$dateTimeInicio = virsoftUtilFecha::convertirFechaLocalAUTC(
		$_POST['fechaReferenciaUTC'],
		$_POST['fechaReferenciaLocal'],
		$_POST['fechaInicio']
	);
	$dateTimeFin = virsoftUtilFecha::convertirFechaLocalAUTC(
		$_POST['fechaReferenciaUTC'],
		$_POST['fechaReferenciaLocal'],
		$_POST['fechaFin']
	);

	//var_dump($dateTimeInicio);
	//var_dump($dateTimeFin);

	//die();
	$eventos = new logEventS(
		$dateTimeInicio,		// fecha inicio
		$dateTimeFin,			// fecha fin
		[$intTarea],			// array con ID Tarea
		null,
		null,
		null	
	);	
	
	

}else{
	$eventos = new logEventS(
		null,			// fecha inicio
		null,			// fecha fin
		[$intTarea],	// array con ID Tarea
		null,
		null,
		null	
	);
}

//var_dump($eventos);
//die();


$datosGrafico = $eventos->getDatosParaGrafico(); // ← ya tiene labels, data, tooltip, motivo, anotaciones, etc
$datosTabla = $eventos->getEventos(); // ← devuelve array plano con eventos listos para pintar tabla







// Puede que el log esté vacio asique:
if ( is_array( $eventos->getEventos() ) ) {
	// Hay eventos que mostrar:

	// Sacamos el nombre de la tarea, del primer evento:
	//$primerEvento = $eventosSQL['0'];
	//$nombreTarea = $primerEvento['nombre_servicio'];
	
	
	$labels = [];
	$dataEstado = [];
	$dataTooltip = [];
	$dataMotivo = [];
	$jsonAnotaciones = [];


	// JSON para JS
	$jsonLabels = json_encode($labels, JSON_UNESCAPED_UNICODE);
	$jsonDataEstado = json_encode($dataEstado, JSON_UNESCAPED_UNICODE);
	$jsonTooltip = json_encode($dataTooltip, JSON_UNESCAPED_UNICODE);
	$jsonMotivo = json_encode($dataMotivo, JSON_UNESCAPED_UNICODE);
	
	
	// Recorremos desde el primer evento hasta el último para cubrir el rango temporal real del gráfico
	if (!empty($eventosSQL)) {
		$inicio = new DateTime($eventosSQL[0]['fecha_inicio_estado']);
		$ultimoEvento = end($eventosSQL);
		$fin = new DateTime($ultimoEvento['fecha_fin_estado'] ?? $ultimoEvento['fecha_inicio_estado']);
		$fin->modify('+1 day'); // Aseguramos un margen visual tras el último día

		$dia = clone $inicio;
		while ($dia < $fin) {
			$diaNum = (int)$dia->format('d');
			$esCambioDeMes = $dia->format('d') === '01';

			if ($diaNum % 2 === 1 || $esCambioDeMes) {
				$xMin = $dia->format('Y-m-d') . 'T00:00:00';
				$xMax = $dia->modify('+1 day')->format('Y-m-d') . 'T00:00:00';

				$anotaciones[] = [
					'type' => 'box',
					'xMin' => $xMin,
					'xMax' => $xMax,
					'backgroundColor' => 'rgba(230,230,230,0.2)'
				];
			} else {
				// Avanza al día siguiente si no aplicamos anotación
				$dia->modify('+1 day');
			}
		}
	}

	
	
	
	
	
	// Vamos a intentar escupir aqui el contenido como parte de una refactorización visual.
	
	// luego quitamos este if. Por ahora es para que solo lo vea yo.
	
	
	$contenido .='
	
		<div class="row">
		  <!-- Gráfico - col-8 -->
		  <div class="col-md-8">
			<div class="card mb-4 shadow-sm rounded-3">
			  <div class="card-header bg-light border-bottom">
				<h5 class="mb-0">Evolución del Estado de la Tarea</h5>
			  </div>
			  <div class="card-body">

				<div style="width: 95%; margin: auto;">
					<canvas id="graficoEstados" style="width: 100%;"></canvas>
				</div>

				
				
				
			  </div>
			</div>
		  </div>

		  <!-- Selector de Fechas - col-4 -->
		  <div class="col-md-4">
			<div class="card mb-4 shadow-sm rounded-3">
			  <div class="card-header bg-light border-bottom">
				<h5 class="mb-0">Filtrar por Fecha</h5>
			  </div>
			  <div class="card-body">
			  
			  
			  
<form method="POST" action="?pagina=VisorEventosTarea&Tarea=' . htmlspecialchars($intTarea) . '">
  <div class="mb-3">
    <label for="fechaInicio" class="form-label">Desde</label>
    <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
    <input type="datetime-local" class="form-control fecha-input" id="fechaInicio" name="fechaInicio"
           value="' . htmlspecialchars($eventos->getFechaInicio()?->format('Y-m-d\TH:i') ?? '') . '">
  </div>
  <div class="mb-3">
    <label for="fechaFin" class="form-label">Hasta</label>
    <input type="datetime-local" class="form-control fecha-input" id="fechaFin" name="fechaFin"
           value="' . htmlspecialchars($eventos->getFechaFin()?->format('Y-m-d\TH:i') ?? '') . '">
  </div>


	<!-- Campo oculto fijo con valor UTC de referencia -->
	<input type="hidden" id="fechaReferenciaUTC" name="fechaReferenciaUTC" value="'. gmdate('Y-m-d H:i:s') .'">
	<input type="hidden" id="fechaReferenciaLocal" name="fechaReferenciaLocal" value="">

  <button type="submit" class="btn btn-primary w-100">Aplicar Filtro</button>
</form>




			</div>
		  </div>
		</div>

		<!-- Tabla Log - col-12 -->
		<div class="row">
		  <div class="col-12">
			<div class="card mb-4 shadow-sm rounded-3">
			  <div class="card-header bg-light border-bottom">
				<h5 class="mb-0">Visor de Eventos</h5>
			  </div>
			  <div class="card-body">
				<!-- Aquí insertas tu DataTable o tabla HTML normal -->
				';
	
	// Script JS para recalcular las fechas del formulario, desde la hora UTC:
$templateContent->addscriptsFooter('
<script>
document.addEventListener("DOMContentLoaded", function () {
  const inputs = document.querySelectorAll(".fecha-input");

  inputs.forEach(input => {
    if (!input.value) return;

    // Interpretamos el value como UTC (añadiendo "Z")
    const fechaLocal = new Date(input.value + "Z");

    // Formateamos como YYYY-MM-DDTHH:mm (sin segundos)
    const año   = fechaLocal.getFullYear();
    const mes   = String(fechaLocal.getMonth() + 1).padStart(2, "0");
    const dia   = String(fechaLocal.getDate()).padStart(2, "0");
    const hora  = String(fechaLocal.getHours()).padStart(2, "0");
    const min   = String(fechaLocal.getMinutes()).padStart(2, "0");

    input.value = `${año}-${mes}-${dia}T${hora}:${min}`;
  });

  // Hora local real del cliente (para referencia técnica)
  const hiddenInput = document.getElementById("fechaReferenciaLocal");
  if (hiddenInput) {
    const ahora = new Date();
    const año   = ahora.getFullYear();
    const mes   = String(ahora.getMonth() + 1).padStart(2, "0");
    const dia   = String(ahora.getDate()).padStart(2, "0");
    const hora  = String(ahora.getHours()).padStart(2, "0");
    const min   = String(ahora.getMinutes()).padStart(2, "0");
    const seg   = String(ahora.getSeconds()).padStart(2, "0");

    const textoLocal = `${año}-${mes}-${dia} ${hora}:${min}:${seg}`;
    hiddenInput.value = textoLocal;

    //console.log("%c[Debug] Fecha local aplicada al input hidden (carga DOM):", "color: orange; font-weight: bold;");
    //console.log(textoLocal);
  }

  // Conversión de referencia UTC -> local
  const utcInput   = document.getElementById("fechaReferenciaUTC");
  const localInput = document.getElementById("fechaReferenciaLocal");

  if (utcInput && localInput && utcInput.value) {
    const fechaUTC = new Date(utcInput.value + "Z"); // El navegador ya interpreta como UTC correctamente

    // Simplemente mostramos la fecha local correspondiente sin manipularla
    const año   = fechaUTC.getFullYear();
    const mes   = String(fechaUTC.getMonth() + 1).padStart(2, "0");
    const dia   = String(fechaUTC.getDate()).padStart(2, "0");
    const hora  = String(fechaUTC.getHours()).padStart(2, "0");
    const min   = String(fechaUTC.getMinutes()).padStart(2, "0");
    const seg   = String(fechaUTC.getSeconds()).padStart(2, "0");

    const localTexto = `${año}-${mes}-${dia} ${hora}:${min}:${seg}`;
    localInput.value = localTexto;

    //console.log("%c[Debug] Hora local equivalente a UTC fija:", "color: orange; font-weight: bold;");
    //console.log(localTexto);
  }
});
</script>
');
	
	
	
	
	
	// Aqui insertamos el contenido Datatables:
	$contenido .='
				<table id="logTable" class="table table-responsive-sm table-bordered table-striped table-sm">
				<thead>
					<tr>
						<th>Nº de evento</th>
						<th>ID Monitoreo</th> <!-- Columna oculta -->
						<th>Nombre Monitor</th>
						<th>Tipo de Tarea</th>
						<th>Estado Actual</th>
						<th>Cantidad de Eventos</th>
						<th>Cantidad Máxima de Eventos</th>
						<th>Fecha Inicio Estado</th>
						<th>Fecha Fin Estado</th>
						<th>Motivo del Estado</th>
						<th>Nivel de Alerta</th>
						<th>Última Actualización</th>
					</tr>
				</thead>
				<tbody>
			
	';
	
	




	
	// contenido de la tabla:
	// contenido de la tabla:
	foreach ($eventos->getEventos() as $evento) {
		$contenido .= '
			<tr>
				<td>' . htmlspecialchars($evento->getId()) . '</td> <!-- ID Log -->
				<td>' . htmlspecialchars($evento->getIdTarea()) . '</td> <!-- ID Monitoreo -->
				<td>' . htmlspecialchars($evento->getNombreTarea()) . '</td>
				<td>' . htmlspecialchars($evento->getTipoTarea()) . '</td>
				<td>' . htmlspecialchars($evento->getEstadoActual()) . '</td>
				<td>' . htmlspecialchars($evento->getCantidadEventos()) . '</td>
				<td>' . htmlspecialchars($evento->getCantidadMaxima()) . '</td>
				<td><span class="hora-utc" data-fecha="' . htmlspecialchars($evento->getFechaInicioTexto()) . '"></span></td>
				<td><span class="hora-utc" data-fecha="' . htmlspecialchars($evento->getFechaFinTexto()) . '"></span></td>

				<td>' . htmlspecialchars($evento->getMotivo()) . '</td>
				<td>' . htmlspecialchars($evento->getNivelAlerta()) . '</td>
				<td><span class="hora-utc" data-fecha="' . htmlspecialchars($evento->getUltimaActualizacionTexto()) . '"></span></td>
			</tr>
		';
	}

				
				
				
				
				
				
	// Cierre del div y table
	$contenido .='	
					</tbody>
				</table>
			</div>
		</div>
				
			  </div>
			</div>
		  </div>
		</div>
		
	
	
	
	';






	$scriptFooter .='
		<!-- scripts para diseñar graficos... -->
		
		<script src="Template/vendors/chart.js/js/chart.min.js"></script>
		<script src="Template/vendors/@coreui/chartjs/js/coreui-chartjs.js"></script>
		//<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
		<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@1.1.0"></script>
	';



	$datosGrafico = $eventos->getDatosParaGrafico();
	$usuario -> debugLog($datosGrafico, 'Datos del grafico');
	//var_dump($datosGrafico['rango']['fin']);
	
	
	// Definimos el principio y el final 

	

$scriptFooter .= '
<script>
document.addEventListener("DOMContentLoaded", function () {
	const datosGrafico = ' . json_encode($datosGrafico, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ';

	const datasets = [];
	const labelsSet = new Set();
	const tooltipMap = {};

	for (const idTarea in datosGrafico.tareas) {
		const tarea = datosGrafico.tareas[idTarea];
		const data = [];

		tarea.eventos.forEach((evento, index) => {
			const timestamp = evento.timestamp;
			let estadoValor;

			switch (evento.estado?.toLowerCase()) {
				case "exito":
					estadoValor = 1;
					break;
				case "advertencia":
					estadoValor = 0.5;
					break;
				case "información":
					estadoValor = 1;
					break;
				case "crítico":
					estadoValor = 0;
					break;
				case "fallo":
					estadoValor = 0;
					break;					
				default:
					estadoValor = 0.25; // ← o null si prefieres no pintar
					break;
			}
			labelsSet.add(timestamp);
			tooltipMap[timestamp] = evento.motivo;

			data.push({
				x: timestamp,
				y: estadoValor
			});
		});
			
		datasets.push({
			label: tarea.nombreTarea,
			data: data,
			stepped: true,
			borderWidth: 2,
			borderColor: "#007bff",
			backgroundColor: "#007bff",
			pointRadius: 5,
			pointHoverRadius: 7,
			tension: 0
		});
	}

	const labels = Array.from(labelsSet).sort();

	const ctx = document.getElementById("graficoEstados").getContext("2d");
	new Chart(ctx, {
		type: "line",
		data: {
			labels: labels,
			datasets: datasets
		},
		options: {
			aspectRatio: 2.99,
			responsive: true,
			plugins: {
				tooltip: {
				  callbacks: {
					title: function (context) {
					  const rawDate = context[0].label;
					  const dateObj = new Date(rawDate);
					  return dateObj.toLocaleString();  // ← ¡el navegador adapta automáticamente al idioma del usuario!
					},
					label: function (context) {
					  const index = context.dataIndex;
					  const estadoY = context.raw.y;
					  const estadoTexto = estadoY === 1 ? "Éxito" : (estadoY === 0.5 ? "Advertencia" : "Fallo");

					  const idTarea = Object.keys(datosGrafico.tareas)[0];
					  const motivo = datosGrafico.tareas[idTarea].eventos[index]?.motivo ?? "(sin motivo)";
					  return [`Estado: ${estadoTexto}`, `Motivo: ${motivo}`];
					}
				  }
				}
			},
			scales: {
				y: {
					type: \'linear\',
					min: -0.5,
					max: 1.5,
					ticks: {
						values: [0, 0.5, 1],
						callback: function(value) {
							if (value === 1) return "Éxito / Información";
							if (value === 0.5) return "Advertencia";
							if (value === 0) return "Fallo / Crítico";
							return "";
						}
					}
				},
				x: {
					type: "time",
					time: {
						tooltipFormat: "yyyy-MM-dd HH:mm:ss",
						displayFormats: {
							second: "HH:mm:ss",
							minute: "HH:mm",
							hour: "dd-MM-yyyy HH:mm",
							day: "dd-MM-yyyy",
							month: "MM-yyyy",
							year: "yyyy"
						}
					},
					ticks: {
						autoSkip: true,
						maxTicksLimit: 10,
						padding: 10,
						maxRotation: 45
					},
					min: datosGrafico.rango.inicio,
					max: datosGrafico.rango.fin,
					title: {
						display: true,
						text: "Fecha"
					}
				}
			}
		}
	});
});
</script>';







	$contenido .='
	<script>
		$(document).ready(function() {
			// Inicializar DataTables
			$("#logTable").DataTable({
				"columnDefs": [
					{ "targets": [1], "visible": false }, // Ocultar columna ID Monitoreo
					{ "orderable": false, "targets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] } // Desactiva el ordenamiento en las columnas especificadas
				],
				"order": [[0, "desc"]], // Ordenar por Fecha Inicio Estado de forma descendente
				"language": {
					"sProcessing":     "Procesando...",
					"sLengthMenu":     "Mostrar _MENU_ registros",
					"sZeroRecords":    "No se encontraron resultados",
					"sEmptyTable":     "Ningún dato disponible en esta tabla",
					"sInfo":           "Mostrando registros del _START_ al _END_ de un total de _TOTAL_ registros",
					"sInfoEmpty":      "Mostrando registros del 0 al 0 de un total de 0 registros",
					"sInfoFiltered":   "(filtrado de un total de _MAX_ registros)",
					"sInfoPostFix":    "",
					"sSearch":         "Buscar:",
					"sUrl":            "",
					"sInfoThousands":  ".",
					"sLoadingRecords": "Cargando...",
					"oPaginate": {
						"sFirst":    "Primero",
						"sLast":     "Último",
						"sNext":     "Siguiente",
						"sPrevious": "Anterior"
					},
					"oAria": {
						"sSortAscending":  ": Activar para ordenar la columna de manera ascendente",
						"sSortDescending": ": Activar para ordenar la columna de manera descendente"
					}
				},
				"rowCallback": function(row, data) {
					// Aplicar clases según el nivel de alerta
					var nivelAlerta = data[10]; // Cambia el índice si el nivel de alerta está en otra columna
					// Asegúrate de que estos valores coincidan con los niveles de alerta esperados
					if (nivelAlerta === "crítico") {
						$(row).addClass("bg-danger"); // Clase para crítico
					} else if (nivelAlerta === "advertencia") {
						$(row).addClass("bg-warning"); // Clase para advertencia
					} else if (nivelAlerta === "información") {
						$(row).addClass("bg-success"); // Clase para información
					} else {
						$(row).addClass("bg-secondary"); // Clase por defecto si no coincide
					}
				}
			});
		});
	</script>

	<!--
	bg-success bg-warning bg-danger bg-dark
	-->

	';


	
}









$primerEvento = $eventos->getEventos()[0] ?? null;

if ($primerEvento && $t = $primerEvento->getTarea()) {
    $templateContent->setTitulo("Eventos de: " . htmlspecialchars($t->getNombreServicio()));
} else {
    // No hay eventos, instanciamos la tarea directamente
    $tarea = new Tarea( (int)$_GET['Tarea'] );
    $templateContent->setTitulo("Eventos de: " . htmlspecialchars($tarea->getNombreServicio()));
}

$templateContent -> setContenido(  $contenido );
$templateContent -> addscriptsFooter ( $scriptFooter );

?>
