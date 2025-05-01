<?php

if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Editar usuario");

$intIdUsuario = 0;

if (isset($_GET['ID'])){
	$intIdUsuario = (int) $_GET['ID'];
}
if (!$usuario->puedeEditarUsuario($intIdUsuario)) {
	header("Location: ?pagina=dashboard");
	exit;
}

// Funcion para sanear strings que pueden ser null:
function safeHtml($input) {
	return htmlspecialchars((string)$input, ENT_QUOTES, 'UTF-8');
}

// Seteamos los valores por defecto de la fila de usuario, por si es un usuario nuevo:
$filaUsuario['Usuario'] = '';
$filaUsuario['ID'] = 0;

$filaUsuario['Nombre'] = '';
$filaUsuario['Apellidos'] = '';
$filaUsuario['telefono'] = '';
$filaUsuario['Email'] = '';
$filaUsuario['fechaNacimiento'] = '';
$filaUsuario['EstadoCuenta'] = 'Activa';
$filaUsuario['sidebarHide'] = false;

// Permisos
$filaUsuario['DefaultRead'] = true;
$filaUsuario['DefaultEdit'] = false;
$filaUsuario['DefaultAudit'] = false;
$filaUsuario['DefaultAdminUserS'] = false;
$filaUsuario['defaultAdminSettings'] = false;


if ($intIdUsuario != 0){
	$filaUsuario = usuarioS::getInfoUsuario($intIdUsuario);
}
$usuario -> debugLog($filaUsuario, 'Info de usuario: ');



// Si nos llega un post:
$mensageErrores = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$resultado = usuarioS::procesarPostEdicionCreaccion($_POST);
	if (!$resultado['estado']){
		foreach( $resultado['motivo'] as $errorInfo ){
			$mensageErrores .=$errorInfo.'<br>';
		}
		// Devolvemos los valores del formulario en bruto. Luego saneamos html al imprimir el formulario.
		$filaUsuario['Nombre'] = $_POST['nombre'] ?? '';
		$filaUsuario['Apellidos'] = $_POST['apellidos'] ?? '';
		$filaUsuario['telefono'] = $_POST['telefono'] ?? '';
		$filaUsuario['Email'] = $_POST['email'] ?? '';
		$filaUsuario['fechaNacimiento'] = $_POST['fechaNacimiento'] ?? '';
		$filaUsuario['EstadoCuenta'] = $_POST['EstadoCuenta'] ?? 'Activa';
		$filaUsuario['sidebarHide'] = isset($_POST['sidebarHide']) ? 1 : 0;

		// Permisos
		$filaUsuario['DefaultRead'] = isset($_POST['DefaultRead']) ? 1 : 0;
		$filaUsuario['DefaultEdit'] = isset($_POST['DefaultEdit']) ? 1 : 0;
		$filaUsuario['DefaultAudit'] = isset($_POST['DefaultAudit']) ? 1 : 0;
		$filaUsuario['DefaultAdminUserS'] = isset($_POST['permAdminUserS']) ? 1 : 0;
		$filaUsuario['defaultAdminSettings'] = isset($_POST['permAdminSettings']) ? 1 : 0;
	}else{
		header("Location: ?pagina=MenuUsuarios");
		exit;
	}
}



$templateContent -> addJsFooter('

<script>
const alerta = document.getElementById(\'alerta-formulario\');
if (alerta.textContent.trim() === "") {
  alerta.classList.add(\'d-none\');
} else {
  alerta.classList.remove(\'d-none\');
}
</script>
' );



$contenido = '
<div class="body flex-grow-1 px-3">
  <div class="container-fluid">
    <div class="row justify-content-center">
      <div class="card mb-4 col-md-10">
        <div class="card-header">
          <strong class="ps-1">Editar usuario: '. safeHtml($filaUsuario['Usuario']) .'</strong>
        </div>
        <div class="card-body">

        
          <form method="POST" action="?pagina=MenuUsuariosEditar&ID='.intval($filaUsuario['ID']).'">
            <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
            <input type="hidden" id="ID" name="ID" value="'.intval($filaUsuario['ID']).'">

			<div id="alerta-formulario" class="alert alert-danger" role="alert">
			  '.$mensageErrores.'
			</div>

            <div class="row">
              <div class="col-md-6">
';				
				if ($filaUsuario['ID'] === 0){
					$contenido .='
						<div class="mb-3">
						  <label for="nombre" class="form-label">Usuario</label>
						  <input type="text" class="form-control" id="usuario" name="usuario" value="'.safeHtml($filaUsuario['Usuario']).'">
						</div>
					';
				}
				
				
$contenido .= '              
                <div class="mb-3">
                  <label for="nombre" class="form-label">Nombre</label>
                  <input type="text" class="form-control" id="nombre" name="nombre" value="'.safeHtml($filaUsuario['Nombre']).'">
                </div>

                <div class="mb-3">
                  <label for="apellidos" class="form-label">Apellidos</label>
                  <input type="text" class="form-control" id="apellidos" name="apellidos" value="'.safeHtml($filaUsuario['Apellidos']).'">
                </div>

                <div class="mb-3">
                  <label for="telefono" class="form-label">Teléfono</label>
                  <input type="text" class="form-control" id="telefono" name="telefono" value="'.safeHtml($filaUsuario['telefono']).'">
                </div>

                <div class="mb-3">
                  <label for="estado" class="form-label">Estado</label>
                  <select class="form-select" id="estado" name="EstadoCuenta">
                    <option value="Activa" '.($filaUsuario['EstadoCuenta'] === "Activa" ? 'selected' : '').'>Activa</option>
                    <option value="Bloqueada" '.($filaUsuario['EstadoCuenta'] === "Bloqueada" ? 'selected' : '').'>Bloqueada</option>
                  </select>
                </div>
              </div>

              <div class="col-md-6">
                <div class="mb-3">
                  <label for="email" class="form-label">Correo electrónico</label>
                  <input type="email" class="form-control" id="email" name="email" value="'.safeHtml($filaUsuario['Email']).'">
                </div>

                <div class="mb-3">
                  <label for="fechaNacimiento" class="form-label">Fecha de nacimiento</label>
                  <input type="date" class="form-control" id="fechaNacimiento" name="fechaNacimiento" value="'.safeHtml($filaUsuario['fechaNacimiento']).'">
                </div>

                <div class="form-check mb-3">
                  <input class="form-check-input" type="checkbox" id="sidebarHide" name="sidebarHide" value="1" '.($filaUsuario['sidebarHide'] ? 'checked' : '').'>
                  <label class="form-check-label" for="sidebarHide">Ocultar menú lateral</label>
                </div>
              </div>
            </div>

			<div class="row">
				<div class="col-md-6">
					<fieldset class="mb-3 border rounded p-3">
					  <legend class="float-none w-auto px-2">Permisos sobre monitores:</legend>
					  <div class="form-check form-check-inline">
						<input class="form-check-input" type="checkbox" name="DefaultRead" id="read" value="1" '.($filaUsuario['DefaultRead'] ? 'checked' : '').'>
						<label class="form-check-label" for="read">Lectura</label>
					  </div>
					  <div class="form-check form-check-inline">
						<input class="form-check-input" type="checkbox" name="DefaultEdit" id="edit" value="1" '.($filaUsuario['DefaultEdit'] ? 'checked' : '').'>
						<label class="form-check-label" for="edit">Edición</label>
					  </div>
					  <div class="form-check form-check-inline">
						<input class="form-check-input" type="checkbox" name="DefaultAudit" id="audit" value="1" '.($filaUsuario['DefaultAudit'] ? 'checked' : '').'>
						<label class="form-check-label" for="audit">Auditoría</label>
					  </div>
					</fieldset>
				</div>

				<div class="col-md-6">
					<fieldset class="mb-3 border rounded p-3">
					  <legend class="float-none w-auto px-2">Permisos administrativos:</legend>
					  <div class="form-check form-check-inline">
						<input class="form-check-input" type="checkbox" id="permAdminUserS" name="permAdminUserS" value="1"
						  '.($filaUsuario['DefaultAdminUserS'] ? 'checked' : '').'>
						<label class="form-check-label" for="permAdminUserS">Gestión de usuarios</label>
					  </div>
					  <div class="form-check form-check-inline">
						<input class="form-check-input" type="checkbox" id="permAdminSettings" name="permAdminSettings" value="1"
						  '.($filaUsuario['defaultAdminSettings'] ? 'checked' : '').'>
						<label class="form-check-label" for="permAdminSettings">Administrador de Configuración</label>
					  </div>
					</fieldset>
				</div>
			</div>

<hr class="mt-4 mb-3">
';
if ($filaUsuario['ID'] === 0){
	$contenido .= '<h5 class="mb-3">🔐 Cambiar contraseña del usuario</h5>';
}else{
	$contenido .= '<h5 class="mb-3">🔐 Contraseña del usuario</h5>';
}

$contenido .='
<div class="row">
  <div class="col-md-6 mb-3">
    <label for="nuevaPassword" class="form-label">Nueva contraseña</label>
    <input type="password" class="form-control" id="nuevaPassword" name="nuevaPassword" autocomplete="new-password">
  </div>

  <div class="col-md-6 mb-3">
    <label for="repetirPassword" class="form-label">Repetir contraseña</label>
    <input type="password" class="form-control" id="repetirPassword" name="repetirPassword" autocomplete="new-password">
  </div>
</div>




            <div class="d-grid gap-2 d-md-flex justify-content-md-end">
              <button type="submit" class="btn btn-primary">Guardar cambios</button>
              <a href="?pagina=MenuUsuarios" class="btn btn-secondary">Cancelar</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</div>
';







$templateContent -> setContenido($contenido);

?>
