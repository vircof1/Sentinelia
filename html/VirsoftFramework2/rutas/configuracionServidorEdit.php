<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Editar Configuracion Servidor");

$usuario -> debugLog($configuracionWeb , 'Configuracion Web:');

if ( !$usuario->getDefaultAdminSettings() ){
	header('Location: ./');
	exit;
}
$contenidoFormulario ='';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Aquí va el procesamiento del formulario POST
}

if (isset( $_GET['configuracion'] )){

	switch ($_GET['configuracion']) {
    case 'IdentificaciónInstancia':
        $contenidoFormulario = formularioIdentificacion();
        break;

    case 'NotificacionesURLTikets':
        $contenidoFormulario = formularioNotificacionesURLTikets();
        break;

    case 'UbicaciónFisica':
        $contenidoFormulario = formularioUbicacionFisica();
        break;

    case 'PolíticaContrasenas':
        $contenidoFormulario = formularioContrasenas();
        break;
        
    case 'PolíticaPoW':
        $contenidoFormulario = formularioPoW();
        break;

    case 'ServidoresReverseProxy':
        // 
        break;

    default:
        // 
        	header('Location: ./');
			exit;
        break;
	}
	
	
}

// --- Formulario de identificacion ---

function formularioIdentificacion(): string {
	global $virsoft;
	global $configuracionWeb;
	
	// Cargamos posibles errores del POST
	$mensajesError = postFormularioIdentificacion();
	
	// Seteamos valores por defecto
	$nombreServidor = $configuracionWeb->getInfoNombreServidor();
	$nombreEmpresa = $configuracionWeb->getInfoNombreEmpresa();
	
	// Si a llegado POST, no borramos los valores escritos por el usuario.
	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'IdentificaciónInstancia') {
		$nombreServidor = trim($_POST['nombre_servidor'] ?? '');
		$nombreEmpresa  = trim($_POST['nombre_empresa'] ?? '');
	}
	
	
	ob_start();
	?>

	<form method="POST" action="">
		<input type="hidden" name="csrf_token" value="<?= $virsoft -> getTokenCSRG() ?>">
		<input type="hidden" name="configuracion" value="IdentificaciónInstancia">
		
		<div class="card">
			<div class="card-header">
				<h5>🦋 Identificación de la Instancia</h5>
			</div>
			<div class="card-body">
				<!-- Posibles mensages de error -->				
				<?php if (!empty($mensajesError) && is_array($mensajesError)) : ?>
					<div class="alert alert-danger" role="alert">
						<ul class="mb-0">
							<?php foreach ($mensajesError as $error) : ?>
								<li><?= htmlspecialchars($error) ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>
				
				<div class="mb-3">
					<label for="nombre_servidor" class="form-label">Nombre del Servidor</label>
					<input type="text" class="form-control" id="nombre_servidor" name="nombre_servidor" 
						value="<?= htmlspecialchars($nombreServidor) ?>">
				</div>
				<div class="mb-3">
					<label for="nombre_empresa" class="form-label">Nombre de la Empresa</label>
					<input type="text" class="form-control" id="nombre_empresa" name="nombre_empresa" 
						value="<?= htmlspecialchars($nombreEmpresa) ?>">
				</div>
			</div>
			<div class="card-footer text-end">
				<button type="submit" class="btn btn-primary">Guardar cambios</button>
			</div>
		</div>
	</form>
	
	<div class="alert alert-secondary small mb-3" role="alert"> ⚠️ <strong>Nota:</strong> Los valores de esta sección se utilizan <strong>por ahora</strong> únicamente al emitir <strong>tíkets de soporte</strong>. No afectan al funcionamiento general del sistema. </div>

	<?php
	return ob_get_clean();
}

function postFormularioIdentificacion(): array {
	global $configuracionWeb;
	global $templateContent;

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'IdentificaciónInstancia') {
		$errores = [];

		$nombreServidor = trim($_POST['nombre_servidor'] ?? '');
		$nombreEmpresa  = trim($_POST['nombre_empresa'] ?? '');

		if ($nombreServidor === '') {
			$errores[] = 'El nombre del servidor no puede estar vacío.';
		}

		if ($nombreEmpresa === '') {
			$errores[] = 'El nombre de la empresa no puede estar vacío.';
		}

		if (!empty($errores)) {
			return $errores;
		}

		// Guardamos valores
		$r1 = $configuracionWeb->setInfoNombreServidor($nombreServidor);
		if (!$r1['estado']) {
			return ['Error al guardar nombre del servidor: ' . $r1['motivo']];
		}

		$r2 = $configuracionWeb->setInfoNombreEmpresa($nombreEmpresa);
		if (!$r2['estado']) {
			return ['Error al guardar nombre de la empresa: ' . $r2['motivo']];
		}

		// Si todo va bien: redirigimos con un mensagico:
		$templateContent->setToastForNextPage('Cambios guardados.', 'success', '¡Éxito!');
		header('Location: ?pagina=configuracionServidor');
		exit;
	}

	return [];
}


// --- Formulario de Gestion de tikets ----------

function formularioNotificacionesURLTikets(): string {
	global $virsoft;
	global $configuracionWeb;

	$mensajesError = postFormularioNotificacionesURLTikets();

	$url = $configuracionWeb->getUrlNotificacionTiket();
	$metodo = $configuracionWeb->getMetodoEnvioTiket();

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'NotificacionesURLTikets') {
		$url = trim($_POST['url'] ?? '');
		$metodo = strtoupper(trim($_POST['metodo'] ?? ''));
	}

	ob_start();
	?>

	<form method="POST" action="">
		<input type="hidden" name="csrf_token" value="<?= $virsoft->getTokenCSRG() ?>">
		<input type="hidden" name="configuracion" value="NotificacionesURLTikets">

		<div class="card">
			<div class="card-header">
				<h5>📩 Notificaciones, URL Tikets</h5>
			</div>
			<div class="card-body">
				<?php if (!empty($mensajesError) && is_array($mensajesError)) : ?>
					<div class="alert alert-danger" role="alert">
						<ul class="mb-0">
							<?php foreach ($mensajesError as $error) : ?>
								<li><?= htmlspecialchars($error) ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>

				<div class="mb-3">
					<label for="url" class="form-label">URL de notificación de tikets</label>
					<input type="text" class="form-control" id="url" name="url"
						value="<?= htmlspecialchars($url) ?>">
				</div>

				<div class="mb-3">
					<label for="metodo" class="form-label">Método de envío</label>
					<select class="form-select" id="metodo" name="metodo">
						<option value="POST" <?= $metodo === 'POST' ? 'selected' : '' ?>>POST</option>
						<option value="GET" <?= $metodo === 'GET' ? 'selected' : '' ?>>GET</option>
					</select>
				</div>
			</div>
			<div class="card-footer text-end">
				<button type="submit" class="btn btn-primary">Guardar cambios</button>
			</div>
		</div>
	</form>
	
	
	<div class="alert alert-info mt-4" role="alert">
		<h5 class="mb-2">📤 Envío de tikets a servidor externo</h5>
		<p>Cuando se genera un tiket, Sentinelia enviará una notificación a la URL configurada utilizando el método especificado (<strong>GET</strong> o <strong>POST</strong>).</p>
		<ul class="mb-2">
			<li><strong>Método POST:</strong> Se realiza un envío automático a la URL, con un <code>application/json</code> que incluye:</li>
			<ul>
				<li>Información de la tarea (nombre, estado, descripción...)</li>
				<li>Identificación del usuario que lo solicita</li>
				<li>Datos de la instancia actual de Sentinelia</li>
				<li>Histórico de eventos de la última semana (campo <code>lastWeekLog</code>)</li>
			</ul>
			<li><strong>Método GET:</strong> Redirige al navegador a la URL configurada. Esta opción se usa para integración simple con portales de soporte sin API.</li>
		</ul>
		<p>Ejemplo simplificado del <code>POST</code> enviado:</p>
		<pre class="small bg-light p-2 border rounded">
	{
	  "Sentinelia": {
		"tipo": "TiketSupport",
		"version": "1.0"
	  },
	  "id_tarea": 45,
	  "nombre_tarea": "...",
	  "estado": "fallo",
	  "descripcion": "...",
	  "usuario": {
		"nombre": "Héctor",
		"email": "...",
		"telefono": "..."
	  },
	  "InfoSentinelia": {
		"NombreServidor": "...",
		"NombreEmpresa": "...",
		"Pais": "...",
		"Poblacion": "..."
	  },
	  "lastWeekLog": [ ... ]
	}
		</pre>
	</div>	
	
	
	
	
	
	

	<?php
	return ob_get_clean();
}

function postFormularioNotificacionesURLTikets(): array {
	global $configuracionWeb;
	global $templateContent;

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'NotificacionesURLTikets') {
		$errores = [];

		$url = trim($_POST['url'] ?? '');
		$metodo = strtoupper(trim($_POST['metodo'] ?? ''));

		if ($url === '') {
			$errores[] = 'La URL no puede estar vacía.';
		}
		if (!in_array($metodo, ['GET', 'POST'])) {
			$errores[] = 'El método de envío debe ser GET o POST.';
		}

		if (!empty($errores)) {
			return $errores;
		}

		$r1 = $configuracionWeb->setUrlNotificacionTiket($url);
		if (!$r1['estado']) {
			return ['Error al guardar la URL: ' . $r1['motivo']];
		}

		$r2 = $configuracionWeb->setMetodoEnvioTiket($metodo);
		if (!$r2['estado']) {
			return ['Error al guardar el método de envío: ' . $r2['motivo']];
		}

		$templateContent->setToastForNextPage('Cambios guardados.', 'success', '¡Éxito!');
		header('Location: ?pagina=configuracionServidor');
		exit;
	}

	return [];
}



///--- Formulario de ubicacion fisica: -----------------------------

function formularioUbicacionFisica(): string {
	global $virsoft;
	global $configuracionWeb;

	$mensajesError = postFormularioUbicacionFisica();

	$pais       = $configuracionWeb->getInfoPais();
	$poblacion  = $configuracionWeb->getInfoPoblacion();
	$dataCenter = $configuracionWeb->getInfoDataCenter();
	$rack       = $configuracionWeb->getInfoArmarioRack();

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'UbicaciónFisica') {
		$pais       = trim($_POST['pais'] ?? '');
		$poblacion  = trim($_POST['poblacion'] ?? '');
		$dataCenter = trim($_POST['data_center'] ?? '');
		$rack       = trim($_POST['rack'] ?? '');
	}

	ob_start();
	?>

	<form method="POST" action="">
		<input type="hidden" name="csrf_token" value="<?= $virsoft->getTokenCSRG() ?>">
		<input type="hidden" name="configuracion" value="UbicaciónFisica">

		<div class="card">
			<div class="card-header">
				<h5>📍 Ubicación Física</h5>
			</div>
			<div class="card-body">
				<?php if (!empty($mensajesError) && is_array($mensajesError)) : ?>
					<div class="alert alert-danger" role="alert">
						<ul class="mb-0">
							<?php foreach ($mensajesError as $error) : ?>
								<li><?= htmlspecialchars($error) ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>

				<div class="mb-3">
					<label for="pais" class="form-label">País</label>
					<input type="text" class="form-control" id="pais" name="pais" value="<?= htmlspecialchars($pais) ?>">
				</div>
				<div class="mb-3">
					<label for="poblacion" class="form-label">Población</label>
					<input type="text" class="form-control" id="poblacion" name="poblacion" value="<?= htmlspecialchars($poblacion) ?>">
				</div>
				<div class="mb-3">
					<label for="data_center" class="form-label">Data Center</label>
					<input type="text" class="form-control" id="data_center" name="data_center" value="<?= htmlspecialchars($dataCenter) ?>">
				</div>
				<div class="mb-3">
					<label for="rack" class="form-label">Armario / Rack</label>
					<input type="text" class="form-control" id="rack" name="rack" value="<?= htmlspecialchars($rack) ?>">
				</div>
			</div>
			<div class="card-footer text-end">
				<button type="submit" class="btn btn-primary">Guardar ubicación</button>
			</div>
		</div>
	</form>

	<div class="alert alert-secondary small mt-3 mb-0">
		📌 <strong>Nota:</strong> Esta información será incluida automáticamente en las notificaciones de tikets, para que el receptor conozca el emplazamiento físico del equipo.
	</div>

	<?php
	return ob_get_clean();
}

function postFormularioUbicacionFisica(): array {
	global $configuracionWeb;
	global $templateContent;

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'UbicaciónFisica') {
		$pais       = trim($_POST['pais'] ?? '');
		$poblacion  = trim($_POST['poblacion'] ?? '');
		$dataCenter = trim($_POST['data_center'] ?? '');
		$rack       = trim($_POST['rack'] ?? '');

		// No es obligatorio rellenar, así que validamos directamente
		$r1 = $configuracionWeb->setInfoPais($pais);
		if (!$r1['estado']) {
			return ['Error al guardar el país: ' . $r1['motivo']];
		}

		$r2 = $configuracionWeb->setInfoPoblacion($poblacion);
		if (!$r2['estado']) {
			return ['Error al guardar la población: ' . $r2['motivo']];
		}

		$r3 = $configuracionWeb->setInfoDataCenter($dataCenter);
		if (!$r3['estado']) {
			return ['Error al guardar el data center: ' . $r3['motivo']];
		}

		$r4 = $configuracionWeb->setInfoArmarioRack($rack);
		if (!$r4['estado']) {
			return ['Error al guardar el rack: ' . $r4['motivo']];
		}

		$templateContent->setToastForNextPage('Ubicación guardada correctamente.', 'success', '¡Listo!');
		header('Location: ?pagina=configuracionServidor');
		exit;
	}

	return [];
}

/// --- Formulario para lo de las contraseñas

function formularioContrasenas(): string {
	global $virsoft;
	global $configuracionWeb;

	$errores = postFormularioContrasenas();

	$longitud   = $configuracionWeb->getLongitudMinimaPassword();
	$complejidad = $configuracionWeb->getConplejidadContraseñas();
	$mayus      = $configuracionWeb->getRequerirMayusculas();
	$numeros    = $configuracionWeb->getRequerirNumeros();
	$simbolos   = $configuracionWeb->getRequerirSimbolos();

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'PolíticaContrasenas') {
		$longitud   = (int)($_POST['longitud_minima'] ?? $longitud);
		$complejidad = isset($_POST['complejidad']);
		$mayus      = isset($_POST['mayusculas']);
		$numeros    = isset($_POST['numeros']);
		$simbolos   = isset($_POST['simbolos']);
	}

	ob_start();
	?>

	<form method="POST" action="">
		<input type="hidden" name="csrf_token" value="<?= $virsoft->getTokenCSRG() ?>">
		<input type="hidden" name="configuracion" value="PolíticaContrasenas">

		<div class="card">
			<div class="card-header">
				<h5>🔐 Política de Contraseñas</h5>
			</div>
			<div class="card-body">

				<?php if (!empty($errores)) : ?>
					<div class="alert alert-danger">
						<ul class="mb-0">
							<?php foreach ($errores as $e): ?>
								<li><?= htmlspecialchars($e) ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>

				<div class="mb-3">
					<label for="longitud_minima" class="form-label">Longitud mínima</label>
					<input type="number" class="form-control" name="longitud_minima" id="longitud_minima" min="0" max="99" value="<?= htmlspecialchars($longitud) ?>">
				</div>

				<div class="form-check form-switch mb-2">
					<input class="form-check-input" type="checkbox" id="complejidad" name="complejidad" <?= $complejidad ? 'checked' : '' ?>>
					<label class="form-check-label" for="complejidad">Requiere habilitar estas politicas</label>
				</div>
				<div class="form-check form-switch mb-2">
					<input class="form-check-input" type="checkbox" id="mayusculas" name="mayusculas" <?= $mayus ? 'checked' : '' ?>>
					<label class="form-check-label" for="mayusculas">Requiere al menos una mayúscula</label>
				</div>
				<div class="form-check form-switch mb-2">
					<input class="form-check-input" type="checkbox" id="numeros" name="numeros" <?= $numeros ? 'checked' : '' ?>>
					<label class="form-check-label" for="numeros">Requiere al menos un número</label>
				</div>
				<div class="form-check form-switch mb-2">
					<input class="form-check-input" type="checkbox" id="simbolos" name="simbolos" <?= $simbolos ? 'checked' : '' ?>>
					<label class="form-check-label" for="simbolos">Requiere al menos un símbolo</label>
				</div>
			</div>
			<div class="card-footer text-end">
				<button type="submit" class="btn btn-primary">Guardar política</button>
			</div>
		</div>
	</form>

	<div class="alert alert-secondary small mt-3 mb-0">
		📌 <strong>Nota:</strong> Estas opciones afectan directamente a la validación de contraseñas de usuarios nuevos o modificados. Las caves antiguas, permanecerán igual, mientras no se cambien.
	</div>

	<?php
	return ob_get_clean();
}

function postFormularioContrasenas(): array {
	global $configuracionWeb;
	global $templateContent;

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'PolíticaContrasenas') {
		$errores = [];

		$longitud   = (int)($_POST['longitud_minima'] ?? 0);
		$complejidad = isset($_POST['complejidad']);
		$mayus      = isset($_POST['mayusculas']);
		$numeros    = isset($_POST['numeros']);
		$simbolos   = isset($_POST['simbolos']);

		// Validación y guardado
		$r1 = $configuracionWeb->setLongitudMinimaPassword($longitud);
		if (!$r1['estado']) $errores[] = $r1['motivo'];

		$r2 = $configuracionWeb->setConplejidadContraseñas($complejidad);
		if (!$r2['estado']) $errores[] = $r2['motivo'];

		$r3 = $configuracionWeb->setRequerirMayusculas($mayus);
		if (!$r3['estado']) $errores[] = $r3['motivo'];

		$r4 = $configuracionWeb->setRequerirNumeros($numeros);
		if (!$r4['estado']) $errores[] = $r4['motivo'];

		$r5 = $configuracionWeb->setRequerirSimbolos($simbolos);
		if (!$r5['estado']) $errores[] = $r5['motivo'];

		if (empty($errores)) {
			$templateContent->setToastForNextPage('Politica de contraseñas guardada correctamente.', 'success');
			header('Location: ?pagina=configuracionServidor');
			exit;
		}

		return $errores;
	}

	return [];
}

// --- Formulario para el PoW

function formularioPoW(): string {
	global $virsoft;
	global $configuracionWeb;

	$errores = postFormularioPoW();

	// Cargar valores actuales
	$dificultadMin = $configuracionWeb->getPoWDificultadMinima();
	$dificultadMinSospechoso = $configuracionWeb->getPoW_dificultadMinimaPenalizada();
	$dificultadMax = $configuracionWeb->getPoWDificultadMaxima();
	$tiempoMax     = $configuracionWeb->getPoWTiempoObjetivoMaximo();
	$reintentosMax = $configuracionWeb->getPoWReintentosMaximos();
	$sinEscalar    = $configuracionWeb->getPoWReintentosSinEscalar();
	$perdon        = $configuracionWeb->getPoW_tiempoPerdonIP();

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'PolíticaPoW') {
		$dificultadMin = (int)($_POST['PoW_dificultadMinima'] ?? $dificultadMin);
		$dificultadMinSospechoso = (int)($_POST['PoW_dificultadMinimaSospechoso'] ?? $dificultadMinSospechoso);
		$dificultadMax = (int)($_POST['PoW_dificultadMaxima'] ?? $dificultadMax);
		$tiempoMax     = (int)($_POST['PoW_tiempoObjetivoMaximo'] ?? $tiempoMax);
		$reintentosMax = (int)($_POST['PoW_reintentosMaximos'] ?? $reintentosMax);
		$sinEscalar    = (int)($_POST['PoW_reintentosSinEscalar'] ?? $sinEscalar);
		$perdon        = (int)($_POST['PoW_tiempoPerdonIP'] ?? $perdon);
	}

	ob_start(); ?>
	<form method="POST" action="">
		<input type="hidden" name="csrf_token" value="<?= $virsoft->getTokenCSRG() ?>">
		<input type="hidden" name="configuracion" value="PolíticaPoW">

		<div class="card">
			<div class="card-header">
				<h5>🧮 Política de Prueba de Trabajo (PoW)</h5>
			</div>
			<div class="card-body">
				<?php if (!empty($errores)) : ?>
					<div class="alert alert-danger">
						<ul class="mb-0">
							<?php foreach ($errores as $e): ?>
								<li><?= htmlspecialchars($e) ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>

				<div class="mb-3">
					<label class="form-label">Dificultad mínima</label>
					<input type="number" class="form-control" name="PoW_dificultadMinima" value="<?= $dificultadMin ?>" min="1" max="64">
				</div>
				<div class="mb-3">
					<label class="form-label">Dificultad mínima de usuario sospechoso</label>
					<input type="number" class="form-control" name="PoW_dificultadMinimaSospechoso" value="<?= $dificultadMinSospechoso ?>" min="1" max="64">
				</div>
				<div class="mb-3">
					<label class="form-label">Dificultad máxima</label>
					<input type="number" class="form-control" name="PoW_dificultadMaxima" value="<?= $dificultadMax ?>" min="1" max="64">
				</div>
				<div class="mb-3">
					<label class="form-label">Tiempo objetivo máximo (segundos)</label>
					<input type="number" class="form-control" name="PoW_tiempoObjetivoMaximo" value="<?= $tiempoMax ?>" min="20" max="60">
				</div>
				<div class="mb-3">
					<label class="form-label">Reintentos máximos</label>
					<input type="number" class="form-control" name="PoW_reintentosMaximos" value="<?= $reintentosMax ?>" min="1" max="100">
				</div>
				<div class="mb-3">
					<label class="form-label">Reintentos sin escalar dificultad</label>
					<input type="number" class="form-control" name="PoW_reintentosSinEscalar" value="<?= $sinEscalar ?>" min="0" max="100">
				</div>
				<div class="mb-3">
					<label class="form-label">Tiempo de perdón IP (min)</label>
					<input type="number" class="form-control" name="PoW_tiempoPerdonIP" value="<?= $perdon ?>" min="1" max="1440">
				</div>
			</div>
			<div class="card-footer text-end">
				<button type="submit" class="btn btn-primary">Guardar PoW</button>
			</div>
		</div>
	</form>

	<div class="alert alert-info small">
		<h6 class="mb-2">📐 ¿Qué es la Prueba de Trabajo (PoW) en Sentinelia?</h6>
		<p>
			El sistema PoW implementa un mecanismo de defensa frente a ataques automatizados de login, especialmente por fuerza bruta o enumeración de usuarios.
			Consiste en obligar al cliente (navegador) a resolver un pequeño reto criptográfico antes de enviar las credenciales. Cuanto más sospechoso el comportamiento, más difícil será el reto.
			Si conoces la clave, entrarás tras una prueba ridícula, apenas unos milisegundos. Si no la conoces, el sistema te desgastará sin piedad, incrementando la dificultad hasta convertir cada intento en un castigo computacional.
			Los captchas podrían servir... si no existieran OCR avanzados o inteligencias artificiales que los resuelven mejor que un humano cansado.
		</p>

		<hr class="my-2">

		<h6 class="mt-2 mb-2">🧩 Parámetros configurables:</h6>
		<ul class="mb-1">
			<li><strong>Dificultad mínima:</strong> Nivel inicial del reto PoW para cualquier IP nueva o usuario legítimo. Un valor bajo garantiza una experiencia fluida.</li>
			<li><strong>Dificultad máxima:</strong> Tope de dificultad que no se superará bajo ningún concepto. Protege ante escaladas abusivas. Se recomienda no superar 47 (límites razonables incluso para equipos ASIC).</li>
			<li><strong>Tiempo objetivo máximo (segundos):</strong> Tiempo deseado que debería costar resolver el reto más difícil. El sistema intentará alcanzar este tiempo excepto si ya se ha llegado a la dificultad máxima.</li>
			<li><strong>Reintentos máximos:</strong> Número de intentos fallidos permitidos antes de alcanzar la dificultad máxima. El sistema decide si escalar por número de intentos o por el tiempo acumulado.</li>
			<li><strong>Reintentos sin escalar dificultad:</strong> Intentos iniciales permitidos sin penalización. Evita castigar a usuarios humanos por un simple error de tipeo.</li>
			<li><strong>Tiempo de perdón IP (min):</strong> Periodo sin actividad sospechosa tras el cual una IP vuelve al estado inicial. Ayuda a “reiniciar” la dificultad asociada a esa IP.</li>
		</ul>

		<hr class="my-2">

		<p class="mb-0">
			⚙️ Estos ajustes permiten encontrar un equilibrio entre protección real y experiencia de usuario. Sentinelia ajustará la dificultad de forma progresiva para ralentizar bots sin molestar a humanos. 
		</p>
	</div>

	<?php
	return ob_get_clean();
}

function postFormularioPoW(): array {
	global $configuracionWeb;
	global $templateContent;

	if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['configuracion'] ?? '') === 'PolíticaPoW') {
		$errores = [];

		$r1 = $configuracionWeb->setPoWDificultadMinima((int)($_POST['PoW_dificultadMinima'] ?? 0));
		if (!$r1['estado']) $errores[] = $r1['motivo'];

		$r2 = $configuracionWeb->setPoWDificultadMaxima((int)($_POST['PoW_dificultadMaxima'] ?? 0));
		if (!$r2['estado']) $errores[] = $r2['motivo'];

		$r3 = $configuracionWeb->setPoWTiempoObjetivoMaximo((int)($_POST['PoW_tiempoObjetivoMaximo'] ?? 0));
		if (!$r3['estado']) $errores[] = $r3['motivo'];

		$r4 = $configuracionWeb->setPoWReintentosMaximos((int)($_POST['PoW_reintentosMaximos'] ?? 0));
		if (!$r4['estado']) $errores[] = $r4['motivo'];

		$r5 = $configuracionWeb->setPoWReintentosSinEscalar((int)($_POST['PoW_reintentosSinEscalar'] ?? 0));
		if (!$r5['estado']) $errores[] = $r5['motivo'];

		$r6 = $configuracionWeb->setPoWTiempoPerdonIP((int)($_POST['PoW_tiempoPerdonIP'] ?? 0));
		if (!$r6['estado']) $errores[] = $r6['motivo'];

		$r7 = $configuracionWeb->setPoW_dificultadMinimaPenalizada((int)($_POST['PoW_dificultadMinimaSospechoso'] ?? 0));
		if (!$r7['estado']) $errores[] = $r7['motivo'];

		if (empty($errores)) {
			$templateContent->setToastForNextPage('Parámetros PoW actualizados con éxito.', 'success');
			header('Location: ?pagina=configuracionServidor');
			exit;
		}

		return $errores;
	}

	return [];
}








$contenido ='
<div class="row justify-content-center">
  <div class="col-md-8 col-lg-6">
    '.$contenidoFormulario.'
  </div>
</div>
';

$templateContent -> setContenido($contenido);

?>
