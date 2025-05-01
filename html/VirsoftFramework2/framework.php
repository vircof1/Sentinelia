<?php

require $configuracionVirsoft['framework_path'] . "Clases/virsoft.php";
require $configuracionVirsoft['framework_path'] . "Clases/usuario.php";
require $configuracionVirsoft['framework_path'] . "Clases/usuarioS.php";
require $configuracionVirsoft['framework_path'] . "Clases/PoWProtector.php";

// Utilidades:
require $configuracionVirsoft['framework_path'] . "Utilidades/virsoftUtilFecha.php";


// Clases relaccionadas con las tareas:
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/logEvent.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/logEventS.php";

require $configuracionVirsoft['framework_path'] . "Clases/Crontab/Tarea.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaPing.php";
//require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaSQL.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaTCP.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/tareaS.php";

require $configuracionVirsoft['framework_path'] . "Clases/templateContent.php";

require $configuracionVirsoft['framework_path'] . "Clases/ConfiguracionWeb.php";
require $configuracionVirsoft['framework_path'] . "modulos/sesiones.php";



require $configuracionVirsoft['framework_path'] . "modulos/routing.php";

?>
