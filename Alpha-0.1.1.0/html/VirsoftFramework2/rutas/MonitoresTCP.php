<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


if( !$usuario->puedeEditarTareas() ){
    $usuario->debugLog('No tienes permisos para editar/eliminar tareas.', 'Permisos:');
    $templateContent->setToastForNextPage('No tienes permisos para editar/eliminar tareas', 'warning');
    header("Location: ./", true, 302);
    exit;
}




$templateContent -> setTitulo( "Monitores TCP" );
// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Monitores TCP");

$tareas = new tareas(false);
$tareasTCP = $tareas -> getTareasTCP();

$contenidoTabla = '';

function truncarTexto($texto, $longitud = 25) {
    return (strlen($texto) > $longitud) ? substr($texto, 0, $longitud) . '...' : $texto;
}

foreach ($tareasTCP as $tareaTCP) {
	//var_dump( $tareaPing );
	
	$nombreServicio = htmlspecialchars( $tareaTCP->getNombreServicio() );
	$nombreServicioLittle = htmlspecialchars( truncarTexto( $tareaTCP->getNombreServicio() ) );
    $host = htmlspecialchars( $tareaTCP->getHost() );
    $hostLittle = htmlspecialchars( truncarTexto( $tareaTCP->getHost() ) );
    $intervaloMinutos = $tareaTCP->getIntervaloMinutos();
    $ultimaEjecucion = htmlspecialchars($tareaTCP->getUltimaEjecucion());
    $estadoResultado = htmlspecialchars($tareaTCP->getEstadoResultado());
    $mensajeAlerta = htmlspecialchars($tareaTCP->getMensajeAlerta());
    $nivelAlerta = htmlspecialchars($tareaTCP->getNivelAlerta());
    $proximaEjecucion = htmlspecialchars($tareaTCP->getProximaEjecucion());
    $intentosPermitidos = $tareaTCP->getIntentosPermitidos();
    $habilitada = $tareaTCP->getHabilitada() ? '✔️' : '❌';
    $idTarea = $tareaTCP->getId();
	
	
	$contenidoTabla .= '
				<tr>
					<td style="text-align: center;" title="'. $nombreServicio .'">' . $nombreServicioLittle . '</td>
					<td style="text-align: center;" title="'. $host .'">' . $hostLittle . '</td>
					
					<td style="text-align: center;">' . $intervaloMinutos . '</td>
					<td style="text-align: center;">' . $ultimaEjecucion . '</td>
					<td style="text-align: center;" title="'. $mensajeAlerta .'">' . $estadoResultado . '</td>
					<!--<td style="text-align: center;">' . $mensajeAlerta . '</td>-->
					<td style="text-align: center;" title="'. $mensajeAlerta .'">' . $nivelAlerta . '</td>
					<td style="text-align: center;">' . $proximaEjecucion . '</td>
					<td style="text-align: center;">' . $intentosPermitidos . '</td>
					<td style="text-align: center;">' . $habilitada . '</td>
                    <td style="text-align: center;">
                        <div class="dropdown">
                            <button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown">
                                Opciones
                            </button>
                            <ul class="dropdown-menu">
                                <li><a class="dropdown-item" href="./?pagina=MonitoresTCPEdit&Tarea='.$idTarea.'">Editar</a></li>
                                <li><a class="dropdown-item" href="./?pagina=EliminarTarea&Tarea='.$idTarea.'">Eliminar</a></li>
                            </ul>
                        </div>
                    </td>
                </tr>
	';
}




$contenido ='
<div class="card">
    <div class="card-header">
        <h5 class="card-title">Listado de Tareas TCP</h5>
    </div>
    <div class="card-body">
        <table class="table table-striped table-bordered" id="tablaTareasTCP">
            <thead>
                <tr>
                    <th>Nombre del Servicio</th>
                    <th>Servidor</th>
                    <!--<th>Puerto TCP</th>-->
                    <th>Intervalo (min)</th>
                    <th>Última Ejecución</th>
                    <th>Estado Resultado</th>
                    <!--<th>Mensaje Alerta</th>-->
                    <th>Nivel Alerta</th>
                    <th>Próxima Ejecución</th>
                    <th>Intentos Permitidos</th>
                    <th>Habilitada</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                <!-- Ejemplo de fila -->
                
                '. $contenidoTabla .'
                <!--<tr>
                    <td>Servidor Principal</td>
                    <td>192.168.1.1</td>
                    <td>5</td>
                    <td>10/02/2025, 14:46:37</td>
                    <td>éxito</td>
                    <td>Conexión TCP Exitosa</td>
                    <td>información</td>
                    <td>10/02/2025, 14:51:37</td>
                    <td>3</td>
                    <td>✔️</td>
                    <td>
                        <div class="dropdown">
                            <button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown">
                                Opciones
                            </button>
                            <ul class="dropdown-menu">
                                <li><a class="dropdown-item" href="?pagina=MonitoresTCPEdit&Tarea=1">Editar</a></li>
                                <li><a class="dropdown-item" href="./?pagina=EliminarTarea&Tarea=1">Eliminar</a></li>
                            </ul>
                        </div>
                    </td>
                </tr>-->
            </tbody>
        </table>
        <div class="container mt-3 text-center">
            <a href="./?pagina=MonitoresTCPEdit" class="btn btn-primary">
                ➕ Crear Nueva Tarea TCP
            </a>
            <a href="./?pagina=Dashboard" class="btn btn-secondary m-2">
                🔙 Volver al Dashboard
            </a>
        </div>
    </div>
</div>
<script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
<script>
    $(document).ready(function() {
        $("#tablaTareasTCP").DataTable({
            autoWidth: false,
            // scrollX eliminado para evitar barra horizontal innecesaria
            "language": {
                "sProcessing": "Procesando...",
                "sLengthMenu": "Mostrar _MENU_ registros",
                "sZeroRecords": "No se encontraron resultados",
                "sEmptyTable": "Ningún dato disponible en esta tabla",
                "sInfo": "Mostrando registros del _START_ al _END_ de un total de _TOTAL_ registros",
                "sInfoEmpty": "Mostrando registros del 0 al 0 de un total de 0 registros",
                "sInfoFiltered": "(filtrado de un total de _MAX_ registros)",
                "sSearch": "Buscar:",
                "oPaginate": {
                    "sFirst": "Primero",
                    "sLast": "Último",
                    "sNext": "Siguiente",
                    "sPrevious": "Anterior"
                }
            },
            "order": [[0, "desc"]]
        });
    });
</script>
';


$templateContent -> loadCssDropdownOnDatatables();

$templateContent -> setContenido( $contenido );

?>
