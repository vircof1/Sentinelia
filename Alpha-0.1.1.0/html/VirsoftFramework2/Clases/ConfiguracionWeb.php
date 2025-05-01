<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class configuracionWeb {

	// --- Emplazamiento de esta instancia de sentinelia:
	private string $infoNombreServidor;
	private string $infoNombreEmpresa;
	private string $infoPais;
	private string $infoPoblacion;
	private string $infoDataCenter;
	private string $infoArmarioRack;
	
	// --- URL y metodo de envio de los tiket de soporte:
	private string $urlNotificacionTiket;
	private string $metodoEnvioTiket;
	

	// --- Proteccion de login ---
	private int $ultimoDelayLogin;					// Ultimo delay necesario, en milisegundos para encriptar la clave.


	// --- Configuración de versión de configuracion --- (invalidador de Cache de sesiones)
	private int $versionDeConfiguracion;

	// --- Configuración de contraseñas ---
	private bool $conplejidadContraseñas;			// Clave: requirePassComplexity
	private int $longitudMinimaPassword;			// Clave: minPassLength
	private bool $requerirNumeros;					// Clave: passRequireNumbers
	private bool $requerirMayusculas;				// Clave: passRequireUppercase
	private bool $requerirSimbolos;					// Clave: passRequireSymbols
	
	// --- Configuracion PoW ---
	private int $poW_dificultadMinima;				// Dificultad minima a la que se expondrán los usuarios en su primer login.
	private int $poW_dificultadMaxima;				// Dificultad maxima que no se superara en ningun caso. (no puede ser superior a 64... 64 seria una prueba irrosoluble. Recomiendo 26)
	private int $poW_tiempoObjetivoMaximo;			// Tiempo objetivo, que el sistema intentara "molestar" en su prueba mas dura.
	private int $poW_reintentosMaximos;				// Numero de intentos para llegar al tiempo maximo objetivo....
	private int $poW_reintentosSinEscalar;			// Número de intentos permitidos sin penalización. Estancado en el humbral minimo.
	private int $poW_tiempoPerdonIP;				// Tiempo en minutos sin reintentos para que una IP vuelva al estado inicial de dificultad mínima.
	private int $poW_dificultadMinimaPenalizada;		// Dificultad minima a la que se enfrentaran los usuarios con maxima penalizacion.
	
	
	// Peticiones web con intermediarios
	private array $reverseProxiesConocidos;	// Servidores ReverseProxy, reconocidos y de confianza. No se puede tolerar un proxy atacante que modifique los headers.
	
	// Version del programa sentinelia:
	private string $versionSentinelia;


	// --- Constructor ---
	public function __construct(){
		global $virsoft;

		// cargamos las claves que solo tienen un unico valor...
		$sql = 'SELECT clave, valor, tipo FROM configuracion WHERE clave IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
		$params = [
			['type' => 's', 'value' => 'configuracionVersion'],			// Sincronizador de versiones
			
			['type' => 's', 'value' => 'requirePassComplexity'],		// seguridad de contraseñas de usuarios
			['type' => 's', 'value' => 'minPassLength'],
			['type' => 's', 'value' => 'passRequireNumbers'],
			['type' => 's', 'value' => 'passRequireUppercase'],
			['type' => 's', 'value' => 'passRequireSymbols'],
			
			['type' => 's', 'value' => 'ultimoDelayLogin'],				// Proteccion del login. Simulacion de delay exacto. Evasion de fallos de seguridad por enumeracion.
			
			['type' => 's', 'value' => 'PoW_dificultadMinima'],			// PoW
			['type' => 's', 'value' => 'PoW_dificultadMaxima'],
			['type' => 's', 'value' => 'PoW_tiempoObjetivoMaximo'],
			['type' => 's', 'value' => 'PoW_reintentosMaximos'],
			['type' => 's', 'value' => 'PoW_reintentosSinEscalar'],
			['type' => 's', 'value' => 'PoW_tiempoPerdonIP'],
			['type' => 's', 'value' => 'poW_dificultadMinimaPenalizada'],
			
			['type' => 's', 'value' => 'reverseProxiesConocidos'],		// Servidores ReverseProxy, reconocidos y de confianza. No se puede tolerar un proxy atacante, que modifique los headers de las peticiones.
			
			['type' => 's', 'value' => 'InfoNombreServidor'],			// Emplazamiento e informacion de la instancia de sentinelia:
			['type' => 's', 'value' => 'InfoNombreEmpresa'],
			['type' => 's', 'value' => 'InfoPais'],
			['type' => 's', 'value' => 'InfoPoblacion'],
			['type' => 's', 'value' => 'InfoDataCenter'],
			['type' => 's', 'value' => 'InfoArmarioRack'],
			
			['type' => 's', 'value' => 'urlNotificacionTiket'],				// Metodo de envio de los tiket de soporte
			['type' => 's', 'value' => 'metodoEnvioTiket'],
			
			['type' => 's', 'value' => 'sentineliaVersion'],				// Version Sentinelia
		];


		$resultados = $virsoft->ejecutarConsultaPreparada($sql, $params);

		// Creamos un array asociativo clave => valor
		$config = array();
		foreach ($resultados as $fila) {
			if ( $fila['tipo'] !== 'array' ){
				$config[$fila['clave']] = $fila['valor'];
			}else{
				$config[$fila['clave']] []= $fila['valor'];
			}
		}
		
		// Version de Sentinelia:
		$this->versionSentinelia = $config['sentineliaVersion'];
		
		
		// Metodo de envio de los tiket de soporte:
		$this->urlNotificacionTiket = $config['urlNotificacionTiket'];
		$this->metodoEnvioTiket = $config['metodoEnvioTiket'];
		
		
		// Nombre y emplazamiento de esta instancia:
		$this->infoNombreServidor = $config['InfoNombreServidor'];
		$this->infoNombreEmpresa = $config['InfoNombreEmpresa'];
		$this->infoPais = $config['InfoPais'];
		$this->infoPoblacion = $config['InfoPoblacion'];
		$this->infoDataCenter = $config['InfoDataCenter'];
		$this->infoArmarioRack = $config['InfoArmarioRack'];
		
		

		// Asignamos cada valor con su tipo correcto
		$this->versionDeConfiguracion = intval($config['configuracionVersion']);			// Version de la configuracion
		$this->conplejidadContraseñas = ($config['requirePassComplexity'] === '1');			// Seguridad de contraseñas
		$this->longitudMinimaPassword = intval($config['minPassLength']);
		$this->requerirNumeros = ($config['passRequireNumbers'] === '1');
		$this->requerirMayusculas = ($config['passRequireUppercase'] === '1');
		$this->requerirSimbolos = ($config['passRequireSymbols'] === '1');

																							// Seguridad del login, por enumeracion
		// Seguridad del login, por enumeración (solo se aplica si el usuario NO existe o falla antes de verificar la contraseña)
		$delay = intval($config['ultimoDelayLogin']); // en milisegundos
		$variacion = rand(-50, 50); // luego se aplica una desviacion de -250, 250
		$this->ultimoDelayLogin = max(0, $delay + $variacion); // nunca menos de 0 ms nunca debe ser fijo. Esto solo sirve en logins incorrectos
		
		// Prueba de trabajo: PoW
		$this -> poW_dificultadMinima = intval($config['PoW_dificultadMinima']);
		$this -> poW_dificultadMaxima = intval($config['PoW_dificultadMaxima']);
		$this -> poW_tiempoObjetivoMaximo = intval($config['PoW_tiempoObjetivoMaximo']);
		$this -> poW_reintentosMaximos = intval($config['PoW_reintentosMaximos']);
		$this -> poW_reintentosSinEscalar = intval($config['PoW_reintentosSinEscalar']);
		$this -> poW_tiempoPerdonIP = intval($config['PoW_tiempoPerdonIP']);
		$this -> poW_dificultadMinimaPenalizada = intval($config['poW_dificultadMinimaPenalizada']);
		
		// Servidores Proxy de confianza:
		if (isset($config['reverseProxiesConocidos'])){
			$this -> reverseProxiesConocidos = $config['reverseProxiesConocidos'];
		}else{
			$this -> reverseProxiesConocidos = [];
		}
		
	}

	// --- Cargador con caché en sesión ---
	public static function load(): configuracionWeb {
		global $virsoft;

		if (isset($_SESSION['configuracionWeb'])) {
			$sql = 'SELECT valor FROM configuracion WHERE clave = ? LIMIT 1';
			$params = [['type' => 's', 'value' => 'configuracionVersion']];
			$resultadoSQL = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

			if ((int)$resultadoSQL['valor'] === $_SESSION['configuracionWeb']->getConfiguracionVersion()) {
				return $_SESSION['configuracionWeb'];
			}
		}

		// Si no existe o no coincide la versión, lo creamos y lo guardamos
		$instancia = new configuracionWeb();
		$_SESSION['configuracionWeb'] = $instancia;
		return $instancia;
		// ejemplo de uso:  $config = configuracionSitio::load();
	}

	// --- Getters ---
	
	// Metodo para saber la version de sentinelia
	public function getVersionSentinelia(){ return $this->versionSentinelia; }
	
	// Metodo de envio en los tiket de soporte
	public function getUrlNotificacionTiket(){ return $this->urlNotificacionTiket; }
	public function getMetodoEnvioTiket(){ return $this->metodoEnvioTiket; }
	

	// Nombre y emplazamiento de la instancia de sentinelia:
	public function getInfoNombreServidor(): string { return $this-> infoNombreServidor; }
	public function getInfoNombreEmpresa(): string { return $this-> infoNombreEmpresa; }
	public function getInfoPais(): string { return $this->infoPais; }
	public function getInfoPoblacion(): string { return $this->infoPoblacion; }
	public function getInfoDataCenter(): string { return $this->infoDataCenter; }
	public function getInfoArmarioRack(): string { return $this->infoArmarioRack; }
	
	// Servidores Reverse Proxy
	public function getReverseProxiesConocidos(): array { return $this->reverseProxiesConocidos; }
	
	// PoW
	public function getPoWDificultadMinima(): int { return $this->poW_dificultadMinima; }
	public function getPoWDificultadMaxima(): int { return $this->poW_dificultadMaxima; }
	public function getPoWTiempoObjetivoMaximo(): int { return $this->poW_tiempoObjetivoMaximo; }
	public function getPoWReintentosMaximos(): int { return $this->poW_reintentosMaximos; }
	public function getPoWReintentosSinEscalar(): int { return $this->poW_reintentosSinEscalar; }
	public function getPoW_tiempoPerdonIP(): int { return $this->poW_tiempoPerdonIP; }
	public function getPoW_dificultadMinimaPenalizada(): int { return $this->poW_dificultadMinimaPenalizada; }
	
	// Protecciones
	public function getUltimoDelayLogin(): int {
		return $this->ultimoDelayLogin;
	}
	
	public function getConfiguracionVersion(): int {
		return $this->versionDeConfiguracion;
	}

	public function getConplejidadContraseñas(): bool {
		return $this->conplejidadContraseñas;
	}

	public function getLongitudMinimaPassword(): int {
		return $this->longitudMinimaPassword;
	}

	public function getRequerirNumeros(): bool {
		return $this->requerirNumeros;
	}

	public function getRequerirMayusculas(): bool {
		return $this->requerirMayusculas;
	}

	public function getRequerirSimbolos(): bool {
		return $this->requerirSimbolos;
	}
	
	// --- Seters ---
	
	
	public function setUltimoDelayLogin(int $tiempo): void {
		global $virsoft;

		// Seguridad defensiva: acotamos el valor a un rango razonable
		if ($tiempo < 0) {
			$tiempo = 0;
		} elseif ($tiempo > 60000) {
			$tiempo = 60000;
		}

		$sql = 'UPDATE configuracion SET valor = ? WHERE clave = ? AND tipo = ? LIMIT 1';
		$params = [
			['type' => 's', 'value' => (string)$tiempo],
			['type' => 's', 'value' => 'ultimoDelayLogin'],
			['type' => 's', 'value' => 'int']
		];

		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

		// No se sube version, no se invalida cache: es un valor dinámico
	}
	
	
	public function setLongitudMinimaPassword(int $valorINT):array{
		$salida = array(
			'estado' => false, 
			'motivo' => ''
		);
		
		// verificamos que existan cambios:
		if( $this->getLongitudMinimaPassword() === (int)$valorINT ){
			$salida['estado'] = true;
			return $salida;
		}
				
		if ( $valorINT < 3 ) {
			$salida['motivo'] = 'El valor mínimo debe ser mayor que tres.';
		}elseif( $valorINT > 99 ){
			$salida['motivo'] = 'El valor maximo debe ser menos que doscientos.';
		}elseif( !is_int($valorINT) ){
			$salida['motivo'] = 'La longitud minima de caracteres, debe ser un numero.';
		}
		
		
		// verificamos errores de saneamiento ejecutamos y damos salida:
		if ($salida['motivo'] != ''){
			return $salida;
		}
		
		$salida['estado'] = self::setClaveValorSimple('minPassLength', (string)$valorINT);
		if ( !$salida['estado'] ){
			$salida['motivo'] ='Fallo en consulta SQL';
		}
		
		return $salida;
	}
	
	
	// Seter de nombre de servidor:
	public function setInfoNombreServidor(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoNombreServidor() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoNombreServidor', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo en consulta SQL.';
		}

		return $salida;
	}

	// Seter de nombre de empresa:
	public function setInfoNombreEmpresa(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoNombreEmpresa() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoNombreEmpresa', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo en consulta SQL.';
		}

		return $salida;
	}

	// Seter para verificar y setear la URL de Tikets
	public function setUrlNotificacionTiket(string $url): array {
		$salida = ['estado' => false, 'motivo' => ''];

		// Validación básica de URL (puede ser ruta relativa también)
		if (trim($url) === '') {
			$salida['motivo'] = 'La URL de notificación no puede estar vacía.';
			return $salida;
		}

		if ($this->getUrlNotificacionTiket() === $url) {
			$salida['estado'] = true;
			return $salida;
		}
		
		// Validamos que sea una URL absoluta válida
		if (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#', $url)) {
			$salida['motivo'] = 'La URL debe ser absoluta y comenzar por "http://" o "https://".';
			return $salida;
		}
		
		// Verificaciones de saber si es una URL, valida:

		$salida['estado'] = self::setClaveValorSimple('urlNotificacionTiket', $url);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo en la actualización de la URL de notificación.';
		}

		return $salida;
	}


	// Seter para verificar y setear el metodo de envio de tiket
	public function setMetodoEnvioTiket(string $metodo): array {
		$salida = ['estado' => false, 'motivo' => ''];

		$metodo = strtoupper(trim($metodo));
		if (!in_array($metodo, ['GET', 'POST'])) {
			$salida['motivo'] = 'El método de envío debe ser GET o POST.';
			return $salida;
		}

		if ($this->getMetodoEnvioTiket() === $metodo) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('metodoEnvioTiket', $metodo);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo en la actualización del método de envío.';
		}

		return $salida;
	}
	
	// Seter para meter el pais.	
	public function setInfoPais(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoPais() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoPais', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar el país.';
		}

		return $salida;
	}

	// Seter para meter la poblacion.
	public function setInfoPoblacion(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoPoblacion() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoPoblacion', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar la población.';
		}

		return $salida;
	}

	// Seter para meter el DataCenter
	public function setInfoDataCenter(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoDataCenter() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoDataCenter', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar el data center.';
		}

		return $salida;
	}

	// Seter para el armario Rack
	public function setInfoArmarioRack(string $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getInfoArmarioRack() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('InfoArmarioRack', $valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar el armario/rack.';
		}

		return $salida;
	}

	// Seter para complejidad de contraseñas	
	public function setConplejidadContraseñas(bool $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getConplejidadContraseñas() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('requirePassComplexity', $valor ? '1' : '0');
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar el estado de complejidad.';
		}

		return $salida;
	}

	// Seter para requerir contraseñas
	public function setRequerirMayusculas(bool $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getRequerirMayusculas() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('passRequireUppercase', $valor ? '1' : '0');
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar la opción de mayúsculas.';
		}

		return $salida;
	}

	// Seter para requerir numeros
	public function setRequerirNumeros(bool $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getRequerirNumeros() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('passRequireNumbers', $valor ? '1' : '0');
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar la opción de números.';
		}

		return $salida;
	}

	// Seter para requerir simbolos
	public function setRequerirSimbolos(bool $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getRequerirSimbolos() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('passRequireSymbols', $valor ? '1' : '0');
		if (!$salida['estado']) {
			$salida['motivo'] = 'Fallo al guardar la opción de símbolos.';
		}

		return $salida;
	}	


	// Seter de PoW	dificultad minima
	public function setPoWDificultadMinima(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoWDificultadMinima() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_dificultadMinima', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar la dificultad mínima.';
		}

		return $salida;
	}

	// Seter de PoW dificultad Maxima
	public function setPoWDificultadMaxima(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoWDificultadMaxima() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_dificultadMaxima', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar la dificultad máxima.';
		}

		return $salida;
	}

	// Seter de PoW Tiempo objetivo
	public function setPoWTiempoObjetivoMaximo(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoWTiempoObjetivoMaximo() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_tiempoObjetivoMaximo', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar el tiempo objetivo.';
		}

		return $salida;
	}

	// Seter de PoW Intentos maximos
	public function setPoWReintentosMaximos(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoWReintentosMaximos() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_reintentosMaximos', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar el número máximo de reintentos.';
		}

		return $salida;
	}

	// Seter de PoW Nº de intentos, sin escalar dificultad.
	public function setPoWReintentosSinEscalar(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoWReintentosSinEscalar() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_reintentosSinEscalar', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar el número de reintentos sin escalar.';
		}

		return $salida;
	}

	// Seter de PoW Tiempo de perdon PoW
	public function setPoWTiempoPerdonIP(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoW_tiempoPerdonIP() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('PoW_tiempoPerdonIP', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar el tiempo de perdón para la IP.';
		}

		return $salida;
	}
	
	// Seter de PoW con la dificultad minima, para un usuario problematico...
	public function setPoW_dificultadMinimaPenalizada(int $valor): array {
		$salida = ['estado' => false, 'motivo' => ''];

		if ($this->getPoW_dificultadMinimaPenalizada() === $valor) {
			$salida['estado'] = true;
			return $salida;
		}

		if ($valor < 1 || $valor > 64) {
			$salida['motivo'] = 'El valor debe estar entre 1 y 64.';
			return $salida;
		}

		$salida['estado'] = self::setClaveValorSimple('poW_dificultadMinimaPenalizada', (string)$valor);
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar la dificultad mínima penalizada.';
		}

		return $salida;
	}	
	
	
	public function setReverseProxiesConocidos(array $ips): array {
		$salida = ['estado' => false, 'motivo' => ''];

		// Validaciones previas (puedes quitarlas si las haces fuera)
		foreach ($ips as $ip) {
			if (!filter_var($ip, FILTER_VALIDATE_IP)) {
				$salida['motivo'] = "IP no válida detectada: {$ip}";
				return $salida;
			}
		}

		// Si es igual a lo que ya hay, no hacemos nada
		if ($this->getReverseProxiesConocidos() === $ips) {
			$salida['estado'] = true;
			return $salida;
		}

		// Guardamos usando la función global
		$salida['estado'] = self::setClaveValorArray('reverseProxiesConocidos', $ips, 'Servidores Reverse Proxy de confianza');
		if (!$salida['estado']) {
			$salida['motivo'] = 'No se pudo guardar la lista de servidores proxy.';
		}

		return $salida;
	}	
	
		
		
		
		
		
		
		
		
		
	public static function setClaveValorArray(string $clave, array $valores, string $descripcion = 'Descripción no proporcionada'): bool {
		global $virsoft;
		global $usuario;

		$salida = false;

		// --- Verificar permisos ---
		if (!$usuario->puedeConfigurarWeb()) {
			throw new Exception("No tienes permisos para modificar la configuración Web.");
		}

		// --- Borrado previo de todos los valores asociados a la clave ---
		$sqlDelete = 'DELETE FROM configuracion WHERE clave = ?';
		$paramsDelete = [['type' => 's', 'value' => $clave]];
		$boolDelete = $virsoft->ejecutarConsultaPreparadaSimple($sqlDelete, $paramsDelete);

		if (!$boolDelete) {
			throw new Exception("No se pudo eliminar la configuración previa de '{$clave}'.");
		}

		// --- Insertar nuevos valores ---
		$sqlInsert = 'INSERT INTO configuracion (clave, valor, tipo, descripcion) VALUES (?, ?, ?, ?)';
		if (count($valores) > 0) {
			foreach ($valores as $valor) {
				$paramsInsert = [
					['type' => 's', 'value' => $clave],
					['type' => 's', 'value' => (string)$valor],
					['type' => 's', 'value' => 'array'],
					['type' => 's', 'value' => $descripcion],
				];
				$ok = $virsoft->ejecutarConsultaPreparadaSimple($sqlInsert, $paramsInsert);
				if (!$ok) {
					throw new Exception("Error al insertar el valor '{$valor}' para la clave '{$clave}'.");
				}
			}
		}

		// --- Subir versión de configuración ---
		$sqlVersion = 'UPDATE configuracion SET valor = valor + 1 WHERE clave = ?';
		$paramsVersion = [['type' => 's', 'value' => 'configuracionVersion']];
		$boolVersion = $virsoft->ejecutarConsultaPreparadaSimple($sqlVersion, $paramsVersion);

		if ($boolVersion) {
			$salida = true;
		}

		// --- Invalida caché ---
		unset($_SESSION['configuracionWeb']);

		return $salida;
	}	
	
	
	
	
	
	
	
	
	
	
	
	
	public static function setClaveValorSimple(string $clave, string $valor): bool {
		global $virsoft; 		// funciones y metodos principales del framework. 
		global $usuario; 		// Propiedades y metodos del usuario actual.
		
		$salida = false;

		// --- Verificar permisos ---
		if ( !$usuario->puedeConfigurarWeb() ) {
			// me parece bien generar una excepción, porque la GUI nunca deveria permitir acceso a un menú sin acceso.
			throw new Exception("No tienes permisos para modificar la configuración Web."); 
		}

		// --- Verificar que solo haya un registro con esa clave ---
		$sqlCheck = 'SELECT COUNT(*) AS total FROM configuracion WHERE clave = ?';
		$paramsCheck = [['type' => 's', 'value' => $clave]];
		$resultadoCheck = $virsoft->ejecutarConsultaPreparadaSimple($sqlCheck, $paramsCheck);

		if ((int)$resultadoCheck['total'] > 1) {
			throw new Exception("La clave '{$clave}' no es única. Esta operación solo se permite sobre claves simples.");
		}elseif( (int)$resultadoCheck['total'] === 0 ){
			throw new Exception("La clave '{$clave}' no existe."); // asumimos que en el instalador (que aun no esta hecho) setearemos los valores por defecto.
		}
		
		if( is_bool($valor) ){
			$valor = (int)$valor;
			$valor = (string)$valor;
		}
		if ( is_int($valor) ){
			$valor = (string)$valor;
		}

		// --- Actualizar valor ---
		$sqlUpdate = 'UPDATE configuracion SET valor = ? WHERE clave = ?';
		$paramsUpdate = [
			['type' => 's', 'value' => $valor],
			['type' => 's', 'value' => $clave],
		];
		$bool1 = $virsoft->ejecutarConsultaPreparadaSimple($sqlUpdate, $paramsUpdate);

		// --- Subir version ---
		$sqlVersion = 'UPDATE configuracion SET valor = valor + 1 WHERE clave = ?';
		$paramsVersion = [['type' => 's', 'value' => 'configuracionVersion']];
		$bool2 = $virsoft->ejecutarConsultaPreparadaSimple($sqlVersion, $paramsVersion);




		if ( $bool1 AND $bool2 ){ $salida = true; }


		// --- Invalida caché, liberamos memoria ---
		unset($_SESSION['configuracionWeb']);
		
		return $salida;
	}
	
	
}

// lo inicializamos ya.
if (session_status() === PHP_SESSION_NONE) {
	session_start();
}
$configuracionWeb = configuracionWeb::load();
?>
