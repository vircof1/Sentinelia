<?php
// control de includes
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}

// contenido HTML de la pagina:
$frameworkContent = "";

// Debug Framework...
if (isset($configuracionVirsoft['frameworkDebug'])){
	if ($configuracionVirsoft['frameworkDebug']){ $configuracionVirsoft['frameworkDebugHTML'] .= "Modulo Routing cargado <br>"; }
} 


// manejamos las rutas:
if ( isset($_GET['pagina']) ){
	
	$framework_pagina = $_GET['pagina'];

	switch ($framework_pagina) {
		
		
		case 'MonitoresSQL':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/MonitoresSQL.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;				
		
		
		case 'MonitoresPingEdit':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/MonitoresPingEdit.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;		

		
		case 'MonitoresTCP':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/MonitoresTCP.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;		
		
		
		case 'MonitoresPING':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/MonitoresPING.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
		case 'prueba':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/prueba.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
		
		
		case 'VisorEventos':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/VisorEventos.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
		case 'VisorEventosTarea':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/VisorEventosTarea.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
		
		
		case 'perfilUsuario':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/perfilUsuario.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
		case 'perfilUsuarioEdit':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/perfilUsuarioEdit.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
		case 'login':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				//include $configuracionVirsoft['framework_path'] . "rutas/index.php";
				include $configuracionVirsoft['framework_path'] . '../Template/login.php';

				// y por último la plantilla1
				//include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;


		case 'configuracionServidor':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/configuracionServidor.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
		case 'configuracionServidorEdit':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/configuracionServidorEdit.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
		
		
		
		case 'editarServidoresReverseProxy':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/editarServidoresReverseProxy.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
			
						
			
		case 'DetalleTarea':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				// Esto cargará las variables del contenido del framework...
				include $configuracionVirsoft['framework_path'] . "rutas/DetalleTarea.php";

				// y por último la plantilla1
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
		case 'EliminarTarea':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/EliminarTarea.php";
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
		case 'MonitoresTCPEdit':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/MonitoresTCPEdit.php";
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			

		case 'MenuUsuarios':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/MenuUsuarios.php";
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
		case 'MenuUsuariosEditar':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/MenuUsuariosEditar.php";
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
			
			
		case 'EliminarUsuario':
			$virsoft->setRequiereSesion(true);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/EliminarUsuario.php";
				include $configuracionVirsoft['framework_path'] . "../Template/index.php";
			}
			break;
		
			
		case 'ApiPowJson':
			$virsoft->setRequiereSesion(false);
			if (virsoftSesionesUsuarios()) {
				include $configuracionVirsoft['framework_path'] . "rutas/ApiPowJson.php";
				//include $configuracionVirsoft['framework_path'] . ""; // no tiene template. Debe devolver un json y punto.
			}
			break;

		// Otros casos y lógica para otras rutas
		default:
			// Ruta no encontrada
			framework_DefaultRuta();
			break;
	}
}else{
	framework_DefaultRuta();
}

//echo var_dump($virsoft);


function framework_DefaultRuta(){
	global $configuracionVirsoft, $virsoftControlInclude, $virsoft, $usuario, $templateContent;
	// logica de la pagina por defecto.
	
	$virsoft -> setRequiereSesion( true );
	if ( virsoftSesionesUsuarios() ){
		// Esto cargará las variables del contenido del framework...
		include $configuracionVirsoft['framework_path'] . "rutas/index.php";

		// y por ultimo la plantilla1
		include $configuracionVirsoft['framework_path'] . "../Template/index.php";
	}
}




?>
