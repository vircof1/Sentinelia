<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Menú de usuarios");


if (!$usuario->puedeVerCualquierUsuario()) {
    header("Location: ?pagina=dashboard");
    exit;
}


$listadoSQLUsuarios = usuarioS::listarUsuarios();
$listadoSQLUsuarios = $usuario -> queUsuariosPuedeEditar();

$usuario->debugLog($listadoSQLUsuarios, 'Listado usuarios:');

function renderEmojisRolesUsuario($fila) {
    $emojis = [];

	if (!empty($fila['DefaultRead'])) {
		$emojis[] = '<span class="badge bg-secondary me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Lectura de tareas</strong><br>Puede ver información actual de tareas y monitores.">
						👁️
					</span>';
	}

	if (!empty($fila['DefaultEdit'])) {
		$emojis[] = '<span class="badge bg-primary me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Edición de tareas</strong><br>Puede modificar tareas y monitores del sistema.">
						📄
					</span>';
	}

	if (!empty($fila['DefaultAudit'])) {
		$emojis[] = '<span class="badge bg-warning text-dark me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Auditoría</strong><br>Acceso a registros y trazabilidad de tareas, monitores y eventos.">
						🔍
					</span>';
	}

	if (!empty($fila['DefaultAdminUserS'])) {
		$emojis[] = '<span class="badge bg-info text-dark me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Gestión de usuarios</strong><br>Puede ver, crear o modificar usuarios registrados.">
						👥
					</span>';
	}

	if (!empty($fila['defaultAdminSettings'])) {
		$emojis[] = '<span class="badge bg-danger me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Configuración general</strong><br>Acceso completo a las opciones del portal.">
						⚙️
					</span>';
	}

	if (!empty($fila['SuperUsuario'])) {
		$emojis[] = '<span class="badge bg-dark text-white me-1"
						  style="cursor: default;"
						  data-coreui-toggle="popover"
						  data-coreui-html="true"
						  data-coreui-content="<strong>Superusuario:</strong><br>Puede simular cualquier permiso.<br>Puede simular a cualquier usuario.<br>Menú debug disponible.<br><i>Solo desarrolladores deberían tener este rol.</i>">
						👑
					</span>';
	}


    return implode(' ', $emojis);
}

// pruebas de CSS:
$templateContent -> addCssHead('<link href="Template/css/coreui.min.css" rel="stylesheet">');
$templateContent->addCssHead('
<style>
.popover {
  background-color: #343a40;
  color: #f8f9fa;
  border: 1px solid #212529;
}

.popover-header {
  background-color: #212529;
  color: #f8f9fa;
  font-weight: bold;
}

.popover-body {
  color: #e9ecef;
}

/* Flechita (ambas capas: fondo y borde) */
.popover .popover-arrow::before,
.popover .popover-arrow::after {
  border-top-color: #343a40 !important; /* Color del fondo del popover */
}
</style>
');

// JS para activar los popovers con HTML
$templateContent->addJsFooter('
<script>
    document.querySelectorAll(\'[data-coreui-toggle="popover"]\').forEach(el => {
        new coreui.Popover(el, {
            trigger: "hover",
            html: true,
            placement: "top"
        });
    });
</script>
');


$contenido ='


<div class="card mb-4">
  <div class="card-header">
    <strong>Gestión de Usuarios</strong>
  </div>
  <div class="card-body">
    <div class="">
      <table class="table table-striped table-hover table-bordered align-middle">
        <thead class="table-dark">
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Usuario</th>
            <th scope="col">Email</th>
            <th scope="col">Nombre</th>
            <th scope="col">Apellidos</th>
            <th scope="col">Último acceso</th>
            <th scope="col">Veces conectado</th>
            <th scope="col">Rol</th>
            <th scope="col" style="text-align: center;">Acciones</th>
          </tr>
        </thead>
        <tbody>
';

foreach ($listadoSQLUsuarios as $filaUsuario){

	$contenido .= '
			  <tr>
				<td>'. $filaUsuario['ID'] .'</td>
				<td>'. $filaUsuario['Usuario'] .'</td>
				<td>'. $filaUsuario['Email'] .'</td>
				<td>'. $filaUsuario['Nombre'] .'</td>
				<td>'. $filaUsuario['Apellidos'] .'</td>
				<td><span class="hora-utc" data-fecha="'. $filaUsuario['UltimaFechaInicioSesion'] .'"></span></td>
				<td>'. $filaUsuario['ContadorInicioSesion'] .'</td>
				<td>'.renderEmojisRolesUsuario($filaUsuario).'</td>
				<td style="text-align: center; position: relative;">
				  <div class="dropdown">
					<button class="btn btn-secondary dropdown-toggle" type="button" data-coreui-toggle="dropdown" aria-expanded="false">
					  Opciones
					</button>
					<ul class="dropdown-menu dropdown-menu-end">
					';
	if( !((int)$filaUsuario['ID'] === (int)$usuario -> getIdUsuario()) ){
		$contenido .='
					  <li><a class="dropdown-item" href="./?pagina=MenuUsuariosEditar&ID='. $filaUsuario['ID'] .'">Editar</a></li>
					  <li><a class="dropdown-item" href="./?pagina=EliminarUsuario&ID='. $filaUsuario['ID'] .'">Eliminar</a></li>
		
		';
	}else{
		$contenido .='<li><div class="dropdown-item">No puedes editarte a ti mismo</div></li>';
	}
					  
	$contenido .='
					</ul>
				  </div>
				</td>	
			  </tr>
	';
}
          
$contenido .= '          
          <!-- Aquí puedes repetir más filas -->
        </tbody>
      </table>
    </div>
  </div>
</div>

<a href="./?pagina=MenuUsuariosEditar" class="btn btn-success mb-3">
  ➕ Crear nuevo usuario
</a>


';



$templateContent -> setContenido($contenido);

?>
