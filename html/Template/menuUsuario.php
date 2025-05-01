<?php

$contenido = '
	<div class="dropdown-header bg-light py-2">
	  <div class="fw-semibold">Menú Usuario</div>
	</div>';

if ($usuario->getUsuarioVerificado()) {
	// Menu De usuario
	$contenido .= '
		<a class="dropdown-item" href="?pagina=perfilUsuario">
		  <svg class="icon me-2">
			<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-user"></use>
		  </svg> Perfil Usuario
		</a>
	';		

	// Menu de gestionar usuarioS
	if ( $usuario->puedeVerCualquierUsuario() ){
		$contenido .= '
			<a class="dropdown-item" href="?pagina=MenuUsuarios">
			  <svg class="icon me-2">
				<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-group"></use>
			  </svg> Menú Usuarios
			</a>
		';
	}

	if ($usuario->puedeVerConfiguracion() ){
		$contenido .= '
			<a class="dropdown-item" href="?pagina=configuracionServidor">
			  <svg class="icon me-2">
				<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-settings"></use>
			  </svg> Configuración
			</a>
		';
	}
	$contenido .='			
			<div class="dropdown-divider"></div>
			<a class="dropdown-item" href="#" data-coreui-toggle="modal" data-coreui-target="#logoutModal">
			  <svg class="icon me-2">
				<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-account-logout"></use>
			  </svg> Cerrar sesión
			</a>
	';
} else {
	$contenido .= '
		<a class="dropdown-item" href="?pagina=login">
		  <svg class="icon me-2">
			<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-user"></use>
		  </svg> Iniciar sesión
		</a>';
}

$templateContent->setMenuUsuarioHTML($contenido);
?>
