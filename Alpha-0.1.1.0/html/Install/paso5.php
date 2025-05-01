<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
$datosBBDD = $_SESSION['sentinelia_instalador'] ?? null;
if (!$datosBBDD) {
    die('⚠️ Sesión de instalación no disponible.');
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Verificación de Cron - Sentinelia</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

	
<div class="container py-5">
	 <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 5 de 5</div>
    <h2 class="mb-4">🕒 Verificación de tareas automáticas (cron)</h2>

    <div class="card">
        <div class="card-body">
            <div id="estadoCron" class="alert alert-warning">
                ⏳ Esperando que una tarea se ejecute por primera vez... Esto puede tardar unos segundos.
            </div>


			<div class="card mt-4">
				<div class="card-header bg-secondary text-white">
					🕒 ¿Qué es el cron y por qué es necesario?
				</div>
				<div class="card-body">
					<p>
						El sistema Sentinelia necesita ejecutar tareas automáticas cada minuto (por ejemplo, comprobaciones, notificaciones, etc.).
						Esto se logra mediante el sistema de programación de tareas de Linux llamado <code>cron</code>.
					</p>
					<p>
						Si no configuras correctamente este cron, el sistema <strong>no podrá funcionar</strong> como se espera.
					</p>
				</div>
			</div>





			<div class="card mt-4">
				<div class="card-header bg-light">
					📌 <strong>Instrucciones para configurar el cron:</strong>
				</div>
				<div class="card-body">
					<pre class="mb-3 bg-dark text-white p-3 rounded">* * * * * /usr/bin/php /var/www/crontab.php >> /dev/null 2>&1</pre>
					<p class="mb-2">
						Este cron debe ejecutarse <strong>cada minuto</strong> para garantizar que las tareas programadas funcionen correctamente.
					</p>
					<p class="text-danger mb-0">
						⚠️ Importante: el script <code>crontab.php</code> está ubicado <strong>fuera de la carpeta html</strong>. Asegúrate de especificar la ruta absoluta correctamente (<code>/var/www/crontab.php</code>).
					</p>
				</div>
			</div>




<div class="alert alert-warning mt-4" role="alert">
  <h5 class="mb-2">⚠️ Importante: ruta absoluta en el cron</h5>
  <p>
    El archivo <code>crontab.php</code> usa una ruta absoluta fija para incluir el archivo de configuración <code>Variables.php</code>:
  </p>
  <pre class="bg-light p-2 border rounded"><code>include "/var/www/html/Variables.php";</code></pre>
  <p class="mb-0">
    Si duplicas esta instalación en otra carpeta (por ejemplo <code>/var/www/html/Prueba/</code>), debes <strong>actualizar manualmente esta ruta</strong> en <code>crontab.php</code> para que apunte correctamente al nuevo entorno.
  </p>
</div>




            <div id="botonContinuar" class="d-none">
                <a href="../index.php" class="btn btn-success btn-lg">Acceder a aplicación</a>
                <p class="mt-3 text-muted">✅ Recuerda eliminar la carpeta <strong>/Install</strong> manualmente.</p>
            </div>
        </div>
    </div>
</div>

<script>
setInterval(async () => {
    try {
        const response = await fetch('ajax_verificar_cron.php');
        const data = await response.json();

        if (data.estado === 'ok') {
            const alerta = document.getElementById('estadoCron');
            alerta.className = 'alert alert-success';
            alerta.innerHTML = '✅ Se ha detectado al menos una tarea ejecutada. El sistema cron está operativo.';
            document.getElementById('botonContinuar').classList.remove('d-none');
        }
    } catch (e) {
        // Silencio intencional
    }
}, 10000);
</script>
</body>
</html>
