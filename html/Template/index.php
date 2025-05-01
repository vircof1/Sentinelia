<?php
// Aqui deberiamos matar al proceso, si procede... y hacer includes.
// ya deberia existir $usuario o $virsoft con lo que podemos modelar en base a permisos.


// Incluimos el menú lateral del template:
require $configuracionVirsoft['framework_path'] . "../Template/menuLateral.php";
// Incluimos el menú de usuario:
require $configuracionVirsoft['framework_path'] . "../Template/menuUsuario.php";


// SitheBar:
if (session_status() === PHP_SESSION_NONE) {
    session_start(); // Inicia la sesión solo si no está ya iniciada
}

if (isset($_SESSION['templateSidebarHide'])) {
    $template['sideBarHide'] = $_SESSION['templateSidebarHide'];
} else {
    $template['sideBarHide'] = true; // Puedes establecerlo en false si quieres que el sidebar esté visible por defecto.
    $_SESSION['templateSidebarHide'] = true;
}

//var_dump($_SESSION['templateSidebarHide']);

?>
<!DOCTYPE html><!--
* CoreUI - Free Bootstrap Admin Template
* @version v4.2.2
* @link https://coreui.io/product/free-bootstrap-admin-template/
* Copyright (c) 2023 creativeLabs Łukasz Holeczek
* Licensed under MIT (https://github.com/coreui/coreui-free-bootstrap-admin-template/blob/main/LICENSE)
--><!-- Breadcrumb-->
<html lang="ES-es">
  <head>
    <base href="./">
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=no">
    <meta name="description" content="CoreUI - Open Source Bootstrap Admin Template">
    <meta name="author" content="Łukasz Holeczek">
    <meta name="keyword" content="Bootstrap,Admin,Template,Open,Source,jQuery,CSS,HTML,RWD,Dashboard">
    <title>Sentinelia - <?php echo $templateContent -> getTitulo(); ?></title>
	<link rel="icon" type="image/svg+xml" href="/Template/Custom/img/Sentinelia.svg">
<!--
    <link rel="apple-touch-icon" sizes="57x57" href="Template/assets/favicon/apple-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="Template/assets/favicon/apple-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="Template/assets/favicon/apple-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="Template/assets/favicon/apple-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="Template/assets/favicon/apple-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="Template/assets/favicon/apple-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="Template/assets/favicon/apple-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="Template/assets/favicon/apple-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="Template/assets/favicon/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192" href="Template/assets/favicon/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="Template/assets/favicon/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="Template/assets/favicon/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="Template/assets/favicon/favicon-16x16.png">
    <link rel="manifest" href="Template/assets/favicon/manifest.json">
    
-->    
    
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="msapplication-TileImage" content="Template/assets/favicon/ms-icon-144x144.png">
    <meta name="theme-color" content="#ffffff">
    <!-- Vendors styles-->
    <link rel="stylesheet" href="Template/vendors/simplebar/css/simplebar.css">
    <link rel="stylesheet" href="Template/css/vendors/simplebar.css">
    <!-- Main styles for this application-->
    <link href="Template/css/style.css" rel="stylesheet">
    <!-- We use those styles to show code examples, you should remove them in your application.-->
    <link href="Template/css/examples.css" rel="stylesheet">
    <link href="Template/vendors/@coreui/chartjs/css/coreui-chartjs.css" rel="stylesheet">
    
    <!-- Jquery -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>

    <!-- Cargar DataTables después de jQuery -->
    <link rel="stylesheet" href="https://cdn.datatables.net/1.10.24/css/jquery.dataTables.min.css"/>
    <script src="https://cdn.datatables.net/1.10.24/js/jquery.dataTables.min.js"></script>
    
    <!-- CSS dinamico -->
	<?php echo $templateContent->getCssHead(); ?>
	
	<?php echo $templateContent->getscriptsHead(); ?>


    
  </head>
  <body>
    <div class="sidebar sidebar-dark sidebar-fixed<?php if ( $template['sideBarHide'] ){ echo ' hide'; } ?>" id="sidebar">
      <div class="sidebar-brand d-none d-md-flex">
        <svg class="sidebar-brand-full" width="118" height="46" alt="CoreUI Logo">
          <use xlink:href="Template/assets/brand/coreui.svg#full"></use>
        </svg>
        <svg class="sidebar-brand-narrow" width="46" height="46" alt="CoreUI Logo">
          <use xlink:href="Template/assets/brand/coreui.svg#signet"></use>
        </svg>
      </div>
      
      
      <!-- Inicio Menú Principal -->
      <ul class="sidebar-nav" data-coreui="navigation" data-simplebar="">
		  
		  
		  <?php echo $templateContent -> getmenuHTML(); ?>
		  

      </ul>
      <!-- FIN Menú Principal -->
      <!--<button class="sidebar-toggler" type="button" data-coreui-toggle="unfoldable"></button> -->
      
      
    </div>
    <div class="wrapper d-flex flex-column min-vh-100 bg-light">
      <header class="header header-sticky mb-4">
        <div class="container-fluid">
			
		  <!-- Botoncito para dejar ver o no el menú -->
		  
		  <!--
          <button class="header-toggler px-md-0 me-md-3" type="button" onclick="coreui.Sidebar.getInstance(document.querySelector('#sidebar')).toggle()">
            <svg class="icon icon-lg">
              <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-menu"></use>
            </svg>
          </button>
          -->
          
          
			<button id="toggleSidebar" class="header-toggler px-md-0 me-md-3" type="button">
				<svg class="icon icon-lg">
					<use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-menu"></use>
				</svg>
			</button>
          
          
          
          <!-- Esto no se que es... -->
          <a class="header-brand d-md-none" href="#">
            <svg width="118" height="46" alt="CoreUI Logo">
              <use xlink:href="Template/assets/brand/coreui.svg#full"></use>
            </svg>
          </a>
            
            <!-- Menú de la parte superior
          <ul class="header-nav d-none d-md-flex">
            <li class="nav-item"><a class="nav-link" href="#">Dashboard</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Users</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Settings</a></li>
          </ul>
            -->
          
          
          <!-- Menú superior derecha -->
          <ul class="header-nav ms-auto">
		
			<!-- Icono Campanita, notificaciones -->
			<!--
            <li class="nav-item"><a class="nav-link" href="#">
                <svg class="icon icon-lg">
                  <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-bell"></use>
                </svg></a>
            </li>
            -->
            
            
            <!-- Icono como de lista o menú -->
            <!--
            <li class="nav-item"><a class="nav-link" href="#">
                <svg class="icon icon-lg">
                  <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-list-rich"></use>
                </svg></a>
            </li>
            -->
            
            
            <!-- Icono como de sobre o email -->
            <!--
            <li class="nav-item"><a class="nav-link" href="#">
                <svg class="icon icon-lg">
                  <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-envelope-open"></use>
                </svg></a>
            </li>
            -->
            
          <!-- Fin menú superior derecha --> 
          </ul>
          
          
          <!-- Menu Usuario.. -->
          <ul class="header-nav ms-3">
            <li class="nav-item dropdown"><a class="nav-link py-0" data-coreui-toggle="dropdown" href="#" role="button" aria-haspopup="true" aria-expanded="false">
                <div class="avatar avatar-md"><img class="avatar-img" src="Template/assets/img/avatars/8.jpg" alt="user@email.com"></div>
              </a>
              <div class="dropdown-menu dropdown-menu-end pt-0">

<?php echo $templateContent -> getMenuUsuarioHTML();


/*
	if ( $usuario -> getUsuarioVerificado() ){
		// El usuario ha iniciado sesión:
		echo '
                <div class="dropdown-header bg-light py-2">
                  <div class="fw-semibold">Menú Usuario</div>
                </div>
                <a class="dropdown-item" href="?pagina=perfilUsuario">
                  <svg class="icon me-2">
                    <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-user"></use>
                  </svg> Perfil Usuario
                </a>
                
                <a class="dropdown-item" href="?pagina=MenuUsuarios">
                  <svg class="icon me-2">
                    <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-group"></use>
                  </svg> Menú Usuarios
                </a>
                
                <a class="dropdown-item" href="?pagina=configuracionUsuaro">
                  <svg class="icon me-2">
                    <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-settings"></use>
                  </svg> Configuración
                </a>
                
                <div class="dropdown-divider"></div>
                
                <a class="dropdown-item" href="#" data-coreui-toggle="modal" data-coreui-target="#logoutModal">
                  <svg class="icon me-2">
                    <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-account-logout"></use>
                  </svg> Cerrar sesión
                </a>
                
                
                
                
		';
	}else{
		// El usuario NO ha iniciado sesión:
		echo'
                <div class="dropdown-header bg-light py-2">
                  <div class="fw-semibold">Menú Usuario</div>
                </div>
                <a class="dropdown-item" href="?pagina=login">
                  <svg class="icon me-2">
                    <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-user"></use>
                  </svg> Iniciar sesión
                </a>		
		';
	}
*/
?>


                  

				
				
              </div>
            </li>
          </ul>
		  <!-- Fin Menu Usuario..
		  coreui.Sidebar.getInstance(document.querySelector('#sidebar')).toggle()
		   -->


		<!-- Menú que INDICA donde estamos -->
		<!--
        </div>
        <div class="header-divider"></div>
        <div class="container-fluid">
          <nav aria-label="breadcrumb">
            <ol class="breadcrumb my-0 ms-2">
              <li class="breadcrumb-item">
                <span>Home</span>
              </li>
              <li class="breadcrumb-item active"><span>Dashboard</span></li>
            </ol>
          </nav>
        </div>
        -->
        <!-- FIN Menú que INDICA donde estamos -->
      </header>
      
       <!-- y ahora empezamos con el contenido de la pagina: -->
      <div class="body flex-grow-1 px-3"> 
       <div class="container-fluid">
		   
		   
		   

       

		<?php echo $templateContent -> getContenido(); ?>




		<!-- Modal de logout -->
		<div class="modal fade" id="logoutModal" tabindex="-1" aria-labelledby="logoutModalLabel" aria-hidden="true">
		  <div class="modal-dialog">
			<div class="modal-content">
			  <div class="modal-header">
				<h5 class="modal-title" id="logoutModalLabel">Cerrar sesión:</h5>
				<button type="button" class="btn-close" data-coreui-dismiss="modal" aria-label="Close"></button>
			  </div>
			  <div class="modal-body">
				¿Seguro que desea cerrar la sesion?
			  </div>
			  <div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-coreui-dismiss="modal">Cerrar esta ventana</button>
				<a href="?SesionLogout=yes">
					<button type="button" class="btn btn-primary">Cerrar sesion</button>
				</a>
			  </div>
			</div>
		  </div>
		</div>





       </div>
       <!-- Toast -->
       <div id="toastContainer" class="toast-container position-fixed bottom-0 end-0 p-3 z-9999"></div>
      </div>
      <!-- Fin contenido de pagina --> 
      
      
      
      </div>
      <footer class="footer">
        <div><a href="https://coreui.io">CoreUI </a><a href="https://coreui.io">Bootstrap Admin Template</a> © 2023 creativeLabs.</div>
        <div class="ms-auto">Powered by&nbsp;<a href="https://coreui.io/docs/">CoreUI UI Components</a></div>
      </footer>
    </div>
     <!-- CoreUI and necessary plugins-->
    <script src="Template/vendors/@coreui/coreui/js/coreui.bundle.min.js"></script>
    <script src="Template/vendors/simplebar/js/simplebar.min.js"></script>
    <!-- Plugins and scripts required by this view-->
    <script src="Template/js/popovers.js"></script>
    <script src="Template/js/tooltips.js"></script>
    <script src="Template/Custom/JS/utcToLocal.js"></script>
    
    
    
    
    <!-- CoreUI and necessary plugins-->
<!--    <script src="Template/vendors/@coreui/coreui/js/coreui.bundle.min.js"></script>
    <script src="Template/vendors/simplebar/js/simplebar.min.js"></script>
    <!-- Plugins and scripts required by this view-->
    
    <!-- scripts para diseñar graficos... -->
    <!--
    <script src="Template/vendors/chart.js/js/chart.min.js"></script>
    <script src="Template/vendors/@coreui/chartjs/js/coreui-chartjs.js"></script>
    -->
<!--    <script src="Template/vendors/@coreui/utils/js/coreui-utils.js"></script>
    
    <!-- Ejemplo
    <script src="Template/js/main.js"></script>
    -->
    

    <!-- Plugins and scripts required by this view-->
<!--    <script src="Template/js/popovers.js"></script>
    <script src="Template/js/tooltips.js"></script>
	<!-- -->
	
<!-- Intentando conservar el estado del sidebar: 
<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
-->

<script>
document.addEventListener('DOMContentLoaded', function() {
    const sidebarToggle = document.getElementById('toggleSidebar');

    sidebarToggle.addEventListener('click', toggleSidebar);
});

// Función para alternar el sidebar y hacer la llamada AJAX
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');

    // Alternar el sidebar
    coreui.Sidebar.getInstance(sidebar).toggle();

    // Determinar el nuevo estado del sidebar
    const isHidden = sidebar.classList.contains('hide');

    // Hacer una llamada AJAX para guardar el nuevo estado
    fetch('AJAX/sideBarHiden.php', { // Cambia esto a la ruta de tu script PHP que maneja la sesión
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sidebarHide: isHidden })
    })
    .then(response => response.json())
    .then(data => {
        // Manejar la respuesta del servidor si es necesario
        console.log('Estado del sidebar guardado:', data);
    })
    .catch(error => {
        console.error('Error al guardar el estado del sidebar:', error);
    });
}
</script>


<script>
function mostrarToast(contenido, tipo = 'success', titulo = null) {
  let colorClass = 'bg-secondary';
  let textClass = 'text-white';
  let tituloPorDefecto = 'Mensaje';

  switch (tipo) {
    case 'success':
      colorClass = 'bg-success';
      tituloPorDefecto = 'Éxito';
      break;
    case 'warning':
      colorClass = 'bg-warning';
      textClass = 'text-dark';
      tituloPorDefecto = 'Advertencia';
      break;
    case 'danger':
      colorClass = 'bg-danger';
      tituloPorDefecto = 'Error';
      break;
    case 'info':
      colorClass = 'bg-info';
      textClass = 'text-dark';
      tituloPorDefecto = 'Información';
      break;
  }

  const finalTitulo = titulo ?? tituloPorDefecto;

  const toast = document.createElement('div');
  toast.className = `toast border-0 shadow overflow-hidden`;
  toast.role = 'alert';
  toast.ariaLive = 'assertive';
  toast.ariaAtomic = 'true';
  toast.innerHTML = `
    <div class="${colorClass} ${textClass} px-3 py-2 d-flex justify-content-between align-items-center fw-bold">
      <span>${finalTitulo}</span>
      <button type="button" class="btn-close ${textClass === 'text-white' ? 'btn-close-white' : ''}" data-coreui-dismiss="toast" aria-label="Cerrar"></button>
    </div>
    <div class="toast-body px-3 pt-3 pb-3 fw-semibold fs-6">
      ${contenido}
    </div>
  `;

  document.getElementById('toastContainer').appendChild(toast);
  const toastInstance = new coreui.Toast(toast, { delay: 7000 });
  toastInstance.show();
}

</script>
<?php
echo $templateContent->outputToastJS();
?>


<?php
    if (isset($templateTextoJsLog) && !empty($templateTextoJsLog)) {
        echo $templateTextoJsLog;
    }
?>
	<!-- JS Dinamico -->
	<?php echo $templateContent->getJsFooter(); ?>
	<?php echo $templateContent -> getscriptsFooter();  ?>
	
  </body>
</html>

