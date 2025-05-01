<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$datosBBDD = $_SESSION['sentinelia_instalador'] ?? null;
$datosUsuario = $_SESSION['sentinelia_instalador_usuario'] ?? null;
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Instalador de Sentinelia - BBDD</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        #logInstalacion {
            background: #f8f9fa;
            height: 300px;
            overflow-y: auto;
            border: 1px solid #dee2e6;
            padding: 1rem;
            font-family: monospace;
            font-size: 0.9rem;
        }
    </style>
</head>
<body class="bg-light">

<div class="container py-5">
    <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 4 de 5</div>
    <h2 class="mb-4">Estructura y datos en base de datos + archivos de configuración</h2>

    <?php if ($datosBBDD && $datosUsuario): ?>
    <div class="row">
        <div class="col-md-6">
            <div class="card mb-4">
                <div class="card-header">📡 Conexión a Base de Datos</div>
                <ul class="list-group list-group-flush">
                    <li class="list-group-item"><strong>Servidor:</strong> <?= htmlspecialchars($datosBBDD['db_host']) ?></li>
                    <li class="list-group-item"><strong>Base de Datos:</strong> <?= htmlspecialchars($datosBBDD['db_nombre']) ?></li>
                    <li class="list-group-item"><strong>Usuario:</strong> <?= htmlspecialchars($datosBBDD['db_usuario']) ?></li>
                </ul>
            </div>
        </div>
        <div class="col-md-6">
            <div class="card mb-4">
                <div class="card-header">👤 Usuario Administrador</div>
                <ul class="list-group list-group-flush">
                    <li class="list-group-item"><strong>Nombre:</strong> <?= htmlspecialchars($datosUsuario['nombre']) ?></li>
                    <li class="list-group-item"><strong>Apellidos:</strong> <?= htmlspecialchars($datosUsuario['apellidos']) ?></li>
                    <li class="list-group-item"><strong>Email:</strong> <?= htmlspecialchars($datosUsuario['email']) ?></li>
                    <li class="list-group-item"><strong>Usuario:</strong> <?= htmlspecialchars($datosUsuario['usuario']) ?></li>
                </ul>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <div class="card mb-4">
        <div class="card-header bg-info text-white">🧾 Resumen del proceso de instalación</div>
        <div class="card-body">
            <ul>
                <li>Se crearán <strong>6 tablas</strong> en la base de datos.</li>
                <li>Se insertarán valores por defecto de configuración.</li>
                <li>Se registrará el primer <strong>usuario administrador</strong>.</li>
                <li>El nombre del servidor será: <strong>Sentinelia</strong>.</li>
                <li>Tiempo estimado: <strong>5 a 10 segundos</strong>.</li>
            </ul>
        </div>
    </div>

    <div class="mb-3">
        <div class="progress" style="height: 25px;">
            <div id="barraProgreso" class="progress-bar progress-bar-striped progress-bar-animated" style="width: 0%;">
                0%
            </div>
        </div>
    </div>

    <div class="mb-4">
        <button id="btnIniciar" class="btn btn-success btn-lg">Iniciar instalación</button>
    </div>

    <div id="logInstalacion" class="mb-3"></div>
    
    <div id="bloqueContinuar" class="mt-4 d-none">
		<div class="alert alert-info" role="alert">
			🧪 Instalación técnica completada. Ahora verificaremos si las tareas automáticas (cron) se están ejecutando correctamente.
		</div>
		<a href="paso5.php" class="btn btn-primary btn-lg">Continuar Instalación</a>
	</div>
</div>

<script>
document.getElementById('btnIniciar').addEventListener('click', async function () {
    const boton = this;
    boton.disabled = true;
    const log = document.getElementById('logInstalacion');
    const barra = document.getElementById('barraProgreso');

    function agregarLog(texto) {
        log.innerHTML += texto + '<br>';
        log.scrollTop = log.scrollHeight;
    }

    try {
        const respuesta = await fetch('ajax_instalador.php?getPasos=yes');
        const datos = await respuesta.json();
        if (datos.estado !== 'ok') {
            agregarLog('❌ Error al obtener el número de pasos');
            return;
        }

        const total = datos.total;
        agregarLog(`🧩 Total de pasos: ${total}`);

        for (let paso = 1; paso <= total; paso++) {
            agregarLog(`➡️ Ejecutando paso ${paso}...`);

            const respPaso = await fetch('ajax_instalador.php?paso=' + paso);
            const datoPaso = await respPaso.json();

            if (datoPaso.estado === 'ok') {
                agregarLog(`✅ Paso ${paso} completado: ${datoPaso.mensaje}`);
            } else {
                agregarLog(`❌ Error en paso ${paso}: ${datoPaso.mensaje}`);
                barra.classList.remove('progress-bar-animated');
                barra.classList.add('bg-danger');
                return;
            }

            const progreso = Math.round((paso / total) * 100);
            barra.style.width = progreso + '%';
            barra.textContent = progreso + '%';
        }

		agregarLog('🎉 Instalación de base de datos y archivos completada.');
		barra.classList.remove('progress-bar-animated');
		barra.classList.add('bg-success');

		// Mostrar paso siguiente
		document.getElementById('bloqueContinuar').classList.remove('d-none');
		boton.classList.add('d-none');

    } catch (err) {
        agregarLog('❌ Error inesperado: ' + err.message);
        barra.classList.remove('progress-bar-animated');
        barra.classList.add('bg-danger');
    }
});
</script>

</body>
</html>
