<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Monitores Ping");



if( !$usuario->puedeEditarTareas() ){
    $usuario->debugLog('No tienes permisos para editar/eliminar tareas.', 'Permisos:');
    $templateContent->setToastForNextPage('No tienes permisos para editar/eliminar tareas', 'warning');
    header("Location: ./", true, 302);
    exit;
}


// Instanciamos todas las tareas, esten desabilitadas o no (queremos editar todo)
$tareas = new tareas(false);
$tareasPing = $tareas -> getTareasPing();
//var_dump($tareasPing);

//Funcion para truncar textos largos:
function truncarTexto($texto, $longitud = 25) {
    if (strlen($texto) <= $longitud) {
        return $texto;
    }

    $truncado = substr($texto, 0, $longitud);

    // Si no estamos cortando una palabra larga (tipo IP o dominio), intenta cortar por el último espacio
    $ultimoEspacio = strrpos($truncado, ' ');
    if ($ultimoEspacio !== false && $ultimoEspacio > ($longitud * 0.6)) {
        $truncado = substr($truncado, 0, $ultimoEspacio);
    }

    return $truncado . '..';
}

$contenido = '

    <script>
        // Función para convertir una fecha UTC a la zona horaria local
        function convertirFechaUTC(fechaUTC) {
            const zonaHorariaLocal = Intl.DateTimeFormat().resolvedOptions().timeZone;
            //console.log("Zona horaria local:", zonaHorariaLocal);
            const fecha = new Date(fechaUTC + "Z");  // Agregamos "Z" para indicar UTC
            const opciones = {
                timeZone: zonaHorariaLocal,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            };
            return fecha.toLocaleString("es-ES", opciones);
        }

        // Llenar las celdas de la columna de fecha
        function llenarFechas() {
            const celdasFecha = document.querySelectorAll(".fecha-utc");

            celdasFecha.forEach(celda => {
                const fechaUTC = celda.textContent.trim(); // Obtener el contenido de la celda
                const fechaLocal = convertirFechaUTC(fechaUTC);
                celda.textContent = fechaLocal; // Actualizar el contenido de la celda
            });
        }

        // Ejecutar la función al cargar la página
        window.onload = llenarFechas;
    </script>
    




<!--<div class="container mt-4">-->
    <!--<h2>Tareas Ping</h2>-->
    <div class="card">
        <div class="card-header">
            <h5 class="card-title">Listado de Tareas</h5>
        </div>
        <div class="card-body">
            <table class="table table-striped table-bordered" id="tablaTareasPing">
                <thead>
                    <tr>
                        <th style="text-align: center;">Nombre del Servicio</th>
						<th style="text-align: center;">URL del Servicio</th>
						<th style="text-align: center;">Intervalo (min)</th>
						<th style="text-align: center;">Última Ejecución</th>
						<th style="text-align: center;">Estado Resultado</th>
						<th style="text-align: center;">Mensaje Alerta</th>
						<th style="text-align: center;">Nivel Alerta</th>
						<th style="text-align: center;">Próxima Ejecución</th>
						<th style="text-align: center;">Intentos Permitidos</th>
						<th style="text-align: center;">Habilitada</th>
						<th style="text-align: center;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
';




foreach ($tareasPing as $tareaPing){
	// Calculamos el icono de habilitado o no habilitada la tarea
	if ( $tareaPing -> getHabilitada() ){
		$enabledTaskHTML = '✔️ SI
		';
	}else{
		$enabledTaskHTML = '❌ NO
		';
	}
	
	
	
     $contenido .='           
                    <tr>
                        <!--<td>'. htmlspecialchars( truncarTexto( $tareaPing -> getNombreServicio() ) ) .'</td>-->
                        
                        <td style="text-align: center;" title="'. htmlspecialchars($tareaPing -> getNombreServicio()) .'">'. htmlspecialchars(truncarTexto($tareaPing -> getNombreServicio())) .'</td>
                        
                        <td style="text-align: center;" title="' . htmlspecialchars( $tareaPing -> getURL() ) . '">'. htmlspecialchars( truncarTexto( $tareaPing -> getURL() ) ) .'</td>
                        <td style="text-align: center;">'. htmlspecialchars( $tareaPing -> getIntervaloMinutos() ) .'</td>
                        <td style="text-align: center;" class="fecha-utc">'. htmlspecialchars( $tareaPing -> getUltimaEjecucion() ) .'</td>
                        <td style="text-align: center;">'. htmlspecialchars( $tareaPing -> getEstadoResultado() ) .'</td>
                        <td style="text-align: center;" title="' . htmlspecialchars($tareaPing->getMensajeAlerta()) . '">' . htmlspecialchars(truncarTexto($tareaPing->getMensajeAlerta())) . '</td>
                        <td style="text-align: center;">'. htmlspecialchars( $tareaPing -> getNivelAlerta() ) .'</td>
                        <td style="text-align: center;" class="fecha-utc">'. htmlspecialchars( $tareaPing -> getProximaEjecucion() ) .'</td>
                        <td style="text-align: center;">'. htmlspecialchars( $tareaPing -> getIntentosPermitidos() ) .'</td>
                        <td style="text-align: center;">'. $enabledTaskHTML .'</td>
                        <td style="text-align: center;">
														
							<div class="dropdown">
								<button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown" aria-expanded="false">
									Opciones
								</button>
								<ul class="dropdown-menu">
									<li><a class="dropdown-item" href="?pagina=MonitoresPingEdit&Tarea='. $tareaPing -> getId() .'">Editar</a></li>
									<li><a class="dropdown-item" href="./?pagina=EliminarTarea&Tarea=' . $tareaPing -> getId() . '">Eliminar</a></li>
									<!--<li><a class="dropdown-item" href="#">Ignorar</a></li>-->
								</ul>
							</div>

                        </td>
                    </tr>
	';
}                    
$contenido .='                    
                    <!-- Repite el bloque <tr> para cada tarea -->
                </tbody>
            </table>
            <div class="container mt-3 text-center">
				<a href="./?pagina=MonitoresPingEdit" class="btn btn-primary">
					➕ Crear Nueva Tarea Ping
				</a>
				<a href="./?pagina=Dashboard" class="btn btn-secondary m-2">
					🔙 Volver al Dashboard
				</a>
			</div>
            
        </div>
    </div>
<!--</div>-->


	<script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>

	<script>
		$(document).ready(function() {
			// Inicializar DataTables
			$("#tablaTareasPing").DataTable({
				"columnDefs": [
					//{ "targets": [1], "visible": false }, // Ocultar columna ID Monitoreo
					//{ "orderable": false, "targets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, // Desactiva el ordenamiento en las columnas especificadas
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
				// No quiero colores.... ahora datos en bruto. Estamos editando...
				//"rowCallback": function(row, data) {
					// Aplicar clases según el nivel de alerta
				//	var nivelAlerta = data[6]; // Cambia el índice si el nivel de alerta está en otra columna
					// Asegúrate de que estos valores coincidan con los niveles de alerta esperados
				//	if (nivelAlerta === "crítico") {
				//		$(row).addClass("bg-danger"); // Clase para crítico
				//	} else if (nivelAlerta === "advertencia") {
				//		$(row).addClass("bg-warning"); // Clase para advertencia
				//	} else if (nivelAlerta === "información") {
				//		$(row).addClass("bg-success"); // Clase para información
				//	} else {
				//		$(row).addClass("bg-secondary"); // Clase por defecto si no coincide
				//	}
				//}
			});
		});
	</script>



';

//$templateContent->loadCssDropdownOnDatatables();

$templateContent -> setContenido($contenido);

?>
