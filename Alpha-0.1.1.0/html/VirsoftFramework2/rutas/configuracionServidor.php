<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// Seteamos Titulo + logica CSRG
$templateContent -> iniciarPagina("Configuracion Usuario");

$usuario -> debugLog($configuracionWeb , 'Configuracion Web:');

if ( !$usuario->getDefaultAdminSettings() ){
	header('Location: ./');
	exit;
}



$contenido ='




<div class="card">
  <div class="card-header">
    <h5>Configuración del Servidor</h5>
  </div>
  <div class="card-body">
    <div class="row">
      <!-- 🟦 Columna Izquierda -->
      <div class="col-md-4">
			<h6 class="text-muted border-bottom pb-1">Nombre, identificación</h6>
			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">🦋 Identificación de instancia</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
				  <td>Version Sentinelia:</td>
				  <td>
					<span> ' . htmlspecialchars($configuracionWeb->getVersionSentinelia()) . ' </span>
				  </td>
				</tr>
			  
				<tr>
				  <td>Nombre del servidor:</td>
				  <td>
					<span> ' . htmlspecialchars($configuracionWeb->getInfoNombreServidor()) . ' </span>
				  </td>
				</tr>
				<tr>
				  <td>Empresa:</td>
				  <td>' . htmlspecialchars($configuracionWeb->getInfoNombreEmpresa()) . '</td>
				</tr>
				
			  </tbody>
			</table>
			
			<div class="text-center mt-2">
			  <a href="?pagina=configuracionServidorEdit&configuracion=IdentificaciónInstancia" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>
			
			
      </div>



      <!-- 🟩 Columna Central -->
      <div class="col-md-4">
            <h6 class="text-muted border-bottom pb-1">Notificaciones</h6>
 			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">📡 Notificaciones, URL Tikets</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
				  <td>URL Tikets:</td>
				  <td>
					<span>'. htmlspecialchars( $configuracionWeb->getUrlNotificacionTiket() ) .'</span>
				  </td>
				</tr>
				<tr>
				  <td>Metodo de envio:</td>
				  <td>'. htmlspecialchars( $configuracionWeb->getMetodoEnvioTiket() ) .'</td>
				</tr>
				
			  </tbody>
			</table> 
			
			<div class="text-center mt-2">
			  <a href="?pagina=configuracionServidorEdit&configuracion=NotificacionesURLTikets" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>
			
			
      </div>

      <!-- 🟨 Columna Derecha -->
      <div class="col-md-4">

             <h6 class="text-muted border-bottom pb-1">Emplazamiento</h6>
 			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">📍 Ubicación fisica</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
				  <td>Pais:</td>
				  <td>
					<span>'. htmlspecialchars($configuracionWeb->getInfoPais()) .'</span>
				  </td>
				</tr>
				<tr>
				  <td>Población:</td>
				  <td>'. htmlspecialchars($configuracionWeb->getInfoPoblacion()) .'</td>
				</tr>
				<tr>
				  <td>Data Center:</td>
				  <td>'. htmlspecialchars($configuracionWeb->getInfoDataCenter()) .'</td>
				</tr>
				<tr>
				  <td>Armario:</td>
				  <td>'. htmlspecialchars($configuracionWeb->getInfoArmarioRack()) .'</td>
				</tr>				
				
			  </tbody>
			</table> 
			<div class="text-center mt-2">
			  <a href="?pagina=configuracionServidorEdit&configuracion=UbicaciónFisica" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>
			
			
      </div>
      
      
       <!-- 🟨 Columna Izquierda 2 -->
      <div class="col-md-4">
        <h6 class="text-muted border-bottom pb-1">Seguridad</h6>
        <div class="mb-3">
          




			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">🔐 Política de Contraseñas</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
				  <td>Política activa:</td>
				  <td>
					<span class="badge bg-' . ($configuracionWeb->getConplejidadContraseñas() ? 'success' : 'danger') . '">' . ($configuracionWeb->getConplejidadContraseñas() ? 'SI' : 'NO') . '</span>
				  </td>
				</tr>
				<tr>
				  <td>Longitud mínima:</td>
				  <td>' . htmlspecialchars($configuracionWeb->getLongitudMinimaPassword()) . '</td>
				</tr>
				<tr>
				  <td>¿Requiere mayúsculas?</td>
				  <td>
					<span class="badge bg-' . ($configuracionWeb->getRequerirMayusculas() ? 'success' : 'danger') . '">' . ($configuracionWeb->getRequerirMayusculas() ? 'SI' : 'NO') . '</span>
				  </td>
				</tr>
				<tr>
				  <td>¿Requiere números?</td>
				  <td>
					<span class="badge bg-' . ($configuracionWeb->getRequerirNumeros() ? 'success' : 'danger') . '">' . ($configuracionWeb->getRequerirNumeros() ? 'SI' : 'NO') . '</span>
				  </td>
				</tr>
				<tr>
				  <td>¿Requiere símbolos?</td>
				  <td>
					<span class="badge bg-' . ($configuracionWeb->getRequerirSimbolos() ? 'success' : 'danger') . '">' . ($configuracionWeb->getRequerirSimbolos() ? 'SI' : 'NO') . '</span>
				  </td>
				</tr>
			  </tbody>
			</table>

			<div class="text-center mt-2">
			  <a href="?pagina=configuracionServidorEdit&configuracion=PolíticaContrasenas" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>



          
        </div>
      </div>
      
      
      <!-- 🟨 Columna centro 2 -->
      <div class="col-md-4">
        <h6 class="text-muted border-bottom pb-1">Seguridad en login</h6>
        <div class="mb-3">
          
			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">⚙️ Política de Prueba de Trabajo (PoW)</th>
				</tr>
			  </thead>
			  <tbody>
				<tr>
					<tr>
					  <td>Dificultad criptográfica mínima:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoWDificultadMinima(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
					<tr>
					  <td>Dificultad mínima para usuario sospechoso:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoW_dificultadMinimaPenalizada(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
					<tr>
					  <td>Dificultad criptográfica máxima:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoWDificultadMaxima(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
					<tr>
					  <td>Tiempo objetivo máximo:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoWTiempoObjetivoMaximo(), ENT_QUOTES, 'UTF-8') . ' segundos</td>
					</tr>
					<tr>
					  <td>Reintentos permitidos sin escalar:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoWReintentosSinEscalar(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
					<tr>
					  <td>Reintentos máximos (hasta dificultad máxima):</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoWReintentosMaximos(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
					<tr>
					  <td>Minutos hasta que se perdone una IP:</td>
					  <td>' . htmlspecialchars($configuracionWeb->getPoW_tiempoPerdonIP(), ENT_QUOTES, 'UTF-8') . '</td>
					</tr>
				
			  </tbody>
			</table>
			
			<div class="text-center mt-2">
			  <a href="?pagina=configuracionServidorEdit&configuracion=PolíticaPoW" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>
			
        </div>
      </div>
      
      
      
      
      
      
      
      <!-- 🟨 Columna derecha 2 -->
      <div class="col-md-4">
        <h6 class="text-muted border-bottom pb-1">Seguridad en reverse Proxy\'s</h6>
        <div class="mb-3">
          
			<table class="table table-sm table-bordered mt-4">
			  <thead class="table-light">
				<tr>
				  <th colspan="2">🛡️ Servidores reverse proxy validos</th>
				</tr>
			  </thead>
			  <tbody>
			  ';
			  
if ( count( $configuracionWeb ->getReverseProxiesConocidos() ) > 0 ){
	foreach ($configuracionWeb ->getReverseProxiesConocidos() as $servidorProxy)
		$contenido .='
				<tr>
				  <td>IP:</td>
				  <td>'. htmlspecialchars($servidorProxy) .'</td>
				</tr>		
		';
}else{
	$contenido .= '
				<tr>
				  <td>Aún no se configuro ningun servidor proxy, legitimo.</td>
				</tr>
	';
}
			//	<tr>
			//	  <td>Dificultad criptográfica mínima:</td>
			//	  <td>'. $configuracionWeb->getPoWDificultadMinima() .'</td>
			//	</tr>

$contenido .='
				
			  </tbody>
			</table>
			
			<div class="text-center mt-2">
			  <a href="?pagina=editarServidoresReverseProxy" class="btn btn-outline-primary btn-sm">
				Editar
			  </a>
			</div>
			
			
			
        </div>
      </div>
      
 
 
 
    </div>
  </div>

  <!-- 🔧 Pie de tarjeta -->

</div>


';


$templateContent -> setContenido($contenido);

?>
