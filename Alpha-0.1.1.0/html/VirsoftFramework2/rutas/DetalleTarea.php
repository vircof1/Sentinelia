<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Detalles de Tarea");

// Verificamos la ID de la tarea por GET
if (isset($_GET['id']) && is_numeric($_GET['id'])) {
    $idTarea = (int)$_GET['id'];

    $sql = "SELECT * FROM `monitoreo` WHERE `id_monitoreo` = ? LIMIT 1;";
    $params = [['type' => 'i', 'value' => $idTarea]];
    $datosTarea = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

    if (is_array($datosTarea)) {
        switch ($datosTarea['tipo_prueba']) {
            case 'ping':
                $tarea = new TareaPing($datosTarea);
                break;
            case 'tcp':
                $tarea = new TareaTCP($datosTarea);
                break;
            default:
                die("Tipo de tarea no soportado.");
        }
    } else {
        die("Tarea no encontrada.");
    }
} else {
    die("ID de tarea no válido.");
}

$usuario -> debugLog( $tarea -> getInfoTicket(), 'Tiket de Soporte:' );


// Datos comunes
$nombreServicio = htmlspecialchars($tarea->getNombreServicio());
$estadoResultado = $tarea->getEstadoResultado();
$descripcionFallo = nl2br(htmlspecialchars($tarea->getDescripcionFallo()));
$posibleCausa = nl2br(htmlspecialchars($tarea->getPosibleCausa()));

// 🔍 Información específica por tipo de tarea
$infoEspecifica = '';

//informacion añadida para tareas Ping
if ($tarea instanceof TareaPing) {
    $urlServicio = htmlspecialchars($tarea->getURL());

    $infoEspecifica = '
		<tr>
			<th scope="row"> Host (Ping): </th>
			<td>' . $urlServicio . '</td>
		</tr>';
    
    
    
    
}

//informacion añadida para tareas TCP
if ($tarea instanceof TareaTCP) {
    $host = htmlspecialchars($tarea->getHost());
    $puerto = htmlspecialchars($tarea->getPuerto());
    $infoEspecifica = '
    	<tr>
			<th scope="row"> Host (TCP): </th>
			<td><p class="card-text"><span class="badge bg-info">' . $host . '</span></p></td>
		</tr>
		
		<tr>
			<th scope="row"> Puerto: </th>
			<td><p class="card-text"><span class="badge bg-info">' . $puerto . '</span></p></td>
		</tr>
    
    ';    
}




// Determinar el color del badge para el nivel de alerta
$nivelAlerta = $tarea->getNivelAlerta();
$claseBadgeAlerta = match ($nivelAlerta) {
    'información' => 'bg-success',
    'advertencia' => 'bg-warning',
    'crítico'     => 'bg-danger',
    default       => 'bg-secondary'
};


// 📋 Contenido del card (nuevo diseño estructurado por columnas)
$contenido = '


<div class="container mt-4">
    <div class="card mb-3">
        <div class="card-header text-center">
            <h4>Detalles de la Tarea: <strong>'. $nombreServicio .'</strong> </h4>
        </div>
        <div class="card-body">



<div class="container mt-4">
    <div class="row">
        <!-- Panel de Información (8 columnas) -->
        <div class="col-md-8">
            <fieldset class="border rounded p-3 mb-4">
    <legend class="w-auto px-2 fw-bold">📌 Detalles de la Tarea</legend>
    <table class="table table-sm mb-0">
        <tbody>
            <tr>
                <th scope="row">Nombre del Servicio</th>
                <td><span class="badge bg-secondary">' . $nombreServicio . '</span></td>
            </tr>
            <tr>
                <th scope="row">Estado Actual ' . ucfirst($estadoResultado) . ' </th>
                <td><span class="badge ' . $claseBadgeAlerta . '">' . ucfirst($nivelAlerta) . '</span></td>
            </tr>';
if ($estadoResultado === 'fallo') {
    $contenido .= '
            <tr>
                <th scope="row">Descripción del Fallo</th>
                <td>' . $descripcionFallo . '</td>
            </tr>
            <tr>
                <th scope="row">Posible Causa</th>
                <td>' . $posibleCausa . '</td>
            </tr>';
}
if (!empty($infoEspecifica)) {
    $contenido .= $infoEspecifica;
}
$contenido .= '
        </tbody>
    </table>
</fieldset>';



$contenido .='
        </div>

        <!-- Panel de Acciones (4 columnas) -->
        <div class="col-md-4">
            <fieldset class="border rounded p-3 mb-4">
                <legend class="w-auto px-2 fw-bold">⚙️ Acciones</legend>
                <div class="d-grid gap-2">
					';
if ($configuracionWeb->getMetodoEnvioTiket() === 'POST') {
    $contenidoJsonEncode = htmlspecialchars(json_encode($tarea->getInfoTicket()), ENT_QUOTES, 'UTF-8');

    $contenido .= '
					<form method="POST" action="' . htmlspecialchars($configuracionWeb->getUrlNotificacionTiket(), ENT_QUOTES, "UTF-8") . '">
						<input type="hidden" name="ticketJson" value="' . $contenidoJsonEncode . '">
						<button type="submit" class="btn btn-danger w-100">Generar Ticket</button>
					</form>
    ';
} else {
    $contenido .= '
					<a href="' . htmlspecialchars($configuracionWeb->getUrlNotificacionTiket(), ENT_QUOTES, "UTF-8") . '" class="btn btn-danger">Generar Ticket</a>
    ';
}
                	
$contenido .='                					
                    
                    <button class="btn btn-secondary" onclick="window.history.back();">Volver</button>';

if ($usuario->puedeAuditar($tarea->getId())) {
    $contenido .= '
                    <a href="./?pagina=VisorEventosTarea&Tarea=' . $tarea->getId() . '" class="btn btn-info">Ver Historial de Eventos</a>';
}

$contenido .= '
                </div>
            </fieldset>
        </div>
    </div>
</div>

</div></div></div>

';


$templateContent->setTitulo("Detalles de Tarea - $nombreServicio");
$templateContent->setContenido($contenido);
?>




