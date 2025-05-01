<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}



// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Bashboard");


// Instanciamos, grupo de tareas
$tareas = new TareaS();

// Definimos la clase de la card en reposo, como si todo estubiera bien..
$claseCssCardDashboard = 'bg-success';

// Vemos si existe alguna advertencia...
if ( $tareas->getCountTareasFallidas('advertencia') > 0 ){
	$claseCssCardDashboard = 'bg-warning';
}

// Vemos si existe alguna tarea en estado critico....
if ( $tareas->getCountTareasFallidas('crítico') > 0 ){
	$claseCssCardDashboard = 'bg-danger';
}


$contenido = '
<h1>Buscador WEB:</h1>
<input id="searchInput" class="form-control form-control-lg" type="text" placeholder="Buscar en Google" aria-label=".form-control-lg example" autocomplete="off">


    <script>
        // Colocar el cursor en el input automáticamente al cargar la página
        document.addEventListener("DOMContentLoaded", function() {
            document.getElementById("searchInput").focus();
        });

        document.getElementById("searchInput").addEventListener("keypress", function(event) {
            // Verifica si la tecla presionada es "Enter"
            if (event.key === "Enter") {
                // Obtiene el valor del input
                const query = this.value;
                // Redirige a Google con la búsqueda
                window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            }
        });
    </script>
    






<!--
bg-success bg-warning bg-danger bg-dark
-->

<div class="container mt-4">
    <!-- Tarjeta de Estado General -->
    <div class="card text-white '. $claseCssCardDashboard .' mb-3">
        <div class="card-header">Estado General</div>
        <div class="card-body">
            <h5 class="card-title">Sistemas Monitorizados: '. $tareas -> getCountTareas() .'</h5>
            <p class="card-text">
';

$acordionCriticas = false;
$acordionAdvertencia = false;

// Informe general de contadores, solo mostrando la informacion relevante:
if ($tareas->getCountTareasFallidas('crítico') > 0) {
	$acordionCriticas = true;
    $contenido .= 'Sistemas en estado críticos: <span class="badge text-bg-danger" style="border: 2px solid #FFa0a0; border-radius: 0.25rem;">' . $tareas->getCountTareasFallidas('crítico') . '</span> | ';
}

if ($tareas->getCountTareasFallidas('advertencia') > 0) {
	$acordionAdvertencia = true;
    $contenido .= 'Advertencias: <span class="badge text-bg-warning" style="border: 2px solid #FFEBA0; border-radius: 0.25rem;">' . $tareas->getCountTareasFallidas('advertencia') . '</span> | ';
}

if ($tareas->getCountTareasSuccess() > 0) {
    $contenido .= 'Sistemas operativos: <span class="badge text-bg-success" style="border: 2px solid #A0EBA0; border-radius: 0.25rem;">' . $tareas->getCountTareasSuccess() . '</span>';
}


// Aquí mostramos los acordeones dependiendo de los booleanos
if ($acordionCriticas || $acordionAdvertencia) {
    $contenido .= '
    <h6>Detalles de Incidencias:</h6>
    <div class="accordion accordion-flush" id="accordionFlushExample">';
    
    if ($acordionCriticas) {
		
        $contenido .= '
        <div class="accordion-item">
            <h2 class="accordion-header">
                <button class="btn btn-danger accordion-button collapsed" type="button" data-coreui-toggle="collapse" data-coreui-target="#flush-collapseCritico" aria-expanded="false" aria-controls="flush-collapseCritico">
                    Críticos:
                </button>
            </h2>
            <div id="flush-collapseCritico" class="accordion-collapse collapse" data-coreui-parent="#accordionFlushExample">
                <div class="accordion-body">
                    <table class="table table-borderless">
                        <tbody>';
        
        // Aquí iría un foreach() para listar las tareas críticas
        foreach ($tareas->getTareasFallidas('crítico') as $tarea) {
			$usuario -> debugLog( $tarea -> getInfoTicket(), 'Tiket de Soporte:' );
            $contenido .= '
            <tr>
                <td>' . $tarea -> getNombreServicio() . '</td>
                <td>
                    <div class="dropdown">
                        <button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown" aria-expanded="false">
                            Opciones
                        </button>
                        <ul class="dropdown-menu">
                            <li><a class="dropdown-item" href="#">Generar Ticket</a></li>
                            <!--<li><a class="dropdown-item" href="#">Ver Detalles</a></li>-->
                            <li><a class="dropdown-item" href="./?pagina=DetalleTarea&id='.$tarea->getId().'">Ver Detalles</a></li>
                            <li><a class="dropdown-item" href="#">Ignorar</a></li>
                        </ul>
                    </div>
                </td>
            </tr>';
        }

        $contenido .= '
                        </tbody>
                    </table>
                </div>
            </div>
        </div>';
    }

    if ($acordionAdvertencia) {
        $contenido .= '
        <div class="accordion-item">
            <h2 class="accordion-header">
                <button class="btn btn-warning accordion-button collapsed" type="button" data-coreui-toggle="collapse" data-coreui-target="#flush-collapseAdvertencia" aria-expanded="false" aria-controls="flush-collapseAdvertencia">
                    Advertencias:
                </button>
            </h2>
            <div id="flush-collapseAdvertencia" class="accordion-collapse collapse" data-coreui-parent="#accordionFlushExample">
                <div class="accordion-body">
                    <table class="table table-borderless">
                        <tbody>';
        
        // Aquí iría un foreach() para listar las tareas con advertencia
        foreach ($tareas->getTareasFallidas('advertencia') as $tarea) {
			$usuario -> debugLog( $tarea -> getInfoTicket(), 'Tiket de Soporte:' );
            $contenido .= '
            <tr>
                <td>' . $tarea -> getNombreServicio() . '</td>
                <td>
                    <div class="dropdown">
                        <button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown" aria-expanded="false">
                            Opciones
                        </button>
                        <ul class="dropdown-menu">
                            <li><a class="dropdown-item" href="#">Generar Ticket</a></li>
                            <li><a class="dropdown-item" href="./?pagina=DetalleTarea&id='.$tarea->getId().'">Ver Detalles</a></li>
                            <li><a class="dropdown-item" href="#">Ignorar</a></li>
                        </ul>
                    </div>
                </td>
            </tr>';
        }

        $contenido .= '
                        </tbody>
                    </table>
                </div>
            </div>
        </div>';
    }


	
    $contenido .= '</div>'; // Cierra el accordion
}






$contenido .='


            <!-- Fin Incidencias -->
        </div>
    </div>
</div>




















    <!-- Tarjeta de Estado de Servicios 
 <div class="card text-white bg-warning mb-3">
        <div class="card-header">Estado de Servicios</div>
        <div class="card-body">
            <h5 class="card-title">Servicios Activos: 15</h5>
            <p class="card-text">
                Críticos: <span class="badge badge-danger incidencia">1</span> | 
                Advertencias: <span class="badge badge-warning incidencia">2</span> | 
                Operativos: <span class="badge badge-success incidencia">12</span>
            </p>

            <!-- Panel de Incidencias 
            <div class="incidencias-panel" style="display: none;">
                <h6>Detalles de Incidencias:</h6>
                <ul class="list-unstyled">
                    <li>Incidencia 4: Caída del servidor de aplicaciones. 
                        <button class="btn btn-primary btn-sm">Generar Ticket</button>
                    </li>
                </ul>
            </div>
        </div>
    </div>

    <!-- Tarjeta de Información General
    <div class="card text-white bg-success mb-3">
        <div class="card-header">Estado del Sistema</div>
        <div class="card-body">
            <h5 class="card-title">Todo funcionando bien</h5>
            <p class="card-text">No hay problemas detectados en este momento.</p>
        </div>
    </div>

    <!-- Tarjeta de Problemas de Monitoreo
    <div class="card text-white bg-dark mb-3">
        <div class="card-header">Problemas de Monitoreo</div>
        <div class="card-body">
            <h5 class="card-title">Fallo en el sistema de monitoreo</h5>
            <p class="card-text">Estamos a ciegas. Por favor, revise los sistemas manualmente.</p>
        </div>
    </div>
</div>

-->










';



//var_dump ( $tareas -> getTareas() );
//var_dump ( $tareas -> getTareasFallidas( 'test' ) );
//var_dump( $tareas -> getCountTareasFallidas( 'test' ) );





$templateContent -> setContenido( $contenido );


?>
