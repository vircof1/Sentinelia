<?php

class virsoftUtilFecha
{
    /**
     * Convierte una fecha local enviada por el usuario a su equivalente UTC real.
     *
     * @param string $fechaReferenciaUTC          Fecha UTC fija generada en servidor (ej: "2025-03-21 20:00:00")
     * @param string $fechaReferenciaLocal        Hora local equivalente generada en navegador del cliente (ej: "2025-03-21 22:00:00")
     * @param string $fechaIndicadaPorUsuario     Fecha que el usuario ha seleccionado en su zona horaria (ej: "2025-03-14 15:00")
     *
     * @return \DateTime|null     Fecha convertida en UTC, o null si falla el cálculo
     */
    public static function convertirFechaLocalAUTC(string $fechaReferenciaUTC, string $fechaReferenciaLocal, string $fechaIndicadaPorUsuario): ?\DateTime
    {
        // Intentamos convertir todo a timestamps para cálculo rápido
        $tsUTC = strtotime($fechaReferenciaUTC);
        $tsLocal = strtotime($fechaReferenciaLocal);
        $tsUsuario = strtotime($fechaIndicadaPorUsuario);

        if (!$tsUTC || !$tsLocal || !$tsUsuario) {
            return null; // Algún valor no se pudo parsear
        }

        // Desfase horario del usuario = diferencia entre su hora local y la UTC de referencia
        $desfase = $tsLocal - $tsUTC;

        // Aplicamos desfase inverso a la fecha del usuario
        $tsConvertido = $tsUsuario - $desfase;

        // Devolvemos DateTime en UTC
        return (new \DateTime())->setTimestamp($tsConvertido)->setTimezone(new \DateTimeZone("UTC"));
    }
}

?>
