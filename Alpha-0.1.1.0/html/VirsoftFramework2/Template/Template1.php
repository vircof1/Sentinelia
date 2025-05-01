<?php
if (!isset($virsoftControlInclude)){die;}
if (!$virsoftControlInclude){die;}
?>
<!DOCTYPE html>
<html>
<head>
    <title><?php echo $virsoftTituloPagina; ?></title>
    <!-- Incluir archivos de estilo -->
    <link rel="stylesheet" href="styles.css">
    
    <?php echo $configuracionVirsoft['scriptsHead']; ?>
</head>
<body>
    <header>
        <!-- Contenido del encabezado -->
    </header>

    <nav>
        <!-- Barra de navegación -->
    </nav>

    <main>
        <?php echo $frameworkContent; ?>
    </main>

    <footer>
        <!-- Pie de página -->
    </footer>

    <!-- Incluir scripts o código al final de la página -->
    <?php 
    
    echo $configuracionVirsoft['scriptsFooter']; 
 
    echo $configuracionVirsoft['scriptsFooter']; 
    if (isset($templateTextoJsLog) && !empty($templateTextoJsLog)) {
        echo $templateTextoJsLog;
    }
    echo $templateTextoJsLog; 
    ?>

</body>
</html>
