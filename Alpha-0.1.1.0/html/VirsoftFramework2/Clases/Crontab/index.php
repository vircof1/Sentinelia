<?php
// Seguridad Basica:
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}


require $configuracionVirsoft['framework_path'] . "Clases/Crontab/logEvent.php";

require $configuracionVirsoft['framework_path'] . "Clases/Crontab/Tarea.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaPing.php";
require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaTCP.php";

#require $configuracionVirsoft['framework_path'] . "Clases/Crontab/TareaSQL.php";



?>
