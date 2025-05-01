<!DOCTYPE html>
<html lang="es">
<head>
  <base href="./">
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=no">
  <title>Sentinelia - Login</title>
  <link rel="icon" type="image/svg+xml" href="/Template/Custom/img/Sentinelia.svg">

  <!-- Styles -->
  <link rel="stylesheet" href="Template/vendors/simplebar/css/simplebar.css">
  <link rel="stylesheet" href="Template/css/vendors/simplebar.css">
  <link href="Template/css/style.css" rel="stylesheet">
  <link href="Template/css/examples.css" rel="stylesheet">

  <style>
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
    }

    .login-bg {
      position: relative;
      overflow: hidden;
      min-height: 100vh;
      background-color: #e2e5ec;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .login-bg::before {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: url('/Template/Custom/img/Sentinelia.svg') no-repeat center center;
      background-size: 350px;
      opacity: 0;
      animation: fadePolilla 1.6s ease-out forwards;
      z-index: 1;
    }

    @keyframes fadePolilla {
      from { opacity: 0; }
      to { opacity: 0.42; }
    }

    .card-wrapper {
      position: relative;
      z-index: 2;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      background-color: rgba(255, 255, 255, 0.0);
      transition: background-color 0.8s ease;
    }

    .card-wrapper.loaded {
      background-color: rgba(255, 255, 255, 0.35);
    }

    .card {
      background-color: transparent;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border-radius: 10px;
    }

    .form-control:focus {
      border-color: #6a5acd;
      box-shadow: 0 0 0 0.15rem rgba(106, 90, 205, 0.25);
    }

    .btn-primary {
      background-color: #3f00ff;
      border-color: #3f00ff;
    }

    .btn-primary:hover {
      background-color: #2f00cc;
      border-color: #2f00cc;
    }

    #powLoader {
      display: none;
      text-align: center;
      padding: 2em;
    }

    #powLoader img {
      max-width: 200px;
    }

    #powLoader p {
      margin-top: 1em;
      font-size: 1.2em;
      color: #333;
    }
  </style>
</head>

<body class="login-bg">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-lg-4">
        <div class="card-wrapper">
          <div class="card p-4 mb-0">
            <div class="card-body">

              <!-- FORMULARIO -->
              <div id="loginForm">
                <h1>Entrar:</h1>
                <p class="text-medium-emphasis">Entre con sus credenciales:</p>
                <form action="./" method="POST">
                  <div class="input-group mb-3">
                    <span class="input-group-text">
                      <svg class="icon">
                        <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-user"></use>
                      </svg>
                    </span>
                    <input class="form-control" type="text" placeholder="Usuario" name="virsoftFrameworkLoginUsuario">
                  </div>

                  <div class="input-group mb-4">
                    <span class="input-group-text">
                      <svg class="icon">
                        <use xlink:href="Template/vendors/@coreui/icons/svg/free.svg#cil-lock-locked"></use>
                      </svg>
                    </span>
                    <input class="form-control" type="password" placeholder="Contraseña" name="virsoftFrameworkLoginPassword">
                    <input type="hidden" name="csrf_token" id="csrf_token" value="<?php echo $virsoft->getTokenCSRG(); ?>">
                  </div>

                  <div class="row">
                    <div class="col-6">
                      <button class="btn btn-primary px-4" type="submit">Entrar</button>
                    </div>
                    <div class="col-6 text-end">
                      <button class="btn btn-link px-0" type="button">¿Clave perdida?</button>
                    </div>
                  </div>
                </form>
              </div>

              <!-- CARGANDO POLILLA -->
              <div id="powLoader">
                <img src="Template/Custom/img/PoW_Animation.gif" alt="Procesando PoW...">
                <p id="Estado solicitud" style="color: #856404; background-color: #fff3cd; border: 1px solid #ffeeba; padding: 0.75em; border-radius: 0.35rem;">
				  Procesando Prueba de Trabajo...
				</p>
              </div>

            </div> <!-- .card-body -->
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Scripts -->
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      document.querySelector('.card-wrapper').classList.add('loaded');

      const form = document.querySelector('form');
      const loginForm = document.getElementById('loginForm');
      const powLoader = document.getElementById('powLoader');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();

        // Oculta el formulario y muestra el loader
        loginForm.style.display = 'none';
        powLoader.style.display = 'block';

        const usuario = form.virsoftFrameworkLoginUsuario.value;
        const password = form.virsoftFrameworkLoginPassword.value;

        console.log("📨 Enviando... Usuario:", usuario);

        try {
          const respuesta = await fetch('./?pagina=ApiPowJson');
          if (!respuesta.ok) {
            throw new Error('Error al solicitar prueba PoW');
          }

          const data = await respuesta.json();

          if (!data.estado) {
            throw new Error('PoW rechazado por el servidor');
          }

          const dificultad = data.dificultad;
          const semilla = data.semilla;

          console.log("✅ Prueba recibida:");
          console.log("Semilla:", semilla);
          console.log("Dificultad:", dificultad);

          const tiempoInicio = performance.now();

          const resultado = await resolverPoWAsync(dificultad, semilla);

          const tiempoFin = performance.now();
          const tiempoTotal = ((tiempoFin - tiempoInicio) / 1000).toFixed(2);

          console.log("🔓 PoW resuelto:", resultado);
          console.log("⏱️ Tiempo invertido:", tiempoTotal, "segundos");

          const input = document.createElement("input");
          input.type = "hidden";
          input.name = "resultadoPoW";
          input.value = JSON.stringify(resultado);
          form.appendChild(input);

		
		  // Cambiando texto en la informacion
		  const estado = document.getElementById('Estado solicitud');
			estado.textContent = "✅ Prueba criptografica completada con éxito. Enviando peticion de login.";
			estado.style.color = "#155724";
			estado.style.backgroundColor = "#d4edda";
			estado.style.border = "1px solid #c3e6cb";
          
          // Enviar peticion....
          form.submit();

        } catch (error) {
          console.error("❌ Error durante PoW:", error.message);
          alert("Error en verificación PoW. Intente de nuevo.");

          // Volvemos a mostrar el formulario en caso de error
          loginForm.style.display = 'block';
          powLoader.style.display = 'none';
        }
      });
    });
  </script>

  <script src="Template/vendors/@coreui/coreui/js/coreui.bundle.min.js"></script>
  <script src="Template/vendors/simplebar/js/simplebar.min.js"></script>
  <script src="Template/Custom/JS/crypto.js.min.js"></script>
  <script src="Template/Custom/JS/PoW.js"></script>
</body>
</html>

