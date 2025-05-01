<?php

class logEventS {

    protected ?DateTime $fechaInicio;
    protected ?DateTime $fechaFin;
    protected ?array $idTareas = [];
    protected ?string $tipoTarea;
    protected ?array $nivelesAlerta;
    protected ?string $estado;
    protected int $limite;
    protected string $ordenCampo;
    protected string $ordenDireccion;
    protected bool $precargarTareas;

    protected array $eventos = [];
    protected array $cacheTareas = []; // Cache interno por ID

    public function __construct(
        $fechaInicio = null,
        $fechaFin = null,
        ?array $tareas = null, // Array con int ID de tareas o array con objetos Tarea....
        ?string $tipoTarea = null,
        ?array $nivelesAlerta = null,
        ?string $estado = null,
        int $limite = 1000,
        string $ordenCampo = 'fecha_inicio_estado',
        string $ordenDireccion = 'DESC',
        bool $precargarTareas = false
    ) {
		$this->fechaInicio = $fechaInicio instanceof DateTime
			? $fechaInicio
			: ($fechaInicio ? new DateTime($fechaInicio) : (new DateTime())->modify('-7 days'));

		$this->fechaFin = $fechaFin instanceof DateTime
			? $fechaFin
			: ($fechaFin ? new DateTime($fechaFin) : new DateTime());
    
				
        //$this->idTareas = $idTareas;

		if (is_array($tareas)) {
			foreach ($tareas as $entrada) {
				if (is_object($entrada) && method_exists($entrada, 'getId')) {
					$id = $entrada->getId();

					if (is_int($id) && $id > 0) {
						$this->idTareas[] = $id;
						$this->cacheTareas[$id] = $entrada;
					}
				} else {
					$id = intval($entrada);
					$this->idTareas[] = $id;
				}
			}

			// Eliminar duplicados
			$this->idTareas = array_unique($this->idTareas);
		} else {
			$this->idTareas = null;
		}    
    
    
        $this->tipoTarea = $tipoTarea;
        $this->nivelesAlerta = $nivelesAlerta;
        $this->estado = $estado;
        $this->limite = $limite;
        $this->ordenCampo = $ordenCampo;
        $this->ordenDireccion = strtoupper($ordenDireccion) === 'ASC' ? 'ASC' : 'DESC';
        $this->precargarTareas = $precargarTareas;

        $this->cargarEventosDesdeBaseDeDatos();
    }

    protected function cargarEventosDesdeBaseDeDatos() {
        global $virsoft;

        $sql = "SELECT * FROM log WHERE 1=1";
        $params = [];

        if ($this->fechaInicio) {
            $sql .= " AND fecha_inicio_estado >= ?";
            $params[] = ['type' => 's', 'value' => $this->fechaInicio->format('Y-m-d H:i:s')];
        }

        if ($this->fechaFin) {
            $sql .= " AND fecha_inicio_estado <= ?";
            $params[] = ['type' => 's', 'value' => $this->fechaFin->format('Y-m-d H:i:s')];
        }

        if (is_array($this->idTareas) && count($this->idTareas) > 0) {
            $placeholders = implode(',', array_fill(0, count($this->idTareas), '?'));
            $sql .= " AND id_monitoreo IN ($placeholders)";
            foreach ($this->idTareas as $id) {
                $params[] = ['type' => 'i', 'value' => (int)$id];
            }
        }

        if ($this->tipoTarea) {
            $sql .= " AND tipo_tarea = ?";
            $params[] = ['type' => 's', 'value' => $this->tipoTarea];
        }

        if (is_array($this->nivelesAlerta) && count($this->nivelesAlerta) > 0) {
            $placeholders = implode(',', array_fill(0, count($this->nivelesAlerta), '?'));
            $sql .= " AND nivel_alerta IN ($placeholders)";
            foreach ($this->nivelesAlerta as $nivel) {
                $params[] = ['type' => 's', 'value' => $nivel];
            }
        }

        if ($this->estado) {
            $sql .= " AND estado_actual = ?";
            $params[] = ['type' => 's', 'value' => $this->estado];
        }

        $sql .= " ORDER BY {$this->ordenCampo} {$this->ordenDireccion} LIMIT ?";
        $params[] = ['type' => 'i', 'value' => $this->limite];

        $resultados = $virsoft->ejecutarConsultaPreparada($sql, $params);

		if ( is_array($resultados) ){
			foreach ($resultados as $fila) {
				$idTarea = (int)$fila['id_monitoreo'];
				$tarea = null;

				// LazyCache por ID incluso sin precarga inicial
				if (isset($this->cacheTareas[$idTarea])) {
					$tarea = $this->cacheTareas[$idTarea];
				} else {
					$sqlTarea = "SELECT * FROM monitoreo WHERE id_monitoreo = ? LIMIT 1";
					$paramsTarea = [['type' => 'i', 'value' => $idTarea]];
					$filaTarea = $virsoft->ejecutarConsultaPreparadaSimple($sqlTarea, $paramsTarea);
					if ($filaTarea) {
						$tarea = new Tarea($filaTarea);
						$this->cacheTareas[$idTarea] = $tarea;
					}
				}

				$evento = new logEvent($fila, $tarea);
				$this->eventos[] = $evento;
			}
		}
    }

	public function getDatosParaGrafico(): array
	{
		$rangoInicio = $this->fechaInicio ? $this->fechaInicio->format('Y-m-d\TH:i:s\Z') : null;
		$rangoFin    = $this->fechaFin    ? $this->fechaFin->format('Y-m-d\TH:i:s\Z') : null;

		$datos = [
			'rango' => [
				'inicio' => $rangoInicio,
				'fin'    => $rangoFin
			],
			'tareas' => []
		];

		// Agrupar eventos por idTarea
		$eventosPorTarea = [];
		foreach ($this->eventos as $evento) {
			$idTarea = $evento->getIdTarea();
			$eventosPorTarea[$idTarea][] = $evento;
		}

		foreach ($this->idTareas as $idTarea) {
			$eventos = $eventosPorTarea[$idTarea] ?? [];
			usort($eventos, fn($a, $b) => $a->getFechaInicio() <=> $b->getFechaInicio());

			$eventoAnterior  = $this->getEventoAnteriorAlFiltro($idTarea);
			$eventoPosterior = $this->getEventoPosteriorAlFiltro($idTarea);

			$estadoInicio = $eventoAnterior ? $eventoAnterior->getNivelAlerta() : null;
			//$estadoFin    = $eventoPosterior ? $eventoPosterior->getNivelAlerta() : null;
			$estadoFin    = !empty($eventos) ? end($eventos)->getNivelAlerta() : null;
			if (is_null($estadoFin)){
				$estadoFin    = $eventoPosterior ? $eventoPosterior->getNivelAlerta() : null;
			}

			if (!$estadoFin && !empty($eventos)) {
				$estadoFin = end($eventos)->getNivelAlerta();
			}

			$eventosFormateados = [];
			$tarea = !empty($eventos) ? $eventos[0]->getTarea() : new Tarea($idTarea);
			$dateTimeCreaccionTarea = $tarea->getFechaCreaccionTarea();
			$dtRangoInicio = new DateTime($rangoInicio);

			if ($estadoInicio !== null) {
				if ($dateTimeCreaccionTarea < $dtRangoInicio) {
					$eventosFormateados[] = [
						'timestamp' => $rangoInicio,
						'estado'    => $estadoInicio,
						'motivo'    => 'Estado anterior antes del primer evento'
					];
				} elseif (!empty($eventos) && $dateTimeCreaccionTarea < $eventos[0]->getFechaInicio()) {
					$eventosFormateados[] = [
						'timestamp' => $dateTimeCreaccionTarea->format('Y-m-d\TH:i:s\Z'),
						'estado'    => $estadoInicio,
						'motivo'    => 'Creación de la Tarea / Monitor'
					];
				}
			}

			foreach ($eventos as $e) {
				$eventosFormateados[] = [
					'timestamp' => $e->getFechaInicio()->format('Y-m-d\TH:i:s\Z'),
					'estado'    => $e->getNivelAlerta(),
					'motivo'    => $e->getMotivo()
				];
			}



			// <-- Añadir punto virtual de estadoFin o proyección futura
			
			if ($estadoFin !== null) {
				$now = new DateTime('now', new DateTimeZone('UTC'));
				$timestampFin = ($this->fechaFin > $now) ? $now->format('Y-m-d\TH:i:s\Z') : $rangoFin;

				$eventosFormateados[] = [
					'timestamp' => $timestampFin,
					'estado'    => $estadoFin,
					'motivo'    => ($this->fechaFin > $now)
									? 'Sin cambios, hasta el momento actual.'
									: 'Sin cambios, hasta este momento.'
				];
			} elseif (!empty($eventos)) {
				// Si no hay eventoPosterior ni estadoFin inferido, mantenemos el último evento real hasta el rangoFin
				$ultimoEvento = end($eventos);
				$estadoFin = $ultimoEvento->getNivelAlerta();
				$eventosFormateados[] = [
					'timestamp' => $rangoFin,
					'estado'    => end($eventosFormateados)['estado'],
					'motivo'    => 'Estado final mantenido.'
				];
			}else{ // Aqui, $eventos seria null 
				$eventosFormateados[] = [
					'timestamp' => $rangoFin,
					'estado'    => end($eventosFormateados)['estado'],
					'motivo'    => 'Estado final mantenido.'
					];
			}




			$datos['tareas'][$idTarea] = [
				'estadoInicio' => $estadoInicio,
				'estadoFin'    => $estadoFin,
				'eventos'      => $eventosFormateados,
				'nombreTarea'  => $tarea->getNombreServicio()
			];
		}

		return $datos;
	}

	public function getEventoAnteriorAlFiltro($idTarea){ // puede devolver null o un objeto logEvent
		global $virsoft;
		$sql = "SELECT * FROM log WHERE id_monitoreo = ? AND fecha_inicio_estado < ? ORDER BY fecha_inicio_estado DESC LIMIT 1";
		$params = [
			['type' => 'i', 'value' => $idTarea],
			['type' => 's', 'value' => $this->fechaInicio->format('Y-m-d H:i:s')]
		];
		$resultado = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

		if (is_array($resultado)) {
			return new logEvent($resultado);
		}

		return null;
	}

	public function getEventoPosteriorAlFiltro($idTarea){ // puede devolver null o un objeto logEvent
		global $virsoft;
		$sql = "SELECT * FROM log WHERE id_monitoreo = ? AND fecha_inicio_estado > ? ORDER BY fecha_inicio_estado ASC LIMIT 1";
		$params = [$idTarea, $this->fechaFin->format('Y-m-d H:i:s')];
		$params = [
			['type' => 'i', 'value' => $idTarea],
			['type' => 's', 'value' => $this->fechaFin->format('Y-m-d H:i:s')]
		];
		$resultado = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

		if (is_array($resultado)) {
			return new logEvent($resultado);
		}

		return null;
	}

	public function getEventos(): array {
		return $this->eventos;
	}
    
	public function getFechaInicio(){
		return $this->fechaInicio;
	}
	
	public function getFechaFin(){
		return $this->fechaFin;
	}
	
	
	
	
}


?>
