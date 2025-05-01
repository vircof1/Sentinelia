<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Verificamos que existan datos previos (seguridad mínima)
if (!isset($_SESSION['sentinelia_instalador']) || !isset($_SESSION['sentinelia_instalador_usuario'])) {
    // Si no hay sesión previa, redirigimos al inicio
    header('Location: index.php');
    exit;
}

$datosBBDD = $_SESSION['sentinelia_instalador'];
$datosUsuario = $_SESSION['sentinelia_instalador_usuario'];

?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Instalador de Sentinelia - Resumen e Instalación</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container py-5">
    <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 4 de XX</div>
    <h2 class="mb-4">Resumen de Configuración</h2>

    <div class="card mb-4">
        <div class="card-header">
            Datos de la Base de Datos
        </div>
        <ul class="list-group list-group-flush">
            <li class="list-group-item"><strong>Servidor:</strong> <?php echo htmlspecialchars($datosBBDD['db_host']); ?></li>
            <li class="list-group-item"><strong>Base de Datos:</strong> <?php echo htmlspecialchars($datosBBDD['db_nombre']); ?></li>
            <li class="list-group-item"><strong>Usuario:</strong> <?php echo htmlspecialchars($datosBBDD['db_usuario']); ?></li>
        </ul>
    </div>

    <div class="card mb-4">
        <div class="card-header">
            Datos del Usuario Administrador
        </div>
        <ul class="list-group list-group-flush">
            <li class="list-group-item"><strong>Nombre:</strong> <?php echo htmlspecialchars($datosUsuario['nombre']); ?></li>
            <li class="list-group-item"><strong>Apellidos:</strong> <?php echo htmlspecialchars($datosUsuario['apellidos']); ?></li>
            <li class="list-group-item"><strong>Email:</strong> <?php echo htmlspecialchars($datosUsuario['email']); ?></li>
            <li class="list-group-item"><strong>Usuario:</strong> <?php echo htmlspecialchars($datosUsuario['usuario']); ?></li>
        </ul>
    </div>

    <div class="text-center mb-4">
        <button id="btnInstalar" class="btn btn-success btn-lg">Instalar Base de Datos</button>
    </div>

    <div id="resultado" class="mt-4"></div>

</div>

<script>
// Instalación vía AJAX
document.getElementById('btnInstalar').addEventListener('click', function() {
    var boton = this;
    boton.disabled = true;
    boton.textContent = 'Instalando...';

    fetch('ajax_instalar_bd.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'csrf_token=<?php echo htmlspecialchars($_SESSION['csrf_token']); ?>'
    })
    .then(response => response.json())
    .then(data => {
        if (data.estado === 'ok') {
            document.getElementById('resultado').innerHTML = `
                <div class="alert alert-success" role="alert">
                    <h4 class="alert-heading">¡Instalación completada!</h4>
                    <p>Ahora puede eliminar la carpeta <strong>Install</strong> por motivos de seguridad.</p>
                    <hr>
                    <p class="mb-0">
                        Puede iniciar sesión normalmente con el usuario creado.
                    </p>
                </div>
            `;
        } else {
            document.getElementById('resultado').innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h4 class="alert-heading">Error durante la instalación</h4>
                    <p>${data.motivo}</p>
                </div>
            `;
            boton.disabled = false;
            boton.textContent = 'Intentar de nuevo';
        }
    })
    .catch(error => {
        document.getElementById('resultado').innerHTML = `
            <div class="alert alert-danger" role="alert">
                <h4 class="alert-heading">Error inesperado</h4>
                <p>No se pudo completar la instalación. Inténtelo de nuevo.</p>
            </div>
        `;
        boton.disabled = false;
        boton.textContent = 'Intentar de nuevo';
    });
});
</script>

</body>
</html>
