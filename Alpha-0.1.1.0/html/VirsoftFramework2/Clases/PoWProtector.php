<?php

class PoWProtector {

	public static function calcularDificultad(): int {
		global $configuracionWeb;
		global $virsoft;

		$datosIp = Virsoft::getDatosIPCliente();

		// Si usa proxy no verificado: dificultad máxima directa
		if ($datosIp['usaProxy'] && !in_array($datosIp['proxy'], $configuracionWeb->getReverseProxiesConocidos())) {
			return $configuracionWeb->getPoWDificultadMaxima();
		}

		$historicoCliente = self::getHistoricoIP();

		// Forzamos actualización del último intento, para coherencia en medidas temporales
		$now = date('Y-m-d H:i:s');
		$sql = 'UPDATE `pow_actors` SET `fecha_ultimo_intento` = ? WHERE `pow_actors`.`ip` = ?';
		$params = [
			['type' => 's', 'value' => $now],
			['type' => 's', 'value' => $datosIp['ipCliente']],
		];
		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);

		// Si aún no ha llegado al umbral de castigo, dificultad mínima
		if ($historicoCliente['reintentos'] <= $configuracionWeb->getPoWReintentosSinEscalar()) {
			return $configuracionWeb->getPoWDificultadMinima();
		}

		// Variables para el cálculo adaptativo
		$reintentos      = (int)$historicoCliente['reintentos'];
		$hashRate        = (float)$historicoCliente['hashes_por_segundo'] ?? null;
		$min             = $configuracionWeb->getPoWDificultadMinima();
		$max             = $configuracionWeb->getPoWDificultadMaxima();
		$sinEscalar      = $configuracionWeb->getPoWReintentosSinEscalar();
		$reintentosMax   = $configuracionWeb->getPoWReintentosMaximos();
		$tiempoObjetivo  = $configuracionWeb->getPoWTiempoObjetivoMaximo(); // segundos

		if (is_null($hashRate) || $hashRate <= 0) {
			return (int) round(($min + $max) / (16/10));
		}

		// Factor de penalización progresiva
		$factorPenalizacion = ($reintentos - $sinEscalar) / max(1, $reintentosMax - $sinEscalar);
		$factorPenalizacion = min(max($factorPenalizacion, 0), 1); // clamp entre 0 y 1

		// Estimar el objetivo en hashes
		$objetivoHashes = $tiempoObjetivo * $hashRate * $factorPenalizacion;

		// Calculamos dificultad con log base 2 (probabilidad de 1/2 por dígito válido)
		$dificultad = (int) round(log($objetivoHashes, (16/10)));

		// Clamp al rango definido
		$dificultad = max($min, min($max, $dificultad));

		// DEBUG opcional para superusuarios
		global $usuario;
		if (isset($usuario) && $usuario->getSuperUsuario()) {
			echo "<pre>";
			echo "📊 DEBUG calcularDificultad()\n";
			echo "HashRate: $hashRate\n";
			echo "Reintentos: $reintentos\n";
			echo "Tiempo objetivo: $tiempoObjetivo\n";
			echo "Factor penalización: $factorPenalizacion\n";
			echo "Objetivo hashes: $objetivoHashes\n";
			echo "Dificultad estimada: $dificultad\n";
			echo "log base 2: " . log($objetivoHashes, 2) . "\n";
			echo "</pre>";
		}
		if ($dificultad < $configuracionWeb->getPoW_dificultadMinimaPenalizada() ){
			if($reintentos > $configuracionWeb->getPoWReintentosMaximos()){
				$dificultad = $configuracionWeb->getPoW_dificultadMinimaPenalizada();
			}
		}
		

		return $dificultad;
	}


	public static function getHistoricoIP(): array {
		global $virsoft;
		global $configuracionWeb;
		// Primero saneamos basura en la base de datos:
		$minutos = $configuracionWeb->getPoW_tiempoPerdonIP();
		$ahora = new DateTime();
		$ahora->modify("-{$minutos} minutes");
		$fechaLimpieza = $ahora->format('Y-m-d H:i:s');
		$sqlLimpieza = 'DELETE FROM pow_actors WHERE fecha_ultimo_intento < ?';
		$paramsLimpieza = [['type' => 's', 'value' => $fechaLimpieza]];
		$virsoft->ejecutarConsultaPreparadaSimple($sqlLimpieza, $paramsLimpieza);
		
		
		// Calculamos la IP del cliente:
		$ip = Virsoft::getDatosIPCliente()['ipCliente'];
		$ahora = date('Y-m-d H:i:s');

		// Buscar registro actual
		$sql = 'SELECT * FROM pow_actors WHERE ip = ? LIMIT 1';
		$params = [['type' => 's', 'value' => $ip]];
		$resultado = $virsoft->ejecutarConsultaPreparadaSimple($sql, $params);


		//// Si no existe, lo creamos
		if ( is_null($resultado) ) {
			$sqlInsert = 'INSERT INTO pow_actors (ip, reintentos) VALUES (?, ?)';
			$paramsInsert = [
				['type' => 's', 'value' => $ip],
				['type' => 'i', 'value' => 0],
			];
			$virsoft->ejecutarConsultaPreparadaSimple($sqlInsert, $paramsInsert);

			return [
				'ip' => $ip,
				'reintentos' => 0,
				'ultimo_nonce' => null,
				'tiempo_resolucion' => null,
				'hashes_por_segundo' => null,
				'fecha_ultimo_intento' => $ahora
			];
		}else{
			return $resultado;
		}
	}
    

    public static function generarDesafio(): array {
		// Iniciamos sesion
        if (session_status() === PHP_SESSION_NONE) {
			session_start();
		}
		global $virsoft;

		$semilla = $virsoft -> generarSaltAleatorio();
        $dificultad = self::calcularDificultad($_SERVER['REMOTE_ADDR']);

        $_SESSION['semillaPoW'] = $semilla;
        $_SESSION['dificultadPoW'] = $dificultad;
        $_SESSION['timestampPoW'] = time();

        return [
            "estado" => true,
            "semilla" => $semilla,
            "dificultad" => $dificultad
        ];
    }

    public static function verificarResultado(string $nonce, string $hash): bool {
		if (session_status() === PHP_SESSION_NONE) {
			session_start();
		}
		global $virsoft;
		
        if (!isset($_SESSION['semillaPoW'])) return false;
        $semilla = $_SESSION['semillaPoW'];
        $dificultad = $_SESSION['dificultadPoW'];

        $recalculado = hash('sha256', $semilla . $nonce);
        $prefijo = substr($recalculado, 0, $dificultad);
        
        // Separamos la logica de la operacion, para poder actualizar la informacion de la IP:
        $resultadoOperacionPoW = (preg_match('/^[0-9]+$/', $prefijo) === 1);
        
        // si por lo que sea el nonce no es un string con forma de INT, lo invalidamos. Los nonces no pueden, no ser numeros, segun nuestro JS.
        $tmp = (int)$nonce;
        if( $tmp != $nonce ){ $resultadoOperacionPoW = false; }
        
        
        
        
		// Con PoW valido o sin Pow valido, tenemos que contabilizar el intento, de forma normal...
		$infoIP = Virsoft::getDatosIPCliente();
		$historicoCliente = self::getHistoricoIP();
					
		
		
		// Calculamos los nuevos valores del cliente:
		$reintentos = (int)$historicoCliente['reintentos'] + 1;
		$ultimoNonce = $nonce + 1;
		
		$tiempoUltimoIntento = strtotime($historicoCliente['fecha_ultimo_intento']);
		$tiempoActual = time();
		$tiempo_resolucion = max(1, $tiempoActual - $tiempoUltimoIntento) + 1;  // En segundos
		
		if ( (int)$nonce === 0 ){
			$hashes_por_segundo = null;
		}else{
			$hashes_por_segundo = round(((int)$nonce) / $tiempo_resolucion, 2);
		}
		
		
		$sql = 'UPDATE pow_actors SET 
					reintentos = ?, 
					ultimo_nonce = ?, 
					tiempo_resolucion = ?, 
					hashes_por_segundo = ? 
				WHERE ip = ?';
		$params = [
			['type' => 'i', 'value' => $reintentos],
			['type' => 'i', 'value' => $ultimoNonce],
			['type' => 'd', 'value' => $tiempo_resolucion],
			['type' => is_null($hashes_por_segundo) ? 's' : 'd', 'value' => $hashes_por_segundo],
			['type' => 's', 'value' => $infoIP['ipCliente']],
		];
		$virsoft->ejecutarConsultaPreparadaSimple($sql, $params);
	
        
        
        
        return $resultadoOperacionPoW;
    }

    public static function registrarCostoHash(int $ms): void {
        // TODO: guardar en BD o cache
    }

    public static function esDistribuido(string $ip): bool {
        // TODO: heurística o lista
        return false;
    }
}

?>
