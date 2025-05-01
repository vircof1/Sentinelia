<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


class Usuario {
	
	private $verificada;
    private $idUsuario;
    private $usuario;      
    private $superUsuario;
    private $email;
    private $nombre;
    private $apellidos;
    private $telefono;
    private $fechaNacimiento = null;
    private $UltimaFechaInicioSesion;
    private $ContadorInicioSesion;
    private $EstadoCuenta;
    
    private $defaultEdit = false;
	private $defaultRead = false;
	private $defaultAudit = false;
	private $defaultAdminUserS = false;
	private $defaultAdminSettings = false;
	
	private $sidebarHide = 1;
    private $debugMode = false;
	
	
    public function __construct() {
        // Inicializar las propiedades de la clase
        $this->verificada = false;
        $this->idUsuario = null;
        $this->usuario = null;      
        $this->superUsuario = false;
        $this->email = null;
        $this->nombre = null;
        $this->apellidos = null;
        $this->UltimaFechaInicioSesion = null;
        $this->ContadorInicioSesion = null;
        $this->EstadoCuenta = null;

    }
    
    public function crearUsuario($usuario, $pass, $email, $nombre, $apellidos){
		global $virsoft;
		$Salida = array(
			"estadoOperacion" => false,
			"motivo" => ""
		);
		
		// Verificamos primero el usuario. Ya se que en la base de datos es unique, pero tendremos que darle motivos al usuario.
		$query = "SELECT ID FROM Usuarios WHERE Usuario = ? ;";
		$params = [
			['type' => 's', 'value' => $usuario]
		];

		$resultado = $virsoft -> ejecutarConsultaPreparada($query, $params);
		if ( is_array($resultado ) ){
			$Salida['motivo'] = "El usuario ya existe.";
			return $Salida;
		}
		
		// verificamos tambien que el correo electronico no exista:
		$query = "SELECT ID FROM Usuarios WHERE Email = ? ;";
		$params = [
			['type' => 's', 'value' => $email]
		];

		$resultado2 = $virsoft -> ejecutarConsultaPreparada($query, $params);
		if ( is_array($resultado2) ){
			$Salida['motivo'] = "El email ya existe.";
			return $Salida;
		}
		
		if ($resultado AND $resultado2){
			$Salida['estadoOperacion'] = true;
			// y aqui insertamos un usuario nuevo....
			// Lo primero, generamos un Salt aleatorio para el usuario:
			$salt = $virsoft -> generarSaltAleatorio();
			$passSalt = $virsoft -> generarHashSalt($pass, $salt);
			$fechaActual = date('Y-m-d H:i:s');
			
			$query = "INSERT INTO `Usuarios` (`ID`, `Usuario`, `Email`, `Pass`, `SaltOfPass`, `Nombre`, `Apellidos`, `FechaRegistro`, `UltimaFechaInicioSesion`, `EstadoCuenta`) VALUES (NULL, 'test', 'test', 'test', 'test', 'test', 'test', '2023-07-11 03:07:33', '2023-07-11 03:07:33', 'Activa');";
			$query = "INSERT INTO `Usuarios` (`ID`, `Usuario`, `Email`, `Pass`, `SaltOfPass`, `Nombre`, `Apellidos`, `FechaRegistro`, `UltimaFechaInicioSesion`, `EstadoCuenta`) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
			$params = [
				['type' => 's', 'value' => $usuario],
				['type' => 's', 'value' => $email],
				['type' => 's', 'value' => $passSalt],
				['type' => 's', 'value' => $salt],
				['type' => 's', 'value' => $nombre],
				['type' => 's', 'value' => $apellidos],
				['type' => 's', 'value' => $fechaActual],
				['type' => 's', 'value' => $fechaActual],
				['type' => 's', 'value' => 'Pendiente Verificar Correo']
			];

			$resultado3 = $virsoft->ejecutarConsultaPreparadaSimple($query, $params);

		}
		return $Salida;
	}

	public function cargarUsuarioVerificado($id){
		
		global $configuracionVirsoft, $virsoft;	
		
		
		
		//echo "llegamos a la carga del usuario";
		
		// Buscamos info del usuario:
		$query = "SELECT * FROM Usuarios WHERE ID = ?";
		$params = [
			['type' => 'i', 'value' => $id]	
		];
		$usuarioArraySQL = $virsoft->ejecutarConsultaPreparadaSimple($query, $params);
		
		
		$this->verificada = true;
		$this->idUsuario = $usuarioArraySQL['ID'];
		$this->usuario = $usuarioArraySQL['Usuario'];
		$this->email = $usuarioArraySQL['Email'];
        $this->nombre = $usuarioArraySQL['Nombre'];		
        $this->apellidos = $usuarioArraySQL['Apellidos'];
        $this->telefono = $usuarioArraySQL['telefono'];
        
		if ($usuarioArraySQL['fechaNacimiento'] !== null) {
			$this->fechaNacimiento = DateTime::createFromFormat('Y-m-d', $usuarioArraySQL['fechaNacimiento']);
		}

 
        if ($usuarioArraySQL['SuperUsuario'] == '1'){ 
			$this->superUsuario = true; 
			$this->debugMode = isset($_SESSION['debug_mode']) ? $_SESSION['debug_mode'] : false;

		}

		
        $this->UltimaFechaInicioSesion = DateTime::createFromFormat('Y-m-d H:i:s', $usuarioArraySQL['UltimaFechaInicioSesion']);
        $this->ContadorInicioSesion = (int)$usuarioArraySQL['ContadorInicioSesion'];
        $this->EstadoCuenta = $usuarioArraySQL['EstadoCuenta'];

		$this->defaultEdit = (int)$usuarioArraySQL['DefaultEdit'] === 1;
		$this->defaultRead = (int)$usuarioArraySQL['DefaultRead'] === 1;
		$this->defaultAudit = (int)$usuarioArraySQL['DefaultAudit'] > 0;
		$this->defaultAdminUserS = (int)$usuarioArraySQL['DefaultAdminUserS'] === 1;
		$this->defaultAdminSettings = (int)$usuarioArraySQL['defaultAdminSettings'] === 1;
		
		$this->sidebarHide = (int)$usuarioArraySQL['sidebarHide'];
		
		/*
		if ( $this->superUsuario ){
			$this->defaultEdit = true;
			$this->defaultRead = true;
			$this->defaultAudit = true;
			$this->defaultAdminUserS = true;
			$this->defaultAdminSettings = true;
		}
        */
        // cualquier logica de variables a la hora de cargar un usuario se deberá realizar aqui.
        // El usuario se debe verificar previamente con otra funcion:
	}


	public function debugLog($data, $label = 'Debug') {
		global $templateTextoJsLog;

		if (!$this->debugMode) return;

		// Exportación recursiva robusta de estructuras anidadas
		$exportarRecursivo = function ($dato) use (&$exportarRecursivo) {
			if (is_array($dato)) {
				foreach ($dato as $k => $v) {
					$dato[$k] = $exportarRecursivo($v);
				}
				return $dato;
			} elseif (is_object($dato)) {
				// Si el objeto tiene toArray, usamos eso
				if (method_exists($dato, 'toArray')) {
					return $exportarRecursivo($dato->toArray());
				} else {
					// Convertimos a array sin perder propiedades protegidas
					return $exportarRecursivo((array) $dato);
				}
			} else {
				return $dato;
			}
		};

		$estructura = $exportarRecursivo($data);

		// Codificación final a JSON bonito
		$encodedData = json_encode($estructura, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

		if ($encodedData === false) {
			$error = json_last_error_msg();
			$logScript = "console.error('Error al codificar JSON: " . addslashes($error) . "');";
		} else {
			$logScript = "console.log(JSON.parse(" . json_encode($encodedData) . "));";
		}

		// Salida ordenada por consola
		$templateTextoJsLog .= "
			<script>
				console.groupCollapsed('%c$label', 'color: green; font-weight: bold;');
				$logScript
				console.groupEnd();
			</script>
		";
	}


	public function setDebugMode($estado = false) {
		if ($this->superUsuario) { // Solo superusuarios pueden cambiarlo
			$this->debugMode = (bool)$estado;
			$_SESSION['debug_mode'] = $this->debugMode;
		}
	}

	public function isDebugMode() {
		return $this->debugMode;
	}

    private function verificarCredenciales($usuario, $pass) {
		global $configuracionVirsoft, $virsoft;	;
		
		
        // Lógica de verificación de credenciales
        // Aquí puedes realizar la consulta a la base de datos
        // y verificar si las credenciales son correctas.
        
		$query = "SELECT * FROM Usuarios WHERE Usuario = ?";
		$params = [
			['type' => 's', 'value' => $usuario]	
		];
		$filaUsuario = $virsoft->ejecutarConsultaPreparadaSimple($query, $params);

		if (is_array($filaUsuario)) {

				$PassSaltForm = $virsoft->generarHashSalt($pass, $filaUsuario['SaltOfPass']);
				
				
				if ($PassSaltForm == $filaUsuario['Pass']) {
					return true;
			
				}
		}
        
        // Retorna true si las credenciales son válidas, de lo contrario retorna false
        return false; 
    }
    
      
    
	public function iniciarSesion($usuario, $pass) {
        // Realizar la lógica de inicio de sesión aquí
        // Por ejemplo, verificar las credenciales del usuario en la base de datos
        // y establecer la sesión si las credenciales son válidas

        if ($this->verificarCredenciales($usuario, $pass)) {
			//echo "ha pasado las credenciales";
			
			global $configuracionVirsoft, $virsoft;	;
			
			$query = "SELECT * FROM Usuarios WHERE Usuario = ? ";
			$params = [
				['type' => 's', 'value' => $usuario]	
			];

			$filaUsuario = $virsoft->ejecutarConsultaPreparadaSimple($query, $params);
			
			
			$fechaActual = date('Y-m-d H:i:s');
			$contadorIniciosSesion = ((int)$filaUsuario['ContadorInicioSesion']) + 1 ;
			$query = "UPDATE Usuarios SET UltimaFechaInicioSesion = ?, ContadorInicioSesion = ? WHERE ID = ?";
			$params = [
				['type' => 's', 'value' => $fechaActual],
				['type' => 'i', 'value' => $contadorIniciosSesion],
				['type' => 'i', 'value' => (int)$filaUsuario['ID']]
			];
			$virsoft->ejecutarConsultaPreparadaSimple($query, $params);

			if (is_array($filaUsuario)) {
					
				$idUsuario = $filaUsuario['ID'];
				$this->cargarUsuarioVerificado($filaUsuario['ID']);

			}

		// y aqui supongo que empezaria a meter variables a diestro y siniestro
        }
    }

    public function cerrarSesion() {
        // Realizar la lógica de cierre de sesión aquí
        // Por ejemplo, destruir la sesión o reiniciar las propiedades de la clase

        // Restablecer las propiedades de la clase
		$this->__construct();
    }

	// Geters
	
	
	public function getFechaNacimiento(){
		return $this-> fechaNacimiento;
	}
	
	public function getTelefono(){
		return $this-> telefono;
	}
	
	public function getSidebarHide(){
		return $this -> sidebarHide;
	}
	
	public function getNombreCompleto() {
		return $this->nombre . " " . $this->apellidos;
	}	

	public function getApellidos() {
		return $this->apellidos;
	}	
	
	public function getNombre() {
		return $this->nombre;
	}	
	
	public function getEmail() {
		return $this->email;
	}
	
	public function getSuperUsuario() {
		return $this->superUsuario;
	}
	
	public function getUsuario() {
		return $this->usuario;
	}
	
	public function getIdUsuario() {
		return $this->idUsuario;
	}

	public function getUsuarioVerificado(){
		return $this->verificada;
	}
	
	public function puedeEditarTareas() {
		return $this->defaultEdit;
	}
	
	public function puedeEditarTarea($intIdTarea){
		return $this->defaultEdit;
	}

	public function puedeLeerTareas() {
		return $this->defaultRead;
	}




	
	public function getDefaultEdit() { return $this->defaultEdit; }
	public function getDefaultRead() { return $this->defaultRead; }
	

	

	// mas adelante aplicamos aqui ACL
	public function puedeVerConfiguracion() {
		return $this->getDefaultAdminSettings();
	}
	
	//
	// Metodos vinculados con permisos: (Prevision de ACL's en un futuro.)
	//
	
	// configuracion WEB del sitio:
	
	public function getDefaultAdminSettings() {
		return $this->defaultAdminSettings;
	}
	
	public function puedeConfigurarWeb() {
		return $this->defaultAdminSettings;
	}
	
	
	// Auditoria:
	
	public function getDefaultAudit() { return $this->defaultAudit; }

	public function puedeAuditarCualquierCosa() {
		return $this->defaultAudit;
	}

	public function puedeAuditar($tareaID_INT) {
		if ( !is_int($tareaID_INT) ){
			throw new Exception('Parametro no valido en usuario::puedeAuditar(tareaID:INT)');
		}
		
		if ($this->defaultAudit) {
			return true;
		}
		return false;
	}

	public function queTareasPuedeAuditar($tareas = null) {
		$salida = [];

		if ($this->getDefaultAudit()) {
			$tareas = new TareaS();
			return $tareas->getTareas();
		}

		return $salida;
	}

	public function queEventosPuedeAuditar($eventos = null) {
		if (!$this->defaultAudit) {
			return [];
		}
		return $eventos !== null ? $eventos : []; // cuando haya eventos reales cargados
	}
	
	// Edicion de usuarios
	
	public function getDefaultAdminUserS() { return $this->defaultAdminUserS; }


	public function puedeVerCualquierUsuario() {
		return $this->defaultAdminUserS;
	}
	
	public function puedeEditarUsuario( $usuario_ID_INT ){
		if ( !is_int($usuario_ID_INT) ){
			throw new Exception('Tipo de parametro invalido en usuario::puedeEditarUsuario(INT_VALUE)');
		}
		if ($this->defaultAdminUserS !== true) {
			return false;
		}
			// --- Logica ACL ---
		
		
		return true;
	}
	
	

	public function queUsuariosPuedeEditar() {
		if (!$this->getDefaultAdminUserS()) {
			return [];
		}

		// Cargar todos los usuarios desde usuarioS
		$usuarios = usuarioS::listarUsuarios(); // devuelve array plano, no de objetos

		$salida = [];

		foreach ($usuarios as $fila) {
			// No puede editarse a sí mismo
			//if ($fila['ID'] == $this->getIdUsuario()) {
			//	continue;
			//}

			// No puede editar superusuarios si no lo es
			//if ($fila['SuperUsuario'] == 1 && !$this->getSuperUsuario()) {
			//	continue;
			//}

			$salida[] = $fila;
		}

		return $salida;
	}
	

	

	
	

	// Seteres
	
	// El usuario solo podra setearse sus permisos si es superusuario.
	// Como norma general, se debe hacer desde la clase usuarioS, cuando ese usuario tenga permisos de editar usuarios.
	public function setDefaultEdit($valor) {
		$salida = array(
			"estado" => false,
			"motivo" => ""
		);
		
		if ( $this->getSuperUsuario() ){
			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `DefaultEdit` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 'i', 'value' => (int)$valor],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if( $virsoft->ejecutarConsultaPreparadaSimple($sql, $params)){
				$salida['estado'] = true;
				$this->defaultEdit = (bool)$valor;
			}else{
				$salida['motivo'] = 'Fallo la consulta SQL.';
			}
		}else{
			$salida['motivo'] = 'Sin permisos, superusuario.';
		}
		return $salida;
		
	}
	
	




	// El usuario solo podra setearse sus permisos si es superusuario.
	// Como norma general, se debe hacer desde la clase usuarioS, cuando ese usuario tenga permisos de editar usuarios.

	public function setDefaultRead($valor) {
		$salida = array("estado" => false, "motivo" => "");

		if ( $this->getSuperUsuario() ){
			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `DefaultRead` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 'i', 'value' => (int)$valor],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if( $virsoft->ejecutarConsultaPreparadaSimple($sql, $params)){
				$salida['estado'] = true;
				$this->defaultRead = (bool)$valor;
			}else{
				$salida['motivo'] = 'Fallo la consulta SQL.';
			}
		}else{
			$salida['motivo'] = 'Sin permisos, superusuario.';
		}
		return $salida;
	}
	
	
	// El usuario solo podra setearse sus permisos si es superusuario.
	// Como norma general, se debe hacer desde la clase usuarioS, cuando ese usuario tenga permisos de editar usuarios.
	public function setDefaultAudit($valor) {
		$salida = array("estado" => false, "motivo" => "");

		if ( $this->getSuperUsuario() ){
			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `DefaultAudit` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 'i', 'value' => (int)$valor],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if( $virsoft->ejecutarConsultaPreparadaSimple($sql, $params)){
				$salida['estado'] = true;
				$this->defaultAudit = (bool)$valor;
			}else{
				$salida['motivo'] = 'Fallo la consulta SQL.';
			}
		}else{
			$salida['motivo'] = 'Sin permisos, superusuario.';
		}
		return $salida;
	}


	// El usuario solo podra setearse sus permisos si es superusuario.
	// Como norma general, se debe hacer desde la clase usuarioS, cuando ese usuario tenga permisos de editar usuarios.
	public function setDefaultAdminUserS($valor) {
		$salida = array("estado" => false, "motivo" => "");

		if ( $this->getSuperUsuario() ){
			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `DefaultAdminUserS` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 'i', 'value' => (int)$valor],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if( $virsoft->ejecutarConsultaPreparadaSimple($sql, $params)){
				$salida['estado'] = true;
				$this->defaultAdminUserS = (bool)$valor;
			}else{
				$salida['motivo'] = 'Fallo la consulta SQL.';
			}
		}else{
			$salida['motivo'] = 'Sin permisos, superusuario.';
		}
		return $salida;
	}


	// El usuario solo podra setearse sus permisos si es superusuario.
	// Como norma general, se debe hacer desde la clase usuarioS, cuando ese usuario tenga permisos de editar usuarios.
	public function setDefaultAdminSettings($valor) {
		$salida = array("estado" => false, "motivo" => "");

		if ( $this->getSuperUsuario() ){
			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `DefaultAdminSettings` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 'i', 'value' => (int)$valor],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if( $virsoft->ejecutarConsultaPreparadaSimple($sql, $params)){
				$salida['estado'] = true;
				$this->defaultAdminSettings = (bool)$valor;
			}else{
				$salida['motivo'] = 'Fallo la consulta SQL.';
			}
		}else{
			$salida['motivo'] = 'Sin permisos, superusuario.';
		}
		return $salida;
	}

	
	public function setTelefono($nuevoTelefono) {
		$salida = array("estado" => false, "motivo" => "");

			global $virsoft;
			$sql = 'UPDATE `Usuarios` SET `telefono` = ? WHERE `Usuarios`.`ID` = ?';
			$params = [
				['type' => 's', 'value' => trim($nuevoTelefono)],
				['type' => 'i', 'value' => $this->idUsuario],
			];
			if ($virsoft->ejecutarConsultaPreparadaSimple($sql, $params)) {
				$salida['estado'] = true;
				$this->telefono = trim($nuevoTelefono);
			} else {
				$salida['motivo'] = 'Falló la consulta SQL.';
			}
		
		return $salida;
	}


	public function setFechaNacimiento($nuevaFecha) :array{
		$salida = ["estado" => false, "motivo" => ""];

		global $virsoft;

		// Si es NULL, queremos borrar la fecha
		if (is_null($nuevaFecha)) {
			$sql = 'UPDATE `Usuarios` SET `fechaNacimiento` = NULL WHERE `ID` = ?';
			$params = [
				['type' => 'i', 'value' => $this->idUsuario],
			];

			if ($virsoft->ejecutarConsultaPreparadaSimple($sql, $params)) {
				$this->fechaNacimiento = null;
				$salida['estado'] = true;
			} else {
				$salida['motivo'] = 'Falló la consulta SQL (borrar fecha).';
			}

			return $salida;
		}

		// Si es objeto DateTime, lo formateamos
		if ($nuevaFecha instanceof DateTime) {
			$fecha = $nuevaFecha;
			$fechaFormateada = $fecha->format('Y-m-d');
		}
		// Si es string, lo validamos
		elseif (is_string($nuevaFecha)) {
			$fecha = DateTime::createFromFormat('Y-m-d', $nuevaFecha);
			if (!$fecha || $fecha->format('Y-m-d') !== $nuevaFecha) {
				$salida['motivo'] = 'Formato de fecha inválido. Usa AAAA-MM-DD.';
				return $salida;
			}
			$fechaFormateada = $nuevaFecha;
		}
		else {
			$salida['motivo'] = 'Tipo de dato inválido para la fecha.';
			return $salida;
		}

		// Ahora sí, guardamos en la base de datos
		$sql = 'UPDATE `Usuarios` SET `fechaNacimiento` = ? WHERE `ID` = ?';
		$params = [
			['type' => 's', 'value' => $fechaFormateada],
			['type' => 'i', 'value' => $this->idUsuario],
		];

		if ($virsoft->ejecutarConsultaPreparadaSimple($sql, $params)) {
			$this->fechaNacimiento = $fecha;
			$salida['estado'] = true;
		} else {
			$salida['motivo'] = 'Falló la consulta SQL.';
		}

		return $salida;
	}













	
	
	
	public function setContrasena($passNEW, $usuario){
		global $virsoft;
		$salida = array(
			"estado" => false,
			"motivo" => ""
		);
		$salt = $virsoft -> generarSaltAleatorio();
		$passSalt = $virsoft -> generarHashSalt($passNEW, $salt);
		$query = 'UPDATE Usuarios SET Pass = ?, SaltOfPass = ? WHERE Usuarios.Usuario = ?';
		$params = [
			['type' => 's', 'value' => $passSalt],
			['type' => 's', 'value' => $salt],
			['type' => 's', 'value' => $usuario],
		];
		$tmp = $virsoft->ejecutarConsultaPreparadaSimple($query, $params);
		$salida['estado'] = $tmp;
		return $salida;
	}
	
	public function setContrasenaActual($passOLD, $passNEW){
		global $virsoft;

		$salida = array(
			"estado" => false,
			"motivo" => ""
		);
		
		// Primero verificamos las credenciales viejunas:
		$usuario = $this -> usuario;
		if ( $this -> verificarCredenciales($usuario, $passOLD) ){
			// Credenciales viejunas validas.
			// definimos un SALT nuevisimo y codificamos la clave:
			$salt = $virsoft -> generarSaltAleatorio();
			$passSalt = $virsoft -> generarHashSalt($passNEW, $salt);
			$query = 'UPDATE Usuarios SET Pass = ?, SaltOfPass = ? WHERE Usuarios.ID = '.$this -> idUsuario;
			$params = [
				['type' => 's', 'value' => $passSalt],
				['type' => 's', 'value' => $salt]
			];
			$virsoft->ejecutarConsultaPreparadaSimple($query, $params);
			$salida['estado'] = true;
		}else{
			$salida['motivo'] = "Contraseña antigua inválida.";
		}
		return $salida;
	}

	public function setApellidos($apellidos){
		global $virsoft;
		if ($this->verificada){
			$this->apellidos = $apellidos;
			$query = "UPDATE Usuarios SET Apellidos = ? WHERE Usuarios.ID = ?";
			$params = [
				['type' => 's', 'value' => $apellidos],
				['type' => 'i', 'value' => $this->idUsuario]
			];
			$virsoft->ejecutarConsultaPreparadaSimple($query, $params);
		}
	}

	public function setNonmbre($nombre) {
		global $virsoft;
		if ($this->verificada){
			$this->nombre = $nombre;
			$query = "UPDATE Usuarios SET Nombre = ? WHERE Usuarios.ID = ?";
			$params = [
				['type' => 's', 'value' => $nombre],
				['type' => 'i', 'value' => $this->idUsuario]
			];
			$virsoft->ejecutarConsultaPreparadaSimple($query, $params);
		}
	}

	public function setEmail($email) {
		global $virsoft;
		if ($this->verificada){
			$this->email = $email;
			
			// Actualizar el dato en la base de datos
			$query = "UPDATE Usuarios SET email = ? WHERE id = ?";
			$params = [
				['type' => 's', 'value' => $email],
				['type' => 'i', 'value' => $this->idUsuario]
			];
			$virsoft->ejecutarConsultaPreparadaSimple($query, $params);
		}
	}
}
$GLOBALS['usuario'] = new Usuario();

?>
