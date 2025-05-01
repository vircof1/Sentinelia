<?php
// Seguridad básica
if (!isset($virsoftControlInclude)) { die; }
if (!$virsoftControlInclude) { die; }

class TareaTCP extends Tarea {
    // Variables funcionales para el tipo de tarea
    private $host;
    private $port;
    //private $tipoTarea;

	public function __construct($tarea) {
		parent::__construct($tarea);

		$this->tipoTarea = 'tcp';

		// Variables específicas del tipo de tarea
		$this->host = $tarea['url_servicio'] ?? '';
		$this->port = $tarea['puerto_tcp'] ?? 80; // Puerto por defecto: 80

		// Validación del host utilizando el método centralizado
		$validacionHost = Tarea::validarHost($this->host);
		if (!$validacionHost['Estado']) {
			throw new InvalidArgumentException($validacionHost['Motivo']);
		}

		// Validación del puerto TCP
		if (!is_numeric($this->port) || $this->port < 1 || $this->port > 65535) {
			throw new InvalidArgumentException('Puerto inválido. Debe ser un número entre 1 y 65535.');
		}
	}


	public function ejecutar() {
		$startTime = microtime(true);

		// 🔹 Obtiene la IP actual del host
		$ipActual = gethostbyname($this->host);

		// Verificar si la resolución DNS ha fallado
		if ($ipActual === $this->host && !filter_var($ipActual, FILTER_VALIDATE_IP)) {
			$ipActual = "IP desconocida";
		}
		
	
		$connection = @fsockopen($this->host, $this->port, $errno, $errstr, 5);
		//$executionTime = round((microtime(true) - $startTime) * 1000); // Tiempo en ms

		// ✅ Inicialización paranoica (valores no válidos para que explote si algo no se asigna bien)
		$estadoMonitor = 'fallo';                        // ('éxito', 'fallo')
		$mensajeEstadoMonitor = 'Tarea mal ejecutada';  
		$nivelAlertaMonitor = 'crítico';                 // ('información', 'advertencia', 'crítico')
		$contadorAlertasMonitor = null;                  // Valor nulo para forzar error si no se asigna

		if ($connection) {
			fclose($connection);

			if ($this->tareaNegada) {
				// 🔹 Si la tarea está negada, la conexión es un **fallo**
				$contadorIntentos = $this->intentosFallidosActuales + 1;
				$this->setIntentosFallidosActuales($contadorIntentos);

				$estadoMonitor = 'fallo';
				if ( $this->getRegistrarIp() ){
					$mensajeEstadoMonitor = "Conexión TCP detectada en {$this->host} ({$ipActual}):{$this->port}.";
				}else{
					$mensajeEstadoMonitor = "Conexión TCP detectada.";
				}
				
				$nivelAlertaMonitor = $contadorIntentos >= $this->intentosPermitidos ? 'crítico' : 'advertencia';
				$contadorAlertasMonitor = $contadorIntentos;
			} else {
				// 🔹 Si la tarea **no está negada**, la conexión es un **éxito**
				$estadoMonitor = 'éxito';
				if ( $this->getRegistrarIp() ){
					$mensajeEstadoMonitor = "Conexión TCP exitosa en {$this->host} ({$ipActual}):{$this->port}";
				}else{
					$mensajeEstadoMonitor = "Conexión TCP exitosa.";
				}
				
				$nivelAlertaMonitor = 'información';
				$contadorAlertasMonitor = 0;
			}
		} else {
			// 🔹 Si la conexión **falla**, aumentar intentos fallidos
			$contadorIntentos = $this->intentosFallidosActuales + 1;
			$this->setIntentosFallidosActuales($contadorIntentos);

			if ($this->tareaNegada) {
				// 🔹 Si la tarea está **negada**, un fallo es un **éxito**
				$estadoMonitor = 'éxito';
				
				if ( $this->getRegistrarIp() ){
					$mensajeEstadoMonitor = "No se detectó conexión TCP en {$this->host} ({$ipActual}):{$this->port}.";
				}else{
					$mensajeEstadoMonitor = "No se detectó conexión TCP.";
				}
				$nivelAlertaMonitor = 'información';
				$contadorAlertasMonitor = 0;
			} else {
				// 🔹 Si la tarea **no está negada**, el fallo se maneja con advertencia/crítico
				$estadoMonitor = 'fallo';
				if ( $contadorIntentos >= $this->intentosPermitidos ){
					if ( $this->getRegistrarIp() ){
						$mensajeEstadoMonitor = "Fallo TCP crítico. No se pudo conectar en {$this->host} ({$ipActual}):{$this->port}.";
					}else{
						$mensajeEstadoMonitor = "Fallo TCP crítico. No se pudo conectar.";
					}
					
				}else{
					if ( $this->getRegistrarIp() ){
						$mensajeEstadoMonitor = "Advertencia: fallo en la conexión TCP en {$this->host} ({$ipActual}):{$this->port}.";
					}else{
						$mensajeEstadoMonitor = "Advertencia: fallo en la conexión TCP.";
					}
					
					
				}
				
				$nivelAlertaMonitor = $contadorIntentos >= $this->intentosPermitidos ? 'crítico' : 'advertencia';
				$contadorAlertasMonitor = $contadorIntentos;
			}
		}

		// ✅ Registrar el resultado con la IP en el mensaje
		$this->registrarResultado($estadoMonitor, $mensajeEstadoMonitor, $nivelAlertaMonitor, $contadorAlertasMonitor);

		$this->actualizarProximaEjecucion();
		$this->consolidarDatosEnSQL();
	}

    
    
    
    
    
    public function getHost(){
		return $this->host;
	}
    
    public function getPuerto(){
		return $this->port;
	}
	
	public static function editarCrear($post) {
		// Dependencias
		global $virsoft;

		// Validación del token CSRF
		if (!isset($post['csrf_token']) || !hash_equals($virsoft->getTokenCSRG(), $post['csrf_token'])) {
			throw new Exception('Token CSRF no válido o ausente');
		}

		// Variables de salida
		$salidaDatos = ['Estado' => false, 'Motivo' => ''];

		// Validación del host (IP o dominio)
		$validacionHost = Tarea::validarHost($post['hostServicio']);
		if (!$validacionHost['Estado']) {
			return $validacionHost; // Retornamos el motivo de error
		}


		// Verificamos el nombre de la tarea:
		 if (empty($post['nombreServicio'])) {
			return ['Estado' => false, 'Motivo' => 'El nombre del monitor no puede estar vacío.'];
		}
		if (strlen($post['nombreServicio']) > 255) {
			return ['Estado' => false, 'Motivo' => 'El nombre del monitor no puede tener más de 255 caracteres.'];
		}


		// Validación del puerto TCP
		if (!isset($post['puertoTCP']) || !preg_match('/^\d+$/', $post['puertoTCP']) || $post['puertoTCP'] <= 0 || $post['puertoTCP'] > 65535) {
			$salidaDatos['Motivo'] = 'El puerto TCP debe ser un número entero entre 1 y 65535.';
			return $salidaDatos;
		}

		// Validación del intervalo
		if (!ctype_digit($post['intervalo']) || $post['intervalo'] < 1 || $post['intervalo'] > 4294967295) {
			return ['Estado' => false, 'Motivo' => 'El intervalo debe ser un entero entre 1 y 4294967295.'];
		}
		

		// Validación de intentos permitidos
		if (!ctype_digit($post['intentosPermitidos']) || $post['intentosPermitidos'] < 1 || $post['intentosPermitidos'] > 4294967295) {
			return ['Estado' => false, 'Motivo' => 'El número de intentos permitidos debe ser un entero entre 1 y 4294967295.'];
		}
		

		// Validación de descripción y posible causa
		$descripcionFallo = isset($post['descripcion_fallo']) ? substr(trim($post['descripcion_fallo']), 0, 255) : '';
		if (strlen($post['descripcion_fallo']) > 255) {
			return ['Estado' => false, 'Motivo' => '⚠️ La descripción del fallo no puede superar los 255 caracteres.'];
		}
		$descripcionFallo = isset($post['descripcion_fallo']) ? substr(trim($post['descripcion_fallo']), 0, 255) : '';
		
		// Causa del fallo:
		if (strlen($post['posible_causa']) > 255) {
			return ['Estado' => false, 'Motivo' => '⚠️ La cosible causa de fallo no puede superar los 255 caracteres.'];
		}
		$posibleCausa = isset($post['posible_causa']) ? substr(trim($post['posible_causa']), 0, 255) : '';

		// Evaluar si es una tarea nueva o una actualización
		$idTarea = (int)$post['idTarea'];
		$habilitadaOut = isset($post['habilitada']) ? 1 : 0;
		$negadaOut = isset($post['tareaNegada']) ? 1 : 0;
		$registrarIpOut = isset($post['registrarIp']) ? 1 : 0;
		
		

		if ($idTarea === 0) {
			// Tarea nueva
			$sql = 'INSERT INTO `monitoreo` (
						`nombre_servicio`, `url_servicio`, `puerto_tcp`, `tipo_prueba`,
						`intervalo_minutos`, `estado_resultado`, `mensaje_alerta`,
						`nivel_alerta`, `hora_alerta`, `intentos_permitidos`,
						`intentos_fallidos_actuales`, `TareaHabilitada`, `ultima_ejecucion`,
						`descripcion_fallo`, `posible_causa`,`TareaNegada`, `registrar_ip`
					) VALUES (?, ?, ?, "tcp", ?, "éxito", "Tarea recién creada.",
						"información", current_timestamp(), ?, 0, ?, current_timestamp(), ?, ?, ?, ?)';

			$params = [
				['type' => 's', 'value' => $post['nombreServicio']],
				['type' => 's', 'value' => $post['hostServicio']],
				['type' => 'i', 'value' => $post['puertoTCP']],
				['type' => 'i', 'value' => $post['intervalo']],
				['type' => 'i', 'value' => $post['intentosPermitidos']],
				['type' => 'i', 'value' => $habilitadaOut],
				['type' => 's', 'value' => $descripcionFallo],
				['type' => 's', 'value' => $posibleCausa],
				['type' => 'i', 'value' => $negadaOut],
				['type' => 'i', 'value' => $registrarIpOut],
				
			];
		} else {
			// Actualización de tarea existente
			$sql = 'UPDATE `monitoreo`
					SET `nombre_servicio` = ?, `url_servicio` = ?, `puerto_tcp` = ?,
						`intervalo_minutos` = ?, `estado_resultado` = "éxito",
						`mensaje_alerta` = "Tarea actualizada.", `nivel_alerta` = "información",
						`hora_alerta` = current_timestamp(), `intentos_permitidos` = ?,
						`intentos_fallidos_actuales` = 0, `TareaHabilitada` = ?,
						`ultima_ejecucion` = current_timestamp(),
						`descripcion_fallo` = ?, `posible_causa` = ?, `TareaNegada` = ?, `registrar_ip` = ?
					WHERE `id_monitoreo` = ?';

			$params = [
				['type' => 's', 'value' => $post['nombreServicio']],
				['type' => 's', 'value' => $post['hostServicio']],
				['type' => 'i', 'value' => $post['puertoTCP']],
				['type' => 'i', 'value' => $post['intervalo']],
				['type' => 'i', 'value' => $post['intentosPermitidos']],
				['type' => 'i', 'value' => $habilitadaOut],
				['type' => 's', 'value' => $descripcionFallo],
				['type' => 's', 'value' => $posibleCausa],
				['type' => 'i', 'value' => $negadaOut],
				['type' => 'i', 'value' => $registrarIpOut],
				
				['type' => 'i', 'value' => $idTarea],
				
			];
		}

		// Ejecutar la consulta
		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
		$salidaDatos['Estado'] = true;
		return $salidaDatos;
	}
	
}
?>
