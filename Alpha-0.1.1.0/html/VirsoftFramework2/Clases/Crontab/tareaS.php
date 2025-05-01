<?php

class TareaS {
    private $todasLasTareasSQL = [];

    // Constructor
    public function __construct( $enabled = true ) {
        $this->cargarTareas( $enabled ); // Cargar las tareas al instanciar la clase
    }

    protected function cargarTareas( $enabled ) {
        // Dependencias:
        global $virsoft;

		if ( $enabled ){
			// Consulta que obtiene todas las tareas habilitadas.
			$sql = "SELECT * FROM monitoreo WHERE TareaHabilitada = ?"; 
			$params = [['type' => 'i', 'value' => 1]]; // Pasamos un parámetro para cumplir con el requerimiento de la consulta
        }else{
			// Consulta que obtiene todas las tareas
			$sql = "SELECT * FROM monitoreo WHERE 1 = ?"; 
			$params = [['type' => 'i', 'value' => 1]]; // Pasamos un parámetro para cumplir con el requerimiento de la consulta
		}
        $tareaS_SQL = $virsoft->ejecutarConsultaPreparada($sql, $params);
        
        if (is_array($tareaS_SQL)) {
            // Almacena las tareas SQL si la consulta devuelve un array
            $this->todasLasTareasSQL = $tareaS_SQL;
        } else {
            // Si no se obtiene un array, inicializa el array como vacío
            $this->todasLasTareasSQL = [];
        }
    }

    public function getTareas() {
        // Instanciar tareas a partir de los resultados SQL
        $tareas = [];
        foreach ($this->todasLasTareasSQL as $tareaSQL) {
            switch ($tareaSQL['tipo_prueba']) {
                case 'ping':
                    $tareas[] = new TareaPing($tareaSQL);
                    break;
                
                // Tipos de tareas en construccion... aun no implementados...
                    
                case 'tcp':
                    $tareas[] = new TareaTCP($tareaSQL);
                    break;
                //case 'consulta':
                //    $tareas[] = new TareaSQL($tareaSQL);
                //    break;
            }
        }
        return $tareas;
    }

	public function getTareasFallidas($nivelAlerta = 'all') {
		// Definimos el array de salida
		$tareasFallidas = [];
		// Obtener todas las tareas instanciadas
		$tareas = $this->getTareas();
		
		// Filtrar tareas fallidas
		foreach ($tareas as $tarea) {
			// Verificar si la tarea falló
			if ($tarea->getEstadoResultado() == 'fallo') {
				// Si se especifica un nivel de alerta
				if ($nivelAlerta !== 'all') {
					// Filtrar por nivel de alerta
					if ($tarea->getNivelAlerta() === $nivelAlerta) {
						$tareasFallidas[] = $tarea;
					}
				} else {
					// Agregar la tarea fallida si no se especifica nivel de alerta
					$tareasFallidas[] = $tarea;
				}
			}
		}
		return $tareasFallidas;
	}
	
	
	 public function getTareasPing(): array {
        $tareasPing = [];
        
        // Filtrar tareas de tipo ping
        foreach ($this->todasLasTareasSQL as $tareaSQL) {
            if ($tareaSQL['tipo_prueba'] === 'ping') {
                $tareasPing[] = new TareaPing($tareaSQL);
            }
        }

        return $tareasPing; // Retorna un array de objetos TareaPing
    }
    
    public function getTareasTCP(): array {
		$tareasTCP = [];
		
		// Filtrar tareas de tipo TCP
		foreach ($this->todasLasTareasSQL as $tareaSQL) {
			if ($tareaSQL['tipo_prueba'] === 'tcp') {
				$tareasTCP[] = new TareaTCP($tareaSQL);
			}
		}

		return $tareasTCP; // Retorna un array de objetos TareaTCP
	}
	
	
	public function getCountTareasFallidas($nivelAlerta = 'all') {
		// Inicializar el contador
		$contador = 0;

		// Iterar sobre todas las tareas SQL
		foreach ($this->todasLasTareasSQL as $tareaSQL) {
			// Verificar si la tarea falló
			if ($tareaSQL['estado_resultado'] === 'fallo') {
				// Si el nivel de alerta es 'all' o coincide con el nivel de alerta de la tarea
				if ($nivelAlerta === 'all' || $tareaSQL['nivel_alerta'] === $nivelAlerta) {
					$contador++;
				}
			}
		}

		return $contador; // Retornar el contador
	}


	public function getCountTareasSuccess() {
		// Inicializar el contador
		$contador = 0;

		// Iterar sobre todas las tareas SQL
		foreach ($this->todasLasTareasSQL as $tareaSQL) {
			// Verificar si la tarea tuvo éxito
			if ($tareaSQL['estado_resultado'] === 'éxito') {
				$contador++;
			}
		}

		return $contador; // Retornar el contador
	}



	public function getCountTareas() {
		// Devolver el número total de tareas
		return count($this->todasLasTareasSQL);
	}



}



?>
