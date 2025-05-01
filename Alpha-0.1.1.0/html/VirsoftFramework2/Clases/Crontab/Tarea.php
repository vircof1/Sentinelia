<?php
// Seguridad Basica:
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class Tarea {
											// Las que empiecen por "X" son susceptibles a cambios dentro del objeto: 
    protected $id;							// ID unico de la tarea.
    protected $nombreServicio;				// Nombre de la tarea.
    protected $proximaEjecucion;			// X Fecha UTC de la proxima ejecucion
    protected $ultimaEjecucion;				// X Fecha UTC de la ultima ejecucion
    protected $estadoResultado;				// X Valores posibles:( fallo, éxito )
    protected $mensajeAlerta;				// X Mensage de la alerta.
    protected $nivelAlerta;					// X Nivel de alerta. Valores posibles: (información, advertencia, crítico )
    protected $intentosPermitidos;			// Número de intentos permitidos para la tarea.
    protected $intentosFallidosActuales;	// X Intentos que lleva la tarea FALLIDOS de forma consecutiva.
    protected $intervaloMinutos;			// Intervalo en minutos que el programa intentara realizar la tarea.
    protected $tipoTarea;					// pues eso tipo de tarea Ping, SQL, TCP
    protected $habilitada;					// Boolean que define si la tarea esta habilitada o no...
    protected $descripcion_fallo;			// Descripción del fallo, desde el punto de vista del que creo el monitor (tarea)
    protected $posible_causa;				// posible causa, desde el punto de vista del que creo el monitor (tarea)
    protected $tareaNegada;					// indicará con un bool si la tarea está negada.
    protected $registrarIp;					// Se registrará la IP de destino en el log?
    protected $fechaCreaccionTarea;			// DateTime con la fecha de creacion del monitor.
    
   

	// $tarea es el array de SQL, con lo que lo tenemos facil...
    public function __construct($tarea) {
		
		//global $virsoft;
		//$this->virsoft = $virsoft;
		
		if ( is_array($tarea) ){
			// Inicializamos los valores a partir del array de la base de datos. Metodo habitual de instancia.
			$this->id = $tarea['id_monitoreo'];
			$this->nombreServicio = $tarea['nombre_servicio'];
			$this->proximaEjecucion = $tarea['proxima_ejecucion'];
			$this->ultimaEjecucion = $tarea['ultima_ejecucion'];
			$this->estadoResultado = $tarea['estado_resultado'];
			$this->mensajeAlerta = $tarea['mensaje_alerta'];
			$this->nivelAlerta = $tarea['nivel_alerta'];
			$this->intentosPermitidos = $tarea['intentos_permitidos'];
			$this->intentosFallidosActuales = $tarea['intentos_fallidos_actuales'];
			$this->intervaloMinutos = $tarea['intervalo_minutos'];
			$this->habilitada = ($tarea['TareaHabilitada'] === 1);
			$this->descripcion_fallo = $tarea['descripcion_fallo'];
			$this->posible_causa = $tarea['posible_causa'];
			$this->tareaNegada = ($tarea['TareaNegada'] == 0) ? false : (($tarea['TareaNegada'] == 1) ? true : null);
			$this->registrarIp = ($tarea['registrar_ip'] == 0) ? false : (($tarea['registrar_ip'] == 1) ? true : null);
			$this->fechaCreaccionTarea = new DateTime($tarea['fechaCreacionMonitor'] ?? 'now', new DateTimeZone('UTC'));
		}else{
			$sql = 'SELECT * FROM `monitoreo` WHERE `id_monitoreo` = ?';
			$params =[
				['type' => 'i', 'value' => $tarea]          	// ID Tarea
			];
			global $virsoft;
			
			$resultadoSQL = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
			
			$this->id = $resultadoSQL['id_monitoreo'];
			$this->nombreServicio = $resultadoSQL['nombre_servicio'];
			$this->proximaEjecucion = $resultadoSQL['proxima_ejecucion'];
			$this->ultimaEjecucion = $resultadoSQL['ultima_ejecucion'];
			$this->estadoResultado = $resultadoSQL['estado_resultado'];
			$this->mensajeAlerta = $resultadoSQL['mensaje_alerta'];
			$this->nivelAlerta = $resultadoSQL['nivel_alerta'];
			$this->intentosPermitidos = $resultadoSQL['intentos_permitidos'];
			$this->intentosFallidosActuales = $resultadoSQL['intentos_fallidos_actuales'];
			$this->intervaloMinutos = $resultadoSQL['intervalo_minutos'];
			$this->habilitada = ($resultadoSQL['TareaHabilitada'] === 1);
			$this->descripcion_fallo = $resultadoSQL['descripcion_fallo'];
			$this->posible_causa = $resultadoSQL['posible_causa'];
			$this->tareaNegada = ($resultadoSQL['TareaNegada'] == 0) ? false : (($resultadoSQL['TareaNegada'] == 1) ? true : null);
			$this->registrarIp = ($resultadoSQL['registrar_ip'] == 0) ? false : (($resultadoSQL['registrar_ip'] == 1) ? true : null);
			$this->fechaCreaccionTarea = new DateTime($resultadoSQL['fechaCreacionMonitor'] ?? 'now', new DateTimeZone('UTC'));
		}
        
        

    }

    // Método común a todas las tareas, que será implementado por cada subclase
    public function ejecutar() {
        throw new Exception("Método ejecutar() no implementado");
    }

    // Método para actualizar la próxima ejecución
    public function actualizarProximaEjecucion() {
        $fechaActual = new DateTime();
        $fechaActual->modify("+{$this->intervaloMinutos} minutes");
        $this->setProximaEjecucion( $fechaActual->format('Y-m-d H:i:s') );
        
    }

    // Otros métodos comunes a todas las tareas
    public function registrarResultado($estado, $mensaje, $nivelAlerta, $intentosFallidosActuales) {
		$this->setEstadoResultado($estado);
		$this->setMensajeAlerta($mensaje);
		$this->setNivelAlerta($nivelAlerta);
		$this->setIntentosFallidosActuales($intentosFallidosActuales);
		
		//protected $estadoResultado;				// X Valores posibles:( fallo, éxito )
		//protected $mensajeAlerta;					// X Mensage de la alerta.
		//protected $nivelAlerta;					// X Nivel de alerta. Valores posibles: (información, advertencia, crítico )
		//protected $intentosFallidosActuales;		// X Intentos que lleva la tarea FALLIDOS de forma consecutiva.
    }
    
    // Geters varios del objeto:
    
    
    public function getId() :int{
		return $this->id;
	}
    
    public function getEstadoResultado(){
		return $this->estadoResultado; // Posibles valores éxito ó fallo
	}
	
	public function getNivelAlerta(){
		return $this->nivelAlerta;
	}
	
	public function getNombreServicio() {
		return $this->nombreServicio;
	}
	
	public function getIntervaloMinutos() :int{
		return $this->intervaloMinutos;
	}
	
	public function getUltimaEjecucion(){
		return $this->ultimaEjecucion;
	}
	
	public function getMensajeAlerta(){
		return $this->mensajeAlerta;
	}
	
	public function getProximaEjecucion(){
		return $this->proximaEjecucion;
	}
	
	public function getIntentosPermitidos(){
		return $this->intentosPermitidos;
	}
	
	public function getHabilitada(){
		return $this->habilitada;
	}
	
	// Getter para descripcion_fallo
	public function getDescripcionFallo() {
		return $this->descripcion_fallo;
	}
	
	// Getter para posible_causa
	public function getPosibleCausa() {
		return $this->posible_causa;
	}
	
	public function getTipoTarea(){
		return $this->tipoTarea;
	}
	
	public function getTareaNegada(){
		return $this->tareaNegada;
	}

    public function getRegistrarIp() {
        return $this->registrarIp;
    }   
    
    public function getFechaCreaccionTarea(): DateTime{
		return $this->fechaCreaccionTarea;
	}

    
    // seters varios del objeto:
    
    public function setRegistrarIp( $bool = true ) {
        // filtramos valores como (yes,no), (1,0), (true,false).
		$valorFiltrado = filter_var($bool, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
		
        // devuelve null si no puede hacer nada con la entrada de datos.
		if (is_null($valorFiltrado)) {
			$this->registrarIp = false; // Valor por defecto de la base de datos
			throw new InvalidArgumentException("El valor de registrarIP debe ser un booleano válido.");
		}
		$this->registrarIp = $valorFiltrado;
    }   
    
    
	public function setTareaNegada($bool = true) {
		// filtramos valores como (yes,no), (1,0), (true,false).
		$valorFiltrado = filter_var($bool, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

		// devuelve null si no puede hacer nada con la entrada de datos.
		if (is_null($valorFiltrado)) {
			$this->tareaNegada = false; // Valor por defecto de la base de datos
			throw new InvalidArgumentException("El valor de TareaNegada debe ser un booleano válido.");
		}

		$this->tareaNegada = $valorFiltrado;
	}
    
    
    // Setter para proximaEjecucion
	public function setProximaEjecucion($proximaEjecucion) {
        // Verificar que el formato de la fecha es válido
        $fecha = DateTime::createFromFormat('Y-m-d H:i:s', $proximaEjecucion);
        if ($fecha && $fecha->format('Y-m-d H:i:s') === $proximaEjecucion) {
            $this->proximaEjecucion = $proximaEjecucion;
        } else {
            throw new InvalidArgumentException("El formato de proximaEjecucion no es válido. Debe ser 'Y-m-d H:i:s'.");
        }
    }


    // Setter para estadoResultado
    public function setEstadoResultado($estadoResultado) {
        $valoresValidos = ['fallo', 'éxito'];
        if (in_array($estadoResultado, $valoresValidos)) {
            $this->estadoResultado = $estadoResultado;
        } else {
            throw new InvalidArgumentException("Valor no válido para estadoResultado.");
        }
    }


	// Setter para mensajeAlerta
	public function setMensajeAlerta($mensajeAlerta) {
		// Asegurarse de que $mensajeAlerta sea un string
		$mensajeAlerta = (string) $mensajeAlerta;
		$this->mensajeAlerta = $mensajeAlerta;
	}


    // Setter para nivelAlerta
    public function setNivelAlerta($nivelAlerta) {
        $nivelesValidos = ['información', 'advertencia', 'crítico'];
        if (in_array($nivelAlerta, $nivelesValidos)) {
            $this->nivelAlerta = $nivelAlerta;
        } else {
            throw new InvalidArgumentException("Valor no válido para nivelAlerta.");
        }
    }


    // Setter para intentosFallidosActuales
    public function setIntentosFallidosActuales($intentosFallidosActuales) {
        if (is_int($intentosFallidosActuales) && $intentosFallidosActuales >= 0) {
            $this->intentosFallidosActuales = $intentosFallidosActuales;
        } else {
            throw new InvalidArgumentException("Número de intentos fallidos debe ser un entero no negativo.");
        }
    }
    
    
	public function setDescripcionFallo($descripcion_fallo) {
		if (is_string($descripcion_fallo) && strlen($descripcion_fallo) <= 256) {
			$this->descripcion_fallo = $descripcion_fallo;
		} else {
			throw new InvalidArgumentException("La descripción del fallo debe ser una cadena de texto de máximo 256 caracteres.");
		}
	}
	
	
	// Setter para posible_causa
	public function setPosibleCausa($posible_causa) {
		if (is_string($posible_causa) && strlen($posible_causa) <= 256) {
			$this->posible_causa = $posible_causa;
		} else {
			throw new InvalidArgumentException("La posible causa debe ser una cadena de texto de máximo 256 caracteres.");
		}
	}
    
    
    // Funcion para consolidar los datos en la base de datos:
	public function consolidarDatosEnSQL($cantidadMaximaDeEventosSQL = 1){
		global $virsoft;
		//$proximaEjecucion;			// X Fecha de la proxima ejecucion 
		//$estadoResultado;				// X Valores posibles:( fallo, éxito )
		//$mensajeAlerta;				// X Mensage de la alerta.
		//$nivelAlerta;					// X Nivel de alerta. Valores posibles: (información, advertencia, crítico )
		//$intentosFallidosActuales;	// X Intentos que lleva la tarea FALLIDOS de forma consecutiva.
		
		// Pasamos a entero algunas cosas, como si la tarea está negada, o si se debe registrar la IP en el log.
		$intTareaNegada = (int)$this->tareaNegada;
		$intRegistrarIp = (int)$this->registrarIp;
		
		
		$sql = "UPDATE `monitoreo` 
            SET `ultima_ejecucion` = NOW(), 
                `estado_resultado` = ? , 
                `mensaje_alerta` = ? , 
                `nivel_alerta` = ? , 
                `intentos_fallidos_actuales` = ?, 
                `proxima_ejecucion` = ?,
                `descripcion_fallo` = ?, 
				`posible_causa` = ?,
				`TareaNegada` = ?,
				`registrar_ip` = ?
				
            WHERE `monitoreo`.`id_monitoreo` = ?";
            
		$params = [
			['type' => 's', 'value' => $this->estadoResultado],          	// Estado Resultado
			['type' => 's', 'value' => $this->mensajeAlerta],               // mensaje_alerta
			['type' => 's', 'value' => $this->nivelAlerta],                 // nivel_alerta
			['type' => 'i', 'value' => $this->intentosFallidosActuales],    // intentos_fallidos_actuales
			['type' => 's', 'value' => $this->proximaEjecucion],            // proxima_ejecucion
			['type' => 's', 'value' => $this->descripcion_fallo],          	// Descripción del Fallo
			['type' => 's', 'value' => $this->posible_causa],              	// Posible Causa
			['type' => 'i', 'value' => $intTareaNegada],              		// Tarea Negada
			['type' => 'i', 'value' => $intRegistrarIp],              		// Registrar la IP
			['type' => 'i', 'value' => $this->id],                         	// ID de Monitoreo
		];
		// Incluimos las dependencias:
		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
		
		/* Pruebas:
		// Imprimir la consulta con los parámetros
		$consultaDepurada = $sql;
		foreach ($params as $param) {
			// Reemplaza los marcadores de posición por los valores de los parámetros
			$valor = $param['value'];
			if ($param['type'] === 's') {
				$valor = "'" . $valor . "'"; // Envolvemos el valor en comillas simples para cadenas
			}
			$consultaDepurada = preg_replace('/\?/', $valor, $consultaDepurada, 1);
		}

		// Imprimir la consulta depurada
		echo "Consulta depurada: " . $consultaDepurada . "\n";
		*/
		
		
		// Bien, ahora tenemos tambien que actualizar los datos en el LOG de la base de datos:
		// lo primero es obtener el ultimo resultado en el log de la base de datos. Puede que no existan aún datos....
		
		$sql ="	SELECT *  
				FROM `log` 
				WHERE `id_monitoreo` = ?  
				ORDER BY `id_log` DESC 
				LIMIT 1";
		$params = [
			['type' => 'i', 'value' => $this->id],                          // id_monitoreo
		];
		
		$ultimoRegistroLogSQL = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
		//var_dump($ultimoRegistroLogSQL);
		if( !is_array($ultimoRegistroLogSQL) ){
			// Tendremos que insertar un nuevo registro:
			$sql = "INSERT INTO `log` 
            (`id_monitoreo`, `tipo_tarea`, `estado_actual`, `cantidad_eventos`, `cantidadMaximaDeEventos`, `fecha_inicio_estado`, `motivo_estado`, `nivel_alerta`, `ultima_actualizacion`)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())";
    
			// Calculamos la fecha actual:
			$fechaActualDateTime = new DateTime();
			$fechaActualSQL = ( $fechaActualDateTime->format('Y-m-d H:i:s') );
    
			// Establecer los parámetros según los datos del objeto
			$params = [
				['type' => 'i', 'value' => $this->id],
				['type' => 's', 'value' => $this->tipoTarea],
				['type' => 's', 'value' => $this->estadoResultado],
				['type' => 'i', 'value' => 1], // Primer evento
				['type' => 'i', 'value' => $cantidadMaximaDeEventosSQL], // Este dato no procede en el tipo de prueba ping o TCP, pero si en el hijo consulta.
				['type' => 's', 'value' => $fechaActualSQL], // Inicio del estado
				['type' => 's', 'value' => $this->mensajeAlerta],
				['type' => 's', 'value' => $this->nivelAlerta]
			];

			// Ejecutar la consulta
			$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
			// y con esto tendremos un nuevo registro en el log	
			
		}else{
			// Tendremos que actualizar el actual o si a cambiado de estado, cerrar el ultimo registro actualizando la fecha final y despues crear uno nuevo con el estado actual.
			
			// En este punto tenemos que evaluar, si tenemos que actualizar el registro actual de log o cerrar el anterior con la fecha actual y crear uno nuevo.
			if( $this->mensajeAlerta == $ultimoRegistroLogSQL['motivo_estado'] && $this->nivelAlerta == $ultimoRegistroLogSQL['nivel_alerta'] ){
				// Tenemos que actualizar el estado del registro log. Este no a cambiado su naturaleza.
				
				// Nuevo estado de cantidad de eventos:
				$cantidadEventos = $ultimoRegistroLogSQL['cantidad_eventos'] + 1;
				
				// Calculamos el maximo numero de registros encontrados, para las tareas SQL:
				if((int)$ultimoRegistroLogSQL['cantidadMaximaDeEventos'] >= (int)$cantidadMaximaDeEventosSQL){
					$cantidadEventosUpdate = (int)$ultimoRegistroLogSQL['cantidadMaximaDeEventos'];
				}else{
					$cantidadEventosUpdate = (int)$cantidadMaximaDeEventosSQL;
				}
				
				$sql = "UPDATE `log` 
					SET `cantidad_eventos` = ?, 
						`cantidadMaximaDeEventos` = ?,  
						`ultima_actualizacion` = NOW()
					WHERE `id_log` = ?";
					
				$params = [
					['type' => 'i', 'value' => $cantidadEventos],
					['type' => 'i', 'value' => $cantidadEventosUpdate],
					['type' => 'i', 'value' => $ultimoRegistroLogSQL['id_log']]
				];
				
				// Ejecutar la consulta
				$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
				
				
				
			}else{
				// Tenemos que cerrar el registro de log actual y crear uno nuevo
				
				
				// Cerrar el registro de log actual
				$sqlCerrar = "UPDATE `log` 
					SET `fecha_fin_estado` = NOW(), 
						`ultima_actualizacion` = NOW()
					WHERE `id_log` = ?";

				$paramsCerrar = [
					['type' => 'i', 'value' => $ultimoRegistroLogSQL['id_log']]
				];

				// Ejecutar la consulta para cerrar el registro actual
				$virsoft->ejecutarConsultaPreparadaSimple($sqlCerrar, $paramsCerrar);
				
				
				
				
			    // Insertar un nuevo registro con el estado actualizado
				$sqlNuevo = "INSERT INTO `log` 
					(`id_monitoreo`, `tipo_tarea`, `estado_actual`, `cantidad_eventos`, `cantidadMaximaDeEventos`, `fecha_inicio_estado`, `motivo_estado`, `nivel_alerta`, `ultima_actualizacion`)
					VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, NOW())";

				// Establecer los parámetros para el nuevo registro
				$paramsNuevo = [
					['type' => 'i', 'value' => $this->id],
					['type' => 's', 'value' => $this->tipoTarea],
					['type' => 's', 'value' => $this->estadoResultado],
					['type' => 'i', 'value' => 1], // Primer evento
					['type' => 'i', 'value' => $cantidadMaximaDeEventosSQL], // Cantidad máxima de eventos
					['type' => 's', 'value' => $this->mensajeAlerta],
					['type' => 's', 'value' => $this->nivelAlerta]
				];

				// Ejecutar la consulta para insertar el nuevo registro
				$virsoft->ejecutarConsultaPreparadaSimple($sqlNuevo, $paramsNuevo);
			
			}
			
		}
		
		
	}
    

	public function eliminarTarea() {
		// Verificamos que el ID sea válido
		if (!is_numeric($this->id) || $this->id <= 0) {
			throw new InvalidArgumentException("ID de tarea no válido.");
		}

		global $virsoft;

		// Eliminamos la tarea del monitoreo
		$sql = "DELETE FROM `monitoreo` WHERE `id_monitoreo` = ? LIMIT 1;";
		$params = [
			['type' => 'i', 'value' => $this->id]
		];
		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

		// También eliminamos sus registros en el log
		$sqlLog = "DELETE FROM `log` WHERE `id_monitoreo` = ?;";
		$virsoft->ejecutarConsultaPreparadaSimple($sqlLog, $params);

		return true; // Confirmación de que se ha eliminado correctamente
	}
	
	
	public static function validarHost($host) {
		if (empty($host)) {
			return ['Estado' => false, 'Motivo' => 'El host no puede estar vacío.'];
		}

		if (strlen($host) > 255) {
			return ['Estado' => false, 'Motivo' => 'El nombre del host no puede superar los 255 caracteres.'];
		}

		if (!filter_var($host, FILTER_VALIDATE_IP) &&
			!preg_match('/^(([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9-]{1,63})$/i', $host)) {
			return ['Estado' => false, 'Motivo' => 'Se debe insertar una IP o dominio válido.'];
		}

		return ['Estado' => true]; // Todo correcto
	}
    
    
    
    /**
	 * Verifica si una o varias tareas existen en la base de datos.
	 *
	 * ✔ Si se pasa un ID (int), devuelve true o false según exista o no la tarea.
	 * ✔ Si se pasa un array de IDs, devuelve un array con los IDs que existen realmente en la base de datos.
	 * ✔ Si se pasa algo que no sea ni int ni array, devuelve null.
	 *
	 * Este método permite hacer validaciones rápidas sin necesidad de instanciar objetos Tarea,
	 * y puede ser útil como pre-filtro antes de lanzar operaciones más pesadas o consultas de eventos.
	 *
	 * @param int|array $arrayOrIntIdTareas  ID de una tarea o array de IDs
	 * @return bool|array|null  true/false si se pasa un solo ID, array de IDs válidos si se pasa array, o null si tipo inválido
	 */
	public static function existen($arrayOrIntIdTareas){ // el nombre de la variable siempre es orientativo xD
		global $virsoft;

		if( is_array($arrayOrIntIdTareas) ){
			if (empty($arrayOrIntIdTareas)) {
				return [];
			}

			$placeholders = implode(',', array_fill(0, count($arrayOrIntIdTareas), '?'));
			$sql = "SELECT id_monitoreo FROM monitoreo WHERE id_monitoreo IN ($placeholders)";
			$params = [];

			foreach ($arrayOrIntIdTareas as $id) {
				$params[] = ['type' => 'i', 'value' => (int)$id];
			}

			$resultados = $virsoft->ejecutarConsultaPreparada($sql, $params);
			$idsExistentes = [];

			if (is_array($resultados)) {
				foreach ($resultados as $fila) {
					$idsExistentes[] = (int)$fila['id_monitoreo'];
				}
			}

			return $idsExistentes;
		}elseif( is_int($arrayOrIntIdTareas) ){
			$sql = "SELECT id_monitoreo FROM monitoreo WHERE id_monitoreo = ? LIMIT 1";
			$params[] = ['type' => 'i', 'value' => (int)$arrayOrIntIdTareas]; // venga que tambien vengan string's. Aqui vale todo...
			$resultados = $virsoft->ejecutarConsultaPreparada($sql, $params);
			
			// Si Virsoft no encuentra nada y la consulta es exitosa, devuelve true. Con lo que podemos hacer...
			if ( is_array($resultados) ){
				return true;
			}
			return false;
			
		}else{
			return null;
		}
	}  
	
	
	public function getInfoTicket(): array {
		global $configuracionWeb;
		$salida = [];

		$salida['Sentinelia'] = [
			'tipo' => 'TiketSupport',
			'version' => $configuracionWeb -> getVersionSentinelia(),
		];
		
		$salida['id_tarea']       = $this->getId();
		$salida['nombre_tarea']   = $this->getNombreServicio();
		$salida['estado']         = $this->getEstadoResultado();
		$salida['hora']           = $this->getUltimaEjecucion();
		$salida['descripcion']    = $this->getDescripcionFallo();
		$salida['motivo']         = $this->getPosibleCausa();

		// Identificacion de QUIEN envió el tiket:
		global $usuario;
		$salida['usuario'] = [
			'nombre'    => $usuario->getNombre(),
			'apellidos' => $usuario->getApellidos(),
			'email'     => $usuario->getEmail(),
			'telefono' 	=> $usuario->getTelefono()
		];
		
		// Identificamos la Instancia de Sentinelia:
		global $configuracionWeb;
		$salida['InfoSentinelia'] = [
			'NombreServidor'	=> $configuracionWeb->getInfoNombreServidor(),
			'NombreEmpresa'		=> $configuracionWeb->getInfoNombreEmpresa(),
			'Pais'				=> $configuracionWeb->getInfoPais(),
			'Poblacion'			=> $configuracionWeb->getInfoPoblacion(),
			'DataCenter'		=> $configuracionWeb->getInfoDataCenter(),
			'ArmarioRack'		=> $configuracionWeb->getInfoArmarioRack()
		];
		
		
		// Buscamos la ultima semana en registros de la tarea:
		$sql ='
			SELECT *
			FROM log
			WHERE id_monitoreo = ?
			  AND fecha_inicio_estado >= (
				SELECT MAX(fecha_inicio_estado)
				FROM log
				WHERE id_monitoreo = ?
				  AND fecha_inicio_estado < NOW() - INTERVAL 7 DAY
			  )
			ORDER BY fecha_inicio_estado
		
		';
		$params =[
			['type' => 'i', 'value' => $salida['id_tarea']],          	// ID Tarea
			['type' => 'i', 'value' => $salida['id_tarea']]          	// ID Tarea
		];
		
		global $virsoft;
		$resultadoSQL = $virsoft->ejecutarConsultaPreparada($sql, $params);
		
		if( is_array($resultadoSQL) ){
			$salida['lastWeekLog'] = $resultadoSQL;
		}else{
			$salida['lastWeekLog'] = [];
		}

		return $salida;
	}
	
}

?>
