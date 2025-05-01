<?php
// control de includes
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


if (session_status() === PHP_SESSION_NONE) {
    session_start(); // Inicia la sesión solo si no está ya iniciada
}
function virsoftSesionesUsuarios(){
	global $virsoft, $usuario, $configuracionVirsoft;
	//echo "estamos llamando a el archivo de sesiones.";
	if ( $virsoft->getRequiereSesion() ){
		
		$usuarioAutentificado = false;
		
		// Atendemos las peticiones de logoutque lleguen por GET
		if (isset($_GET["SesionLogout"])){
			session_unset();
			header("Location: " . $_SERVER['PHP_SELF']);
			die;
		}

		// Gestiones del token CSRF
		if (isset($_SESSION['csrf_token'])){
			$tokenCSRG = $_SESSION['csrf_token'];
			$virsoft -> setTokenCSRG($tokenCSRG);
		}else{
			$_SESSION['csrf_token'] = $virsoft -> generarSaltAleatorio();
			$tokenCSRG = $_SESSION['csrf_token'];
			$virsoft -> setTokenCSRG($tokenCSRG);
		}
		
		// Vemos si el usuario inicio sesion previamente. Si es asi, cargamos los datos.
		if (isset($_SESSION['idUsuario'])){
			$usuario->cargarUsuarioVerificado($_SESSION['idUsuario']);
			$usuarioAutentificado = true;
			$mostrarFormLogin = false;
		}
		
		global $configuracionWeb;
		
		
		// Nos llega una peticion de POST
		if (isset($_POST["virsoftFrameworkLoginUsuario"], $_POST["virsoftFrameworkLoginPassword"], $_POST["csrf_token"])) {

			if ($_POST["csrf_token"] === $_SESSION['csrf_token']) {

				$PruebaPoW = false;

				$resultadoPoW = json_decode($_POST['resultadoPoW'] ?? '', true);

				if (
					is_array($resultadoPoW) &&
					isset($resultadoPoW['nonce']) &&
					isset($resultadoPoW['hash'])
				) {
					$nonce = $resultadoPoW['nonce'];
					$hash  = $resultadoPoW['hash'];

					if (PoWProtector::verificarResultado($nonce, $hash)) {
						$PruebaPoW = true;
					} else {
						usleep($configuracionWeb->getUltimoDelayLogin() * 1000);
					}
				} else {
					usleep($configuracionWeb->getUltimoDelayLogin() * 1000);
				}

				$inicio = microtime(true);

				if ($PruebaPoW) {
					$usuario->iniciarSesion(
						$_POST["virsoftFrameworkLoginUsuario"],
						$_POST["virsoftFrameworkLoginPassword"]
					);
				}

				$fin = microtime(true);

				if ($usuario->getUsuarioVerificado()) {
					$tiempoMs = round(($fin - $inicio) * 1000);
					$configuracionWeb->setUltimoDelayLogin($tiempoMs);
					$mostrarFormLogin = false;
					$usuarioAutentificado = true;
					$_SESSION['idUsuario'] = $usuario->getIdUsuario();
				} else {
					usleep($configuracionWeb->getUltimoDelayLogin() * 1000);
					$mostrarFormLogin = true;
					$errorForm = "Credenciales no validas";
				}

			} else {
				$mostrarFormLogin = true;
				$errorForm = "Token no valido";
			}
		}
		
		if (!isset($_SESSION['idUsuario'])){
			$mostrarFormLogin=true;
		}
		
		
		if ($mostrarFormLogin){
			$action = htmlspecialchars($_SERVER['PHP_SELF'], ENT_QUOTES, 'UTF-8');
			include $configuracionVirsoft['framework_path'] . '../Template/login.php';
			die;
		}
		
		if ($usuarioAutentificado){
			return true;
		}
	}else{
		// Primero actualizamos los posibles datos de usuario en la sesion
		// Vemos si el usuario inicio sesion previamente. Si es asi, cargamos los datos.
		if (isset($_SESSION['idUsuario'])){
			$usuario->cargarUsuarioVerificado($_SESSION['idUsuario']);
			$usuarioAutentificado = true;
			$mostrarFormLogin = false;
		}
		// Tambien nos puede venir un POST:
		
		// Atendemos las peticiones de un posible POST:
		if ( isset( $_POST["virsoftFrameworkLoginUsuario"]) and isset( $_POST["virsoftFrameworkLoginPassword"]) and isset( $_POST["csrf_token"]) ){
			
			
			//echo "estamos haviendo login";
			if ($_POST["csrf_token"] === $_SESSION['csrf_token']){
				$usuario->iniciarSesion($_POST["virsoftFrameworkLoginUsuario"], $_POST["virsoftFrameworkLoginPassword"]);
				if (  $usuario -> getUsuarioVerificado() ){
					$mostrarFormLogin=false;
					$usuarioAutentificado = true;
					$_SESSION['idUsuario'] = $usuario -> getIdUsuario();
				}else{
					$mostrarFormLogin=true;
					$errorForm = "Credenciales no validas";
				}
			}else{
				$mostrarFormLogin=true;
				$errorForm = "Token no valido";
			}
		}
		
		// Atendemos las peticiones de logoutque lleguen por GET
		if (isset($_GET["SesionLogout"])){
			session_unset();
			header("Location: " . $_SERVER['PHP_SELF']);
			die;
		}
		
		
		
		//echo 'llamamos a sesiones.';
		
		return true;
	}

}
//virsoftSesionesUsuarios();

?>
