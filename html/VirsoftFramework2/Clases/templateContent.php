<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

class TemplateContent {
	private $titulo;
	private $contenido;
	private $menuHTML;
	private $menuUsuarioHTML;
	private $scriptsHead;
	private $scriptsFooter;
	
	private $cssHead = "";
	private $jsFooter = "";
	private $toast = [];


	
	public function __construct() {
	// Inicializar las propiedades de la clase
	$this->titulo = "";
	$this->contenido = "";
	$this->menuHTML = "";
	$this->menuUsuarioHTML = "";
    }
    
    
    
    // Geter
    
    public function getMenuUsuarioHTML(){
		return $this->menuUsuarioHTML;
	}
    
    public function getCssHead() {
		return $this->cssHead;
	}

	public function getJsFooter() {
		return $this->jsFooter;
	}
    
    public function getTitulo() {
		return $this->titulo;
	}
	
	public function getContenido() {
		return $this->contenido;
	}
	
	public function getmenuHTML(){
		return $this->menuHTML;
	}
	
	public function getscriptsHead(){
		return $this -> scriptsHead;
	}
	
	public function getscriptsFooter(){
		return $this -> scriptsFooter;
	}
    
    // Seter
    public function setTitulo( $paramTitulo ) {
		$this->titulo = $paramTitulo;
	}
	
	public function iniciarPagina($titulo) {
		global $virsoft;
		$virsoft->verificarTokenCSRG_siProcede();
		$this->setTitulo($titulo);
	}
	
    public function setContenido( $paramContenido ) {
		$this->contenido = $paramContenido;
	}
	
	public function setmenuHTML ($paramContenido){
		$this->menuHTML = $paramContenido;
	}
	
	public function setMenuUsuarioHTML ($paramContenido){
		$this->menuUsuarioHTML = $paramContenido;
	}
	
	
	//Adder
	
    public function addCssHead($css) {
		$this->cssHead .= $css . "\n";
	}

	public function addJsFooter($js) {
		$this->jsFooter .= $js . "\n";
	}	
	
	public function addscriptsHead($valor){
		$this->scriptsHead .= $valor;
	}
	
	public function addscriptsFooter($valor){
		$this->scriptsFooter .= $valor;
	}
	
	// cargadores por defecto:
	
		// Este método aplica un workaround de CSS para corregir el comportamiento visual
		// de dropdowns dentro de celdas de DataTables, especialmente en modo responsive (móvil).
		// DataTables fuerza wrappers y anchos que generan scroll horizontal indeseado o layout roto.
		// Este CSS soluciona esos problemas sin romper el diseño general.
	public function loadCssDropdownOnDatatables(){
		$this -> addCssHead('
		<style>
		  .dropdown-menu {
			position: absolute !important;
			top: 100% !important;
			left: 0 !important;
			transform: none !important;
			inset: unset !important;
			margin-top: 0.25rem;
			z-index: 9999;
			min-width: max-content;
			max-width: 300px;
			white-space: nowrap;
		  }

		  .table-responsive {
			overflow-x: hidden !important;
			overflow-y: visible !important;
		  }

		  table.dataTable td {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		  }

		  td {
			position: relative;
			overflow: visible !important;
		  }

		  .dropdown-toggle {
			white-space: nowrap;
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
		  }

		  body {
			overflow-x: hidden !important;
		  }

		  /* Responsive fix para móviles */
		  @media (max-width: 768px) {
			.dropdown-menu {
			  max-width: 90vw !important;
			  overflow-x: auto;
			}

			.table-responsive {
			  overflow-x: auto !important;
			}

			table.dataTable {
			  width: 100% !important;
			}

			.dataTables_wrapper {
			  overflow-x: auto !important;
			}
		  }
		</style>
		
		');
	}
	
	// Toast para la siguiente pagina: (esto es valido para redirecciones)
	public function setToastForNextPage(string $mensaje, string $tipo = 'info', ?string $titulo = null): void {
		// Esto es por los jajas...
		if (is_null($titulo)){
			switch ($tipo) {
				case 'success':
					$titulos = ['¡Listo!','¡Perfecto!','¡Guardado!','¡Hecho!','¡Configurado!','¡Actualizado!','¡Completado!','✅ Operación exitosa','💾 Cambios aplicados','🟢 Todo en orden'];
					break;
				case 'info':
					$titulos = ['📘 Información','ℹ️ Detalles adicionales','🔍 Consulta informativa','📎 Nota técnica','📄 Datos cargados','🧭 Referencia útil','📦 Resultado informativo','📌 Anotación'];
					break;
				case 'warning':
					$titulos = ['⚠️ Atención','🟡 Aviso','⏳ Revisión necesaria','🔶 Precaución','🔔 Revisa esto','📝 Falta algo'];
					break;
				case 'danger':
					$titulos = ['❌ Error','🛑 Operación fallida','🚫 Acción no permitida','🔥 Algo ha ido mal','🔴 Crítico','💥 Petó fuerte','🙈 No se pudo completar','💣 Fallo inesperado','🧨 Explosión controlada (casi)'];
					break;
				default:
					$titulos = ['Info:'];
					break;
			}
			$titulo = $titulos[array_rand($titulos)];
		}
		
		// Ahora si metemos los datos en sesion:
		$_SESSION['toast'] = [
		  'mensaje' => $mensaje,
		  'tipo' => $tipo,
		  'titulo' => $titulo,
		];
	}

	public function hasToast(): bool {
		return isset($_SESSION['toast']);
	}

	// damos salida a los innmediatos y a los de sesion....
	public function outputToastJS(): string {
		$salida = '';

		// Si hay toast en sesión (para siguiente página)
		if (isset($_SESSION['toast'])) {
			$toast = $_SESSION['toast'];
			unset($_SESSION['toast']); // Lo eliminamos al mostrar

			$salida .= '<script>mostrarToast('
				. json_encode($toast['mensaje']) . ', '
				. json_encode($toast['tipo']) . ', '
				. json_encode($toast['titulo']) . ');</script>';
		}

		// Si hay toasts inmediatos (de esta página)
		if (!empty($this->toast)) {
			foreach ($this->toast as $toast) {
				$salida .= '<script>mostrarToast('
					. json_encode($toast['mensaje']) . ', '
					. json_encode($toast['tipo']) . ', '
					. json_encode($toast['titulo']) . ');</script>';
			}
		}

		return $salida;
	}

	public function addToast(string $mensaje, string $tipo = 'info', ?string $titulo = null): void {
		if (is_null($titulo)) {
			switch ($tipo) {
				case 'success':
					$titulos = ['¡Listo!','¡Perfecto!','¡Guardado!','¡Hecho!','¡Configurado!','¡Actualizado!','¡Completado!','✅ Operación exitosa','💾 Cambios aplicados','🟢 Todo en orden'];
					break;
				case 'info':
					$titulos = ['📘 Información','ℹ️ Detalles adicionales','🔍 Consulta informativa','📎 Nota técnica','📄 Datos cargados','🧭 Referencia útil','📦 Resultado informativo','📌 Anotación'];
					break;
				case 'warning':
					$titulos = ['⚠️ Atención','🟡 Aviso','⏳ Revisión necesaria','🔶 Precaución','🔔 Revisa esto','📝 Falta algo'];
					break;
				case 'danger':
					$titulos = ['❌ Error','🛑 Operación fallida','🚫 Acción no permitida','🔥 Algo ha ido mal','🔴 Crítico','💥 Petó fuerte','🙈 No se pudo completar','💣 Fallo inesperado','🧨 Explosión controlada (casi)'];
					break;
				default:
					$titulos = ['Info:'];
					break;
			}
			$titulo = $titulos[array_rand($titulos)];
		}

		$this->toast []= [
			'mensaje' => $mensaje,
			'tipo' => $tipo,
			'titulo' => $titulo
		];
	}
	
	
}
$templateContent = new TemplateContent();

?>
