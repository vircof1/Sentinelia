<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


class logEvent {

    protected $id;              			// ID del log
    protected $idTarea;         			// ID de la Tarea Asociada
    protected $tarea = null;    			// Instancia de la Tarea (lazy loading)

    protected $tipoTarea;					// Tipo de tarea: ping, tcp, etc
    protected $estadoActual;				// éxito, fallo
    protected $cantidadEventos;				// eso, cantidad de eventos. BigInt, unsigned
    protected $cantidadMaxima;				// solo valido para tareas SQL. Cantidad maxima de filas encontradas o mínimas, si se invirtio la logica
    protected $fechaInicio;					// Fecha en la que inicio Este evento
    protected $fechaFin;					// SI procede, fecha final del evento. Puede se null en la Base de datos y aqui.
    protected $motivo;						// String con el motivo del evento
    protected $nivelAlerta;					// Nivel de alerta. Por ahora es un string con el nivel de alerta. Aunque esto debe cambiar con el modulo de language
    protected $ultimaActualizacion;			// Ultima vez que el proceso asincrono interactuó con esta tarea. (Existe un campo llamado "intervalo minutos")


    /*
    =====================================================
    Constructor de logEvent: comportamiento dinámico
    =====================================================

    Permite construir el objeto de forma flexible, según el contexto:

    - Caso 1: Se pasa una FILA SQL completa (array asociativo)
        → El constructor asigna directamente los valores, sin hacer consultas.
        → Esto es útil cuando ya se ha hecho un SELECT masivo y no se quiere penalizar con consultas redundantes.
        → Ejemplo:
            $fila = [ 'id_log' => 9, 'id_monitoreo' => 3, ... ];
            $evento = new logEvent($fila);

    - Caso 2: Se pasa un ID de log (entero)
        → El constructor hará una consulta SELECT para obtener los datos desde la tabla `log`.
        → Es útil cuando solo se quiere instanciar un único evento aislado.
        → Ejemplo:
            $evento = new logEvent(9);

    - Parámetro adicional opcional: $tarea
        → Si ya se dispone de una instancia de la tarea asociada, se puede inyectar directamente.
        → Evita que logEvent haga más consultas al llamar a getTarea().
        → Ejemplo:
            $evento = new logEvent($fila, $tareaPrecargada);

    NOTA: Si se quiere máxima eficiencia en consultas masivas, se recomienda:
    - Precargar todas las filas `log` desde SQL.
    - Precargar todas las tareas necesarias agrupadas por ID.
    - Construir los objetos logEvent pasando tanto $fila como $tarea.

    Esto permite evitar el clásico problema N+1 (muchos SELECTs innecesarios) cuando se trabaja con cientos o miles de eventos.
    */


	public function __construct($rowOrInt, $tarea = null) {
		global $virsoft;

		if (is_array($rowOrInt)) {
			$this->id = (int)$rowOrInt['id_log'];
			// Cargamos datos del objeto, desde los parametros
			$this->asignarCamposDesdeFila($rowOrInt);
		} elseif ((int)$rowOrInt > 0) {
			$this->id = (int)$rowOrInt;
			if ($this->id === 0) {
				throw new Exception("Evento log no válido. ID: 0");
			}

			$sql = 'SELECT * FROM log WHERE id_log = ? LIMIT 1';
			$params = [['type' => 'i', 'value' => $this->id]];
			$fila = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

			if (!is_array($fila) || empty($fila)) {
				throw new Exception("Evento log no encontrado con ID: {$this->id}");
			}
			// Cargamos datos del objeto, desde la base de datos.
			$this->asignarCamposDesdeFila($fila);
		} else {
			throw new InvalidArgumentException("Constructor de logEvent espera ID (int) o fila SQL (array)");
		}

		if ($tarea !== null) {
			$this->tarea = $tarea;
		}
	}

	protected function asignarCamposDesdeFila(array $fila): void {
		$this->idTarea             = (int)    $fila['id_monitoreo'];
		$this->tipoTarea           = strtolower(trim((string)$fila['tipo_tarea']));
		$this->estadoActual        = strtolower(trim((string)$fila['estado_actual']));
		$this->cantidadEventos     = (int)    $fila['cantidad_eventos'];
		$this->cantidadMaxima      = (int)    $fila['cantidadMaximaDeEventos'];
		$this->fechaInicio         = $this->parseFechaUTC($fila['fecha_inicio_estado']);
		$this->fechaFin            = $this->parseFechaUTC($fila['fecha_fin_estado']);
		$this->ultimaActualizacion = $this->parseFechaUTC($fila['ultima_actualizacion']);
		$this->motivo              = (string) $fila['motivo_estado'];
		$this->nivelAlerta         = trim($fila['nivel_alerta'] ?? '') ?: 'información';
	}


    // Getters básicos
    public function getId()                 { return $this->id; }
    public function getIdTarea()            { return $this->idTarea; }
    public function getTipoTarea()          { return $this->tipoTarea; }
    public function getEstadoActual()       { return $this->estadoActual; }
    public function getCantidadEventos()    { return $this->cantidadEventos; }
    public function getCantidadMaxima()     { return $this->cantidadMaxima; }
    public function getFechaInicio()        { return $this->fechaInicio; }
    public function getFechaFin()           { return $this->fechaFin; }
    public function getMotivo()             { return $this->motivo; }
    public function getNivelAlerta()        { return $this->nivelAlerta; }
    public function getUltimaActualizacion(){ return $this->ultimaActualizacion; }
    
    
	public function getFechaInicioTexto(): string {
		return $this->fechaInicio?->format('Y-m-d H:i:s') ?? '';
	}

	public function getUltimaActualizacionTexto(): string {
		return $this->ultimaActualizacion?->format('Y-m-d H:i:s') ?? '';
	}
	
	 public function getFechaFinTexto():string {
		if ( !is_null( $this->fechaFin ) ){
			return $this->fechaFin?->format('Y-m-d H:i:s') ?? '';
		}else{
			return 'Fecha aún definida';			//language!!!
		}
		
	}

	

    
	/*
	======================
	Ejemplos de uso: clase LogEvent
	======================

	$evento = new logEvent(9);  // Cargamos el evento de log con ID 9

	// Acceder a los campos del evento:
	$evento->getId();                     // ID del log
	$evento->getFechaInicio();           // Fecha de inicio del estado
	$evento->getFechaFin();              // Fecha de fin del estado (puede ser null si sigue abierto)
	$evento->getEstadoActual();          // Estado textual (ej. éxito, fallo)
	$evento->getEstadoNumerico();        // Estado como valor numérico (1=éxito, 0=fallo, 0.5=advertencia)
	$evento->getCantidadEventos();       // Nº de veces repetido el mismo estado
	$evento->getCantidadMaxima();        // Máximo encontrado (en tareas SQL)
	$evento->getNivelAlerta();           // Nivel de alerta (información, advertencia, crítico)
	$evento->getMotivo();                // Texto del motivo asociado
	$evento->getTooltip();               // Texto resumen útil para tooltips en gráficos
	$evento->getUltimaActualizacion();  // Última vez que esta tarea fue tocada por el proceso

	// Acceso a la tarea asociada al evento:
	$tarea = $evento->getTarea();        // Instancia real de la tarea según tipo

	// Desde aquí ya puedes acceder a la información general de la tarea:
	$tarea->getNombreServicio();         // Nombre del servicio o tarea
	$tarea->getTipoTarea();              // Tipo (ping, sql, tcp, etc.)
	$tarea->getDescripcionFallo();       // Descripción habitual del fallo
	$tarea->getPosibleCausa();           // Posible causa documentada
	$tarea->getIntervaloMinutos();       // Frecuencia prevista
	$tarea->getHabilitada();             // true/false
	$tarea->getTareaNegada();            // true/false
	$tarea->getRegistrarIp();            // true/false

	// Todo esto permite construir dashboards, tooltips, gráficas o sistemas de diagnóstico fácilmente,
	// sin tener que hacer más queries. Todo ya se accede desde el objeto $evento.
	*/
    
    
    public function getNombreTarea(){
		$tarea = $this -> getTarea();
		return $tarea -> getNombreServicio();
	}
	
	
    

    // Lazy load: Instancia de la tarea, si procede:
	public function getTarea() {
		if ($this->tarea === null) {
			global $virsoft;

			$sql = 'SELECT * FROM monitoreo WHERE id_monitoreo = ? LIMIT 1';
			$params = [
				['type' => 'i', 'value' => $this->idTarea]
			];
			$fila = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

			if (!is_array($fila) || empty($fila)) {
				throw new Exception("Tarea no encontrada para ID {$this->idTarea}");
			}

			$tipo = strtolower(trim($fila['tipo_tarea'] ?? ''));

			switch ($tipo) {
				case 'ping':  $this->tarea = new TareaPing($fila); break;
				case 'tcp':   $this->tarea = new TareaTCP($fila); break;
				case 'sql':   $this->tarea = new TareaSQL($fila); break;
				default:      $this->tarea = new Tarea($fila); // fallback
			}
		}

		return $this->tarea;
	}

    
    
    protected function parseFechaUTC($valor): ?DateTime {
		if (is_null($valor)) {
			return null;
		}

		try {
			return new DateTime($valor, new DateTimeZone('UTC'));
		} catch (Exception $e) {
			// Si lo deseas, puedes registrar el error o dejar que falle silenciosamente
			return null;
		}
	}

    // Traducción del estado a valor numérico
    public function getEstadoNumerico() {
        switch (strtolower($this->estadoActual)) {
            case 'fallo': return 0;
            case 'advertencia': return 0.5;
            case 'éxito':
            case 'exito': return 1;
            default: return null;
        }
    }

    // Tooltip para gráficos
    public function getTooltip() {
        $label = "{$this->estadoActual}";
        if ($this->nivelAlerta && strtolower($this->nivelAlerta) !== 'información') {
            $label .= " ({$this->nivelAlerta})";
        }
        return $label;
    }
}

?>
