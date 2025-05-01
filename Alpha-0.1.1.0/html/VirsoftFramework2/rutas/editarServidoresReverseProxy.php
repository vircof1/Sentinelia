<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Permisos....
if ( !$usuario->getDefaultAdminSettings() ){
	header('Location: ./');
	exit;
}


// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Editar servidores ReverseProxy");


function formularioEditarServidoresReverseProxy(): string {
	global $virsoft;
	global $configuracionWeb;

	$mensajesError = postFormularioEditarServidoresReverseProxy();

    // Cargamos el array actual de IPs
    $listaIps = $configuracionWeb -> getReverseProxiesConocidos(); // Devuelve array de IPs
    $valorTextarea = implode("\n", $listaIps); // Cada IP en una línea
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['lista_ips'])) {
		$valorTextarea = $_POST['lista_ips'];
	}
    
    

    $html = '
<div class="card">
	<div class="card-header">
		<h5>🛡️ Servidores reverse proxy válidos</h5>
	</div>
	<div class="card-body">
    
		<form method="post" action="">
			<input type="hidden" name="csrf_token" value="'. $virsoft -> getTokenCSRG() .'">
			';
			if (!empty($mensajesError) && is_array($mensajesError)){
				$html .='
				<div class="alert alert-danger" role="alert">
						<ul class="mb-0">';
							
							foreach ($mensajesError as $error){
								$html .='<li>'. htmlspecialchars($error) .'</li>';
							}
				$html .='
						</ul>
					</div>
				';
				
			}
	$html .='
			<div class="mb-3">
				<label for="lista_ips" class="form-label fw-bold">Direcciones IP permitidas (una por línea):</label>
				<textarea class="form-control" name="lista_ips" id="lista_ips" rows="8" spellcheck="false" style="font-family: monospace;">' . htmlspecialchars($valorTextarea) . '</textarea>
				
			</div>

			<button type="submit" class="btn btn-primary">Guardar configuración</button>
		</form>
		
		<br>
		
		<div class="alert alert-info mt-4" role="alert">
			<h5 class="mb-2">📤 Informacion a introducir en este formulario:</h5>
			Introduce <strong>una IP por línea</strong>. Solo se permiten direcciones IP individuales válidas (ejemplo: <code>192.168.1.1</code>, <code>127.0.0.1</code>).<br>
			<span class="text-warning">❌ No se permiten rangos de red, notación CIDR ni comodines. Solo IPs explícitas.</span><br>
			Estas IPs se usarán para validar que las cabeceras <code>X-Forwarded-For</code> provienen de un servidor proxy confiable. Si no se configura esto adecuadamente y se utiliza un servidor proxy no confiable:
			
			<ul class="mb-2">
				<li><strong>Al hacer login</strong> desde un servidor no confiable:</li>
				<ul>
					<li>Se aplicará automáticamente el máximo castigo permitido según la configuración de PoW.</li>
					<li>Los usuarios experimentarán inicios de sesión lentos, generando insatisfacción.</li>
					<li>La dificultad de la prueba PoW dejará de ser progresiva si se rompe la confianza en la conexión.</li>
					
				</ul>
				<li>Esto se debe a que en un servidor proxy puede manipularse la IP del posible atacante.</li>
			</ul>
			 <p>Ejemplo simplificado de entrada válida en el formulario:</p>
			<pre class="small bg-light p-2 border rounded">
192.168.0.1
127.0.0.1
192.168.1.2
			</pre>
		</div>	
		
		
		
		
	</div> <!-- cierre del card body -->
</div> <!-- cierre del card -->
    ';

    return $html;
}

function postFormularioEditarServidoresReverseProxy(): array {
	if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['lista_ips'])) {
		global $templateContent;
		global $configuracionWeb;
		
		$errores = [];
		$ipsValidas = [];
		
		$lineas = explode("\n", $_POST['lista_ips']);
		
		foreach ($lineas as $numero => $linea) {
			$ip = trim($linea);
			if ($ip === '') {
				continue; // Línea vacía, la ignoramos
			}

			// Validar si es una IP válida
			if (!filter_var($ip, FILTER_VALIDATE_IP)) {
				$errores[] = "Línea " . ($numero + 1) . ": IP no válida → <code>$ip</code>";
				continue;
			}

			// Comprobación de duplicados (puedes quitar esto si no lo necesitas)
			if (in_array($ip, $ipsValidas)) {
				$errores[] = "Línea " . ($numero + 1) . ": IP duplicada → <code>$ip</code>";
				continue;
			}

			$ipsValidas[] = $ip;
		}
		
		// si hay errores, le damos salida:
		if ( count($errores) > 0 ){
			return $errores;
		}
		
		// Actualizamos los datos:
		//return $ipsValidas;
		
		$resultadoUpdate = $configuracionWeb -> setReverseProxiesConocidos($ipsValidas);
		
		
		if ($resultadoUpdate['estado']){
			$templateContent->setToastForNextPage('Servidores proxy guardados correctamente.', 'success');
			header('Location: ?pagina=configuracionServidor');
			exit;
		}else{
			$errores []= $resultadoUpdate['motivo'];
		}
		
		
		
		
		return $errores;
		
	}else{
		return [];
	}
}




$contenidoFormulario = formularioEditarServidoresReverseProxy();



$contenido ='
<div class="row justify-content-center">
  <div class="col-md-8 col-lg-6">
    '.$contenidoFormulario.'
  </div>
</div>
';

$templateContent -> setContenido($contenido);
?>
