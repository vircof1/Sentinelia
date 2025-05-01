<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class Idioma {
    private $lang = [];
    private $idiomaActivo = 'es'; // por defecto

    public function __construct() {
        global $usuario;

        // 1. Intentar idioma del usuario
        if (isset($usuario) && method_exists($usuario, 'getIdioma')) {
            $idiomaUsuario = $usuario->getIdioma();
            if (!empty($idiomaUsuario)) {
                $this->idiomaActivo = $idiomaUsuario;
            }
        }

        // 2. GeoIP (placeholder - implementar si querés más adelante)
        if (empty($this->idiomaActivo) || $this->idiomaActivo === 'auto') {
            $geoIpLang = $this->detectarIdiomaPorGeoIP();
            if (!empty($geoIpLang)) {
                $this->idiomaActivo = $geoIpLang;
            }
        }

        // 3. Incluir archivo del idioma correspondiente
        $archivo = __DIR__ . '/langs/' . $this->idiomaActivo . '.php';
        if (file_exists($archivo)) {
            $this->lang = include($archivo);
        } else {
            // Fallback a idioma por defecto
            $this->lang = include(__DIR__ . '/langs/es.php');
            $this->idiomaActivo = 'es';
        }
    }

    public function get($clave) {
        if (isset($this->lang[$clave])) {
            return $this->lang[$clave];
        }
        return $clave;
    }

    public function getIdiomaActivo() {
        return $this->idiomaActivo;
    }

    private function detectarIdiomaPorGeoIP() {
        // Aquí iría la lógica real si se quiere implementar GeoIP
        // Podrías usar $_SERVER['REMOTE_ADDR'] y consultar una base o API
        return null; // Por ahora no implementado
    }
}
