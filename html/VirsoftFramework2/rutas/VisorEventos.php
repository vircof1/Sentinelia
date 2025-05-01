<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Visor eventos");

if (!$usuario->puedeAuditarCualquierCosa()) {
    header("Location: ?pagina=Dashboard");
    exit;
}



$haceSeisMeses = new DateTime();
$haceSeisMeses->modify('-6 months');

$eventos = new logEventS(
    $haceSeisMeses,
    null,
    $usuario->queTareasPuedeAuditar()
);

$usuario->debugLog($eventos, "Eventos:");

$contenido = '

<!--
<div class="modal" id="detalleEvento"> ... </div>
<div class="card text-white bg-dark mb-3"> ... </div>
-->
';

$lista = $eventos->getEventos();
if (is_array($lista) && count($lista) > 0) {

    $contenido .= '
    <div class="card">
        <div class="card-header">
            <h5 class="card-title">Visor de Eventos Global</h5>
        </div>
        <div class="card-body">
            <table id="logTable" class="table table-responsive-sm table-bordered table-striped table-sm">
                <thead>
                    <tr>
                        <th>Nº de evento</th>
                        <th>ID Monitoreo</th>
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

    foreach ($lista as $evento) {
        $tarea = $evento->getTarea();
        $contenido .= '
            <tr>
                <td>' . htmlspecialchars($evento->getId()) . '</td>
                <td>' . htmlspecialchars($evento->getIdTarea()) . '</td>
                <td><a href="./?pagina=VisorEventosTarea&Tarea=' . $evento->getIdTarea() . '">' . htmlspecialchars($tarea->getNombreServicio()) . '</a></td>
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

    $contenido .= '
                </tbody>
            </table>
        </div>
    </div>

    <script>
    $(document).ready(function() {
        $("#logTable").DataTable({
            "columnDefs": [
                { "targets": [1], "visible": false },
                { "orderable": false, "targets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
            ],
            "order": [[0, "desc"]],
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
                },
                "oAria": {
                    "sSortAscending": ": Activar para ordenar la columna de manera ascendente",
                    "sSortDescending": ": Activar para ordenar la columna de manera descendente"
                }
            },
            "rowCallback": function(row, data) {
                var nivelAlerta = data[10];
                if (nivelAlerta === "crítico") {
                    $(row).addClass("bg-danger");
                } else if (nivelAlerta === "advertencia") {
                    $(row).addClass("bg-warning");
                } else if (nivelAlerta === "información") {
                    $(row).addClass("bg-success");
                } else {
                    $(row).addClass("bg-secondary");
                }
            }
        });
    });
    </script>
    ';
}


$templateContent->setContenido($contenido);
?>

