<?php
// Seguridad Basica:
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


class TareaSQL extends Tarea {
	// Variables funcionales para el tipo de tarea:
    private $url;

    public function __construct($tarea) {
        parent::__construct($tarea);

		// Variables especificas del tipo de tarea:
        $url = $tarea['url_servicio'] ?? '';
		$this -> tipoTarea = 'ping';

        // Verificar si es una URL o IP válida, o si tiene registros DNS válidos
        if (
            filter_var($url, FILTER_VALIDATE_IP) || // IP válida
            (filter_var($url, FILTER_VALIDATE_URL) && checkdnsrr(parse_url($url, PHP_URL_HOST), 'A')) // URL válida con registros DNS
        ) {
            $this->url = $url;
        } else {
            throw new InvalidArgumentException('URL, IP del servicio o nombre de dominio inválido.');
        }
    }

    public function ejecutar() {
        $output = [];
        $result = null;

        // Ejecutamos el ping usando shell
        exec("ping -c 1 {$this->url} 2>&1", $output, $result);

        // Convertir el array de salida a un string para registro
        $outputString = implode("\n", $output);
        
        // Si la tarea está negada, invertimos la lógica
		if ($this->tareaNegada) {
			$result = ($result === 0) ? 1 : 0; // Invertimos el resultado
		}

        if ($result === 0) {
			if($this->tareaNegada){
				$this->registrarResultado('éxito', 'Enlace TCP fallido', 'información', 0);
			}else{
				$this->registrarResultado('éxito', 'Enlace TCP exitoso', 'información', 0);
			}

        } else {
			$contadorIntentos = $this->intentosFallidosActuales + 1;
			$this->setIntentosFallidosActuales = $contadorIntentos;
			if($this->tareaNegada){
				$mensajeFallo = $this->intentosFallidosActuales >= $this->intentosPermitidos
					? 'TCP exitoso. Superado el número de intentos.'
					: 'TCP exitoso.';
			}else{
				$mensajeFallo = $this->intentosFallidosActuales >= $this->intentosPermitidos
					? 'TCP fallido. Superado el número de intentos.'
					: 'TCP fallido.';
			}
            
            
            if( $contadorIntentos >= $this->intentosPermitidos ){
				$estadoTarea = 'fallo';
				$nivelAlerta = 'crítico';
			}else{
				$estadoTarea = 'éxito';
				$nivelAlerta = 'advertencia';				
			}
            
            $this->registrarResultado($estadoTarea, $mensajeFallo, $nivelAlerta, $contadorIntentos);
            
            //echo "Ping a: " . $this->url . " fallido.\n";
        }

        $this->actualizarProximaEjecucion();
        $this->consolidarDatosEnSQL();
    }
}

?>
