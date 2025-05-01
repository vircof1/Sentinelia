<?php
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

// Titulo inicial de la página + Proteccion CSRG
$templateContent->iniciarPagina("Editar Perfil de Usuario");



$fechaNac = $usuario->getFechaNacimiento();
$dataFecha = '';

if ($fechaNac instanceof DateTime) {
    $dataFecha = $fechaNac->format('Y-m-d');
}


$errores = procesarPost();
$textoErrores = '';
if(!empty($errores)){
	$templateContent -> addToast('Los datos no se guardaron','warning');
	$textoErrores = '		
		<div class="alert alert-danger" role="alert">
		  <ul class="mb-0">';
	foreach ($errores as $errorLi){
		$textoErrores .= '
			<li>'. htmlspecialchars($errorLi) .'</li>';
	}
	$textoErrores .='
		  </ul>
		</div>
	';
}


// Devolvemos al usuario lo que pintó
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$nonmbreFormulario = $_POST['nombre'];
	$apellidosFormulario = $_POST['apellidos'];
	$emailFormulario = $_POST['email'];
	$telefonoFormulario = $_POST['telefono'];
	$fechaNacimientoFormulario = $_POST['fecha_nacimiento'];
}else{
	$nonmbreFormulario = $usuario->getNombre();
	$apellidosFormulario = $usuario->getApellidos();
	$emailFormulario = $usuario->getEmail();
	$telefonoFormulario = $usuario->getTelefono();
	$fechaNacimientoFormulario = $dataFecha;
}


$templateContent -> addJsFooter('
<script>
document.querySelector(\'form\').addEventListener(\'submit\', function(e) {
    setTimeout(() => {
        document.querySelector(\'button[type="submit"]\').scrollIntoView({behavior: \'smooth\'});
    }, 100);
});
</script>
');

$contenido = '<div class="row justify-content-center">
<div class="card col-md-8">
  <div class="card-header">
    <h5>Editar Perfil de Usuario:</h5>
  </div>
  <div class="card-body">
  
	'.$textoErrores.'
    <form method="POST" action="">
      <input type="hidden" id="csrf_token" name="csrf_token" value="'.$virsoft->getTokenCSRG().'">
      
      <div class="mb-3">
        <label for="nombre" class="form-label">Nombre:</label>
        <input type="text" class="form-control" id="nombre" name="nombre" value="'.htmlspecialchars($nonmbreFormulario).'" required>
      </div>
      
      <div class="mb-3">
        <label for="apellidos" class="form-label">Apellidos:</label>
        <input type="text" class="form-control" id="apellidos" name="apellidos" value="'.htmlspecialchars($apellidosFormulario).'">
      </div>
      
      <div class="mb-3">
        <label for="email" class="form-label">Email:</label>
        <input type="email" class="form-control" id="email" name="email" value="'.htmlspecialchars($emailFormulario).'" required>
      </div>
      
      <div class="mb-3">
        <label for="telefono" class="form-label">Teléfono:</label>
        <input type="tel" class="form-control" id="telefono" name="telefono" value="'.htmlspecialchars($telefonoFormulario).'">
      </div>
      
      
		<div class="mb-3">
		  <label for="fecha_nacimiento" class="form-label">Fecha de Nacimiento:</label>
		  <input type="date" class="form-control" id="fecha_nacimiento" name="fecha_nacimiento" value="'.htmlspecialchars($fechaNacimientoFormulario).'">
		</div>
      

		<!--

      <div class="mb-3">
        <label for="direccion" class="form-label">Dirección:</label>
        <input type="text" class="form-control" id="direccion" name="direccion" value="Calle Falsa 123, Ciudad, País">
      </div>

      <div class="mb-3">
        <label for="biografia" class="form-label">Biografía:</label>
        <textarea class="form-control" id="biografia" name="biografia" rows="3">Breve descripción sobre el usuario.</textarea>
      </div>
		
		-->
      <div class="mb-3 text-center submit" id="submit">
        <button type="submit" class="btn btn-success">
			✅ Guardar Cambios
		</button>
      </div>

    </form>

  </div>
</div>
</div>';


function procesarPost(): array {
	global $usuario;
	global $templateContent;
    $errores = [];

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {

        // Validar el nombre
        if (empty(trim($_POST['nombre'] ?? ''))) {
            $errores[] = 'El nombre no puede estar vacío.';
        }

        // Validar los apellidos (opcional, si quieres obligarlo)
        if (empty(trim($_POST['apellidos'] ?? ''))) {
            $errores[] = 'Los apellidos no pueden estar vacíos.';
        }

        // Validar email
        if (empty(trim($_POST['email'] ?? ''))) {
            $errores[] = 'El email no puede estar vacío.';
        } elseif (!filter_var($_POST['email'], FILTER_VALIDATE_EMAIL)) {
            $errores[] = 'El formato del email no es válido.';
        }

        // Validar teléfono (opcional)
        if (!empty($_POST['telefono'])) {
            $telefono = preg_replace('/\s+/', '', $_POST['telefono']);
            if (!preg_match('/^\+?[0-9\-]{7,20}$/', $telefono)) {
                $errores[] = 'El teléfono debe contener solo números, espacios o guiones.';
            }
        }

        // Validar fecha de nacimiento (opcional)
        if (!empty($_POST['fecha_nacimiento'])) {
            $fecha = DateTime::createFromFormat('Y-m-d', $_POST['fecha_nacimiento']);
            if (!$fecha || $fecha->format('Y-m-d') !== $_POST['fecha_nacimiento']) {
                $errores[] = 'La fecha de nacimiento no es válida.';
            }
        }
        
		if (count($errores) === 0) {
			$usuario->setNonmbre(trim($_POST['nombre'] ?? ''));
			$usuario->setApellidos(trim($_POST['apellidos'] ?? ''));
			$usuario->setEmail(trim($_POST['email'] ?? ''));

			$telefono = trim($_POST['telefono'] ?? '');
			if ($telefono === '') {
				$usuario->setTelefono(null);
			} else {
				$usuario->setTelefono($telefono);
			}

			$fechaNacimientoRaw = trim($_POST['fecha_nacimiento'] ?? '');

			if (is_string($fechaNacimientoRaw) && $fechaNacimientoRaw !== '') {
				$fecha = DateTime::createFromFormat('Y-m-d', $fechaNacimientoRaw);
				if ($fecha && $fecha->format('Y-m-d') === $fechaNacimientoRaw) {
					$estadoCambioFecha = $usuario->setFechaNacimiento($fechaNacimientoRaw); // le paso el STRING válido
				} else {
					$estadoCambioFecha = $usuario->setFechaNacimiento(null); // si no es válido, limpio
				}
			} else {
				$estadoCambioFecha = $usuario->setFechaNacimiento(null); // si está vacío o mal
			}
			
			if ( !$estadoCambioFecha['estado'] ){
				$errores []= $estadoCambioFecha['motivo'] ;
				return $errores;
			}
			
			// una vez actualizado todo: redirigimos con un toast:
			$templateContent -> setToastForNextPage('Datos de usuario actualizados'); // Default es info...
			header("Location: ./?pagina=perfilUsuario", true, 302);
			exit;
		}
    }



    return $errores;
}






$templateContent->setContenido($contenido);
?>
