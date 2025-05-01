<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Eliminar Usuario.");

// Seguridad Basica:
$intIdUsuario = 0;
if (isset($_GET['ID'])){
	$intIdUsuario = (int) $_GET['ID'];
}
if ( $intIdUsuario === 0 ){
	header("Location: ?pagina=MenuUsuarios"); // De aqui puede sufrir otra redireccion, si no tiene permisos...
    exit;
}
if (!$usuario->puedeEditarUsuario($intIdUsuario)) {
	header("Location: ?pagina=MenuUsuarios"); // De aqui puede sufrir otra redireccion, si no tiene permisos...
	exit;
}

// Funcion para sanear strings que pueden ser null:
function safeHtml($input) {
	return htmlspecialchars((string)$input, ENT_QUOTES, 'UTF-8');
}


// Obtenemos los datos del usuario:
$filaUsuario = usuarioS::getInfoUsuario($intIdUsuario);
$usuario -> debugLog($filaUsuario, 'Info de usuario: ');

// Aqui vendria el tratamiento del POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	// Verificamos ID, mediante POST
	if (!$usuario->puedeEditarUsuario( (int)$_POST['ID_usuario'] )) {
		header("Location: ?pagina=MenuUsuarios");
		exit;
	}	
	// Cargamos info de usuario desde el POST, para ver si existe:
	$filaUsuario = usuarioS::getInfoUsuario( (int)$_POST['ID_usuario'] );
	if (isset($filaUsuario['ID'])){
		if ($usuario -> getIdUsuario() === (int)$_POST['ID_usuario']){
			// El usuario no se puede AutoInmolar
			header("Location: ?pagina=MenuUsuarios");
			exit;
		}
		
		usuarioS::eliminarUsuario( (int)$_POST['ID_usuario'] );
		header("Location: ?pagina=MenuUsuarios");
		exit;
	}
	
}



// Aqui vendria el tratamiento del GET.

$templateContent->setTitulo("Eliminar usuario: ". safeHtml( $filaUsuario['Usuario'])); // Ahora ya , con el usuario cargado...

$contenido ='
        <div class="container mt-4">
            <div class="card">
                <div class="card-header bg-danger text-white text-center">
                    <h4>¿Seguro que deseas eliminar el usuario: ' . safeHtml( $filaUsuario['Usuario'] ) . '?</h4>
                </div>
                <div class="card-body text-center">
                    <p>Estás a punto de eliminar el usuario: <strong>'. safeHtml( $filaUsuario['Nombre'].' '.$filaUsuario['Apellidos'] ) .'</strong></p>
                    <p>Esta acción no se puede deshacer.</p>

                    <form method="POST" action="?pagina=EliminarUsuario&ID='. intval($filaUsuario['ID']) .'">
						<input type="hidden" name="csrf_token" value="' . $virsoft->getTokenCSRG() . '">
						<input type="hidden" name="ID_usuario" value="' . intval($filaUsuario['ID']) . '">
                        <button type="submit" name="confirmar" class="btn btn-danger">✅ Sí, eliminar</button>
                        <a href="./?pagina=MenuUsuarios" class="btn btn-secondary">❌ Cancelar</a>
                        <!--<button class="btn btn-secondary" onclick="window.history.back();">❌ Cancelar</button>-->
                    </form>
                </div>
            </div>
        </div>
';


$templateContent->setContenido($contenido);
?>
