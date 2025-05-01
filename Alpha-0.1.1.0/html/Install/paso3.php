<?php
// Iniciar sesión y CSRF
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$errores = procesarPost();

$nombre = '';
$apellidos = '';
$email = '';
$usuario = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['nombre'])) { $nombre = trim($_POST['nombre']); }
    if (isset($_POST['apellidos'])) { $apellidos = trim($_POST['apellidos']); }
    if (isset($_POST['email'])) { $email = trim($_POST['email']); }
    if (isset($_POST['usuario'])) { $usuario = trim($_POST['usuario']); }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Instalador de Sentinelia - Crear Primer Usuario</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-light">

<div class="container py-5">
    <h1 class="mb-4">Instalador de Sentinelia</h1>
    <div class="text-success">Paso 3 de 5</div>
    <h2 class="mb-4">Creación del Primer Usuario</h2>

    <?php if (!empty($errores)): ?>
        <div class="alert alert-danger">
            <h5 class="alert-heading">Se encontraron los siguientes errores:</h5>
            <ul class="mb-0">
                <?php foreach ($errores as $error): ?>
                    <li><?php echo htmlspecialchars($error); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="" class="card p-4 shadow-sm" autocomplete="off">
        <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($_SESSION['csrf_token']); ?>">
        <input type="hidden" name="formularioUsuario" value="yes">


        <div class="mb-3">
            <label for="usuario" class="form-label">Nombre de usuario: Será usado en el login de pa página.</label>
            <input type="text" class="form-control" id="usuario" name="usuario" placeholder="Usuario para iniciar sesión" value="<?php echo htmlspecialchars($usuario); ?>" required>
        </div>


        <div class="mb-3">
            <label for="nombre" class="form-label">Nombre</label>
            <input type="text" class="form-control" id="nombre" name="nombre" placeholder="Nombre" value="<?php echo htmlspecialchars($nombre); ?>" required>
        </div>

        <div class="mb-3">
            <label for="apellidos" class="form-label">Apellidos</label>
            <input type="text" class="form-control" id="apellidos" name="apellidos" placeholder="Apellidos" value="<?php echo htmlspecialchars($apellidos); ?>" required>
        </div>

        <div class="mb-3">
            <label for="email" class="form-label">Correo electrónico</label>
            <input type="email" class="form-control" id="email" name="email" placeholder="ejemplo@correo.com" value="<?php echo htmlspecialchars($email); ?>" required>
        </div>



        <div class="mb-3">
            <label for="password" class="form-label">Contraseña</label>
            <input type="password" class="form-control" id="password" name="password" placeholder="Contraseña segura" required>
        </div>

        <div class="mb-3">
            <label for="confirmar_password" class="form-label">Confirmar Contraseña</label>
            <input type="password" class="form-control" id="confirmar_password" name="confirmar_password" placeholder="Repita la contraseña" required>
        </div>

        <div class="text-center">
            <button type="submit" class="btn btn-success">Crear usuario y continuar</button>
        </div>

    </form>
</div>

</body>
</html>

<?php
function procesarPost() {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    $errores = [];

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {

        // CSRF
        if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
            $errores[] = 'Error de seguridad: Token CSRF inválido.';
        }

        // Formulario correcto
        if (!isset($_POST['formularioUsuario']) || $_POST['formularioUsuario'] !== 'yes') {
            $errores[] = 'Error interno: formulario incorrecto.';
        }

        if (empty($errores)) {
            // Recoger datos
            $nombre = isset($_POST['nombre']) ? trim($_POST['nombre']) : '';
            $apellidos = isset($_POST['apellidos']) ? trim($_POST['apellidos']) : '';
            $email = isset($_POST['email']) ? trim($_POST['email']) : '';
            $usuario = isset($_POST['usuario']) ? trim($_POST['usuario']) : '';
            $password = isset($_POST['password']) ? $_POST['password'] : '';
            $confirmarPassword = isset($_POST['confirmar_password']) ? $_POST['confirmar_password'] : '';

            // Validaciones
            if ($nombre === '' || $apellidos === '' || $email === '' || $usuario === '' || $password === '' || $confirmarPassword === '') {
                $errores[] = 'Todos los campos son obligatorios.';
            }

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $errores[] = 'El correo electrónico no es válido.';
            }

            if (strlen($usuario) < 4) {
                $errores[] = 'El nombre de usuario debe tener al menos 4 caracteres.';
            }

            if (strlen($password) < 8) {
                $errores[] = 'La contraseña debe tener al menos 8 caracteres.';
            }

            if ($password !== $confirmarPassword) {
                $errores[] = 'Las contraseñas no coinciden.';
            }

            if (empty($errores)) {
                // Guardar datos del usuario en sesión (hash de la contraseña)
                $_SESSION['sentinelia_instalador_usuario'] = [
                    'nombre'    => $nombre,
                    'apellidos' => $apellidos,
                    'email'     => $email,
                    'usuario'   => $usuario,
                    'pass'		=> $password,
                ];

                // Redirigir al siguiente paso
                header('Location: paso4.php');
                exit;
            }
        }
    }

    return $errores;
}
?>
