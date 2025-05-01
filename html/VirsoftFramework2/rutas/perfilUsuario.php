<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Perfil de usuario: " . $usuario->getNombre());


$contenido = '<div class="row justify-content-center">
';



if ($usuario->getSuperUsuario()) {
    // Bloque de superusuario
    
    $templateContent -> addCssHead('
    <style>
		fieldset {
		  border: 1px solid #dee2e6;
		  border-radius: 0.25rem;
		  padding: 1rem;
		}
		legend {
		  font-weight: 600;
		  font-size: 1rem;
		}
	</style>
    ');
    
    $contenido .= '
    
    <div class="card border-danger mb-4 col-md-4">
      <div class="card-header bg-danger text-white">
        <strong>Zona de Superusuario</strong>
      </div>
      <div class="card-body">
		<fieldset class="mb-3">
		  <legend>Modo Depuración</legend>

			<!-- Formulario: Modo Depuración -->
			<form method="POST" class="mb-3">
			  <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
			  <div class="mb-2">
				<label for="debugToggle" class="form-label"></label>
				<select name="debug_mode" id="debugToggle" class="form-select">
				  <option value="1" ' . ($usuario->isDebugMode() ? 'selected' : '') . '>Activado</option>
				  <option value="0" ' . (!$usuario->isDebugMode() ? 'selected' : '') . '>Desactivado</option>
				</select>
			  </div>
			  <button type="submit" name="guardar_debug" value="1" class="btn btn-sm btn-outline-danger">Guardar Modo Debug</button>
			</form>
		</fieldset>
	';
	
	
	// Obtenemos el listado de usuarios:
	$usuariosLista = usuarioS::listarUsuarios();

	$contenido .= '
		<fieldset class="mb-3">
		  <legend>Personarse como:</legend>		
	
			<form method="POST" class="mb-3">
				<input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
				<label for="impersonarse"></label>
				<select name="impersonarse_id" id="impersonarse" class="form-select">
					<option value="">-- Selecciona un usuario --</option>';
				
	foreach ($usuariosLista as $u) {
		// Evitamos mostrar el propio superusuario para evitar loops raros
		if ($u['ID'] != $usuario->getIdUsuario()) {
			$contenido .= '<option value="' . $u['ID'] . '">' . $u['ID'] . ' - ' . 
			htmlspecialchars($u['Usuario']) . ' - ' . htmlspecialchars($u['Nombre']) . ' ' . 
			htmlspecialchars($u['Apellidos']) .'</option>';
		}
	}

	$contenido .= '
				</select>
				<button type="submit" class="btn btn-warning mt-2">Personarse</button>
			</form>
		</fieldset>';


/*    if ($usuario->estaImpersonando()) {
        $contenido .= '
        <form method="POST" class="mb-3">
          <button type="submit" name="revertir_impersonacion" value="1" class="btn btn-sm btn-outline-secondary">Volver a mi sesión original</button>
        </form>';
    }
*/
    // Formulario: Permisos propios
    $contenido .= '
    
		<fieldset class="mb-3">
			  <legend>Permisos por defecto:</legend>		
			  
				<form method="POST">
				  <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
				  <div class="mb-2"><strong></strong></div>
				  <div class="form-check">
					<input class="form-check-input" type="checkbox" name="defaultEdit" id="defaultEdit" ' . ($usuario->getDefaultEdit() ? 'checked' : '') . '>
					<label class="form-check-label" for="defaultEdit">Permiso de Edición</label>
				  </div>
				  <div class="form-check">
					<input class="form-check-input" type="checkbox" name="defaultRead" id="defaultRead" ' . ($usuario->getDefaultRead() ? 'checked' : '') . '>
					<label class="form-check-label" for="defaultRead">Permiso de Lectura</label>
				  </div>
				  <div class="form-check">
					<input class="form-check-input" type="checkbox" name="defaultAudit" id="defaultAudit" ' . ($usuario->getDefaultAudit() ? 'checked' : '') . '>
					<label class="form-check-label" for="defaultAudit">Permiso de Auditoría</label>
				  </div>
				  <div class="form-check">
					<input class="form-check-input" type="checkbox" name="defaultAdminUserS" id="defaultAdminUserS" ' . ($usuario->getDefaultAdminUserS() ? 'checked' : '') . '>
					<label class="form-check-label" for="defaultAdminUserS">Administrador de Usuarios</label>
				  </div>
				  <div class="form-check">
					<input class="form-check-input" type="checkbox" name="defaultAdminSettings" id="defaultAdminSettings" ' . ($usuario->getDefaultAdminSettings() ? 'checked' : '') . '>
					<label class="form-check-label" for="defaultAdminSettings">Administrador de Configuración</label>
				  </div>
				  <button type="submit" name="guardar_permisos" value="1" class="btn btn-sm btn-outline-success mt-2">Guardar Permisos</button>
				</form>
		</fieldset>
      </div>
    </div>';
}
















// si esta impersonado como otro usuario, permite volver:
if (isset($_SESSION['impersonando_desde'])) {
    $contenido .= '
    <div class="card border-danger mb-4 col-md-4">
        <div class="card-header">
            <strong>Sesión Impersonada</strong>
        </div>
        <div class="card-body">
            <p>Estás actuando como otro usuario.</p>
            <form method="POST">
				<input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
                <input type="hidden" name="revertir_impersonacion" value="1">
                <button type="submit" class="btn btn-outline-danger">Volver a mi sesión original</button>
            </form>
        </div>
    </div>';
}















// Procesamiento del formulario
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    // Revertir impersonación (se permite aunque el usuario actual NO sea super)
    if (isset($_POST['revertir_impersonacion']) && isset($_SESSION['impersonando_desde'])) {
        $_SESSION['idUsuario'] = $_SESSION['impersonando_desde'];
        unset($_SESSION['impersonando_desde']);
        header("Location: " . $_SERVER['REQUEST_URI']);
        exit;
    }

    // Solo procesamos el resto si seguimos siendo superusuario
    if ($usuario->getSuperUsuario()) {

        // Modo debug
        if (isset($_POST['guardar_debug'])) {
            $usuario->setDebugMode((bool)$_POST['debug_mode']);
            header("Location: " . $_SERVER['REQUEST_URI']);
            exit;
        }

        // Guardar permisos
        if (isset($_POST['guardar_permisos'])) {
            $usuario->setDefaultEdit(isset($_POST['defaultEdit']));
            $usuario->setDefaultRead(isset($_POST['defaultRead']));
            $usuario->setDefaultAudit(isset($_POST['defaultAudit']));
            $usuario->setDefaultAdminUserS(isset($_POST['defaultAdminUserS']));
            $usuario->setDefaultAdminSettings(isset($_POST['defaultAdminSettings']));
            header("Location: " . $_SERVER['REQUEST_URI']);
            exit;
        }

        // Impersonarse como otro usuario
        if (isset($_POST['impersonarse_id']) && ctype_digit($_POST['impersonarse_id'])) {
			$_SESSION['impersonando_desde'] = $usuario->getIdUsuario(); // guarda tu ID original
            $_SESSION['idUsuario'] = (int)$_POST['impersonarse_id'];   // toma el nuevo ID
            header("Location: " . $_SERVER['REQUEST_URI']);
            exit;
        }
    }
}



$usuario->debugLog($usuario, 'Objeto Usuario');

// Obteniendo el Nº de Telefono




$telefono='No definido.';



if ( !is_null( $usuario->getTelefono() ) ){ 
	$raw = $usuario->getTelefono();
	$sanitized = preg_replace('/[^0-9]/', '', $raw);
	if (strpos($raw, '+') === 0) {
		$hrefTel = '+' . $sanitized;
	} else {
		$hrefTel = $sanitized;
	}
	
	$tmp = htmlspecialchars($raw);
	$telefono = '<a href="tel:' . $hrefTel . '">' . $tmp . '</a>';
}

// Obteniendo sus perfiles de seguridad por defecto:
$seguridadString = '';
$permisos = [];

if ($usuario->getDefaultEdit()) {
	$permisos[] = '<span style="cursor: default;" class="badge bg-primary me-1" data-coreui-toggle="tooltip" title="Lectura de tareas: Puede modificar tareas y monitores del sistema.">📄 Edición</span>';
}
if ($usuario->getDefaultRead()) {
	$permisos[] = '<span style="cursor: default;" class="badge bg-secondary me-1" data-coreui-toggle="tooltip" title="Edicion de tareas: Puede ver información actual de tareas y monitores.">👁️ Lectura</span>';
}
if ($usuario->getDefaultAudit()) {
	$permisos[] = '<span style="cursor: default;" class="badge bg-warning text-dark me-1" data-coreui-toggle="tooltip" title="Acceso a registros y trazabilidad de tareas, monitores y eventos.">🔍 Auditoría</span>';
}
if ($usuario->getDefaultAdminUserS()) {
	$permisos[] = '<span style="cursor: default;" class="badge bg-info text-dark me-1" data-coreui-toggle="tooltip" title="Gestiona usuarios registrados o nuevos.">👥 Usuarios</span>';
}
if ($usuario->getDefaultAdminSettings()) {
	$permisos[] = '<span style="cursor: default;" class="badge bg-danger me-1" data-coreui-toggle="tooltip" title="Configuracion general: Puede acceder y modificar la configuración general de este portal.">⚙️ Configuración</span>';
}

if (count($permisos) > 0) {
	$seguridadString = implode(' &nbsp;|&nbsp; ', $permisos);
} else {
	$seguridadString = '<em>Sin privilegios asignados</em>';
}



// Obtenemos la Fecha de nacimiento:
$fechaNac = $usuario->getFechaNacimiento();
$dataFecha = '';

if ($fechaNac instanceof DateTime) {
    $dataFecha = $fechaNac->format('Y-m-d');
}



$contenido .='
	<div class="card col-md-8">
	  <div class="card-header">
		<h5>Perfil de Usuario:</h5>
	  </div>
	  <div class="card-body">
		<!-- Sección de Avatar y Datos Básicos -->
		<div class="text-center mb-3">
		  <img src="" alt="Avatar" class="img-fluid rounded-circle" style="width: 120px;">
		  <h4 class="mt-2">'. htmlspecialchars($usuario->getNombre()) .' '. htmlspecialchars($usuario->getApellidos()) .'</h4>
		  <p class="text-muted">@'. htmlspecialchars( $usuario->getUsuario() ) .'</p>
		</div>

		<!-- Sección de Información Personal -->
		<div class="row">
		  <div class="col-md-6">
			<p><i class="cil-envelope-closed"></i> <strong>Email:</strong> '. htmlspecialchars( $usuario->getEmail() ) .'</p>
			<p><i class="cil-phone"></i> <strong>Teléfono: </strong>'.$telefono.'</p>
			<p><i class="cil-calendar"></i> <strong>Fecha de Nacimiento: </strong><span class="fecha-nacimiento" data-fecha=" ' . $dataFecha . '"></span></p>
			<p><i class="cil-map"></i> <strong>Dirección:</strong> Calle Falsa 123, Ciudad, País</p>
		  </div>
		  <div class="col-md-6">
			<p><strong>Biografía:</strong></p>
			<p>Breve descripción sobre el usuario.</p>
			<p>
			  <strong>Redes Sociales:</strong>
			  <a href="#" class="ml-2"><i class="cil-facebook"></i> Facebook</a>
			  <a href="#" class="ml-2"><i class="cil-twitter"></i> Twitter</a>
			  <a href="#" class="ml-2"><i class="cil-linkedin"></i> LinkedIn</a>
			</p>
		  </div>
		</div>

		<hr>

		<!-- Sección de configuraciones, que NO puede tocar. -->


		<div>
		  <p><strong>Seguridad por defecto: </strong> '.$seguridadString.' </p>
		</div>
	  </div>
	  <div class="card-footer text-center">
		<a href="./?pagina=perfilUsuarioEdit" class="btn btn-primary">Editar Perfil</a>
	  </div>
	</div>
</div>
';

$templateContent -> addJsFooter('
<script>
document.querySelectorAll(\'.fecha-nacimiento\').forEach(el => {
    const raw = el.dataset.fecha;
    const fecha = new Date(raw);

    if (isNaN(fecha.getTime())) {
        el.textContent = \'Fecha no disponible\';
    } else {
        el.textContent = fecha.toLocaleDateString(undefined, {
            day: \'2-digit\',
            month: \'2-digit\',
            year: \'numeric\'
        });
    }
});
</script>
');


$templateContent->setContenido($contenido);
?>
