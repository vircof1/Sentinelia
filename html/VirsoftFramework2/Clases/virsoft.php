<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


class Virsoft {
    // Propiedades de la clase
    private $db_host;
    private $db_user;
    private $db_password;
    private $db_name;
    private $db_connection;
    
    private $requiereSesion;
    private $tokenCSRG;
    
    
    // Constructor
    public function __construct() {
		global $configuracionVirsoft;
			// Datos de conexión a MariaDB:
        $this->db_host = $configuracionVirsoft['db_host_mariaDB'];
        $this->db_user = $configuracionVirsoft['db_user_mariaDB'];
        $this->db_password = $configuracionVirsoft['db_password_mariaDB'];
        $this->db_name = $configuracionVirsoft['db_name_mariaDB'];
		
			// si el la pagina a mostrar no requiere un usuario logeado, cambiar a false: 
        $this -> requiereSesion = true;
        
    }
    
    // Método para conectar a la base de datos
    public function conectarDB() {
        $this->db_connection = new mysqli($this->db_host, $this->db_user, $this->db_password, $this->db_name);
        
        // Verificar si hay errores de conexión
        if ($this->db_connection->connect_error) {
			//echo "error de conexion en base de datos.";
            die("Error de conexión a la base de datos: " . $this->db_connection->connect_error);
        }
    }
    
    
    
    // Método para ejecutar una consulta preparada
	public function ejecutarConsultaPreparada($query, $params) {

		
		$this->conectarDB();
		$statement = $this->db_connection->prepare($query);
		
		// Verificar si hay errores en la preparación de la consulta
		if (!$statement) {
			die("Error en la preparación de la consulta: " . $this->db_connection->error);
		}
		
		// Enlazar los parámetros a la consulta preparada
		// Enlazar los parámetros a la consulta preparada
		if ($params) {
			$paramTypes = '';
			$paramValues = [];
			
			foreach ($params as $param) {
				if (isset($param['type']) && isset($param['value'])) {
					$paramTypes .= $param['type'];
					$paramValues[] = $param['value'];
				}
			}

			$bindParams = array_merge([$paramTypes], $paramValues);
			$bound = $statement->bind_param(...$bindParams);

			if (!$bound) {
				die("Error al enlazar los parámetros: " . $statement->error);
			}
		}
		
		// Ejecutar la consulta
		$executed = $statement->execute();
		
		if (!$executed) {
			die("Error en la ejecución de la consulta: " . $statement->error);
		}
		
		// Obtener el resultado de la consulta
		$result = $statement->get_result();
		
		if ($result->num_rows === 0) {
			// No hay resultados, aunque la consulta se ejecutó:
			return true;
		}else{
			return $result->fetch_all(MYSQLI_ASSOC);
		}
		/* Ejemplo de uso:
		  
		$consulta_menu = "SELECT * FROM MenuPrincipal WHERE 1 = ? ORDER BY PrioridadAparicion";
		$params = [
			['type' => 'i', 'value' => 1],
		];
		$result_menu = $virsoft->ejecutarConsultaPreparada($consulta_menu, $params);
		*/
		
	}
 
 
    // Método para obtener una única fila de resultados
	public function ejecutarConsultaPreparadaSimple($query, $params) {
		$this->conectarDB();
		$statement = $this->db_connection->prepare($query);
		
		// Verificar si hay errores en la preparación de la consulta
		if (!$statement) {
			die("Error en la preparación de la consulta: " . $this->db_connection->error);
		}
		
		// Crear un array de tipos de datos para los parámetros
		$paramTypes = '';
		$paramValues = [];
		foreach ($params as $param) {
			$paramTypes .= $param['type'];
			$paramValues[] = $param['value'];
		}
		
		// Enlazar los parámetros a la consulta preparada
		$bindParams = array_merge([$paramTypes], $paramValues);
		$bound = $statement->bind_param(...$bindParams);
		
		if (!$bound) {
			die("Error al enlazar los parámetros: " . $statement->error);
		}
		
		// Ejecutar la consulta
		$success = $statement->execute();
		
		// Verificar si hay errores en la ejecución de la consulta
		if ($statement->error) {
			die("Error en la ejecución de la consulta: " . $statement->error);
		}
		
		// ✅ Si la consulta es un `SELECT`, obtenemos el resultado
		if (stripos(trim($query), 'SELECT') === 0) {
			$result = $statement->get_result();
			return $result ? $result->fetch_assoc() : null;
		}
		
		// ✅ Para `INSERT`, `UPDATE`, o `DELETE`, devolver `true` si se ejecutó sin errores
		return $success;
	}

	
	public function verificarTokenCSRG_siProcede() {
		if ($_SERVER['REQUEST_METHOD'] === 'POST') {
			if (!isset($_POST['csrf_token'])) {
				die('CSRF token no proporcionado.');
			}

			if ( $_POST['csrf_token'] !== $this -> getTokenCSRG() ) {
				session_unset();
				die('CSRF token inválido. Cerrando sesión');
			}
		}
	}
	
	public static function getDatosIPCliente(): array {
		$ipProxy = $_SERVER['REMOTE_ADDR'] ?? null;
		$usaProxy = false;
		$ipCliente = $ipProxy;

		if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
			$lista = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
			$ipCliente = trim($lista[0]);
			$usaProxy = true;
		}

		return [
			'usaProxy'   => $usaProxy,
			'proxy'      => $usaProxy ? $ipProxy : null,
			'ipCliente'  => $ipCliente
		];
	}

	public function generarHashSalt($contrasena, $salt) {
		// Parámetros de PBKDF2
		$algoritmo = 'sha256';
		$iteraciones = 1000000;
		$tamanioClave = 32; // En bytes

		// Generar clave derivada con PBKDF2
		$claveDerivada = hash_pbkdf2($algoritmo, $contrasena, $salt, $iteraciones, $tamanioClave, true);

		// Convertir la clave derivada a una representación legible (hexadecimal)
		$claveHex = bin2hex($claveDerivada);

		return $claveHex;
		/*
		Ejemplo de uso:
		$contrasena = 'password123';
		$salt = 'uniquesalt';

		$claveDerivada = $virsoft->generarHashSalt($contrasena, $salt);
		*/
		
	}
	
	public function generarSaltAleatorio() {
		$caracteres = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		$longitud = 64;
		$salt = '';
		
		for ($i = 0; $i < $longitud; $i++) {
			$indice = rand(0, strlen($caracteres) - 1);
			$salt .= $caracteres[$indice];
		}
		
		return $salt;
		/*
		Ejemplo de uso:
		$salt = $virsoft->generarSaltAleatorio();
		*/
	}
	
	public function setRequiereSesion($value){
		$this -> requiereSesion = $value;
	}
	
	public function getRequiereSesion(){
		return $this -> requiereSesion;
	}
	
	public function setTokenCSRG( $value ){
		$this -> tokenCSRG = $value;
	}
	
	public function getTokenCSRG(){
		return $this -> tokenCSRG;
	}

}
//$virsoft = new Virsoft();
$GLOBALS['virsoft'] = new Virsoft();




?>
