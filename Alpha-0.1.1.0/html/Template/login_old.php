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
  z-index: 1; /* por debajo del contenido, por encima del fondo base */
}

@keyframes fadePolilla {
  from { opacity: 0; }
  to { opacity: 0.42; } /* aumenta el final sin saturar */
}



    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card {
      background-color: transparent;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border-radius: 10px;
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

    .card:hover {
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
    }

    .form-control {
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
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
  </style>
</head>

<body class="login-bg">
  <div class="container">
    <div class="row justify-content-center">
      <div class="col-lg-4">
        <div class="card-wrapper">
          <div class="card p-4 mb-0">
            <div class="card-body">
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
          </div>
        </div> <!-- .card-wrapper -->
      </div>
    </div>
  </div>

  <!-- Scripts -->
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      document.querySelector('.card-wrapper').classList.add('loaded');
    });
  </script>
  <script src="Template/vendors/@coreui/coreui/js/coreui.bundle.min.js"></script>
  <script src="Template/vendors/simplebar/js/simplebar.min.js"></script>
  
  <script src="Template/Custom/JS/crypto.js.min.js"></script>
  <script src="Template/Custom/JS/PoW.js"></script>
  
</body>
</html>
