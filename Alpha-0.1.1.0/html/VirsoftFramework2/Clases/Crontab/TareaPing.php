<?php
// Seguridad Basica:
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class TareaPing extends Tarea {
	
	// Variables funcionales para el tipo de tarea:
    private $url;

	public function __construct($tarea) {
		parent::__construct($tarea);

		$this->tipoTarea = 'ping';

		// Obtener la URL del servicio
		$this->url = $tarea['url_servicio'] ?? '';

		// Validación del host utilizando el método centralizado
		$validacionHost = Tarea::validarHost($this->url);
		if (!$validacionHost['Estado']) {
			throw new InvalidArgumentException($validacionHost['Motivo']);
		}
	}

	public function ejecutar() {
		$output = [];
		$result = null;

		// 🔹 Obtener la IP real del host antes del ping
		$ipActual = gethostbyname($this->url);

		// Ejecutamos el ping usando shell
		exec("ping -c 1 {$this->url} 2>&1", $output, $result);

		// Convertir el array de salida a un string para registro (si lo necesitas en debug)
		$outputString = implode("\n", $output);
		
		// 🔹 Si la tarea está negada, invertimos la lógica
		if ($this->tareaNegada) {
			$result = ($result === 0) ? 1 : 0; // Invertimos el resultado
		}

		if ($result === 0) {
			// ✅ 
			if ($this->tareaNegada) {
				$mensajeEstadoMonitor = "Ping fallido";
			} else {
				$mensajeEstadoMonitor = "Ping exitoso";
			}

			// 🔹 Si hay que registrar la IP, la agregamos al mensaje
			if ($this->registrarIp) {
				$mensajeEstadoMonitor .= " en {$this->url} ({$ipActual})";
			}

			$this->registrarResultado('éxito', $mensajeEstadoMonitor, 'información', 0);

		} else {
			// ✅ Ping fallido, aumentar intentos
			$contadorIntentos = $this->intentosFallidosActuales + 1;
			$this->setIntentosFallidosActuales($contadorIntentos);

			if ($this->tareaNegada) {
				$mensajeFallo = ($contadorIntentos >= $this->intentosPermitidos)
					? "Se detectó Ping. Superado el número de intentos."
					: "Se detectó Ping.";
			} else {
				$mensajeFallo = ($contadorIntentos >= $this->intentosPermitidos)
					? "Ping fallido. Superado el número de intentos."
					: "Ping fallido.";
			}

			// 🔹 Si hay que registrar la IP, la agregamos al mensaje
			if ($this->registrarIp) {
				$mensajeFallo .= " en {$this->url} ({$ipActual})";
			}

			// 🔹 Determinar estado de la tarea y nivel de alerta
			if ($contadorIntentos >= $this->intentosPermitidos) {
				$estadoTarea = 'fallo';
				$nivelAlerta = 'crítico';
			} else {
				$estadoTarea = 'fallo';
				$nivelAlerta = 'advertencia';
			}

			// ✅ Registrar resultado
			$this->registrarResultado($estadoTarea, $mensajeFallo, $nivelAlerta, $contadorIntentos);
		}

		// 🔹 Actualizar la próxima ejecución y consolidar en la base de datos
		$this->actualizarProximaEjecucion();
		$this->consolidarDatosEnSQL();
	}


    
    public function getURL(): string { 
        return $this->url; // Retorna el valor de la propiedad
    }
    
    
    // Funciones estaticas sin instanciar
    
    // Uldate o createNew
    public static function editarCrear($post) {
		// Dependencias
		global $virsoft;
		
		// Lo primero es lo primero....
		if (!isset($post['csrf_token']) || !hash_equals($virsoft->getTokenCSRG(), $post['csrf_token'])) {
			throw new Exception('Token CSRF no válido o ausente');
		}
		
		// Variables de salida. Podemos editar solo una hacer un return $salidaDatos;
		$salidaDatos['Estado'] = false;
		$salidaDatos['Motivo'] = '';
		
		// Vamos a sanear los datos: urlServicio, intervalo, intentosPermitidos
		
		// Verificamos el nombre de la tarea:
		 if (empty($post['nombreServicio'])) {
			$salidaDatos['Motivo'] .= 'El nombre del monitor no puede estar vacío. <br>';
		}
		if (strlen($post['nombreServicio']) > 255) {
			$salidaDatos['Motivo'] .= 'El nombre del monitor no puede tener más de 255 caracteres. <br>';
		}
		
		
		// Verificacion de URL
		$validacionHost = Tarea::validarHost($post['urlServicio']);
		if (!$validacionHost['Estado']) {
			$salidaDatos['Motivo'] .= $validacionHost['Motivo']. ' <br>';
		}

		
		// Verificacion de intervalo.
		if (preg_match('/^\d+$/', $post['intervalo']) !== 1){
			$salidaDatos['Motivo'] .= 'El numero de minutos en el intervalo de tiempo debe ser un numero entero.';
		}
		
		if ( $post['intervalo'] > 4294967295 OR $post['intervalo'] < 1 ){
			$salidaDatos['Motivo'] .= 'El numero de minutos en el intervalo de tiempo debe estar entre 1 y 4294967295. <br>';
		}
		
		
		// verificacion de intentos permitidos:
		if (preg_match('/^\d+$/', $post['intentosPermitidos']) !== 1){
			$salidaDatos['Motivo'] .= 'El numero de intentos permitidos no puede ser 0. <br>';
		}
		
		if ( $post['intentosPermitidos'] < 1 OR $post['intentosPermitidos'] > 4294967295){
			$salidaDatos['Motivo'] .= 'El numero de intentos permitidos debe debe estar entre 1 y 4294967295. <br>';
		}
		
		if ( $salidaDatos['Motivo'] != '' ) { return $salidaDatos; }
		
		
		
		
		
		
		
		// Validación de descripción y posible causa
		$descripcionFallo = isset($post['descripcion_fallo']) ? substr(trim($post['descripcion_fallo']), 0, 255) : '';
		$posibleCausa = isset($post['posible_causa']) ? substr(trim($post['posible_causa']), 0, 255) : '';
		
		
		// Ahora calculamos datos que nos serán necesarios en las consultas:

		// Tarea Habilitada ?
		$habilitadaOut = 0;
		if (isset($post['habilitada'])) { $habilitadaOut = 1; }
		
		
		//  Tarea Negada ?
		$tareaNegadaSQL = 0;
		if (isset( $post['tareaNegada'] )){ $tareaNegadaSQL = 1; }
		
		
		// Definimos el entero para Registrar o no la IP en el LOG.
		$registrarIpSQL = 0;
		if ( isset( $post['registrarIp'] ) ){ $registrarIpSQL = 1; }
	
		
		// Ahora tenemos que evaluar es si es una tarea nueva o un update
		$idTarea = (int)$post['idTarea'];
		
		
		if( $idTarea === 0 ){
			//Tarea nueva
			
			$sql = '
				INSERT INTO `monitoreo` (
					`nombre_servicio`,                 	-- no predeterminada		-> es obligatorio
					`url_servicio`,                    	-- no predeterminada		-> es obligatorio
					`tipo_prueba`,                     	-- no predeterminada		-> es obligatorio
					`intervalo_minutos`,               	-- no predeterminada		-> es obligatorio
					`estado_resultado`,                	-- enum(éxito, fallo)		-> es obligatorio -> éxito
					`mensaje_alerta`,                  	-- mensaje obligatorio		-> "Tarea recién creada"
					`nivel_alerta`,                    	-- Predeterminado NULL		-> es obligatorio
					`hora_alerta`,                     	-- hora del último cambio	-> es obligatorio
					`intentos_permitidos`,             	-- 3						-> es obligatorio
					`intentos_fallidos_actuales`,      	-- 0						-> es obligatorio
					`TareaHabilitada`,                  -- 1						-> es obligatorio
					`ultima_ejecucion`,
					`descripcion_fallo`, 				-- varchar 255				-> es obligatorio
					`posible_causa`,					-- varchar 255				-> es obligatorio
					`TareaNegada`,						-- tinyint(1)				-> opcional. Predeterminado = 0
					`registrar_ip`						-- tinyint (1)				-> opcional. Predeterminado = 0
				) VALUES (
					?,					            	-- nombre_servicio
					?,			                       	-- url_servicio
					\'ping\',                          	-- tipo_prueba
					?,                             		-- intervalo_minutos
					\'éxito\',                         	-- estado_resultado
					\'Tarea recién creada.\',          	-- mensaje_alerta
					\'información\',                   	-- nivel_alerta
					current_timestamp(),               	-- hora_alerta
					?,                              	-- intentos_permitidos
					\'0\',                             	-- intentos_fallidos_actuales
					?,	                              	-- TareaHabilitada
					current_timestamp(),
					?,									-- Descripcion fallo
					?,									-- posible causa
					?,									-- Tarea Negada
					?									-- Registrar direcciones IP en el LOG
				);
			';


			$params = [
				['type' => 's', 'value' => trim($post['nombreServicio'])], 	// Nombre del Servicio
				['type' => 's', 'value' => trim($post['urlServicio'])], 	//
				['type' => 'i', 'value' => $post['intervalo']], 			//
				['type' => 'i', 'value' => $post['intentosPermitidos']], 	//
				['type' => 'i', 'value' => $habilitadaOut], 				//
				['type' => 's', 'value' => trim($descripcionFallo)], 		//
				['type' => 's', 'value' => trim($posibleCausa)], 			//
				['type' => 'i', 'value' => $tareaNegadaSQL], 				//
				['type' => 'i', 'value' => $registrarIpSQL], 				// Registrar IP en el LOG
				
			];

			
		}else{
			// Update de tarea existente
			$sql = '
				UPDATE `monitoreo`
				SET 
					`nombre_servicio` = ?,							-- nombre del servicio actualizado
					`url_servicio` = ?,								-- URL del servicio actualizada
					`intervalo_minutos` = ?,						-- intervalo de ejecución actualizado
					`estado_resultado` = \'éxito\',					-- el estado será éxito (lo mantenemos igual)
					`mensaje_alerta` = \'Tarea actualizada.\',		-- mensaje de alerta actualizado
					`nivel_alerta` = \'información\',				-- nivel de alerta actualizado
					`hora_alerta` = current_timestamp(),			-- hora del último cambio actualizada
					`intentos_permitidos` = ?,						-- intentos permitidos actualizados
					`intentos_fallidos_actuales` = 0,				-- reseteamos intentos fallidos a 0
					`TareaHabilitada` = ?,							-- tarea habilitada o deshabilitada
					`ultima_ejecucion` = current_timestamp(),		-- última ejecución actualizada
					`descripcion_fallo` = ?, 						-- Descripcion del fallo
					`posible_causa` = ?,							-- Posible causa
					`TareaNegada` = ?,								-- Logica de la tarea Negada.
					`registrar_ip` = ?								-- Registar IP en el log? (INT 1)
					
					
				WHERE 
					`id_monitoreo` = ?								-- actualizamos la tarea con este ID
			';


			$params = [
				['type' => 's', 'value' => $post['nombreServicio']], 			// Actualizamos nombre_servicio
				['type' => 's', 'value' => $post['urlServicio']],    			// Actualizamos url_servicio
				['type' => 'i', 'value' => $post['intervalo']],      			// Actualizamos intervalo_minutos
				['type' => 'i', 'value' => $post['intentosPermitidos']], 		// Actualizamos intentos_permitidos
				['type' => 'i', 'value' => $habilitadaOut],          			// Actualizamos TareaHabilitada
				['type' => 's', 'value' => $descripcionFallo], 					// Actualizamos la descripcion del fallo
				['type' => 's', 'value' => $posibleCausa], 						// Actualizamos la posible causa
				['type' => 'i', 'value' => $tareaNegadaSQL],          			// Actualizamos TareaNegada
				['type' => 'i', 'value' => $registrarIpSQL],          			// Actualizamos si se muestra o no la IP en el LOG
				
				['type' => 'i', 'value' => $post['idTarea']],                	// ID de la tarea a actualizar
				
				
			];
		}

		// Finalmente ejecutamos la tarea SQL. Obteniendo el valor de exito de la consulta:
		
		$salidaDatos['Estado'] = $virsoft -> ejecutarConsultaPreparadaSimple($sql, $params);
		if (!$salidaDatos['Estado']){ $salidaDatos['Motivo'] = 'Fallo en consulta SQL al insertar o actualizar datos de la Tarea.'; }
		
		//var_dump($salidaDatos);
		//die('modo debug');
		
		return $salidaDatos;
    }
    
    
    
}

?>
