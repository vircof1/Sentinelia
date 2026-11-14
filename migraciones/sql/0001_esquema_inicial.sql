
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `actividad_emision_relaciones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultimo_intento_utc` datetime(3) DEFAULT NULL,
  `ultima_actividad_autenticada_utc` datetime(3) DEFAULT NULL,
  `ultimo_error_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `fallos_consecutivos` int(10) unsigned NOT NULL DEFAULT 0,
  `compatibilidad_remota` enum('pendiente','compatible','incompatible') NOT NULL DEFAULT 'pendiente',
  `ultimo_heartbeat_seq` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultima_sesion_id` binary(16) DEFAULT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`),
  KEY `idx_actividad_emision_relacion` (`ultima_actividad_autenticada_utc`,`compatibilidad_remota`,`relacion_id`),
  CONSTRAINT `fk_actividad_emision_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_actividad_emision_error` CHECK (`ultimo_error_codigo` is null or `ultimo_error_codigo` regexp '^[a-z][a-z0-9_.-]{0,63}$'),
  CONSTRAINT `chk_actividad_emision_sesion` CHECK (`ultima_sesion_id` is null or substr(hex(`ultima_sesion_id`),13,1) = '7' and substr(hex(`ultima_sesion_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `agentes_sentinelia` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `guid` char(36) NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `descripcion` varchar(512) DEFAULT NULL,
  `secreto_hash` varchar(255) NOT NULL,
  `version_secreto` bigint(20) unsigned NOT NULL DEFAULT 1,
  `version_scope_agente` bigint(20) unsigned NOT NULL DEFAULT 1,
  `version_autorizacion_agente` bigint(20) unsigned NOT NULL DEFAULT 1,
  `estado_administrativo` varchar(24) NOT NULL DEFAULT 'activo',
  `estado_acceso` varchar(24) NOT NULL DEFAULT 'normal',
  `cuarentena_hasta_utc` datetime DEFAULT NULL,
  `contador_login_fallidos` int(10) unsigned NOT NULL DEFAULT 0,
  `ultimo_login_utc` datetime DEFAULT NULL,
  `ultimo_login_fallido_utc` datetime DEFAULT NULL,
  `ultimo_heartbeat_utc` datetime DEFAULT NULL,
  `ultimo_boot_id` varchar(120) DEFAULT NULL,
  `ultima_version_agente` varchar(80) DEFAULT NULL,
  `ultimo_hostname` varchar(255) DEFAULT NULL,
  `ultimo_seq` bigint(20) unsigned DEFAULT NULL,
  `ultima_sesion_id_diagnostico` varchar(80) DEFAULT NULL,
  `ultima_sesion_huella_sha256` char(64) DEFAULT NULL,
  `sesion_auditoria_id` binary(16) DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agentes_sentinelia_guid` (`guid`),
  UNIQUE KEY `uk_agentes_sentinelia_id_scope` (`id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_agentes_sentinelia_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`estado_administrativo`,`id`),
  KEY `idx_agentes_sentinelia_estado_admin` (`estado_administrativo`,`id`),
  KEY `idx_agentes_sentinelia_estado_acceso` (`estado_acceso`,`cuarentena_hasta_utc`,`id`),
  KEY `idx_agentes_sentinelia_ultimo_heartbeat` (`ultimo_heartbeat_utc`,`id`),
  KEY `fk_agentes_sentinelia_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `fk_agentes_sentinelia_sitio_empresa_tenant` (`sitio_id`,`empresa_id`,`tenant_id`),
  KEY `idx_agentes_sentinelia_sesion_auditoria` (`sesion_auditoria_id`),
  CONSTRAINT `fk_agentes_sentinelia_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_agentes_sentinelia_sitio_empresa_tenant` FOREIGN KEY (`sitio_id`, `empresa_id`, `tenant_id`) REFERENCES `sitios` (`id`, `empresa_id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_agentes_sentinelia_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_agentes_sentinelia_versiones_sesion` CHECK (`version_scope_agente` > 0 and `version_autorizacion_agente` > 0),
  CONSTRAINT `chk_agentes_sentinelia_identidad_sesion` CHECK (`sesion_auditoria_id` is null or `ultima_sesion_id_diagnostico` is null and `ultima_sesion_huella_sha256` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_agentes_sentinelia_impedir_alta_legacy_5_21
BEFORE INSERT ON agentes_sentinelia
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.ultima_sesion_id_diagnostico IS NOT NULL
    OR NEW.ultima_sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un agente nuevo 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_agentes_sentinelia_versiones_monotonicas
BEFORE UPDATE ON agentes_sentinelia
FOR EACH ROW
BEGIN
  IF NEW.version_scope_agente < OLD.version_scope_agente
    OR NEW.version_autorizacion_agente < OLD.version_autorizacion_agente THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Las versiones de sesión del agente no pueden retroceder';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_agentes_sentinelia_impedir_identidad_legacy_5_21
BEFORE UPDATE ON agentes_sentinelia
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.ultima_sesion_id_diagnostico IS NOT NULL
    OR NEW.ultima_sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una fotografia de agente 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_agentes_borrar_monitores_telemetria
BEFORE DELETE ON agentes_sentinelia
FOR EACH ROW
DELETE monitor
FROM monitores AS monitor
INNER JOIN vinculos_monitores_telemetria AS vinculo
  ON vinculo.monitor_id = monitor.id
WHERE vinculo.agente_id = OLD.id
  AND monitor.tipo = 'telemetria' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `alertas_activas_monitores` (
  `monitor_id` bigint(20) unsigned NOT NULL,
  `alerta_auditoria_id` binary(16) NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `version_catalogo` varchar(40) NOT NULL,
  `tipo_monitor` varchar(40) NOT NULL,
  `estado_alerta` varchar(40) NOT NULL DEFAULT 'activa',
  `estado_detectado` varchar(40) NOT NULL,
  `codigo_ultimo_resultado` varchar(80) NOT NULL,
  `mensaje_ultimo_resultado` varchar(500) NOT NULL,
  `valido_desde_utc` datetime NOT NULL,
  `ultima_confirmacion_utc` datetime NOT NULL,
  `ultima_ejecucion_utc` datetime NOT NULL,
  `contador_repeticiones` int(10) unsigned NOT NULL DEFAULT 1,
  `payload_alerta` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_alerta`)),
  `descartada_dashboard` tinyint(1) NOT NULL DEFAULT 0,
  `motivo_descarte` varchar(512) NOT NULL DEFAULT '',
  `descartada_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `descartada_en_utc` datetime DEFAULT NULL,
  `descartada_hasta_utc` datetime DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`monitor_id`),
  UNIQUE KEY `uk_alertas_activas_alerta_auditoria` (`alerta_auditoria_id`),
  KEY `idx_alertas_activas_estado` (`estado_alerta`),
  KEY `idx_alertas_activas_scope_estado` (`tenant_id`,`empresa_id`,`sitio_id`,`estado_alerta`),
  KEY `idx_alertas_activas_confirmacion` (`ultima_confirmacion_utc`),
  KEY `idx_alertas_activas_descarte` (`descartada_dashboard`,`descartada_hasta_utc`),
  KEY `idx_alertas_activas_descarte_usuario` (`descartada_por_usuario_id`),
  CONSTRAINT `fk_alertas_activas_descarte_usuario` FOREIGN KEY (`descartada_por_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_alertas_activas_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_alertas_activas_alerta_auditoria_uuidv7` CHECK (substr(hex(`alerta_auditoria_id`),13,1) = '7' and substr(hex(`alerta_auditoria_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_alertas_activas_proteger_identidad_auditoria
BEFORE UPDATE ON alertas_activas_monitores
FOR EACH ROW
BEGIN
  IF NOT (OLD.alerta_auditoria_id <=> NEW.alerta_auditoria_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'alertaAuditoriaId es inmutable durante todo el ciclo';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `anclajes_retencion_auditoria_remota` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clave_cadena_origen` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultima_secuencia_retirada` bigint(20) unsigned NOT NULL,
  `ultimo_evento_retirado_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hash_actual_ultimo_retirado` binary(32) NOT NULL,
  `hash_ancla_local` binary(32) NOT NULL,
  `primera_secuencia_conservada` bigint(20) unsigned DEFAULT NULL,
  `primer_evento_conservado_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado_continuidad` enum('verificadaDesdeAncla','noVerificable','invalida','sinContenidoConservado') NOT NULL,
  `causa_continuidad` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `eventos_retirados_acumulados` bigint(20) unsigned NOT NULL,
  `politica_dias` smallint(5) unsigned NOT NULL,
  `version_politica` bigint(20) unsigned NOT NULL,
  `aplicado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`,`installation_origen_id`,`clave_cadena_origen`),
  KEY `idx_anclajes_auditoria_remota_aplicacion` (`aplicado_en_utc`,`generacion_id`,`clave_cadena_origen`),
  CONSTRAINT `fk_anclajes_auditoria_remota_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `chk_anclajes_auditoria_remota_identidad` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `ultimo_evento_retirado_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and (`primer_evento_conservado_id` is null or `primer_evento_conservado_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
  CONSTRAINT `chk_anclajes_auditoria_remota_frontera` CHECK (`ultima_secuencia_retirada` >= 1 and `eventos_retirados_acumulados` >= 1 and `politica_dias` between 1 and 3650 and `version_politica` >= 1 and (`primera_secuencia_conservada` is null and `primer_evento_conservado_id` is null and `estado_continuidad` = 'sinContenidoConservado' or `primera_secuencia_conservada` is not null and `primer_evento_conservado_id` is not null and `estado_continuidad` <> 'sinContenidoConservado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_anclajes_retencion_auditoria_remota_monotonos
BEFORE UPDATE ON anclajes_retencion_auditoria_remota
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.generacion_id=OLD.generacion_id
    AND NEW.installation_origen_id=OLD.installation_origen_id
    AND NEW.clave_cadena_origen=OLD.clave_cadena_origen
    AND NEW.ultima_secuencia_retirada>OLD.ultima_secuencia_retirada
    AND NEW.eventos_retirados_acumulados>OLD.eventos_retirados_acumulados
    AND NEW.aplicado_en_utc>=OLD.aplicado_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El anclaje receptor de auditoria solo avanza monotonicamente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `aplicaciones_ocurrencias_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`inbox_ocurrencia_id`),
  UNIQUE KEY `uk_aplicaciones_proyeccion_trabajo` (`trabajo_entrega_id`),
  KEY `idx_aplicaciones_proyeccion_inbox` (`inbox_ocurrencia_id`,`proyeccion_id`),
  CONSTRAINT `fk_aplicaciones_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_aplicaciones_proyeccion_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_aplicaciones_proyeccion_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_aplicaciones_proyeccion_observaciones` CHECK (`veces_observada` >= 1 and `ultima_observacion_utc` >= `primera_observacion_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_aplicaciones_proyeccion_inmutables
BEFORE UPDATE ON aplicaciones_ocurrencias_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.trabajo_entrega_id=OLD.trabajo_entrega_id
    AND NEW.veces_observada>=OLD.veces_observada
    AND NEW.primera_observacion_utc=OLD.primera_observacion_utc
    AND NEW.ultima_observacion_utc>=OLD.ultima_observacion_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La aplicacion de una ocurrencia a su proyeccion es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `aportes_ocurrencias_contribuciones_federacion` (
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `primera_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultima_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `primera_procedencia_canonica` longtext NOT NULL CHECK (json_valid(`primera_procedencia_canonica`)),
  `primera_procedencia_sha256` binary(32) NOT NULL,
  `ultima_procedencia_canonica` longtext NOT NULL CHECK (json_valid(`ultima_procedencia_canonica`)),
  `ultima_procedencia_sha256` binary(32) NOT NULL,
  `vigencia_restante_recepcion_ms` bigint(20) unsigned DEFAULT NULL,
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`contribucion_id`,`inbox_ocurrencia_id`,`generacion_id`),
  KEY `idx_aportes_contribucion_inbox` (`inbox_ocurrencia_id`,`contribucion_id`),
  KEY `fk_aportes_contribucion_primera_entrega` (`primera_entrega_id`),
  KEY `fk_aportes_contribucion_ultima_entrega` (`ultima_entrega_id`),
  KEY `idx_aportes_generacion_contribucion` (`flujo_id`,`generacion_id`,`contribucion_id`),
  CONSTRAINT `fk_aportes_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_aportes_contribucion_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_aportes_contribucion_primera_entrega` FOREIGN KEY (`primera_entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_aportes_contribucion_ultima_entrega` FOREIGN KEY (`ultima_entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_aportes_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_aportes_contribucion_json` CHECK (json_valid(`primera_procedencia_canonica`) and json_valid(`ultima_procedencia_canonica`)),
  CONSTRAINT `chk_aportes_contribucion_observaciones` CHECK (`veces_observada` >= 1 and `primera_observacion_utc` <= `ultima_observacion_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_aportes_contribuciones_identidad_inmutable
BEFORE UPDATE ON aportes_ocurrencias_contribuciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.contribucion_id=OLD.contribucion_id
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.primera_entrega_id=OLD.primera_entrega_id
    AND NEW.primera_procedencia_canonica=OLD.primera_procedencia_canonica
    AND NEW.primera_procedencia_sha256=OLD.primera_procedencia_sha256
    AND NEW.vigencia_restante_recepcion_ms<=>OLD.vigencia_restante_recepcion_ms
    AND NEW.veces_observada>=OLD.veces_observada
    AND NEW.primera_observacion_utc=OLD.primera_observacion_utc
    AND NEW.ultima_observacion_utc>=OLD.ultima_observacion_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad generacional de un aporte es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `arranques_instalacion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `boot_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL DEFAULT 1,
  `iniciado_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `registrado_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_arranques_federacion_boot` (`boot_id`),
  UNIQUE KEY `uk_arranques_federacion_instalacion_boot` (`installation_id`,`boot_id`),
  KEY `idx_arranques_federacion_instalacion_cronologia` (`installation_id`,`iniciado_en_utc`,`id`),
  CONSTRAINT `fk_arranques_federacion_instalacion` FOREIGN KEY (`installation_id`) REFERENCES `identidad_instalacion_federacion` (`installation_id`),
  CONSTRAINT `chk_arranques_federacion_version` CHECK (`version_contrato` = 1),
  CONSTRAINT `chk_arranques_federacion_cronologia` CHECK (`registrado_en_utc` >= `iniciado_en_utc`),
  CONSTRAINT `chk_arranques_federacion_boot_formato` CHECK (`boot_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_arranques_federacion_instalacion_formato` CHECK (`installation_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `arranques_remotos_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_remoto_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  `contador_heartbeats` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`relacion_id`,`boot_remoto_id`),
  KEY `idx_arranques_remotos_ultima` (`ultima_observacion_utc`,`relacion_id`),
  CONSTRAINT `fk_arranques_remotos_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_arranques_remotos_federacion_identidad` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_remoto_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_arranques_remotos_federacion_cronologia` CHECK (`ultima_observacion_utc` >= `primera_observacion_utc` and `contador_heartbeats` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `asignaciones_triggers_monitores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `trigger_id` bigint(20) unsigned NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `orden_ejecucion` smallint(5) unsigned NOT NULL DEFAULT 100,
  `eventos_disparo` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`eventos_disparo`)),
  `configuracion_override` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion_override`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asignacion_monitor_trigger` (`monitor_id`,`trigger_id`),
  KEY `idx_asignacion_monitor_activo_orden` (`monitor_id`,`activo`,`orden_ejecucion`,`id`),
  KEY `idx_asignacion_trigger_activo_orden` (`trigger_id`,`activo`,`orden_ejecucion`,`id`),
  KEY `idx_asignaciones_monitor_id` (`monitor_id`,`id`),
  CONSTRAINT `fk_asignacion_trigger_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_asignacion_trigger_trigger` FOREIGN KEY (`trigger_id`) REFERENCES `triggers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `avisos_plataforma` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `aviso_id` binary(16) NOT NULL,
  `version_catalogo` smallint(5) unsigned NOT NULL,
  `tipo_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `causa_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clave_causal` binary(32) NOT NULL,
  `estado_ciclo` enum('pendiente','resuelto','obsoleto') NOT NULL,
  `clave_causal_activa` binary(32) GENERATED ALWAYS AS (case when `estado_ciclo` = 'pendiente' then `clave_causal` else NULL end) STORED,
  `gravedad` enum('informativa','advertencia','critica') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `objeto_tipo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `objeto_id` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ciclo_anterior_aviso_id` binary(16) DEFAULT NULL,
  `primera_deteccion_utc` datetime(3) NOT NULL,
  `ultima_deteccion_utc` datetime(3) NOT NULL,
  `resuelto_en_utc` datetime(3) DEFAULT NULL,
  `obsoleto_en_utc` datetime(3) DEFAULT NULL,
  `contador_detecciones` bigint(20) unsigned NOT NULL DEFAULT 1,
  `contexto_humano` longtext NOT NULL CHECK (json_valid(`contexto_humano`)),
  `resumen` longtext NOT NULL CHECK (json_valid(`resumen`)),
  `correlacion_apertura_id` binary(16) NOT NULL,
  `evento_apertura_id` binary(16) NOT NULL,
  `evento_ultima_transicion_id` binary(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_avisos_plataforma_aviso` (`aviso_id`),
  UNIQUE KEY `uk_avisos_plataforma_causa_activa` (`clave_causal_activa`),
  UNIQUE KEY `uk_avisos_plataforma_ciclo_anterior` (`ciclo_anterior_aviso_id`),
  KEY `idx_avisos_plataforma_scope_activos` (`estado_ciclo`,`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`gravedad`,`ultima_deteccion_utc`,`aviso_id`),
  KEY `idx_avisos_plataforma_causa_historica` (`clave_causal`,`primera_deteccion_utc`,`aviso_id`),
  KEY `idx_avisos_plataforma_objeto` (`objeto_tipo`,`objeto_id`,`estado_ciclo`,`ultima_deteccion_utc`),
  KEY `fk_avisos_plataforma_causa` (`version_catalogo`,`tipo_codigo`,`causa_codigo`),
  CONSTRAINT `fk_avisos_plataforma_causa` FOREIGN KEY (`version_catalogo`, `tipo_codigo`, `causa_codigo`) REFERENCES `catalogo_causas_avisos_plataforma` (`version_catalogo`, `tipo_codigo`, `causa_codigo`),
  CONSTRAINT `fk_avisos_plataforma_ciclo_anterior` FOREIGN KEY (`ciclo_anterior_aviso_id`) REFERENCES `avisos_plataforma` (`aviso_id`),
  CONSTRAINT `chk_avisos_plataforma_uuidv7` CHECK (substr(hex(`aviso_id`),13,1) = '7' and substr(hex(`aviso_id`),17,1) in ('8','9','A','B') and (`ciclo_anterior_aviso_id` is null or substr(hex(`ciclo_anterior_aviso_id`),13,1) = '7' and substr(hex(`ciclo_anterior_aviso_id`),17,1) in ('8','9','A','B')) and substr(hex(`correlacion_apertura_id`),13,1) = '7' and substr(hex(`correlacion_apertura_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_apertura_id`),13,1) = '7' and substr(hex(`evento_apertura_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_ultima_transicion_id`),13,1) = '7' and substr(hex(`evento_ultima_transicion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_avisos_plataforma_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_avisos_plataforma_referencias_federadas` CHECK ((`relacion_id` is null or `relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`flujo_id` is null or `flujo_id` regexp '^sfid1\\.flujo\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_avisos_plataforma_objeto` CHECK (`objeto_tipo` regexp '^[a-z][a-z0-9_]{0,63}$' and octet_length(`objeto_id`) between 1 and 191),
  CONSTRAINT `chk_avisos_plataforma_cronologia` CHECK (`ultima_deteccion_utc` >= `primera_deteccion_utc` and `contador_detecciones` >= 1),
  CONSTRAINT `chk_avisos_plataforma_estado` CHECK (`estado_ciclo` = 'pendiente' and `resuelto_en_utc` is null and `obsoleto_en_utc` is null or `estado_ciclo` = 'resuelto' and `resuelto_en_utc` is not null and `obsoleto_en_utc` is null or `estado_ciclo` = 'obsoleto' and `resuelto_en_utc` is null and `obsoleto_en_utc` is not null),
  CONSTRAINT `chk_avisos_plataforma_contexto` CHECK (char_length(cast(`contexto_humano` as char charset utf8mb4)) <= 16384 and char_length(cast(`resumen` as char charset utf8mb4)) <= 16384)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_avisos_plataforma_proteger_causalidad
BEFORE UPDATE ON avisos_plataforma
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.aviso_id <=> NEW.aviso_id
    AND OLD.version_catalogo <=> NEW.version_catalogo
    AND OLD.tipo_codigo <=> NEW.tipo_codigo
    AND OLD.causa_codigo <=> NEW.causa_codigo
    AND OLD.clave_causal <=> NEW.clave_causal
    AND OLD.scope_tenant_id <=> NEW.scope_tenant_id
    AND OLD.scope_empresa_id <=> NEW.scope_empresa_id
    AND OLD.scope_sitio_id <=> NEW.scope_sitio_id
    AND OLD.objeto_tipo <=> NEW.objeto_tipo
    AND OLD.objeto_id <=> NEW.objeto_id
    AND OLD.relacion_id <=> NEW.relacion_id
    AND OLD.flujo_id <=> NEW.flujo_id
    AND OLD.ciclo_anterior_aviso_id <=> NEW.ciclo_anterior_aviso_id
    AND OLD.primera_deteccion_utc <=> NEW.primera_deteccion_utc
    AND OLD.correlacion_apertura_id <=> NEW.correlacion_apertura_id
    AND OLD.evento_apertura_id <=> NEW.evento_apertura_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad, causalidad y responsabilidad de un aviso son inmutables';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabecera_bootstrap_usuario_inicial` (
  `id` tinyint(3) unsigned NOT NULL,
  `revision` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_cabecera_bootstrap_usuario_inicial_unica` CHECK (`id` = 1),
  CONSTRAINT `chk_cabecera_bootstrap_usuario_inicial_revision` CHECK (`revision` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `cabecera_bootstrap_usuario_inicial` VALUES
(1,1,'2026-11-07 21:16:43.934');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabecera_configuracion_portal` (
  `id` tinyint(3) unsigned NOT NULL,
  `version` bigint(20) unsigned NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_cabecera_configuracion_portal_unica` CHECK (`id` = 1),
  CONSTRAINT `chk_cabecera_configuracion_portal_version` CHECK (`version` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `cabecera_configuracion_portal` VALUES
(1,1794086203931,'2026-11-07 21:16:47.140');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabecera_generacion_dns` (
  `id` tinyint(3) unsigned NOT NULL,
  `ultima_generacion_dns` bigint(20) unsigned NOT NULL DEFAULT 0,
  `generacion_observada` bigint(20) unsigned DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_cabecera_generacion_dns_singleton` CHECK (`id` = 1),
  CONSTRAINT `chk_cabecera_generacion_dns_observada` CHECK (`generacion_observada` is null or `generacion_observada` > 0 and `generacion_observada` <= `ultima_generacion_dns`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `cabecera_generacion_dns` VALUES
(1,0,NULL,0,'2026-11-07 21:16:43.769','2026-11-07 21:16:43.769');
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_cabecera_generacion_dns_proteger_update
BEFORE UPDATE ON cabecera_generacion_dns
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.id <=> NEW.id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de la cabecera DNS es inmutable';
  END IF;

  IF NEW.ultima_generacion_dns < OLD.ultima_generacion_dns
    OR NEW.ultima_generacion_dns > OLD.ultima_generacion_dns + 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'generacionDns solo puede avanzar de uno en uno';
  END IF;

  IF NEW.fencing_token < OLD.fencing_token
    OR NEW.fencing_token > OLD.fencing_token + 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'fencingToken DNS solo puede avanzar de uno en uno';
  END IF;

  IF OLD.generacion_observada IS NOT NULL AND (
    NEW.generacion_observada IS NULL
    OR NEW.generacion_observada < OLD.generacion_observada
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La generación DNS observada no puede retroceder';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_cabecera_generacion_dns_proteger_delete
BEFORE DELETE ON cabecera_generacion_dns
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La cabecera global de generación DNS no puede eliminarse';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabecera_verificacion_auditoria` (
  `id` tinyint(3) unsigned NOT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 1,
  `cursor_clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultima_ejecucion_utc` datetime(3) DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_cabecera_verificacion_auditoria_unica` CHECK (`id` = 1),
  CONSTRAINT `chk_cabecera_verificacion_auditoria_lease` CHECK (`instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null or `instancia_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null),
  CONSTRAINT `chk_cabecera_verificacion_auditoria_fencing` CHECK (`fencing_token` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `cabecera_verificacion_auditoria` VALUES
(1,NULL,NULL,NULL,1,NULL,NULL,'2026-11-07 21:16:43.954');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabeceras_coordinacion_sesion_agentes` (
  `agente_id` bigint(20) unsigned NOT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`agente_id`),
  CONSTRAINT `chk_cabeceras_sesion_agentes_fencing` CHECK (`fencing_token` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_cabeceras_sesion_agentes_fencing_monotonico
BEFORE UPDATE ON cabeceras_coordinacion_sesion_agentes
FOR EACH ROW
BEGIN
  IF NOT (OLD.agente_id <=> NEW.agente_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de coordinación del agente es inmutable';
  END IF;
  IF NEW.fencing_token < OLD.fencing_token THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El fencing de sesión del agente no puede retroceder';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cabeceras_outbox_auditoria_runtime` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo` enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion') NOT NULL,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `ultimo_orden` bigint(20) unsigned NOT NULL DEFAULT 0,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cabeceras_outbox_auditoria_clave` (`clave_cadena`),
  UNIQUE KEY `uk_cabeceras_outbox_auditoria_id_clave` (`id`,`clave_cadena`),
  CONSTRAINT `chk_cabeceras_outbox_auditoria_clave` CHECK (`tenant_id` is null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':portal') or `tenant_id` is not null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':tenant:',`tenant_id`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_cabeceras_outbox_auditoria_impedir_regresion
BEFORE UPDATE ON cabeceras_outbox_auditoria_runtime
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.id <=> NEW.id
    AND OLD.clave_cadena <=> NEW.clave_cadena
    AND OLD.flujo <=> NEW.flujo
    AND OLD.tenant_id <=> NEW.tenant_id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de la cabecera outbox es inmutable';
  END IF;

  IF NEW.ultimo_orden < OLD.ultimo_orden THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El orden causal outbox no puede retroceder';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cadenas_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo` enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion','internet') NOT NULL,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `ultima_secuencia` bigint(20) unsigned NOT NULL,
  `ultimo_hash` binary(32) NOT NULL,
  `fecha_creacion_utc` datetime(3) NOT NULL,
  `fecha_actualizacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cadenas_auditoria_clave` (`clave_cadena`),
  UNIQUE KEY `uk_cadenas_auditoria_id_clave_flujo` (`id`,`clave_cadena`,`flujo`),
  KEY `idx_cadenas_auditoria_flujo_tenant` (`flujo`,`tenant_id`,`id`),
  CONSTRAINT `chk_cadenas_auditoria_clave_scope` CHECK (`tenant_id` is null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':portal') or `tenant_id` is not null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':tenant:',`tenant_id`)),
  CONSTRAINT `chk_cadenas_auditoria_secuencia` CHECK (`ultima_secuencia` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cambios_pendientes_corte_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prioridad` enum('operativaActual','reconstruccion') NOT NULL,
  `estado` enum('pendiente','absorbida','descartada') NOT NULL DEFAULT 'pendiente',
  `registrada_en_utc` datetime(3) NOT NULL,
  `absorbida_en_utc` datetime(3) DEFAULT NULL,
  `descartada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cambios_pendientes_corte_identidad` (`flujo_id`,`generacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  KEY `fk_cambios_pendientes_ocurrencia` (`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  KEY `idx_cambios_pendientes_corte_orden` (`flujo_id`,`generacion_id`,`estado`,`id`),
  CONSTRAINT `fk_cambios_pendientes_corte` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `cortes_iniciales_generaciones_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_cambios_pendientes_ocurrencia` FOREIGN KEY (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`) REFERENCES `ocurrencias_federacion` (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`),
  CONSTRAINT `chk_cambios_pendientes_corte_estado` CHECK (`estado` = 'pendiente' and `absorbida_en_utc` is null and `descartada_en_utc` is null or `estado` = 'absorbida' and `absorbida_en_utc` is not null and `descartada_en_utc` is null and `absorbida_en_utc` >= `registrada_en_utc` or `estado` = 'descartada' and `absorbida_en_utc` is null and `descartada_en_utc` is not null and `descartada_en_utc` >= `registrada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cambios_pendientes_corte_abierto
BEFORE INSERT ON cambios_pendientes_corte_federacion
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cortes_iniciales_generaciones_federacion c
     WHERE c.flujo_id=NEW.flujo_id AND c.generacion_id=NEW.generacion_id
       AND c.estado='pendiente'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Solo un corte pendiente admite cambios por absorber.';
  END IF;
  IF NEW.estado<>'pendiente' OR NEW.absorbida_en_utc IS NOT NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una marca nueva del corte debe nacer pendiente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cambios_pendientes_corte_inmutables
BEFORE UPDATE ON cambios_pendientes_corte_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id
    AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.installation_origen_id=OLD.installation_origen_id
    AND NEW.familia=OLD.familia
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.ocurrencia_origen_id=OLD.ocurrencia_origen_id
    AND NEW.prioridad=OLD.prioridad
    AND OLD.estado='pendiente'
    AND NEW.estado IN ('absorbida','descartada')
    AND NEW.registrada_en_utc=OLD.registrada_en_utc
    AND OLD.absorbida_en_utc IS NULL
    AND OLD.descartada_en_utc IS NULL
    AND (
      (NEW.estado='absorbida' AND NEW.absorbida_en_utc IS NOT NULL
        AND NEW.descartada_en_utc IS NULL
        AND NEW.absorbida_en_utc>=OLD.registrada_en_utc)
      OR
      (NEW.estado='descartada' AND NEW.absorbida_en_utc IS NULL
        AND NEW.descartada_en_utc IS NOT NULL
        AND NEW.descartada_en_utc>=OLD.registrada_en_utc)
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una marca del corte solo puede finalizar una vez.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `campos_consolidados_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `declaracion_campo_id` bigint(20) unsigned NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `total_soportes_activos` bigint(20) unsigned NOT NULL,
  `consolidado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`nombre_sha256`),
  KEY `idx_campos_consolidados_declaracion` (`declaracion_campo_id`,`proyeccion_id`),
  KEY `fk_campos_consolidados_inbox` (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_campos_consolidados_declaracion` FOREIGN KEY (`declaracion_campo_id`) REFERENCES `declaraciones_campos_inbox_federacion` (`id`),
  CONSTRAINT `fk_campos_consolidados_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_campos_consolidados_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_campos_consolidados_nombre` CHECK (octet_length(`nombre_campo`) between 1 and 2097152),
  CONSTRAINT `chk_campos_consolidados_contadores` CHECK (`secuencia_elemento` >= 1 and `total_soportes_activos` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `campos_fronteras_coherentes_proyecciones_federacion` (
  `frontera_id` bigint(20) unsigned NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `declaracion_campo_id` bigint(20) unsigned NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `total_soportes_activos` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`frontera_id`,`nombre_sha256`),
  KEY `fk_campos_frontera_declaracion` (`declaracion_campo_id`),
  KEY `fk_campos_frontera_inbox` (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_campos_frontera` FOREIGN KEY (`frontera_id`) REFERENCES `fronteras_coherentes_proyecciones_federacion` (`id`),
  CONSTRAINT `fk_campos_frontera_declaracion` FOREIGN KEY (`declaracion_campo_id`) REFERENCES `declaraciones_campos_inbox_federacion` (`id`),
  CONSTRAINT `fk_campos_frontera_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `chk_campos_frontera_contadores` CHECK (`secuencia_elemento` >= 1 and `total_soportes_activos` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_fronteras_coherentes_insercion
BEFORE INSERT ON campos_fronteras_coherentes_proyecciones_federacion
FOR EACH ROW
BEGIN
  DECLARE esta_sellada BOOLEAN DEFAULT TRUE;
  SELECT sellada INTO esta_sellada
    FROM fronteras_coherentes_proyecciones_federacion
   WHERE id=NEW.frontera_id;
  IF esta_sellada THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No pueden agregarse campos a una frontera sellada.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_fronteras_coherentes_update
BEFORE UPDATE ON campos_fronteras_coherentes_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Los campos de una frontera son inmutables.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_fronteras_coherentes_delete
BEFORE DELETE ON campos_fronteras_coherentes_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Los campos de una frontera no pueden eliminarse.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `campos_versiones_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `declaracion_campo_id` bigint(20) unsigned NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `total_soportes_activos` bigint(20) unsigned NOT NULL,
  `consolidado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`nombre_sha256`),
  KEY `idx_campos_version_declaracion` (`declaracion_campo_id`,`proyeccion_id`,`generacion_id`),
  KEY `fk_campos_version_inbox` (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_campos_version_declaracion` FOREIGN KEY (`declaracion_campo_id`) REFERENCES `declaraciones_campos_inbox_federacion` (`id`),
  CONSTRAINT `fk_campos_version_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_campos_version_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_campos_version_nombre` CHECK (octet_length(`nombre_campo`) between 1 and 2097152),
  CONSTRAINT `chk_campos_version_contadores` CHECK (`secuencia_elemento` >= 1 and `total_soportes_activos` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_version_historica_inmutable_insert
BEFORE INSERT ON campos_versiones_proyecciones_federacion
FOR EACH ROW
BEGIN
  DECLARE publicacion_version VARCHAR(16) DEFAULT NULL;
  SELECT estado_publicacion INTO publicacion_version
    FROM versiones_proyecciones_federacion
   WHERE proyeccion_id=NEW.proyeccion_id AND generacion_id=NEW.generacion_id;
  IF publicacion_version IS NULL OR publicacion_version='historica' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fotografia exige una version mutable existente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_version_historica_inmutable_update
BEFORE UPDATE ON campos_versiones_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una fotografia versionada no se modifica en sitio.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_campos_version_historica_inmutable_delete
BEFORE DELETE ON campos_versiones_proyecciones_federacion
FOR EACH ROW
BEGIN
  DECLARE publicacion_version VARCHAR(16) DEFAULT NULL;
  SELECT estado_publicacion INTO publicacion_version
    FROM versiones_proyecciones_federacion
   WHERE proyeccion_id=OLD.proyeccion_id AND generacion_id=OLD.generacion_id;
  IF publicacion_version='historica' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fotografia de una version historica es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `candidaturas_identidad_federacion` (
  `solicitud_canje_id` binary(16) NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int(10) unsigned NOT NULL,
  `installation_remota_candidata_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_remoto_candidato_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_remoto_declarado` varchar(191) NOT NULL,
  `protocolo_version` int(10) unsigned NOT NULL,
  `producto_version` varchar(64) NOT NULL,
  `estado` enum('pendiente','confirmada','sustituida') NOT NULL,
  `relacion_pendiente_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `registrada_en_utc` datetime(3) NOT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  `evento_canje_id` binary(16) NOT NULL,
  `evento_confirmacion_id` binary(16) DEFAULT NULL,
  `correlacion_confirmacion_id` binary(16) DEFAULT NULL,
  `confirmada_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`solicitud_canje_id`),
  UNIQUE KEY `uk_candidaturas_identidad_evento_canje` (`evento_canje_id`),
  UNIQUE KEY `uk_candidaturas_identidad_relacion_ordinal` (`relacion_id`,`ordinal`),
  UNIQUE KEY `uk_candidaturas_identidad_evento_confirmacion` (`evento_confirmacion_id`),
  UNIQUE KEY `uk_candidaturas_identidad_relacion_pendiente` (`relacion_pendiente_id`),
  KEY `idx_candidaturas_identidad_instalacion` (`installation_remota_candidata_id`,`estado`,`relacion_id`),
  KEY `fk_candidaturas_identidad_usuario_confirmacion` (`confirmada_por_usuario_id`),
  CONSTRAINT `fk_candidaturas_identidad_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_candidaturas_identidad_usuario_confirmacion` FOREIGN KEY (`confirmada_por_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_candidaturas_identidad_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_remota_candidata_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_remoto_candidato_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_candidaturas_identidad_contadores` CHECK (`ordinal` >= 1 and `protocolo_version` >= 1),
  CONSTRAINT `chk_candidaturas_identidad_estado` CHECK (`estado` = 'pendiente' and `relacion_pendiente_id` = `relacion_id` and `finalizada_en_utc` is null and `evento_confirmacion_id` is null and `correlacion_confirmacion_id` is null and `confirmada_por_usuario_id` is null or `estado` = 'confirmada' and `relacion_pendiente_id` is null and `finalizada_en_utc` is not null and `evento_confirmacion_id` is not null and `correlacion_confirmacion_id` is not null and `confirmada_por_usuario_id` is not null or `estado` = 'sustituida' and `relacion_pendiente_id` is null and `finalizada_en_utc` is not null and `evento_confirmacion_id` is null and `correlacion_confirmacion_id` is null and `confirmada_por_usuario_id` is null),
  CONSTRAINT `chk_candidaturas_identidad_cronologia` CHECK (`finalizada_en_utc` is null or `finalizada_en_utc` >= `registrada_en_utc`),
  CONSTRAINT `chk_candidaturas_identidad_uuidv7` CHECK (substr(hex(`solicitud_canje_id`),13,1) = '7' and substr(hex(`solicitud_canje_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_canje_id`),13,1) = '7' and substr(hex(`evento_canje_id`),17,1) in ('8','9','A','B') and (`evento_confirmacion_id` is null or substr(hex(`evento_confirmacion_id`),13,1) = '7' and substr(hex(`evento_confirmacion_id`),17,1) in ('8','9','A','B')) and (`correlacion_confirmacion_id` is null or substr(hex(`correlacion_confirmacion_id`),13,1) = '7' and substr(hex(`correlacion_confirmacion_id`),17,1) in ('8','9','A','B')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `capacidades_desuscripcion_correo` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `salida_correo_id` bigint(20) unsigned NOT NULL,
  `trigger_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_id_fotografia` bigint(20) unsigned NOT NULL,
  `perfil_version` smallint(5) unsigned NOT NULL DEFAULT 1,
  `token_hash_sha256` binary(32) NOT NULL,
  `ttl_dias` smallint(5) unsigned NOT NULL,
  `estado` enum('preparada','emitida') NOT NULL DEFAULT 'preparada',
  `emitida_en_utc` datetime(3) DEFAULT NULL,
  `expira_en_utc` datetime(3) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_capacidades_correo_salida` (`salida_correo_id`),
  UNIQUE KEY `uk_capacidades_correo_token` (`token_hash_sha256`),
  KEY `idx_capacidades_correo_trigger` (`trigger_id`,`estado`,`id`),
  KEY `idx_capacidades_correo_expiracion` (`estado`,`expira_en_utc`,`id`),
  CONSTRAINT `fk_capacidades_correo_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`),
  CONSTRAINT `fk_capacidades_correo_trigger` FOREIGN KEY (`trigger_id`) REFERENCES `triggers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_capacidades_correo_version` CHECK (`perfil_version` = 1 and `trigger_id_fotografia` > 0),
  CONSTRAINT `chk_capacidades_correo_ttl` CHECK (`ttl_dias` between 1 and 3650),
  CONSTRAINT `chk_capacidades_correo_estado` CHECK (`estado` = 'preparada' and `emitida_en_utc` is null and `expira_en_utc` is null or `estado` = 'emitida' and `emitida_en_utc` is not null and `expira_en_utc` is not null and `expira_en_utc` > `emitida_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `catalogo_causas_avisos_plataforma` (
  `version_catalogo` smallint(5) unsigned NOT NULL,
  `tipo_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `causa_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `gravedad_inicial` enum('informativa','advertencia','critica') NOT NULL,
  `admite_resolucion_administrativa` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`version_catalogo`,`tipo_codigo`,`causa_codigo`),
  CONSTRAINT `chk_catalogo_causas_avisos_version` CHECK (`version_catalogo` >= 1),
  CONSTRAINT `chk_catalogo_causas_avisos_codigos` CHECK (`tipo_codigo` regexp '^[a-z][a-z0-9_]{0,63}$' and `causa_codigo` regexp '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT `chk_catalogo_causas_avisos_booleanos` CHECK (`admite_resolucion_administrativa` in (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `catalogo_causas_avisos_plataforma` VALUES
(1,'autoridad','perdida_autoridad_responsable','critica',1),
(1,'capacidad','saturacion_prolongada','advertencia',0),
(1,'comunicacion','relacion_silenciosa','advertencia',0),
(1,'consistencia','divergencia_ocurrencia','critica',0),
(1,'consistencia','recuperacion_password_convergencia_redis','advertencia',0),
(1,'dependencia','dependencia_local_incompleta','advertencia',0),
(1,'dependencia','dependencia_local_retirada','advertencia',0),
(1,'generacion','generacion_degradada','advertencia',0),
(1,'generacion','hueco_irrecuperable','critica',0),
(1,'identidad','conflicto_identidad_instalacion','critica',0),
(1,'identidad','sospecha_identidad_instalacion','advertencia',0),
(1,'tiempo','desfase_temporal_fuera_tolerancia','advertencia',0),
(2,'compatibilidad','version_federada_incompatible','advertencia',0),
(3,'tiempo','estado_remoto_vencido','advertencia',0);
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_catalogo_causas_avisos_impedir_update
BEFORE UPDATE ON catalogo_causas_avisos_plataforma
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Las causas versionadas de avisos no se reinterpretan' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_catalogo_causas_avisos_impedir_delete
BEFORE DELETE ON catalogo_causas_avisos_plataforma
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Las causas versionadas de avisos no se eliminan' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `causas_pol_ddns` (
  `causa_id` binary(16) NOT NULL,
  `agente_id_fotografia` bigint(20) unsigned NOT NULL,
  `periodo_vida_pol_id` bigint(20) unsigned NOT NULL,
  `sesion_id_diagnostico` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `secuencia` bigint(20) unsigned NOT NULL,
  `aceptada_en_utc` datetime(3) NOT NULL,
  `direccion_remota` varchar(45) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `familia_direccion` enum('ipv4','ipv6') DEFAULT NULL,
  `estado` enum('pendiente','procesando','reintentable','completada','fallida') NOT NULL DEFAULT 'pendiente',
  `disponible_en_utc` datetime(3) NOT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `intentos` int(10) unsigned NOT NULL DEFAULT 0,
  `codigo_diagnostico` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `mensaje_diagnostico` varchar(512) DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`causa_id`),
  UNIQUE KEY `uk_causas_pol_ddns_periodo_secuencia` (`periodo_vida_pol_id`,`secuencia`),
  KEY `idx_causas_pol_ddns_reclamacion` (`estado`,`disponible_en_utc`,`aceptada_en_utc`,`causa_id`),
  KEY `idx_causas_pol_ddns_lease` (`estado`,`lease_expira_utc`,`causa_id`),
  KEY `idx_causas_pol_ddns_agente` (`agente_id_fotografia`,`aceptada_en_utc`,`causa_id`),
  CONSTRAINT `chk_causas_pol_ddns_uuidv7` CHECK (substr(hex(`causa_id`),13,1) = '7' and substr(hex(`causa_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_causas_pol_ddns_diagnostico` CHECK (`codigo_diagnostico` is null and `mensaje_diagnostico` is null or `codigo_diagnostico` regexp '^[a-z][a-z0-9_]{0,63}$' and octet_length(`mensaje_diagnostico`) between 1 and 512),
  CONSTRAINT `chk_causas_pol_ddns_lease` CHECK (`estado` = 'procesando' and octet_length(`instancia_id`) between 1 and 128 and `lease_token` is not null and `lease_expira_utc` > `actualizada_en_utc` and `fencing_token` > 0 and `intentos` > 0 and `terminada_en_utc` is null or `estado` <> 'procesando' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null),
  CONSTRAINT `chk_causas_pol_ddns_terminal` CHECK (`estado` in ('completada','fallida') and `terminada_en_utc` is not null or `estado` in ('pendiente','procesando','reintentable') and `terminada_en_utc` is null),
  CONSTRAINT `chk_causas_pol_ddns_identidad` CHECK (`agente_id_fotografia` > 0 and `periodo_vida_pol_id` > 0 and (`direccion_remota` is null and `familia_direccion` is null or octet_length(`direccion_remota`) between 2 and 45 and `familia_direccion` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkpoint_reloj_relativo_telemetria` (
  `id` tinyint(3) unsigned NOT NULL,
  `ultimo_reloj_aceptado_utc` datetime DEFAULT NULL,
  `generacion_correccion` bigint(20) unsigned NOT NULL DEFAULT 0,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_checkpoint_reloj_relativo_unico` CHECK (`id` = 1),
  CONSTRAINT `chk_checkpoint_reloj_relativo_generacion` CHECK (`generacion_correccion` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `checkpoint_reloj_relativo_telemetria` VALUES
(1,NULL,0,'2026-11-07 21:16:47.530865','2026-11-07 21:16:47.530865');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkpoints_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cadena_id` bigint(20) unsigned NOT NULL,
  `ultima_secuencia_retirada` bigint(20) unsigned NOT NULL,
  `hash_ultima_secuencia_retirada` binary(32) NOT NULL,
  `primera_secuencia_conservada` bigint(20) unsigned DEFAULT NULL,
  `politica_dias` smallint(5) unsigned NOT NULL,
  `aplicado_en_utc` datetime(3) NOT NULL,
  `evento_retencion_id` binary(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_checkpoints_auditoria_cadena` (`cadena_id`),
  UNIQUE KEY `uk_checkpoints_auditoria_evento_retencion` (`evento_retencion_id`),
  KEY `idx_checkpoints_auditoria_aplicado` (`aplicado_en_utc`,`id`),
  CONSTRAINT `fk_checkpoints_auditoria_cadena` FOREIGN KEY (`cadena_id`) REFERENCES `cadenas_auditoria` (`id`),
  CONSTRAINT `chk_checkpoints_auditoria_secuencias` CHECK (`ultima_secuencia_retirada` >= 1 and (`primera_secuencia_conservada` is null or `primera_secuencia_conservada` = `ultima_secuencia_retirada` + 1)),
  CONSTRAINT `chk_checkpoints_auditoria_politica` CHECK (`politica_dias` between 1 and 36500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ciclos_consolidacion_estados_remotos` (
  `boot_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('abierto','cerrado') NOT NULL,
  `iniciado_en_utc` datetime(3) NOT NULL,
  `limite_en_utc` datetime(3) NOT NULL,
  `cerrado_en_utc` datetime(3) DEFAULT NULL,
  `evento_inicio_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evento_cierre_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version_ciclo` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`boot_id`),
  KEY `idx_ciclos_consolidacion_estado` (`estado`,`limite_en_utc`,`boot_id`),
  CONSTRAINT `chk_ciclos_consolidacion_boot` CHECK (`boot_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_ciclos_consolidacion_estado` CHECK (`version_ciclo` >= 1 and `limite_en_utc` >= `iniciado_en_utc` and (`estado` = 'abierto' and `cerrado_en_utc` is null and `evento_cierre_id` is null or `estado` = 'cerrado' and `cerrado_en_utc` is not null and `evento_cierre_id` is not null and `cerrado_en_utc` >= `iniciado_en_utc`)),
  CONSTRAINT `chk_ciclos_consolidacion_eventos` CHECK (`evento_inicio_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and (`evento_cierre_id` is null or `evento_cierre_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_ciclo_consolidacion_remota_monotono
BEFORE UPDATE ON ciclos_consolidacion_estados_remotos
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.boot_id=OLD.boot_id
    AND OLD.estado='abierto' AND NEW.estado='cerrado'
    AND NEW.iniciado_en_utc=OLD.iniciado_en_utc
    AND NEW.limite_en_utc=OLD.limite_en_utc
    AND NEW.evento_inicio_id=OLD.evento_inicio_id
    AND OLD.evento_cierre_id IS NULL AND NEW.evento_cierre_id IS NOT NULL
    AND NEW.version_ciclo=OLD.version_ciclo+1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El ciclo de consolidacion remota solo puede cerrarse.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cola_correos_salida` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `origen_tipo` enum('prueba','trigger','recuperacion_password','reinicio_password_administrativo','verificacion_email_perfil') NOT NULL DEFAULT 'prueba',
  `productor_version` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'legacy',
  `notificacion_trigger_correo_id` bigint(20) unsigned DEFAULT NULL,
  `ejecucion_trigger_id` bigint(20) unsigned DEFAULT NULL,
  `proposito_recuperacion_password` enum('transportar_solicitud','notificar_cambio') DEFAULT NULL,
  `solicitud_recuperacion_password_id` binary(16) DEFAULT NULL,
  `evento_emision_recuperacion_password_id` binary(16) DEFAULT NULL,
  `clave_operacion_recuperacion_password_sha256` binary(32) DEFAULT NULL,
  `direccion_ip_origen` varchar(45) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `material_preparacion_recuperacion_password` longtext DEFAULT NULL,
  `reinicio_password_administrativo_id` binary(16) DEFAULT NULL,
  `operacion_email_perfil_id` binary(16) DEFAULT NULL,
  `emision_email_perfil_id` binary(16) DEFAULT NULL,
  `clase_emision_email_perfil` enum('inicial','reenvio') DEFAULT NULL,
  `destinatario_email` varchar(190) NOT NULL,
  `destinatario_nombre` varchar(190) DEFAULT NULL,
  `normalizacion_buzon_version` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `clave_buzon_sha256` binary(32) DEFAULT NULL,
  `modo_remitente` enum('fotografiado','configuracion_actual') NOT NULL DEFAULT 'fotografiado',
  `remitente_email` varchar(190) DEFAULT NULL,
  `remitente_nombre` varchar(190) DEFAULT NULL,
  `asunto` varchar(255) NOT NULL,
  `cuerpo_texto` text DEFAULT NULL,
  `smtp_message_id` varchar(384) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado` enum('preparada','pendiente','reclamada','enviando','error_reintentable','enviado','error_final','resultado_ambiguo','descartada') NOT NULL DEFAULT 'pendiente',
  `estado_previo_reclamacion` enum('pendiente','error_reintentable') DEFAULT NULL,
  `claim_id` binary(32) DEFAULT NULL,
  `propietario_claim` varchar(190) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `reclamada_en_utc` datetime(3) DEFAULT NULL,
  `enviando_en_utc` datetime(3) DEFAULT NULL,
  `configuracion_version_ultimo_intento` bigint(20) unsigned DEFAULT NULL,
  `codigo_resultado` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causa_descarte` enum('autoridad_buzon_retirada','operacion_email_perfil_sustituida','operacion_email_perfil_consumida','operacion_email_perfil_expirada','identidad_email_perfil_no_vigente','identidad_email_perfil_distinta','credencial_email_perfil_cambiada','correo_origen_email_perfil_cambiado','proposito_email_perfil_agotado') DEFAULT NULL,
  `respuesta_saneada` text DEFAULT NULL,
  `fecha_terminal_utc` datetime(3) DEFAULT NULL,
  `intentos` int(10) unsigned NOT NULL DEFAULT 0,
  `error_ultimo` text DEFAULT NULL,
  `proximo_intento_en` datetime(3) DEFAULT NULL,
  `creado_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `fecha_creacion` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `fecha_ultimo_intento` datetime(3) DEFAULT NULL,
  `fecha_envio` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cola_correos_notificacion_buzon` (`notificacion_trigger_correo_id`,`clave_buzon_sha256`),
  UNIQUE KEY `uk_cola_correos_smtp_message_id` (`smtp_message_id`),
  UNIQUE KEY `uk_cola_correos_claim_id` (`claim_id`),
  UNIQUE KEY `uk_cola_correos_recuperacion_proposito` (`solicitud_recuperacion_password_id`,`proposito_recuperacion_password`),
  UNIQUE KEY `uk_cola_correos_recuperacion_operacion` (`clave_operacion_recuperacion_password_sha256`),
  UNIQUE KEY `uk_cola_correos_reinicio_password_administrativo` (`reinicio_password_administrativo_id`),
  UNIQUE KEY `uk_cola_correos_emision_email_perfil` (`emision_email_perfil_id`),
  KEY `idx_cola_correos_estado` (`estado`),
  KEY `idx_cola_correos_proximo_intento` (`proximo_intento_en`),
  KEY `idx_cola_correos_usuario` (`creado_por_usuario_id`),
  KEY `idx_cola_correos_reclamacion_sql` (`productor_version`,`estado`,`proximo_intento_en`,`id`),
  KEY `idx_cola_correos_lease` (`productor_version`,`estado`,`lease_expira_utc`,`id`),
  KEY `idx_cola_correos_ejecucion` (`ejecucion_trigger_id`,`id`),
  KEY `fk_cola_correos_notificacion_ejecucion` (`notificacion_trigger_correo_id`,`ejecucion_trigger_id`),
  KEY `idx_cola_correos_retencion` (`origen_tipo`,`estado`,`fecha_terminal_utc`,`ejecucion_trigger_id`,`id`),
  KEY `idx_cola_correos_recuperacion_preparada` (`origen_tipo`,`estado`,`fecha_creacion`,`id`),
  KEY `idx_cola_correos_operacion_email_perfil` (`operacion_email_perfil_id`,`clase_emision_email_perfil`,`id`),
  CONSTRAINT `fk_cola_correos_ejecucion` FOREIGN KEY (`ejecucion_trigger_id`) REFERENCES `ejecuciones_triggers` (`id`),
  CONSTRAINT `fk_cola_correos_notificacion_ejecucion` FOREIGN KEY (`notificacion_trigger_correo_id`, `ejecucion_trigger_id`) REFERENCES `notificaciones_triggers_correo` (`id`, `ejecucion_trigger_id`),
  CONSTRAINT `fk_cola_correos_usuario` FOREIGN KEY (`creado_por_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_cola_correos_remitente` CHECK (`modo_remitente` = 'fotografiado' and `remitente_email` is not null or `modo_remitente` = 'configuracion_actual' and `productor_version` = 'sql@1' and `remitente_email` is null and `remitente_nombre` is null),
  CONSTRAINT `chk_cola_correos_respuesta_saneada` CHECK (`respuesta_saneada` is null or octet_length(`respuesta_saneada`) <= 2000),
  CONSTRAINT `chk_cola_correos_productor` CHECK (`productor_version` in ('legacy','sql@1') and (`productor_version` <> 'legacy' or `origen_tipo` = 'prueba')),
  CONSTRAINT `chk_cola_correos_message_id` CHECK (`productor_version` = 'legacy' and `smtp_message_id` is null or `productor_version` = 'sql@1' and `smtp_message_id` is not null),
  CONSTRAINT `chk_cola_correos_claim` CHECK (`estado` in ('reclamada','enviando') and `productor_version` = 'sql@1' and `estado_previo_reclamacion` is not null and `claim_id` is not null and `propietario_claim` is not null and `lease_token` is not null and `lease_expira_utc` is not null and `reclamada_en_utc` is not null and `lease_expira_utc` > `reclamada_en_utc` or `estado` not in ('reclamada','enviando') and `estado_previo_reclamacion` is null and `claim_id` is null and `propietario_claim` is null and `lease_token` is null and `lease_expira_utc` is null and `reclamada_en_utc` is null and `enviando_en_utc` is null),
  CONSTRAINT `chk_cola_correos_frontera_envio` CHECK (`estado` = 'enviando' and `enviando_en_utc` is not null and `configuracion_version_ultimo_intento` > 0 and `intentos` > 0 or `estado` <> 'enviando'),
  CONSTRAINT `chk_cola_correos_terminal` CHECK (`productor_version` = 'legacy' or `estado` in ('enviado','error_final','resultado_ambiguo','descartada') and `fecha_terminal_utc` is not null or `estado` not in ('enviado','error_final','resultado_ambiguo','descartada') and `fecha_terminal_utc` is null),
  CONSTRAINT `chk_cola_correos_recuperacion_identidad` CHECK (`origen_tipo` <> 'recuperacion_password' and `proposito_recuperacion_password` is null and `solicitud_recuperacion_password_id` is null and `evento_emision_recuperacion_password_id` is null and `clave_operacion_recuperacion_password_sha256` is null and `direccion_ip_origen` is null and `material_preparacion_recuperacion_password` is null or `origen_tipo` = 'recuperacion_password' and `proposito_recuperacion_password` is not null and `solicitud_recuperacion_password_id` is not null and `clave_operacion_recuperacion_password_sha256` is not null and (`proposito_recuperacion_password` = 'transportar_solicitud' and `evento_emision_recuperacion_password_id` is not null and `direccion_ip_origen` is not null or `proposito_recuperacion_password` = 'notificar_cambio' and `evento_emision_recuperacion_password_id` is null and `direccion_ip_origen` is null)),
  CONSTRAINT `chk_cola_correos_reinicio_password_identidad` CHECK (`origen_tipo` <> 'reinicio_password_administrativo' and `reinicio_password_administrativo_id` is null or `origen_tipo` = 'reinicio_password_administrativo' and `reinicio_password_administrativo_id` is not null and substr(hex(`reinicio_password_administrativo_id`),13,1) = '7' and substr(hex(`reinicio_password_administrativo_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_cola_correos_origen` CHECK (`origen_tipo` = 'prueba' and `notificacion_trigger_correo_id` is null and `ejecucion_trigger_id` is null and `clave_buzon_sha256` is null or `origen_tipo` = 'trigger' and `productor_version` = 'sql@1' and `notificacion_trigger_correo_id` is not null and `ejecucion_trigger_id` is not null and `normalizacion_buzon_version` = 'buzon@1' and `clave_buzon_sha256` is not null or `origen_tipo` = 'recuperacion_password' and `productor_version` = 'sql@1' and `notificacion_trigger_correo_id` is null and `ejecucion_trigger_id` is null and `normalizacion_buzon_version` = 'buzon@1' and `clave_buzon_sha256` is not null or `origen_tipo` = 'reinicio_password_administrativo' and `productor_version` = 'sql@1' and `notificacion_trigger_correo_id` is null and `ejecucion_trigger_id` is null and `normalizacion_buzon_version` = 'buzon@1' and `clave_buzon_sha256` is not null or `origen_tipo` = 'verificacion_email_perfil' and `productor_version` = 'sql@1' and `notificacion_trigger_correo_id` is null and `ejecucion_trigger_id` is null and `normalizacion_buzon_version` = 'buzon@1' and `clave_buzon_sha256` is not null),
  CONSTRAINT `chk_cola_correos_email_perfil_identidad` CHECK (`origen_tipo` <> 'verificacion_email_perfil' and `operacion_email_perfil_id` is null and `emision_email_perfil_id` is null and `clase_emision_email_perfil` is null or `origen_tipo` = 'verificacion_email_perfil' and `operacion_email_perfil_id` is not null and `emision_email_perfil_id` is not null and `clase_emision_email_perfil` is not null and substr(hex(`operacion_email_perfil_id`),13,1) in ('1','2','3','4','5','6','7','8') and substr(hex(`operacion_email_perfil_id`),17,1) in ('8','9','A','B') and substr(hex(`emision_email_perfil_id`),13,1) = '7' and substr(hex(`emision_email_perfil_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_cola_correos_recuperacion_preparacion` CHECK (`origen_tipo` = 'recuperacion_password' and `estado` = 'preparada' and `proposito_recuperacion_password` = 'transportar_solicitud' and `cuerpo_texto` is null and `material_preparacion_recuperacion_password` is not null and json_valid(`material_preparacion_recuperacion_password`) and `proximo_intento_en` is null or `origen_tipo` = 'verificacion_email_perfil' and `estado` = 'preparada' and `cuerpo_texto` is not null and `material_preparacion_recuperacion_password` is null and `proximo_intento_en` is null or `estado` <> 'preparada' and `cuerpo_texto` is not null and `material_preparacion_recuperacion_password` is null),
  CONSTRAINT `chk_cola_correos_descarte` CHECK (`estado` = 'descartada' and `causa_descarte` is not null or `estado` <> 'descartada' and `causa_descarte` is null),
  CONSTRAINT `chk_cola_correos_email_perfil_descarte` CHECK (`origen_tipo` = 'verificacion_email_perfil' and `estado` = 'descartada' and `causa_descarte` in ('operacion_email_perfil_sustituida','operacion_email_perfil_consumida','operacion_email_perfil_expirada','identidad_email_perfil_no_vigente','identidad_email_perfil_distinta','credencial_email_perfil_cambiada','correo_origen_email_perfil_cambiado','proposito_email_perfil_agotado') or `origen_tipo` = 'verificacion_email_perfil' and `estado` <> 'descartada' and `causa_descarte` is null or `origen_tipo` <> 'verificacion_email_perfil' and `causa_descarte` not in ('operacion_email_perfil_sustituida','operacion_email_perfil_consumida','operacion_email_perfil_expirada','identidad_email_perfil_no_vigente','identidad_email_perfil_distinta','credencial_email_perfil_cambiada','correo_origen_email_perfil_cambiado','proposito_email_perfil_agotado') or `origen_tipo` <> 'verificacion_email_perfil' and `causa_descarte` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cola_correos_guard_productor
BEFORE INSERT ON cola_correos_salida
FOR EACH ROW
BEGIN
  DECLARE v_estado VARCHAR(32);
  DECLARE v_cola_sql_autoritativa TINYINT DEFAULT 0;
  SELECT estado,cola_sql_autoritativa
    INTO v_estado,v_cola_sql_autoritativa
    FROM estado_despliegue_trigger_correo WHERE id=1;
  IF NEW.productor_version='legacy'
     AND (v_estado IN ('quietud_cola','activado')
       OR v_cola_sql_autoritativa=1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La quietud de correo rechaza productores legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cola_correos_guard_mutacion
BEFORE UPDATE ON cola_correos_salida
FOR EACH ROW
BEGIN
  DECLARE v_estado VARCHAR(32);
  DECLARE v_cola_sql_autoritativa TINYINT DEFAULT 0;
  DECLARE v_completa_preparacion TINYINT DEFAULT 0;
  SELECT estado,cola_sql_autoritativa
    INTO v_estado,v_cola_sql_autoritativa
    FROM estado_despliegue_trigger_correo WHERE id=1;

  IF v_cola_sql_autoritativa=1 AND OLD.productor_version='legacy' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La autoridad SQL de correo rechaza despachadores legacy';
  END IF;

  IF v_estado='quietud_cola'
     AND OLD.productor_version='sql@1'
     AND OLD.origen_tipo='trigger'
     AND OLD.estado IN ('pendiente','error_reintentable')
     AND NEW.estado='reclamada' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La quietud de correo rechaza nuevas reclamaciones SQL de trigger';
  END IF;

  SET v_completa_preparacion=(
    OLD.origen_tipo='recuperacion_password'
    AND OLD.estado='preparada' AND NEW.estado='pendiente'
    AND OLD.cuerpo_texto IS NULL AND NEW.cuerpo_texto IS NOT NULL
    AND OLD.material_preparacion_recuperacion_password IS NOT NULL
    AND NEW.material_preparacion_recuperacion_password IS NULL
  );

  IF OLD.productor_version='sql@1' AND (
       NOT (OLD.productor_version<=>NEW.productor_version)
       OR NOT (OLD.origen_tipo<=>NEW.origen_tipo)
       OR NOT (OLD.notificacion_trigger_correo_id<=>NEW.notificacion_trigger_correo_id)
       OR NOT (OLD.ejecucion_trigger_id<=>NEW.ejecucion_trigger_id)
       OR NOT (OLD.proposito_recuperacion_password<=>NEW.proposito_recuperacion_password)
       OR NOT (OLD.solicitud_recuperacion_password_id<=>NEW.solicitud_recuperacion_password_id)
       OR NOT (OLD.evento_emision_recuperacion_password_id<=>NEW.evento_emision_recuperacion_password_id)
       OR NOT (OLD.clave_operacion_recuperacion_password_sha256<=>NEW.clave_operacion_recuperacion_password_sha256)
       OR NOT (OLD.direccion_ip_origen<=>NEW.direccion_ip_origen)
       OR NOT (OLD.reinicio_password_administrativo_id<=>NEW.reinicio_password_administrativo_id)
       OR NOT (OLD.operacion_email_perfil_id<=>NEW.operacion_email_perfil_id)
       OR NOT (OLD.emision_email_perfil_id<=>NEW.emision_email_perfil_id)
       OR NOT (OLD.clase_emision_email_perfil<=>NEW.clase_emision_email_perfil)
       OR NOT (OLD.destinatario_email<=>NEW.destinatario_email)
       OR NOT (OLD.clave_buzon_sha256<=>NEW.clave_buzon_sha256)
       OR NOT (OLD.normalizacion_buzon_version<=>NEW.normalizacion_buzon_version)
       OR NOT (OLD.modo_remitente<=>NEW.modo_remitente)
       OR NOT (OLD.smtp_message_id<=>NEW.smtp_message_id)
       OR NOT (OLD.asunto<=>NEW.asunto)
       OR (NOT (OLD.cuerpo_texto<=>NEW.cuerpo_texto) AND v_completa_preparacion=0)
       OR (NOT (OLD.material_preparacion_recuperacion_password
          <=>NEW.material_preparacion_recuperacion_password)
          AND v_completa_preparacion=0)
     ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La identidad y el mensaje de una salida SQL son inmutables';
  END IF;

  IF OLD.estado IN ('enviado','error_final','resultado_ambiguo','descartada')
     AND NEW.estado<>OLD.estado THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Una salida de correo terminal no puede reabrirse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `composiciones_lotes_recepcion_federacion` (
  `lote_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal_lote` int(10) unsigned NOT NULL,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`lote_id`,`ordinal_lote`),
  UNIQUE KEY `uk_composiciones_lotes_entrega` (`lote_id`,`entrega_id`),
  KEY `fk_composiciones_lotes_entrega` (`entrega_id`),
  CONSTRAINT `fk_composiciones_lotes_entrega` FOREIGN KEY (`entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_composiciones_lotes_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes_recepcion_federacion` (`lote_id`),
  CONSTRAINT `chk_composiciones_lotes_ordinal` CHECK (`ordinal_lote` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_composiciones_lotes_recepcion_inmutables
BEFORE UPDATE ON composiciones_lotes_recepcion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La composición durable de un lote es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `concesiones_ddns_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `concesion_id` binary(16) NOT NULL,
  `agente_id` bigint(20) unsigned DEFAULT NULL,
  `registro_dns_id` bigint(20) unsigned DEFAULT NULL,
  `agente_id_fotografia` bigint(20) unsigned NOT NULL,
  `registro_dns_id_fotografia` bigint(20) unsigned NOT NULL,
  `estado` enum('vigente','revocada') NOT NULL DEFAULT 'vigente',
  `causa_cierre` enum('revocada_desde_agente','revocada_desde_registro','agente_eliminado','registro_eliminado','objetivo_incompatible') DEFAULT NULL,
  `version_ddns` bigint(20) unsigned NOT NULL DEFAULT 0,
  `decision` enum('pendiente_decision_agente','operativa') NOT NULL DEFAULT 'pendiente_decision_agente',
  `modo` enum('observada','declarada') DEFAULT NULL,
  `intencion_gobernante_id` bigint(20) unsigned DEFAULT NULL,
  `contenido_deseado_canonico` longtext DEFAULT NULL CHECK (json_valid(`contenido_deseado_canonico`)),
  `contenido_deseado_sha256` binary(32) DEFAULT NULL,
  `contenido_publicado_canonico` longtext DEFAULT NULL CHECK (json_valid(`contenido_publicado_canonico`)),
  `contenido_publicado_sha256` binary(32) DEFAULT NULL,
  `generacion_dns_publicada` bigint(20) unsigned DEFAULT NULL,
  `condicion_operativa` enum('pendiente_decision_agente','operativa','esperando_observacion','publicacion_previa_desconocida','registro_no_operable','publicacion_bloqueada','publicacion_fallida') NOT NULL DEFAULT 'pendiente_decision_agente',
  `agente_scope_tenant_id` bigint(20) unsigned NOT NULL,
  `agente_scope_empresa_id` bigint(20) unsigned NOT NULL,
  `agente_scope_sitio_id` bigint(20) unsigned NOT NULL,
  `registro_scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `registro_scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `registro_scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `cerrada_en_utc` datetime(3) DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `registro_dns_id_vigente` bigint(20) unsigned GENERATED ALWAYS AS (case when `estado` = 'vigente' then `registro_dns_id` else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_concesiones_ddns_id_publico` (`concesion_id`),
  UNIQUE KEY `uk_concesiones_ddns_registro_vigente` (`registro_dns_id_vigente`),
  KEY `idx_concesiones_ddns_agente_estado` (`agente_id`,`estado`,`id`),
  KEY `idx_concesiones_ddns_registro_estado` (`registro_dns_id`,`estado`,`id`),
  KEY `idx_concesiones_ddns_agente_fotografia` (`agente_id_fotografia`,`creada_en_utc`,`id`),
  KEY `fk_concesiones_ddns_intencion_gobernante` (`intencion_gobernante_id`),
  CONSTRAINT `fk_concesiones_ddns_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`),
  CONSTRAINT `fk_concesiones_ddns_intencion_gobernante` FOREIGN KEY (`intencion_gobernante_id`) REFERENCES `intenciones_ddns_agentes` (`id`),
  CONSTRAINT `fk_concesiones_ddns_registro` FOREIGN KEY (`registro_dns_id`) REFERENCES `registros_dns` (`id`),
  CONSTRAINT `chk_concesiones_ddns_uuidv7` CHECK (substr(hex(`concesion_id`),13,1) = '7' and substr(hex(`concesion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_concesiones_ddns_extremos` CHECK (`estado` = 'vigente' and `agente_id` is not null and `registro_dns_id` is not null and `causa_cierre` is null and `cerrada_en_utc` is null or `estado` = 'revocada' and `causa_cierre` is not null and `cerrada_en_utc` is not null),
  CONSTRAINT `chk_concesiones_ddns_fotografias` CHECK (`agente_id_fotografia` > 0 and `registro_dns_id_fotografia` > 0 and `agente_scope_tenant_id` > 0 and `agente_scope_empresa_id` > 0 and `agente_scope_sitio_id` > 0 and (`registro_scope_tenant_id` is null and `registro_scope_empresa_id` is null and `registro_scope_sitio_id` is null or `registro_scope_tenant_id` is not null and (`registro_scope_empresa_id` is not null or `registro_scope_sitio_id` is null) and (`registro_scope_sitio_id` is null or `registro_scope_empresa_id` is not null))),
  CONSTRAINT `chk_concesiones_ddns_contenido_deseado` CHECK (`contenido_deseado_canonico` is null and `contenido_deseado_sha256` is null or `contenido_deseado_canonico` is not null and json_valid(`contenido_deseado_canonico`) and `contenido_deseado_sha256` is not null),
  CONSTRAINT `chk_concesiones_ddns_contenido_publicado` CHECK (`contenido_publicado_canonico` is null and `contenido_publicado_sha256` is null and `generacion_dns_publicada` is null or `contenido_publicado_canonico` is not null and json_valid(`contenido_publicado_canonico`) and `contenido_publicado_sha256` is not null and `generacion_dns_publicada` is not null),
  CONSTRAINT `chk_concesiones_ddns_decision` CHECK (`decision` = 'pendiente_decision_agente' and `version_ddns` = 0 and `modo` is null and `intencion_gobernante_id` is null or `decision` = 'operativa' and `version_ddns` > 0 and `modo` is not null and (`estado` = 'revocada' or `intencion_gobernante_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_portal` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `clave` varchar(190) NOT NULL,
  `valor` text DEFAULT NULL,
  `tipo_dato` varchar(20) NOT NULL DEFAULT 'texto',
  `descripcion` varchar(255) DEFAULT NULL,
  `creado_automaticamente` tinyint(1) NOT NULL DEFAULT 1,
  `participa_admision_correo` tinyint(1) NOT NULL DEFAULT 0,
  `invalida_prueba_smtp` tinyint(1) NOT NULL DEFAULT 0,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_configuracion_portal_clave` (`clave`),
  KEY `idx_configuracion_portal_admision_correo` (`participa_admision_correo`,`clave`),
  KEY `idx_configuracion_portal_prueba_smtp` (`invalida_prueba_smtp`,`clave`),
  CONSTRAINT `chk_configuracion_portal_admision_correo` CHECK (`participa_admision_correo` in (0,1)),
  CONSTRAINT `chk_configuracion_portal_prueba_smtp` CHECK (`invalida_prueba_smtp` in (0,1))
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `configuracion_portal` VALUES
(1,'auditoria.retencion_dias',NULL,'entero_nulable','Días de conservación uniforme de todas las series auditables. NULL conserva indefinidamente.',1,0,0,'2026-11-07 21:16:43','2026-11-07 21:16:43'),
(2,'portal.origen_publico','','url','Origen público HTTPS canónico común para enlaces emitidos por el portal.',1,1,0,'2026-11-07 21:16:47','2026-11-07 21:16:47'),
(3,'correo.desuscripcion_ttl_dias','30','entero','Vigencia en días de la capacidad de desuscripción fotografiada al aceptar una entrega.',1,1,0,'2026-11-07 21:16:47','2026-11-07 21:16:47'),
(4,'correo.destinatarios_trigger_maximos','100','entero','Máximo de relaciones destinatarias por trigger de correo.',1,0,0,'2026-11-07 21:16:47','2026-11-07 21:16:47'),
(5,'correo.retencion_salidas_dias','90','entero','Retención especializada de salidas de correo terminales.',1,0,0,'2026-11-07 21:16:47','2026-11-07 21:16:47');
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_configuracion_portal_guard_correo
BEFORE UPDATE ON configuracion_portal
FOR EACH ROW
BEGIN
  DECLARE v_guard_metadatos TINYINT DEFAULT 0;
  DECLARE v_origen_portal_autoritativo TINYINT DEFAULT 0;
  DECLARE v_guard_legacy TINYINT DEFAULT 0;

  SELECT
    guard_metadatos_activo,
    origen_portal_autoritativo,
    guard_verificacion_legacy_activo
  INTO
    v_guard_metadatos,
    v_origen_portal_autoritativo,
    v_guard_legacy
  FROM estado_despliegue_trigger_correo
  WHERE id = 1;

  IF v_guard_legacy = 1
     AND OLD.clave = 'correo.operativo_verificado'
     AND LOWER(TRIM(NEW.valor)) IN ('1', 'true', 'si', 'yes', 'on')
     AND NOT (OLD.valor <=> NEW.valor) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La verificación legacy de correo ya no es autoridad';
  END IF;

  IF v_origen_portal_autoritativo = 1
     AND OLD.clave = 'federacion.origen_publico'
     AND NOT (OLD.valor <=> NEW.valor) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El origen federado legacy ya no es autoridad';
  END IF;

  IF v_guard_metadatos = 1
     AND OLD.invalida_prueba_smtp = 1
     AND NOT (OLD.valor <=> NEW.valor) THEN
    UPDATE estado_verificacion_correo
       SET verificado = 0,
           perfil_version = NULL,
           huella_hmac = NULL,
           key_id = NULL,
           configuracion_version = NULL,
           verificado_por_usuario_id = NULL,
           verificado_en_utc = NULL,
           invalidado_por_usuario_id = NULL,
           invalidado_en_utc = UTC_TIMESTAMP(3),
           codigo_invalidacion = 'guard_sql_configuracion_smtp'
     WHERE id = 1;
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `conflictos_contenido_inbox_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `payload_observado_canonico` mediumtext NOT NULL,
  `payload_observado_sha256` binary(32) NOT NULL,
  `contenido_observado_sha256` binary(32) DEFAULT NULL,
  `contenido_sensible_purgado_en_utc` datetime(3) DEFAULT NULL,
  `veces_observado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_conflictos_inbox_identidad_hash` (`inbox_ocurrencia_id`,`payload_observado_sha256`),
  KEY `idx_conflictos_inbox_contenido` (`inbox_ocurrencia_id`,`contenido_observado_sha256`),
  CONSTRAINT `fk_conflictos_inbox_ocurrencia` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `chk_conflictos_inbox_contenido` CHECK (octet_length(`payload_observado_canonico`) between 2 and 2097152 and json_valid(`payload_observado_canonico`) and `veces_observado` >= 1),
  CONSTRAINT `chk_conflictos_inbox_cronologia` CHECK (`ultima_observacion_utc` >= `primera_observacion_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_conflictos_inbox_contenido_inmutable
BEFORE UPDATE ON conflictos_contenido_inbox_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.payload_observado_canonico=OLD.payload_observado_canonico
    AND NEW.payload_observado_sha256=OLD.payload_observado_sha256
    AND NEW.primera_observacion_utc=OLD.primera_observacion_utc
    AND NEW.veces_observado>=OLD.veces_observado
    AND NEW.ultima_observacion_utc>=OLD.ultima_observacion_utc
    AND (
      (
        NEW.contenido_observado_sha256<=>OLD.contenido_observado_sha256
        AND NEW.contenido_sensible_purgado_en_utc
          <=>OLD.contenido_sensible_purgado_en_utc
      )
      OR
      (
        OLD.contenido_observado_sha256 IS NOT NULL
        AND OLD.contenido_sensible_purgado_en_utc IS NULL
        AND NEW.contenido_observado_sha256 IS NULL
        AND NEW.contenido_sensible_purgado_en_utc IS NOT NULL
      )
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La variante conflictiva solo admite purgar una vez su huella sensible.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contadores_posiciones_generaciones_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultima_posicion` bigint(20) unsigned NOT NULL DEFAULT 0,
  `version_contador` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`flujo_id`,`generacion_id`),
  CONSTRAINT `fk_contadores_posiciones_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_contadores_posiciones_version` CHECK (`version_contador` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_contadores_posiciones_federacion_monotonos
BEFORE UPDATE ON contadores_posiciones_generaciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.flujo_id = OLD.flujo_id
    AND NEW.generacion_id = OLD.generacion_id
    AND NEW.ultima_posicion = OLD.ultima_posicion + 1
    AND NEW.version_contador = OLD.version_contador + 1
    AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El contador de posicion federada solo admite avance monotono unitario.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contadores_publicacion_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultima_version_publicacion` bigint(20) unsigned NOT NULL DEFAULT 0,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`),
  CONSTRAINT `fk_contadores_publicacion_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_contadores_publicacion_proyecciones_transicion
BEFORE UPDATE ON contadores_publicacion_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.ultima_version_publicacion=OLD.ultima_version_publicacion+1
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La version de publicacion de una proyeccion solo avanza.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contadores_secuencia_elementos_federacion` (
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultima_secuencia` bigint(20) unsigned NOT NULL DEFAULT 0,
  `version_contador` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`installation_origen_id`,`familia`,`elemento_origen_id`),
  CONSTRAINT `chk_contadores_elementos_identidades` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_contadores_elementos_version` CHECK (`version_contador` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_contadores_elementos_federacion_monotonos
BEFORE UPDATE ON contadores_secuencia_elementos_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.installation_origen_id = OLD.installation_origen_id
    AND NEW.familia = OLD.familia
    AND NEW.elemento_origen_id = OLD.elemento_origen_id
    AND NEW.ultima_secuencia = OLD.ultima_secuencia + 1
    AND NEW.version_contador = OLD.version_contador + 1
    AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El contador de secuencia federada solo admite avance monotono unitario.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contribuciones_proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_concesion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_emisora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_emisor_ultimo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorrido_sha256` binary(32) NOT NULL,
  `longitud_recorrido` bigint(20) unsigned NOT NULL,
  `estado_autoridad` enum('autorizada','sinAutoridad') NOT NULL,
  `estado_identidad` enum('valida','conflictiva') NOT NULL,
  `estado_compatibilidad` enum('compatible','compatibleParcial','incompatible','desconocida') NOT NULL,
  `resultado_validacion` enum('valida') NOT NULL,
  `estado_integridad` enum('valida','noVerificable') NOT NULL,
  `estado_soporte` enum('activa','retirada') NOT NULL DEFAULT 'activa',
  `causa_retirada_soporte` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `retirada_soporte_en_utc` datetime(3) DEFAULT NULL,
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `primera_comunicacion_valida_utc` datetime(3) NOT NULL,
  `ultima_comunicacion_valida_utc` datetime(3) NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_contribuciones_proyeccion_identidad` (`contribucion_id`),
  UNIQUE KEY `uk_contribuciones_proyeccion_ruta` (`proyeccion_id`,`relacion_id`,`revision_concesion_id`,`recorrido_sha256`),
  KEY `idx_contribuciones_proyeccion_estado` (`proyeccion_id`,`estado_autoridad`,`estado_identidad`,`estado_compatibilidad`,`ultima_comunicacion_valida_utc`),
  KEY `fk_contribuciones_revision_relacion` (`relacion_id`,`revision_concesion_id`),
  KEY `idx_contribuciones_soporte` (`proyeccion_id`,`estado_soporte`,`ultima_comunicacion_valida_utc`),
  CONSTRAINT `fk_contribuciones_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_contribuciones_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_contribuciones_revision_relacion` FOREIGN KEY (`relacion_id`, `revision_concesion_id`) REFERENCES `revisiones_concesion_federacion` (`relacion_id`, `revision_id`),
  CONSTRAINT `chk_contribuciones_identidades` CHECK (`contribucion_id` regexp '^sfid1\\.contribucion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_emisora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_emisor_ultimo_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$' and `revision_concesion_id` regexp '^sfid1\\.revision_concesion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_contribuciones_contadores` CHECK (`longitud_recorrido` >= 1 and `veces_observada` >= 1),
  CONSTRAINT `chk_contribuciones_cronologia` CHECK (`primera_comunicacion_valida_utc` <= `ultima_comunicacion_valida_utc` and `creada_en_utc` <= `actualizada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_contribuciones_identidad_inmutable
BEFORE UPDATE ON contribuciones_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.contribucion_id=OLD.contribucion_id
    AND NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.relacion_id=OLD.relacion_id
    AND NEW.revision_concesion_id=OLD.revision_concesion_id
    AND NEW.installation_emisora_id=OLD.installation_emisora_id
    AND NEW.recorrido_sha256=OLD.recorrido_sha256
    AND NEW.longitud_recorrido=OLD.longitud_recorrido
    AND NEW.veces_observada>=OLD.veces_observada
    AND NEW.primera_comunicacion_valida_utc=OLD.primera_comunicacion_valida_utc
    AND NEW.ultima_comunicacion_valida_utc>=OLD.ultima_comunicacion_valida_utc
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
    AND NOT (OLD.estado_soporte='retirada' AND NEW.estado_soporte='activa')
    AND (
      (NEW.estado_soporte='activa' AND NEW.causa_retirada_soporte IS NULL
        AND NEW.retirada_soporte_en_utc IS NULL)
      OR
      (NEW.estado_soporte='retirada' AND NEW.causa_retirada_soporte IS NOT NULL
        AND NEW.retirada_soporte_en_utc IS NOT NULL)
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad causal de una contribucion es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `control_generaciones_emision_federacion` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_terminal_contigua` bigint(20) unsigned NOT NULL DEFAULT 0,
  `posicion_terminal_remota` bigint(20) unsigned NOT NULL DEFAULT 0,
  `version_cursor_remoto` bigint(20) unsigned NOT NULL DEFAULT 0,
  `pausa_hasta_utc` datetime(3) DEFAULT NULL,
  `causa_pausa` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pausas_consecutivas` int(10) unsigned NOT NULL DEFAULT 0,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`),
  KEY `idx_control_emision_reanudacion` (`pausa_hasta_utc`,`flujo_id`),
  KEY `fk_control_emision_generacion` (`flujo_id`,`generacion_id`),
  CONSTRAINT `fk_control_emision_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_control_emision_pausa` CHECK (`pausa_hasta_utc` is null and `causa_pausa` is null or `pausa_hasta_utc` is not null and `causa_pausa` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cortes_autoridad_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_autoridad` bigint(20) unsigned NOT NULL,
  `causa` enum('usuarioInactivo','usuarioEliminado','scopePerdido','permisoPerdido','organizacionMovida','organizacionEliminada','deshabilitacion','eliminacionRelacion') NOT NULL,
  `responsable_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `corte_en_utc` datetime(3) NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cortes_autoridad_version` (`relacion_id`,`version_autoridad`),
  UNIQUE KEY `uk_cortes_autoridad_evento` (`evento_auditoria_id`),
  KEY `idx_cortes_autoridad_responsable` (`responsable_usuario_id`,`corte_en_utc`,`relacion_id`),
  CONSTRAINT `fk_cortes_autoridad_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_cortes_autoridad_version` CHECK (`version_autoridad` >= 2),
  CONSTRAINT `chk_cortes_autoridad_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_cortes_autoridad_uuidv7` CHECK (substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cortes_autoridad_inmutables
BEFORE UPDATE ON cortes_autoridad_federacion
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El corte de autoridad es append-only.' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cortes_datos_concesion_federacion` (
  `corte_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_anterior_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision_siguiente_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `direccion` enum('emision','recepcion') NOT NULL,
  `causa` enum('reduccionConcesion','sinAutoridad','relacionDeshabilitada','relacionEliminada') NOT NULL,
  `reduccion_canonica` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`reduccion_canonica`)),
  `aplicado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`corte_id`),
  KEY `idx_cortes_datos_relacion` (`relacion_id`,`aplicado_en_utc`,`corte_id`),
  KEY `fk_cortes_datos_revision_anterior` (`revision_anterior_id`),
  KEY `fk_cortes_datos_revision_siguiente` (`revision_siguiente_id`),
  CONSTRAINT `fk_cortes_datos_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_cortes_datos_revision_anterior` FOREIGN KEY (`revision_anterior_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_cortes_datos_revision_siguiente` FOREIGN KEY (`revision_siguiente_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `chk_cortes_datos_reduccion` CHECK (json_valid(`reduccion_canonica`)),
  CONSTRAINT `chk_cortes_datos_identidad` CHECK (`corte_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cortes_datos_concesion_inmutables
BEFORE UPDATE ON cortes_datos_concesion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un corte de datos por concesion es evidencia inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cortes_iniciales_generaciones_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('pendiente','cerrado','cancelado') NOT NULL DEFAULT 'pendiente',
  `frontera_inicial` bigint(20) unsigned DEFAULT NULL,
  `version_corte` bigint(20) unsigned NOT NULL DEFAULT 1,
  `preparado_en_utc` datetime(3) NOT NULL,
  `cerrado_en_utc` datetime(3) DEFAULT NULL,
  `cancelado_en_utc` datetime(3) DEFAULT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`),
  UNIQUE KEY `uk_cortes_iniciales_flujo_generacion` (`flujo_id`,`generacion_id`),
  KEY `idx_cortes_iniciales_estado` (`estado`,`actualizado_en_utc`,`flujo_id`,`generacion_id`),
  CONSTRAINT `fk_cortes_iniciales_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_cortes_iniciales_estado` CHECK (`version_corte` >= 1 and (`estado` = 'pendiente' and `frontera_inicial` is null and `cerrado_en_utc` is null and `cancelado_en_utc` is null or `estado` = 'cerrado' and `frontera_inicial` is not null and `cerrado_en_utc` is not null and `cancelado_en_utc` is null and `cerrado_en_utc` >= `preparado_en_utc` or `estado` = 'cancelado' and `frontera_inicial` is null and `cerrado_en_utc` is null and `cancelado_en_utc` is not null and `cancelado_en_utc` >= `preparado_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cortes_iniciales_generaciones_transicion
BEFORE UPDATE ON cortes_iniciales_generaciones_federacion
FOR EACH ROW
BEGIN
  DECLARE total_posiciones BIGINT UNSIGNED DEFAULT 0;
  DECLARE total_fotografia BIGINT UNSIGNED DEFAULT 0;
  DECLARE maxima_posicion BIGINT UNSIGNED DEFAULT 0;
  DECLARE frontera_generacion BIGINT UNSIGNED DEFAULT 0;

  SELECT COUNT(*),
         COALESCE(SUM(clase_posicion='fotografiaInicial'),0),
         COALESCE(MAX(posicion_flujo),0)
    INTO total_posiciones,total_fotografia,maxima_posicion
    FROM posiciones_ocurrencias_flujos_federacion
   WHERE flujo_id=OLD.flujo_id AND generacion_id=OLD.generacion_id;
  SELECT posicion_inicial_comprometida
    INTO frontera_generacion
    FROM fronteras_generaciones_federacion
   WHERE generacion_id=OLD.generacion_id;

  IF NOT (
    (
      NEW.flujo_id=OLD.flujo_id
      AND NEW.generacion_id=OLD.generacion_id
      AND OLD.estado='pendiente' AND NEW.estado='cerrado'
      AND OLD.frontera_inicial IS NULL
      AND NEW.frontera_inicial=total_posiciones
      AND NEW.version_corte=OLD.version_corte+1
      AND NEW.preparado_en_utc=OLD.preparado_en_utc
      AND NEW.cerrado_en_utc IS NOT NULL
      AND NEW.cancelado_en_utc IS NULL
      AND NEW.actualizado_en_utc>=OLD.actualizado_en_utc
      AND total_fotografia=total_posiciones
      AND (total_posiciones=0 OR maxima_posicion=total_posiciones)
      AND frontera_generacion=NEW.frontera_inicial
    ) OR (
      NEW.flujo_id=OLD.flujo_id
      AND NEW.generacion_id=OLD.generacion_id
      AND OLD.estado='pendiente' AND NEW.estado='cancelado'
      AND OLD.frontera_inicial IS NULL AND NEW.frontera_inicial IS NULL
      AND NEW.version_corte=OLD.version_corte+1
      AND NEW.preparado_en_utc=OLD.preparado_en_utc
      AND NEW.cerrado_en_utc IS NULL
      AND NEW.cancelado_en_utc IS NOT NULL
      AND NEW.actualizado_en_utc>=OLD.actualizado_en_utc
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El corte inicial solo puede cerrarse coherente o cancelarse una vez.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `credenciales_persistentes_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_material` enum('secretoCifrado','verificador') NOT NULL,
  `perfil` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_credencial` int(10) unsigned NOT NULL,
  `installation_local_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `keyring_referencia` varchar(200) DEFAULT NULL,
  `key_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `nonce` binary(12) DEFAULT NULL,
  `ciphertext` varbinary(96) DEFAULT NULL,
  `auth_tag` binary(16) DEFAULT NULL,
  `verificador_salt` binary(32) DEFAULT NULL,
  `verificador_digest` binary(32) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_credenciales_persistentes_federacion_relacion` (`relacion_id`),
  KEY `idx_credenciales_persistentes_federacion_contraparte` (`installation_remota_id`,`tipo_material`,`relacion_id`),
  KEY `idx_credenciales_persistentes_federacion_keyring` (`keyring_referencia`,`key_id`,`relacion_id`),
  CONSTRAINT `fk_credenciales_persistentes_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_credenciales_persistentes_federacion_version` CHECK (`version_credencial` >= 1),
  CONSTRAINT `chk_credenciales_persistentes_federacion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc`),
  CONSTRAINT `chk_credenciales_persistentes_federacion_material` CHECK (`tipo_material` = 'secretoCifrado' and `perfil` = 'sentinelia-federacion-secreto-a256gcm-v1' and `keyring_referencia` is not null and `key_id` is not null and `nonce` is not null and `ciphertext` is not null and octet_length(`ciphertext`) = 69 and `auth_tag` is not null and `verificador_salt` is null and `verificador_digest` is null or `tipo_material` = 'verificador' and `perfil` = 'sentinelia-federacion-verificador-sha256-v1' and `keyring_referencia` is null and `key_id` is null and `nonce` is null and `ciphertext` is null and `auth_tag` is null and `verificador_salt` is not null and `verificador_digest` is not null),
  CONSTRAINT `chk_credenciales_persistentes_federacion_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_local_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_remota_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cursores_generaciones_recepcion_federacion` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_terminal_contigua` bigint(20) unsigned NOT NULL DEFAULT 0,
  `frontera_inicial` bigint(20) unsigned NOT NULL,
  `frontera_inicial_recorrida` tinyint(1) NOT NULL,
  `frontera_inicial_degradada` tinyint(1) NOT NULL DEFAULT 0,
  `prefijo_degradado` tinyint(1) NOT NULL DEFAULT 0,
  `version_cursor` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creado_en_utc` datetime(3) NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`),
  UNIQUE KEY `uk_cursores_recepcion_flujo_generacion` (`flujo_id`,`generacion_id`),
  KEY `idx_cursores_recepcion_progreso` (`flujo_id`,`frontera_inicial_recorrida`,`actualizado_en_utc`),
  CONSTRAINT `fk_cursores_recepcion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_cursores_recepcion_posiciones` CHECK (`version_cursor` >= 1 and `frontera_inicial_recorrida` = (`posicion_terminal_contigua` >= `frontera_inicial`)),
  CONSTRAINT `chk_cursores_recepcion_degradacion` CHECK (`frontera_inicial_degradada` = 0 or `prefijo_degradado` <> 0 or `frontera_inicial_recorrida` = 0),
  CONSTRAINT `chk_cursores_recepcion_cronologia` CHECK (`actualizado_en_utc` >= `creado_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_cursores_recepcion_progresion
BEFORE UPDATE ON cursores_generaciones_recepcion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.generacion_id = OLD.generacion_id
    AND NEW.flujo_id = OLD.flujo_id
    AND NEW.frontera_inicial = OLD.frontera_inicial
    AND NEW.creado_en_utc = OLD.creado_en_utc
    AND NEW.posicion_terminal_contigua >= OLD.posicion_terminal_contigua
    AND NEW.frontera_inicial_recorrida >= OLD.frontera_inicial_recorrida
    AND NEW.frontera_inicial_degradada >= OLD.frontera_inicial_degradada
    AND NEW.prefijo_degradado >= OLD.prefijo_degradado
    AND NEW.version_cursor = OLD.version_cursor + 1
    AND NEW.actualizado_en_utc >= OLD.actualizado_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El cursor receptor solo puede avanzar de forma monotónica.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `decisiones_reconstrucciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `generacion_activa_anterior_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_activa_resultante_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `accion` enum('iniciarReconstruccion','esperarCandidata','ampliarCandidata','sustituirCandidatas','cancelarCandidata','promoverCandidata','revalidarCandidata') NOT NULL,
  `estrategia` enum('esperar','ampliarCompatible','sustituir','coexistir') DEFAULT NULL,
  `resultado` enum('creada','espera','ampliada','sustituida','cancelada','promovida','revalidada') NOT NULL,
  `actor_usuario_id` bigint(20) unsigned NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `motivo` varchar(500) DEFAULT NULL,
  `decidida_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_decisiones_reconstruccion_evento` (`evento_auditoria_id`),
  KEY `idx_decisiones_reconstruccion_flujo` (`flujo_id`,`decidida_en_utc`,`id`),
  KEY `idx_decisiones_reconstruccion_generacion` (`generacion_id`,`decidida_en_utc`,`id`),
  KEY `fk_decisiones_reconstruccion_generacion` (`flujo_id`,`generacion_id`),
  KEY `fk_decisiones_reconstruccion_activa_anterior` (`flujo_id`,`generacion_activa_anterior_id`),
  KEY `fk_decisiones_reconstruccion_activa_resultante` (`flujo_id`,`generacion_activa_resultante_id`),
  KEY `fk_decisiones_reconstruccion_actor` (`actor_usuario_id`),
  CONSTRAINT `fk_decisiones_reconstruccion_activa_anterior` FOREIGN KEY (`flujo_id`, `generacion_activa_anterior_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_decisiones_reconstruccion_activa_resultante` FOREIGN KEY (`flujo_id`, `generacion_activa_resultante_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_decisiones_reconstruccion_actor` FOREIGN KEY (`actor_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_decisiones_reconstruccion_flujo` FOREIGN KEY (`flujo_id`) REFERENCES `flujos_federacion` (`flujo_id`),
  CONSTRAINT `fk_decisiones_reconstruccion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_decisiones_reconstruccion_scope` CHECK (`scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_tenant_id` is not null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is null or `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is not null),
  CONSTRAINT `chk_decisiones_reconstruccion_objetivo` CHECK (`accion` = 'esperarCandidata' and `generacion_id` is null or `accion` <> 'esperarCandidata' and `generacion_id` is not null),
  CONSTRAINT `chk_decisiones_reconstruccion_resultado` CHECK (`accion` = 'iniciarReconstruccion' and `resultado` = 'creada' or `accion` = 'esperarCandidata' and `resultado` = 'espera' or `accion` = 'ampliarCandidata' and `resultado` = 'ampliada' or `accion` = 'sustituirCandidatas' and `resultado` = 'sustituida' or `accion` = 'cancelarCandidata' and `resultado` = 'cancelada' or `accion` = 'promoverCandidata' and `resultado` = 'promovida' or `accion` = 'revalidarCandidata' and `resultado` = 'revalidada'),
  CONSTRAINT `chk_decisiones_reconstruccion_activa` CHECK (`accion` = 'promoverCandidata' and `generacion_id` = `generacion_activa_resultante_id` or `accion` <> 'promoverCandidata' and `generacion_activa_anterior_id` = `generacion_activa_resultante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_decisiones_reconstrucciones_inmutables
BEFORE UPDATE ON decisiones_reconstrucciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Las decisiones de reconstruccion son inmutables.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_decisiones_reconstrucciones_no_borrables
BEFORE DELETE ON decisiones_reconstrucciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Las decisiones de reconstruccion no se eliminan directamente.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `declaraciones_campos_inbox_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `estado` enum('presente','retirado') NOT NULL,
  `sensibilidad` enum('ordinario','sensible') DEFAULT NULL,
  `declaracion_publica_canonica` mediumtext NOT NULL,
  `perfil_custodia` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `keyring_referencia` varchar(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `key_id` varchar(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `nonce` varbinary(32) DEFAULT NULL,
  `ciphertext` mediumblob DEFAULT NULL,
  `auth_tag` varbinary(32) DEFAULT NULL,
  `causa_purga` enum('retiradaCampo','retiradaContribucion','retiradaElemento','retencionAuditoria') DEFAULT NULL,
  `purgada_en_utc` datetime(3) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_declaraciones_campos_inbox_nombre` (`inbox_ocurrencia_id`,`nombre_sha256`),
  KEY `idx_declaraciones_campos_inbox` (`inbox_ocurrencia_id`,`id`),
  KEY `idx_declaraciones_campos_purga` (`sensibilidad`,`purgada_en_utc`,`id`),
  CONSTRAINT `fk_declaraciones_campos_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `chk_declaraciones_campos_inbox_nombre` CHECK (octet_length(`nombre_campo`) between 1 and 2097152),
  CONSTRAINT `chk_declaraciones_campos_inbox_publica` CHECK (octet_length(`declaracion_publica_canonica`) between 2 and 2097152 and json_valid(`declaracion_publica_canonica`)),
  CONSTRAINT `chk_declaraciones_campos_inbox_custodia` CHECK (`estado` = 'retirado' and `sensibilidad` is null and `perfil_custodia` is null and `keyring_referencia` is null and `key_id` is null and `nonce` is null and `ciphertext` is null and `auth_tag` is null and `causa_purga` is null and `purgada_en_utc` is null or `estado` = 'presente' and `sensibilidad` = 'ordinario' and `perfil_custodia` is null and `keyring_referencia` is null and `key_id` is null and `nonce` is null and `ciphertext` is null and `auth_tag` is null and `causa_purga` is null and `purgada_en_utc` is null or `estado` = 'presente' and `sensibilidad` = 'sensible' and (`perfil_custodia` is not null and `keyring_referencia` is not null and `key_id` is not null and `nonce` is not null and `ciphertext` is not null and `auth_tag` is not null and `causa_purga` is null and `purgada_en_utc` is null or `perfil_custodia` is null and `keyring_referencia` is null and `key_id` is null and `nonce` is null and `ciphertext` is null and `auth_tag` is null and `causa_purga` is not null and `purgada_en_utc` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_declaraciones_campos_inbox_inmutables
BEFORE UPDATE ON declaraciones_campos_inbox_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.nombre_sha256=OLD.nombre_sha256
    AND NEW.nombre_campo=OLD.nombre_campo
    AND NEW.estado=OLD.estado
    AND (NEW.sensibilidad<=>OLD.sensibilidad)
    AND NEW.declaracion_publica_canonica=OLD.declaracion_publica_canonica
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND OLD.estado='presente' AND OLD.sensibilidad='sensible'
    AND OLD.perfil_custodia IS NOT NULL
    AND OLD.keyring_referencia IS NOT NULL AND OLD.key_id IS NOT NULL
    AND OLD.nonce IS NOT NULL AND OLD.ciphertext IS NOT NULL
    AND OLD.auth_tag IS NOT NULL AND OLD.causa_purga IS NULL
    AND OLD.purgada_en_utc IS NULL
    AND NEW.perfil_custodia IS NULL
    AND NEW.keyring_referencia IS NULL AND NEW.key_id IS NULL
    AND NEW.nonce IS NULL AND NEW.ciphertext IS NULL
    AND NEW.auth_tag IS NULL AND NEW.causa_purga IS NOT NULL
    AND NEW.purgada_en_utc IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La declaracion global solo admite purgar una vez su custodia sensible.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `declaraciones_disponibilidad_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `declaracion_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_declarante_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `tipo` enum('rangoDisponible','huecoRecuperable','huecoIrrecuperable') NOT NULL,
  `inicio_posicion` bigint(20) unsigned NOT NULL,
  `fin_posicion` bigint(20) unsigned NOT NULL,
  `causa` enum('inventarioFuente','retencionEmisor','saturacionRetencion','ausenciaConfirmada','restauracionIncoherente') NOT NULL,
  `rutas_alternativas_agotadas` tinyint(1) NOT NULL DEFAULT 0,
  `declaracion_canonica` longtext NOT NULL CHECK (json_valid(`declaracion_canonica`)),
  `declaracion_sha256` binary(32) NOT NULL,
  `declarada_en_origen_utc` datetime(3) NOT NULL,
  `recibida_en_utc` datetime(3) NOT NULL,
  `aplicada_cursor_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_declaraciones_disponibilidad_identidad` (`declaracion_id`),
  UNIQUE KEY `uk_declaraciones_disponibilidad_contenido` (`relacion_id`,`flujo_id`,`generacion_id`,`declaracion_sha256`),
  KEY `idx_declaraciones_disponibilidad_rango` (`flujo_id`,`generacion_id`,`tipo`,`inicio_posicion`,`fin_posicion`),
  CONSTRAINT `fk_declaraciones_disponibilidad_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_declaraciones_disponibilidad_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_declaraciones_disponibilidad_identidades` CHECK (`declaracion_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and `installation_declarante_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_declaraciones_disponibilidad_rango` CHECK (`inicio_posicion` >= 1 and `fin_posicion` >= `inicio_posicion`),
  CONSTRAINT `chk_declaraciones_disponibilidad_tipo` CHECK (`tipo` = 'rangoDisponible' and `causa` = 'inventarioFuente' and `rutas_alternativas_agotadas` = 0 or `tipo` = 'huecoRecuperable' and `causa` <> 'inventarioFuente' and `rutas_alternativas_agotadas` = 0 or `tipo` = 'huecoIrrecuperable' and `causa` <> 'inventarioFuente' and `rutas_alternativas_agotadas` = 1),
  CONSTRAINT `chk_declaraciones_disponibilidad_cronologia` CHECK (`recibida_en_utc` + interval 300 second >= `declarada_en_origen_utc` and (`aplicada_cursor_en_utc` is null or `aplicada_cursor_en_utc` >= `recibida_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_declaraciones_disponibilidad_aplicacion
BEFORE UPDATE ON declaraciones_disponibilidad_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id AND NEW.declaracion_id=OLD.declaracion_id
    AND NEW.relacion_id=OLD.relacion_id AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.installation_declarante_id=OLD.installation_declarante_id
    AND NEW.familia=OLD.familia AND NEW.tipo=OLD.tipo
    AND NEW.inicio_posicion=OLD.inicio_posicion
    AND NEW.fin_posicion=OLD.fin_posicion AND NEW.causa=OLD.causa
    AND NEW.rutas_alternativas_agotadas=OLD.rutas_alternativas_agotadas
    AND NEW.declaracion_canonica=OLD.declaracion_canonica
    AND NEW.declaracion_sha256=OLD.declaracion_sha256
    AND NEW.declarada_en_origen_utc=OLD.declarada_en_origen_utc
    AND NEW.recibida_en_utc=OLD.recibida_en_utc
    AND OLD.aplicada_cursor_en_utc IS NULL
    AND NEW.aplicada_cursor_en_utc IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La declaracion de disponibilidad solo puede aplicarse una vez.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `descartes_retencion_recepcion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `ocurrencia_sha256` binary(32) NOT NULL,
  `tiempo_efectivo_origen_utc` datetime(3) NOT NULL,
  `politica_dias` smallint(5) unsigned NOT NULL,
  `version_politica` bigint(20) unsigned NOT NULL,
  `fecha_corte_utc` datetime(3) NOT NULL,
  `descartada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_descartes_retencion_entrega` (`entrega_id`),
  UNIQUE KEY `uk_descartes_retencion_ocurrencia` (`relacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  KEY `idx_descartes_retencion_frontera` (`flujo_id`,`generacion_id`,`posicion_flujo`),
  KEY `fk_descartes_retencion_politica` (`relacion_id`,`familia`),
  CONSTRAINT `fk_descartes_retencion_entrega` FOREIGN KEY (`entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_descartes_retencion_politica` FOREIGN KEY (`relacion_id`, `familia`) REFERENCES `politicas_retencion_recepciones_federacion` (`relacion_id`, `familia`),
  CONSTRAINT `chk_descartes_retencion_identidades` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$' and `ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_descartes_retencion_valores` CHECK (`posicion_flujo` >= 1 and `secuencia_elemento` >= 1 and `politica_dias` between 1 and 3650 and `version_politica` >= 1),
  CONSTRAINT `chk_descartes_retencion_cronologia` CHECK (`tiempo_efectivo_origen_utc` < `fecha_corte_utc` and `descartada_en_utc` >= `fecha_corte_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `descartes_usuarios_alertas_remotas` (
  `usuario_id` bigint(20) unsigned NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `alerta_auditoria_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('vigente','revertido') NOT NULL,
  `motivo` varchar(512) NOT NULL,
  `descartada_en_utc` datetime(3) NOT NULL,
  `descartada_hasta_utc` datetime(3) DEFAULT NULL,
  `revertida_en_utc` datetime(3) DEFAULT NULL,
  `evento_ultima_transicion_id` binary(16) NOT NULL,
  PRIMARY KEY (`usuario_id`,`proyeccion_id`,`alerta_auditoria_id`),
  KEY `idx_descartes_alertas_remotas_vigencia` (`estado`,`descartada_hasta_utc`,`usuario_id`),
  KEY `fk_descartes_alertas_remotas_proyeccion` (`proyeccion_id`),
  CONSTRAINT `fk_descartes_alertas_remotas_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_descartes_alertas_remotas_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_descartes_alertas_remotas_identidades` CHECK (`proyeccion_id` regexp '^sfid1\\.proyeccion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `alerta_auditoria_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and substr(hex(`evento_ultima_transicion_id`),13,1) = '7' and substr(hex(`evento_ultima_transicion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_descartes_alertas_remotas_estado` CHECK (`estado` = 'vigente' and `revertida_en_utc` is null or `estado` = 'revertido' and `revertida_en_utc` is not null),
  CONSTRAINT `chk_descartes_alertas_remotas_cronologia` CHECK ((`descartada_hasta_utc` is null or `descartada_hasta_utc` > `descartada_en_utc`) and (`revertida_en_utc` is null or `revertida_en_utc` >= `descartada_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `descendientes_refederacion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `contribucion_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `recibida_origen_en_utc` datetime(3) NOT NULL,
  `relacion_destino_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_destino_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_destino_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `installation_destino_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operacion` enum('actualizacion','retirada','salidaProyeccion') NOT NULL,
  `procedencia_base_canonica` longtext NOT NULL CHECK (json_valid(`procedencia_base_canonica`)),
  `procedencia_base_sha256` binary(32) NOT NULL,
  `longitud_recorrido_base` bigint(20) unsigned NOT NULL,
  `registrada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_descendiente_refederacion_posicion` (`flujo_destino_id`,`generacion_destino_id`,`posicion_flujo`),
  UNIQUE KEY `uk_descendiente_refederacion_ocurrencia_destino` (`inbox_ocurrencia_id`,`flujo_destino_id`,`generacion_destino_id`),
  KEY `idx_descendiente_refederacion_elemento` (`proyeccion_origen_id`,`contribucion_origen_id`,`operacion`,`flujo_destino_id`,`registrada_en_utc`),
  KEY `fk_descendiente_refederacion_contribucion` (`contribucion_origen_id`),
  KEY `fk_descendiente_refederacion_relacion` (`relacion_destino_id`),
  CONSTRAINT `fk_descendiente_refederacion_contribucion` FOREIGN KEY (`contribucion_origen_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_descendiente_refederacion_posicion` FOREIGN KEY (`flujo_destino_id`, `generacion_destino_id`, `posicion_flujo`) REFERENCES `posiciones_ocurrencias_flujos_federacion` (`flujo_id`, `generacion_id`, `posicion_flujo`),
  CONSTRAINT `fk_descendiente_refederacion_proyeccion` FOREIGN KEY (`proyeccion_origen_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_descendiente_refederacion_relacion` FOREIGN KEY (`relacion_destino_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_descendiente_refederacion_recorrido` CHECK (json_valid(`procedencia_base_canonica`) and `longitud_recorrido_base` >= 1),
  CONSTRAINT `chk_descendiente_refederacion_destino` CHECK (`installation_destino_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_descendientes_refederacion_inmutables
BEFORE UPDATE ON descendientes_refederacion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El registro de un descendiente refederado es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `destinatarios_triggers_correo` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `trigger_id` bigint(20) unsigned NOT NULL,
  `tipo` enum('manual','usuario') NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `email_manual` varchar(190) DEFAULT NULL,
  `email_manual_canonico` varchar(190) DEFAULT NULL,
  `nombre_manual` varchar(190) DEFAULT NULL,
  `normalizacion_buzon_version` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'buzon@1',
  `estado_participacion` enum('activa','desuscrita') NOT NULL DEFAULT 'activa',
  `causa_ultima_desuscripcion` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `desuscrita_en_utc` datetime(3) DEFAULT NULL,
  `reincorporada_en_utc` datetime(3) DEFAULT NULL,
  `cambiada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_creacion_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_destinatarios_correo_trigger_usuario` (`trigger_id`,`usuario_id`),
  UNIQUE KEY `uk_destinatarios_correo_trigger_manual` (`trigger_id`,`email_manual_canonico`),
  KEY `idx_destinatarios_correo_trigger_estado` (`trigger_id`,`estado_participacion`,`id`),
  KEY `idx_destinatarios_correo_usuario` (`usuario_id`,`trigger_id`),
  CONSTRAINT `fk_destinatarios_correo_trigger` FOREIGN KEY (`trigger_id`) REFERENCES `triggers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_destinatarios_correo_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_destinatarios_correo_identidad` CHECK (`tipo` = 'usuario' and `usuario_id` is not null and `email_manual` is null and `email_manual_canonico` is null and `nombre_manual` is null or `tipo` = 'manual' and `usuario_id` is null and `email_manual` is not null and `email_manual_canonico` is not null),
  CONSTRAINT `chk_destinatarios_correo_normalizacion` CHECK (`normalizacion_buzon_version` = 'buzon@1'),
  CONSTRAINT `chk_destinatarios_correo_desuscripcion` CHECK (`causa_ultima_desuscripcion` is null and `desuscrita_en_utc` is null or `causa_ultima_desuscripcion` is not null and `desuscrita_en_utc` is not null),
  CONSTRAINT `chk_destinatarios_correo_cronologia` CHECK (`cambiada_en_utc` >= `fecha_creacion_utc` and (`desuscrita_en_utc` is null or `desuscrita_en_utc` >= `fecha_creacion_utc`) and (`reincorporada_en_utc` is null or `reincorporada_en_utc` >= `fecha_creacion_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `diagnosticos_integridad_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_verificacion` enum('integra','rota','incompleta','concurrente','sin_datos','pendiente') NOT NULL,
  `pendiente_revision` tinyint(1) NOT NULL DEFAULT 0,
  `desde_secuencia` bigint(20) unsigned DEFAULT NULL,
  `hasta_secuencia` bigint(20) unsigned DEFAULT NULL,
  `ultima_secuencia_verificada` bigint(20) unsigned DEFAULT NULL,
  `hash_final_verificado` binary(32) DEFAULT NULL,
  `hash_final_esperado` binary(32) DEFAULT NULL,
  `cabecera_ultima_secuencia` bigint(20) unsigned DEFAULT NULL,
  `cabecera_ultimo_hash` binary(32) DEFAULT NULL,
  `ultima_ejecucion_id` binary(16) NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  `diagnostico` longtext NOT NULL CHECK (json_valid(`diagnostico`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_diagnosticos_integridad_auditoria_cadena` (`clave_cadena`),
  KEY `idx_diagnosticos_integridad_auditoria_estado` (`estado_verificacion`,`pendiente_revision`,`actualizado_en_utc`),
  CONSTRAINT `chk_diagnosticos_integridad_auditoria_intervalo` CHECK (`desde_secuencia` is null or `hasta_secuencia` is null or `desde_secuencia` <= `hasta_secuencia`),
  CONSTRAINT `chk_diagnosticos_integridad_auditoria_pendiente` CHECK (`pendiente_revision` in (0,1) and (`estado_verificacion` = 'pendiente' or `pendiente_revision` = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `divergencias_proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_detectada_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `secuencia_ambigua` bigint(20) unsigned NOT NULL,
  `estado` enum('abierta','esperandoResincronizacion','resueltaEvidencia','resueltaExclusionResincronizada') NOT NULL DEFAULT 'abierta',
  `generacion_frontera_coherente_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `secuencia_frontera_coherente` bigint(20) unsigned DEFAULT NULL,
  `estado_vigencia_frontera` enum('vigente','vencida','retirada') DEFAULT NULL,
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `aviso_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `primera_deteccion_utc` datetime(3) NOT NULL,
  `ultima_deteccion_utc` datetime(3) NOT NULL,
  `resuelta_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_divergencias_proyeccion_posicion` (`proyeccion_id`,`inbox_ocurrencia_id`,`secuencia_ambigua`),
  KEY `idx_divergencias_proyeccion_estado` (`proyeccion_id`,`estado`,`secuencia_ambigua`,`id`),
  KEY `fk_divergencias_generacion_detectada` (`generacion_detectada_id`),
  KEY `fk_divergencias_inbox` (`inbox_ocurrencia_id`),
  KEY `fk_divergencias_generacion_frontera` (`generacion_frontera_coherente_id`),
  CONSTRAINT `fk_divergencias_generacion_detectada` FOREIGN KEY (`generacion_detectada_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_divergencias_generacion_frontera` FOREIGN KEY (`generacion_frontera_coherente_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_divergencias_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_divergencias_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_divergencias_frontera` CHECK (`generacion_frontera_coherente_id` is null and `secuencia_frontera_coherente` is null and `estado_vigencia_frontera` is null or `generacion_frontera_coherente_id` is not null and `secuencia_frontera_coherente` is not null and `estado_vigencia_frontera` is not null and `secuencia_frontera_coherente` < `secuencia_ambigua`),
  CONSTRAINT `chk_divergencias_estado` CHECK (`estado` in ('abierta','esperandoResincronizacion') and `resuelta_en_utc` is null or `estado` in ('resueltaEvidencia','resueltaExclusionResincronizada') and `resuelta_en_utc` is not null),
  CONSTRAINT `chk_divergencias_cronologia` CHECK (`secuencia_ambigua` >= 1 and `veces_observada` >= 1 and `ultima_deteccion_utc` >= `primera_deteccion_utc` and (`resuelta_en_utc` is null or `resuelta_en_utc` >= `primera_deteccion_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ejecuciones_triggers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `asignacion_trigger_monitor_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_id` bigint(20) unsigned DEFAULT NULL,
  `monitor_id` bigint(20) unsigned DEFAULT NULL,
  `monitor_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `monitor_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `monitor_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `empresa_id` bigint(20) unsigned DEFAULT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `version_catalogo` varchar(64) DEFAULT NULL,
  `clave_idempotencia` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evento_disparo` varchar(40) NOT NULL,
  `estado_ejecucion` varchar(40) NOT NULL DEFAULT 'pendiente',
  `tipo_trigger` varchar(40) NOT NULL,
  `trigger_nombre` varchar(160) NOT NULL,
  `monitor_nombre` varchar(160) DEFAULT NULL,
  `codigo_resultado` varchar(80) DEFAULT NULL,
  `mensaje_resultado` varchar(255) DEFAULT NULL,
  `payload_solicitud` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_solicitud`)),
  `payload_respuesta` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_respuesta`)),
  `payload_error` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_error`)),
  `iniciado_en_utc` datetime NOT NULL DEFAULT current_timestamp(),
  `finalizado_en_utc` datetime DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ejecuciones_triggers_idempotencia` (`clave_idempotencia`),
  KEY `idx_ejecuciones_trigger_estado_inicio` (`estado_ejecucion`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_monitor` (`monitor_id`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_trigger` (`trigger_id`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_asignacion` (`asignacion_trigger_monitor_id`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_evento` (`evento_disparo`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_monitor_scope` (`monitor_tenant_id`,`monitor_empresa_id`,`monitor_sitio_id`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_scope_real` (`trigger_tenant_id`,`trigger_empresa_id`,`trigger_sitio_id`,`iniciado_en_utc`,`id`),
  KEY `idx_ejecuciones_trigger_monitor_id` (`monitor_id`,`id`),
  KEY `idx_ejecuciones_trigger_retencion_correo` (`tipo_trigger`,`estado_ejecucion`,`finalizado_en_utc`,`id`),
  CONSTRAINT `fk_ejecuciones_trigger_asignacion` FOREIGN KEY (`asignacion_trigger_monitor_id`) REFERENCES `asignaciones_triggers_monitores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ejecuciones_trigger_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ejecuciones_trigger_trigger` FOREIGN KEY (`trigger_id`) REFERENCES `triggers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ejecuciones_verificacion_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ejecucion_id` binary(16) NOT NULL,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_verificacion` enum('integra','rota','incompleta','concurrente','sin_datos') NOT NULL,
  `desde_secuencia` bigint(20) unsigned DEFAULT NULL,
  `hasta_secuencia` bigint(20) unsigned DEFAULT NULL,
  `ultima_secuencia_verificada` bigint(20) unsigned DEFAULT NULL,
  `hash_final_verificado` binary(32) DEFAULT NULL,
  `hash_final_esperado` binary(32) DEFAULT NULL,
  `cabecera_ultima_secuencia` bigint(20) unsigned DEFAULT NULL,
  `cabecera_ultimo_hash` binary(32) DEFAULT NULL,
  `paginas` int(10) unsigned NOT NULL,
  `eventos_verificados` int(10) unsigned NOT NULL,
  `verificado_en_utc` datetime(3) NOT NULL,
  `diagnostico` longtext NOT NULL CHECK (json_valid(`diagnostico`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ejecuciones_verificacion_auditoria_id` (`ejecucion_id`),
  KEY `idx_ejecuciones_verificacion_auditoria_cadena` (`clave_cadena`,`verificado_en_utc`,`id`),
  CONSTRAINT `chk_ejecuciones_verificacion_auditoria_intervalo` CHECK (`desde_secuencia` is null or `hasta_secuencia` is null or `desde_secuencia` <= `hasta_secuencia`),
  CONSTRAINT `chk_ejecuciones_verificacion_auditoria_hashes` CHECK (`hash_final_verificado` is null and `hash_final_esperado` is null or `hash_final_verificado` is not null and `hash_final_esperado` is not null),
  CONSTRAINT `chk_ejecuciones_verificacion_auditoria_contadores` CHECK (`paginas` >= 0 and `eventos_verificados` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `empresas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `alias` varchar(120) NOT NULL,
  `cif` varchar(40) DEFAULT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `estado` varchar(32) NOT NULL DEFAULT 'activo',
  `configuracion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_empresas_tenant_alias` (`tenant_id`,`alias`),
  UNIQUE KEY `uk_empresas_id_tenant` (`id`,`tenant_id`),
  KEY `idx_empresas_tenant` (`tenant_id`),
  KEY `idx_empresas_estado` (`estado`),
  KEY `idx_empresas_tenant_nombre_id` (`tenant_id`,`nombre`,`id`),
  CONSTRAINT `fk_empresas_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `entregas_recepcion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `ocurrencia_canonica` mediumtext NOT NULL,
  `ocurrencia_sha256` binary(32) NOT NULL,
  `causa_descarte` enum('retencionReceptor') DEFAULT NULL,
  `contenido_descartado_en_utc` datetime(3) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_entregas_recepcion_identidad` (`entrega_id`),
  UNIQUE KEY `uk_entregas_recepcion_posicion` (`flujo_id`,`generacion_id`,`posicion_flujo`),
  KEY `idx_entregas_recepcion_relacion` (`relacion_id`,`flujo_id`,`generacion_id`,`posicion_flujo`),
  CONSTRAINT `fk_entregas_recepcion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_entregas_recepcion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_entregas_recepcion_identidad` CHECK (`entrega_id` regexp '^sfid1\\.entrega\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_entregas_recepcion_contenido` CHECK (`posicion_flujo` >= 1 and octet_length(`ocurrencia_canonica`) between 2 and 16777215 and json_valid(`ocurrencia_canonica`)),
  CONSTRAINT `chk_entregas_recepcion_descarte` CHECK (`causa_descarte` is null and `contenido_descartado_en_utc` is null or `causa_descarte` = 'retencionReceptor' and `contenido_descartado_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_entregas_recepcion_inmutables
BEFORE UPDATE ON entregas_recepcion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id AND NEW.entrega_id=OLD.entrega_id
    AND NEW.relacion_id=OLD.relacion_id AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.posicion_flujo=OLD.posicion_flujo
    AND NEW.ocurrencia_sha256=OLD.ocurrencia_sha256
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND OLD.causa_descarte IS NULL
    AND OLD.contenido_descartado_en_utc IS NULL
    AND NEW.causa_descarte='retencionReceptor'
    AND NEW.contenido_descartado_en_utc IS NOT NULL
    AND JSON_UNQUOTE(JSON_EXTRACT(NEW.ocurrencia_canonica,'$.perfil'))
      ='sentinelia-federacion-descarte-retencion-v1'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La entrega solo admite sanear una vez su payload por retencion.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_actual_evaluacion_reglas_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `evaluacion_id` bigint(20) unsigned DEFAULT NULL,
  `generacion_autoridad` bigint(20) unsigned NOT NULL DEFAULT 1,
  `causalidad_revision` enum('historica_recepcion','autoridad_actual') NOT NULL DEFAULT 'historica_recepcion',
  `regla_id` bigint(20) unsigned NOT NULL,
  `regla_revision_id` bigint(20) unsigned NOT NULL,
  `observacion_id` bigint(20) unsigned NOT NULL,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `resultado` enum('coincide','no_coincide','no_evaluable') NOT NULL,
  `lado_atencion` enum('inferior','superior') DEFAULT NULL,
  `codigo_motivo` varchar(80) NOT NULL,
  `explicacion` varchar(512) NOT NULL,
  `condicion_canonica` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`condicion_canonica`)),
  `valor_evaluado` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`valor_evaluado`)),
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `calidad` varchar(32) NOT NULL,
  `severidad_calculada` varchar(32) DEFAULT NULL,
  `mensaje_operativo` varchar(512) NOT NULL,
  `evidencia_contextual` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`evidencia_contextual`)),
  `observado_en_utc` datetime(6) NOT NULL,
  `recibido_en_utc` datetime(6) NOT NULL,
  `evaluado_en_utc` datetime(6) NOT NULL,
  `proxima_reevaluacion_utc` datetime(6) DEFAULT NULL,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_estado_evaluacion_regla` (`regla_id`),
  UNIQUE KEY `uk_estado_evaluacion_evaluacion` (`evaluacion_id`),
  KEY `idx_estado_evaluacion_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`resultado`,`id`),
  KEY `idx_estado_evaluacion_senal` (`senal_id`,`observado_en_utc`,`observacion_id`),
  KEY `idx_estado_evaluacion_revision` (`regla_revision_id`,`id`),
  KEY `fk_estado_evaluacion_regla_contexto` (`regla_id`,`agente_id`,`senal_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `fk_estado_evaluacion_revision` (`regla_id`,`regla_revision_id`),
  KEY `fk_estado_evaluacion_observacion` (`observacion_id`,`agente_id`,`senal_id`),
  KEY `idx_estado_evaluacion_proxima` (`proxima_reevaluacion_utc`,`regla_id`,`generacion_autoridad`),
  CONSTRAINT `fk_estado_evaluacion_ledger` FOREIGN KEY (`evaluacion_id`) REFERENCES `evaluaciones_reglas_telemetria` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_estado_evaluacion_observacion` FOREIGN KEY (`observacion_id`, `agente_id`, `senal_id`) REFERENCES `observaciones_telemetria_agentes` (`id`, `agente_id`, `senal_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_estado_evaluacion_regla_contexto` FOREIGN KEY (`regla_id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `reglas_derivacion_telemetria` (`id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_estado_evaluacion_revision` FOREIGN KEY (`regla_id`, `regla_revision_id`) REFERENCES `revisiones_reglas_derivacion_telemetria` (`regla_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `chk_estado_evaluacion_severidad` CHECK (`resultado` = 'coincide' and `severidad_calculada` is not null or `resultado` <> 'coincide' and `severidad_calculada` is null),
  CONSTRAINT `chk_estado_evaluacion_condicion_tamano` CHECK (char_length(cast(`condicion_canonica` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_estado_evaluacion_valor_tamano` CHECK (char_length(cast(`valor_evaluado` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_estado_evaluacion_evidencia_tamano` CHECK (`evidencia_contextual` is null or char_length(cast(`evidencia_contextual` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_estado_evaluacion_generacion` CHECK (`generacion_autoridad` > 0),
  CONSTRAINT `chk_estado_evaluacion_lado` CHECK (`causalidad_revision` = 'historica_recepcion' and `lado_atencion` is null or `causalidad_revision` = 'autoridad_actual' and (`resultado` = 'coincide' and `lado_atencion` is not null or `resultado` <> 'coincide' and `lado_atencion` is null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_actual_monitores` (
  `monitor_id` bigint(20) unsigned NOT NULL,
  `version_catalogo` varchar(40) NOT NULL,
  `estado` varchar(40) NOT NULL DEFAULT 'desconocido',
  `ejecutado_todavia` tinyint(1) NOT NULL DEFAULT 0,
  `pendiente_scheduler` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_ultima_ejecucion_utc` datetime DEFAULT NULL,
  `fecha_ultimo_cambio_utc` datetime DEFAULT NULL,
  `resultado_actual` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`resultado_actual`)),
  `motivo_inicial` varchar(80) NOT NULL DEFAULT 'pendiente_de_scheduler',
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`monitor_id`),
  KEY `idx_estado_actual_monitores_estado` (`estado`),
  KEY `idx_estado_actual_monitores_pendiente` (`pendiente_scheduler`,`ejecutado_todavia`),
  CONSTRAINT `fk_estado_actual_monitores_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_actual_telemetria_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned DEFAULT NULL,
  `ultima_observacion_id` bigint(20) unsigned DEFAULT NULL,
  `periodo_vida_pol_id` bigint(20) unsigned DEFAULT NULL,
  `sesion_id_diagnostico` varchar(80) DEFAULT NULL,
  `sesion_huella_sha256` char(64) DEFAULT NULL,
  `sesion_auditoria_id` binary(16) DEFAULT NULL,
  `categoria` varchar(64) NOT NULL,
  `clave` varchar(128) NOT NULL,
  `tag` varchar(128) NOT NULL DEFAULT '',
  `codigo_senal` varchar(384) NOT NULL,
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `valor_numero` double DEFAULT NULL,
  `valor_booleano` tinyint(1) DEFAULT NULL,
  `valor_texto` varchar(2048) DEFAULT NULL,
  `valor_estado` varchar(128) DEFAULT NULL,
  `valor_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`valor_json`)),
  `valor_duracion` double DEFAULT NULL,
  `valor_momento_utc` datetime DEFAULT NULL,
  `calidad` varchar(32) NOT NULL DEFAULT 'valida',
  `severidad_declarada` varchar(32) NOT NULL DEFAULT 'info',
  `origen` varchar(32) NOT NULL DEFAULT 'directa',
  `vigente_hasta_utc` datetime DEFAULT NULL,
  `detalle_humano` varchar(512) DEFAULT NULL,
  `metadatos_contextuales` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadatos_contextuales`)),
  `emitido_en_utc` datetime DEFAULT NULL,
  `observado_en_utc` datetime NOT NULL,
  `recibido_en_utc` datetime(6) NOT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_estado_actual_telemetria_identidad` (`agente_id`,`categoria`,`clave`,`tag`),
  UNIQUE KEY `uk_estado_actual_telemetria_senal` (`senal_id`),
  KEY `idx_estado_actual_telemetria_agente_observado` (`agente_id`,`observado_en_utc`,`id`),
  KEY `idx_estado_actual_telemetria_agente_recibido` (`agente_id`,`recibido_en_utc`,`id`),
  KEY `idx_estado_actual_telemetria_codigo` (`agente_id`,`codigo_senal`),
  KEY `idx_estado_actual_telemetria_vigencia` (`vigente_hasta_utc`,`agente_id`,`id`),
  KEY `idx_estado_actual_telemetria_periodo` (`periodo_vida_pol_id`,`observado_en_utc`,`id`),
  KEY `fk_estado_actual_telemetria_observacion` (`ultima_observacion_id`),
  KEY `idx_estado_actual_telemetria_sesion_auditoria` (`sesion_auditoria_id`,`observado_en_utc`,`id`),
  CONSTRAINT `fk_estado_actual_telemetria_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_estado_actual_telemetria_observacion` FOREIGN KEY (`ultima_observacion_id`) REFERENCES `observaciones_telemetria_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_estado_actual_telemetria_periodo_pol` FOREIGN KEY (`periodo_vida_pol_id`) REFERENCES `periodos_vida_pol_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_estado_actual_telemetria_senal` FOREIGN KEY (`senal_id`) REFERENCES `senales_telemetria_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_estado_actual_telemetria_booleano` CHECK (`valor_booleano` is null or `valor_booleano` in (0,1)),
  CONSTRAINT `chk_estado_actual_telemetria_valor_json_tamano` CHECK (`valor_json` is null or char_length(cast(`valor_json` as char charset utf8mb4)) <= 2048),
  CONSTRAINT `chk_estado_actual_telemetria_metadatos_tamano` CHECK (`metadatos_contextuales` is null or char_length(cast(`metadatos_contextuales` as char charset utf8mb4)) <= 2048),
  CONSTRAINT `chk_estado_actual_telemetria_identidad_sesion` CHECK (`sesion_auditoria_id` is null or `sesion_id_diagnostico` is null and `sesion_huella_sha256` is null),
  CONSTRAINT `chk_estado_actual_telemetria_valor_por_tipo` CHECK (`tipo_dato` = 'numero' and `valor_numero` is not null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'booleano' and `valor_numero` is null and `valor_booleano` is not null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'texto' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is not null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'estado' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is not null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'json' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is not null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'duracion' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is not null and `valor_duracion` >= 0 and `valor_momento_utc` is null or `tipo_dato` = 'momento_utc' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_estado_actual_impedir_alta_legacy_5_21
BEFORE INSERT ON estado_actual_telemetria_agentes
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.sesion_id_diagnostico IS NOT NULL
    OR NEW.sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un estado actual nuevo 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_estado_actual_impedir_identidad_legacy_5_21
BEFORE UPDATE ON estado_actual_telemetria_agentes
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.sesion_id_diagnostico IS NOT NULL
    OR NEW.sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un estado actual 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_concesion_relaciones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_oferta_actual_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision_aceptacion_actual_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision_efectiva_actual_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`),
  KEY `fk_estado_concesion_oferta` (`revision_oferta_actual_id`),
  KEY `fk_estado_concesion_aceptacion` (`revision_aceptacion_actual_id`),
  KEY `fk_estado_concesion_efectiva` (`revision_efectiva_actual_id`),
  CONSTRAINT `fk_estado_concesion_aceptacion` FOREIGN KEY (`revision_aceptacion_actual_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_estado_concesion_efectiva` FOREIGN KEY (`revision_efectiva_actual_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_estado_concesion_oferta` FOREIGN KEY (`revision_oferta_actual_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_estado_concesion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_estado_concesion_revision` CHECK (`revision` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_despliegue_trigger_correo` (
  `id` tinyint(3) unsigned NOT NULL,
  `perfil_objetivo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('preparacion','corte_origen','corte_verificacion','quietud_cola','activado') NOT NULL DEFAULT 'preparacion',
  `guard_metadatos_activo` tinyint(1) NOT NULL DEFAULT 0,
  `origen_portal_autoritativo` tinyint(1) NOT NULL DEFAULT 0,
  `verificacion_smtp_autoritativa` tinyint(1) NOT NULL DEFAULT 0,
  `guard_verificacion_legacy_activo` tinyint(1) NOT NULL DEFAULT 0,
  `guard_revision_trigger_activo` tinyint(1) NOT NULL DEFAULT 0,
  `cola_sql_autoritativa` tinyint(1) NOT NULL DEFAULT 0,
  `tipo_correo_habilitado` tinyint(1) NOT NULL DEFAULT 0,
  `revision` bigint(20) unsigned NOT NULL DEFAULT 1,
  `preparado_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `cortado_en_utc` datetime(3) DEFAULT NULL,
  `quietud_iniciada_en_utc` datetime(3) DEFAULT NULL,
  `quietud_observada_en_utc` datetime(3) DEFAULT NULL,
  `activado_en_utc` datetime(3) DEFAULT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_estado_despliegue_correo_unico` CHECK (`id` = 1),
  CONSTRAINT `chk_estado_despliegue_correo_revision` CHECK (`revision` > 0),
  CONSTRAINT `chk_estado_despliegue_correo_guards` CHECK (`guard_metadatos_activo` in (0,1) and `origen_portal_autoritativo` in (0,1) and `verificacion_smtp_autoritativa` in (0,1) and `guard_verificacion_legacy_activo` in (0,1) and `guard_revision_trigger_activo` in (0,1) and `cola_sql_autoritativa` in (0,1) and `tipo_correo_habilitado` in (0,1)),
  CONSTRAINT `chk_estado_despliegue_correo_cronologia` CHECK (`cortado_en_utc` is null or `cortado_en_utc` >= `preparado_en_utc`),
  CONSTRAINT `chk_estado_despliegue_correo_activacion` CHECK (`estado` = 'preparacion' and `guard_metadatos_activo` = 0 and `origen_portal_autoritativo` = 0 and `verificacion_smtp_autoritativa` = 0 and `guard_verificacion_legacy_activo` = 0 and `guard_revision_trigger_activo` = 0 and `cola_sql_autoritativa` = 0 and `tipo_correo_habilitado` = 0 and `cortado_en_utc` is null and `activado_en_utc` is null or `estado` <> 'preparacion' and `cortado_en_utc` is not null),
  CONSTRAINT `chk_estado_despliegue_correo_quietud` CHECK (`estado` in ('preparacion','corte_origen','corte_verificacion') and `quietud_iniciada_en_utc` is null and `quietud_observada_en_utc` is null or `estado` = 'quietud_cola' and `quietud_iniciada_en_utc` is not null and `activado_en_utc` is null or `estado` = 'activado' and `quietud_iniciada_en_utc` is not null and `quietud_observada_en_utc` is not null and `activado_en_utc` >= `quietud_observada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `estado_despliegue_trigger_correo` VALUES
(1,'sentinelia-trigger-correo-v1','preparacion',0,0,0,0,0,0,0,1,'2026-11-07 21:16:47.140',NULL,NULL,NULL,NULL,'2026-11-07 21:16:47.140');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_salud_relaciones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultimo_heartbeat_request_id` binary(16) DEFAULT NULL,
  `ultima_sesion_id` binary(16) DEFAULT NULL,
  `ultimo_seq` bigint(20) unsigned NOT NULL DEFAULT 0,
  `huella_ultimo_heartbeat` binary(32) DEFAULT NULL,
  `evento_aviso_id` binary(16) DEFAULT NULL,
  `boot_remoto_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `producto_version` varchar(64) DEFAULT NULL,
  `protocolo_version` int(10) unsigned DEFAULT NULL,
  `familias_soportadas` longtext DEFAULT NULL CHECK (json_valid(`familias_soportadas`)),
  `versiones_familia` longtext DEFAULT NULL CHECK (json_valid(`versiones_familia`)),
  `estado_compatibilidad` enum('pendiente','compatible','incompatible') NOT NULL DEFAULT 'pendiente',
  `estado_temporal` enum('pendiente','tolerable','noTolerable') NOT NULL DEFAULT 'pendiente',
  `desfase_estimado_ms` bigint(20) DEFAULT NULL,
  `rtt_estimado_ms` bigint(20) unsigned DEFAULT NULL,
  `muestra_id` binary(16) DEFAULT NULL,
  `muestra_cliente_envia_utc` datetime(3) DEFAULT NULL,
  `muestra_servidor_recibe_utc` datetime(3) DEFAULT NULL,
  `muestra_servidor_envia_utc` datetime(3) DEFAULT NULL,
  `ultimo_heartbeat_utc` datetime(3) DEFAULT NULL,
  `respuesta_ultimo_heartbeat` longtext DEFAULT NULL CHECK (json_valid(`respuesta_ultimo_heartbeat`)),
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`),
  KEY `idx_salud_relaciones_heartbeat` (`ultimo_heartbeat_utc`,`relacion_id`),
  CONSTRAINT `fk_salud_relaciones_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_salud_relaciones_federacion_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and (`boot_remoto_id` is null or `boot_remoto_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_salud_relaciones_federacion_uuidv7` CHECK ((`ultimo_heartbeat_request_id` is null or substr(hex(`ultimo_heartbeat_request_id`),13,1) = '7' and substr(hex(`ultimo_heartbeat_request_id`),17,1) in ('8','9','A','B')) and (`ultima_sesion_id` is null or substr(hex(`ultima_sesion_id`),13,1) = '7' and substr(hex(`ultima_sesion_id`),17,1) in ('8','9','A','B')) and (`muestra_id` is null or substr(hex(`muestra_id`),13,1) = '7' and substr(hex(`muestra_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_salud_relaciones_federacion_forma` CHECK (`ultimo_seq` = 0 and `ultimo_heartbeat_request_id` is null and `ultima_sesion_id` is null or `ultimo_seq` >= 1 and `ultimo_heartbeat_request_id` is not null and `ultima_sesion_id` is not null and `huella_ultimo_heartbeat` is not null and `boot_remoto_id` is not null and `protocolo_version` is not null and `ultimo_heartbeat_utc` is not null and `respuesta_ultimo_heartbeat` is not null),
  CONSTRAINT `chk_salud_relaciones_federacion_muestra` CHECK (`muestra_id` is null and `muestra_cliente_envia_utc` is null and `muestra_servidor_recibe_utc` is null and `muestra_servidor_envia_utc` is null or `muestra_id` is not null and `muestra_cliente_envia_utc` is not null and `muestra_servidor_recibe_utc` is not null and `muestra_servidor_envia_utc` is not null),
  CONSTRAINT `chk_salud_relaciones_federacion_temporal` CHECK (`estado_temporal` = 'pendiente' and `desfase_estimado_ms` is null and `rtt_estimado_ms` is null or `estado_temporal` <> 'pendiente' and `desfase_estimado_ms` is not null and `rtt_estimado_ms` is not null),
  CONSTRAINT `chk_salud_relaciones_federacion_evento_aviso_uuidv7` CHECK (`evento_aviso_id` is null or substr(hex(`evento_aviso_id`),13,1) = '7' and substr(hex(`evento_aviso_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_sesiones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `version_revocacion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`),
  CONSTRAINT `fk_estado_sesiones_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_estado_sesiones_federacion_contadores` CHECK (`fencing_token` >= 0 and `version_revocacion` >= 1),
  CONSTRAINT `chk_estado_sesiones_federacion_relacion` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estado_verificacion_correo` (
  `id` tinyint(3) unsigned NOT NULL,
  `verificado` tinyint(1) NOT NULL DEFAULT 0,
  `perfil_version` varchar(32) DEFAULT NULL,
  `huella_hmac` binary(32) DEFAULT NULL,
  `key_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `configuracion_version` bigint(20) unsigned DEFAULT NULL,
  `verificado_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `verificado_en_utc` datetime(3) DEFAULT NULL,
  `invalidado_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `invalidado_en_utc` datetime(3) DEFAULT NULL,
  `codigo_invalidacion` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_estado_verificacion_correo_unico` CHECK (`id` = 1),
  CONSTRAINT `chk_estado_verificacion_correo_booleano` CHECK (`verificado` in (0,1)),
  CONSTRAINT `chk_estado_verificacion_correo_prueba` CHECK (`verificado` = 0 and `perfil_version` is null and `huella_hmac` is null and `key_id` is null and `configuracion_version` is null and `verificado_por_usuario_id` is null and `verificado_en_utc` is null or `verificado` = 1 and `perfil_version` is not null and `huella_hmac` is not null and `key_id` is not null and `configuracion_version` > 0 and `verificado_por_usuario_id` > 0 and `verificado_en_utc` is not null and `invalidado_por_usuario_id` is null and `invalidado_en_utc` is null and `codigo_invalidacion` is null),
  CONSTRAINT `chk_estado_verificacion_correo_invalidacion` CHECK (`invalidado_en_utc` is null and `invalidado_por_usuario_id` is null and `codigo_invalidacion` is null or `verificado` = 0 and `invalidado_en_utc` is not null and `codigo_invalidacion` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `estado_verificacion_correo` VALUES
(1,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-11-07 21:16:47.137');
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_actuales_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_actual_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_publicacion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `publicada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`),
  KEY `idx_estados_actuales_generacion` (`generacion_actual_id`,`proyeccion_id`),
  KEY `fk_estados_actuales_version` (`proyeccion_id`,`generacion_actual_id`),
  CONSTRAINT `fk_estados_actuales_version` FOREIGN KEY (`proyeccion_id`, `generacion_actual_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_estados_actuales_version` CHECK (`version_publicacion` >= 1),
  CONSTRAINT `chk_estados_actuales_cronologia` CHECK (`actualizada_en_utc` >= `publicada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_estados_actuales_proyeccion_insercion
BEFORE INSERT ON estados_actuales_proyecciones_federacion
FOR EACH ROW
BEGIN
  DECLARE estado_objetivo VARCHAR(16) DEFAULT NULL;
  SELECT estado_publicacion INTO estado_objetivo
    FROM versiones_proyecciones_federacion
   WHERE proyeccion_id=NEW.proyeccion_id
     AND generacion_id=NEW.generacion_actual_id;
  IF estado_objetivo IS NULL OR estado_objetivo<>'actual' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El puntero solo puede publicar una version actual.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_estados_actuales_proyeccion_transicion
BEFORE UPDATE ON estados_actuales_proyecciones_federacion
FOR EACH ROW
BEGIN
  DECLARE estado_objetivo VARCHAR(16) DEFAULT NULL;
  SELECT estado_publicacion INTO estado_objetivo
    FROM versiones_proyecciones_federacion
   WHERE proyeccion_id=NEW.proyeccion_id
     AND generacion_id=NEW.generacion_actual_id;
  IF NOT (
    NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.version_publicacion=OLD.version_publicacion+1
    AND NEW.publicada_en_utc>=OLD.publicada_en_utc
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
    AND estado_objetivo='actual'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El puntero actual de proyeccion exige sustitucion monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_diagnostico_relaciones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_catalogo` smallint(5) unsigned NOT NULL,
  `tipo_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `causa_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `condicion_activa` tinyint(1) NOT NULL,
  `evento_transicion_id` binary(16) NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `aplicado_en_utc` datetime(3) DEFAULT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`,`version_catalogo`,`tipo_codigo`,`causa_codigo`),
  UNIQUE KEY `uk_diagnostico_relacion_evento` (`evento_transicion_id`),
  KEY `fk_diagnostico_relacion_causa` (`version_catalogo`,`tipo_codigo`,`causa_codigo`),
  CONSTRAINT `fk_diagnostico_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_diagnostico_relacion_causa` FOREIGN KEY (`version_catalogo`, `tipo_codigo`, `causa_codigo`) REFERENCES `catalogo_causas_avisos_plataforma` (`version_catalogo`, `tipo_codigo`, `causa_codigo`),
  CONSTRAINT `chk_diagnostico_relacion_evento` CHECK (substr(hex(`evento_transicion_id`),13,1) = '7' and substr(hex(`evento_transicion_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_entradas_federadas_monitores_logicos` (
  `entrada_id` bigint(20) unsigned NOT NULL,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `revision_configuracion_aplicada` bigint(20) unsigned NOT NULL,
  `valor_binario_efectivo` tinyint(1) NOT NULL,
  `condicion_fuente` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ultimo_estado_remoto_estable` varchar(16) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `candidato_valor` tinyint(1) DEFAULT NULL,
  `candidato_condicion` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `candidato_iniciado_en_utc` datetime(3) DEFAULT NULL,
  `candidato_vence_en_utc` datetime(3) DEFAULT NULL,
  `candidato_revision_configuracion` bigint(20) unsigned DEFAULT NULL,
  `evidencia_efectiva_json` longtext DEFAULT NULL CHECK (json_valid(`evidencia_efectiva_json`)),
  `evidencia_candidata_json` longtext DEFAULT NULL CHECK (json_valid(`evidencia_candidata_json`)),
  `epoca_observacion` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requiere_observacion_completa` tinyint(1) NOT NULL DEFAULT 0,
  `version_estado` bigint(20) unsigned NOT NULL,
  `observada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`entrada_id`),
  KEY `idx_estados_entradas_logicas_monitor` (`monitor_id`,`entrada_id`),
  KEY `idx_estados_entradas_logicas_candidato` (`candidato_vence_en_utc`,`monitor_id`),
  CONSTRAINT `fk_estados_entradas_logicas_vinculo` FOREIGN KEY (`entrada_id`) REFERENCES `vinculos_entradas_federadas_monitores_logicos` (`entrada_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_estados_entradas_logicas_valor` CHECK (`valor_binario_efectivo` in (0,1)),
  CONSTRAINT `chk_estados_entradas_logicas_observacion` CHECK (`requiere_observacion_completa` in (0,1)),
  CONSTRAINT `chk_estados_entradas_logicas_candidato_valor` CHECK (`candidato_valor` is null or `candidato_valor` in (0,1)),
  CONSTRAINT `chk_estados_entradas_logicas_estado_candidato` CHECK (`candidato_valor` is null and `candidato_condicion` is null and `candidato_iniciado_en_utc` is null and `candidato_vence_en_utc` is null and `candidato_revision_configuracion` is null and `evidencia_candidata_json` is null or `candidato_valor` is not null and `candidato_condicion` is not null and `candidato_iniciado_en_utc` is not null and `candidato_vence_en_utc` is not null and `candidato_revision_configuracion` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_runtime_servidor_agentes` (
  `agente_id` bigint(20) unsigned NOT NULL,
  `generacion` bigint(20) unsigned NOT NULL,
  `boot_id_referencia` varchar(120) DEFAULT NULL,
  `ultimo_periodo_pol_id` bigint(20) unsigned DEFAULT NULL,
  `ultimo_seq` bigint(20) unsigned DEFAULT NULL,
  `ultimo_pol_utc` datetime(3) DEFAULT NULL,
  `tipo_ultimo_pol` varchar(20) DEFAULT NULL,
  `valor_sin_pol` tinyint(3) unsigned DEFAULT NULL,
  `vence_sin_pol_utc` datetime(3) DEFAULT NULL,
  `histeresis_sin_pol_capturada_segundos` int(10) unsigned DEFAULT NULL,
  `valor_reinicio_reciente` tinyint(3) unsigned DEFAULT NULL,
  `vence_reinicio_reciente_utc` datetime(3) DEFAULT NULL,
  `duracion_reinicio_capturada_segundos` int(10) unsigned DEFAULT NULL,
  `ultimo_cambio_boot_id_utc` datetime(3) DEFAULT NULL,
  `checkpoint_causal` varchar(190) DEFAULT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `fecha_creacion` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`agente_id`,`generacion`),
  KEY `idx_estado_runtime_servidor_sin_pol` (`vence_sin_pol_utc`,`agente_id`,`generacion`),
  KEY `idx_estado_runtime_servidor_reinicio` (`vence_reinicio_reciente_utc`,`agente_id`,`generacion`),
  KEY `idx_estado_runtime_servidor_periodo` (`ultimo_periodo_pol_id`,`agente_id`,`generacion`),
  CONSTRAINT `fk_estado_runtime_servidor_perfil` FOREIGN KEY (`agente_id`, `generacion`) REFERENCES `perfiles_servidor_agentes` (`agente_id`, `generacion`) ON DELETE CASCADE,
  CONSTRAINT `fk_estado_runtime_servidor_periodo_pol` FOREIGN KEY (`ultimo_periodo_pol_id`) REFERENCES `periodos_vida_pol_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_estado_runtime_servidor_tipo_pol` CHECK (`tipo_ultimo_pol` is null or `tipo_ultimo_pol` in ('login','heartbeat')),
  CONSTRAINT `chk_estado_runtime_servidor_sin_pol` CHECK (`valor_sin_pol` is null or `valor_sin_pol` in (0,1)),
  CONSTRAINT `chk_estado_runtime_servidor_reinicio` CHECK (`valor_reinicio_reciente` is null or `valor_reinicio_reciente` in (0,1)),
  CONSTRAINT `chk_estado_runtime_servidor_histeresis_capturada` CHECK (`histeresis_sin_pol_capturada_segundos` is null or `histeresis_sin_pol_capturada_segundos` > 0),
  CONSTRAINT `chk_estado_runtime_servidor_duracion_capturada` CHECK (`duracion_reinicio_capturada_segundos` is null or `duracion_reinicio_capturada_segundos` > 0),
  CONSTRAINT `chk_estado_runtime_servidor_vence_sin_pol` CHECK (`vence_sin_pol_utc` is null or `histeresis_sin_pol_capturada_segundos` is not null),
  CONSTRAINT `chk_estado_runtime_servidor_vence_reinicio` CHECK (`vence_reinicio_reciente_utc` is null or `duracion_reinicio_capturada_segundos` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `estados_temporales_fotografias_remotas` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_estado` bigint(20) unsigned DEFAULT NULL,
  `condicion` enum('consolidando','vigente','vencida','noAutorizada','incompatible','retirada') NOT NULL,
  `vigente_hasta_efectiva_utc` datetime(3) NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `materializado_en_utc` datetime(3) NOT NULL,
  `boot_consolidacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `aviso_vencimiento_activo` tinyint(1) NOT NULL DEFAULT 0,
  `ultima_transicion_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`proyeccion_id`),
  UNIQUE KEY `uk_estados_temporales_transicion` (`ultima_transicion_id`),
  KEY `idx_estados_temporales_scheduler` (`condicion`,`vigente_hasta_efectiva_utc`,`proyeccion_id`),
  KEY `fk_estados_temporales_fotografia` (`proyeccion_id`,`generacion_id`,`secuencia_estado`),
  KEY `fk_estados_temporales_ciclo` (`boot_consolidacion_id`),
  CONSTRAINT `fk_estados_temporales_ciclo` FOREIGN KEY (`boot_consolidacion_id`) REFERENCES `ciclos_consolidacion_estados_remotos` (`boot_id`),
  CONSTRAINT `fk_estados_temporales_fotografia` FOREIGN KEY (`proyeccion_id`, `generacion_id`, `secuencia_estado`) REFERENCES `fotografias_operativas_monitores_remotos` (`proyeccion_id`, `generacion_id`, `secuencia_estado`),
  CONSTRAINT `fk_estados_temporales_version` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_estados_temporales_uuid` CHECK (`ultima_transicion_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_estados_temporales_version` CHECK (`secuencia_estado` >= 1 and `version_estado` >= 1 and `aviso_vencimiento_activo` in (0,1) and `materializado_en_utc` >= `efectivo_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_estado_temporal_remoto_versionado
BEFORE UPDATE ON estados_temporales_fotografias_remotas
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.version_estado=OLD.version_estado+1
    AND NEW.materializado_en_utc>=OLD.materializado_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El estado temporal remoto exige una nueva version monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `evaluaciones_dimensiones_proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado_materializacion` enum('pendiente','materializada','fallida') NOT NULL,
  `completitud_interpretable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_observable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_reconstruible` enum('completa','parcial','degradada') NOT NULL,
  `estado_vigencia` enum('vigente','vencida','retirada') NOT NULL,
  `estado_soporte` enum('sostenida','huerfana') NOT NULL,
  `estado_autorizacion` enum('autorizada','noAutorizada') NOT NULL,
  `cierre_operativo_validado` tinyint(1) NOT NULL,
  `recepcion_confirmada` tinyint(1) NOT NULL,
  `requisitos_canonicos` longtext NOT NULL CHECK (json_valid(`requisitos_canonicos`)),
  `causas_canonicas` longtext NOT NULL CHECK (json_valid(`causas_canonicas`)),
  `evaluada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_evaluaciones_dimensiones_pertenencia` (`id`,`proyeccion_id`,`generacion_id`),
  KEY `idx_evaluaciones_dimensiones_version` (`proyeccion_id`,`generacion_id`,`id`),
  KEY `idx_evaluaciones_dimensiones_trabajo` (`trabajo_entrega_id`,`id`),
  CONSTRAINT `fk_evaluaciones_dimensiones_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `fk_evaluaciones_dimensiones_version` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_evaluaciones_dimensiones_json` CHECK (json_valid(`requisitos_canonicos`) and json_valid(`causas_canonicas`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_evaluaciones_dimensiones_inmutables
BEFORE UPDATE ON evaluaciones_dimensiones_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una evaluacion de dimensiones es evidencia inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `evaluaciones_reglas_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `trabajo_id` bigint(20) unsigned NOT NULL,
  `regla_id` bigint(20) unsigned NOT NULL,
  `regla_revision_id` bigint(20) unsigned NOT NULL,
  `observacion_id` bigint(20) unsigned NOT NULL,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `causa` enum('observacion','vencimiento_temporal','reconciliacion_administrativa','reconciliacion_reloj') NOT NULL,
  `generacion_autoridad` bigint(20) unsigned NOT NULL,
  `causalidad_revision` enum('historica_recepcion','autoridad_actual') NOT NULL,
  `programado_para_utc` datetime(6) DEFAULT NULL,
  `resultado` enum('coincide','no_coincide','no_evaluable') NOT NULL,
  `lado_atencion` enum('inferior','superior') DEFAULT NULL,
  `resultado_anterior` enum('coincide','no_coincide','no_evaluable') DEFAULT NULL,
  `lado_anterior` enum('inferior','superior') DEFAULT NULL,
  `momento_utc` datetime(6) DEFAULT NULL,
  `ahora_utc` datetime(6) DEFAULT NULL,
  `desviacion_segundos` bigint(20) DEFAULT NULL,
  `proxima_reevaluacion_utc` datetime(6) DEFAULT NULL,
  `codigo_motivo` varchar(80) NOT NULL,
  `explicacion` varchar(512) NOT NULL,
  `condicion_canonica` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`condicion_canonica`)),
  `valor_evaluado` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`valor_evaluado`)),
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `calidad` varchar(32) NOT NULL,
  `severidad_calculada` varchar(32) DEFAULT NULL,
  `mensaje_operativo` varchar(512) NOT NULL,
  `evidencia_contextual` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`evidencia_contextual`)),
  `observado_en_utc` datetime(6) NOT NULL,
  `recibido_en_utc` datetime(6) NOT NULL,
  `evaluado_en_utc` datetime(6) NOT NULL,
  `creada_en_utc` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_evaluaciones_reglas_trabajo` (`trabajo_id`),
  UNIQUE KEY `uk_evaluaciones_reglas_id_regla` (`id`,`regla_id`),
  KEY `idx_evaluaciones_reglas_regla_fecha` (`regla_id`,`creada_en_utc`,`id`),
  KEY `idx_evaluaciones_reglas_scope_fecha` (`tenant_id`,`empresa_id`,`sitio_id`,`creada_en_utc`,`id`),
  KEY `idx_evaluaciones_reglas_autoridad` (`regla_id`,`generacion_autoridad`,`regla_revision_id`,`observacion_id`,`id`),
  KEY `idx_evaluaciones_reglas_proxima` (`proxima_reevaluacion_utc`,`regla_id`,`id`),
  KEY `fk_evaluaciones_reglas_regla_contexto` (`regla_id`,`agente_id`,`senal_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `fk_evaluaciones_reglas_revision` (`regla_id`,`regla_revision_id`),
  KEY `fk_evaluaciones_reglas_observacion` (`observacion_id`,`agente_id`,`senal_id`),
  CONSTRAINT `fk_evaluaciones_reglas_observacion` FOREIGN KEY (`observacion_id`, `agente_id`, `senal_id`) REFERENCES `observaciones_telemetria_agentes` (`id`, `agente_id`, `senal_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evaluaciones_reglas_regla_contexto` FOREIGN KEY (`regla_id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `reglas_derivacion_telemetria` (`id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evaluaciones_reglas_revision` FOREIGN KEY (`regla_id`, `regla_revision_id`) REFERENCES `revisiones_reglas_derivacion_telemetria` (`regla_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evaluaciones_reglas_trabajo` FOREIGN KEY (`trabajo_id`) REFERENCES `trabajos_evaluacion_telemetria` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_evaluaciones_reglas_generacion` CHECK (`generacion_autoridad` > 0),
  CONSTRAINT `chk_evaluaciones_reglas_programacion` CHECK (`causa` = 'vencimiento_temporal' and `programado_para_utc` is not null or `causa` <> 'vencimiento_temporal' and `programado_para_utc` is null),
  CONSTRAINT `chk_evaluaciones_reglas_lado` CHECK (`causalidad_revision` = 'historica_recepcion' and `lado_atencion` is null or `causalidad_revision` = 'autoridad_actual' and (`resultado` = 'coincide' and `lado_atencion` is not null or `resultado` <> 'coincide' and `lado_atencion` is null)),
  CONSTRAINT `chk_evaluaciones_reglas_estado_anterior` CHECK (`resultado_anterior` = 'coincide' and `lado_anterior` is not null or `resultado_anterior` <> 'coincide' and `lado_anterior` is null or `resultado_anterior` is null and `lado_anterior` is null),
  CONSTRAINT `chk_evaluaciones_reglas_temporal` CHECK (`causalidad_revision` = 'historica_recepcion' and `momento_utc` is null and `ahora_utc` is null and `desviacion_segundos` is null and `proxima_reevaluacion_utc` is null or `causalidad_revision` = 'autoridad_actual' and `ahora_utc` is not null and (`resultado` = 'no_evaluable' and `momento_utc` is null and `desviacion_segundos` is null or `resultado` <> 'no_evaluable' and `momento_utc` is not null and `desviacion_segundos` is not null)),
  CONSTRAINT `chk_evaluaciones_reglas_severidad` CHECK (`resultado` = 'coincide' and `severidad_calculada` is not null or `resultado` <> 'coincide' and `severidad_calculada` is null),
  CONSTRAINT `chk_evaluaciones_reglas_condicion_tamano` CHECK (char_length(cast(`condicion_canonica` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_evaluaciones_reglas_valor_tamano` CHECK (char_length(cast(`valor_evaluado` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_evaluaciones_reglas_evidencia_tamano` CHECK (`evidencia_contextual` is null or char_length(cast(`evidencia_contextual` as char charset utf8mb4)) <= 4096)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_evaluaciones_reglas_impedir_update
BEFORE UPDATE ON evaluaciones_reglas_telemetria
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'El ledger de evaluaciones de reglas es append-only y no admite UPDATE' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_evaluaciones_reglas_impedir_delete
BEFORE DELETE ON evaluaciones_reglas_telemetria
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'El ledger de evaluaciones de reglas es append-only y no admite DELETE' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eventos_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `evento_id` binary(16) NOT NULL,
  `cadena_id` bigint(20) unsigned NOT NULL,
  `tipo_evento` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL,
  `flujo` enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion','internet') NOT NULL,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia` bigint(20) unsigned NOT NULL,
  `actor_real_tipo` enum('usuario','agente','runtime','sistema','instancia_remota') NOT NULL,
  `actor_real_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_efectivo_tipo` enum('usuario') DEFAULT NULL,
  `actor_efectivo_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `modo_actuacion` enum('directo','impersonado') NOT NULL,
  `sujeto_tipo` enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma','frontera_internet','concesion_ddns','intencion_ddns') NOT NULL,
  `sujeto_id` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `origen` enum('web','api_agentes','runtime','bootstrap','tarea_sistema','api_federacion') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `causalidad_tipo` enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma','solicitud_recuperacion_password','intencion_ddns') DEFAULT NULL,
  `causalidad_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `productor` enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion','recuperacion_password') NOT NULL,
  `clave_operacion` varbinary(128) NOT NULL,
  `rol_evento` enum('principal','salida','entrada','resultado') NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `registrado_en_utc` datetime(3) NOT NULL,
  `version_canonicalizador` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_encadenado` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload` longtext NOT NULL CHECK (json_valid(`payload`)),
  `evento_contraparte_id` binary(16) DEFAULT NULL,
  `hash_payload` binary(32) NOT NULL,
  `hash_anterior` binary(32) NOT NULL,
  `hash_actual` binary(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_eventos_auditoria_evento` (`evento_id`),
  UNIQUE KEY `uk_eventos_auditoria_cadena_secuencia` (`cadena_id`,`secuencia`),
  KEY `idx_eventos_auditoria_cronologia` (`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_correlacion` (`correlacion_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_sujeto` (`sujeto_tipo`,`sujeto_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_tipo` (`tipo_evento`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_contraparte` (`evento_contraparte_id`),
  KEY `idx_eventos_auditoria_scope_empresa_cronologia` (`scope_empresa_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_scope_sitio_cronologia` (`scope_sitio_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_flujo_cronologia` (`flujo`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_cadena_cronologia` (`cadena_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_actor_real_cronologia` (`actor_real_tipo`,`actor_real_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_actor_efectivo_cronologia` (`actor_efectivo_tipo`,`actor_efectivo_id`,`registrado_en_utc`,`evento_id`),
  KEY `idx_eventos_auditoria_causalidad_cronologia` (`causalidad_tipo`,`causalidad_id`,`registrado_en_utc`,`evento_id`),
  KEY `fk_eventos_auditoria_cadena` (`cadena_id`,`clave_cadena`,`flujo`),
  CONSTRAINT `fk_eventos_auditoria_cadena` FOREIGN KEY (`cadena_id`, `clave_cadena`, `flujo`) REFERENCES `cadenas_auditoria` (`id`, `clave_cadena`, `flujo`),
  CONSTRAINT `chk_eventos_auditoria_clave_scope` CHECK (`scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':portal') or `scope_tenant_id` is not null and (`scope_empresa_id` is not null or `scope_sitio_id` is null) and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':tenant:',`scope_tenant_id`)),
  CONSTRAINT `chk_eventos_auditoria_scope_jerarquia` CHECK (`scope_empresa_id` is not null or `scope_sitio_id` is null),
  CONSTRAINT `chk_eventos_auditoria_actor_efectivo` CHECK (`modo_actuacion` = 'directo' and `actor_efectivo_tipo` is null and `actor_efectivo_id` is null or `modo_actuacion` = 'impersonado' and `actor_real_tipo` = 'usuario' and `actor_efectivo_tipo` = 'usuario' and `actor_efectivo_id` is not null and `actor_efectivo_id` <> `actor_real_id`),
  CONSTRAINT `chk_eventos_auditoria_causalidad` CHECK (`causalidad_tipo` is null and `causalidad_id` is null or `causalidad_tipo` is not null and `causalidad_id` is not null),
  CONSTRAINT `chk_eventos_auditoria_secuencia` CHECK (`secuencia` >= 1),
  CONSTRAINT `chk_eventos_auditoria_clave_operacion` CHECK (octet_length(`clave_operacion`) between 1 and 128),
  CONSTRAINT `chk_eventos_auditoria_contraparte` CHECK (`tipo_evento` in ('scope.entidad_salida','scope.entidad_entrada') and `evento_contraparte_id` is not null and `evento_contraparte_id` <> `evento_id` or `tipo_evento` not in ('scope.entidad_salida','scope.entidad_entrada') and `evento_contraparte_id` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_eventos_auditoria_impedir_update
BEFORE UPDATE ON eventos_auditoria
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Los eventos auditables son append-only y no admiten UPDATE' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eventos_derivados_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `evaluacion_id` bigint(20) unsigned DEFAULT NULL,
  `generacion_autoridad` bigint(20) unsigned NOT NULL DEFAULT 1,
  `causalidad_revision` enum('historica_recepcion','autoridad_actual') NOT NULL DEFAULT 'historica_recepcion',
  `regla_id` bigint(20) unsigned NOT NULL,
  `regla_revision_id` bigint(20) unsigned NOT NULL,
  `observacion_id` bigint(20) unsigned NOT NULL,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `resultado` enum('coincide') NOT NULL DEFAULT 'coincide',
  `lado_atencion` enum('inferior','superior') DEFAULT NULL,
  `codigo_motivo` varchar(80) NOT NULL,
  `explicacion` varchar(512) NOT NULL,
  `condicion_canonica` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`condicion_canonica`)),
  `valor_evaluado` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`valor_evaluado`)),
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `calidad` varchar(32) NOT NULL,
  `severidad_calculada` varchar(32) NOT NULL,
  `mensaje_operativo` varchar(512) NOT NULL,
  `evidencia_contextual` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`evidencia_contextual`)),
  `observado_en_utc` datetime(6) NOT NULL,
  `recibido_en_utc` datetime(6) NOT NULL,
  `evaluado_en_utc` datetime(6) NOT NULL,
  `proxima_reevaluacion_utc` datetime(6) DEFAULT NULL,
  `creado_en_utc` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_eventos_derivados_evaluacion` (`evaluacion_id`),
  KEY `idx_eventos_derivados_scope_fecha` (`tenant_id`,`empresa_id`,`sitio_id`,`creado_en_utc`,`id`),
  KEY `idx_eventos_derivados_senal_fecha` (`senal_id`,`observado_en_utc`,`id`),
  KEY `idx_eventos_derivados_regla_fecha` (`regla_id`,`observado_en_utc`,`id`),
  KEY `fk_eventos_derivados_regla_contexto` (`regla_id`,`agente_id`,`senal_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `fk_eventos_derivados_observacion` (`observacion_id`,`agente_id`,`senal_id`),
  KEY `idx_eventos_derivados_revision` (`regla_id`,`regla_revision_id`),
  KEY `idx_eventos_derivados_autoridad` (`regla_id`,`generacion_autoridad`,`regla_revision_id`,`observacion_id`,`id`),
  CONSTRAINT `fk_eventos_derivados_evaluacion` FOREIGN KEY (`evaluacion_id`) REFERENCES `evaluaciones_reglas_telemetria` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eventos_derivados_observacion` FOREIGN KEY (`observacion_id`, `agente_id`, `senal_id`) REFERENCES `observaciones_telemetria_agentes` (`id`, `agente_id`, `senal_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eventos_derivados_regla_contexto` FOREIGN KEY (`regla_id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `reglas_derivacion_telemetria` (`id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eventos_derivados_revision` FOREIGN KEY (`regla_id`, `regla_revision_id`) REFERENCES `revisiones_reglas_derivacion_telemetria` (`regla_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `chk_eventos_derivados_condicion_tamano` CHECK (char_length(cast(`condicion_canonica` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_eventos_derivados_valor_tamano` CHECK (char_length(cast(`valor_evaluado` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_eventos_derivados_evidencia_tamano` CHECK (`evidencia_contextual` is null or char_length(cast(`evidencia_contextual` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_eventos_derivados_generacion` CHECK (`generacion_autoridad` > 0),
  CONSTRAINT `chk_eventos_derivados_lado` CHECK (`causalidad_revision` = 'historica_recepcion' and `lado_atencion` is null or `causalidad_revision` = 'autoridad_actual' and `lado_atencion` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eventos_monitores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `version_catalogo` varchar(40) NOT NULL,
  `tipo_monitor` varchar(40) NOT NULL,
  `estado_detectado` varchar(40) NOT NULL,
  `codigo_resultado` varchar(80) NOT NULL,
  `mensaje_resultado` varchar(500) NOT NULL,
  `exito` tinyint(1) NOT NULL DEFAULT 0,
  `duracion_total_ms` int(10) unsigned NOT NULL DEFAULT 0,
  `ejecutado_en_utc` datetime NOT NULL,
  `payload_evento` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_evento`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_eventos_monitores_monitor_ejecucion` (`monitor_id`,`ejecutado_en_utc`),
  KEY `idx_eventos_monitores_scope_ejecucion` (`tenant_id`,`empresa_id`,`sitio_id`,`ejecutado_en_utc`),
  KEY `idx_eventos_monitores_estado_ejecucion` (`estado_detectado`,`ejecutado_en_utc`),
  KEY `idx_eventos_monitores_tipo_ejecucion` (`tipo_monitor`,`ejecutado_en_utc`),
  CONSTRAINT `fk_eventos_monitores_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `eventos_soporte_campos_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `tipo` enum('aportado','actualizado','retiradoCampo','retiradoContribucion') NOT NULL,
  `declaracion_campo_id` bigint(20) unsigned DEFAULT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned DEFAULT NULL,
  `secuencia_elemento` bigint(20) unsigned DEFAULT NULL,
  `causa` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ocurrido_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_eventos_soporte_proyeccion` (`proyeccion_id`,`nombre_sha256`,`ocurrido_en_utc`,`id`),
  KEY `idx_eventos_soporte_contribucion` (`contribucion_id`,`ocurrido_en_utc`,`id`),
  KEY `fk_eventos_soporte_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_eventos_soporte_generacion` (`generacion_id`,`contribucion_id`,`ocurrido_en_utc`,`id`),
  KEY `idx_eventos_soporte_retirada_declaracion` (`declaracion_campo_id`,`tipo`,`id`),
  KEY `idx_eventos_soporte_retirada_frontera` (`contribucion_id`,`generacion_id`,`nombre_sha256`,`tipo`,`secuencia_elemento`),
  CONSTRAINT `fk_eventos_soporte_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_eventos_soporte_declaracion` FOREIGN KEY (`declaracion_campo_id`) REFERENCES `declaraciones_campos_inbox_federacion` (`id`),
  CONSTRAINT `fk_eventos_soporte_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_eventos_soporte_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_eventos_soporte_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_eventos_soporte_nombre` CHECK (octet_length(`nombre_campo`) between 1 and 2097152),
  CONSTRAINT `chk_eventos_soporte_forma` CHECK (`tipo` in ('aportado','actualizado','retiradoCampo') and `declaracion_campo_id` is not null and `inbox_ocurrencia_id` is not null and `secuencia_elemento` is not null or `tipo` = 'retiradoContribucion' and `causa` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_eventos_soporte_campos_inmutables
BEFORE UPDATE ON eventos_soporte_campos_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El evento historico de soporte es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `exclusiones_rutas_divergentes_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `divergencia_id` bigint(20) unsigned NOT NULL,
  `variante_ruta_id` bigint(20) unsigned NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_concesion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorrido_sha256` binary(32) NOT NULL,
  `estado` enum('pendienteResincronizacion','revalidada') NOT NULL,
  `motivo` varchar(191) NOT NULL,
  `actor_usuario_id` bigint(20) unsigned NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `excluida_en_utc` datetime(3) NOT NULL,
  `revalidada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exclusiones_ruta_divergencia` (`divergencia_id`,`relacion_id`,`revision_concesion_id`,`recorrido_sha256`),
  UNIQUE KEY `uk_exclusiones_evento` (`evento_auditoria_id`),
  KEY `idx_exclusiones_proyeccion_estado` (`proyeccion_id`,`estado`,`divergencia_id`),
  KEY `fk_exclusiones_variante` (`variante_ruta_id`),
  KEY `fk_exclusiones_revision_relacion` (`relacion_id`,`revision_concesion_id`),
  CONSTRAINT `fk_exclusiones_divergencia` FOREIGN KEY (`divergencia_id`) REFERENCES `divergencias_proyecciones_federacion` (`id`),
  CONSTRAINT `fk_exclusiones_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_exclusiones_revision_relacion` FOREIGN KEY (`relacion_id`, `revision_concesion_id`) REFERENCES `revisiones_concesion_federacion` (`relacion_id`, `revision_id`),
  CONSTRAINT `fk_exclusiones_variante` FOREIGN KEY (`variante_ruta_id`) REFERENCES `variantes_divergencias_proyecciones_federacion` (`id`),
  CONSTRAINT `chk_exclusiones_scope` CHECK (`scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_tenant_id` is not null and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_exclusiones_estado` CHECK (`estado` = 'pendienteResincronizacion' and `revalidada_en_utc` is null or `estado` = 'revalidada' and `revalidada_en_utc` is not null),
  CONSTRAINT `chk_exclusiones_motivo` CHECK (char_length(`motivo`) between 1 and 191)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_exclusiones_rutas_divergentes_transicion
BEFORE UPDATE ON exclusiones_rutas_divergentes_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id AND NEW.divergencia_id=OLD.divergencia_id
    AND NEW.variante_ruta_id=OLD.variante_ruta_id
    AND NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.relacion_id=OLD.relacion_id
    AND NEW.revision_concesion_id=OLD.revision_concesion_id
    AND NEW.recorrido_sha256=OLD.recorrido_sha256
    AND NEW.motivo=OLD.motivo
    AND NEW.actor_usuario_id=OLD.actor_usuario_id
    AND NEW.scope_tenant_id<=>OLD.scope_tenant_id
    AND NEW.scope_empresa_id<=>OLD.scope_empresa_id
    AND NEW.scope_sitio_id<=>OLD.scope_sitio_id
    AND NEW.evento_auditoria_id=OLD.evento_auditoria_id
    AND NEW.correlacion_id=OLD.correlacion_id
    AND NEW.excluida_en_utc=OLD.excluida_en_utc
    AND (
      (OLD.estado='pendienteResincronizacion'
        AND NEW.estado='revalidada' AND NEW.revalidada_en_utc IS NOT NULL)
      OR (OLD.estado='revalidada' AND NEW.estado='revalidada'
        AND NEW.revalidada_en_utc=OLD.revalidada_en_utc)
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La exclusion de ruta solo admite revalidacion monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `flujos_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `direccion` enum('emision','recepcion') NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `version_familia` smallint(5) unsigned NOT NULL,
  `scope_nivel` enum('portal','tenant','empresa','sitio') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `contexto_clave` varchar(96) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (concat(`scope_nivel`,':',coalesce(`scope_tenant_id`,0),':',coalesce(`scope_empresa_id`,0),':',coalesce(`scope_sitio_id`,0))) STORED,
  `estado` enum('sinSincronizar','sincronizando','operativoParcial','operativoCompleto','resincronizando','degradado','saturado','detenido') NOT NULL,
  `estado_previo_resincronizacion` enum('sinSincronizar','sincronizando','operativoParcial','operativoCompleto','resincronizando','degradado','saturado','detenido') DEFAULT NULL,
  `generacion_activa_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `version_propietario` bigint(20) unsigned NOT NULL DEFAULT 1,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_flujos_federacion_identidad` (`flujo_id`),
  UNIQUE KEY `uk_flujos_federacion_contexto` (`relacion_id`,`direccion`,`familia`,`contexto_clave`),
  UNIQUE KEY `uk_flujos_federacion_generacion_activa` (`flujo_id`,`generacion_activa_id`),
  KEY `idx_flujos_federacion_trabajo` (`estado`,`direccion`,`familia`,`actualizada_en_utc`,`flujo_id`),
  CONSTRAINT `fk_flujos_federacion_generacion_activa` FOREIGN KEY (`flujo_id`, `generacion_activa_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_flujos_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_flujos_federacion_identidad` CHECK (`flujo_id` regexp '^sfid1\\.flujo\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_flujos_federacion_scope` CHECK (`scope_nivel` = 'portal' and `scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_nivel` = 'tenant' and `scope_tenant_id` is not null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_nivel` = 'empresa' and `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is null or `scope_nivel` = 'sitio' and `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is not null),
  CONSTRAINT `chk_flujos_federacion_versiones` CHECK (`version_familia` >= 1 and `version_estado` >= 1 and `version_propietario` >= 1 and `version_registro` >= 1),
  CONSTRAINT `chk_flujos_federacion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fotografias_operativas_monitores_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_estado` bigint(20) unsigned NOT NULL,
  `vigente_hasta_receptor_utc` datetime(3) NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_estado`),
  KEY `idx_fotografias_operativas_vigencia` (`vigente_hasta_receptor_utc`,`proyeccion_id`,`generacion_id`),
  CONSTRAINT `fk_fotografias_operativas_registro` FOREIGN KEY (`proyeccion_id`, `generacion_id`, `secuencia_estado`) REFERENCES `registros_monitores_remotos` (`proyeccion_id`, `generacion_id`, `secuencia_elemento`),
  CONSTRAINT `chk_fotografias_operativas_secuencia` CHECK (`secuencia_estado` >= 1),
  CONSTRAINT `chk_fotografias_operativas_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc` and `vigente_hasta_receptor_utc` >= `creada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_fotografia_operativa_inmutable
BEFORE UPDATE ON fotografias_operativas_monitores_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una fotografia operativa remota es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fronteras_coherentes_proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `completitud_interpretable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_observable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_reconstruible` enum('completa','parcial','degradada') NOT NULL,
  `estado_vigencia` enum('vigente','vencida','retirada') NOT NULL,
  `estado_soporte` enum('sostenida','huerfana') NOT NULL,
  `estado_autorizacion` enum('autorizada','noAutorizada') NOT NULL,
  `cierre_operativo_validado` tinyint(1) NOT NULL,
  `sellada` tinyint(1) NOT NULL DEFAULT 0,
  `capturada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fronteras_coherentes_anterior` (`proyeccion_id`,`secuencia_elemento`,`id`),
  KEY `fk_fronteras_coherentes_generacion` (`generacion_id`),
  KEY `idx_fronteras_coherentes_version` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`id`),
  CONSTRAINT `fk_fronteras_coherentes_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_fronteras_coherentes_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_fronteras_coherentes_secuencia` CHECK (`secuencia_elemento` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_fronteras_coherentes_transicion
BEFORE UPDATE ON fronteras_coherentes_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id AND NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.secuencia_elemento=OLD.secuencia_elemento
    AND NEW.completitud_interpretable=OLD.completitud_interpretable
    AND NEW.completitud_observable=OLD.completitud_observable
    AND NEW.completitud_reconstruible=OLD.completitud_reconstruible
    AND NEW.estado_vigencia=OLD.estado_vigencia
    AND NEW.estado_soporte=OLD.estado_soporte
    AND NEW.estado_autorizacion=OLD.estado_autorizacion
    AND NEW.cierre_operativo_validado=OLD.cierre_operativo_validado
    AND NEW.capturada_en_utc=OLD.capturada_en_utc
    AND OLD.sellada=FALSE AND NEW.sellada=TRUE
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La frontera coherente sellada es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_fronteras_coherentes_inmutables_delete
BEFORE DELETE ON fronteras_coherentes_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una frontera coherente no puede eliminarse.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `fronteras_generaciones_federacion` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_inicial_comprometida` bigint(20) unsigned NOT NULL,
  `posicion_operativa_validada` bigint(20) unsigned DEFAULT NULL,
  `posicion_historica_validada` bigint(20) unsigned DEFAULT NULL,
  `sincronizando` tinyint(1) NOT NULL DEFAULT 1,
  `operativamente_completa` tinyint(1) NOT NULL DEFAULT 0,
  `historicamente_completa` tinyint(1) NOT NULL DEFAULT 0,
  `parcial_por_scope` tinyint(1) NOT NULL DEFAULT 0,
  `degradada` tinyint(1) NOT NULL DEFAULT 0,
  `version_frontera` bigint(20) unsigned NOT NULL DEFAULT 1,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`),
  KEY `idx_fronteras_generaciones_condicion` (`sincronizando`,`degradada`,`operativamente_completa`,`historicamente_completa`,`actualizada_en_utc`),
  CONSTRAINT `fk_fronteras_generaciones_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `chk_fronteras_generaciones_posiciones` CHECK ((`posicion_operativa_validada` is null or `posicion_operativa_validada` <= `posicion_inicial_comprometida`) and (`posicion_historica_validada` is null or `posicion_historica_validada` <= `posicion_inicial_comprometida`)),
  CONSTRAINT `chk_fronteras_generaciones_condiciones` CHECK (`version_frontera` >= 1 and (`operativamente_completa` = 0 or `posicion_operativa_validada` is not null) and (`historicamente_completa` = 0 or `posicion_historica_validada` = `posicion_inicial_comprometida`) and (`historicamente_completa` = 0 or `operativamente_completa` <> 0) and (`sincronizando` = 0 or `historicamente_completa` = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `generaciones_flujos_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` bigint(20) unsigned NOT NULL,
  `clase` enum('inicial','resincronizacion','reconstruccion') NOT NULL,
  `estado` enum('preparada','transfiriendo','fronteraOperativaValidada','completa','degradada','cancelada','sustituida') NOT NULL,
  `rol_generacion` enum('activa','candidata','historica') NOT NULL DEFAULT 'activa',
  `generacion_predecesora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estrategia_candidata` enum('esperar','coexistir','sustituir','ampliarCompatible') DEFAULT NULL,
  `requiere_revalidacion` tinyint(1) NOT NULL DEFAULT 0,
  `activa_unica` tinyint(4) GENERATED ALWAYS AS (if(`rol_generacion` = 'activa',1,NULL)) STORED,
  `installation_propietaria_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_propietario_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_propietario` bigint(20) unsigned NOT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_generaciones_federacion_identidad` (`generacion_id`),
  UNIQUE KEY `uk_generaciones_federacion_ordinal` (`flujo_id`,`ordinal`),
  UNIQUE KEY `uk_generaciones_federacion_pertenencia` (`flujo_id`,`generacion_id`),
  UNIQUE KEY `uk_generaciones_federacion_activa` (`flujo_id`,`activa_unica`),
  KEY `idx_generaciones_federacion_estado` (`flujo_id`,`estado`,`actualizada_en_utc`,`generacion_id`),
  KEY `idx_generaciones_federacion_candidatas` (`flujo_id`,`rol_generacion`,`estado`,`ordinal`),
  KEY `fk_generaciones_federacion_predecesora` (`flujo_id`,`generacion_predecesora_id`),
  CONSTRAINT `fk_generaciones_federacion_flujo` FOREIGN KEY (`flujo_id`) REFERENCES `flujos_federacion` (`flujo_id`),
  CONSTRAINT `fk_generaciones_federacion_predecesora` FOREIGN KEY (`flujo_id`, `generacion_predecesora_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_generaciones_federacion_identidades` CHECK (`generacion_id` regexp '^sfid1\\.generacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_propietaria_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_propietario_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_generaciones_federacion_versiones` CHECK (`ordinal` >= 1 and `version_propietario` >= 1 and `version_estado` >= 1 and `version_registro` >= 1),
  CONSTRAINT `chk_generaciones_federacion_finalizacion` CHECK (`estado` in ('cancelada','sustituida') and `finalizada_en_utc` is not null or `estado` not in ('cancelada','sustituida') and `finalizada_en_utc` is null),
  CONSTRAINT `chk_generaciones_federacion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc` and (`finalizada_en_utc` is null or `finalizada_en_utc` >= `creada_en_utc`)),
  CONSTRAINT `chk_generaciones_federacion_linaje` CHECK (`clase` = 'inicial' and `generacion_predecesora_id` is null and `estrategia_candidata` is null or `clase` <> 'inicial' and `generacion_predecesora_id` is not null and `estrategia_candidata` is not null),
  CONSTRAINT `chk_generaciones_federacion_rol` CHECK (`rol_generacion` in ('activa','candidata') and `estado` not in ('cancelada','sustituida') or `rol_generacion` = 'historica' and `estado` in ('cancelada','sustituida')),
  CONSTRAINT `chk_generaciones_federacion_revalidacion` CHECK (`rol_generacion` <> 'activa' or `requiere_revalidacion` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historial_configuracion_entradas_federadas_logicas` (
  `entrada_id` bigint(20) unsigned NOT NULL,
  `revision_configuracion` bigint(20) unsigned NOT NULL,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `variable` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_inicial` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inversion` tinyint(1) NOT NULL,
  `retardo_cambio_segundos` int(10) unsigned NOT NULL DEFAULT 0,
  `politica_perdida_en_fallo` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `politica_perdida_en_correcto` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `vigente_desde_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `vigente_hasta_utc` datetime(3) DEFAULT NULL,
  `causa_cierre` varchar(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`entrada_id`,`revision_configuracion`),
  KEY `idx_historial_entradas_federadas_monitor` (`monitor_id`,`entrada_id`),
  KEY `idx_historial_entradas_federadas_proyeccion` (`proyeccion_id`,`entrada_id`),
  CONSTRAINT `chk_historial_entradas_federadas_revision` CHECK (`revision_configuracion` >= 1),
  CONSTRAINT `chk_historial_entradas_federadas_estado` CHECK (`estado_inicial` in ('correcto','fallo')),
  CONSTRAINT `chk_historial_entradas_federadas_inversion` CHECK (`inversion` in (0,1)),
  CONSTRAINT `chk_historial_entradas_federadas_perdida_fallo` CHECK (`politica_perdida_en_fallo` in ('forzar_fallo','forzar_correcto','conservar')),
  CONSTRAINT `chk_historial_entradas_federadas_perdida_correcto` CHECK (`politica_perdida_en_correcto` in ('forzar_fallo','forzar_correcto','conservar')),
  CONSTRAINT `chk_historial_logicos_retardo_cambio` CHECK (`retardo_cambio_segundos` <= 86400)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historial_politicas_retencion_recepciones_federacion` (
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `version_politica` bigint(20) unsigned NOT NULL,
  `retencion_recepcion_dias` smallint(5) unsigned DEFAULT NULL,
  `retencion_global_dias` smallint(5) unsigned NOT NULL,
  `retencion_efectiva_dias` smallint(5) unsigned NOT NULL,
  `version_configuracion_portal` bigint(20) unsigned NOT NULL,
  `causa` enum('materializacionInicial','configuracionRecepcion','limiteGlobalCambiado') NOT NULL,
  `efectiva_desde_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`,`familia`,`version_politica`),
  KEY `idx_historial_retencion_fecha` (`efectiva_desde_utc`,`relacion_id`,`familia`,`version_politica`),
  CONSTRAINT `fk_historial_retencion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_historial_retencion_limites` CHECK (`retencion_global_dias` between 1 and 3650 and (`retencion_recepcion_dias` is null or `retencion_recepcion_dias` between 1 and 3650) and `retencion_efectiva_dias` = least(`retencion_global_dias`,coalesce(`retencion_recepcion_dias`,`retencion_global_dias`)) and `version_configuracion_portal` >= 1 and `version_politica` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_historial_retencion_federacion_inmutable
BEFORE UPDATE ON historial_politicas_retencion_recepciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El historial de retencion federada es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_historial_retencion_federacion_no_borrable
BEFORE DELETE ON historial_politicas_retencion_recepciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El historial de retencion federada no se elimina.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historico_avisos_plataforma` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `aviso_id` binary(16) NOT NULL,
  `ordinal` int(10) unsigned NOT NULL,
  `transicion_tipo` enum('apertura','confirmacion_tecnica','actualizacion','escalado','desescalado','resolucion','obsolescencia','reapertura') NOT NULL,
  `estado_anterior` enum('pendiente','resuelto','obsoleto') DEFAULT NULL,
  `estado_nuevo` enum('pendiente','resuelto','obsoleto') NOT NULL,
  `gravedad_anterior` enum('informativa','advertencia','critica') DEFAULT NULL,
  `gravedad_nueva` enum('informativa','advertencia','critica') NOT NULL,
  `contador_detecciones` bigint(20) unsigned NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `registrado_en_utc` datetime(3) NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `detalle` longtext NOT NULL CHECK (json_valid(`detalle`)),
  `contexto_humano` longtext DEFAULT NULL CHECK (json_valid(`contexto_humano`)),
  `resumen` longtext DEFAULT NULL CHECK (json_valid(`resumen`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_historico_avisos_plataforma_ordinal` (`aviso_id`,`ordinal`),
  UNIQUE KEY `uk_historico_avisos_plataforma_evento` (`evento_auditoria_id`),
  KEY `idx_historico_avisos_plataforma_cronologia` (`aviso_id`,`efectivo_en_utc`,`ordinal`),
  CONSTRAINT `fk_historico_avisos_plataforma_aviso` FOREIGN KEY (`aviso_id`) REFERENCES `avisos_plataforma` (`aviso_id`),
  CONSTRAINT `chk_historico_avisos_plataforma_uuidv7` CHECK (substr(hex(`aviso_id`),13,1) = '7' and substr(hex(`aviso_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_historico_avisos_plataforma_contadores` CHECK (`ordinal` >= 1 and `contador_detecciones` >= 1),
  CONSTRAINT `chk_historico_avisos_plataforma_cronologia` CHECK (`registrado_en_utc` >= `efectivo_en_utc`),
  CONSTRAINT `chk_historico_avisos_plataforma_transicion` CHECK (`transicion_tipo` in ('apertura','reapertura') and `estado_anterior` is null and `estado_nuevo` = 'pendiente' and `gravedad_anterior` is null or `transicion_tipo` in ('confirmacion_tecnica','actualizacion') and `estado_anterior` = 'pendiente' and `estado_nuevo` = 'pendiente' and `gravedad_anterior` = `gravedad_nueva` or `transicion_tipo` = 'escalado' and `estado_anterior` = 'pendiente' and `estado_nuevo` = 'pendiente' and (`gravedad_anterior` = 'informativa' and `gravedad_nueva` in ('advertencia','critica') or `gravedad_anterior` = 'advertencia' and `gravedad_nueva` = 'critica') or `transicion_tipo` = 'desescalado' and `estado_anterior` = 'pendiente' and `estado_nuevo` = 'pendiente' and (`gravedad_anterior` = 'critica' and `gravedad_nueva` in ('advertencia','informativa') or `gravedad_anterior` = 'advertencia' and `gravedad_nueva` = 'informativa') or `transicion_tipo` = 'resolucion' and `estado_anterior` = 'pendiente' and `estado_nuevo` = 'resuelto' and `gravedad_anterior` = `gravedad_nueva` or `transicion_tipo` = 'obsolescencia' and `estado_anterior` = 'pendiente' and `estado_nuevo` = 'obsoleto' and `gravedad_anterior` = `gravedad_nueva`),
  CONSTRAINT `chk_historico_avisos_plataforma_detalle` CHECK (char_length(cast(`detalle` as char charset utf8mb4)) <= 16384),
  CONSTRAINT `chk_historico_avisos_plataforma_contexto` CHECK (`contexto_humano` is null and `resumen` is null or `contexto_humano` is not null and `resumen` is not null and char_length(cast(`contexto_humano` as char charset utf8mb4)) <= 16384 and char_length(cast(`resumen` as char charset utf8mb4)) <= 16384)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_historico_avisos_plataforma_impedir_update
BEFORE UPDATE ON historico_avisos_plataforma
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'El historico de avisos de plataforma es append-only' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historico_estados_relaciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int(10) unsigned NOT NULL,
  `cambio_tipo` enum('creacion','identidadCandidata','identidadConfirmada','estadoCambiado','autoridadPerdida','responsabilidadTransferida','compatibilidadCambiada','eliminacion','identidadConflictiva','identidadResuelta') NOT NULL,
  `estado_ciclo_anterior` enum('pendienteVinculacion','pendienteConfirmacionIdentidad','pendienteAutenticacion','vinculada','deshabilitada','eliminada') DEFAULT NULL,
  `estado_ciclo_nuevo` enum('pendienteVinculacion','pendienteConfirmacionIdentidad','pendienteAutenticacion','vinculada','deshabilitada','eliminada') NOT NULL,
  `estado_autoridad_anterior` enum('autorizada','sinAutoridad') DEFAULT NULL,
  `estado_autoridad_nuevo` enum('autorizada','sinAutoridad') NOT NULL,
  `estado_identidad_anterior` enum('valida','conflictiva') DEFAULT NULL,
  `estado_identidad_nuevo` enum('valida','conflictiva') NOT NULL,
  `estado_compatibilidad_anterior` enum('compatible','compatibleParcial','incompatible') DEFAULT NULL,
  `estado_compatibilidad_nuevo` enum('compatible','compatibleParcial','incompatible') DEFAULT NULL,
  `version_autoridad` bigint(20) unsigned NOT NULL,
  `responsable_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `registrado_en_utc` datetime(3) NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `detalle` longtext NOT NULL CHECK (json_valid(`detalle`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_historico_relaciones_ordinal` (`relacion_id`,`ordinal`),
  UNIQUE KEY `uk_historico_relaciones_evento` (`evento_auditoria_id`),
  KEY `idx_historico_relaciones_cronologia` (`relacion_id`,`efectivo_en_utc`,`ordinal`),
  CONSTRAINT `fk_historico_relaciones_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_historico_relaciones_contadores` CHECK (`ordinal` >= 1 and `version_autoridad` >= 1),
  CONSTRAINT `chk_historico_relaciones_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_historico_relaciones_uuidv7` CHECK (substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_historico_relaciones_cronologia` CHECK (`registrado_en_utc` >= `efectivo_en_utc`),
  CONSTRAINT `chk_historico_relaciones_detalle` CHECK (char_length(cast(`detalle` as char charset utf8mb4)) <= 16384)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_historico_relaciones_federacion_append_only
BEFORE UPDATE ON historico_estados_relaciones_federacion
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'El historico de relaciones federadas es append-only' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historico_monitores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `version_catalogo` varchar(40) NOT NULL,
  `tipo_monitor` varchar(40) NOT NULL,
  `estado_tramo` varchar(40) NOT NULL,
  `codigo_ultimo_resultado` varchar(80) NOT NULL,
  `mensaje_ultimo_resultado` varchar(500) NOT NULL,
  `valido_desde_utc` datetime NOT NULL,
  `valido_hasta_utc` datetime NOT NULL,
  `contador_repeticiones` int(10) unsigned NOT NULL DEFAULT 1,
  `ultimo_evento_id` bigint(20) unsigned DEFAULT NULL,
  `payload_tramo` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload_tramo`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_historico_monitores_monitor_desde` (`monitor_id`,`valido_desde_utc`),
  KEY `idx_historico_monitores_scope_desde` (`tenant_id`,`empresa_id`,`sitio_id`,`valido_desde_utc`),
  KEY `idx_historico_monitores_estado_desde` (`estado_tramo`,`valido_desde_utc`),
  KEY `idx_historico_monitores_evento` (`ultimo_evento_id`),
  CONSTRAINT `fk_historico_monitores_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_historico_monitores_ultimo_evento` FOREIGN KEY (`ultimo_evento_id`) REFERENCES `eventos_monitores` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historico_reconciliaciones_flujos_concesion_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_efectiva_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_oferta_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_aceptacion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `frontera_inicial` bigint(20) unsigned DEFAULT NULL,
  `finalizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`flujo_id`,`revision_efectiva_id`),
  KEY `fk_historico_reconciliacion_revision` (`revision_efectiva_id`),
  KEY `fk_historico_reconciliacion_generacion` (`generacion_id`),
  KEY `fk_historico_reconciliacion_version_plan` (`flujo_id`,`revision_efectiva_id`,`generacion_id`),
  CONSTRAINT `fk_historico_reconciliacion_revision` FOREIGN KEY (`revision_efectiva_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_historico_reconciliacion_version_plan` FOREIGN KEY (`flujo_id`, `revision_efectiva_id`, `generacion_id`) REFERENCES `versiones_planes_flujos_federacion` (`flujo_id`, `revision_efectiva_id`, `generacion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_historico_reconciliaciones_inmutable
BEFORE UPDATE ON historico_reconciliaciones_flujos_concesion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El historico de reconciliaciones es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidad_instalacion_federacion` (
  `id` tinyint(3) unsigned NOT NULL,
  `installation_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_identidad_instalacion_federacion_identidad` (`installation_id`),
  CONSTRAINT `chk_identidad_instalacion_federacion_singleton` CHECK (`id` = 1),
  CONSTRAINT `chk_identidad_instalacion_federacion_version` CHECK (`version_contrato` = 1),
  CONSTRAINT `chk_identidad_instalacion_federacion_formato` CHECK (`installation_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_actores_federacion` (
  `tipo_actor` enum('usuario','agente','runtime','sistema','instancia_remota') NOT NULL,
  `clave_actor_local` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`tipo_actor`,`clave_actor_local`),
  UNIQUE KEY `uk_identidades_actores_federacion_elemento` (`elemento_origen_id`),
  CONSTRAINT `chk_identidades_actores_federacion_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_actor_federado_inmutable
BEFORE UPDATE ON identidades_actores_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de un actor es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_actor_federado_protegida
BEFORE DELETE ON identidades_actores_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de un actor es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_contexto_operativo_agentes_federacion` (
  `agente_id_local` bigint(20) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `guid_ultimo` char(36) NOT NULL,
  `nombre_ultimo` varchar(160) NOT NULL,
  `scope_tenant_id` bigint(20) unsigned NOT NULL,
  `scope_empresa_id` bigint(20) unsigned NOT NULL,
  `scope_sitio_id` bigint(20) unsigned NOT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`agente_id_local`),
  UNIQUE KEY `uk_identidades_contexto_agente_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_contexto_agente_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`estado`,`agente_id_local`),
  CONSTRAINT `chk_identidades_contexto_agente_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_contexto_agente_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_contexto_agente_inmutable
BEFORE UPDATE ON identidades_contexto_operativo_agentes_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.agente_id_local=OLD.agente_id_local
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad federada del contexto de agente es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_contexto_agente_protegida
BEFORE DELETE ON identidades_contexto_operativo_agentes_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada del contexto de agente es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_elementos_avisos_federacion` (
  `tipo_elemento` enum('estadoActual','transicion') NOT NULL,
  `clave_local` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `aviso_id` binary(16) NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`tipo_elemento`,`clave_local`),
  UNIQUE KEY `uk_identidades_elementos_avisos_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_elementos_avisos_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`tipo_elemento`,`estado`),
  CONSTRAINT `chk_identidades_elementos_avisos_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_elementos_avisos_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_elemento_aviso_federado_inmutable
BEFORE UPDATE ON identidades_elementos_avisos_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.tipo_elemento=OLD.tipo_elemento
    AND NEW.clave_local=OLD.clave_local
    AND NEW.aviso_id=OLD.aviso_id
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.scope_tenant_id<=>OLD.scope_tenant_id
    AND NEW.scope_empresa_id<=>OLD.scope_empresa_id
    AND NEW.scope_sitio_id<=>OLD.scope_sitio_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad federada de un aviso es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_elemento_aviso_federado_protegida
BEFORE DELETE ON identidades_elementos_avisos_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de un aviso es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_elementos_monitores_federacion` (
  `tipo_elemento` enum('definicion','estadoActual','evento','tramoHistorico','alerta','referenciaTrigger','rangoHistorico') NOT NULL,
  `clave_local` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `monitor_id_local` bigint(20) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned NOT NULL,
  `scope_empresa_id` bigint(20) unsigned NOT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`tipo_elemento`,`clave_local`),
  UNIQUE KEY `uk_identidades_monitores_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_monitores_monitor` (`monitor_id_local`,`tipo_elemento`,`estado`),
  KEY `idx_identidades_monitores_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`tipo_elemento`,`estado`),
  KEY `idx_identidades_monitores_monitor_orden` (`monitor_id_local`,`tipo_elemento`,`clave_local`,`elemento_origen_id`),
  CONSTRAINT `chk_identidades_monitores_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_monitores_clave` CHECK (octet_length(`clave_local`) between 1 and 160 and `clave_local` regexp '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT `chk_identidades_monitores_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc` and (`retirada_en_utc` is null or `retirada_en_utc` >= `creada_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_monitor_federado_inmutable
BEFORE UPDATE ON identidades_elementos_monitores_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.tipo_elemento=OLD.tipo_elemento
    AND NEW.clave_local=OLD.clave_local
    AND NEW.monitor_id_local=OLD.monitor_id_local
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad federada de monitor es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_monitor_federado_protegida
BEFORE DELETE ON identidades_elementos_monitores_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de monitor es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_elementos_telemetria_federacion` (
  `tipo_elemento` enum('fuente','senal','observacion','fotografiaSenal','fotografiaPol','periodoPol','reglaDerivacion','revisionReglaDerivacion','estadoEvaluacion','eventoDerivado','rangoHistorico') NOT NULL,
  `clave_local` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `agente_id_local` bigint(20) unsigned DEFAULT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned NOT NULL,
  `scope_empresa_id` bigint(20) unsigned NOT NULL,
  `scope_sitio_id` bigint(20) unsigned NOT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`tipo_elemento`,`clave_local`),
  UNIQUE KEY `uk_identidades_telemetria_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_telemetria_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`tipo_elemento`,`estado`),
  KEY `idx_identidades_telemetria_agente` (`agente_id_local`,`tipo_elemento`,`estado`,`clave_local`),
  KEY `idx_identidades_telemetria_agente_orden` (`agente_id_local`,`tipo_elemento`,`clave_local`,`elemento_origen_id`),
  CONSTRAINT `chk_identidades_telemetria_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_telemetria_clave` CHECK (octet_length(`clave_local`) between 1 and 160 and `clave_local` regexp '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT `chk_identidades_telemetria_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc` and (`retirada_en_utc` is null or `retirada_en_utc` >= `creada_en_utc`)),
  CONSTRAINT `chk_identidades_telemetria_agente` CHECK (`agente_id_local` is null or `agente_id_local` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_telemetria_atribuida
BEFORE INSERT ON identidades_elementos_telemetria_federacion
FOR EACH ROW
BEGIN
  IF NEW.agente_id_local IS NULL OR NEW.agente_id_local=0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una identidad nueva de telemetria exige agente local.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_telemetria_inmutable
BEFORE UPDATE ON identidades_elementos_telemetria_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.tipo_elemento=OLD.tipo_elemento
    AND NEW.clave_local=OLD.clave_local
    AND (NEW.agente_id_local <=> OLD.agente_id_local)
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad federada de telemetria es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_telemetria_protegida
BEFORE DELETE ON identidades_elementos_telemetria_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de telemetria es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_estructura_organizativa_federacion` (
  `tipo_nodo` enum('tenant','empresa','sitio') NOT NULL,
  `id_local` bigint(20) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `nombre_ultimo` varchar(160) NOT NULL,
  `scope_tenant_id` bigint(20) unsigned NOT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`tipo_nodo`,`id_local`),
  UNIQUE KEY `uk_identidades_estructura_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_estructura_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`tipo_nodo`,`estado`),
  KEY `idx_identidades_estructura_estado` (`estado`,`tipo_nodo`,`actualizada_en_utc`,`id_local`),
  CONSTRAINT `chk_identidades_estructura_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_estructura_scope` CHECK (`tipo_nodo` = 'tenant' and `id_local` = `scope_tenant_id` and `scope_empresa_id` is null and `scope_sitio_id` is null or `tipo_nodo` = 'empresa' and `id_local` = `scope_empresa_id` and `scope_empresa_id` is not null and `scope_sitio_id` is null or `tipo_nodo` = 'sitio' and `id_local` = `scope_sitio_id` and `scope_empresa_id` is not null and `scope_sitio_id` is not null),
  CONSTRAINT `chk_identidades_estructura_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc` and (`retirada_en_utc` is null or `retirada_en_utc` >= `creada_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_estructura_inmutable
BEFORE UPDATE ON identidades_estructura_organizativa_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.tipo_nodo=OLD.tipo_nodo
    AND NEW.id_local=OLD.id_local
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad organizativa federada es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_estructura_protegida
BEFORE DELETE ON identidades_estructura_organizativa_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad organizativa federada es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_eventos_auditoria_federacion` (
  `evento_origen_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`evento_origen_id`),
  UNIQUE KEY `uk_identidades_eventos_auditoria_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_eventos_auditoria_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`evento_origen_id`),
  CONSTRAINT `chk_identidades_eventos_auditoria_uuidv7` CHECK (`evento_origen_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_identidades_eventos_auditoria_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_eventos_auditoria_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidades_eventos_auditoria_inmutables
BEFORE UPDATE ON identidades_eventos_auditoria_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de un evento de auditoria es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidades_eventos_auditoria_protegidas
BEFORE DELETE ON identidades_eventos_auditoria_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de un evento de auditoria es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_idempotentes_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `productor` enum('auditoria_nucleo','portal_web','api_agentes','runtime_alertas','runtime_automatizacion','runtime_dns','runtime_agentes','runtime_operaciones_administrativas','bootstrap','tarea_retencion','portal_federacion','api_federacion','runtime_federacion','recuperacion_password') NOT NULL,
  `clave_operacion` varbinary(128) NOT NULL,
  `rol_evento` enum('principal','salida','entrada','resultado') NOT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `evento_id` binary(16) NOT NULL,
  `estado` enum('vigente','retenido') NOT NULL,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `retenido_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_identidades_auditoria_operacion` (`productor`,`clave_operacion`,`rol_evento`),
  UNIQUE KEY `uk_identidades_auditoria_evento` (`evento_id`),
  KEY `idx_identidades_auditoria_estado` (`estado`,`primera_observacion_utc`,`id`),
  CONSTRAINT `chk_identidades_auditoria_clave` CHECK (octet_length(`clave_operacion`) between 1 and 128),
  CONSTRAINT `chk_identidades_auditoria_retencion` CHECK (`estado` = 'vigente' and `retenido_en_utc` is null or `estado` = 'retenido' and `retenido_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_justificantes_correos_recuperacion_password` (
  `salida_correo_id` bigint(20) unsigned NOT NULL,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`salida_correo_id`,`usuario_id`),
  KEY `idx_identidades_justificantes_correo_usuario` (`usuario_id`,`salida_correo_id`),
  CONSTRAINT `fk_identidades_justificantes_correo_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_identidades_justificantes_correo_usuario` CHECK (`usuario_id` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_registros_triggers_federacion` (
  `tipo_elemento` enum('asignacionMonitor','ejecucionTerminada') NOT NULL,
  `clave_local` varchar(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `trigger_id_local` bigint(20) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`tipo_elemento`,`clave_local`),
  UNIQUE KEY `uk_identidades_registros_triggers_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_registros_triggers_trigger` (`trigger_id_local`,`tipo_elemento`,`estado`),
  CONSTRAINT `chk_identidades_registros_triggers_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_registros_triggers_clave` CHECK (octet_length(`clave_local`) between 1 and 160 and `clave_local` regexp '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT `chk_identidades_registros_triggers_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc` and (`retirada_en_utc` is null or `retirada_en_utc` >= `creada_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_registro_trigger_federado_inmutable
BEFORE UPDATE ON identidades_registros_triggers_federacion FOR EACH ROW
BEGIN
  IF NOT (NEW.tipo_elemento=OLD.tipo_elemento AND NEW.clave_local=OLD.clave_local
    AND NEW.trigger_id_local=OLD.trigger_id_local AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La identidad federada del registro de trigger es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_registro_trigger_federado_protegida
BEFORE DELETE ON identidades_registros_triggers_federacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='La identidad federada del registro de trigger es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_request_id_sesion_agentes` (
  `digest_request_id` binary(32) NOT NULL,
  `request_id` binary(16) NOT NULL,
  `tipo` enum('login','refresh') NOT NULL,
  `agente_id` bigint(20) unsigned DEFAULT NULL,
  `sesion_auditoria_id` binary(16) DEFAULT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `operacion_id` binary(16) NOT NULL,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `expira_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`digest_request_id`),
  UNIQUE KEY `uk_identidades_request_sesion_operacion` (`operacion_id`),
  KEY `idx_identidades_request_sesion_expiracion` (`expira_en_utc`,`digest_request_id`),
  CONSTRAINT `chk_identidades_request_sesion_sujeto` CHECK (`tipo` = 'login' and `agente_id` is not null and `sesion_auditoria_id` is null or `tipo` = 'refresh' and `agente_id` is null and `sesion_auditoria_id` is not null),
  CONSTRAINT `chk_identidades_request_sesion_ventana` CHECK (`primera_observacion_utc` < `expira_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `identidades_triggers_referenciados_federacion` (
  `trigger_id_local` bigint(20) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('vigente','retirado') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retirada_en_utc` datetime(3) DEFAULT NULL,
  `version_registro` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`trigger_id_local`),
  UNIQUE KEY `uk_identidades_triggers_referenciados_elemento` (`elemento_origen_id`),
  KEY `idx_identidades_triggers_referenciados_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`estado`),
  CONSTRAINT `chk_identidades_triggers_referenciados_elemento` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_identidades_triggers_referenciados_estado` CHECK (`version_registro` >= 1 and (`estado` = 'vigente' and `retirada_en_utc` is null or `estado` = 'retirado' and `retirada_en_utc` is not null) and `actualizada_en_utc` >= `creada_en_utc` and (`retirada_en_utc` is null or `retirada_en_utc` >= `creada_en_utc`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_trigger_referenciado_inmutable
BEFORE UPDATE ON identidades_triggers_referenciados_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.trigger_id_local=OLD.trigger_id_local
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_registro=OLD.version_registro+1
    AND NOT (OLD.estado='retirado' AND NEW.estado='vigente')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad federada de trigger referenciado es permanente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_identidad_trigger_referenciado_protegida
BEFORE DELETE ON identidades_triggers_referenciados_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad federada de trigger referenciado es persistencia protegida.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inbox_ocurrencias_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `payload_canonico` mediumtext NOT NULL,
  `payload_sha256` binary(32) NOT NULL,
  `estado_integridad` enum('valida','conflictiva') NOT NULL DEFAULT 'valida',
  `estado_procesamiento` enum('pendiente','procesando','materializada','bloqueada') NOT NULL DEFAULT 'pendiente',
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `recibida_en_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inbox_ocurrencias_identidad` (`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  UNIQUE KEY `uk_inbox_ocurrencias_secuencia` (`installation_origen_id`,`familia`,`elemento_origen_id`,`secuencia_elemento`),
  KEY `idx_inbox_ocurrencias_pendientes` (`estado_integridad`,`estado_procesamiento`,`recibida_en_utc`,`id`),
  KEY `idx_inbox_ocurrencias_elemento` (`installation_origen_id`,`familia`,`elemento_origen_id`,`secuencia_elemento`),
  CONSTRAINT `chk_inbox_ocurrencias_identidades` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$' and `ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_inbox_ocurrencias_contenido` CHECK (`secuencia_elemento` >= 1 and octet_length(`payload_canonico`) between 2 and 2097152 and json_valid(`payload_canonico`) and `veces_observada` >= 1),
  CONSTRAINT `chk_inbox_ocurrencias_cronologia` CHECK (`ultima_observacion_utc` >= `recibida_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_inbox_ocurrencias_contenido_inmutable
BEFORE UPDATE ON inbox_ocurrencias_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id = OLD.id
    AND NEW.installation_origen_id = OLD.installation_origen_id
    AND NEW.familia = OLD.familia
    AND NEW.elemento_origen_id = OLD.elemento_origen_id
    AND NEW.ocurrencia_origen_id = OLD.ocurrencia_origen_id
    AND NEW.secuencia_elemento = OLD.secuencia_elemento
    AND NEW.payload_canonico = OLD.payload_canonico
    AND NEW.payload_sha256 = OLD.payload_sha256
    AND NEW.recibida_en_utc = OLD.recibida_en_utc
    AND NEW.estado_integridad IN ('valida','conflictiva')
    AND NOT (OLD.estado_integridad = 'conflictiva' AND NEW.estado_integridad = 'valida')
    AND NEW.veces_observada >= OLD.veces_observada
    AND NEW.ultima_observacion_utc >= OLD.ultima_observacion_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y contenido de la inbox federada son inmutables.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `incidentes_identidad_federacion` (
  `incidente_id` binary(16) NOT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('sospecha','conflicto','resuelto') NOT NULL,
  `boot_ids` longtext NOT NULL CHECK (json_valid(`boot_ids`)),
  `evidencia` longtext NOT NULL CHECK (json_valid(`evidencia`)),
  `primera_deteccion_utc` datetime(3) NOT NULL,
  `ultima_deteccion_utc` datetime(3) NOT NULL,
  `confirmado_en_utc` datetime(3) DEFAULT NULL,
  `resuelto_en_utc` datetime(3) DEFAULT NULL,
  `resuelto_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `installation_clon_nueva_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `requiere_resincronizacion` tinyint(1) NOT NULL DEFAULT 0,
  `evento_deteccion_id` binary(16) NOT NULL,
  `evento_resolucion_id` binary(16) DEFAULT NULL,
  `incidente_abierto_installation_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`incidente_id`),
  UNIQUE KEY `uk_incidentes_identidad_evento_deteccion` (`evento_deteccion_id`),
  UNIQUE KEY `uk_incidentes_identidad_evento_resolucion` (`evento_resolucion_id`),
  UNIQUE KEY `uk_incidentes_identidad_abierto` (`incidente_abierto_installation_id`),
  KEY `idx_incidentes_identidad_estado` (`estado`,`ultima_deteccion_utc`,`incidente_id`),
  KEY `fk_incidentes_identidad_usuario_resolucion` (`resuelto_por_usuario_id`),
  CONSTRAINT `fk_incidentes_identidad_usuario_resolucion` FOREIGN KEY (`resuelto_por_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_incidentes_identidad_instalaciones` CHECK (`installation_remota_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and (`installation_clon_nueva_id` is null or `installation_clon_nueva_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_incidentes_identidad_estado` CHECK (`estado` = 'sospecha' and `confirmado_en_utc` is null and `resuelto_en_utc` is null and `resuelto_por_usuario_id` is null and `installation_clon_nueva_id` is null and `requiere_resincronizacion` = 0 and `incidente_abierto_installation_id` = `installation_remota_id` or `estado` = 'conflicto' and `confirmado_en_utc` is not null and `resuelto_en_utc` is null and `resuelto_por_usuario_id` is null and `installation_clon_nueva_id` is null and `requiere_resincronizacion` = 0 and `incidente_abierto_installation_id` = `installation_remota_id` or `estado` = 'resuelto' and `confirmado_en_utc` is not null and `resuelto_en_utc` is not null and `resuelto_por_usuario_id` is not null and `installation_clon_nueva_id` is not null and `requiere_resincronizacion` = 1 and `incidente_abierto_installation_id` is null),
  CONSTRAINT `chk_incidentes_identidad_cronologia` CHECK (`ultima_deteccion_utc` >= `primera_deteccion_utc` and (`confirmado_en_utc` is null or `confirmado_en_utc` >= `primera_deteccion_utc`) and (`resuelto_en_utc` is null or `resuelto_en_utc` >= `confirmado_en_utc`)),
  CONSTRAINT `chk_incidentes_identidad_uuidv7` CHECK (substr(hex(`incidente_id`),13,1) = '7' and substr(hex(`incidente_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_deteccion_id`),13,1) = '7' and substr(hex(`evento_deteccion_id`),17,1) in ('8','9','A','B') and (`evento_resolucion_id` is null or substr(hex(`evento_resolucion_id`),13,1) = '7' and substr(hex(`evento_resolucion_id`),17,1) in ('8','9','A','B')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `incidentes_integridad_auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `episodio_id` binary(16) NOT NULL,
  `huella` binary(32) NOT NULL,
  `huella_activa` binary(32) GENERATED ALWAYS AS (case when `estado_deteccion` = 'activo' then `huella` else NULL end) STORED,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `codigo` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_verificacion` enum('rota','incompleta','sin_datos') NOT NULL,
  `estado_deteccion` enum('activo','resuelto') NOT NULL,
  `primera_deteccion_utc` datetime(3) NOT NULL,
  `ultima_deteccion_utc` datetime(3) NOT NULL,
  `resuelto_en_utc` datetime(3) DEFAULT NULL,
  `reconocido_en_utc` datetime(3) DEFAULT NULL,
  `reconocido_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `comentario_reconocimiento` text DEFAULT NULL,
  `evento_reconocimiento_id` binary(16) DEFAULT NULL,
  `primera_ejecucion_id` binary(16) NOT NULL,
  `ultima_ejecucion_id` binary(16) NOT NULL,
  `detalle` longtext NOT NULL CHECK (json_valid(`detalle`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_incidentes_integridad_auditoria_episodio` (`episodio_id`),
  UNIQUE KEY `uk_incidentes_integridad_auditoria_activo` (`huella_activa`),
  KEY `idx_incidentes_integridad_auditoria_cadena` (`clave_cadena`,`estado_deteccion`,`ultima_deteccion_utc`),
  KEY `idx_incidentes_integridad_auditoria_huella` (`huella`,`ultima_deteccion_utc`),
  CONSTRAINT `chk_incidentes_integridad_auditoria_reconocimiento` CHECK (`reconocido_en_utc` is null and `reconocido_por_usuario_id` is null and `evento_reconocimiento_id` is null or `reconocido_en_utc` is not null and `reconocido_por_usuario_id` is not null and `evento_reconocimiento_id` is not null),
  CONSTRAINT `chk_incidentes_integridad_auditoria_resolucion` CHECK (`estado_deteccion` = 'activo' and `resuelto_en_utc` is null or `estado_deteccion` = 'resuelto' and `resuelto_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `intenciones_ddns_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `intencion_id` binary(16) NOT NULL,
  `concesion_interna_id` bigint(20) unsigned NOT NULL,
  `agente_id_fotografia` bigint(20) unsigned NOT NULL,
  `registro_dns_id_fotografia` bigint(20) unsigned NOT NULL,
  `origen` enum('agente_explicita','pol_observada','usuario') NOT NULL,
  `version_ddns` bigint(20) unsigned NOT NULL,
  `modo` enum('observada','declarada') NOT NULL,
  `estado_deseado_canonico` longtext NOT NULL CHECK (json_valid(`estado_deseado_canonico`)),
  `estado_deseado_sha256` binary(32) NOT NULL,
  `causa_tipo` enum('solicitud_agente','pol','usuario') NOT NULL,
  `causa_id` binary(16) DEFAULT NULL,
  `hito` enum('intencion_aceptada','contenido_deseado_persistido','contenido_publicado') NOT NULL DEFAULT 'intencion_aceptada',
  `terminal` enum('publicada','sustituida','publicacion_fallida','objetivo_incompatible','objetivo_eliminado') DEFAULT NULL,
  `aceptada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `persistida_en_utc` datetime(3) DEFAULT NULL,
  `publicada_en_utc` datetime(3) DEFAULT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_intenciones_ddns_id_publico` (`intencion_id`),
  UNIQUE KEY `uk_intenciones_ddns_concesion_version` (`concesion_interna_id`,`version_ddns`),
  UNIQUE KEY `uk_intenciones_ddns_causa_concesion` (`concesion_interna_id`,`causa_tipo`,`causa_id`),
  KEY `idx_intenciones_ddns_objetivo` (`registro_dns_id_fotografia`,`aceptada_en_utc`,`id`),
  CONSTRAINT `fk_intenciones_ddns_concesion` FOREIGN KEY (`concesion_interna_id`) REFERENCES `concesiones_ddns_agentes` (`id`),
  CONSTRAINT `chk_intenciones_ddns_uuidv7` CHECK (substr(hex(`intencion_id`),13,1) = '7' and substr(hex(`intencion_id`),17,1) in ('8','9','A','B') and (`causa_id` is null or substr(hex(`causa_id`),13,1) = '7' and substr(hex(`causa_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_intenciones_ddns_identidad` CHECK (`agente_id_fotografia` > 0 and `registro_dns_id_fotografia` > 0 and `version_ddns` > 0),
  CONSTRAINT `chk_intenciones_ddns_estado` CHECK (json_valid(`estado_deseado_canonico`) and (`hito` = 'intencion_aceptada' and `persistida_en_utc` is null and `publicada_en_utc` is null or `hito` = 'contenido_deseado_persistido' and `persistida_en_utc` is not null and `publicada_en_utc` is null or `hito` = 'contenido_publicado' and `persistida_en_utc` is not null and `publicada_en_utc` is not null) and (`terminal` is null and `terminada_en_utc` is null or `terminal` is not null and `terminada_en_utc` is not null)),
  CONSTRAINT `chk_intenciones_ddns_causa` CHECK (`origen` = 'agente_explicita' and `causa_tipo` = 'solicitud_agente' and `causa_id` is not null or `origen` = 'pol_observada' and `causa_tipo` = 'pol' and `causa_id` is not null or `origen` = 'usuario' and `causa_tipo` = 'usuario')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `intentos_correos_salida` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `salida_correo_id` bigint(20) unsigned NOT NULL,
  `reclamacion_correo_id` bigint(20) unsigned NOT NULL,
  `perfil_version` smallint(5) unsigned NOT NULL DEFAULT 1,
  `numero` int(10) unsigned NOT NULL,
  `configuracion_version` bigint(20) unsigned NOT NULL,
  `smtp_message_id` varchar(384) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('en_curso','aceptado','rechazado','fallido_reintentable','fallido_final','ambiguo') NOT NULL DEFAULT 'en_curso',
  `iniciado_en_utc` datetime(3) NOT NULL,
  `finalizado_en_utc` datetime(3) DEFAULT NULL,
  `clasificacion` enum('aceptacion_demostrada','rechazo_permanente','fallo_reintentable','fallo_final','resultado_ambiguo') DEFAULT NULL,
  `codigo` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `respuesta_saneada` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_intentos_correo_salida_numero` (`salida_correo_id`,`numero`),
  UNIQUE KEY `uk_intentos_correo_reclamacion` (`reclamacion_correo_id`),
  KEY `idx_intentos_correo_salida_estado` (`salida_correo_id`,`estado`,`id`),
  KEY `idx_intentos_correo_finalizacion` (`estado`,`finalizado_en_utc`,`id`),
  CONSTRAINT `fk_intentos_correo_reclamacion` FOREIGN KEY (`reclamacion_correo_id`) REFERENCES `reclamaciones_correos_salida` (`id`),
  CONSTRAINT `fk_intentos_correo_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`),
  CONSTRAINT `chk_intentos_correo_version` CHECK (`perfil_version` = 1 and `numero` > 0 and `configuracion_version` > 0),
  CONSTRAINT `chk_intentos_correo_estado` CHECK (`estado` = 'en_curso' and `finalizado_en_utc` is null and `clasificacion` is null and `codigo` is null and `respuesta_saneada` is null or `estado` <> 'en_curso' and `finalizado_en_utc` is not null and `clasificacion` is not null and `codigo` is not null and `respuesta_saneada` is not null),
  CONSTRAINT `chk_intentos_correo_clasificacion` CHECK (`estado` = 'en_curso' or `estado` = 'aceptado' and `clasificacion` = 'aceptacion_demostrada' or `estado` = 'rechazado' and `clasificacion` = 'rechazo_permanente' or `estado` = 'fallido_reintentable' and `clasificacion` = 'fallo_reintentable' or `estado` = 'fallido_final' and `clasificacion` = 'fallo_final' or `estado` = 'ambiguo' and `clasificacion` = 'resultado_ambiguo'),
  CONSTRAINT `chk_intentos_correo_cronologia` CHECK (`finalizado_en_utc` is null or `finalizado_en_utc` >= `iniciado_en_utc`),
  CONSTRAINT `chk_intentos_correo_respuesta` CHECK (`respuesta_saneada` is null or octet_length(`respuesta_saneada`) <= 2000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `intentos_lotes_recepcion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `lote_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `numero_intento` bigint(20) unsigned NOT NULL,
  `clase` enum('inicial','reintento','replayTerminal') NOT NULL,
  `total_terminales` int(10) unsigned NOT NULL,
  `total_temporales` int(10) unsigned NOT NULL,
  `creado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_intentos_lotes_numero` (`lote_id`,`numero_intento`),
  UNIQUE KEY `uk_intentos_lotes_pertenencia` (`id`,`lote_id`),
  KEY `idx_intentos_lotes_recientes` (`lote_id`,`numero_intento` DESC),
  CONSTRAINT `fk_intentos_lotes_lote` FOREIGN KEY (`lote_id`) REFERENCES `lotes_recepcion_federacion` (`lote_id`),
  CONSTRAINT `chk_intentos_lotes_totales` CHECK (`numero_intento` >= 1 and `total_terminales` + `total_temporales` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_intentos_lotes_recepcion_inmutables
BEFORE UPDATE ON intentos_lotes_recepcion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un intento de lote federado es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `intentos_publicacion_ddns` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `concesion_interna_id` bigint(20) unsigned NOT NULL,
  `intencion_interna_id` bigint(20) unsigned NOT NULL,
  `version_ddns` bigint(20) unsigned NOT NULL,
  `numero_intento` tinyint(3) unsigned NOT NULL,
  `generacion_dns` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('pendiente','procesando','publicada','rechazo_atribuible','bloqueada','sustituida','objetivo_incompatible','objetivo_eliminado') NOT NULL DEFAULT 'pendiente',
  `atribucion` enum('registro','global','ambigua') DEFAULT NULL,
  `disponible_en_utc` datetime(3) DEFAULT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `codigo_diagnostico` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `mensaje_diagnostico` varchar(512) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `actualizada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_intentos_publicacion_ddns_version` (`concesion_interna_id`,`version_ddns`,`numero_intento`),
  KEY `idx_intentos_publicacion_ddns_reclamacion` (`estado`,`disponible_en_utc`,`creada_en_utc`,`id`),
  KEY `idx_intentos_publicacion_ddns_lease` (`estado`,`lease_expira_utc`,`id`),
  KEY `idx_intentos_publicacion_ddns_intencion` (`intencion_interna_id`,`id`),
  CONSTRAINT `fk_intentos_publicacion_ddns_concesion` FOREIGN KEY (`concesion_interna_id`) REFERENCES `concesiones_ddns_agentes` (`id`),
  CONSTRAINT `fk_intentos_publicacion_ddns_intencion` FOREIGN KEY (`intencion_interna_id`) REFERENCES `intenciones_ddns_agentes` (`id`),
  CONSTRAINT `chk_intentos_publicacion_ddns_numero` CHECK (`version_ddns` > 0 and `numero_intento` between 1 and 3),
  CONSTRAINT `chk_intentos_publicacion_ddns_diagnostico` CHECK (`codigo_diagnostico` is null and `mensaje_diagnostico` is null or `codigo_diagnostico` regexp '^[a-z][a-z0-9_]{0,63}$' and octet_length(`mensaje_diagnostico`) between 1 and 512),
  CONSTRAINT `chk_intentos_publicacion_ddns_lease` CHECK (`estado` = 'procesando' and octet_length(`instancia_id`) between 1 and 128 and `lease_token` is not null and `lease_expira_utc` > `actualizada_en_utc` and `fencing_token` > 0 and `terminada_en_utc` is null or `estado` <> 'procesando' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null),
  CONSTRAINT `chk_intentos_publicacion_ddns_terminal` CHECK (`estado` in ('publicada','rechazo_atribuible','sustituida','objetivo_incompatible','objetivo_eliminado') and `terminada_en_utc` is not null or `estado` in ('pendiente','procesando','bloqueada') and `terminada_en_utc` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `intercambios_declaraciones_concesion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `intercambio_id` binary(16) NOT NULL,
  `direccion` enum('entrante','saliente') NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_emisora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_receptora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `papel` enum('oferta','aceptacion') NOT NULL,
  `revision_origen_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_ordinal` bigint(20) unsigned NOT NULL,
  `version_autoridad` bigint(20) unsigned NOT NULL,
  `protocolo_version` int(10) unsigned NOT NULL,
  `seleccion` longtext NOT NULL CHECK (json_valid(`seleccion`)),
  `huella_seleccion` binary(32) NOT NULL,
  `emitida_en_origen_utc` datetime(3) NOT NULL,
  `estado` enum('pendiente','confirmada') NOT NULL,
  `confirmacion_id` binary(16) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `confirmada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_intercambios_declaracion_id` (`intercambio_id`),
  UNIQUE KEY `uk_intercambios_declaracion_revision` (`direccion`,`relacion_id`,`revision_origen_id`),
  UNIQUE KEY `uk_intercambios_declaracion_orden_origen` (`direccion`,`relacion_id`,`papel`,`version_autoridad`,`revision_ordinal`),
  UNIQUE KEY `uk_intercambios_declaracion_confirmacion` (`confirmacion_id`),
  KEY `idx_intercambios_declaracion_pendientes` (`direccion`,`estado`,`relacion_id`,`creada_en_utc`),
  KEY `fk_intercambios_declaracion_relacion` (`relacion_id`),
  CONSTRAINT `fk_intercambios_declaracion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_intercambios_declaracion_identidades` CHECK (`installation_emisora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_receptora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `revision_origen_id` regexp '^sfid1\\.revision_concesion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_intercambios_declaracion_versiones` CHECK (`version_autoridad` >= 1 and `protocolo_version` >= 1),
  CONSTRAINT `chk_intercambios_declaracion_estado` CHECK (`estado` = 'pendiente' and `confirmacion_id` is null and `confirmada_en_utc` is null or `estado` = 'confirmada' and `confirmacion_id` is not null and `confirmada_en_utc` is not null),
  CONSTRAINT `chk_intercambios_declaracion_json` CHECK (json_valid(`seleccion`) and octet_length(cast(`seleccion` as char charset utf8mb4)) between 2 and 65535),
  CONSTRAINT `chk_intercambios_declaracion_ordinal` CHECK (`revision_ordinal` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `invitaciones_establecimiento_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `invitacion_id` char(29) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_receptora_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credencial_hash` binary(32) NOT NULL,
  `estado` enum('vigente','consumida','revocada','expirada') NOT NULL,
  `emitida_por_usuario_id` bigint(20) unsigned NOT NULL,
  `revocada_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `emitida_en_utc` datetime(3) NOT NULL,
  `expira_en_utc` datetime(3) NOT NULL,
  `consumida_en_utc` datetime(3) DEFAULT NULL,
  `revocada_en_utc` datetime(3) DEFAULT NULL,
  `evento_emision_id` binary(16) NOT NULL,
  `evento_revocacion_id` binary(16) DEFAULT NULL,
  `evento_consumo_id` binary(16) DEFAULT NULL,
  `solicitud_canje_id` binary(16) DEFAULT NULL,
  `installation_emisora_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `boot_emisor_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `relacion_vigente_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitaciones_federacion_identidad` (`invitacion_id`),
  UNIQUE KEY `uk_invitaciones_federacion_hash` (`credencial_hash`),
  UNIQUE KEY `uk_invitaciones_federacion_evento_emision` (`evento_emision_id`),
  UNIQUE KEY `uk_invitaciones_federacion_evento_revocacion` (`evento_revocacion_id`),
  UNIQUE KEY `uk_invitaciones_federacion_relacion_vigente` (`relacion_vigente_id`),
  UNIQUE KEY `uk_invitaciones_federacion_evento_consumo` (`evento_consumo_id`),
  UNIQUE KEY `uk_invitaciones_federacion_solicitud_canje` (`solicitud_canje_id`),
  KEY `idx_invitaciones_federacion_expiracion` (`estado`,`expira_en_utc`,`invitacion_id`),
  KEY `idx_invitaciones_federacion_relacion` (`relacion_id`,`emitida_en_utc`,`invitacion_id`),
  KEY `fk_invitaciones_federacion_usuario_emision` (`emitida_por_usuario_id`),
  KEY `fk_invitaciones_federacion_usuario_revocacion` (`revocada_por_usuario_id`),
  KEY `idx_invitaciones_federacion_emisor` (`installation_emisora_id`,`consumida_en_utc`,`invitacion_id`),
  CONSTRAINT `fk_invitaciones_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_invitaciones_federacion_usuario_emision` FOREIGN KEY (`emitida_por_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `fk_invitaciones_federacion_usuario_revocacion` FOREIGN KEY (`revocada_por_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_invitaciones_federacion_cronologia` CHECK (`expira_en_utc` > `emitida_en_utc` and (`consumida_en_utc` is null or `consumida_en_utc` >= `emitida_en_utc`) and (`revocada_en_utc` is null or `revocada_en_utc` >= `emitida_en_utc`)),
  CONSTRAINT `chk_invitaciones_federacion_estado` CHECK (`estado` = 'vigente' and `relacion_vigente_id` = `relacion_id` and `consumida_en_utc` is null and `revocada_en_utc` is null and `revocada_por_usuario_id` is null and `evento_revocacion_id` is null or `estado` = 'consumida' and `relacion_vigente_id` is null and `consumida_en_utc` is not null and `revocada_en_utc` is null and `revocada_por_usuario_id` is null and `evento_revocacion_id` is null or `estado` = 'revocada' and `relacion_vigente_id` is null and `consumida_en_utc` is null and `revocada_en_utc` is not null and `revocada_por_usuario_id` is not null and `evento_revocacion_id` is not null or `estado` = 'expirada' and `relacion_vigente_id` is null and `consumida_en_utc` is null and `revocada_en_utc` is null and `revocada_por_usuario_id` is null and `evento_revocacion_id` is null),
  CONSTRAINT `chk_invitaciones_federacion_uuidv7` CHECK (substr(hex(`evento_emision_id`),13,1) = '7' and substr(hex(`evento_emision_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B') and (`evento_revocacion_id` is null or substr(hex(`evento_revocacion_id`),13,1) = '7' and substr(hex(`evento_revocacion_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_invitaciones_federacion_identidades` CHECK (`invitacion_id` regexp '^sfinv1_[A-Za-z0-9_-]{21}[AQgw]$' and `relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_receptora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_invitaciones_federacion_testimonio_consumo` CHECK (`estado` = 'consumida' and `evento_consumo_id` is not null and `solicitud_canje_id` is not null and `installation_emisora_id` is not null and `boot_emisor_id` is not null and `installation_emisora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_emisor_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$' and substr(hex(`evento_consumo_id`),13,1) = '7' and substr(hex(`evento_consumo_id`),17,1) in ('8','9','A','B') and substr(hex(`solicitud_canje_id`),13,1) = '7' and substr(hex(`solicitud_canje_id`),17,1) in ('8','9','A','B') or `estado` <> 'consumida' and `evento_consumo_id` is null and `solicitud_canje_id` is null and `installation_emisora_id` is null and `boot_emisor_id` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_invitaciones_federacion_transiciones
BEFORE UPDATE ON invitaciones_establecimiento_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.invitacion_id <=> NEW.invitacion_id
    AND OLD.relacion_id <=> NEW.relacion_id
    AND OLD.installation_receptora_id <=> NEW.installation_receptora_id
    AND OLD.credencial_hash <=> NEW.credencial_hash
    AND OLD.emitida_por_usuario_id <=> NEW.emitida_por_usuario_id
    AND OLD.emitida_en_utc <=> NEW.emitida_en_utc
    AND OLD.expira_en_utc <=> NEW.expira_en_utc
    AND OLD.evento_emision_id <=> NEW.evento_emision_id
    AND OLD.correlacion_id <=> NEW.correlacion_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y credencial de una invitacion son inmutables.';
  END IF;

  IF OLD.estado <> 'vigente' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una invitacion terminal no admite nuevas transiciones.';
  END IF;

  IF NEW.estado NOT IN ('consumida', 'revocada', 'expirada') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La invitacion solo admite una transicion terminal.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `linaje_versiones_nodos_organizativos_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `ordinal` tinyint(3) unsigned NOT NULL,
  `tipo_ancestro` enum('tenant','empresa') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `visibilidad` enum('seleccionada','opaca') NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`ordinal`),
  UNIQUE KEY `uk_linaje_nodo_tipo` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`tipo_ancestro`),
  KEY `idx_linaje_nodo_origen` (`elemento_origen_id`,`tipo_ancestro`),
  CONSTRAINT `fk_linaje_version_nodo_organizativo` FOREIGN KEY (`proyeccion_id`, `generacion_id`, `secuencia_elemento`) REFERENCES `versiones_nodos_organizativos_remotos` (`proyeccion_id`, `generacion_id`, `secuencia_elemento`),
  CONSTRAINT `chk_linaje_nodo_organizativo_ordinal` CHECK (`ordinal` = 1 and `tipo_ancestro` = 'tenant' or `ordinal` = 2 and `tipo_ancestro` = 'empresa'),
  CONSTRAINT `chk_linaje_nodo_organizativo_identidad` CHECK (`elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_linaje_nodos_organizativos_inmutable
BEFORE UPDATE ON linaje_versiones_nodos_organizativos_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El linaje organizativo remoto de una version es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `localizaciones_relaciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `localizacion_id` binary(16) NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `endpoint_https` varchar(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('propuesta','activa','sustituida','rechazada') NOT NULL,
  `relacion_localizacion_activa` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `origen_propuesta` enum('configuracionLocal','contraparte','recuperacion') NOT NULL,
  `propuesta_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `aprobada_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `propuesta_en_utc` datetime(3) NOT NULL,
  `aprobada_en_utc` datetime(3) DEFAULT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `evento_aprobacion_id` binary(16) DEFAULT NULL,
  `correlacion_id` binary(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_localizaciones_relaciones_identidad` (`localizacion_id`),
  UNIQUE KEY `uk_localizaciones_relaciones_evento` (`evento_auditoria_id`),
  UNIQUE KEY `uk_localizaciones_relaciones_activa` (`relacion_localizacion_activa`),
  UNIQUE KEY `uk_localizaciones_relaciones_evento_aprobacion` (`evento_aprobacion_id`),
  KEY `idx_localizaciones_relaciones_historico` (`relacion_id`,`propuesta_en_utc`,`localizacion_id`),
  CONSTRAINT `fk_localizaciones_relaciones_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_localizaciones_relaciones_uuidv7` CHECK (substr(hex(`localizacion_id`),13,1) = '7' and substr(hex(`localizacion_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_localizaciones_relaciones_endpoint` CHECK (`endpoint_https` regexp '^https://[^/?#@]+(?:/[^?#@]*)?$' and octet_length(`endpoint_https`) between 9 and 2048),
  CONSTRAINT `chk_localizaciones_relaciones_estado` CHECK (`estado` = 'propuesta' and `relacion_localizacion_activa` is null and `aprobada_por_usuario_id` is null and `aprobada_en_utc` is null and `finalizada_en_utc` is null or `estado` = 'activa' and `relacion_localizacion_activa` = `relacion_id` and `aprobada_por_usuario_id` is not null and `aprobada_en_utc` is not null and `finalizada_en_utc` is null or `estado` in ('sustituida','rechazada') and `relacion_localizacion_activa` is null and `finalizada_en_utc` is not null),
  CONSTRAINT `chk_localizaciones_relaciones_cronologia` CHECK ((`aprobada_en_utc` is null or `aprobada_en_utc` >= `propuesta_en_utc`) and (`finalizada_en_utc` is null or `finalizada_en_utc` >= `propuesta_en_utc`)),
  CONSTRAINT `chk_localizaciones_relaciones_evento_aprobacion_uuidv7` CHECK (`evento_aprobacion_id` is null or substr(hex(`evento_aprobacion_id`),13,1) = '7' and substr(hex(`evento_aprobacion_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_localizaciones_relaciones_proteger_contenido
BEFORE UPDATE ON localizaciones_relaciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.localizacion_id <=> NEW.localizacion_id
    AND OLD.relacion_id <=> NEW.relacion_id
    AND OLD.endpoint_https <=> NEW.endpoint_https
    AND OLD.origen_propuesta <=> NEW.origen_propuesta
    AND OLD.propuesta_por_usuario_id <=> NEW.propuesta_por_usuario_id
    AND OLD.propuesta_en_utc <=> NEW.propuesta_en_utc
    AND OLD.evento_auditoria_id <=> NEW.evento_auditoria_id
    AND OLD.correlacion_id <=> NEW.correlacion_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La propuesta de localizacion federada es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lotes_idempotentes_telemetria_agentes` (
  `agente_id` bigint(20) unsigned NOT NULL,
  `telemetria_request_id` binary(16) NOT NULL,
  `huella_sha256` binary(32) NOT NULL,
  `token_reserva` binary(16) NOT NULL,
  `estado` enum('reservado','confirmado') NOT NULL DEFAULT 'reservado',
  `resultado_estable` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`resultado_estable`)),
  `recibido_en_utc` datetime(6) DEFAULT NULL,
  `expira_en_utc` datetime(6) NOT NULL,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`agente_id`,`telemetria_request_id`),
  KEY `idx_lotes_idempotentes_telemetria_purga` (`expira_en_utc`,`agente_id`,`telemetria_request_id`),
  CONSTRAINT `fk_lotes_idempotentes_telemetria_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_lotes_idempotentes_telemetria_resultado` CHECK (`estado` = 'reservado' and `resultado_estable` is null or `estado` = 'confirmado' and `resultado_estable` is not null),
  CONSTRAINT `chk_lotes_idempotentes_telemetria_resultado_tamano` CHECK (`resultado_estable` is null or char_length(cast(`resultado_estable` as char charset utf8mb4)) <= 16384)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lotes_recepcion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `lote_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `composicion_sha256` binary(32) NOT NULL,
  `total_entregas` int(10) unsigned NOT NULL,
  `estado` enum('pendiente','parcialTemporal','terminal') NOT NULL DEFAULT 'pendiente',
  `total_intentos` bigint(20) unsigned NOT NULL DEFAULT 0,
  `creado_en_utc` datetime(3) NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_lotes_recepcion_identidad` (`lote_id`),
  KEY `idx_lotes_recepcion_trabajo` (`estado`,`actualizado_en_utc`,`relacion_id`,`flujo_id`,`lote_id`),
  KEY `fk_lotes_recepcion_relacion` (`relacion_id`),
  KEY `fk_lotes_recepcion_generacion` (`flujo_id`,`generacion_id`),
  CONSTRAINT `fk_lotes_recepcion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_lotes_recepcion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_lotes_recepcion_identidades` CHECK (`lote_id` regexp '^sfid1\\.lote\\.[A-Za-z0-9_-]{21}[AQgw]$' and `flujo_id` regexp '^sfid1\\.flujo\\.[A-Za-z0-9_-]{21}[AQgw]$' and `generacion_id` regexp '^sfid1\\.generacion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_lotes_recepcion_totales` CHECK (`total_entregas` >= 1 and `total_intentos` >= 0),
  CONSTRAINT `chk_lotes_recepcion_cronologia` CHECK (`actualizado_en_utc` >= `creado_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_lotes_recepcion_composicion_inmutable
BEFORE UPDATE ON lotes_recepcion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id = OLD.id
    AND NEW.lote_id = OLD.lote_id
    AND NEW.relacion_id = OLD.relacion_id
    AND NEW.flujo_id = OLD.flujo_id
    AND NEW.generacion_id = OLD.generacion_id
    AND NEW.composicion_sha256 = OLD.composicion_sha256
    AND NEW.total_entregas = OLD.total_entregas
    AND NEW.creado_en_utc = OLD.creado_en_utc
    AND NEW.total_intentos = OLD.total_intentos + 1
    AND NEW.actualizado_en_utc >= OLD.actualizado_en_utc
    AND (
      (OLD.estado = 'pendiente'
        AND NEW.estado IN ('parcialTemporal','terminal'))
      OR (OLD.estado = 'parcialTemporal'
        AND NEW.estado IN ('parcialTemporal','terminal'))
      OR (OLD.estado = 'terminal' AND NEW.estado = 'terminal')
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La composición y progresión del lote recibido son inmutables.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `migracion_sesiones_5_21` (
  `id` tinyint(3) unsigned NOT NULL,
  `fase` enum('pendiente','sql_saneado','redis_limpio','completada') NOT NULL,
  `iniciada_en_utc` datetime(3) DEFAULT NULL,
  `sql_saneado_en_utc` datetime(3) DEFAULT NULL,
  `redis_limpio_en_utc` datetime(3) DEFAULT NULL,
  `completada_en_utc` datetime(3) DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_migracion_sesiones_5_21_singleton` CHECK (`id` = 1),
  CONSTRAINT `chk_migracion_sesiones_5_21_fases` CHECK (`fase` = 'pendiente' and `sql_saneado_en_utc` is null and `redis_limpio_en_utc` is null and `completada_en_utc` is null or `fase` = 'sql_saneado' and `iniciada_en_utc` is not null and `sql_saneado_en_utc` is not null and `redis_limpio_en_utc` is null and `completada_en_utc` is null or `fase` = 'redis_limpio' and `iniciada_en_utc` is not null and `sql_saneado_en_utc` is not null and `redis_limpio_en_utc` is not null and `completada_en_utc` is null or `fase` = 'completada' and `iniciada_en_utc` is not null and `sql_saneado_en_utc` is not null and `redis_limpio_en_utc` is not null and `completada_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

INSERT INTO `migracion_sesiones_5_21` VALUES
(1,'pendiente',NULL,NULL,NULL,NULL,'2026-11-07 21:16:43.710');
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_migracion_sesiones_5_21_fases_monotonicas
BEFORE UPDATE ON migracion_sesiones_5_21
FOR EACH ROW
BEGIN
  IF NOT (OLD.id <=> NEW.id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de migracion_5_21 es inmutable';
  END IF;

  IF NOT (
    (OLD.fase = 'pendiente' AND NEW.fase IN ('pendiente', 'sql_saneado'))
    OR (OLD.fase = 'sql_saneado' AND NEW.fase IN ('sql_saneado', 'redis_limpio'))
    OR (OLD.fase = 'redis_limpio' AND NEW.fase IN ('redis_limpio', 'completada'))
    OR (OLD.fase = 'completada' AND NEW.fase = 'completada')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migracion_5_21 no puede retroceder ni saltar fases';
  END IF;

  IF OLD.fase = 'completada' AND NOT (
    OLD.iniciada_en_utc <=> NEW.iniciada_en_utc
    AND OLD.sql_saneado_en_utc <=> NEW.sql_saneado_en_utc
    AND OLD.redis_limpio_en_utc <=> NEW.redis_limpio_en_utc
    AND OLD.completada_en_utc <=> NEW.completada_en_utc
    AND OLD.actualizada_en_utc <=> NEW.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'migracion_5_21 completada es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `nombre` varchar(160) NOT NULL,
  `tipo` varchar(40) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `interpretacion_estado` enum('normal','invertida') NOT NULL DEFAULT 'normal',
  `descripcion_fallo` varchar(512) NOT NULL DEFAULT '',
  `posible_solucion` varchar(512) NOT NULL DEFAULT '',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `intervalo_ejecucion_segundos` smallint(5) unsigned NOT NULL DEFAULT 60,
  `desfase_inicial_segundos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `inferencias_indisponible_consecutivas` smallint(5) unsigned NOT NULL DEFAULT 1,
  `inferencias_disponible_consecutivas` smallint(5) unsigned NOT NULL DEFAULT 1,
  `entrada_composicion_booleana` tinyint(1) NOT NULL DEFAULT 0,
  `configuracion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_monitores_id_tipo_scope` (`id`,`tipo`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_monitores_scope` (`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_monitores_tipo_activo` (`tipo`,`activo`),
  KEY `idx_monitores_empresa_activo` (`empresa_id`,`activo`),
  KEY `idx_monitores_sitio_activo` (`sitio_id`,`activo`),
  KEY `fk_monitores_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `fk_monitores_sitio_empresa_tenant` (`sitio_id`,`empresa_id`,`tenant_id`),
  KEY `idx_monitores_runtime_activo_intervalo` (`activo`,`intervalo_ejecucion_segundos`,`desfase_inicial_segundos`,`id`),
  CONSTRAINT `fk_monitores_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_monitores_sitio_empresa_tenant` FOREIGN KEY (`sitio_id`, `empresa_id`, `tenant_id`) REFERENCES `sitios` (`id`, `empresa_id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_monitores_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_monitores_histeresis_indisponible` CHECK (`inferencias_indisponible_consecutivas` between 1 and 1000),
  CONSTRAINT `chk_monitores_histeresis_disponible` CHECK (`inferencias_disponible_consecutivas` between 1 and 1000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones_triggers_correo` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ejecucion_trigger_id` bigint(20) unsigned NOT NULL,
  `clave_idempotencia` binary(32) NOT NULL,
  `perfil_version` smallint(5) unsigned NOT NULL DEFAULT 1,
  `revision_declaracion` bigint(20) unsigned NOT NULL,
  `trigger_id` bigint(20) unsigned DEFAULT NULL,
  `trigger_id_fotografia` bigint(20) unsigned NOT NULL,
  `asignacion_trigger_monitor_id` bigint(20) unsigned DEFAULT NULL,
  `asignacion_id_fotografia` bigint(20) unsigned NOT NULL,
  `monitor_id` bigint(20) unsigned DEFAULT NULL,
  `monitor_id_fotografia` bigint(20) unsigned NOT NULL,
  `alerta_auditoria_id` binary(16) NOT NULL,
  `evento_disparo` enum('apertura_alerta','cierre_alerta') NOT NULL,
  `fecha_ocurrencia_utc` datetime(3) NOT NULL,
  `valido_desde_utc` datetime(3) NOT NULL,
  `nombre_monitor` varchar(160) NOT NULL,
  `tipo_monitor` varchar(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_monitor` enum('disponible','indisponible') NOT NULL,
  `origen_causal` enum('directo','telemetria','logico','otro') NOT NULL,
  `codigo_resultado` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `mensaje_resultado` varchar(512) DEFAULT NULL,
  `descripcion_fallo` varchar(512) DEFAULT NULL,
  `posible_solucion` varchar(512) DEFAULT NULL,
  `scope_trigger_nivel` enum('portal','tenant','empresa','sitio') NOT NULL,
  `scope_trigger_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_trigger_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_trigger_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `scope_monitor_nivel` enum('portal','tenant','empresa','sitio') NOT NULL,
  `scope_monitor_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_monitor_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_monitor_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `referencia_estado_url` varchar(2048) NOT NULL,
  `referencia_historico_url` varchar(2048) NOT NULL,
  `definicion_mensaje_version` smallint(5) unsigned NOT NULL,
  `asunto_plantilla` varchar(255) NOT NULL,
  `texto_introduccion` varchar(2000) DEFAULT NULL,
  `texto_cierre` varchar(2000) DEFAULT NULL,
  `renderizador_version` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asunto` varchar(255) NOT NULL,
  `cuerpo_base_texto` text NOT NULL,
  `origen_publico` varchar(2048) NOT NULL,
  `renderizado_en_utc` datetime(3) NOT NULL,
  `aceptada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notificaciones_correo_ejecucion` (`ejecucion_trigger_id`),
  UNIQUE KEY `uk_notificaciones_correo_id_ejecucion` (`id`,`ejecucion_trigger_id`),
  UNIQUE KEY `uk_notificaciones_correo_idempotencia` (`clave_idempotencia`),
  KEY `idx_notificaciones_correo_trigger` (`trigger_id`,`aceptada_en_utc`,`id`),
  KEY `idx_notificaciones_correo_asignacion` (`asignacion_trigger_monitor_id`,`aceptada_en_utc`,`id`),
  KEY `idx_notificaciones_correo_monitor` (`monitor_id`,`aceptada_en_utc`,`id`),
  CONSTRAINT `fk_notificaciones_correo_asignacion` FOREIGN KEY (`asignacion_trigger_monitor_id`) REFERENCES `asignaciones_triggers_monitores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_notificaciones_correo_ejecucion` FOREIGN KEY (`ejecucion_trigger_id`) REFERENCES `ejecuciones_triggers` (`id`),
  CONSTRAINT `fk_notificaciones_correo_monitor` FOREIGN KEY (`monitor_id`) REFERENCES `monitores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_notificaciones_correo_trigger` FOREIGN KEY (`trigger_id`) REFERENCES `triggers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_notificaciones_correo_versiones` CHECK (`perfil_version` = 1 and `revision_declaracion` > 0 and `definicion_mensaje_version` = 1 and `renderizador_version` = 'correo@1'),
  CONSTRAINT `chk_notificaciones_correo_identidades` CHECK (`trigger_id_fotografia` > 0 and `asignacion_id_fotografia` > 0 and `monitor_id_fotografia` > 0),
  CONSTRAINT `chk_notificaciones_correo_uuidv7` CHECK (substr(hex(`alerta_auditoria_id`),13,1) = '7' and substr(hex(`alerta_auditoria_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_notificaciones_correo_transicion` CHECK (`evento_disparo` = 'apertura_alerta' and `estado_monitor` = 'indisponible' or `evento_disparo` = 'cierre_alerta' and `estado_monitor` = 'disponible'),
  CONSTRAINT `chk_notificaciones_correo_scope_trigger` CHECK (`scope_trigger_nivel` = 'portal' and `scope_trigger_tenant_id` is null and `scope_trigger_empresa_id` is null and `scope_trigger_sitio_id` is null or `scope_trigger_nivel` = 'tenant' and `scope_trigger_tenant_id` is not null and `scope_trigger_empresa_id` is null and `scope_trigger_sitio_id` is null or `scope_trigger_nivel` = 'empresa' and `scope_trigger_tenant_id` is not null and `scope_trigger_empresa_id` is not null and `scope_trigger_sitio_id` is null or `scope_trigger_nivel` = 'sitio' and `scope_trigger_tenant_id` is not null and `scope_trigger_empresa_id` is not null and `scope_trigger_sitio_id` is not null),
  CONSTRAINT `chk_notificaciones_correo_scope_monitor` CHECK (`scope_monitor_nivel` = 'portal' and `scope_monitor_tenant_id` is null and `scope_monitor_empresa_id` is null and `scope_monitor_sitio_id` is null or `scope_monitor_nivel` = 'tenant' and `scope_monitor_tenant_id` is not null and `scope_monitor_empresa_id` is null and `scope_monitor_sitio_id` is null or `scope_monitor_nivel` = 'empresa' and `scope_monitor_tenant_id` is not null and `scope_monitor_empresa_id` is not null and `scope_monitor_sitio_id` is null or `scope_monitor_nivel` = 'sitio' and `scope_monitor_tenant_id` is not null and `scope_monitor_empresa_id` is not null and `scope_monitor_sitio_id` is not null),
  CONSTRAINT `chk_notificaciones_correo_cronologia` CHECK (`fecha_ocurrencia_utc` >= `valido_desde_utc` and `renderizado_en_utc` >= `fecha_ocurrencia_utc` and `aceptada_en_utc` >= `renderizado_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notificaciones_usuarios` (
  `notificacion_id` binary(16) NOT NULL,
  `destinatario_usuario_id` bigint(20) unsigned NOT NULL,
  `tipo` enum('eliminacion_encolada','agente_eliminado','agente_eliminado_limpieza_pendiente','organizacion_eliminada','limpieza_tecnica_completada','eliminacion_fallida') NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL,
  `operacion_id` binary(16) NOT NULL,
  `emisor_tipo` enum('usuario','sistema','proceso') NOT NULL,
  `actor_real_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `actor_efectivo_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `estado_operacion` enum('encolada','ejecutando','completada','completada_con_advertencias','fallida') NOT NULL,
  `sujeto_tipo` enum('agente','tenant','empresa','sitio') NOT NULL,
  `sujeto_id` bigint(20) unsigned NOT NULL,
  `sujeto_guid` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `titulo_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `resumen_codigo` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_canonico` longtext NOT NULL,
  `huella_payload` binary(32) NOT NULL,
  `emitida_en_utc` datetime(3) NOT NULL,
  `leida` tinyint(1) NOT NULL DEFAULT 0,
  `leida_en_utc` datetime(3) DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `retener_hasta_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`notificacion_id`),
  UNIQUE KEY `uk_notificaciones_usuarios_operacion_tipo` (`destinatario_usuario_id`,`operacion_id`,`tipo`),
  KEY `idx_notificaciones_usuarios_buzon` (`destinatario_usuario_id`,`emitida_en_utc`,`notificacion_id`),
  KEY `idx_notificaciones_usuarios_no_leidas` (`destinatario_usuario_id`,`leida`,`emitida_en_utc`,`notificacion_id`),
  KEY `idx_notificaciones_usuarios_retencion` (`retener_hasta_utc`,`notificacion_id`),
  CONSTRAINT `fk_notificaciones_usuarios_destinatario` FOREIGN KEY (`destinatario_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_notificaciones_usuarios_uuidv7` CHECK (substr(hex(`notificacion_id`),13,1) = '7' and substr(hex(`notificacion_id`),17,1) in ('8','9','A','B') and substr(hex(`operacion_id`),13,1) = '7' and substr(hex(`operacion_id`),17,1) in ('8','9','A','B') and `notificacion_id` <> `operacion_id`),
  CONSTRAINT `chk_notificaciones_usuarios_emisor` CHECK (`emisor_tipo` = 'usuario' and `actor_real_usuario_id` is not null and `actor_efectivo_usuario_id` is not null and `actor_real_usuario_id` = `destinatario_usuario_id` or `emisor_tipo` in ('sistema','proceso') and `actor_real_usuario_id` is null and `actor_efectivo_usuario_id` is null),
  CONSTRAINT `chk_notificaciones_usuarios_lectura` CHECK (`leida` = 0 and `leida_en_utc` is null or `leida` = 1 and `leida_en_utc` is not null and `leida_en_utc` >= `emitida_en_utc`),
  CONSTRAINT `chk_notificaciones_usuarios_cronologia` CHECK (`actualizada_en_utc` >= `emitida_en_utc` and (`leida_en_utc` is null or `actualizada_en_utc` >= `leida_en_utc`) and `retener_hasta_utc` > `emitida_en_utc`),
  CONSTRAINT `chk_notificaciones_usuarios_contrato` CHECK (`version_contrato` = 1 and `sujeto_id` > 0 and json_valid(`payload_canonico`) and json_type(`payload_canonico`) = 'OBJECT' and json_length(`payload_canonico`) = 2 and json_contains_path(`payload_canonico`,'all','$.estadoOperacion','$.referenciaSujeto') and json_unquote(json_extract(`payload_canonico`,'$.estadoOperacion')) = `estado_operacion` and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto')) = 'OBJECT' and json_length(json_extract(`payload_canonico`,'$.referenciaSujeto')) = 3 and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.tipo')) = `sujeto_tipo` and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.id')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin and unhex(sha2(`payload_canonico`,256)) = `huella_payload` and (`sujeto_tipo` = 'agente' and `sujeto_guid` is not null and `sujeto_guid` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and json_contains_path(`payload_canonico`,'all','$.referenciaSujeto.tipo','$.referenciaSujeto.id','$.referenciaSujeto.guid') and convert(json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.guid')) using ascii) collate ascii_bin = `sujeto_guid` or `sujeto_tipo` in ('tenant','empresa','sitio') and `sujeto_guid` is null and json_contains_path(`payload_canonico`,'all','$.referenciaSujeto.tipo','$.referenciaSujeto.id','$.referenciaSujeto.fotografiaFinal') and (json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal')) = 'NULL' and `tipo` in ('eliminacion_encolada','eliminacion_fallida') or json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal')) = 'OBJECT' and `tipo` in ('organizacion_eliminada','limpieza_tecnica_completada') and json_length(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal')) = 7 and json_contains_path(`payload_canonico`,'all','$.referenciaSujeto.fotografiaFinal.perfil','$.referenciaSujeto.fotografiaFinal.version','$.referenciaSujeto.fotografiaFinal.tipo','$.referenciaSujeto.fotografiaFinal.id','$.referenciaSujeto.fotografiaFinal.nombre','$.referenciaSujeto.fotografiaFinal.scopeFinal','$.referenciaSujeto.fotografiaFinal.capturadaEnUtc') and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.perfil')) = 'sentinelia-eliminacion-organizacion-fotografia-final-v1' and cast(json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.version')) as unsigned) = 1 and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.version')) = 'INTEGER' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.tipo')) = `sujeto_tipo` and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.id')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.nombre')) = 'STRING' and char_length(json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.nombre'))) between 1 and 160 and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.capturadaEnUtc')) = 'STRING' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.capturadaEnUtc')) regexp '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal')) = 'OBJECT' and json_length(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal')) = 4 and json_contains_path(`payload_canonico`,'all','$.referenciaSujeto.fotografiaFinal.scopeFinal.nivel','$.referenciaSujeto.fotografiaFinal.scopeFinal.tenantId','$.referenciaSujeto.fotografiaFinal.scopeFinal.empresaId','$.referenciaSujeto.fotografiaFinal.scopeFinal.sitioId') and (`sujeto_tipo` = 'tenant' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.nivel')) = 'tenant' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.tenantId')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.empresaId')) = 'NULL' and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.sitioId')) = 'NULL' or `sujeto_tipo` = 'empresa' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.nivel')) = 'empresa' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.tenantId')) regexp '^[1-9][0-9]*$' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.empresaId')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin and json_type(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.sitioId')) = 'NULL' or `sujeto_tipo` = 'sitio' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.nivel')) = 'sitio' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.tenantId')) regexp '^[1-9][0-9]*$' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.empresaId')) regexp '^[1-9][0-9]*$' and json_unquote(json_extract(`payload_canonico`,'$.referenciaSujeto.fotografiaFinal.scopeFinal.sitioId')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin)))),
  CONSTRAINT `chk_notificaciones_usuarios_tipo` CHECK (`sujeto_tipo` = 'agente' and (`tipo` = 'eliminacion_encolada' and `emisor_tipo` = 'usuario' and `estado_operacion` = 'encolada' and `titulo_codigo` = 'eliminacion_agente_encolada_titulo' and `resumen_codigo` = 'eliminacion_agente_encolada_resumen' or `tipo` = 'agente_eliminado' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'completada' and `titulo_codigo` = 'agente_eliminado_titulo' and `resumen_codigo` = 'agente_eliminado_resumen' or `tipo` = 'agente_eliminado_limpieza_pendiente' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'completada_con_advertencias' and `titulo_codigo` = 'agente_eliminado_limpieza_pendiente_titulo' and `resumen_codigo` = 'agente_eliminado_limpieza_pendiente_resumen' or `tipo` = 'limpieza_tecnica_completada' and `emisor_tipo` = 'proceso' and `estado_operacion` in ('completada','completada_con_advertencias') and `titulo_codigo` = 'limpieza_tecnica_completada_titulo' and `resumen_codigo` = 'limpieza_tecnica_completada_resumen' or `tipo` = 'eliminacion_fallida' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'fallida' and `titulo_codigo` = 'eliminacion_agente_fallida_titulo' and `resumen_codigo` = 'eliminacion_agente_fallida_resumen') or `sujeto_tipo` in ('tenant','empresa','sitio') and (`tipo` = 'eliminacion_encolada' and `emisor_tipo` = 'usuario' and `estado_operacion` = 'encolada' and `titulo_codigo` = 'eliminacion_organizacion_encolada_titulo' and `resumen_codigo` = 'eliminacion_organizacion_encolada_resumen' or `tipo` = 'organizacion_eliminada' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'completada' and `titulo_codigo` = 'organizacion_eliminada_titulo' and `resumen_codigo` = 'organizacion_eliminada_resumen' or `tipo` = 'limpieza_tecnica_completada' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'completada' and `titulo_codigo` = 'limpieza_tecnica_completada_titulo' and `resumen_codigo` = 'limpieza_tecnica_completada_resumen' or `tipo` = 'eliminacion_fallida' and `emisor_tipo` = 'proceso' and `estado_operacion` = 'fallida' and `titulo_codigo` = 'eliminacion_organizacion_fallida_titulo' and `resumen_codigo` = 'eliminacion_organizacion_fallida_resumen'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_notificaciones_usuarios_proteger_update
BEFORE UPDATE ON notificaciones_usuarios
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.notificacion_id <=> NEW.notificacion_id
    AND OLD.destinatario_usuario_id <=> NEW.destinatario_usuario_id
    AND OLD.tipo <=> NEW.tipo
    AND OLD.version_contrato <=> NEW.version_contrato
    AND OLD.operacion_id <=> NEW.operacion_id
    AND OLD.emisor_tipo <=> NEW.emisor_tipo
    AND OLD.actor_real_usuario_id <=> NEW.actor_real_usuario_id
    AND OLD.actor_efectivo_usuario_id <=> NEW.actor_efectivo_usuario_id
    AND OLD.estado_operacion <=> NEW.estado_operacion
    AND OLD.sujeto_tipo <=> NEW.sujeto_tipo
    AND OLD.sujeto_id <=> NEW.sujeto_id
    AND OLD.sujeto_guid <=> NEW.sujeto_guid
    AND OLD.titulo_codigo <=> NEW.titulo_codigo
    AND OLD.resumen_codigo <=> NEW.resumen_codigo
    AND OLD.payload_canonico <=> NEW.payload_canonico
    AND OLD.huella_payload <=> NEW.huella_payload
    AND OLD.emitida_en_utc <=> NEW.emitida_en_utc
    AND OLD.retener_hasta_utc <=> NEW.retener_hasta_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El contenido de una notificación emitida es inmutable';
  END IF;

  IF NOT (
    (
      OLD.leida <=> NEW.leida
      AND OLD.leida_en_utc <=> NEW.leida_en_utc
      AND OLD.actualizada_en_utc <=> NEW.actualizada_en_utc
    )
    OR
    (
      OLD.leida = 0
      AND OLD.leida_en_utc IS NULL
      AND NEW.leida = 1
      AND NEW.leida_en_utc IS NOT NULL
      AND NEW.actualizada_en_utc = NEW.leida_en_utc
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La lectura de una notificación solo puede avanzar una vez';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `obligaciones_postcommit_operaciones_administrativas` (
  `obligacion_id` binary(16) NOT NULL,
  `operacion_id` binary(16) NOT NULL,
  `tipo` enum('retirar_sesion_redis','retirar_perfil_servidor_redis','retirar_agenda_servidor_redis','invalidar_catalogo_monitores','invalidar_sesiones_usuarios_redis','retirar_estructura_organizacion_redis','publicar_invalidacion_portal') NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL,
  `objetivo_tipo` enum('agente','usuario','tenant','empresa','sitio') NOT NULL,
  `objetivo_id` bigint(20) unsigned NOT NULL,
  `agente_id` bigint(20) unsigned DEFAULT NULL,
  `operacion_sesion_id` binary(16) DEFAULT NULL,
  `generacion_perfil` bigint(20) unsigned DEFAULT NULL,
  `destinatario_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `objetivo_canonico` longtext NOT NULL,
  `huella_objetivo` binary(32) NOT NULL,
  `estado` enum('pendiente','procesando','reintentable','bloqueo_permanente','completada') NOT NULL DEFAULT 'pendiente',
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `max_intentos` smallint(5) unsigned NOT NULL DEFAULT 20,
  `proximo_intento_utc` datetime(3) DEFAULT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  `retener_hasta_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`obligacion_id`),
  KEY `idx_obligaciones_postcommit_objetivo` (`operacion_id`,`tipo`,`huella_objetivo`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_operacion` (`operacion_id`,`estado`,`tipo`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_reclamacion` (`estado`,`proximo_intento_utc`,`creada_en_utc`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_lease` (`estado`,`lease_expira_utc`,`creada_en_utc`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_fencing` (`instancia_id`,`fencing_token`,`lease_expira_utc`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_retencion` (`retener_hasta_utc`,`obligacion_id`),
  KEY `idx_obligaciones_postcommit_identidad_objetivo` (`objetivo_tipo`,`objetivo_id`,`estado`,`obligacion_id`),
  CONSTRAINT `chk_obligaciones_postcommit_uuidv7` CHECK (substr(hex(`obligacion_id`),13,1) = '7' and substr(hex(`obligacion_id`),17,1) in ('8','9','A','B') and substr(hex(`operacion_id`),13,1) = '7' and substr(hex(`operacion_id`),17,1) in ('8','9','A','B') and `obligacion_id` <> `operacion_id` and (`operacion_sesion_id` is null or substr(hex(`operacion_sesion_id`),13,1) = '7' and substr(hex(`operacion_sesion_id`),17,1) in ('8','9','A','B') and `operacion_sesion_id` <> `obligacion_id` and `operacion_sesion_id` <> `operacion_id`)),
  CONSTRAINT `chk_obligaciones_postcommit_contrato` CHECK (`version_contrato` = 1 and json_valid(`objetivo_canonico`) and json_type(`objetivo_canonico`) = 'OBJECT' and unhex(sha2(`objetivo_canonico`,256)) = `huella_objetivo`),
  CONSTRAINT `chk_obligaciones_postcommit_contadores` CHECK (`max_intentos` between 1 and 100 and `intentos` <= `max_intentos` and `fencing_token` >= `intentos`),
  CONSTRAINT `chk_obligaciones_postcommit_diagnostico` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` regexp '^[a-z][a-z0-9_]{0,63}$' and octet_length(`ultimo_mensaje_error`) between 1 and 512),
  CONSTRAINT `chk_obligaciones_postcommit_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc` and (`terminada_en_utc` is null or `terminada_en_utc` >= `creada_en_utc`) and `retener_hasta_utc` > `creada_en_utc`),
  CONSTRAINT `chk_obligaciones_postcommit_estado` CHECK (`estado` = 'pendiente' and `intentos` = 0 and `fencing_token` = 0 and `proximo_intento_utc` >= `creada_en_utc` and `actualizada_en_utc` = `creada_en_utc` and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is null and `ultimo_mensaje_error` is null and `terminada_en_utc` is null or `estado` = 'procesando' and `intentos` between 1 and `max_intentos` and `proximo_intento_utc` is null and octet_length(`instancia_id`) between 1 and 128 and `lease_token` is not null and `lease_expira_utc` > `actualizada_en_utc` and `ultimo_codigo_error` is null and `ultimo_mensaje_error` is null and `terminada_en_utc` is null or `estado` = 'reintentable' and `intentos` < `max_intentos` and `fencing_token` > 0 and `proximo_intento_utc` > `actualizada_en_utc` and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null and `terminada_en_utc` is null or `estado` = 'bloqueo_permanente' and `intentos` between 1 and `max_intentos` and `proximo_intento_utc` is null and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null and `terminada_en_utc` is not null and `terminada_en_utc` = `actualizada_en_utc` or `estado` = 'completada' and `intentos` between 1 and `max_intentos` and `proximo_intento_utc` is null and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is null and `ultimo_mensaje_error` is null and `terminada_en_utc` is not null and `terminada_en_utc` = `actualizada_en_utc`),
  CONSTRAINT `chk_obligaciones_postcommit_objetivo` CHECK (`objetivo_id` > 0 and (`tipo` = 'retirar_sesion_redis' and `objetivo_tipo` = 'agente' and `objetivo_id` = `agente_id` and `agente_id` > 0 and `operacion_sesion_id` is not null and `generacion_perfil` is null and `destinatario_usuario_id` is null and json_length(`objetivo_canonico`) = 2 and json_contains_path(`objetivo_canonico`,'all','$.agenteId','$.operacionSesionId') and json_unquote(json_extract(`objetivo_canonico`,'$.agenteId')) = cast(`agente_id` as char charset utf8mb4) collate utf8mb4_bin and replace(json_unquote(json_extract(`objetivo_canonico`,'$.operacionSesionId')),'-','') = lcase(hex(`operacion_sesion_id`)) or `tipo` in ('retirar_perfil_servidor_redis','retirar_agenda_servidor_redis') and `objetivo_tipo` = 'agente' and `objetivo_id` = `agente_id` and `agente_id` > 0 and `operacion_sesion_id` is null and `generacion_perfil` > 0 and `destinatario_usuario_id` is null and json_length(`objetivo_canonico`) = 2 and json_contains_path(`objetivo_canonico`,'all','$.agenteId','$.generacionPerfil') and json_unquote(json_extract(`objetivo_canonico`,'$.agenteId')) = cast(`agente_id` as char charset utf8mb4) collate utf8mb4_bin and json_unquote(json_extract(`objetivo_canonico`,'$.generacionPerfil')) = cast(`generacion_perfil` as char charset utf8mb4) collate utf8mb4_bin or `tipo` = 'invalidar_catalogo_monitores' and `objetivo_tipo` = 'agente' and `objetivo_id` = `agente_id` and `agente_id` > 0 and `operacion_sesion_id` is null and `generacion_perfil` is null and `destinatario_usuario_id` is null and json_length(`objetivo_canonico`) = 1 and json_contains_path(`objetivo_canonico`,'all','$.agenteId') and json_unquote(json_extract(`objetivo_canonico`,'$.agenteId')) = cast(`agente_id` as char charset utf8mb4) collate utf8mb4_bin or `tipo` = 'publicar_invalidacion_portal' and `objetivo_tipo` = 'usuario' and `objetivo_id` = `destinatario_usuario_id` and `agente_id` is null and `operacion_sesion_id` is null and `generacion_perfil` is null and `destinatario_usuario_id` > 0 and json_length(`objetivo_canonico`) = 1 and json_contains_path(`objetivo_canonico`,'all','$.destinatarioUsuarioId') and json_unquote(json_extract(`objetivo_canonico`,'$.destinatarioUsuarioId')) = cast(`destinatario_usuario_id` as char charset utf8mb4) collate utf8mb4_bin or `tipo` in ('invalidar_catalogo_monitores','invalidar_sesiones_usuarios_redis','retirar_estructura_organizacion_redis') and `objetivo_tipo` in ('tenant','empresa','sitio') and `agente_id` is null and `operacion_sesion_id` is null and `generacion_perfil` is null and `destinatario_usuario_id` is null and json_length(`objetivo_canonico`) = 2 and json_contains_path(`objetivo_canonico`,'all','$.id','$.tipo') and json_unquote(json_extract(`objetivo_canonico`,'$.tipo')) = `objetivo_tipo` and json_unquote(json_extract(`objetivo_canonico`,'$.id')) = cast(`objetivo_id` as char charset utf8mb4) collate utf8mb4_bin))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_obligaciones_postcommit_operaciones_proteger_update
BEFORE UPDATE ON obligaciones_postcommit_operaciones_administrativas
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.obligacion_id <=> NEW.obligacion_id
    AND OLD.operacion_id <=> NEW.operacion_id
    AND OLD.tipo <=> NEW.tipo
    AND OLD.version_contrato <=> NEW.version_contrato
    AND OLD.objetivo_tipo <=> NEW.objetivo_tipo
    AND OLD.objetivo_id <=> NEW.objetivo_id
    AND OLD.agente_id <=> NEW.agente_id
    AND OLD.operacion_sesion_id <=> NEW.operacion_sesion_id
    AND OLD.generacion_perfil <=> NEW.generacion_perfil
    AND OLD.destinatario_usuario_id <=> NEW.destinatario_usuario_id
    AND OLD.objetivo_canonico <=> NEW.objetivo_canonico
    AND OLD.huella_objetivo <=> NEW.huella_objetivo
    AND OLD.max_intentos <=> NEW.max_intentos
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
    AND OLD.retener_hasta_utc <=> NEW.retener_hasta_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y el objetivo postcommit son inmutables';
  END IF;

  IF NOT (
    (
      OLD.estado <=> NEW.estado
      AND OLD.intentos <=> NEW.intentos
      AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
      AND OLD.instancia_id <=> NEW.instancia_id
      AND OLD.lease_token <=> NEW.lease_token
      AND OLD.lease_expira_utc <=> NEW.lease_expira_utc
      AND OLD.fencing_token <=> NEW.fencing_token
      AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
      AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
      AND OLD.actualizada_en_utc <=> NEW.actualizada_en_utc
      AND OLD.terminada_en_utc <=> NEW.terminada_en_utc
    )
    OR
    (
      OLD.estado IN ('pendiente', 'reintentable')
      AND NEW.estado = 'procesando'
      AND OLD.proximo_intento_utc <= NEW.actualizada_en_utc
      AND NEW.intentos = OLD.intentos + 1
      AND NEW.fencing_token = OLD.fencing_token + 1
      AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
    )
    OR
    (
      OLD.estado = 'procesando'
      AND NEW.estado = 'procesando'
      AND OLD.lease_expira_utc <= NEW.actualizada_en_utc
      AND NOT (NEW.lease_token <=> OLD.lease_token)
      AND NEW.intentos = OLD.intentos + 1
      AND NEW.fencing_token = OLD.fencing_token + 1
      AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
    )
    OR
    (
      OLD.estado = 'procesando'
      AND NEW.estado = 'procesando'
      AND NEW.intentos = OLD.intentos
      AND NEW.fencing_token = OLD.fencing_token
      AND NEW.instancia_id = OLD.instancia_id
      AND NEW.lease_token = OLD.lease_token
      AND OLD.lease_expira_utc > NEW.actualizada_en_utc
      AND NEW.lease_expira_utc >= OLD.lease_expira_utc
      AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
    )
    OR
    (
      OLD.estado = 'procesando'
      AND NEW.estado IN ('reintentable', 'bloqueo_permanente', 'completada')
      AND OLD.lease_expira_utc > NEW.actualizada_en_utc
      AND NEW.intentos = OLD.intentos
      AND NEW.fencing_token = OLD.fencing_token
      AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
    )
    OR
    (
      OLD.estado = 'bloqueo_permanente'
      AND NEW.estado = 'reintentable'
      AND NEW.intentos = 0
      AND NEW.fencing_token = OLD.fencing_token
      AND NEW.actualizada_en_utc >= OLD.actualizada_en_utc
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición de la obligación postcommit no está permitida';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `obligaciones_retirada_refederacion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `contribucion_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_terminal_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_terminal_canonica` longtext NOT NULL CHECK (json_valid(`ocurrencia_terminal_canonica`)),
  `ocurrencia_terminal_sha256` binary(32) NOT NULL,
  `procedencia_base_canonica` longtext NOT NULL CHECK (json_valid(`procedencia_base_canonica`)),
  `procedencia_base_sha256` binary(32) NOT NULL,
  `recibida_origen_en_utc` datetime(3) NOT NULL,
  `flujo_destino_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operacion` enum('retirada','salidaProyeccion') NOT NULL,
  `estado` enum('pendiente','encolada','absorbida') NOT NULL DEFAULT 'pendiente',
  `generacion_destino_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `posicion_flujo` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `encolada_en_utc` datetime(3) DEFAULT NULL,
  `absorbida_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_obligacion_retirada_refederacion` (`inbox_terminal_id`,`flujo_destino_id`,`contribucion_origen_id`),
  KEY `idx_obligacion_retirada_refederacion_pendiente` (`estado`,`creada_en_utc`,`id`),
  KEY `fk_obligacion_retirada_refederacion_proyeccion` (`proyeccion_origen_id`),
  KEY `fk_obligacion_retirada_refederacion_contribucion` (`contribucion_origen_id`),
  KEY `fk_obligacion_retirada_refederacion_posicion` (`flujo_destino_id`,`generacion_destino_id`,`posicion_flujo`),
  CONSTRAINT `fk_obligacion_retirada_refederacion_contribucion` FOREIGN KEY (`contribucion_origen_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_obligacion_retirada_refederacion_flujo` FOREIGN KEY (`flujo_destino_id`) REFERENCES `flujos_federacion` (`flujo_id`),
  CONSTRAINT `fk_obligacion_retirada_refederacion_posicion` FOREIGN KEY (`flujo_destino_id`, `generacion_destino_id`, `posicion_flujo`) REFERENCES `posiciones_ocurrencias_flujos_federacion` (`flujo_id`, `generacion_id`, `posicion_flujo`),
  CONSTRAINT `fk_obligacion_retirada_refederacion_proyeccion` FOREIGN KEY (`proyeccion_origen_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_obligacion_retirada_refederacion_testimonio` CHECK (json_valid(`ocurrencia_terminal_canonica`) and json_valid(`procedencia_base_canonica`)),
  CONSTRAINT `chk_obligacion_retirada_refederacion_estado` CHECK (`estado` = 'pendiente' and `generacion_destino_id` is null and `posicion_flujo` is null and `encolada_en_utc` is null and `absorbida_en_utc` is null or `estado` = 'encolada' and `generacion_destino_id` is not null and `posicion_flujo` is not null and `encolada_en_utc` is not null and `absorbida_en_utc` is null or `estado` = 'absorbida' and `generacion_destino_id` is not null and `posicion_flujo` is null and `encolada_en_utc` is null and `absorbida_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_obligaciones_retirada_refederacion_monotonas
BEFORE UPDATE ON obligaciones_retirada_refederacion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id
    AND NEW.proyeccion_origen_id=OLD.proyeccion_origen_id
    AND NEW.contribucion_origen_id=OLD.contribucion_origen_id
    AND NEW.inbox_terminal_id=OLD.inbox_terminal_id
    AND NEW.ocurrencia_terminal_canonica=OLD.ocurrencia_terminal_canonica
    AND NEW.ocurrencia_terminal_sha256=OLD.ocurrencia_terminal_sha256
    AND NEW.procedencia_base_canonica=OLD.procedencia_base_canonica
    AND NEW.procedencia_base_sha256=OLD.procedencia_base_sha256
    AND NEW.recibida_origen_en_utc=OLD.recibida_origen_en_utc
    AND NEW.flujo_destino_id=OLD.flujo_destino_id
    AND NEW.operacion=OLD.operacion
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND OLD.estado='pendiente'
    AND OLD.generacion_destino_id IS NULL AND NEW.generacion_destino_id IS NOT NULL
    AND OLD.posicion_flujo IS NULL AND OLD.encolada_en_utc IS NULL
    AND OLD.absorbida_en_utc IS NULL
    AND (
      (NEW.estado='encolada' AND NEW.posicion_flujo IS NOT NULL
        AND NEW.encolada_en_utc IS NOT NULL AND NEW.absorbida_en_utc IS NULL)
      OR
      (NEW.estado='absorbida' AND NEW.posicion_flujo IS NULL
        AND NEW.encolada_en_utc IS NULL AND NEW.absorbida_en_utc IS NOT NULL)
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La obligacion de retirada solo puede resolverse una vez.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `observaciones_telemetria_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned DEFAULT NULL,
  `periodo_vida_pol_id` bigint(20) unsigned DEFAULT NULL,
  `sesion_id_diagnostico` varchar(80) DEFAULT NULL,
  `sesion_huella_sha256` char(64) DEFAULT NULL,
  `sesion_auditoria_id` binary(16) DEFAULT NULL,
  `categoria` varchar(64) NOT NULL,
  `clave` varchar(128) NOT NULL,
  `tag` varchar(128) NOT NULL DEFAULT '',
  `codigo_senal` varchar(384) NOT NULL,
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `valor_numero` double DEFAULT NULL,
  `valor_booleano` tinyint(1) DEFAULT NULL,
  `valor_texto` varchar(2048) DEFAULT NULL,
  `valor_estado` varchar(128) DEFAULT NULL,
  `valor_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`valor_json`)),
  `valor_duracion` double DEFAULT NULL,
  `valor_momento_utc` datetime DEFAULT NULL,
  `calidad` varchar(32) NOT NULL DEFAULT 'valida',
  `severidad_declarada` varchar(32) NOT NULL DEFAULT 'info',
  `origen` varchar(32) NOT NULL DEFAULT 'directa',
  `vigente_hasta_utc` datetime DEFAULT NULL,
  `detalle_humano` varchar(512) DEFAULT NULL,
  `metadatos_contextuales` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadatos_contextuales`)),
  `emitido_en_utc` datetime DEFAULT NULL,
  `observado_en_utc` datetime NOT NULL,
  `recibido_en_utc` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_observaciones_telemetria_id_objetivo` (`id`,`agente_id`,`senal_id`),
  KEY `idx_observaciones_telemetria_agente_observado` (`agente_id`,`observado_en_utc`,`id`),
  KEY `idx_observaciones_telemetria_senal_observado` (`senal_id`,`observado_en_utc`,`id`),
  KEY `idx_observaciones_telemetria_identidad_observado` (`agente_id`,`categoria`,`clave`,`tag`,`observado_en_utc`,`id`),
  KEY `idx_observaciones_telemetria_recibido` (`recibido_en_utc`,`id`),
  KEY `idx_observaciones_telemetria_periodo` (`periodo_vida_pol_id`,`observado_en_utc`,`id`),
  KEY `idx_observaciones_telemetria_sesion_auditoria` (`sesion_auditoria_id`,`observado_en_utc`,`id`),
  CONSTRAINT `fk_observaciones_telemetria_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_observaciones_telemetria_periodo_pol` FOREIGN KEY (`periodo_vida_pol_id`) REFERENCES `periodos_vida_pol_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_observaciones_telemetria_senal` FOREIGN KEY (`senal_id`) REFERENCES `senales_telemetria_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_observaciones_telemetria_booleano` CHECK (`valor_booleano` is null or `valor_booleano` in (0,1)),
  CONSTRAINT `chk_observaciones_telemetria_valor_json_tamano` CHECK (`valor_json` is null or char_length(cast(`valor_json` as char charset utf8mb4)) <= 2048),
  CONSTRAINT `chk_observaciones_telemetria_metadatos_tamano` CHECK (`metadatos_contextuales` is null or char_length(cast(`metadatos_contextuales` as char charset utf8mb4)) <= 2048),
  CONSTRAINT `chk_observaciones_telemetria_identidad_sesion` CHECK (`sesion_auditoria_id` is null or `sesion_id_diagnostico` is null and `sesion_huella_sha256` is null),
  CONSTRAINT `chk_observaciones_telemetria_valor_por_tipo` CHECK (`tipo_dato` = 'numero' and `valor_numero` is not null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'booleano' and `valor_numero` is null and `valor_booleano` is not null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'texto' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is not null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'estado' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is not null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'json' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is not null and `valor_duracion` is null and `valor_momento_utc` is null or `tipo_dato` = 'duracion' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is not null and `valor_duracion` >= 0 and `valor_momento_utc` is null or `tipo_dato` = 'momento_utc' and `valor_numero` is null and `valor_booleano` is null and `valor_texto` is null and `valor_estado` is null and `valor_json` is null and `valor_duracion` is null and `valor_momento_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_observaciones_impedir_alta_legacy_5_21
BEFORE INSERT ON observaciones_telemetria_agentes
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.sesion_id_diagnostico IS NOT NULL
    OR NEW.sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una observacion nueva 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_observaciones_proteger_identidad_sesion_5_21
BEFORE UPDATE ON observaciones_telemetria_agentes
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.sesion_auditoria_id <=> NEW.sesion_auditoria_id
    AND OLD.sesion_id_diagnostico <=> NEW.sesion_id_diagnostico
    AND OLD.sesion_huella_sha256 <=> NEW.sesion_huella_sha256
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de sesion de una observacion es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocurrencias_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `version_familia` smallint(5) unsigned NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `operacion` enum('actualizacion','retirada','salidaProyeccion') NOT NULL,
  `tiempo_origen_utc` datetime(3) NOT NULL,
  `payload_canonico` mediumtext NOT NULL,
  `payload_sha256` binary(32) NOT NULL,
  `registrada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ocurrencias_federacion_identidad` (`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  UNIQUE KEY `uk_ocurrencias_federacion_secuencia` (`installation_origen_id`,`familia`,`elemento_origen_id`,`secuencia_elemento`),
  KEY `idx_ocurrencias_federacion_origen` (`installation_origen_id`,`familia`,`tiempo_origen_utc`,`ocurrencia_origen_id`),
  CONSTRAINT `fk_ocurrencias_federacion_reserva` FOREIGN KEY (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`) REFERENCES `reservas_identidad_ocurrencias_federacion` (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`),
  CONSTRAINT `chk_ocurrencias_federacion_identidades` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$' and `ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_ocurrencias_federacion_contenido` CHECK (`version_familia` >= 1 and `secuencia_elemento` >= 1 and octet_length(`payload_canonico`) between 2 and 2097152 and json_valid(`payload_canonico`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_ocurrencias_federacion_inmutables
BEFORE UPDATE ON ocurrencias_federacion
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Las ocurrencias federadas son inmutables.' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operaciones_administrativas` (
  `operacion_id` binary(16) NOT NULL,
  `clave_operacion` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `evento_aceptacion_id` binary(16) NOT NULL,
  `tipo` enum('eliminar_agente','eliminar_organizacion') NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL,
  `sujeto_tipo` enum('agente','tenant','empresa','sitio') NOT NULL,
  `sujeto_id` bigint(20) unsigned NOT NULL,
  `sujeto_guid` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_real_usuario_id` bigint(20) unsigned NOT NULL,
  `actor_efectivo_usuario_id` bigint(20) unsigned NOT NULL,
  `destinatario_usuario_id` bigint(20) unsigned NOT NULL,
  `comando_canonico` longtext NOT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `estado` enum('encolada','ejecutando','completada','completada_con_advertencias','fallida') NOT NULL DEFAULT 'encolada',
  `fase` enum('preparacion','validacion','eliminacion','commit','limpieza') NOT NULL DEFAULT 'preparacion',
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `max_intentos` smallint(5) unsigned NOT NULL DEFAULT 3,
  `disponible_desde_utc` datetime(3) NOT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `resultado_canonico` longtext DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`operacion_id`),
  UNIQUE KEY `uk_operaciones_administrativas_clave` (`clave_operacion`),
  UNIQUE KEY `uk_operaciones_administrativas_evento` (`evento_aceptacion_id`),
  KEY `idx_operaciones_administrativas_sujeto` (`sujeto_tipo`,`sujeto_id`,`estado`,`creada_en_utc`,`operacion_id`),
  KEY `idx_operaciones_administrativas_reclamacion` (`estado`,`disponible_desde_utc`,`creada_en_utc`,`operacion_id`),
  KEY `idx_operaciones_administrativas_lease` (`estado`,`lease_expira_utc`,`creada_en_utc`,`operacion_id`),
  KEY `idx_operaciones_administrativas_fencing` (`instancia_id`,`fencing_token`,`lease_expira_utc`,`operacion_id`),
  CONSTRAINT `chk_operaciones_administrativas_uuidv7` CHECK (substr(hex(`operacion_id`),13,1) = '7' and substr(hex(`operacion_id`),17,1) in ('8','9','A','B') and substr(hex(`clave_operacion`),13,1) = '7' and substr(hex(`clave_operacion`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_aceptacion_id`),13,1) = '7' and substr(hex(`evento_aceptacion_id`),17,1) in ('8','9','A','B') and `operacion_id` <> `clave_operacion` and `operacion_id` <> `correlacion_id` and `operacion_id` <> `evento_aceptacion_id` and `clave_operacion` <> `correlacion_id` and `clave_operacion` <> `evento_aceptacion_id` and `correlacion_id` <> `evento_aceptacion_id`),
  CONSTRAINT `chk_operaciones_administrativas_contadores` CHECK (`max_intentos` between 1 and 100 and `intentos` <= `max_intentos` and `fencing_token` >= `intentos`),
  CONSTRAINT `chk_operaciones_administrativas_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc` and `disponible_desde_utc` >= `creada_en_utc` and (`terminada_en_utc` is null or `terminada_en_utc` >= `creada_en_utc`)),
  CONSTRAINT `chk_operaciones_administrativas_diagnostico` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` regexp '^[a-z][a-z0-9_]{0,63}$' and octet_length(`ultimo_mensaje_error`) between 1 and 512),
  CONSTRAINT `chk_operaciones_administrativas_estado` CHECK (`estado` = 'encolada' and `fase` = 'preparacion' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `resultado_canonico` is null and `terminada_en_utc` is null or `estado` = 'ejecutando' and `fase` in ('preparacion','validacion','eliminacion','commit') and `instancia_id` is not null and octet_length(`instancia_id`) between 1 and 128 and `lease_token` is not null and `lease_expira_utc` is not null and `ultimo_codigo_error` is null and `ultimo_mensaje_error` is null and `resultado_canonico` is null and `terminada_en_utc` is null or `estado` in ('completada','completada_con_advertencias') and `fase` = 'limpieza' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is null and `ultimo_mensaje_error` is null and `resultado_canonico` is not null and json_valid(`resultado_canonico`) and json_contains_path(`resultado_canonico`,'all','$.estado') and json_unquote(json_extract(`resultado_canonico`,'$.estado')) = `estado` and `terminada_en_utc` is not null or `estado` = 'fallida' and `fase` in ('preparacion','validacion','eliminacion','commit') and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null and `resultado_canonico` is not null and json_valid(`resultado_canonico`) and json_contains_path(`resultado_canonico`,'all','$.estado','$.error.codigo') and json_unquote(json_extract(`resultado_canonico`,'$.estado')) = `estado` and convert(json_unquote(json_extract(`resultado_canonico`,'$.error.codigo')) using ascii) = `ultimo_codigo_error` and `terminada_en_utc` is not null),
  CONSTRAINT `chk_operaciones_administrativas_contrato` CHECK (`version_contrato` = 1 and `sujeto_id` > 0 and `actor_real_usuario_id` > 0 and `actor_efectivo_usuario_id` > 0 and `destinatario_usuario_id` = `actor_real_usuario_id` and json_valid(`comando_canonico`) and json_contains_path(`comando_canonico`,'all','$.tipoOperacion','$.version','$.estado','$.fase','$.cancelable','$.progreso','$.identidades.operacionId','$.identidades.claveOperacion','$.identidades.correlacionId','$.identidades.eventoId','$.sujeto.tipo','$.sujeto.id','$.sujeto.scope','$.fotografiaAutorizacion.actorReal.usuarioId','$.fotografiaAutorizacion.actorEfectivo.usuarioId','$.fotografiaAutorizacion.destinatarioUsuarioId') and json_unquote(json_extract(`comando_canonico`,'$.tipoOperacion')) = `tipo` and cast(json_unquote(json_extract(`comando_canonico`,'$.version')) as unsigned) = `version_contrato` and json_unquote(json_extract(`comando_canonico`,'$.estado')) = 'encolada' and json_unquote(json_extract(`comando_canonico`,'$.fase')) = 'preparacion' and json_unquote(json_extract(`comando_canonico`,'$.cancelable')) = 'false' and json_unquote(json_extract(`comando_canonico`,'$.progreso')) = 'fases_semanticas' and replace(json_unquote(json_extract(`comando_canonico`,'$.identidades.operacionId')),'-','') = lcase(hex(`operacion_id`)) and replace(json_unquote(json_extract(`comando_canonico`,'$.identidades.claveOperacion')),'-','') = lcase(hex(`clave_operacion`)) and replace(json_unquote(json_extract(`comando_canonico`,'$.identidades.correlacionId')),'-','') = lcase(hex(`correlacion_id`)) and replace(json_unquote(json_extract(`comando_canonico`,'$.identidades.eventoId')),'-','') = lcase(hex(`evento_aceptacion_id`)) and json_unquote(json_extract(`comando_canonico`,'$.sujeto.tipo')) = `sujeto_tipo` and json_unquote(json_extract(`comando_canonico`,'$.sujeto.id')) = cast(`sujeto_id` as char charset utf8mb4) collate utf8mb4_bin and json_unquote(json_extract(`comando_canonico`,'$.fotografiaAutorizacion.actorReal.usuarioId')) = cast(`actor_real_usuario_id` as char charset utf8mb4) collate utf8mb4_bin and json_unquote(json_extract(`comando_canonico`,'$.fotografiaAutorizacion.actorEfectivo.usuarioId')) = cast(`actor_efectivo_usuario_id` as char charset utf8mb4) collate utf8mb4_bin and json_unquote(json_extract(`comando_canonico`,'$.fotografiaAutorizacion.destinatarioUsuarioId')) = cast(`destinatario_usuario_id` as char charset utf8mb4) collate utf8mb4_bin and unhex(sha2(`comando_canonico`,256)) = `huella_intencion` and (`tipo` = 'eliminar_agente' and `sujeto_tipo` = 'agente' and `sujeto_guid` is not null and `sujeto_guid` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and json_contains_path(`comando_canonico`,'all','$.sujeto.guid') and convert(json_unquote(json_extract(`comando_canonico`,'$.sujeto.guid')) using ascii) collate ascii_bin = `sujeto_guid` or `tipo` = 'eliminar_organizacion' and `sujeto_tipo` in ('tenant','empresa','sitio') and `sujeto_guid` is null and json_contains_path(`comando_canonico`,'one','$.sujeto.guid') = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operaciones_credencial_federacion` (
  `solicitud_id` binary(16) NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo` enum('rotacion','recuperacion') NOT NULL,
  `version_credencial` int(10) unsigned NOT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_remoto_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `efectiva_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`solicitud_id`),
  UNIQUE KEY `uk_operaciones_credencial_evento` (`evento_auditoria_id`),
  KEY `idx_operaciones_credencial_relacion` (`relacion_id`,`efectiva_en_utc`,`solicitud_id`),
  CONSTRAINT `fk_operaciones_credencial_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_operaciones_credencial_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_remota_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_remoto_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_operaciones_credencial_uuidv7` CHECK (substr(hex(`solicitud_id`),13,1) = '7' and substr(hex(`solicitud_id`),17,1) in ('8','9','A','B') and substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_operaciones_credencial_version` CHECK (`version_credencial` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operaciones_publicacion_dns` (
  `generacion_dns` bigint(20) unsigned NOT NULL,
  `causa` enum('mutacion_catalogo','reconciliacion_inicial','reintento_reconciliacion','divergencia_proyeccion_recuperacion','reactivacion_manual','reintento_ddns') NOT NULL,
  `generacion_predecesora` bigint(20) unsigned DEFAULT NULL,
  `generacion_predecesora_fallida` bigint(20) unsigned DEFAULT NULL,
  `generacion_raiz_recuperacion` bigint(20) unsigned NOT NULL,
  `raiz_sucesion_automatica` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('pendiente','efecto_iniciado','recarga_confirmada','consolidada','sin_cambios','superada','superada_tras_recuperacion','recuperacion_pendiente','recuperacion_bloqueada','fallida') NOT NULL DEFAULT 'pendiente',
  `efecto_posible` tinyint(1) NOT NULL DEFAULT 0,
  `generacion_leida` bigint(20) unsigned DEFAULT NULL,
  `perfil_proyeccion` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `hash_proyeccion` binary(32) DEFAULT NULL,
  `generacion_observada` bigint(20) unsigned DEFAULT NULL,
  `generacion_convergente` bigint(20) unsigned DEFAULT NULL,
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `proximo_intento_utc` datetime(3) DEFAULT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `resultado_zonas` bigint(20) unsigned DEFAULT NULL,
  `resultado_artefactos` bigint(20) unsigned DEFAULT NULL,
  `resultado_cambios` bigint(20) unsigned DEFAULT NULL,
  `obligacion_outbox_id` bigint(20) unsigned DEFAULT NULL,
  `evento_resultado_id` binary(16) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `efecto_iniciado_en_utc` datetime(3) DEFAULT NULL,
  `recarga_confirmada_en_utc` datetime(3) DEFAULT NULL,
  `resumen_recarga_zonas` bigint(20) unsigned DEFAULT NULL,
  `resumen_recarga_artefactos` bigint(20) unsigned DEFAULT NULL,
  `resumen_recarga_cambios` bigint(20) unsigned DEFAULT NULL,
  `manifiesto_diagnostico` longtext DEFAULT NULL CHECK (json_valid(`manifiesto_diagnostico`)),
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  `fotografia_zonas` longtext DEFAULT NULL CHECK (json_valid(`fotografia_zonas`)),
  PRIMARY KEY (`generacion_dns`),
  UNIQUE KEY `uk_operaciones_dns_predecesora_fallida` (`generacion_predecesora_fallida`),
  UNIQUE KEY `uk_operaciones_dns_raiz_sucesion_automatica` (`raiz_sucesion_automatica`),
  UNIQUE KEY `uk_operaciones_dns_obligacion_outbox` (`obligacion_outbox_id`),
  UNIQUE KEY `uk_operaciones_dns_evento_resultado` (`evento_resultado_id`),
  KEY `idx_operaciones_dns_elegibles` (`estado`,`proximo_intento_utc`,`lease_expira_utc`,`generacion_dns`),
  KEY `idx_operaciones_dns_generacion_ascendente` (`generacion_raiz_recuperacion`,`generacion_dns`),
  KEY `idx_operaciones_dns_terminales` (`estado`,`terminada_en_utc`,`generacion_dns`),
  CONSTRAINT `chk_operaciones_dns_lease` CHECK (`instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null or `instancia_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null and `fencing_token` > 0 and `estado` in ('pendiente','efecto_iniciado','recarga_confirmada','recuperacion_pendiente')),
  CONSTRAINT `chk_operaciones_dns_diagnostico` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null),
  CONSTRAINT `chk_operaciones_dns_proyeccion` CHECK (`efecto_posible` = 0 and `generacion_leida` is null and `perfil_proyeccion` is null and `hash_proyeccion` is null and `efecto_iniciado_en_utc` is null and `estado` in ('pendiente','sin_cambios','superada','fallida') or `efecto_posible` = 1 and `generacion_leida` = `generacion_dns` and `perfil_proyeccion` is not null and octet_length(`perfil_proyeccion`) between 1 and 64 and `hash_proyeccion` is not null and `efecto_iniciado_en_utc` is not null and `estado` in ('efecto_iniciado','recarga_confirmada','consolidada','superada_tras_recuperacion','recuperacion_pendiente','recuperacion_bloqueada')),
  CONSTRAINT `chk_operaciones_dns_recarga` CHECK (`estado` in ('recarga_confirmada','consolidada') and `generacion_observada` = `generacion_dns` and `recarga_confirmada_en_utc` is not null or `estado` not in ('recarga_confirmada','consolidada') and `generacion_observada` is null and `recarga_confirmada_en_utc` is null),
  CONSTRAINT `chk_operaciones_dns_convergencia` CHECK (`estado` = 'superada_tras_recuperacion' and `generacion_convergente` is not null and `generacion_convergente` > `generacion_dns` or `estado` <> 'superada_tras_recuperacion' and `generacion_convergente` is null),
  CONSTRAINT `chk_operaciones_dns_resultado` CHECK (`estado` in ('consolidada','fallida') and `obligacion_outbox_id` is not null and `resultado_zonas` is not null and `resultado_artefactos` is not null and `resultado_cambios` is not null and (`estado` <> 'fallida' or `ultimo_codigo_error` is not null) or `estado` not in ('consolidada','fallida') and `obligacion_outbox_id` is null and `evento_resultado_id` is null and `resultado_zonas` is null and `resultado_artefactos` is null and `resultado_cambios` is null),
  CONSTRAINT `chk_operaciones_dns_terminalidad` CHECK (`estado` in ('consolidada','sin_cambios','superada','superada_tras_recuperacion','fallida') and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `proximo_intento_utc` is null and `terminada_en_utc` is not null or `estado` in ('pendiente','efecto_iniciado','recarga_confirmada','recuperacion_pendiente') and `proximo_intento_utc` is not null and `terminada_en_utc` is null or `estado` = 'recuperacion_bloqueada' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `proximo_intento_utc` is null and `ultimo_codigo_error` is not null and `terminada_en_utc` is null),
  CONSTRAINT `chk_operaciones_dns_resumen_recarga` CHECK (`resumen_recarga_zonas` is null and `resumen_recarga_artefactos` is null and `resumen_recarga_cambios` is null or `recarga_confirmada_en_utc` is not null and `resumen_recarga_zonas` is not null and `resumen_recarga_artefactos` is not null and `resumen_recarga_cambios` is not null),
  CONSTRAINT `chk_operaciones_dns_manifiesto_diagnostico` CHECK (`manifiesto_diagnostico` is null or `recarga_confirmada_en_utc` is not null and json_valid(`manifiesto_diagnostico`)),
  CONSTRAINT `chk_operaciones_dns_causalidad` CHECK (`generacion_dns` > 0 and `generacion_raiz_recuperacion` > 0 and `generacion_raiz_recuperacion` <= `generacion_dns` and (`generacion_predecesora` is null or `generacion_predecesora` < `generacion_dns`) and (`generacion_predecesora_fallida` is null or `generacion_predecesora_fallida` = `generacion_predecesora`) and (`raiz_sucesion_automatica` is null or `raiz_sucesion_automatica` = `generacion_raiz_recuperacion`) and (`causa` in ('mutacion_catalogo','reconciliacion_inicial') and `generacion_predecesora` is null and `generacion_predecesora_fallida` is null and `generacion_raiz_recuperacion` = `generacion_dns` and `raiz_sucesion_automatica` is null or `causa` = 'reintento_reconciliacion' and `generacion_predecesora` is not null and `generacion_predecesora_fallida` = `generacion_predecesora` and `raiz_sucesion_automatica` is null or `causa` = 'divergencia_proyeccion_recuperacion' and `generacion_predecesora` is not null and `generacion_predecesora_fallida` is null and `generacion_raiz_recuperacion` < `generacion_dns` and `raiz_sucesion_automatica` = `generacion_raiz_recuperacion` or `causa` = 'reactivacion_manual' and `generacion_predecesora` is not null and `generacion_predecesora_fallida` is null and `generacion_raiz_recuperacion` = `generacion_dns` and `raiz_sucesion_automatica` is null or `causa` = 'reintento_ddns' and `generacion_predecesora` is not null and `generacion_predecesora_fallida` is null and `generacion_raiz_recuperacion` < `generacion_dns` and `raiz_sucesion_automatica` is null)),
  CONSTRAINT `chk_operaciones_dns_fotografia_zonas` CHECK (`fotografia_zonas` is null or `efecto_posible` = 1 and json_valid(`fotografia_zonas`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_operaciones_dns_validar_insert
BEFORE INSERT ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cabecera_generacion_dns
    WHERE id=1 AND ultima_generacion_dns=NEW.generacion_dns
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La operación DNS exige la generación global vigente';
  END IF;

  IF NEW.generacion_predecesora IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM operaciones_publicacion_dns
    WHERE generacion_dns=NEW.generacion_predecesora
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La predecesora de una operación DNS debe existir';
  END IF;

  IF NEW.causa='reintento_reconciliacion' AND NOT EXISTS (
    SELECT 1 FROM operaciones_publicacion_dns
    WHERE generacion_dns=NEW.generacion_predecesora AND estado='fallida'
      AND generacion_raiz_recuperacion=NEW.generacion_raiz_recuperacion
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='El reintento DNS exige una predecesora fallida de la misma raíz';
  END IF;

  IF NEW.causa='divergencia_proyeccion_recuperacion' AND NOT EXISTS (
    SELECT 1 FROM operaciones_publicacion_dns
    WHERE generacion_dns=NEW.generacion_predecesora AND efecto_posible=TRUE
      AND generacion_raiz_recuperacion=NEW.generacion_raiz_recuperacion
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='La sucesión automática DNS exige efecto posible en su raíz';
  END IF;

  IF NEW.causa='reintento_ddns' AND NOT EXISTS (
    SELECT 1 FROM operaciones_publicacion_dns
    WHERE generacion_dns=NEW.generacion_predecesora
      AND estado='superada_tras_recuperacion'
      AND generacion_convergente=NEW.generacion_dns
      AND generacion_raiz_recuperacion=NEW.generacion_raiz_recuperacion
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='El reintento DDNS exige una predecesora atribuida de la misma raíz';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_operaciones_dns_proteger_update
BEFORE UPDATE ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.generacion_dns <=> NEW.generacion_dns
    AND OLD.causa <=> NEW.causa
    AND OLD.generacion_predecesora <=> NEW.generacion_predecesora
    AND OLD.generacion_predecesora_fallida <=> NEW.generacion_predecesora_fallida
    AND OLD.generacion_raiz_recuperacion <=> NEW.generacion_raiz_recuperacion
    AND OLD.raiz_sucesion_automatica <=> NEW.raiz_sucesion_automatica
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La intención durable de publicación DNS es inmutable';
  END IF;

  IF NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN (
      'pendiente', 'efecto_iniciado', 'sin_cambios', 'superada', 'fallida'
    ))
    OR (OLD.estado = 'efecto_iniciado' AND NEW.estado IN (
      'efecto_iniciado', 'recarga_confirmada', 'recuperacion_pendiente',
      'recuperacion_bloqueada', 'superada_tras_recuperacion'
    ))
    OR (OLD.estado = 'recarga_confirmada' AND NEW.estado IN (
      'recarga_confirmada', 'consolidada'
    ))
    OR (OLD.estado = 'recuperacion_pendiente' AND NEW.estado IN (
      'recuperacion_pendiente', 'recarga_confirmada',
      'recuperacion_bloqueada', 'superada_tras_recuperacion'
    ))
    OR (OLD.estado = 'recuperacion_bloqueada' AND NEW.estado IN (
      'recuperacion_bloqueada', 'superada_tras_recuperacion'
    ))
    OR (OLD.estado = 'consolidada' AND NEW.estado = 'consolidada')
    OR (OLD.estado = 'sin_cambios' AND NEW.estado = 'sin_cambios')
    OR (OLD.estado = 'superada' AND NEW.estado = 'superada')
    OR (OLD.estado = 'superada_tras_recuperacion'
      AND NEW.estado = 'superada_tras_recuperacion')
    OR (OLD.estado = 'fallida' AND NEW.estado = 'fallida')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición durable de publicación DNS no está permitida';
  END IF;

  IF OLD.efecto_posible = TRUE AND NEW.efecto_posible = FALSE THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'efectoPosible de publicación DNS no puede retroceder';
  END IF;

  IF NOT (
    OLD.generacion_leida <=> NEW.generacion_leida
    AND OLD.perfil_proyeccion <=> NEW.perfil_proyeccion
    AND OLD.hash_proyeccion <=> NEW.hash_proyeccion
    AND OLD.efecto_iniciado_en_utc <=> NEW.efecto_iniciado_en_utc
  ) AND NOT (
    OLD.estado = 'pendiente'
    AND NEW.estado = 'efecto_iniciado'
    AND OLD.efecto_posible = FALSE
    AND NEW.efecto_posible = TRUE
    AND OLD.generacion_leida IS NULL
    AND OLD.perfil_proyeccion IS NULL
    AND OLD.hash_proyeccion IS NULL
    AND OLD.efecto_iniciado_en_utc IS NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La proyección DNS solo puede fijarse al iniciar el efecto';
  END IF;

  IF OLD.generacion_leida IS NOT NULL AND NOT (
    OLD.generacion_leida <=> NEW.generacion_leida
    AND OLD.perfil_proyeccion <=> NEW.perfil_proyeccion
    AND OLD.hash_proyeccion <=> NEW.hash_proyeccion
    AND OLD.efecto_iniciado_en_utc <=> NEW.efecto_iniciado_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fotografía de proyección DNS iniciada es inmutable';
  END IF;

  IF OLD.generacion_observada IS NOT NULL AND NOT (
    OLD.generacion_observada <=> NEW.generacion_observada
    AND OLD.recarga_confirmada_en_utc <=> NEW.recarga_confirmada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La recarga DNS observada es inmutable';
  END IF;

  IF OLD.generacion_convergente IS NOT NULL
    AND NOT (OLD.generacion_convergente <=> NEW.generacion_convergente) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La generación convergente DNS es inmutable';
  END IF;

  IF OLD.obligacion_outbox_id IS NOT NULL AND NOT (
    OLD.obligacion_outbox_id <=> NEW.obligacion_outbox_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La obligación outbox de publicación DNS es inmutable';
  END IF;

  IF OLD.evento_resultado_id IS NOT NULL AND NOT (
    OLD.evento_resultado_id <=> NEW.evento_resultado_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El resultado auditable de publicación DNS es inmutable';
  END IF;

  IF NEW.intentos < OLD.intentos OR NEW.fencing_token < OLD.fencing_token THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los contadores de publicación DNS no pueden retroceder';
  END IF;

  IF OLD.estado IN (
    'consolidada', 'sin_cambios', 'superada',
    'superada_tras_recuperacion', 'fallida'
  ) AND NOT (
    OLD.estado <=> NEW.estado
    AND OLD.efecto_posible <=> NEW.efecto_posible
    AND OLD.generacion_leida <=> NEW.generacion_leida
    AND OLD.perfil_proyeccion <=> NEW.perfil_proyeccion
    AND OLD.hash_proyeccion <=> NEW.hash_proyeccion
    AND OLD.generacion_observada <=> NEW.generacion_observada
    AND OLD.generacion_convergente <=> NEW.generacion_convergente
    AND OLD.intentos <=> NEW.intentos
    AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
    AND OLD.instancia_id <=> NEW.instancia_id
    AND OLD.lease_token <=> NEW.lease_token
    AND OLD.lease_expira_utc <=> NEW.lease_expira_utc
    AND OLD.fencing_token <=> NEW.fencing_token
    AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
    AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
    AND OLD.resultado_zonas <=> NEW.resultado_zonas
    AND OLD.resultado_artefactos <=> NEW.resultado_artefactos
    AND OLD.resultado_cambios <=> NEW.resultado_cambios
    AND OLD.obligacion_outbox_id <=> NEW.obligacion_outbox_id
    AND (
      OLD.evento_resultado_id <=> NEW.evento_resultado_id
      OR (OLD.evento_resultado_id IS NULL AND NEW.evento_resultado_id IS NOT NULL)
    )
    AND OLD.efecto_iniciado_en_utc <=> NEW.efecto_iniciado_en_utc
    AND OLD.recarga_confirmada_en_utc <=> NEW.recarga_confirmada_en_utc
    AND OLD.terminada_en_utc <=> NEW.terminada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una operación DNS terminal solo admite incorporar su evento';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_operaciones_dns_resumen_recarga_inmutable
BEFORE UPDATE ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.resumen_recarga_zonas <=> NEW.resumen_recarga_zonas
    AND OLD.resumen_recarga_artefactos <=> NEW.resumen_recarga_artefactos
    AND OLD.resumen_recarga_cambios <=> NEW.resumen_recarga_cambios
  ) AND NOT (
    OLD.estado IN ('efecto_iniciado', 'recuperacion_pendiente')
    AND NEW.estado = 'recarga_confirmada'
    AND OLD.resumen_recarga_zonas IS NULL
    AND OLD.resumen_recarga_artefactos IS NULL
    AND OLD.resumen_recarga_cambios IS NULL
    AND NEW.resumen_recarga_zonas IS NOT NULL
    AND NEW.resumen_recarga_artefactos IS NOT NULL
    AND NEW.resumen_recarga_cambios IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El resumen observado de la recarga DNS es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_operaciones_dns_manifiesto_diagnostico_inmutable
BEFORE UPDATE ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF NOT (OLD.manifiesto_diagnostico <=> NEW.manifiesto_diagnostico)
    AND NOT (
      OLD.estado IN ('efecto_iniciado', 'recuperacion_pendiente')
      AND NEW.estado = 'recarga_confirmada'
      AND OLD.manifiesto_diagnostico IS NULL
      AND NEW.manifiesto_diagnostico IS NOT NULL
    ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El manifiesto diagnostico DNS es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_operaciones_dns_fotografia_zonas_inmutable
BEFORE UPDATE ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF NOT (OLD.fotografia_zonas <=> NEW.fotografia_zonas)
    AND NOT (
      OLD.estado = 'pendiente' AND NEW.estado = 'efecto_iniciado'
      AND OLD.fotografia_zonas IS NULL AND NEW.fotografia_zonas IS NOT NULL
    ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fotografia de zonas DNS es inmutable';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_operaciones_dns_proteger_delete
BEFORE DELETE ON operaciones_publicacion_dns
FOR EACH ROW
BEGIN
  IF OLD.estado NOT IN (
    'consolidada', 'sin_cambios', 'superada',
    'superada_tras_recuperacion', 'fallida'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una operación DNS no terminal no puede eliminarse';
  END IF;

  IF OLD.estado IN ('consolidada', 'fallida')
    AND OLD.evento_resultado_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El resultado DNS debe incorporarse antes de limpiar la operación';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operaciones_sesion_agentes` (
  `operacion_id` binary(16) NOT NULL,
  `tipo` enum('login','refresh','invalidacion') NOT NULL,
  `agente_id` bigint(20) unsigned NOT NULL,
  `sesion_auditoria_id` binary(16) NOT NULL,
  `login_request_id` binary(16) DEFAULT NULL,
  `refresh_request_id` binary(16) DEFAULT NULL,
  `causa_operacion_id` binary(16) DEFAULT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `version_scope_observada` bigint(20) unsigned NOT NULL,
  `version_autorizacion_observada` bigint(20) unsigned NOT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL,
  `actor_tipo` enum('usuario','agente','sistema') NOT NULL,
  `actor_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_efectivo_tipo` enum('usuario','agente','sistema') DEFAULT NULL,
  `actor_efectivo_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `modo_actuacion` enum('directo','impersonado') NOT NULL DEFAULT 'directo',
  `origen` enum('web','api_agentes','runtime','bootstrap','tarea_sistema') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `estado` enum('pendiente','redis_preparada','respuesta_pendiente','consolidada','reemplazada','fallida') NOT NULL DEFAULT 'pendiente',
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `proximo_intento_utc` datetime(3) NOT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `replay_cifrado_disponible` tinyint(1) NOT NULL DEFAULT 0,
  `key_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`operacion_id`),
  UNIQUE KEY `uk_operaciones_sesion_invalidacion` (`tipo`,`causa_operacion_id`,`agente_id`,`sesion_auditoria_id`),
  KEY `idx_operaciones_sesion_agente_estado` (`agente_id`,`estado`,`proximo_intento_utc`,`operacion_id`),
  KEY `idx_operaciones_sesion_lease` (`estado`,`proximo_intento_utc`,`lease_expira_utc`,`operacion_id`),
  KEY `idx_operaciones_sesion_sesion` (`sesion_auditoria_id`,`estado`,`operacion_id`),
  KEY `idx_operaciones_sesion_agente_operacion` (`agente_id`,`operacion_id`),
  CONSTRAINT `chk_operaciones_sesion_identidad_tipo` CHECK (`tipo` = 'login' and `login_request_id` is not null and `refresh_request_id` is null and `causa_operacion_id` is null or `tipo` = 'refresh' and `login_request_id` is null and `refresh_request_id` is not null and `causa_operacion_id` is null or `tipo` = 'invalidacion' and `login_request_id` is null and `refresh_request_id` is null and `causa_operacion_id` is not null),
  CONSTRAINT `chk_operaciones_sesion_contadores` CHECK (`version_scope_observada` > 0 and `version_autorizacion_observada` > 0 and `fencing_token` > 0),
  CONSTRAINT `chk_operaciones_sesion_scope` CHECK (`scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_tenant_id` is not null and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_operaciones_sesion_lease` CHECK (`instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null or `instancia_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null),
  CONSTRAINT `chk_operaciones_sesion_replay` CHECK (`replay_cifrado_disponible` = 0 and `key_id` is null or `replay_cifrado_disponible` = 1 and `key_id` is not null and `tipo` in ('login','refresh') and `estado` = 'respuesta_pendiente'),
  CONSTRAINT `chk_operaciones_sesion_terminalidad` CHECK (`estado` in ('consolidada','reemplazada','fallida') and `terminada_en_utc` is not null or `estado` in ('pendiente','redis_preparada','respuesta_pendiente') and `terminada_en_utc` is null),
  CONSTRAINT `chk_operaciones_sesion_estado_tipo` CHECK (`estado` <> 'respuesta_pendiente' or `tipo` in ('login','refresh')),
  CONSTRAINT `chk_operaciones_sesion_actor_efectivo` CHECK (`modo_actuacion` = 'directo' and `actor_efectivo_tipo` is null and `actor_efectivo_id` is null or `modo_actuacion` = 'impersonado' and `actor_efectivo_tipo` is not null and `actor_efectivo_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_operaciones_sesion_agentes_proteger_update
BEFORE UPDATE ON operaciones_sesion_agentes
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.operacion_id <=> NEW.operacion_id
    AND OLD.tipo <=> NEW.tipo
    AND OLD.agente_id <=> NEW.agente_id
    AND OLD.sesion_auditoria_id <=> NEW.sesion_auditoria_id
    AND OLD.login_request_id <=> NEW.login_request_id
    AND OLD.refresh_request_id <=> NEW.refresh_request_id
    AND OLD.causa_operacion_id <=> NEW.causa_operacion_id
    AND OLD.huella_intencion <=> NEW.huella_intencion
    AND OLD.version_scope_observada <=> NEW.version_scope_observada
    AND OLD.version_autorizacion_observada <=> NEW.version_autorizacion_observada
    AND OLD.fencing_token <=> NEW.fencing_token
    AND OLD.actor_tipo <=> NEW.actor_tipo
    AND OLD.actor_id <=> NEW.actor_id
    AND OLD.actor_efectivo_tipo <=> NEW.actor_efectivo_tipo
    AND OLD.actor_efectivo_id <=> NEW.actor_efectivo_id
    AND OLD.modo_actuacion <=> NEW.modo_actuacion
    AND OLD.origen <=> NEW.origen
    AND OLD.scope_tenant_id <=> NEW.scope_tenant_id
    AND OLD.scope_empresa_id <=> NEW.scope_empresa_id
    AND OLD.scope_sitio_id <=> NEW.scope_sitio_id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La intención durable de sesión del agente es inmutable';
  END IF;

  IF NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN ('pendiente', 'redis_preparada', 'fallida', 'reemplazada'))
    OR (OLD.estado = 'redis_preparada' AND NEW.estado IN ('redis_preparada', 'respuesta_pendiente', 'consolidada', 'reemplazada'))
    OR (OLD.estado = 'respuesta_pendiente' AND NEW.estado IN ('respuesta_pendiente', 'consolidada', 'reemplazada'))
    OR (OLD.estado = 'consolidada' AND NEW.estado = 'consolidada')
    OR (OLD.estado = 'reemplazada' AND NEW.estado = 'reemplazada')
    OR (OLD.estado = 'fallida' AND NEW.estado = 'fallida')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición durable de sesión del agente no está permitida';
  END IF;

  IF OLD.estado IN ('consolidada', 'reemplazada', 'fallida') AND NOT (
    OLD.intentos <=> NEW.intentos
    AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
    AND OLD.instancia_id <=> NEW.instancia_id
    AND OLD.lease_token <=> NEW.lease_token
    AND OLD.lease_expira_utc <=> NEW.lease_expira_utc
    AND OLD.replay_cifrado_disponible <=> NEW.replay_cifrado_disponible
    AND OLD.key_id <=> NEW.key_id
    AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
    AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
    AND OLD.actualizada_en_utc <=> NEW.actualizada_en_utc
    AND OLD.terminada_en_utc <=> NEW.terminada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una operación durable de sesión terminal no puede modificarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_operaciones_sesion_agentes_proteger_delete
BEFORE DELETE ON operaciones_sesion_agentes
FOR EACH ROW
BEGIN
  IF OLD.estado NOT IN ('consolidada', 'reemplazada', 'fallida') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una operación durable de sesión no terminal no puede eliminarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `operaciones_sesion_federacion` (
  `operacion_id` binary(16) NOT NULL,
  `request_id` binary(16) NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo` enum('login','refresh','revocacion') NOT NULL,
  `estado` enum('reservada','consolidada','fallida','reemplazada') NOT NULL,
  `sesion_id` binary(16) DEFAULT NULL,
  `installation_local_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_remoto_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL,
  `version_revocacion` bigint(20) unsigned NOT NULL,
  `huella_intencion` binary(32) NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `consolidada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`operacion_id`),
  UNIQUE KEY `uk_operaciones_sesion_federacion_request` (`request_id`),
  UNIQUE KEY `uk_operaciones_sesion_federacion_fencing` (`relacion_id`,`fencing_token`),
  KEY `idx_operaciones_sesion_federacion_estado` (`estado`,`creada_en_utc`,`operacion_id`),
  CONSTRAINT `fk_operaciones_sesion_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_operaciones_sesion_federacion_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_local_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_remota_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and (`boot_remoto_id` is null or `boot_remoto_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_operaciones_sesion_federacion_uuidv7` CHECK (substr(hex(`operacion_id`),13,1) = '7' and substr(hex(`operacion_id`),17,1) in ('8','9','A','B') and substr(hex(`request_id`),13,1) = '7' and substr(hex(`request_id`),17,1) in ('8','9','A','B') and (`sesion_id` is null or substr(hex(`sesion_id`),13,1) = '7' and substr(hex(`sesion_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_operaciones_sesion_federacion_forma` CHECK (`fencing_token` >= 1 and `version_revocacion` >= 1 and (`tipo` in ('login','refresh') and `sesion_id` is not null and `boot_remoto_id` is not null or `tipo` = 'revocacion' and `sesion_id` is null and `boot_remoto_id` is null) and (`estado` = 'reservada' and `consolidada_en_utc` is null or `estado` <> 'reservada' and `consolidada_en_utc` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `outbox_auditoria_runtime` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cabecera_id` bigint(20) unsigned NOT NULL,
  `clave_cadena` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `orden_obligacion` bigint(20) unsigned NOT NULL,
  `evento_id` binary(16) NOT NULL,
  `tipo_evento` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_contrato` smallint(5) unsigned NOT NULL,
  `flujo` enum('sistema','usuarios','organizacion','agentes','monitores','alertas','automatizacion','dns','federacion') NOT NULL,
  `actor_real_tipo` enum('runtime','sistema') NOT NULL,
  `actor_real_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_efectivo_tipo` enum('usuario') DEFAULT NULL,
  `actor_efectivo_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `modo_actuacion` enum('directo','impersonado') NOT NULL,
  `sujeto_tipo` enum('usuario','sesion_usuario','agente','sesion_agente','regla_telemetria','monitor','alerta','trigger','destinatario_trigger_correo','binding_trigger','zona_dns','registro_dns','tenant','empresa','sitio','configuracion_portal','cadena_auditoria','incidente_integridad','instalacion_federada','relacion_federada','revision_concesion_federada','flujo_federado','lote_federado','proyeccion_federada','aviso_plataforma','frontera_internet','concesion_ddns','intencion_ddns') NOT NULL,
  `sujeto_id` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `origen` enum('runtime','bootstrap','tarea_sistema') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `correlacion_id` binary(16) NOT NULL,
  `causalidad_tipo` enum('evento_auditoria','evento_monitor','ejecucion_trigger','operacion_sesion_agente','generacion_dns','relacion_federacion','ocurrencia_federacion','entrega_federacion','aviso_plataforma','solicitud_recuperacion_password','intencion_ddns') DEFAULT NULL,
  `causalidad_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `productor` enum('runtime_alertas','runtime_automatizacion','runtime_dns','runtime_federacion') NOT NULL,
  `clave_operacion` varbinary(128) NOT NULL,
  `rol_evento` enum('principal','salida','entrada','resultado') NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `version_canonicalizador` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_encadenado` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload` longtext NOT NULL CHECK (json_valid(`payload`)),
  `huella_intencion` binary(32) NOT NULL,
  `estado` enum('pendiente','procesando','reintentable','bloqueo_permanente','completada') NOT NULL,
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `max_intentos` smallint(5) unsigned NOT NULL,
  `proximo_intento_utc` datetime(3) NOT NULL,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `evento_incorporado_id` binary(16) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `completada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_outbox_auditoria_cadena_orden` (`cabecera_id`,`orden_obligacion`),
  UNIQUE KEY `uk_outbox_auditoria_evento` (`evento_id`),
  UNIQUE KEY `uk_outbox_auditoria_idempotencia` (`productor`,`clave_operacion`,`rol_evento`),
  KEY `idx_outbox_auditoria_fifo` (`clave_cadena`,`estado`,`orden_obligacion`),
  KEY `idx_outbox_auditoria_orden` (`clave_cadena`,`orden_obligacion`,`estado`),
  KEY `idx_outbox_auditoria_elegibles` (`estado`,`proximo_intento_utc`,`clave_cadena`,`orden_obligacion`),
  KEY `idx_outbox_auditoria_lease` (`estado`,`lease_expira_utc`,`id`),
  KEY `idx_outbox_auditoria_completadas` (`estado`,`completada_en_utc`,`id`),
  KEY `fk_outbox_auditoria_cabecera` (`cabecera_id`,`clave_cadena`),
  CONSTRAINT `fk_outbox_auditoria_cabecera` FOREIGN KEY (`cabecera_id`, `clave_cadena`) REFERENCES `cabeceras_outbox_auditoria_runtime` (`id`, `clave_cadena`),
  CONSTRAINT `chk_outbox_auditoria_scope` CHECK (`scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':portal') or `scope_tenant_id` is not null and (`scope_empresa_id` is not null or `scope_sitio_id` is null) and convert(`clave_cadena` using utf8mb4) = concat(`flujo`,':tenant:',`scope_tenant_id`)),
  CONSTRAINT `chk_outbox_auditoria_actor` CHECK (`modo_actuacion` = 'directo' and `actor_efectivo_tipo` is null and `actor_efectivo_id` is null),
  CONSTRAINT `chk_outbox_auditoria_causalidad` CHECK (`causalidad_tipo` is null and `causalidad_id` is null or `causalidad_tipo` is not null and `causalidad_id` is not null),
  CONSTRAINT `chk_outbox_auditoria_clave` CHECK (octet_length(`clave_operacion`) between 1 and 128),
  CONSTRAINT `chk_outbox_auditoria_intentos` CHECK (`max_intentos` between 1 and 100 and `intentos` <= `max_intentos` and `fencing_token` >= `intentos`),
  CONSTRAINT `chk_outbox_auditoria_estado` CHECK (`estado` in ('pendiente','reintentable') and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `evento_incorporado_id` is null and `completada_en_utc` is null or `estado` = 'procesando' and `instancia_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null and `evento_incorporado_id` is null and `completada_en_utc` is null or `estado` = 'bloqueo_permanente' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null and `evento_incorporado_id` is null and `completada_en_utc` is null or `estado` = 'completada' and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `evento_incorporado_id` = `evento_id` and `completada_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_outbox_auditoria_impedir_mutar_contenido
BEFORE UPDATE ON outbox_auditoria_runtime
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.cabecera_id <=> NEW.cabecera_id
    AND OLD.clave_cadena <=> NEW.clave_cadena
    AND OLD.orden_obligacion <=> NEW.orden_obligacion
    AND OLD.evento_id <=> NEW.evento_id
    AND OLD.tipo_evento <=> NEW.tipo_evento
    AND OLD.version_contrato <=> NEW.version_contrato
    AND OLD.flujo <=> NEW.flujo
    AND OLD.actor_real_tipo <=> NEW.actor_real_tipo
    AND OLD.actor_real_id <=> NEW.actor_real_id
    AND OLD.actor_efectivo_tipo <=> NEW.actor_efectivo_tipo
    AND OLD.actor_efectivo_id <=> NEW.actor_efectivo_id
    AND OLD.modo_actuacion <=> NEW.modo_actuacion
    AND OLD.sujeto_tipo <=> NEW.sujeto_tipo
    AND OLD.sujeto_id <=> NEW.sujeto_id
    AND OLD.origen <=> NEW.origen
    AND OLD.scope_tenant_id <=> NEW.scope_tenant_id
    AND OLD.scope_empresa_id <=> NEW.scope_empresa_id
    AND OLD.scope_sitio_id <=> NEW.scope_sitio_id
    AND OLD.correlacion_id <=> NEW.correlacion_id
    AND OLD.causalidad_tipo <=> NEW.causalidad_tipo
    AND OLD.causalidad_id <=> NEW.causalidad_id
    AND OLD.productor <=> NEW.productor
    AND OLD.clave_operacion <=> NEW.clave_operacion
    AND OLD.rol_evento <=> NEW.rol_evento
    AND OLD.efectivo_en_utc <=> NEW.efectivo_en_utc
    AND OLD.version_canonicalizador <=> NEW.version_canonicalizador
    AND OLD.version_encadenado <=> NEW.version_encadenado
    AND OLD.payload <=> NEW.payload
    AND OLD.huella_intencion <=> NEW.huella_intencion
    AND OLD.max_intentos <=> NEW.max_intentos
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El contenido causal de la obligación outbox es inmutable';
  END IF;

  IF NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN ('pendiente', 'procesando'))
    OR (OLD.estado = 'procesando' AND NEW.estado IN (
      'procesando', 'reintentable', 'bloqueo_permanente', 'completada'
    ))
    OR (OLD.estado = 'reintentable' AND NEW.estado IN ('reintentable', 'procesando'))
    OR (OLD.estado = 'bloqueo_permanente' AND NEW.estado IN (
      'bloqueo_permanente', 'reintentable'
    ))
    OR (OLD.estado = 'completada' AND NEW.estado = 'completada')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición de estado outbox no está permitida';
  END IF;

  IF NEW.fencing_token < OLD.fencing_token THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El fencing de outbox no puede retroceder';
  END IF;

  IF NEW.intentos < OLD.intentos
    AND NOT (
      OLD.estado = 'bloqueo_permanente'
      AND NEW.estado = 'reintentable'
      AND NEW.intentos = 0
    ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los intentos outbox solo se reinician al rehabilitar';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_outbox_auditoria_impedir_borrar_no_terminal
BEFORE DELETE ON outbox_auditoria_runtime
FOR EACH ROW
BEGIN
  IF OLD.estado <> 'completada' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una obligación outbox no terminal no puede eliminarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `outbox_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `prioridad` enum('operativaActual','reconstruccion') NOT NULL DEFAULT 'reconstruccion',
  `estado` enum('pendiente','procesando','reintentable','confirmada','bloqueada','canceladaGeneracion') NOT NULL DEFAULT 'pendiente',
  `intentos` int(10) unsigned NOT NULL DEFAULT 0,
  `ultimo_resultado` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_error_terminal` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_error_temporal` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_error_transporte` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `disponible_desde_utc` datetime(3) NOT NULL,
  `capturada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_outbox_federacion_posicion` (`flujo_id`,`generacion_id`,`posicion_flujo`),
  UNIQUE KEY `uk_outbox_federacion_entrega` (`entrega_id`),
  KEY `idx_outbox_federacion_prefijo` (`flujo_id`,`generacion_id`,`estado`,`posicion_flujo`),
  KEY `idx_outbox_federacion_reclamacion` (`estado`,`disponible_desde_utc`,`prioridad`,`flujo_id`,`generacion_id`,`posicion_flujo`),
  CONSTRAINT `fk_outbox_federacion_posicion` FOREIGN KEY (`flujo_id`, `generacion_id`, `posicion_flujo`) REFERENCES `posiciones_ocurrencias_flujos_federacion` (`flujo_id`, `generacion_id`, `posicion_flujo`),
  CONSTRAINT `chk_outbox_federacion_contadores` CHECK (`intentos` >= 0),
  CONSTRAINT `chk_outbox_federacion_cronologia` CHECK (`disponible_desde_utc` >= `capturada_en_utc` and `actualizada_en_utc` >= `capturada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_outbox_federacion_identidad_inmutable
BEFORE UPDATE ON outbox_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id = OLD.id
    AND NEW.flujo_id = OLD.flujo_id
    AND NEW.generacion_id = OLD.generacion_id
    AND NEW.posicion_flujo = OLD.posicion_flujo
    AND NEW.prioridad = OLD.prioridad
    AND NEW.capturada_en_utc = OLD.capturada_en_utc
    AND (OLD.entrega_id IS NULL OR NEW.entrega_id = OLD.entrega_id)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de una entrega emisora es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `overlays_usuarios_avisos_plataforma` (
  `usuario_id` bigint(20) unsigned NOT NULL,
  `aviso_id` binary(16) NOT NULL,
  `estado` enum('reconocido','oculto') NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  PRIMARY KEY (`usuario_id`,`aviso_id`),
  UNIQUE KEY `uk_overlays_avisos_evento` (`evento_auditoria_id`),
  KEY `idx_overlays_avisos_actualizacion` (`actualizado_en_utc`,`usuario_id`),
  KEY `fk_overlays_avisos_aviso` (`aviso_id`),
  CONSTRAINT `fk_overlays_avisos_aviso` FOREIGN KEY (`aviso_id`) REFERENCES `avisos_plataforma` (`aviso_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_overlays_avisos_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_overlays_avisos_evento_uuidv7` CHECK (substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `perfiles_servidor_agentes` (
  `agente_id` bigint(20) unsigned NOT NULL,
  `generacion` bigint(20) unsigned NOT NULL,
  `estado` varchar(40) NOT NULL DEFAULT 'pendiente_primera_evidencia',
  `histeresis_sin_pol_segundos` int(10) unsigned NOT NULL,
  `duracion_reinicio_reciente_segundos` int(10) unsigned NOT NULL,
  `generada_en_utc` datetime(3) NOT NULL,
  `armada_en_utc` datetime(3) DEFAULT NULL,
  `cerrada_en_utc` datetime(3) DEFAULT NULL,
  `codigo_cierre` varchar(80) DEFAULT NULL,
  `detalle_cierre` varchar(512) DEFAULT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `fecha_creacion` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`agente_id`,`generacion`),
  KEY `idx_perfiles_servidor_estado` (`estado`,`generada_en_utc`,`agente_id`,`generacion`),
  CONSTRAINT `fk_perfiles_servidor_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_perfiles_servidor_generacion` CHECK (`generacion` > 0),
  CONSTRAINT `chk_perfiles_servidor_histeresis` CHECK (`histeresis_sin_pol_segundos` > 0),
  CONSTRAINT `chk_perfiles_servidor_reinicio` CHECK (`duracion_reinicio_reciente_segundos` > 0),
  CONSTRAINT `chk_perfiles_servidor_estado` CHECK (`estado` in ('pendiente_primera_evidencia','activo','retirado','desactivado_incompatible')),
  CONSTRAINT `chk_perfiles_servidor_cierre` CHECK (`estado` in ('retirado','desactivado_incompatible') and `cerrada_en_utc` is not null and `codigo_cierre` is not null or `estado` in ('pendiente_primera_evidencia','activo') and `cerrada_en_utc` is null and `codigo_cierre` is null and `detalle_cierre` is null),
  CONSTRAINT `chk_perfiles_servidor_armado` CHECK (`estado` = 'pendiente_primera_evidencia' and `armada_en_utc` is null or `estado` = 'activo' and `armada_en_utc` is not null or `estado` in ('retirado','desactivado_incompatible'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `periodos_vida_pol_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `sesion_id_diagnostico` varchar(80) DEFAULT NULL,
  `sesion_huella_sha256` char(64) DEFAULT NULL,
  `sesion_auditoria_id` binary(16) DEFAULT NULL,
  `boot_id` varchar(120) DEFAULT NULL,
  `inicio_utc` datetime NOT NULL,
  `fin_utc` datetime DEFAULT NULL,
  `heartbeats_recibidos` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_heartbeat_utc` datetime DEFAULT NULL,
  `ultimo_seq` bigint(20) unsigned DEFAULT NULL,
  `motivo_cierre` varchar(64) DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_periodos_vida_pol_agente_inicio` (`agente_id`,`inicio_utc`,`id`),
  KEY `idx_periodos_vida_pol_agente_abierto` (`agente_id`,`fin_utc`,`id`),
  KEY `idx_periodos_vida_pol_sesion` (`sesion_id_diagnostico`),
  KEY `idx_periodos_vida_pol_ultimo_heartbeat` (`agente_id`,`ultimo_heartbeat_utc`,`id`),
  KEY `idx_periodos_vida_pol_sesion_auditoria` (`sesion_auditoria_id`,`inicio_utc`,`id`),
  KEY `idx_periodos_pol_agente_checkpoint` (`agente_id`,`id`,`ultimo_seq`),
  CONSTRAINT `fk_periodos_vida_pol_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_periodos_vida_pol_identidad_sesion` CHECK (`sesion_auditoria_id` is null or `sesion_id_diagnostico` is null and `sesion_huella_sha256` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_pol_agentes_impedir_alta_legacy_5_21
BEFORE INSERT ON periodos_vida_pol_agentes
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND (
    NEW.sesion_id_diagnostico IS NOT NULL
    OR NEW.sesion_huella_sha256 IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un POL nuevo 5.21 no admite identidad legacy';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_pol_agentes_proteger_identidad_sesion_5_21
BEFORE UPDATE ON periodos_vida_pol_agentes
FOR EACH ROW
BEGIN
  IF NOT (OLD.sesion_auditoria_id <=> NEW.sesion_auditoria_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'sesionAuditoriaId de POL es inmutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM migracion_sesiones_5_21
    WHERE id = 1 AND fase = 'completada'
  ) AND NOT (
    OLD.sesion_id_diagnostico <=> NEW.sesion_id_diagnostico
    AND OLD.sesion_huella_sha256 <=> NEW.sesion_huella_sha256
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad legacy historica de POL no puede repoblarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `politicas_retencion_recepciones_federacion` (
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `retencion_recepcion_dias` smallint(5) unsigned DEFAULT NULL,
  `retencion_global_dias` smallint(5) unsigned NOT NULL,
  `retencion_efectiva_dias` smallint(5) unsigned NOT NULL,
  `version_configuracion_portal` bigint(20) unsigned NOT NULL,
  `version_politica` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`,`familia`),
  KEY `idx_politicas_retencion_efectiva` (`retencion_efectiva_dias`,`familia`,`relacion_id`),
  CONSTRAINT `fk_politicas_retencion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_politicas_retencion_limites` CHECK (`retencion_global_dias` between 1 and 3650 and (`retencion_recepcion_dias` is null or `retencion_recepcion_dias` between 1 and 3650) and `retencion_efectiva_dias` = least(`retencion_global_dias`,coalesce(`retencion_recepcion_dias`,`retencion_global_dias`))),
  CONSTRAINT `chk_politicas_retencion_versiones` CHECK (`version_configuracion_portal` >= 1 and `version_politica` >= 1),
  CONSTRAINT `chk_politicas_retencion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_politica_retencion_federacion_versionada
BEFORE UPDATE ON politicas_retencion_recepciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.relacion_id=OLD.relacion_id
    AND NEW.familia=OLD.familia
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.version_politica=OLD.version_politica+1
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La politica de retencion federada exige una revision monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `portal` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `clave_instancia` varchar(100) NOT NULL,
  `nombre_visible` varchar(150) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portal_clave_instancia` (`clave_instancia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `posiciones_ocurrencias_flujos_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `clase_posicion` enum('fotografiaInicial','cambioPosterior') NOT NULL DEFAULT 'cambioPosterior',
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `asignada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`flujo_id`,`generacion_id`,`posicion_flujo`),
  UNIQUE KEY `uk_posiciones_ocurrencias_identidad` (`flujo_id`,`generacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  KEY `idx_posiciones_ocurrencias_identidad` (`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  KEY `idx_posiciones_federacion_clase` (`flujo_id`,`generacion_id`,`clase_posicion`,`posicion_flujo`),
  CONSTRAINT `fk_posiciones_ocurrencias_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_posiciones_ocurrencias_ocurrencia` FOREIGN KEY (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`) REFERENCES `ocurrencias_federacion` (`installation_origen_id`, `familia`, `elemento_origen_id`, `ocurrencia_origen_id`),
  CONSTRAINT `chk_posiciones_ocurrencias_posicion` CHECK (`posicion_flujo` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_posiciones_ocurrencias_federacion_lado_corte
BEFORE INSERT ON posiciones_ocurrencias_flujos_federacion
FOR EACH ROW
BEGIN
  IF NEW.clase_posicion='fotografiaInicial' AND NOT EXISTS (
    SELECT 1 FROM cortes_iniciales_generaciones_federacion c
     WHERE c.flujo_id=NEW.flujo_id AND c.generacion_id=NEW.generacion_id
       AND c.estado='pendiente'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fotografia inicial solo admite posiciones durante su corte pendiente.';
  END IF;
  IF NEW.clase_posicion='cambioPosterior' AND EXISTS (
    SELECT 1 FROM cortes_iniciales_generaciones_federacion c
     WHERE c.flujo_id=NEW.flujo_id AND c.generacion_id=NEW.generacion_id
       AND c.estado='pendiente'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un cambio posterior no puede cruzar un corte inicial pendiente.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_posiciones_ocurrencias_federacion_inmutables
BEFORE UPDATE ON posiciones_ocurrencias_flujos_federacion
FOR EACH ROW
SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Una posicion federada asignada es inmutable.' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `propietarios_emision_flujos_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_trabajo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `version_propietario` bigint(20) unsigned NOT NULL,
  `installation_propietaria_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_propietario_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado` enum('vigente','sustituido','liberado') NOT NULL,
  `instancia_lease_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `intentos_lease` int(10) unsigned NOT NULL DEFAULT 0,
  `vigente_unico` tinyint(4) GENERATED ALWAYS AS (if(`estado` = 'vigente',1,NULL)) STORED,
  `adquirido_en_utc` datetime(3) NOT NULL,
  `finalizado_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_propietarios_flujo_version` (`flujo_id`,`version_propietario`),
  UNIQUE KEY `uk_propietarios_flujo_vigente` (`flujo_id`,`vigente_unico`),
  KEY `idx_propietarios_generacion` (`generacion_id`,`estado`),
  KEY `fk_propietarios_federacion_generacion` (`flujo_id`,`generacion_id`),
  KEY `idx_propietarios_emision_reclamo` (`estado`,`lease_expira_utc`,`flujo_id`,`generacion_id`),
  KEY `idx_propietarios_generacion_trabajo` (`flujo_id`,`generacion_trabajo_id`,`estado`),
  CONSTRAINT `fk_propietarios_federacion_flujo` FOREIGN KEY (`flujo_id`) REFERENCES `flujos_federacion` (`flujo_id`),
  CONSTRAINT `fk_propietarios_federacion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_propietarios_federacion_generacion_trabajo` FOREIGN KEY (`flujo_id`, `generacion_trabajo_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_propietarios_federacion_identidades` CHECK (`installation_propietaria_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `boot_propietario_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_propietarios_federacion_estado` CHECK (`version_propietario` >= 1 and (`estado` = 'vigente' and `finalizado_en_utc` is null or `estado` <> 'vigente' and `finalizado_en_utc` is not null) and (`finalizado_en_utc` is null or `finalizado_en_utc` >= `adquirido_en_utc`)),
  CONSTRAINT `chk_propietarios_emision_lease` CHECK (`instancia_lease_id` is null and `lease_token` is null and `lease_expira_utc` is null and `generacion_trabajo_id` is null or `estado` = 'vigente' and `instancia_lease_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null and `generacion_trabajo_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope_nivel` enum('portal','tenant','empresa','sitio') NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `contexto_clave` varchar(96) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (concat(`scope_nivel`,':',coalesce(`scope_tenant_id`,0),':',coalesce(`scope_empresa_id`,0),':',coalesce(`scope_sitio_id`,0))) STORED,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_proyecciones_federacion_identidad` (`proyeccion_id`),
  UNIQUE KEY `uk_proyecciones_federacion_contexto` (`installation_origen_id`,`familia`,`elemento_origen_id`,`contexto_clave`),
  KEY `idx_proyecciones_federacion_scope` (`scope_nivel`,`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`familia`,`proyeccion_id`),
  CONSTRAINT `chk_proyecciones_federacion_identidades` CHECK (`proyeccion_id` regexp '^sfid1\\.proyeccion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_proyecciones_federacion_scope` CHECK (`scope_nivel` = 'portal' and `scope_tenant_id` is null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_nivel` = 'tenant' and `scope_tenant_id` is not null and `scope_empresa_id` is null and `scope_sitio_id` is null or `scope_nivel` = 'empresa' and `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is null or `scope_nivel` = 'sitio' and `scope_tenant_id` is not null and `scope_empresa_id` is not null and `scope_sitio_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_proyecciones_federacion_inmutables
BEFORE UPDATE ON proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La identidad contextual de una proyeccion es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `rangos_terminales_recepcion_federacion` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inicio_posicion` bigint(20) unsigned NOT NULL,
  `fin_posicion` bigint(20) unsigned NOT NULL,
  `contiene_degradacion` tinyint(1) NOT NULL DEFAULT 0,
  `creado_en_utc` datetime(3) NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`generacion_id`,`inicio_posicion`),
  UNIQUE KEY `uk_rangos_terminales_fin` (`generacion_id`,`fin_posicion`),
  KEY `idx_rangos_terminales_recorrido` (`generacion_id`,`inicio_posicion`,`fin_posicion`),
  CONSTRAINT `fk_rangos_terminales_cursor` FOREIGN KEY (`generacion_id`) REFERENCES `cursores_generaciones_recepcion_federacion` (`generacion_id`),
  CONSTRAINT `chk_rangos_terminales_posiciones` CHECK (`inicio_posicion` >= 1 and `fin_posicion` >= `inicio_posicion`),
  CONSTRAINT `chk_rangos_terminales_cronologia` CHECK (`actualizado_en_utc` >= `creado_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_rangos_terminales_actualizacion_controlada
BEFORE UPDATE ON rangos_terminales_recepcion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Los rangos terminales se sustituyen, no se reinterpretan.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reclamaciones_correos_salida` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `salida_correo_id` bigint(20) unsigned NOT NULL,
  `claim_id` binary(32) NOT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL,
  `propietario_claim` varchar(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_previo` enum('pendiente','error_reintentable') NOT NULL,
  `estado` enum('reclamada','enviando','liberada','finalizada','resultado_ambiguo') NOT NULL DEFAULT 'reclamada',
  `reclamada_en_utc` datetime(3) NOT NULL,
  `lease_expira_utc` datetime(3) NOT NULL,
  `enviando_en_utc` datetime(3) DEFAULT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  `codigo_resultado` varchar(120) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reclamaciones_correo_claim` (`claim_id`),
  UNIQUE KEY `uk_reclamaciones_correo_salida_fencing` (`salida_correo_id`,`fencing_token`),
  KEY `idx_reclamaciones_correo_salida` (`salida_correo_id`,`id`),
  KEY `idx_reclamaciones_correo_estado_lease` (`estado`,`lease_expira_utc`,`id`),
  CONSTRAINT `fk_reclamaciones_correo_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`),
  CONSTRAINT `chk_reclamaciones_correo_fencing` CHECK (`fencing_token` > 0),
  CONSTRAINT `chk_reclamaciones_correo_lease` CHECK (`lease_expira_utc` > `reclamada_en_utc`),
  CONSTRAINT `chk_reclamaciones_correo_estado` CHECK (`estado` = 'reclamada' and `enviando_en_utc` is null and `finalizada_en_utc` is null and `codigo_resultado` is null or `estado` = 'enviando' and `enviando_en_utc` is not null and `finalizada_en_utc` is null and `codigo_resultado` is null or `estado` in ('liberada','finalizada','resultado_ambiguo') and `finalizada_en_utc` is not null and `codigo_resultado` is not null),
  CONSTRAINT `chk_reclamaciones_correo_cronologia` CHECK ((`enviando_en_utc` is null or `enviando_en_utc` >= `reclamada_en_utc`) and (`finalizada_en_utc` is null or `finalizada_en_utc` >= coalesce(`enviando_en_utc`,`reclamada_en_utc`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reconciliacion_inicial_dns` (
  `id` tinyint(3) unsigned NOT NULL,
  `estado` enum('activa','bloqueada','satisfecha') NOT NULL,
  `generacion_objetivo` bigint(20) unsigned NOT NULL,
  `ultimo_intento_generacion_dns` bigint(20) unsigned DEFAULT NULL,
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `max_intentos` smallint(5) unsigned NOT NULL,
  `proximo_intento_utc` datetime(3) DEFAULT NULL,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `satisfecha_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_reconciliacion_inicial_dns_singleton` CHECK (`id` = 1),
  CONSTRAINT `chk_reconciliacion_inicial_dns_intentos` CHECK (`max_intentos` between 1 and 100 and `intentos` <= `max_intentos` and `generacion_objetivo` > 0 and (`ultimo_intento_generacion_dns` is null or `ultimo_intento_generacion_dns` < `generacion_objetivo`)),
  CONSTRAINT `chk_reconciliacion_inicial_dns_diagnostico` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null),
  CONSTRAINT `chk_reconciliacion_inicial_dns_estado` CHECK (`estado` = 'activa' and `proximo_intento_utc` is not null and `satisfecha_en_utc` is null or `estado` = 'bloqueada' and `intentos` = `max_intentos` and `proximo_intento_utc` is null and `ultimo_codigo_error` is not null and `satisfecha_en_utc` is null or `estado` = 'satisfecha' and `proximo_intento_utc` is null and `satisfecha_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_reconciliacion_inicial_dns_validar_insert
BEFORE INSERT ON reconciliacion_inicial_dns
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cabecera_generacion_dns
    WHERE id = 1 AND ultima_generacion_dns = NEW.generacion_objetivo
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La reconciliación inicial exige la generación global vigente';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_reconciliacion_inicial_dns_proteger_update
BEFORE UPDATE ON reconciliacion_inicial_dns
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.id <=> NEW.id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad de reconciliación DNS es inmutable';
  END IF;

  IF NEW.generacion_objetivo < OLD.generacion_objetivo THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La reconciliación DNS no puede volver a una generación anterior';
  END IF;

  IF NEW.generacion_objetivo > OLD.generacion_objetivo AND NOT EXISTS (
    SELECT 1
    FROM cabecera_generacion_dns
    WHERE id = 1 AND ultima_generacion_dns = NEW.generacion_objetivo
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La reconciliación DNS solo puede trasladarse a la generación vigente';
  END IF;

  IF NEW.generacion_objetivo > OLD.generacion_objetivo AND NOT (
    OLD.estado <=> NEW.estado
    AND OLD.intentos <=> NEW.intentos
    AND OLD.max_intentos <=> NEW.max_intentos
    AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
    AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
    AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
    AND OLD.satisfecha_en_utc <=> NEW.satisfecha_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Trasladar la reconciliación DNS no reactiva ni reinicia su presupuesto';
  END IF;

  IF NOT (
    (OLD.estado = 'activa' AND NEW.estado IN ('activa', 'bloqueada', 'satisfecha'))
    OR (OLD.estado = 'bloqueada' AND NEW.estado IN ('bloqueada', 'activa', 'satisfecha'))
    OR (OLD.estado = 'satisfecha' AND NEW.estado = 'satisfecha')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición de reconciliación DNS no está permitida';
  END IF;

  IF NEW.intentos < OLD.intentos
    AND NOT (OLD.estado = 'bloqueada' AND NEW.estado = 'activa') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los intentos DNS solo se reinician al reactivar por CLI';
  END IF;

  IF OLD.estado = 'satisfecha' AND NOT (
    OLD.estado <=> NEW.estado
    AND OLD.generacion_objetivo <=> NEW.generacion_objetivo
    AND OLD.ultimo_intento_generacion_dns <=> NEW.ultimo_intento_generacion_dns
    AND OLD.intentos <=> NEW.intentos
    AND OLD.max_intentos <=> NEW.max_intentos
    AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
    AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
    AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
    AND OLD.actualizada_en_utc <=> NEW.actualizada_en_utc
    AND OLD.satisfecha_en_utc <=> NEW.satisfecha_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La reconciliación DNS satisfecha es inmutable';
  END IF;

  IF NEW.estado = 'satisfecha' AND OLD.estado <> 'satisfecha' AND NOT EXISTS (
    SELECT 1
    FROM cabecera_generacion_dns
    WHERE id = 1
      AND generacion_observada = NEW.generacion_objetivo
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Solo una recarga DNS observada satisface la reconciliación';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_reconciliacion_inicial_dns_proteger_delete
BEFORE DELETE ON reconciliacion_inicial_dns
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'La reconciliación inicial DNS tiene retención independiente';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reconciliaciones_flujos_concesion_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_efectiva_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_oferta_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_aceptacion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `direccion` enum('emision','recepcion') NOT NULL,
  `scope_origen_nivel` enum('portal','tenant','empresa','sitio') DEFAULT NULL,
  `scope_origen_tenant_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `scope_origen_empresa_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `scope_origen_sitio_id` varchar(32) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado` enum('pendienteManifiesto','preparandoFotografia','lista') NOT NULL,
  `frontera_inicial` bigint(20) unsigned DEFAULT NULL,
  `version_reconciliacion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`flujo_id`),
  UNIQUE KEY `uk_reconciliacion_generacion` (`generacion_id`),
  UNIQUE KEY `uk_reconciliacion_relacion_familia` (`relacion_id`,`familia`),
  KEY `ix_reconciliacion_revision` (`revision_efectiva_id`),
  CONSTRAINT `fk_reconciliacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_reconciliacion_revision` FOREIGN KEY (`revision_efectiva_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `chk_reconciliacion_frontera` CHECK (`estado` in ('pendienteManifiesto','preparandoFotografia') and `frontera_inicial` is null or `estado` = 'lista' and `frontera_inicial` is not null),
  CONSTRAINT `chk_reconciliacion_version` CHECK (`version_reconciliacion` >= 1),
  CONSTRAINT `chk_reconciliacion_scope_origen` CHECK (`scope_origen_nivel` is null and `scope_origen_tenant_id` is null and `scope_origen_empresa_id` is null and `scope_origen_sitio_id` is null or `scope_origen_nivel` = 'portal' and `scope_origen_tenant_id` is null and `scope_origen_empresa_id` is null and `scope_origen_sitio_id` is null or `scope_origen_nivel` = 'tenant' and `scope_origen_tenant_id` is not null and `scope_origen_empresa_id` is null and `scope_origen_sitio_id` is null or `scope_origen_nivel` = 'empresa' and `scope_origen_tenant_id` is not null and `scope_origen_empresa_id` is not null and `scope_origen_sitio_id` is null or `scope_origen_nivel` = 'sitio' and `scope_origen_tenant_id` is not null and `scope_origen_empresa_id` is not null and `scope_origen_sitio_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reconciliaciones_reloj_relativo_telemetria` (
  `generacion_correccion` bigint(20) unsigned NOT NULL,
  `reloj_anterior_utc` datetime NOT NULL,
  `reloj_corregido_utc` datetime NOT NULL,
  `cursor_regla_id` bigint(20) unsigned NOT NULL DEFAULT 0,
  `reglas_procesadas` bigint(20) unsigned NOT NULL DEFAULT 0,
  `estado` enum('pendiente','completada') NOT NULL DEFAULT 'pendiente',
  `completada_en_utc` datetime(6) DEFAULT NULL,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`generacion_correccion`),
  KEY `idx_reconciliaciones_reloj_relativo_pendientes` (`estado`,`generacion_correccion`,`cursor_regla_id`),
  CONSTRAINT `chk_reconciliacion_reloj_relativo_generacion` CHECK (`generacion_correccion` > 0),
  CONSTRAINT `chk_reconciliacion_reloj_relativo_retroceso` CHECK (`reloj_corregido_utc` < `reloj_anterior_utc`),
  CONSTRAINT `chk_reconciliacion_reloj_relativo_terminal` CHECK (`estado` = 'pendiente' and `completada_en_utc` is null or `estado` = 'completada' and `completada_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recorrido_contribuciones_federacion` (
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` bigint(20) unsigned NOT NULL,
  `installation_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`contribucion_id`,`ordinal`),
  UNIQUE KEY `uk_recorrido_contribucion_instalacion` (`contribucion_id`,`installation_id`),
  CONSTRAINT `fk_recorrido_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `chk_recorrido_contribucion_ordinal` CHECK (`ordinal` >= 1),
  CONSTRAINT `chk_recorrido_contribucion_instalacion` CHECK (`installation_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_recorrido_contribuciones_inmutable
BEFORE UPDATE ON recorrido_contribuciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El recorrido de una contribucion es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recuperaciones_relacion_federacion` (
  `recuperacion_id` char(29) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `credencial_temporal_hash` binary(32) NOT NULL,
  `estado` enum('vigente','consumida','revocada','expirada') NOT NULL,
  `recuperacion_vigente_relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `emitida_por_usuario_id` bigint(20) unsigned NOT NULL,
  `emitida_en_utc` datetime(3) NOT NULL,
  `expira_en_utc` datetime(3) NOT NULL,
  `consumida_en_utc` datetime(3) DEFAULT NULL,
  `installation_emisora_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `boot_emisor_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evento_emision_id` binary(16) NOT NULL,
  `evento_consumo_id` binary(16) DEFAULT NULL,
  `solicitud_canje_id` binary(16) DEFAULT NULL,
  `correlacion_id` binary(16) NOT NULL,
  PRIMARY KEY (`recuperacion_id`),
  UNIQUE KEY `uk_recuperaciones_relacion_hash` (`credencial_temporal_hash`),
  UNIQUE KEY `uk_recuperaciones_relacion_evento_emision` (`evento_emision_id`),
  UNIQUE KEY `uk_recuperaciones_relacion_vigente` (`recuperacion_vigente_relacion_id`),
  UNIQUE KEY `uk_recuperaciones_relacion_evento_consumo` (`evento_consumo_id`),
  UNIQUE KEY `uk_recuperaciones_relacion_solicitud` (`solicitud_canje_id`),
  KEY `idx_recuperaciones_relacion_expiracion` (`estado`,`expira_en_utc`,`recuperacion_id`),
  KEY `fk_recuperaciones_relacion_relacion` (`relacion_id`),
  KEY `fk_recuperaciones_relacion_usuario` (`emitida_por_usuario_id`),
  CONSTRAINT `fk_recuperaciones_relacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_recuperaciones_relacion_usuario` FOREIGN KEY (`emitida_por_usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_recuperaciones_relacion_estado` CHECK (`estado` = 'vigente' and `recuperacion_vigente_relacion_id` = `relacion_id` and `consumida_en_utc` is null and `installation_emisora_id` is null and `boot_emisor_id` is null and `evento_consumo_id` is null and `solicitud_canje_id` is null or `estado` = 'consumida' and `recuperacion_vigente_relacion_id` is null and `consumida_en_utc` is not null and `installation_emisora_id` is not null and `boot_emisor_id` is not null and `evento_consumo_id` is not null and `solicitud_canje_id` is not null or `estado` in ('revocada','expirada') and `recuperacion_vigente_relacion_id` is null and `consumida_en_utc` is null and `installation_emisora_id` is null and `boot_emisor_id` is null and `evento_consumo_id` is null and `solicitud_canje_id` is null),
  CONSTRAINT `chk_recuperaciones_relacion_cronologia` CHECK (`expira_en_utc` > `emitida_en_utc` and (`consumida_en_utc` is null or `consumida_en_utc` >= `emitida_en_utc`)),
  CONSTRAINT `chk_recuperaciones_relacion_uuidv7` CHECK (substr(hex(`evento_emision_id`),13,1) = '7' and substr(hex(`evento_emision_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B') and (`evento_consumo_id` is null or substr(hex(`evento_consumo_id`),13,1) = '7' and substr(hex(`evento_consumo_id`),17,1) in ('8','9','A','B')) and (`solicitud_canje_id` is null or substr(hex(`solicitud_canje_id`),13,1) = '7' and substr(hex(`solicitud_canje_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_recuperaciones_relacion_identidades` CHECK (`recuperacion_id` regexp '^sfrec1_[A-Za-z0-9_-]{21}[AQgw]$' and `relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and (`installation_emisora_id` is null or `installation_emisora_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`boot_emisor_id` is null or `boot_emisor_id` regexp '^sfid1\\.arranque\\.[A-Za-z0-9_-]{21}[AQgw]$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recursos_operaciones_administrativas` (
  `operacion_id` binary(16) NOT NULL,
  `tipo_recurso` enum('agente','tenant','empresa','sitio') NOT NULL,
  `recurso_id` bigint(20) unsigned NOT NULL,
  `recurso_clave` varchar(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (convert(concat(`tipo_recurso`,':',convert(cast(`recurso_id` as char charset ascii) using utf8mb4)) using ascii) collate ascii_bin) STORED,
  `estado_reclamo` enum('activo','liberado') NOT NULL DEFAULT 'activo',
  `recurso_clave_activa` varchar(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (case when `estado_reclamo` = 'activo' then `recurso_clave` else NULL end) STORED,
  `reclamado_en_utc` datetime(3) NOT NULL,
  `liberado_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`operacion_id`,`tipo_recurso`,`recurso_id`),
  UNIQUE KEY `uk_recursos_operaciones_administrativas_activo` (`recurso_clave_activa`),
  KEY `idx_recursos_operaciones_administrativas_operacion` (`operacion_id`,`estado_reclamo`,`recurso_clave`),
  KEY `idx_recursos_operaciones_administrativas_historial` (`recurso_clave`,`reclamado_en_utc`,`operacion_id`),
  KEY `idx_recursos_operaciones_administrativas_resolucion` (`tipo_recurso`,`estado_reclamo`,`recurso_id`,`operacion_id`),
  CONSTRAINT `fk_recursos_operaciones_administrativas_operacion` FOREIGN KEY (`operacion_id`) REFERENCES `operaciones_administrativas` (`operacion_id`),
  CONSTRAINT `chk_recursos_operaciones_administrativas_estado` CHECK (`estado_reclamo` = 'activo' and `recurso_clave_activa` = `recurso_clave` and `liberado_en_utc` is null or `estado_reclamo` = 'liberado' and `recurso_clave_activa` is null and `liberado_en_utc` is not null and `liberado_en_utc` >= `reclamado_en_utc`),
  CONSTRAINT `chk_recursos_operaciones_administrativas_identidad` CHECK (`tipo_recurso` in ('agente','tenant','empresa','sitio') and `recurso_id` > 0 and `recurso_clave` = convert(concat(`tipo_recurso`,':',convert(cast(`recurso_id` as char charset ascii) using utf8mb4)) using ascii) collate ascii_bin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_auditoria_remota` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evento_origen_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clave_cadena_origen` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `secuencia_cadena_origen` bigint(20) unsigned DEFAULT NULL,
  `estado_verificabilidad_origen` enum('verificable','noVerificable') NOT NULL,
  `resultado_validacion_receptor` enum('verificada','noVerificable','invalida') NOT NULL,
  `causa_validacion` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `hash_payload_origen` binary(32) DEFAULT NULL,
  `hash_anterior_origen` binary(32) DEFAULT NULL,
  `hash_actual_origen` binary(32) DEFAULT NULL,
  `hash_representacion_receptor` binary(32) NOT NULL,
  `hash_ancla_receptor` binary(32) NOT NULL,
  `efectivo_en_origen_utc` datetime(3) DEFAULT NULL,
  `registrado_en_origen_utc` datetime(3) DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_registros_auditoria_remota_trabajo` (`trabajo_entrega_id`),
  UNIQUE KEY `uk_registros_auditoria_remota_evento_generacion` (`proyeccion_id`,`generacion_id`,`evento_origen_id`),
  KEY `idx_registros_auditoria_remota_evento` (`evento_origen_id`,`proyeccion_id`),
  KEY `idx_registros_auditoria_remota_cadena` (`clave_cadena_origen`,`secuencia_cadena_origen`,`proyeccion_id`),
  KEY `idx_registros_auditoria_remota_validacion` (`resultado_validacion_receptor`,`materializada_en_utc`,`proyeccion_id`),
  KEY `fk_registros_auditoria_remota_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_auditoria_remota_retencion` (`clave_cadena_origen`,`efectivo_en_origen_utc`,`generacion_id`,`secuencia_cadena_origen`),
  CONSTRAINT `fk_registros_auditoria_remota_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_registros_auditoria_remota_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_registros_auditoria_remota_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_registros_auditoria_remota_ocurrencia` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_registros_auditoria_remota_evento` CHECK (`evento_origen_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_registros_auditoria_remota_evidencia` CHECK (`estado_verificabilidad_origen` = 'verificable' and `resultado_validacion_receptor` in ('verificada','invalida') and `clave_cadena_origen` is not null and `secuencia_cadena_origen` is not null and `hash_payload_origen` is not null and `hash_anterior_origen` is not null and `hash_actual_origen` is not null or `estado_verificabilidad_origen` = 'noVerificable' and `clave_cadena_origen` is null and `secuencia_cadena_origen` is null and `hash_payload_origen` is null and `hash_anterior_origen` is null and `hash_actual_origen` is null and `resultado_validacion_receptor` = 'noVerificable'),
  CONSTRAINT `chk_registros_auditoria_remota_resultado` CHECK (`resultado_validacion_receptor` = 'verificada' and `causa_validacion` is null or `resultado_validacion_receptor` in ('noVerificable','invalida') and `causa_validacion` is not null),
  CONSTRAINT `chk_registros_auditoria_remota_payload` CHECK (`secuencia_elemento` >= 1 and json_valid(`representacion_canonica`) and octet_length(`representacion_canonica`) between 2 and 2097152)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_registro_auditoria_remota_inmutable
BEFORE UPDATE ON registros_auditoria_remota
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un evento remoto de auditoría es evidencia inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_avisos_federados` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_registro` enum('estadoActual','transicion') DEFAULT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `aviso_origen_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado_ciclo` enum('pendiente','resuelto','obsoleto') DEFAULT NULL,
  `gravedad` enum('informativa','advertencia','critica') DEFAULT NULL,
  `ordinal_transicion` bigint(20) unsigned DEFAULT NULL,
  `tiempo_dato_utc` datetime(3) DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_registros_avisos_federados_trabajo` (`trabajo_entrega_id`),
  KEY `idx_registros_avisos_federados_aviso` (`aviso_origen_id`,`tipo_registro`,`tiempo_dato_utc`),
  KEY `fk_registros_avisos_federados_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_avisos_retencion_federada` (`generacion_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`,`secuencia_elemento`),
  CONSTRAINT `fk_registros_avisos_federados_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_registros_avisos_federados_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_registros_avisos_federados_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_registros_avisos_federados_forma` CHECK (`estado_registro` = 'presente' and `tipo_registro` is not null and `aviso_origen_id` is not null or `estado_registro` = 'retirado' and `tipo_registro` is null and `aviso_origen_id` is null),
  CONSTRAINT `chk_registros_avisos_federados_json` CHECK (`secuencia_elemento` >= 1 and json_valid(`representacion_canonica`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_registros_avisos_federados_inmutable
BEFORE UPDATE ON registros_avisos_federados
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un aviso federado materializado es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_dns` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `zona_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `empresa_id` bigint(20) unsigned DEFAULT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `host_relativo` varchar(255) NOT NULL,
  `tipo_registro` varchar(24) NOT NULL,
  `valor_principal` varchar(1024) DEFAULT NULL,
  `ttl_segundos` int(10) unsigned DEFAULT NULL,
  `prioridad` smallint(5) unsigned DEFAULT NULL,
  `peso` smallint(5) unsigned DEFAULT NULL,
  `puerto` int(10) unsigned DEFAULT NULL,
  `flags` varchar(255) DEFAULT NULL,
  `tag` varchar(255) DEFAULT NULL,
  `categoria_origen` varchar(40) NOT NULL DEFAULT 'normal',
  `publicar_en_bind` tinyint(1) NOT NULL DEFAULT 1,
  `datos_auxiliares` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`datos_auxiliares`)),
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_registros_dns_zona_host_tipo` (`zona_id`,`host_relativo`,`tipo_registro`,`activo`,`id`),
  KEY `idx_registros_dns_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`activo`,`id`),
  KEY `idx_registros_dns_publicacion` (`publicar_en_bind`,`categoria_origen`,`activo`,`id`),
  KEY `idx_registros_dns_tipo` (`tipo_registro`,`activo`,`id`),
  KEY `fk_registros_dns_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `fk_registros_dns_sitio_empresa_tenant` (`sitio_id`,`empresa_id`,`tenant_id`),
  CONSTRAINT `fk_registros_dns_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_registros_dns_sitio_empresa_tenant` FOREIGN KEY (`sitio_id`, `empresa_id`, `tenant_id`) REFERENCES `sitios` (`id`, `empresa_id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_registros_dns_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_registros_dns_zona` FOREIGN KEY (`zona_id`) REFERENCES `zonas_dns` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_monitores_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_registro` enum('definicion','estadoActual','evento','tramoHistorico','alerta','referenciaTrigger','rangoHistorico') DEFAULT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `monitor_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `referencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `alerta_auditoria_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado_operativo` varchar(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `tiempo_dato_utc` datetime(3) DEFAULT NULL,
  `vigente_hasta_origen_utc` datetime(3) DEFAULT NULL,
  `causa_retirada` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_registros_monitores_trabajo` (`trabajo_entrega_id`),
  KEY `idx_registros_monitores_actual` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`estado_registro`),
  KEY `idx_registros_monitores_monitor` (`monitor_origen_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`),
  KEY `idx_registros_monitores_referencia` (`referencia_origen_id`,`tipo_registro`,`proyeccion_id`),
  KEY `idx_registros_monitores_alerta` (`alerta_auditoria_id`,`estado_operativo`,`proyeccion_id`),
  KEY `fk_registros_monitores_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_monitores_retencion_federada` (`generacion_id`,`tipo_registro`,`estado_operativo`,`tiempo_dato_utc`,`proyeccion_id`,`secuencia_elemento`),
  CONSTRAINT `fk_registros_monitores_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_registros_monitores_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_registros_monitores_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_registros_monitores_ocurrencia` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_registros_monitores_referencias` CHECK ((`monitor_origen_id` is null or `monitor_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`referencia_origen_id` is null or `referencia_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`alerta_auditoria_id` is null or `alerta_auditoria_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
  CONSTRAINT `chk_registros_monitores_payload` CHECK (`secuencia_elemento` >= 1 and octet_length(`representacion_canonica`) between 2 and 2097152 and json_valid(`representacion_canonica`)),
  CONSTRAINT `chk_registros_monitores_estado` CHECK (`estado_registro` = 'presente' and `tipo_registro` is not null and `causa_retirada` is null or `estado_registro` = 'retirado' and `tipo_registro` is null and `monitor_origen_id` is null and `referencia_origen_id` is null and `alerta_auditoria_id` is null and `estado_operativo` is null and `tiempo_dato_utc` is null and `vigente_hasta_origen_utc` is null and `causa_retirada` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_registro_monitor_remoto_inmutable
BEFORE UPDATE ON registros_monitores_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un registro remoto de monitor es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_telemetria_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_registro` enum('fuente','senal','observacion','fotografiaSenal','fotografiaPol','reglaDerivacion','eventoDerivado','rangoHistorico') DEFAULT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `fuente_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `senal_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `referencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `tiempo_dato_utc` datetime(3) DEFAULT NULL,
  `vigente_hasta_origen_utc` datetime(3) DEFAULT NULL,
  `causa_retirada` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_registros_telemetria_trabajo` (`trabajo_entrega_id`),
  KEY `idx_registros_telemetria_actual` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`estado_registro`),
  KEY `idx_registros_telemetria_fuente` (`fuente_origen_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`),
  KEY `idx_registros_telemetria_senal` (`senal_origen_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`),
  KEY `idx_registros_telemetria_referencia` (`referencia_origen_id`,`tipo_registro`,`proyeccion_id`),
  KEY `fk_registros_telemetria_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_telemetria_retencion_federada` (`generacion_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`,`secuencia_elemento`),
  CONSTRAINT `fk_registros_telemetria_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_registros_telemetria_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_registros_telemetria_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_registros_telemetria_ocurrencia` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_registros_telemetria_referencias` CHECK ((`fuente_origen_id` is null or `fuente_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`senal_origen_id` is null or `senal_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`referencia_origen_id` is null or `referencia_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_registros_telemetria_payload` CHECK (`secuencia_elemento` >= 1 and octet_length(`representacion_canonica`) between 2 and 2097152 and json_valid(`representacion_canonica`)),
  CONSTRAINT `chk_registros_telemetria_estado` CHECK (`estado_registro` = 'presente' and `tipo_registro` is not null and `causa_retirada` is null or `estado_registro` = 'retirado' and `tipo_registro` is null and `fuente_origen_id` is null and `senal_origen_id` is null and `referencia_origen_id` is null and `tiempo_dato_utc` is null and `vigente_hasta_origen_utc` is null and `causa_retirada` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_registro_telemetria_remoto_inmutable
BEFORE UPDATE ON registros_telemetria_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un registro remoto de telemetria es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_triggers_informativos_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_registro` enum('definicion','asignacionMonitor','ejecucionTerminada') DEFAULT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `trigger_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `monitor_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `referencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `estado_ejecucion` varchar(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `tiempo_dato_utc` datetime(3) DEFAULT NULL,
  `causa_retirada` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_registros_triggers_informativos_trabajo` (`trabajo_entrega_id`),
  KEY `idx_registros_triggers_informativos_trigger` (`trigger_origen_id`,`tipo_registro`,`tiempo_dato_utc`),
  KEY `idx_registros_triggers_informativos_monitor` (`monitor_origen_id`,`tipo_registro`,`proyeccion_id`),
  KEY `fk_registros_triggers_informativos_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_triggers_retencion_federada` (`generacion_id`,`tipo_registro`,`tiempo_dato_utc`,`proyeccion_id`,`secuencia_elemento`),
  CONSTRAINT `fk_registros_triggers_informativos_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_registros_triggers_informativos_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_registros_triggers_informativos_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_registros_triggers_informativos_ocurrencia` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_registros_triggers_informativos_referencias` CHECK ((`trigger_origen_id` is null or `trigger_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`monitor_origen_id` is null or `monitor_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`referencia_origen_id` is null or `referencia_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_registros_triggers_informativos_payload` CHECK (`secuencia_elemento` >= 1 and json_valid(`representacion_canonica`) and octet_length(`representacion_canonica`) between 2 and 2097152),
  CONSTRAINT `chk_registros_triggers_informativos_estado` CHECK (`estado_registro` = 'presente' and `tipo_registro` is not null and `causa_retirada` is null or `estado_registro` = 'retirado' and `tipo_registro` is null and `trigger_origen_id` is null and `monitor_origen_id` is null and `referencia_origen_id` is null and `estado_ejecucion` is null and `tiempo_dato_utc` is null and `causa_retirada` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_registro_trigger_informativo_remoto_inmutable
BEFORE UPDATE ON registros_triggers_informativos_remotos FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Un registro remoto de trigger es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reglas_derivacion_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `estado` enum('activa','deshabilitada') NOT NULL DEFAULT 'activa',
  `revision_vigente_id` bigint(20) unsigned DEFAULT NULL,
  `generacion_autoridad` bigint(20) unsigned NOT NULL DEFAULT 1,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reglas_derivacion_id_contexto` (`id`,`agente_id`,`senal_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  UNIQUE KEY `uk_reglas_derivacion_id_agente_scope` (`id`,`agente_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_reglas_derivacion_senal_estado` (`senal_id`,`estado`,`id`),
  KEY `idx_reglas_derivacion_agente_estado` (`agente_id`,`estado`,`id`),
  KEY `idx_reglas_derivacion_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`estado`,`id`),
  KEY `idx_reglas_derivacion_revision_vigente` (`revision_vigente_id`),
  KEY `fk_reglas_derivacion_agente_scope` (`agente_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `fk_reglas_derivacion_senal_agente` (`senal_id`,`agente_id`),
  KEY `idx_reglas_derivacion_agente_id` (`agente_id`,`id`),
  CONSTRAINT `fk_reglas_derivacion_agente_scope` FOREIGN KEY (`agente_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `agentes_sentinelia` (`id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reglas_derivacion_senal_agente` FOREIGN KEY (`senal_id`, `agente_id`) REFERENCES `senales_telemetria_agentes` (`id`, `agente_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_reglas_derivacion_generacion_autoridad` CHECK (`generacion_autoridad` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reinicios_password_administrativos` (
  `reinicio_id` binary(16) NOT NULL,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `via` enum('correo','manual') NOT NULL,
  `estado` enum('reservado','confirmado') NOT NULL DEFAULT 'reservado',
  `evento_auditoria_id` binary(16) DEFAULT NULL,
  `salida_correo_id` bigint(20) unsigned DEFAULT NULL,
  `version_sesion_resultante` int(10) unsigned DEFAULT NULL,
  `generacion_recuperacion_resultante` bigint(20) unsigned DEFAULT NULL,
  `creado_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `aplicado_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`reinicio_id`),
  UNIQUE KEY `uk_reinicios_password_administrativos_evento` (`evento_auditoria_id`),
  KEY `idx_reinicios_password_administrativos_usuario` (`usuario_id`,`aplicado_en_utc`,`reinicio_id`),
  KEY `idx_reinicios_password_administrativos_salida` (`salida_correo_id`),
  CONSTRAINT `fk_reinicios_password_administrativos_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_reinicios_password_administrativos_uuidv7` CHECK (substr(hex(`reinicio_id`),13,1) = '7' and substr(hex(`reinicio_id`),17,1) in ('8','9','A','B') and (`evento_auditoria_id` is null or substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B'))),
  CONSTRAINT `chk_reinicios_password_administrativos_usuario` CHECK (`usuario_id` > 0),
  CONSTRAINT `chk_reinicios_password_administrativos_estado` CHECK (`estado` = 'reservado' and `evento_auditoria_id` is null and `version_sesion_resultante` is null and `generacion_recuperacion_resultante` is null and `aplicado_en_utc` is null or `estado` = 'confirmado' and `evento_auditoria_id` is not null and `version_sesion_resultante` > 0 and `generacion_recuperacion_resultante` > 0 and `aplicado_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `relaciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `direccion` enum('emision','recepcion') NOT NULL,
  `estado_ciclo` enum('pendienteVinculacion','pendienteConfirmacionIdentidad','pendienteAutenticacion','vinculada','deshabilitada','eliminada') NOT NULL,
  `estado_autoridad` enum('autorizada','sinAutoridad') NOT NULL,
  `estado_identidad` enum('valida','conflictiva') NOT NULL,
  `estado_compatibilidad` enum('compatible','compatibleParcial','incompatible') DEFAULT NULL,
  `installation_remota_candidata_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `nombre_remoto_declarado` varchar(191) DEFAULT NULL,
  `responsable_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `responsable_original_usuario_id` bigint(20) unsigned NOT NULL,
  `scope_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `scope_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `scope_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `version_autoridad` bigint(20) unsigned NOT NULL DEFAULT 1,
  `corte_autoridad_utc` datetime(3) DEFAULT NULL,
  `creada_por_usuario_id` bigint(20) unsigned NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `revision` bigint(20) unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_relaciones_federacion_identidad` (`relacion_id`),
  KEY `idx_relaciones_federacion_responsable` (`responsable_usuario_id`,`estado_autoridad`,`estado_ciclo`,`relacion_id`),
  KEY `idx_relaciones_federacion_scope` (`scope_tenant_id`,`scope_empresa_id`,`scope_sitio_id`,`direccion`,`estado_ciclo`,`relacion_id`),
  KEY `idx_relaciones_federacion_contraparte` (`installation_remota_id`,`direccion`,`estado_ciclo`,`relacion_id`),
  CONSTRAINT `chk_relaciones_federacion_scope` CHECK ((`scope_tenant_id` is not null or `scope_empresa_id` is null and `scope_sitio_id` is null) and (`scope_empresa_id` is not null or `scope_sitio_id` is null)),
  CONSTRAINT `chk_relaciones_federacion_responsabilidad` CHECK (`responsable_original_usuario_id` >= 1 and `creada_por_usuario_id` >= 1 and (`estado_autoridad` <> 'autorizada' or `responsable_usuario_id` is not null) and (`estado_autoridad` = 'autorizada' and `corte_autoridad_utc` is null or `estado_autoridad` = 'sinAutoridad' and `corte_autoridad_utc` is not null)),
  CONSTRAINT `chk_relaciones_federacion_contadores` CHECK (`version_autoridad` >= 1 and `revision` >= 1),
  CONSTRAINT `chk_relaciones_federacion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc`),
  CONSTRAINT `chk_relaciones_federacion_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and (`installation_remota_candidata_id` is null or `installation_remota_candidata_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$') and (`installation_remota_id` is null or `installation_remota_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$')),
  CONSTRAINT `chk_relaciones_federacion_vinculacion` CHECK (`estado_ciclo` = 'pendienteVinculacion' and `installation_remota_candidata_id` is null and `installation_remota_id` is null or `estado_ciclo` = 'pendienteConfirmacionIdentidad' and `installation_remota_candidata_id` is not null and `installation_remota_id` is null or `estado_ciclo` = 'pendienteAutenticacion' and `installation_remota_candidata_id` = `installation_remota_id` and `installation_remota_id` is not null or `estado_ciclo` in ('vinculada','deshabilitada') and `installation_remota_candidata_id` = `installation_remota_id` and `installation_remota_id` is not null and `estado_compatibilidad` is not null or `estado_ciclo` = 'eliminada')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_relaciones_federacion_proteger_identidad
BEFORE UPDATE ON relaciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.relacion_id <=> NEW.relacion_id
    AND OLD.direccion <=> NEW.direccion
    AND OLD.responsable_original_usuario_id <=> NEW.responsable_original_usuario_id
    AND OLD.creada_por_usuario_id <=> NEW.creada_por_usuario_id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y direccion de una relacion federada son inmutables';
  END IF;
  IF OLD.installation_remota_id IS NOT NULL
     AND NOT (OLD.installation_remota_id <=> NEW.installation_remota_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La installationId remota confirmada no puede reasignarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_relaciones_federacion_estado_terminal
BEFORE UPDATE ON relaciones_federacion
FOR EACH ROW
BEGIN
  IF OLD.estado_ciclo = 'eliminada' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una relacion federada eliminada es terminal.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `relaciones_incidente_identidad_federacion` (
  `incidente_id` binary(16) NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `boot_ids` longtext NOT NULL CHECK (json_valid(`boot_ids`)),
  `papel` enum('observada','legitima','clon') NOT NULL DEFAULT 'observada',
  `vinculada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`incidente_id`,`relacion_id`),
  KEY `idx_relaciones_incidente_relacion` (`relacion_id`,`incidente_id`),
  CONSTRAINT `fk_relaciones_incidente_incidente` FOREIGN KEY (`incidente_id`) REFERENCES `incidentes_identidad_federacion` (`incidente_id`),
  CONSTRAINT `fk_relaciones_incidente_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_relaciones_incidente_identidades` CHECK (`relacion_id` regexp '^sfid1\\.relacion\\.[A-Za-z0-9_-]{21}[AQgw]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservas_identidad_ocurrencias_federacion` (
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `intencion_sha256` binary(32) NOT NULL,
  `secuencia_elemento` bigint(20) unsigned DEFAULT NULL,
  `reservada_en_utc` datetime(3) NOT NULL,
  `consolidada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`installation_origen_id`,`familia`,`elemento_origen_id`,`ocurrencia_origen_id`),
  CONSTRAINT `chk_reservas_ocurrencias_identidades` CHECK (`installation_origen_id` regexp '^sfid1\\.instalacion\\.[A-Za-z0-9_-]{21}[AQgw]$' and `elemento_origen_id` regexp '^sfid1\\.elemento_origen\\.[A-Za-z0-9_-]{21}[AQgw]$' and `ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_reservas_ocurrencias_consolidacion` CHECK (`secuencia_elemento` is null and `consolidada_en_utc` is null or `secuencia_elemento` is not null and `secuencia_elemento` >= 1 and `consolidada_en_utc` is not null and `consolidada_en_utc` >= `reservada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_reservas_ocurrencias_federacion_inmutables
BEFORE UPDATE ON reservas_identidad_ocurrencias_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.installation_origen_id = OLD.installation_origen_id
    AND NEW.familia = OLD.familia
    AND NEW.elemento_origen_id = OLD.elemento_origen_id
    AND NEW.ocurrencia_origen_id = OLD.ocurrencia_origen_id
    AND NEW.intencion_sha256 = OLD.intencion_sha256
    AND OLD.secuencia_elemento IS NULL
    AND NEW.secuencia_elemento IS NOT NULL
    AND OLD.consolidada_en_utc IS NULL
    AND NEW.consolidada_en_utc IS NOT NULL
    AND NEW.reservada_en_utc = OLD.reservada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La reserva causal solo puede consolidar una vez su secuencia.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservas_request_id_sesion_agentes` (
  `digest_request_id` binary(32) NOT NULL,
  PRIMARY KEY (`digest_request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `resincronizaciones_automaticas_federacion` (
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_predecesora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `causa` enum('timeout','apagado','confirmacionPerdida','huecoRecuperable','interrupcionRecuperable','incoherenciaRecuperable') NOT NULL,
  `detalle_canonico` longtext DEFAULT NULL CHECK (json_valid(`detalle_canonico`)),
  `estado` enum('preparada','transfiriendo','fronteraOperativaValidada','completa','promovida','fallida','cancelada') NOT NULL DEFAULT 'preparada',
  `intentos_solicitud` int(10) unsigned NOT NULL DEFAULT 1,
  `activa_unica` tinyint(4) GENERATED ALWAYS AS (if(`estado` in ('preparada','transfiriendo','fronteraOperativaValidada','completa'),1,NULL)) STORED,
  `solicitada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`generacion_id`),
  UNIQUE KEY `uk_resincronizacion_automatica_activa` (`flujo_id`,`activa_unica`),
  KEY `idx_resincronizacion_automatica_estado` (`estado`,`actualizada_en_utc`,`flujo_id`),
  KEY `fk_resincronizacion_automatica_generacion` (`flujo_id`,`generacion_id`),
  KEY `fk_resincronizacion_automatica_predecesora` (`flujo_id`,`generacion_predecesora_id`),
  CONSTRAINT `fk_resincronizacion_automatica_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_resincronizacion_automatica_predecesora` FOREIGN KEY (`flujo_id`, `generacion_predecesora_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `chk_resincronizacion_automatica_final` CHECK (`estado` in ('preparada','transfiriendo','fronteraOperativaValidada','completa') and `finalizada_en_utc` is null or `estado` in ('promovida','fallida','cancelada') and `finalizada_en_utc` is not null and `finalizada_en_utc` >= `solicitada_en_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_resincronizaciones_automaticas_transicion
BEFORE UPDATE ON resincronizaciones_automaticas_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.generacion_id=OLD.generacion_id
    AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_predecesora_id=OLD.generacion_predecesora_id
    AND NEW.causa=OLD.causa
    AND NEW.detalle_canonico<=>OLD.detalle_canonico
    AND NEW.intentos_solicitud>=OLD.intentos_solicitud
    AND NEW.solicitada_en_utc=OLD.solicitada_en_utc
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
    AND (
      NEW.estado=OLD.estado
      OR (OLD.estado='preparada' AND NEW.estado IN (
        'transfiriendo','fallida','cancelada'
      ))
      OR (OLD.estado='transfiriendo' AND NEW.estado IN (
        'fronteraOperativaValidada','completa','fallida','cancelada'
      ))
      OR (OLD.estado='fronteraOperativaValidada' AND NEW.estado IN (
        'completa','promovida','fallida','cancelada'
      ))
      OR (OLD.estado='completa' AND NEW.estado IN (
        'promovida','fallida','cancelada'
      ))
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La resincronizacion automatica viola su transicion monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `resultados_destinatarios_triggers_correo` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ejecucion_trigger_id` bigint(20) unsigned NOT NULL,
  `notificacion_trigger_correo_id` bigint(20) unsigned DEFAULT NULL,
  `clave_procedencia` binary(32) NOT NULL,
  `relacion_destinatario_id` bigint(20) unsigned DEFAULT NULL,
  `tipo` enum('manual','usuario') NOT NULL,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `usuario_id_fotografia` bigint(20) unsigned DEFAULT NULL,
  `email_manual` varchar(190) DEFAULT NULL,
  `email_manual_canonico` varchar(190) DEFAULT NULL,
  `normalizacion_buzon_version` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_observado` enum('activa') NOT NULL,
  `email_resuelto_canonico` varchar(190) DEFAULT NULL,
  `clave_buzon_sha256` binary(32) DEFAULT NULL,
  `codigo_inicial` enum('aceptado','usuario_inactivo','email_ausente','email_no_validado','email_invalido') NOT NULL,
  `salida_correo_id` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_resultados_correo_ejecucion_procedencia` (`ejecucion_trigger_id`,`clave_procedencia`),
  KEY `idx_resultados_correo_notificacion` (`notificacion_trigger_correo_id`,`ejecucion_trigger_id`,`id`),
  KEY `idx_resultados_correo_relacion` (`relacion_destinatario_id`,`id`),
  KEY `idx_resultados_correo_usuario` (`usuario_id`,`id`),
  KEY `idx_resultados_correo_salida` (`salida_correo_id`,`id`),
  CONSTRAINT `fk_resultados_correo_ejecucion` FOREIGN KEY (`ejecucion_trigger_id`) REFERENCES `ejecuciones_triggers` (`id`),
  CONSTRAINT `fk_resultados_correo_notificacion_ejecucion` FOREIGN KEY (`notificacion_trigger_correo_id`, `ejecucion_trigger_id`) REFERENCES `notificaciones_triggers_correo` (`id`, `ejecucion_trigger_id`),
  CONSTRAINT `fk_resultados_correo_relacion` FOREIGN KEY (`relacion_destinatario_id`) REFERENCES `destinatarios_triggers_correo` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_resultados_correo_salida` FOREIGN KEY (`salida_correo_id`) REFERENCES `cola_correos_salida` (`id`),
  CONSTRAINT `fk_resultados_correo_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_resultados_correo_procedencia` CHECK (`tipo` = 'usuario' and `usuario_id_fotografia` is not null and `email_manual` is null and `email_manual_canonico` is null or `tipo` = 'manual' and `usuario_id_fotografia` is null and `email_manual` is not null and `email_manual_canonico` is not null),
  CONSTRAINT `chk_resultados_correo_normalizacion` CHECK (`normalizacion_buzon_version` = 'buzon@1'),
  CONSTRAINT `chk_resultados_correo_aceptacion` CHECK (`codigo_inicial` = 'aceptado' and `notificacion_trigger_correo_id` is not null and `email_resuelto_canonico` is not null and `clave_buzon_sha256` is not null and `salida_correo_id` is not null or `codigo_inicial` <> 'aceptado' and `email_resuelto_canonico` is null and `clave_buzon_sha256` is null and `salida_correo_id` is null),
  CONSTRAINT `chk_resultados_correo_manual_resuelto` CHECK (`tipo` <> 'manual' or `codigo_inicial` <> 'aceptado' or `email_manual_canonico` = `email_resuelto_canonico`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `resultados_entregas_recepcion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `intento_id` bigint(20) unsigned NOT NULL,
  `lote_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clasificacion` enum('terminal','temporal') NOT NULL,
  `resultado` enum('aceptada','yaConocida','retiradaAceptada','salidaAceptada','descartadaPorRetencion','rechazadaDefinitiva','divergente','aplazadaCapacidad','aplazadaValidacion') NOT NULL,
  `error_terminal` enum('identidadNoVinculada','identidadDuplicada','retornoPropioIncompatible','credencialInvalida','credencialVencida','autoridadActualInsuficiente','concesionInexistente','concesionRevocada','scopeIncompatible','versionProtocoloIncompatible','versionFamiliaIncompatible','recorridoCiclicoDestino','ocurrenciaInvalida','divergenciaContenido','descarteRetencionDivergente','loteExcedeLimites','ocurrenciaExcedeLimite') DEFAULT NULL,
  `error_temporal` enum('desfaseTemporalNoTolerable','capacidadTemporalAgotada','dependenciaValidacionTemporal','relacionTemporalmenteDetenida') DEFAULT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned DEFAULT NULL,
  `confirmada` tinyint(1) NOT NULL,
  `reutilizado` tinyint(1) NOT NULL DEFAULT 0,
  `creado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_resultados_entrega_intento` (`intento_id`,`entrega_id`),
  KEY `idx_resultados_temporales` (`clasificacion`,`error_temporal`,`creado_en_utc`,`entrega_id`),
  KEY `fk_resultados_entrega_inbox` (`inbox_ocurrencia_id`),
  KEY `idx_resultados_entrega_historia` (`lote_id`,`entrega_id`,`id` DESC),
  KEY `fk_resultados_entrega_intento_lote` (`intento_id`,`lote_id`),
  CONSTRAINT `fk_resultados_entrega_composicion` FOREIGN KEY (`lote_id`, `entrega_id`) REFERENCES `composiciones_lotes_recepcion_federacion` (`lote_id`, `entrega_id`),
  CONSTRAINT `fk_resultados_entrega_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_resultados_entrega_intento_lote` FOREIGN KEY (`intento_id`, `lote_id`) REFERENCES `intentos_lotes_recepcion_federacion` (`id`, `lote_id`),
  CONSTRAINT `chk_resultados_entrega_clasificacion` CHECK (`clasificacion` = 'terminal' and `error_temporal` is null or `clasificacion` = 'temporal' and `error_terminal` is null and `error_temporal` is not null and `confirmada` = 0),
  CONSTRAINT `chk_resultados_entrega_confirmacion` CHECK (`confirmada` = 0 or `clasificacion` = 'terminal' and `resultado` in ('aceptada','yaConocida','retiradaAceptada','salidaAceptada','descartadaPorRetencion') and (`resultado` = 'descartadaPorRetencion' or `inbox_ocurrencia_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_resultados_entregas_recepcion_inmutables
BEFORE UPDATE ON resultados_entregas_recepcion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un resultado individual federado es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `retiradas_origen_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_retirada` bigint(20) unsigned NOT NULL,
  `relacion_observadora_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_observador_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_observadora_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`),
  KEY `idx_retiradas_origen_ocurrencia` (`ocurrencia_origen_id`),
  KEY `fk_retiradas_origen_relacion` (`relacion_observadora_id`),
  KEY `fk_retiradas_origen_generacion` (`flujo_observador_id`,`generacion_observadora_id`),
  CONSTRAINT `fk_retiradas_origen_generacion` FOREIGN KEY (`flujo_observador_id`, `generacion_observadora_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_retiradas_origen_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_retiradas_origen_relacion` FOREIGN KEY (`relacion_observadora_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_retiradas_origen_secuencia` CHECK (`secuencia_retirada` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_retiradas_origen_proyecciones_inmutables
BEFORE UPDATE ON retiradas_origen_proyecciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una retirada de origen federada es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `revisiones_concesion_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `revision_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `papel` enum('oferta','aceptacion','efectiva') NOT NULL,
  `procedencia` enum('local','remota','derivada') NOT NULL DEFAULT 'local',
  `installation_declarante_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `intercambio_origen_id` binary(16) DEFAULT NULL,
  `ordinal` int(10) unsigned NOT NULL,
  `estado` enum('propuesta','vigente','sustituida','reducida','cancelada','vacia') NOT NULL,
  `revision_oferta_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision_aceptacion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `seleccion` longtext NOT NULL CHECK (json_valid(`seleccion`)),
  `huella_seleccion` binary(32) NOT NULL,
  `autorizada_por_usuario_id` bigint(20) unsigned DEFAULT NULL,
  `version_autoridad` bigint(20) unsigned NOT NULL,
  `version_autoridad_remota` bigint(20) unsigned DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `vigente_desde_utc` datetime(3) DEFAULT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revisiones_concesion_identidad` (`revision_id`),
  UNIQUE KEY `uk_revisiones_concesion_evento` (`evento_auditoria_id`),
  UNIQUE KEY `uk_revisiones_concesion_relacion_identidad` (`relacion_id`,`revision_id`),
  UNIQUE KEY `uk_revisiones_concesion_ordinal` (`relacion_id`,`papel`,`version_autoridad`,`ordinal`),
  UNIQUE KEY `uk_revisiones_concesion_intercambio` (`intercambio_origen_id`),
  UNIQUE KEY `uk_revisiones_concesion_efectiva_fuentes` (`relacion_id`,`papel`,`revision_oferta_id`,`revision_aceptacion_id`,`version_autoridad`,`version_autoridad_remota`),
  KEY `idx_revisiones_concesion_estado` (`relacion_id`,`papel`,`estado`,`ordinal`),
  KEY `fk_revisiones_concesion_oferta` (`revision_oferta_id`),
  KEY `fk_revisiones_concesion_aceptacion` (`revision_aceptacion_id`),
  CONSTRAINT `fk_revisiones_concesion_aceptacion` FOREIGN KEY (`revision_aceptacion_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_revisiones_concesion_intercambio` FOREIGN KEY (`intercambio_origen_id`) REFERENCES `intercambios_declaraciones_concesion_federacion` (`intercambio_id`),
  CONSTRAINT `fk_revisiones_concesion_oferta` FOREIGN KEY (`revision_oferta_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `fk_revisiones_concesion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_revisiones_concesion_identidad` CHECK (`revision_id` regexp '^sfid1\\.revision_concesion\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_revisiones_concesion_forma` CHECK (`papel` in ('oferta','aceptacion') and `revision_oferta_id` is null and `revision_aceptacion_id` is null or `papel` = 'efectiva' and `revision_oferta_id` is not null and `revision_aceptacion_id` is not null),
  CONSTRAINT `chk_revisiones_concesion_estado` CHECK (`estado` = 'propuesta' and `vigente_desde_utc` is null and `finalizada_en_utc` is null or `estado` in ('vigente','vacia') and `vigente_desde_utc` is not null and `finalizada_en_utc` is null or `estado` in ('sustituida','reducida','cancelada') and `finalizada_en_utc` is not null),
  CONSTRAINT `chk_revisiones_concesion_contadores` CHECK (`ordinal` >= 1 and `version_autoridad` >= 1),
  CONSTRAINT `chk_revisiones_concesion_json` CHECK (json_valid(`seleccion`) and octet_length(cast(`seleccion` as char charset utf8mb4)) between 2 and 65535),
  CONSTRAINT `chk_revisiones_concesion_procedencia` CHECK (`procedencia` = 'local' and `papel` in ('oferta','aceptacion') and `autorizada_por_usuario_id` is not null and `installation_declarante_id` is null and `intercambio_origen_id` is null and `version_autoridad_remota` is null or `procedencia` = 'remota' and `papel` in ('oferta','aceptacion') and `autorizada_por_usuario_id` is null and `installation_declarante_id` is not null and `intercambio_origen_id` is not null and `version_autoridad_remota` is null or `procedencia` = 'derivada' and `papel` = 'efectiva' and `installation_declarante_id` is null and `intercambio_origen_id` is null and `version_autoridad_remota` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_revisiones_concesion_inmutables
BEFORE UPDATE ON revisiones_concesion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.revision_id <=> NEW.revision_id AND OLD.relacion_id <=> NEW.relacion_id
    AND OLD.papel <=> NEW.papel AND OLD.procedencia <=> NEW.procedencia
    AND OLD.installation_declarante_id <=> NEW.installation_declarante_id
    AND OLD.intercambio_origen_id <=> NEW.intercambio_origen_id
    AND OLD.ordinal <=> NEW.ordinal
    AND OLD.revision_oferta_id <=> NEW.revision_oferta_id
    AND OLD.revision_aceptacion_id <=> NEW.revision_aceptacion_id
    AND OLD.seleccion <=> NEW.seleccion AND OLD.huella_seleccion <=> NEW.huella_seleccion
    AND OLD.autorizada_por_usuario_id <=> NEW.autorizada_por_usuario_id
    AND OLD.version_autoridad <=> NEW.version_autoridad
    AND OLD.version_autoridad_remota <=> NEW.version_autoridad_remota
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
    AND OLD.vigente_desde_utc <=> NEW.vigente_desde_utc
    AND OLD.evento_auditoria_id <=> NEW.evento_auditoria_id
    AND OLD.correlacion_id <=> NEW.correlacion_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La revision de concesion es inmutable.';
  END IF;
  IF OLD.estado NOT IN ('propuesta','vigente','vacia')
     OR NEW.estado NOT IN ('sustituida','reducida','cancelada')
     OR NEW.finalizada_en_utc IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Transicion de revision de concesion no permitida.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `revisiones_reglas_derivacion_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `regla_id` bigint(20) unsigned NOT NULL,
  `numero` int(10) unsigned NOT NULL,
  `condicion_tipo` enum('numero','booleano','estado','texto','calidad','duracion','momento_utc','texto_regex','momento_utc_relativo') NOT NULL,
  `condicion_version` int(10) unsigned NOT NULL DEFAULT 1,
  `condicion_canonica` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`condicion_canonica`)),
  `severidad_calculada` varchar(32) NOT NULL,
  `mensaje_operativo` varchar(512) NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `descripcion` varchar(512) DEFAULT NULL,
  `metadatos_descriptivos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadatos_descriptivos`)),
  `vigente_desde_utc` datetime(6) NOT NULL,
  `vigente_hasta_utc` datetime(6) DEFAULT NULL,
  `regla_abierta_id` bigint(20) unsigned GENERATED ALWAYS AS (case when `vigente_hasta_utc` is null then `regla_id` else NULL end) STORED,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_revisiones_derivacion_regla_numero` (`regla_id`,`numero`),
  UNIQUE KEY `uk_revisiones_derivacion_regla_id` (`regla_id`,`id`),
  UNIQUE KEY `uk_revisiones_derivacion_una_abierta` (`regla_abierta_id`),
  KEY `idx_revisiones_derivacion_vigencia` (`regla_id`,`vigente_desde_utc`,`vigente_hasta_utc`,`id`),
  KEY `idx_revisiones_derivacion_tipo` (`condicion_tipo`,`id`),
  CONSTRAINT `fk_revisiones_derivacion_regla` FOREIGN KEY (`regla_id`) REFERENCES `reglas_derivacion_telemetria` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_revisiones_derivacion_intervalo` CHECK (`vigente_hasta_utc` is null or `vigente_hasta_utc` > `vigente_desde_utc`),
  CONSTRAINT `chk_revisiones_derivacion_condicion_tamano` CHECK (char_length(cast(`condicion_canonica` as char charset utf8mb4)) <= 4096),
  CONSTRAINT `chk_revisiones_derivacion_metadatos_tamano` CHECK (`metadatos_descriptivos` is null or char_length(cast(`metadatos_descriptivos` as char charset utf8mb4)) <= 4096)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salidas_concesion_federacion` (
  `salida_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `corte_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `campos_retirados_canonicos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`campos_retirados_canonicos`)),
  `estado` enum('pendienteEmision','pendienteRefederacion','aplicadaRecepcion') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`salida_id`),
  KEY `idx_salidas_concesion_corte` (`corte_id`,`estado`,`salida_id`),
  KEY `idx_salidas_concesion_proyeccion` (`proyeccion_id`,`contribucion_id`),
  KEY `fk_salidas_concesion_flujo` (`flujo_id`),
  KEY `fk_salidas_concesion_contribucion` (`contribucion_id`),
  CONSTRAINT `fk_salidas_concesion_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_salidas_concesion_corte` FOREIGN KEY (`corte_id`) REFERENCES `cortes_datos_concesion_federacion` (`corte_id`),
  CONSTRAINT `fk_salidas_concesion_flujo` FOREIGN KEY (`flujo_id`) REFERENCES `flujos_federacion` (`flujo_id`),
  CONSTRAINT `fk_salidas_concesion_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_salidas_concesion_identidad` CHECK (`salida_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_salidas_concesion_forma` CHECK (json_valid(`campos_retirados_canonicos`) and (`estado` = 'pendienteEmision' and `proyeccion_id` is null and `contribucion_id` is null and `elemento_origen_id` is not null or `estado` in ('aplicadaRecepcion','pendienteRefederacion') and `proyeccion_id` is not null and `contribucion_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_salidas_concesion_inmutables
BEFORE UPDATE ON salidas_concesion_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una salida por concesion es evidencia inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `salidas_contribuciones_federacion` (
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_salida` bigint(20) unsigned NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`contribucion_id`),
  KEY `idx_salidas_contribuciones_ocurrencia` (`ocurrencia_origen_id`),
  CONSTRAINT `fk_salidas_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `chk_salidas_contribuciones_secuencia` CHECK (`secuencia_salida` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_salidas_contribuciones_inmutables
BEFORE UPDATE ON salidas_contribuciones_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una salida de contribucion federada es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `secretos_conflictos_inbox_federacion` (
  `conflicto_inbox_id` bigint(20) unsigned NOT NULL,
  `perfil` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `keyring_referencia` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `key_id` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nonce` varbinary(32) NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `auth_tag` varbinary(32) NOT NULL,
  `contenido_sha256` binary(32) NOT NULL,
  `creado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`conflicto_inbox_id`),
  CONSTRAINT `fk_secretos_conflictos_inbox` FOREIGN KEY (`conflicto_inbox_id`) REFERENCES `conflictos_contenido_inbox_federacion` (`id`),
  CONSTRAINT `chk_secretos_conflictos_sobre` CHECK (octet_length(`nonce`) = 12 and octet_length(`ciphertext`) >= 1 and octet_length(`auth_tag`) = 16)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `secretos_inbox_federacion` (
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `perfil` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `keyring_referencia` varchar(191) NOT NULL,
  `key_id` varchar(191) NOT NULL,
  `nonce` binary(12) NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `auth_tag` binary(16) NOT NULL,
  `contenido_sha256` binary(32) NOT NULL,
  `creado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_secretos_inbox_ocurrencia` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_secretos_inbox_contenido` CHECK (octet_length(`ciphertext`) between 1 and 2097152)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_secretos_inbox_federacion_inmutables
BEFORE UPDATE ON secretos_inbox_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El sobre sensible federado es inmutable; solo puede purgarse.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `secretos_ocurrencias_federacion` (
  `ocurrencia_id` bigint(20) unsigned NOT NULL,
  `perfil` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `keyring_referencia` varchar(191) NOT NULL,
  `key_id` varchar(191) NOT NULL,
  `nonce` binary(12) NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `auth_tag` binary(16) NOT NULL,
  `contenido_sha256` binary(32) NOT NULL,
  `creado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`ocurrencia_id`),
  CONSTRAINT `fk_secretos_ocurrencias_federacion_ocurrencia` FOREIGN KEY (`ocurrencia_id`) REFERENCES `ocurrencias_federacion` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_secretos_ocurrencias_federacion_contenido` CHECK (octet_length(`ciphertext`) between 1 and 2097152)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_secretos_ocurrencias_federacion_inmutables
BEFORE UPDATE ON secretos_ocurrencias_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'El sobre sensible de emision es inmutable; solo puede purgarse.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `selectores_revision_concesion_federacion` (
  `revision_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `niveles_scope` longtext NOT NULL CHECK (json_valid(`niveles_scope`)),
  `campos` longtext NOT NULL CHECK (json_valid(`campos`)),
  `permite_contenido_sensible` tinyint(1) NOT NULL,
  `permite_refederacion` tinyint(1) NOT NULL,
  PRIMARY KEY (`revision_id`,`familia`),
  KEY `idx_selectores_concesion_familia` (`familia`,`revision_id`),
  CONSTRAINT `fk_selectores_concesion_revision` FOREIGN KEY (`revision_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`),
  CONSTRAINT `chk_selectores_concesion_json` CHECK (json_valid(`niveles_scope`) and json_valid(`campos`) and json_type(`niveles_scope`) = 'ARRAY' and json_type(`campos`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_selectores_concesion_inmutables
BEFORE UPDATE ON selectores_revision_concesion_federacion
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los selectores de concesion son inmutables.' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `senales_telemetria_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `categoria` varchar(64) NOT NULL,
  `clave` varchar(128) NOT NULL,
  `tag` varchar(128) NOT NULL DEFAULT '',
  `codigo_senal` varchar(384) NOT NULL,
  `tipo_dato` enum('numero','booleano','texto','estado','json','duracion','momento_utc') NOT NULL,
  `unidad` varchar(32) NOT NULL DEFAULT '',
  `nombre_humano` varchar(128) NOT NULL DEFAULT '',
  `descripcion` varchar(512) NOT NULL DEFAULT '',
  `metadatos_descriptivos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadatos_descriptivos`)),
  `consolidada_en_utc` datetime NOT NULL DEFAULT current_timestamp(),
  `ultima_declaracion_utc` datetime DEFAULT NULL,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_senales_telemetria_agente_identidad` (`agente_id`,`categoria`,`clave`,`tag`),
  UNIQUE KEY `uk_senales_telemetria_id_agente` (`id`,`agente_id`),
  KEY `idx_senales_telemetria_agente_codigo` (`agente_id`,`codigo_senal`),
  KEY `idx_senales_telemetria_codigo` (`categoria`,`clave`,`tag`),
  KEY `idx_senales_telemetria_tipo` (`tipo_dato`,`unidad`,`id`),
  CONSTRAINT `fk_senales_telemetria_agente` FOREIGN KEY (`agente_id`) REFERENCES `agentes_sentinelia` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_senales_telemetria_metadatos_tamano` CHECK (`metadatos_descriptivos` is null or char_length(cast(`metadatos_descriptivos` as char charset utf8mb4)) <= 2048)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones_web_auditoria` (
  `sesion_auditoria_id` binary(16) NOT NULL,
  `usuario_real_id` bigint(20) unsigned NOT NULL,
  `usuario_efectivo_id` bigint(20) unsigned NOT NULL,
  `version_sesion_real` int(10) unsigned NOT NULL,
  `version_sesion_efectiva` int(10) unsigned NOT NULL,
  `apertura_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `apertura_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `apertura_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `efectivo_tenant_id` bigint(20) unsigned DEFAULT NULL,
  `efectivo_empresa_id` bigint(20) unsigned DEFAULT NULL,
  `efectivo_sitio_id` bigint(20) unsigned DEFAULT NULL,
  `evento_impersonacion_iniciada_id` binary(16) DEFAULT NULL,
  `estado` enum('abierta','cerrada','invalidada') NOT NULL,
  `expira_en_utc` datetime(3) NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `renovada_en_utc` datetime(3) NOT NULL,
  `cerrada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`sesion_auditoria_id`),
  KEY `idx_sesiones_web_usuario_real_vigencia` (`usuario_real_id`,`estado`,`expira_en_utc`,`sesion_auditoria_id`),
  KEY `idx_sesiones_web_usuario_efectivo_vigencia` (`usuario_efectivo_id`,`estado`,`expira_en_utc`,`sesion_auditoria_id`),
  KEY `idx_sesiones_web_estado_expiracion` (`estado`,`expira_en_utc`,`sesion_auditoria_id`),
  KEY `idx_sesiones_web_evento_impersonacion` (`evento_impersonacion_iniciada_id`),
  KEY `idx_sesiones_web_cierre` (`estado`,`cerrada_en_utc`,`sesion_auditoria_id`),
  CONSTRAINT `chk_sesiones_web_versiones` CHECK (`version_sesion_real` > 0 and `version_sesion_efectiva` > 0),
  CONSTRAINT `chk_sesiones_web_scope_apertura` CHECK (`apertura_tenant_id` is null and `apertura_empresa_id` is null and `apertura_sitio_id` is null or `apertura_tenant_id` is not null and (`apertura_empresa_id` is not null or `apertura_sitio_id` is null)),
  CONSTRAINT `chk_sesiones_web_scope_efectivo` CHECK (`efectivo_tenant_id` is null and `efectivo_empresa_id` is null and `efectivo_sitio_id` is null or `efectivo_tenant_id` is not null and (`efectivo_empresa_id` is not null or `efectivo_sitio_id` is null)),
  CONSTRAINT `chk_sesiones_web_directa` CHECK (`usuario_real_id` <> `usuario_efectivo_id` or `version_sesion_real` = `version_sesion_efectiva` and `apertura_tenant_id` <=> `efectivo_tenant_id` and `apertura_empresa_id` <=> `efectivo_empresa_id` and `apertura_sitio_id` <=> `efectivo_sitio_id` and `evento_impersonacion_iniciada_id` is null),
  CONSTRAINT `chk_sesiones_web_impersonacion_abierta` CHECK (`estado` <> 'abierta' or `usuario_real_id` = `usuario_efectivo_id` and `evento_impersonacion_iniciada_id` is null or `usuario_real_id` <> `usuario_efectivo_id` and `evento_impersonacion_iniciada_id` is not null),
  CONSTRAINT `chk_sesiones_web_marcas` CHECK (`creada_en_utc` <= `renovada_en_utc` and `renovada_en_utc` < `expira_en_utc` and (`estado` = 'abierta' and `cerrada_en_utc` is null or `estado` in ('cerrada','invalidada') and `cerrada_en_utc` is not null and `cerrada_en_utc` >= `creada_en_utc` and `evento_impersonacion_iniciada_id` is null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_sesiones_web_auditoria_proteger_update
BEFORE UPDATE ON sesiones_web_auditoria
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.sesion_auditoria_id <=> NEW.sesion_auditoria_id
    AND OLD.usuario_real_id <=> NEW.usuario_real_id
    AND OLD.apertura_tenant_id <=> NEW.apertura_tenant_id
    AND OLD.apertura_empresa_id <=> NEW.apertura_empresa_id
    AND OLD.apertura_sitio_id <=> NEW.apertura_sitio_id
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y el scope de apertura de la sesión web son inmutables';
  END IF;

  IF NOT (
    (OLD.estado = 'abierta' AND NEW.estado IN ('abierta', 'cerrada', 'invalidada'))
    OR (OLD.estado = 'cerrada' AND NEW.estado = 'cerrada')
    OR (OLD.estado = 'invalidada' AND NEW.estado = 'invalidada')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición de estado de la sesión web no está permitida';
  END IF;

  IF OLD.estado <> 'abierta' AND NOT (
    OLD.usuario_efectivo_id <=> NEW.usuario_efectivo_id
    AND OLD.version_sesion_real <=> NEW.version_sesion_real
    AND OLD.version_sesion_efectiva <=> NEW.version_sesion_efectiva
    AND OLD.efectivo_tenant_id <=> NEW.efectivo_tenant_id
    AND OLD.efectivo_empresa_id <=> NEW.efectivo_empresa_id
    AND OLD.efectivo_sitio_id <=> NEW.efectivo_sitio_id
    AND OLD.evento_impersonacion_iniciada_id <=> NEW.evento_impersonacion_iniciada_id
    AND OLD.expira_en_utc <=> NEW.expira_en_utc
    AND OLD.renovada_en_utc <=> NEW.renovada_en_utc
    AND OLD.cerrada_en_utc <=> NEW.cerrada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una sesión web terminal no puede modificarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_sesiones_web_auditoria_proteger_delete
BEFORE DELETE ON sesiones_web_auditoria
FOR EACH ROW
BEGIN
  IF OLD.estado = 'abierta' AND OLD.expira_en_utc > UTC_TIMESTAMP(3) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una sesión web abierta y vigente no puede eliminarse';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sitios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `nombre` varchar(160) NOT NULL,
  `alias` varchar(120) NOT NULL,
  `timezone` varchar(80) NOT NULL DEFAULT 'UTC',
  `descripcion` varchar(255) DEFAULT NULL,
  `estado` varchar(32) NOT NULL DEFAULT 'activo',
  `configuracion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sitios_empresa_alias` (`empresa_id`,`alias`),
  UNIQUE KEY `uk_sitios_id_empresa_tenant` (`id`,`empresa_id`,`tenant_id`),
  KEY `idx_sitios_tenant` (`tenant_id`),
  KEY `idx_sitios_empresa` (`empresa_id`),
  KEY `idx_sitios_estado` (`estado`),
  KEY `fk_sitios_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `idx_sitios_empresa_nombre_id` (`empresa_id`,`nombre`,`id`),
  CONSTRAINT `fk_sitios_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sitios_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sitios_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `solicitudes_ddns_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `solicitud_id` binary(16) NOT NULL,
  `agente_id_fotografia` bigint(20) unsigned NOT NULL,
  `concesion_interna_id` bigint(20) unsigned NOT NULL,
  `cuerpo_canonico_sha256` binary(32) NOT NULL,
  `intencion_interna_id` bigint(20) unsigned DEFAULT NULL,
  `resultado` enum('aceptada','repetida','convergente','sin_cambios') NOT NULL,
  `estado_http` smallint(5) unsigned NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_solicitudes_ddns_agente_id` (`agente_id_fotografia`,`solicitud_id`),
  KEY `idx_solicitudes_ddns_concesion` (`concesion_interna_id`,`creada_en_utc`,`id`),
  KEY `idx_solicitudes_ddns_intencion` (`intencion_interna_id`),
  CONSTRAINT `fk_solicitudes_ddns_concesion` FOREIGN KEY (`concesion_interna_id`) REFERENCES `concesiones_ddns_agentes` (`id`),
  CONSTRAINT `fk_solicitudes_ddns_intencion` FOREIGN KEY (`intencion_interna_id`) REFERENCES `intenciones_ddns_agentes` (`id`),
  CONSTRAINT `chk_solicitudes_ddns_uuidv7` CHECK (substr(hex(`solicitud_id`),13,1) = '7' and substr(hex(`solicitud_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_solicitudes_ddns_resultado` CHECK (`agente_id_fotografia` > 0 and (`resultado` = 'aceptada' and `estado_http` = 202 and `intencion_interna_id` is not null or `resultado` in ('repetida','convergente','sin_cambios') and `estado_http` = 200 and `intencion_interna_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `soportes_campos_contribuciones_federacion` (
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nombre_sha256` binary(32) NOT NULL,
  `nombre_campo` mediumtext NOT NULL,
  `estado` enum('activo','retirado') NOT NULL,
  `declaracion_campo_id` bigint(20) unsigned NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `primera_aportacion_utc` datetime(3) NOT NULL,
  `ultima_actualizacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`contribucion_id`,`generacion_id`,`nombre_sha256`),
  KEY `idx_soportes_campos_declaracion` (`declaracion_campo_id`,`contribucion_id`),
  KEY `idx_soportes_campos_inbox` (`inbox_ocurrencia_id`,`contribucion_id`),
  KEY `idx_soportes_campos_generacion` (`generacion_id`,`contribucion_id`,`estado`),
  CONSTRAINT `fk_soportes_campos_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_soportes_campos_declaracion` FOREIGN KEY (`declaracion_campo_id`) REFERENCES `declaraciones_campos_inbox_federacion` (`id`),
  CONSTRAINT `fk_soportes_campos_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_soportes_campos_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `chk_soportes_campos_nombre` CHECK (octet_length(`nombre_campo`) between 1 and 2097152),
  CONSTRAINT `chk_soportes_campos_secuencia` CHECK (`secuencia_elemento` >= 1),
  CONSTRAINT `chk_soportes_campos_cronologia` CHECK (`ultima_actualizacion_utc` >= `primera_aportacion_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_soportes_campos_insercion
BEFORE INSERT ON soportes_campos_contribuciones_federacion
FOR EACH ROW
BEGIN
  DECLARE estado_contribucion_actual VARCHAR(16);
  DECLARE aporte_compatible BIGINT;
  DECLARE declaracion_compatible BIGINT;

  SELECT estado_soporte INTO estado_contribucion_actual
    FROM contribuciones_proyecciones_federacion
   WHERE contribucion_id=NEW.contribucion_id;
  SELECT COUNT(*) INTO aporte_compatible
    FROM aportes_ocurrencias_contribuciones_federacion
   WHERE contribucion_id=NEW.contribucion_id
     AND inbox_ocurrencia_id=NEW.inbox_ocurrencia_id
     AND generacion_id=NEW.generacion_id;
  SELECT COUNT(*) INTO declaracion_compatible
    FROM declaraciones_campos_inbox_federacion
   WHERE id=NEW.declaracion_campo_id
     AND inbox_ocurrencia_id=NEW.inbox_ocurrencia_id
     AND nombre_sha256=NEW.nombre_sha256
     AND nombre_campo=NEW.nombre_campo;

  IF estado_contribucion_actual<>'activa' OR aporte_compatible<>1
      OR declaracion_compatible<>1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El soporte nuevo no posee una contribucion y aporte activos.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_soportes_campos_transicion
BEFORE UPDATE ON soportes_campos_contribuciones_federacion
FOR EACH ROW
BEGIN
  DECLARE estado_contribucion_actual VARCHAR(16);
  DECLARE aporte_compatible BIGINT;
  DECLARE declaracion_compatible BIGINT;

  SELECT estado_soporte INTO estado_contribucion_actual
    FROM contribuciones_proyecciones_federacion
   WHERE contribucion_id=NEW.contribucion_id;
  SELECT COUNT(*) INTO aporte_compatible
    FROM aportes_ocurrencias_contribuciones_federacion
   WHERE contribucion_id=NEW.contribucion_id
     AND inbox_ocurrencia_id=NEW.inbox_ocurrencia_id
     AND generacion_id=NEW.generacion_id;
  SELECT COUNT(*) INTO declaracion_compatible
    FROM declaraciones_campos_inbox_federacion
   WHERE id=NEW.declaracion_campo_id
     AND inbox_ocurrencia_id=NEW.inbox_ocurrencia_id
     AND nombre_sha256=NEW.nombre_sha256
     AND nombre_campo=NEW.nombre_campo;

  IF NOT (
    NEW.contribucion_id=OLD.contribucion_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.nombre_sha256=OLD.nombre_sha256
    AND NEW.nombre_campo=OLD.nombre_campo
    AND NEW.secuencia_elemento>=OLD.secuencia_elemento
    AND NEW.primera_aportacion_utc=OLD.primera_aportacion_utc
    AND NEW.ultima_actualizacion_utc>=OLD.ultima_actualizacion_utc
    AND aporte_compatible=1
    AND declaracion_compatible=1
    AND (NEW.estado<>'activo' OR estado_contribucion_actual='activa')
    AND (
      NEW.secuencia_elemento>OLD.secuencia_elemento
      OR (
        NEW.declaracion_campo_id=OLD.declaracion_campo_id
        AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
        AND (
          NEW.estado=OLD.estado
          OR (
            OLD.estado='activo' AND NEW.estado='retirado'
            AND estado_contribucion_actual='retirada'
          )
        )
      )
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El soporte generacional de un campo viola su transicion.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(160) NOT NULL,
  `alias` varchar(120) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `estado` varchar(32) NOT NULL DEFAULT 'activo',
  `configuracion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion`)),
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenants_alias` (`alias`),
  KEY `idx_tenants_estado` (`estado`),
  KEY `idx_tenants_nombre_id` (`nombre`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tombstones_elementos_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_retirada` bigint(20) unsigned NOT NULL,
  `operacion` enum('retirada','salidaProyeccion') NOT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`,`flujo_id`,`generacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`),
  KEY `idx_tombstones_elemento_entre_generaciones` (`relacion_id`,`flujo_id`,`installation_origen_id`,`familia`,`elemento_origen_id`,`secuencia_retirada`,`generacion_id`),
  CONSTRAINT `fk_tombstones_federacion_watermark` FOREIGN KEY (`relacion_id`, `flujo_id`, `generacion_id`, `installation_origen_id`, `familia`, `elemento_origen_id`) REFERENCES `watermarks_elementos_federacion` (`relacion_id`, `flujo_id`, `generacion_id`, `installation_origen_id`, `familia`, `elemento_origen_id`),
  CONSTRAINT `chk_tombstones_federacion_secuencia` CHECK (`secuencia_retirada` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_tombstones_elementos_federacion_inmutables
BEFORE UPDATE ON tombstones_elementos_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Un tombstone federado es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tombstones_identidad_auditoria` (
  `huella_evento_id` binary(32) NOT NULL,
  PRIMARY KEY (`huella_evento_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tombstones_relaciones_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_remota_id` char(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `direccion` enum('emision','recepcion') NOT NULL,
  `version_autoridad_final` bigint(20) unsigned NOT NULL,
  `eliminada_en_utc` datetime(3) NOT NULL,
  `eliminada_por_usuario_id` bigint(20) unsigned NOT NULL,
  `evento_auditoria_id` binary(16) NOT NULL,
  `correlacion_id` binary(16) NOT NULL,
  PRIMARY KEY (`relacion_id`),
  UNIQUE KEY `uk_tombstones_relaciones_evento` (`evento_auditoria_id`),
  KEY `idx_tombstones_relaciones_contraparte` (`installation_remota_id`,`direccion`,`eliminada_en_utc`),
  CONSTRAINT `fk_tombstones_relaciones_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_tombstones_relaciones_version` CHECK (`version_autoridad_final` >= 2),
  CONSTRAINT `chk_tombstones_relaciones_uuidv7` CHECK (substr(hex(`evento_auditoria_id`),13,1) = '7' and substr(hex(`evento_auditoria_id`),17,1) in ('8','9','A','B') and substr(hex(`correlacion_id`),13,1) = '7' and substr(hex(`correlacion_id`),17,1) in ('8','9','A','B'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_tombstones_relaciones_inmutables
BEFORE UPDATE ON tombstones_relaciones_federacion
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El tombstone de relacion es inmutable.' */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `trabajos_evaluacion_telemetria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `observacion_id` bigint(20) unsigned NOT NULL,
  `regla_id` bigint(20) unsigned NOT NULL,
  `regla_revision_id` bigint(20) unsigned NOT NULL,
  `agente_id` bigint(20) unsigned NOT NULL,
  `senal_id` bigint(20) unsigned NOT NULL,
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `causa` enum('observacion','vencimiento_temporal','reconciliacion_administrativa','reconciliacion_reloj') NOT NULL DEFAULT 'observacion',
  `generacion_autoridad` bigint(20) unsigned NOT NULL DEFAULT 1,
  `generacion_correccion` bigint(20) unsigned DEFAULT NULL,
  `recibido_en_utc` datetime(6) NOT NULL,
  `programado_para_utc` datetime(6) DEFAULT NULL,
  `clave_causal_canonica` varchar(768) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
  `huella_causal_sha256` binary(32) NOT NULL DEFAULT '\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0',
  `estado` enum('pendiente','procesando','completado','error','neutralizado') NOT NULL DEFAULT 'pendiente',
  `intentos` int(10) unsigned NOT NULL DEFAULT 0,
  `siguiente_intento_utc` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `reclamado_por` varchar(160) DEFAULT NULL,
  `reclamado_en_utc` datetime(6) DEFAULT NULL,
  `reclamo_expira_en_utc` datetime(6) DEFAULT NULL,
  `ultimo_codigo_error` varchar(80) DEFAULT NULL,
  `ultimo_mensaje_error` varchar(1024) DEFAULT NULL,
  `motivo_neutralizacion` enum('regla_deshabilitada','generacion_sustituida','revision_sustituida','observacion_sustituida') DEFAULT NULL,
  `completado_en_utc` datetime(6) DEFAULT NULL,
  `creado_en_utc` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_trabajos_evaluacion_huella_causal` (`huella_causal_sha256`),
  KEY `idx_trabajos_evaluacion_pendientes` (`estado`,`siguiente_intento_utc`,`id`),
  KEY `idx_trabajos_evaluacion_reclamos` (`estado`,`reclamo_expira_en_utc`,`id`),
  KEY `idx_trabajos_evaluacion_regla_contexto` (`regla_id`,`agente_id`,`senal_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_trabajos_evaluacion_revision` (`regla_id`,`regla_revision_id`),
  KEY `idx_trabajos_evaluacion_observacion` (`observacion_id`,`agente_id`,`senal_id`),
  KEY `idx_trabajos_evaluacion_programados` (`estado`,`programado_para_utc`,`id`),
  KEY `idx_trabajos_evaluacion_autoridad` (`regla_id`,`generacion_autoridad`,`regla_revision_id`,`observacion_id`,`id`),
  KEY `idx_trabajos_evaluacion_correccion` (`generacion_correccion`,`regla_id`,`id`),
  CONSTRAINT `fk_trabajos_evaluacion_observacion` FOREIGN KEY (`observacion_id`, `agente_id`, `senal_id`) REFERENCES `observaciones_telemetria_agentes` (`id`, `agente_id`, `senal_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trabajos_evaluacion_regla_contexto` FOREIGN KEY (`regla_id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `reglas_derivacion_telemetria` (`id`, `agente_id`, `senal_id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trabajos_evaluacion_revision` FOREIGN KEY (`regla_id`, `regla_revision_id`) REFERENCES `revisiones_reglas_derivacion_telemetria` (`regla_id`, `id`) ON DELETE CASCADE,
  CONSTRAINT `chk_trabajos_evaluacion_error` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null),
  CONSTRAINT `chk_trabajos_evaluacion_reclamo` CHECK (`reclamado_por` is null and `reclamado_en_utc` is null and `reclamo_expira_en_utc` is null or `reclamado_por` is not null and `reclamado_en_utc` is not null and `reclamo_expira_en_utc` is not null and `reclamo_expira_en_utc` > `reclamado_en_utc`),
  CONSTRAINT `chk_trabajos_evaluacion_generacion_autoridad` CHECK (`generacion_autoridad` > 0),
  CONSTRAINT `chk_trabajos_evaluacion_programacion` CHECK (`causa` = 'vencimiento_temporal' and `programado_para_utc` is not null or `causa` <> 'vencimiento_temporal' and `programado_para_utc` is null),
  CONSTRAINT `chk_trabajos_evaluacion_neutralizacion` CHECK (`estado` = 'neutralizado' and `motivo_neutralizacion` is not null and `completado_en_utc` is not null or `estado` <> 'neutralizado' and `motivo_neutralizacion` is null),
  CONSTRAINT `chk_trabajos_evaluacion_correccion` CHECK (`causa` = 'reconciliacion_reloj' and `generacion_correccion` is not null and `generacion_correccion` > 0 or `causa` <> 'reconciliacion_reloj' and `generacion_correccion` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_trabajos_evaluacion_causal_legacy
BEFORE INSERT ON trabajos_evaluacion_telemetria
FOR EACH ROW
BEGIN
  IF NEW.clave_causal_canonica = '' THEN
    SET NEW.clave_causal_canonica = CONCAT(
      'evaluacion_telemetria@1|causa=', NEW.causa,
      '|regla=', NEW.regla_id,
      '|generacion=', NEW.generacion_autoridad,
      '|revision=', NEW.regla_revision_id,
      '|observacion=', NEW.observacion_id,
      CASE
        WHEN NEW.programado_para_utc IS NULL THEN ''
        ELSE CONCAT('|programado=', DATE_FORMAT(NEW.programado_para_utc, '%Y-%m-%dT%H:%i:%s.%fZ'))
      END
    );
  END IF;
  IF NEW.huella_causal_sha256 = REPEAT(CHAR(0), 32) THEN
    SET NEW.huella_causal_sha256 = UNHEX(SHA2(NEW.clave_causal_canonica, 256));
  END IF;
  IF NEW.huella_causal_sha256 <> UNHEX(SHA2(NEW.clave_causal_canonica, 256)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La huella causal no corresponde a su representación canónica';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `trabajos_materializacion_federacion` (
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `contribucion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `clase_trabajo` enum('aplicacion','consolidacion') NOT NULL DEFAULT 'aplicacion',
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `posicion_flujo` bigint(20) unsigned NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `operacion` enum('actualizacion','retirada','salidaProyeccion') NOT NULL,
  `prioridad` enum('operativaActual','reconstruccion') NOT NULL,
  `estado` enum('pendiente','procesando','materializada','fallida','bloqueada','suprimida') NOT NULL DEFAULT 'pendiente',
  `causa_supresion` enum('ninguna','tombstoneVigente','retiradaOrigen','salidaProyeccion','generacionSustituida','salidaConcesion','sinAutoridad','relacionDeshabilitada','relacionEliminada') NOT NULL DEFAULT 'ninguna',
  `intentos` int(10) unsigned NOT NULL DEFAULT 0,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `propietario_lease` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_hasta_utc` datetime(3) DEFAULT NULL,
  `disponible_desde_utc` datetime(3) NOT NULL,
  `ultimo_error_codigo` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `creado_en_utc` datetime(3) NOT NULL,
  `actualizado_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`entrega_id`),
  UNIQUE KEY `uk_trabajos_materializacion_posicion` (`flujo_id`,`generacion_id`,`posicion_flujo`),
  KEY `idx_trabajos_materializacion_reclamacion` (`estado`,`disponible_desde_utc`,`prioridad`,`lease_hasta_utc`,`entrega_id`),
  KEY `fk_trabajos_materializacion_inbox` (`inbox_ocurrencia_id`),
  KEY `fk_trabajos_materializacion_watermark` (`relacion_id`,`flujo_id`,`generacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`),
  KEY `idx_trabajos_materializacion_contribucion` (`contribucion_id`,`estado`,`secuencia_elemento`),
  KEY `idx_trabajos_materializacion_proyeccion` (`proyeccion_id`,`estado`,`secuencia_elemento`),
  CONSTRAINT `fk_trabajos_materializacion_contribucion` FOREIGN KEY (`contribucion_id`) REFERENCES `contribuciones_proyecciones_federacion` (`contribucion_id`),
  CONSTRAINT `fk_trabajos_materializacion_entrega` FOREIGN KEY (`entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_trabajos_materializacion_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_trabajos_materializacion_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_trabajos_materializacion_watermark` FOREIGN KEY (`relacion_id`, `flujo_id`, `generacion_id`, `installation_origen_id`, `familia`, `elemento_origen_id`) REFERENCES `watermarks_elementos_federacion` (`relacion_id`, `flujo_id`, `generacion_id`, `installation_origen_id`, `familia`, `elemento_origen_id`),
  CONSTRAINT `chk_trabajos_materializacion_estado` CHECK (`posicion_flujo` >= 1 and `secuencia_elemento` >= 1 and `intentos` >= 0 and (`estado` = 'suprimida' and `causa_supresion` <> 'ninguna' or `estado` <> 'suprimida' and `causa_supresion` = 'ninguna') and (`estado` = 'procesando' and `propietario_lease` is not null and `lease_hasta_utc` is not null or `estado` <> 'procesando' and `propietario_lease` is null and `lease_hasta_utc` is null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_trabajos_materializacion_identidad_inmutable
BEFORE UPDATE ON trabajos_materializacion_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.entrega_id=OLD.entrega_id
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.relacion_id=OLD.relacion_id
    AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.posicion_flujo=OLD.posicion_flujo
    AND NEW.installation_origen_id=OLD.installation_origen_id
    AND NEW.familia=OLD.familia
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.ocurrencia_origen_id=OLD.ocurrencia_origen_id
    AND NEW.secuencia_elemento=OLD.secuencia_elemento
    AND NEW.operacion=OLD.operacion
    AND NEW.prioridad=OLD.prioridad
    AND NEW.intentos>=OLD.intentos
    AND NEW.fencing_token>=OLD.fencing_token
    AND NEW.creado_en_utc=OLD.creado_en_utc
    AND NEW.actualizado_en_utc>=OLD.actualizado_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad causal del trabajo de materializacion es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `transiciones_runtime_servidor_agentes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `agente_id` bigint(20) unsigned NOT NULL,
  `generacion` bigint(20) unsigned NOT NULL,
  `clave_causal` char(64) NOT NULL,
  `codigo_senal` varchar(384) NOT NULL,
  `valor_booleano` tinyint(3) unsigned NOT NULL,
  `causa` varchar(80) NOT NULL,
  `efectiva_en_utc` datetime(3) NOT NULL,
  `materializada_en_utc` datetime(3) DEFAULT NULL,
  `checkpoint_causal` varchar(190) NOT NULL,
  `observacion_telemetria_id` bigint(20) unsigned DEFAULT NULL,
  `fecha_creacion` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transicion_runtime_servidor_causal` (`agente_id`,`generacion`,`clave_causal`),
  UNIQUE KEY `uk_transicion_runtime_servidor_observacion` (`observacion_telemetria_id`),
  KEY `idx_transicion_runtime_servidor_generacion` (`agente_id`,`generacion`,`efectiva_en_utc`,`id`),
  CONSTRAINT `fk_transicion_runtime_servidor_estado` FOREIGN KEY (`agente_id`, `generacion`) REFERENCES `estados_runtime_servidor_agentes` (`agente_id`, `generacion`) ON DELETE CASCADE,
  CONSTRAINT `fk_transicion_runtime_servidor_observacion` FOREIGN KEY (`observacion_telemetria_id`) REFERENCES `observaciones_telemetria_agentes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_transicion_runtime_servidor_valor` CHECK (`valor_booleano` in (0,1)),
  CONSTRAINT `chk_transicion_runtime_servidor_clave` CHECK (`clave_causal` regexp '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `transiciones_temporales_fotografias_remotas` (
  `transicion_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_estado` bigint(20) unsigned DEFAULT NULL,
  `condicion_anterior` enum('consolidando','vigente','vencida','noAutorizada','incompatible','retirada') DEFAULT NULL,
  `condicion_nueva` enum('consolidando','vigente','vencida','noAutorizada','incompatible','retirada') NOT NULL,
  `causa` enum('fotografia_inicial','fotografia_actualizada','ttl_agotado','consolidacion_iniciada','consolidacion_finalizada','estado_recuperado','autoridad_perdida','autoridad_recuperada','compatibilidad_perdida','compatibilidad_recuperada','fuente_retirada') NOT NULL,
  `vigente_hasta_efectiva_utc` datetime(3) NOT NULL,
  `efectivo_en_utc` datetime(3) NOT NULL,
  `materializado_en_utc` datetime(3) NOT NULL,
  `boot_consolidacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `operacion_aviso` enum('ninguna','detectar','resolver') NOT NULL,
  `evento_aviso_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `aviso_aplicado_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`transicion_id`),
  KEY `idx_transiciones_temporales_pendientes` (`operacion_aviso`,`aviso_aplicado_en_utc`,`materializado_en_utc`,`transicion_id`),
  KEY `idx_transiciones_temporales_proyeccion` (`proyeccion_id`,`materializado_en_utc`,`transicion_id`),
  KEY `fk_transiciones_temporales_fotografia` (`proyeccion_id`,`generacion_id`,`secuencia_estado`),
  KEY `fk_transiciones_temporales_ciclo` (`boot_consolidacion_id`),
  CONSTRAINT `fk_transiciones_temporales_ciclo` FOREIGN KEY (`boot_consolidacion_id`) REFERENCES `ciclos_consolidacion_estados_remotos` (`boot_id`),
  CONSTRAINT `fk_transiciones_temporales_fotografia` FOREIGN KEY (`proyeccion_id`, `generacion_id`, `secuencia_estado`) REFERENCES `fotografias_operativas_monitores_remotos` (`proyeccion_id`, `generacion_id`, `secuencia_estado`),
  CONSTRAINT `fk_transiciones_temporales_version` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_transiciones_temporales_uuid` CHECK (`transicion_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT `chk_transiciones_temporales_aviso` CHECK (`operacion_aviso` = 'ninguna' and `evento_aviso_id` is null and `aviso_aplicado_en_utc` is null or `operacion_aviso` <> 'ninguna' and `evento_aviso_id` regexp '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_transicion_temporal_remota_inmutable
BEFORE UPDATE ON transiciones_temporales_fotografias_remotas
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.transicion_id=OLD.transicion_id
    AND NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.secuencia_estado=OLD.secuencia_estado
    AND NEW.condicion_anterior<=>OLD.condicion_anterior
    AND NEW.condicion_nueva=OLD.condicion_nueva
    AND NEW.causa=OLD.causa
    AND NEW.vigente_hasta_efectiva_utc=OLD.vigente_hasta_efectiva_utc
    AND NEW.efectivo_en_utc=OLD.efectivo_en_utc
    AND NEW.materializado_en_utc=OLD.materializado_en_utc
    AND NEW.boot_consolidacion_id<=>OLD.boot_consolidacion_id
    AND NEW.operacion_aviso=OLD.operacion_aviso
    AND NEW.evento_aviso_id<=>OLD.evento_aviso_id
    AND OLD.aviso_aplicado_en_utc IS NULL
    AND NEW.aviso_aplicado_en_utc IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transicion temporal remota es inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `triggers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `empresa_id` bigint(20) unsigned DEFAULT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `tenant_id_scope` bigint(20) unsigned GENERATED ALWAYS AS (coalesce(`tenant_id`,0)) STORED,
  `empresa_id_scope` bigint(20) unsigned GENERATED ALWAYS AS (coalesce(`empresa_id`,0)) STORED,
  `sitio_id_scope` bigint(20) unsigned GENERATED ALWAYS AS (coalesce(`sitio_id`,0)) STORED,
  `nombre` varchar(160) NOT NULL,
  `tipo` varchar(40) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `configuracion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`configuracion`)),
  `revision_declaracion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_triggers_nombre_scope` (`nombre`,`tenant_id_scope`,`empresa_id_scope`,`sitio_id_scope`),
  KEY `idx_triggers_tipo_activo` (`tipo`,`activo`),
  KEY `idx_triggers_scope_empresa` (`tenant_id`,`empresa_id`,`activo`,`id`),
  KEY `idx_triggers_scope_sitio` (`tenant_id`,`empresa_id`,`sitio_id`,`activo`,`id`),
  KEY `fk_triggers_empresa` (`empresa_id`),
  KEY `fk_triggers_sitio` (`sitio_id`),
  CONSTRAINT `fk_triggers_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_triggers_sitio` FOREIGN KEY (`sitio_id`) REFERENCES `sitios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_triggers_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_triggers_revision_declaracion` CHECK (`revision_declaracion` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_triggers_guard_revision_declaracion
BEFORE UPDATE ON triggers
FOR EACH ROW
BEGIN
  DECLARE v_guard_revision TINYINT DEFAULT 0;

  SELECT guard_revision_trigger_activo
    INTO v_guard_revision
    FROM estado_despliegue_trigger_correo
   WHERE id = 1;

  IF v_guard_revision = 1
     AND NEW.revision_declaracion <> OLD.revision_declaracion + 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La mutación de trigger debe avanzar exactamente una revisión declarativa';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario` varchar(80) NOT NULL,
  `email` varchar(190) NOT NULL,
  `email_validado` tinyint(1) NOT NULL DEFAULT 0,
  `hash_password` varchar(255) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `es_superusuario` tinyint(1) NOT NULL DEFAULT 0,
  `requiere_cambio_password` tinyint(1) NOT NULL DEFAULT 0,
  `version_sesion` int(10) unsigned NOT NULL DEFAULT 1,
  `generacion_recuperacion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `ultimo_acceso` datetime DEFAULT NULL,
  `contador_accesos` bigint(20) unsigned NOT NULL DEFAULT 0,
  `nombre_mostrar` varchar(120) DEFAULT NULL,
  `nombre_completo` varchar(160) DEFAULT NULL,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `empresa_id` bigint(20) unsigned DEFAULT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `permiso_ver` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_auditoria` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_monitores` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_triggers` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_dns` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_editar` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_editar_triggers` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_editar_dns` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_gestionar_vinculos_triggers` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_usuarios` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_configuracion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_publicar_dns` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_dns_avanzado` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_agentes` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_modificar_agentes` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_eliminar_agentes` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_organizacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_tenants` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_empresas` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_administrar_sitios` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_impersonacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_configurar_emisiones_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_configurar_recepciones_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_activar_relaciones_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_gestionar_credenciales_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_transferir_responsabilidad_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_resolver_conflictos_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_diagnostico_federacion` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_avisos_plataforma` tinyint(1) NOT NULL DEFAULT 0,
  `permiso_ver_alertas_remotas` tinyint(1) NOT NULL DEFAULT 0,
  `preferencia_mostrar_alertas_remotas` tinyint(1) NOT NULL DEFAULT 0,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_usuarios_usuario` (`usuario`),
  KEY `idx_usuarios_email` (`email`),
  KEY `idx_usuarios_scope` (`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_usuarios_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `idx_usuarios_sitio_empresa_tenant` (`sitio_id`,`empresa_id`,`tenant_id`),
  KEY `idx_usuarios_recuperacion_buzon` (`email`,`activo`,`email_validado`,`id`,`generacion_recuperacion`),
  CONSTRAINT `fk_usuarios_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_usuarios_sitio_empresa_tenant` FOREIGN KEY (`sitio_id`, `empresa_id`, `tenant_id`) REFERENCES `sitios` (`id`, `empresa_id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_usuarios_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_usuarios_generacion_recuperacion` CHECK (`generacion_recuperacion` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `variantes_divergencias_proyecciones_federacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `divergencia_id` bigint(20) unsigned NOT NULL,
  `clase` enum('consolidada','conflictiva') NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `conflicto_inbox_id` bigint(20) unsigned DEFAULT NULL,
  `entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision_concesion_id` char(47) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `recorrido_canonico` longtext DEFAULT NULL CHECK (json_valid(`recorrido_canonico`)),
  `recorrido_sha256` binary(32) DEFAULT NULL,
  `payload_sha256` binary(32) NOT NULL,
  `veces_observada` bigint(20) unsigned NOT NULL DEFAULT 1,
  `primera_observacion_utc` datetime(3) NOT NULL,
  `ultima_observacion_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_variantes_divergencia_ruta` (`divergencia_id`,`payload_sha256`,`relacion_id`,`revision_concesion_id`,`recorrido_sha256`),
  KEY `idx_variantes_divergencia` (`divergencia_id`,`clase`,`id`),
  KEY `idx_variantes_ruta` (`relacion_id`,`revision_concesion_id`,`recorrido_sha256`,`divergencia_id`),
  KEY `fk_variantes_inbox` (`inbox_ocurrencia_id`),
  KEY `fk_variantes_conflicto` (`conflicto_inbox_id`),
  KEY `fk_variantes_entrega` (`entrega_id`),
  KEY `fk_variantes_generacion` (`generacion_id`),
  CONSTRAINT `fk_variantes_conflicto` FOREIGN KEY (`conflicto_inbox_id`) REFERENCES `conflictos_contenido_inbox_federacion` (`id`),
  CONSTRAINT `fk_variantes_divergencia` FOREIGN KEY (`divergencia_id`) REFERENCES `divergencias_proyecciones_federacion` (`id`),
  CONSTRAINT `fk_variantes_entrega` FOREIGN KEY (`entrega_id`) REFERENCES `entregas_recepcion_federacion` (`entrega_id`),
  CONSTRAINT `fk_variantes_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_variantes_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_variantes_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `fk_variantes_revision_relacion` FOREIGN KEY (`relacion_id`, `revision_concesion_id`) REFERENCES `revisiones_concesion_federacion` (`relacion_id`, `revision_id`),
  CONSTRAINT `chk_variantes_ruta` CHECK (`entrega_id` is null and `relacion_id` is null and `flujo_id` is null and `generacion_id` is null and `revision_concesion_id` is null and `recorrido_canonico` is null and `recorrido_sha256` is null or `entrega_id` is not null and `relacion_id` is not null and `flujo_id` is not null and `generacion_id` is not null and `revision_concesion_id` is not null and `recorrido_canonico` is not null and `recorrido_sha256` is not null and json_valid(`recorrido_canonico`)),
  CONSTRAINT `chk_variantes_clase` CHECK (`clase` = 'consolidada' and `conflicto_inbox_id` is null or `clase` = 'conflictiva' and `conflicto_inbox_id` is not null),
  CONSTRAINT `chk_variantes_cronologia` CHECK (`veces_observada` >= 1 and `ultima_observacion_utc` >= `primera_observacion_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_variantes_divergencia_inmutables
BEFORE UPDATE ON variantes_divergencias_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.id=OLD.id AND NEW.divergencia_id=OLD.divergencia_id
    AND NEW.clase=OLD.clase
    AND NEW.inbox_ocurrencia_id=OLD.inbox_ocurrencia_id
    AND NEW.conflicto_inbox_id<=>OLD.conflicto_inbox_id
    AND NEW.entrega_id<=>OLD.entrega_id
    AND NEW.relacion_id<=>OLD.relacion_id
    AND NEW.flujo_id<=>OLD.flujo_id
    AND NEW.generacion_id<=>OLD.generacion_id
    AND NEW.revision_concesion_id<=>OLD.revision_concesion_id
    AND NEW.recorrido_canonico<=>OLD.recorrido_canonico
    AND NEW.recorrido_sha256<=>OLD.recorrido_sha256
    AND NEW.payload_sha256=OLD.payload_sha256
    AND NEW.veces_observada>=OLD.veces_observada
    AND NEW.primera_observacion_utc=OLD.primera_observacion_utc
    AND NEW.ultima_observacion_utc>=OLD.ultima_observacion_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La variante de divergencia es evidencia inmutable.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vencimientos_descarte_alertas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `alerta_auditoria_id` binary(16) NOT NULL,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `descartada_hasta_utc` datetime(3) NOT NULL,
  `estado` enum('pendiente','consolidada','neutralizada') NOT NULL DEFAULT 'pendiente',
  `causa_terminal` enum('vencimiento','sustitucion','reversion','cierre_ciclo','eliminacion_superior','ciclo_ausente') DEFAULT NULL,
  `proximo_intento_utc` datetime(3) DEFAULT NULL,
  `intentos` smallint(5) unsigned NOT NULL DEFAULT 0,
  `instancia_id` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `lease_token` binary(32) DEFAULT NULL,
  `lease_expira_utc` datetime(3) DEFAULT NULL,
  `fencing_token` bigint(20) unsigned NOT NULL DEFAULT 0,
  `ultimo_codigo_error` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `ultimo_mensaje_error` varchar(512) DEFAULT NULL,
  `obligacion_outbox_id` bigint(20) unsigned DEFAULT NULL,
  `evento_resultado_id` binary(16) DEFAULT NULL,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `terminada_en_utc` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vencimientos_descarte_identidad` (`alerta_auditoria_id`,`descartada_hasta_utc`),
  UNIQUE KEY `uk_vencimientos_descarte_obligacion_outbox` (`obligacion_outbox_id`),
  UNIQUE KEY `uk_vencimientos_descarte_evento_resultado` (`evento_resultado_id`),
  KEY `idx_vencimientos_descarte_elegibles` (`estado`,`proximo_intento_utc`,`lease_expira_utc`,`id`),
  KEY `idx_vencimientos_descarte_ciclo` (`alerta_auditoria_id`,`estado`,`descartada_hasta_utc`,`id`),
  KEY `idx_vencimientos_descarte_monitor` (`monitor_id`,`estado`,`id`),
  KEY `idx_vencimientos_descarte_terminales` (`estado`,`terminada_en_utc`,`id`),
  CONSTRAINT `chk_vencimientos_descarte_uuidv7` CHECK (substr(hex(`alerta_auditoria_id`),13,1) = '7' and substr(hex(`alerta_auditoria_id`),17,1) in ('8','9','A','B')),
  CONSTRAINT `chk_vencimientos_descarte_lease` CHECK (`instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null or `instancia_id` is not null and `lease_token` is not null and `lease_expira_utc` is not null and `fencing_token` > 0 and `estado` = 'pendiente'),
  CONSTRAINT `chk_vencimientos_descarte_diagnostico` CHECK (`ultimo_codigo_error` is null and `ultimo_mensaje_error` is null or `ultimo_codigo_error` is not null and `ultimo_mensaje_error` is not null),
  CONSTRAINT `chk_vencimientos_descarte_estado` CHECK (`estado` = 'pendiente' and `causa_terminal` is null and `proximo_intento_utc` is not null and `obligacion_outbox_id` is null and `evento_resultado_id` is null and `terminada_en_utc` is null or `estado` = 'consolidada' and `causa_terminal` = 'vencimiento' and `proximo_intento_utc` is null and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `obligacion_outbox_id` is not null and `terminada_en_utc` is not null or `estado` = 'neutralizada' and `causa_terminal` in ('sustitucion','reversion','cierre_ciclo','eliminacion_superior','ciclo_ausente') and `proximo_intento_utc` is null and `instancia_id` is null and `lease_token` is null and `lease_expira_utc` is null and `obligacion_outbox_id` is null and `evento_resultado_id` is null and `terminada_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_vencimientos_descarte_validar_insert
BEFORE INSERT ON vencimientos_descarte_alertas
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM alertas_activas_monitores
    WHERE monitor_id = NEW.monitor_id
      AND alerta_auditoria_id = NEW.alerta_auditoria_id
      AND descartada_dashboard = 1
      AND descartada_hasta_utc = NEW.descartada_hasta_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El vencimiento exige el descarte temporal vigente del mismo ciclo';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_vencimientos_descarte_proteger_update
BEFORE UPDATE ON vencimientos_descarte_alertas
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.id <=> NEW.id
    AND OLD.alerta_auditoria_id <=> NEW.alerta_auditoria_id
    AND OLD.monitor_id <=> NEW.monitor_id
    AND OLD.descartada_hasta_utc <=> NEW.descartada_hasta_utc
    AND OLD.creada_en_utc <=> NEW.creada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad durable del vencimiento de descarte es inmutable';
  END IF;

  IF NOT (
    (OLD.estado = 'pendiente'
      AND NEW.estado IN ('pendiente', 'consolidada', 'neutralizada'))
    OR (OLD.estado = 'consolidada' AND NEW.estado = 'consolidada')
    OR (OLD.estado = 'neutralizada' AND NEW.estado = 'neutralizada')
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La transición del vencimiento de descarte no está permitida';
  END IF;

  IF NEW.intentos < OLD.intentos OR NEW.fencing_token < OLD.fencing_token THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los contadores del vencimiento de descarte no pueden retroceder';
  END IF;

  IF OLD.obligacion_outbox_id IS NOT NULL AND NOT (
    OLD.obligacion_outbox_id <=> NEW.obligacion_outbox_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La obligación outbox del vencimiento es inmutable';
  END IF;

  IF OLD.evento_resultado_id IS NOT NULL AND NOT (
    OLD.evento_resultado_id <=> NEW.evento_resultado_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El evento incorporado del vencimiento es inmutable';
  END IF;

  IF OLD.estado IN ('consolidada', 'neutralizada') AND NOT (
    OLD.estado <=> NEW.estado
    AND OLD.causa_terminal <=> NEW.causa_terminal
    AND OLD.proximo_intento_utc <=> NEW.proximo_intento_utc
    AND OLD.intentos <=> NEW.intentos
    AND OLD.instancia_id <=> NEW.instancia_id
    AND OLD.lease_token <=> NEW.lease_token
    AND OLD.lease_expira_utc <=> NEW.lease_expira_utc
    AND OLD.fencing_token <=> NEW.fencing_token
    AND OLD.ultimo_codigo_error <=> NEW.ultimo_codigo_error
    AND OLD.ultimo_mensaje_error <=> NEW.ultimo_mensaje_error
    AND OLD.obligacion_outbox_id <=> NEW.obligacion_outbox_id
    AND (
      OLD.evento_resultado_id <=> NEW.evento_resultado_id
      OR (OLD.evento_resultado_id IS NULL AND NEW.evento_resultado_id IS NOT NULL)
    )
    AND OLD.terminada_en_utc <=> NEW.terminada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un vencimiento terminal solo admite incorporar su evento';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER IF NOT EXISTS trg_vencimientos_descarte_proteger_delete
BEFORE DELETE ON vencimientos_descarte_alertas
FOR EACH ROW
BEGIN
  IF OLD.estado = 'pendiente' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un vencimiento pendiente debe consolidarse o neutralizarse';
  END IF;

  IF OLD.estado = 'consolidada' AND OLD.evento_resultado_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El evento de vencimiento debe incorporarse antes de limpiar';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `versiones_contexto_operativo_agentes_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `guid_agente` char(36) DEFAULT NULL,
  `nombre_agente` varchar(160) DEFAULT NULL,
  `estado_pol` enum('nuncaObservado','abierto','cerrado') DEFAULT NULL,
  `ultimo_heartbeat_utc` datetime(3) DEFAULT NULL,
  `causa_retirada` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_versiones_contexto_agente_trabajo` (`trabajo_entrega_id`),
  KEY `idx_versiones_contexto_agente_actual` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`estado_registro`),
  KEY `fk_versiones_contexto_agente_inbox` (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_versiones_contexto_agente_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_versiones_contexto_agente_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_versiones_contexto_agente_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_versiones_contexto_agente_identidad` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_versiones_contexto_agente_payload` CHECK (`secuencia_elemento` >= 1 and octet_length(`representacion_canonica`) between 2 and 2097152 and json_valid(`representacion_canonica`)),
  CONSTRAINT `chk_versiones_contexto_agente_estado` CHECK (`estado_registro` = 'presente' and `guid_agente` is not null and `nombre_agente` is not null and `estado_pol` is not null and `causa_retirada` is null or `estado_registro` = 'retirado' and `guid_agente` is null and `nombre_agente` is null and `estado_pol` is null and `ultimo_heartbeat_utc` is null and `causa_retirada` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_version_contexto_agente_inmutable
BEFORE UPDATE ON versiones_contexto_operativo_agentes_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una version remota del contexto de agente es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `versiones_nodos_organizativos_remotos` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `secuencia_elemento` bigint(20) unsigned NOT NULL,
  `trabajo_entrega_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `inbox_ocurrencia_id` bigint(20) unsigned NOT NULL,
  `ocurrencia_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tipo_nodo` enum('tenant','empresa','sitio') DEFAULT NULL,
  `estado_registro` enum('presente','retirado') NOT NULL,
  `nombre` varchar(160) DEFAULT NULL,
  `alias` varchar(120) DEFAULT NULL,
  `estado_origen` varchar(32) DEFAULT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `timezone` varchar(80) DEFAULT NULL,
  `causa_retirada` varchar(96) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `representacion_canonica` mediumtext NOT NULL,
  `materializada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  UNIQUE KEY `uk_versiones_nodos_organizativos_trabajo` (`trabajo_entrega_id`),
  KEY `idx_versiones_nodos_organizativos_actual` (`proyeccion_id`,`generacion_id`,`secuencia_elemento`,`estado_registro`),
  KEY `idx_versiones_nodos_organizativos_tipo` (`tipo_nodo`,`estado_registro`,`proyeccion_id`,`generacion_id`,`secuencia_elemento`),
  KEY `fk_versiones_nodos_organizativos_inbox` (`inbox_ocurrencia_id`),
  CONSTRAINT `fk_versiones_nodos_organizativos_inbox` FOREIGN KEY (`inbox_ocurrencia_id`) REFERENCES `inbox_ocurrencias_federacion` (`id`),
  CONSTRAINT `fk_versiones_nodos_organizativos_proyeccion` FOREIGN KEY (`proyeccion_id`, `generacion_id`) REFERENCES `versiones_proyecciones_federacion` (`proyeccion_id`, `generacion_id`),
  CONSTRAINT `fk_versiones_nodos_organizativos_trabajo` FOREIGN KEY (`trabajo_entrega_id`) REFERENCES `trabajos_materializacion_federacion` (`entrega_id`),
  CONSTRAINT `chk_versiones_nodos_organizativos_identidad` CHECK (`ocurrencia_origen_id` regexp '^sfid1\\.ocurrencia_origen\\.[A-Za-z0-9_-]{21}[AQgw]$'),
  CONSTRAINT `chk_versiones_nodos_organizativos_payload` CHECK (`secuencia_elemento` >= 1 and octet_length(`representacion_canonica`) between 2 and 2097152 and json_valid(`representacion_canonica`)),
  CONSTRAINT `chk_versiones_nodos_organizativos_estado` CHECK (`estado_registro` = 'presente' and `tipo_nodo` is not null and `nombre` is not null and `alias` is not null and `estado_origen` is not null and `causa_retirada` is null or `estado_registro` = 'retirado' and `nombre` is null and `alias` is null and `estado_origen` is null and `descripcion` is null and `timezone` is null and `causa_retirada` is not null),
  CONSTRAINT `chk_versiones_nodos_organizativos_timezone` CHECK (`tipo_nodo` = 'sitio' or `timezone` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_versiones_nodos_organizativos_inmutables
BEFORE UPDATE ON versiones_nodos_organizativos_remotos
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Una version organizativa remota es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `versiones_planes_flujos_federacion` (
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_efectiva_id` char(47) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`flujo_id`,`revision_efectiva_id`),
  UNIQUE KEY `uk_version_plan_identidad` (`flujo_id`,`revision_efectiva_id`,`generacion_id`),
  KEY `fk_version_plan_revision` (`revision_efectiva_id`),
  CONSTRAINT `fk_version_plan_flujo` FOREIGN KEY (`flujo_id`) REFERENCES `reconciliaciones_flujos_concesion_federacion` (`flujo_id`),
  CONSTRAINT `fk_version_plan_revision` FOREIGN KEY (`revision_efectiva_id`) REFERENCES `revisiones_concesion_federacion` (`revision_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_version_plan_federacion_inmutable
BEFORE UPDATE ON versiones_planes_flujos_federacion
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT='La identidad de una version de plan es inmutable.';
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `versiones_proyecciones_federacion` (
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `estado_publicacion` enum('preparando','actual','historica') NOT NULL,
  `estado_materializacion` enum('pendiente','materializada','fallida') NOT NULL,
  `completitud_interpretable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_observable` enum('completa','parcial','degradada') NOT NULL,
  `completitud_reconstruible` enum('completa','parcial','degradada') NOT NULL,
  `estado_vigencia` enum('vigente','vencida','retirada') NOT NULL,
  `estado_soporte` enum('sostenida','huerfana') NOT NULL,
  `estado_autorizacion` enum('autorizada','noAutorizada') NOT NULL,
  `estado_coherencia` enum('coherente','divergente') NOT NULL DEFAULT 'coherente',
  `cierre_operativo_validado` tinyint(1) NOT NULL DEFAULT 0,
  `recepcion_confirmada` tinyint(1) NOT NULL DEFAULT 0,
  `ultima_secuencia_evaluada` bigint(20) unsigned DEFAULT NULL,
  `ultima_evaluacion_id` bigint(20) unsigned DEFAULT NULL,
  `version_estado` bigint(20) unsigned NOT NULL DEFAULT 1,
  `creada_en_utc` datetime(3) NOT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  `publicada_en_utc` datetime(3) DEFAULT NULL,
  `finalizada_en_utc` datetime(3) DEFAULT NULL,
  `actual_unica` tinyint(4) GENERATED ALWAYS AS (if(`estado_publicacion` = 'actual',1,NULL)) STORED,
  PRIMARY KEY (`proyeccion_id`,`generacion_id`),
  UNIQUE KEY `uk_versiones_proyeccion_actual` (`proyeccion_id`,`actual_unica`),
  KEY `idx_versiones_proyeccion_generacion` (`generacion_id`,`proyeccion_id`),
  KEY `idx_versiones_proyeccion_dimensiones` (`estado_publicacion`,`estado_materializacion`,`estado_vigencia`,`estado_soporte`,`estado_autorizacion`),
  KEY `fk_versiones_proyeccion_ultima_evaluacion` (`ultima_evaluacion_id`,`proyeccion_id`,`generacion_id`),
  KEY `idx_versiones_proyeccion_coherencia` (`proyeccion_id`,`estado_coherencia`,`estado_publicacion`),
  CONSTRAINT `fk_versiones_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_versiones_proyeccion_generacion` FOREIGN KEY (`generacion_id`) REFERENCES `generaciones_flujos_federacion` (`generacion_id`),
  CONSTRAINT `fk_versiones_proyeccion_ultima_evaluacion` FOREIGN KEY (`ultima_evaluacion_id`, `proyeccion_id`, `generacion_id`) REFERENCES `evaluaciones_dimensiones_proyecciones_federacion` (`id`, `proyeccion_id`, `generacion_id`),
  CONSTRAINT `chk_versiones_proyeccion_version` CHECK (`version_estado` >= 1),
  CONSTRAINT `chk_versiones_proyeccion_cronologia` CHECK (`actualizada_en_utc` >= `creada_en_utc` and (`publicada_en_utc` is null or `publicada_en_utc` >= `creada_en_utc`) and (`finalizada_en_utc` is null or `finalizada_en_utc` >= `creada_en_utc`)),
  CONSTRAINT `chk_versiones_proyeccion_publicacion` CHECK (`estado_publicacion` = 'preparando' and `publicada_en_utc` is null and `finalizada_en_utc` is null or `estado_publicacion` = 'actual' and `publicada_en_utc` is not null and `finalizada_en_utc` is null or `estado_publicacion` = 'historica' and `publicada_en_utc` is not null and `finalizada_en_utc` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_versiones_proyeccion_transicion
BEFORE UPDATE ON versiones_proyecciones_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.proyeccion_id=OLD.proyeccion_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.version_estado=OLD.version_estado+1
    AND NEW.creada_en_utc=OLD.creada_en_utc
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
    AND OLD.estado_publicacion<>'historica'
    AND (
      NEW.estado_publicacion=OLD.estado_publicacion
      OR (OLD.estado_publicacion='preparando' AND NEW.estado_publicacion='actual')
      OR (OLD.estado_publicacion='actual' AND NEW.estado_publicacion='preparando')
      OR (OLD.estado_publicacion='actual' AND NEW.estado_publicacion='historica')
    )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La version de proyeccion viola su transicion monotona.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vinculos_entradas_federadas_monitores_logicos` (
  `entrada_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `monitor_id` bigint(20) unsigned NOT NULL,
  `monitor_tipo` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'booleano',
  `variable` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `proyeccion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_configuracion` bigint(20) unsigned NOT NULL DEFAULT 1,
  `estado_inicial` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'correcto',
  `inversion` tinyint(1) NOT NULL DEFAULT 0,
  `retardo_cambio_segundos` int(10) unsigned NOT NULL DEFAULT 0,
  `politica_perdida_en_fallo` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'conservar',
  `politica_perdida_en_correcto` varchar(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'conservar',
  `fecha_creacion` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `fecha_actualizacion` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`monitor_id`,`variable`),
  UNIQUE KEY `uk_vinculos_logicos_entrada_id` (`entrada_id`),
  KEY `idx_vinculos_logicos_proyeccion_inversa` (`proyeccion_id`,`monitor_id`),
  KEY `fk_vinculos_logicos_monitor` (`monitor_id`,`monitor_tipo`),
  CONSTRAINT `fk_vinculos_logicos_monitor` FOREIGN KEY (`monitor_id`, `monitor_tipo`) REFERENCES `monitores` (`id`, `tipo`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vinculos_logicos_proyeccion` FOREIGN KEY (`proyeccion_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `chk_vinculos_logicos_variable` CHECK (`variable` regexp '^[A-Z][A-Z0-9_]{0,15}$'),
  CONSTRAINT `chk_vinculos_logicos_revision` CHECK (`revision_configuracion` >= 1),
  CONSTRAINT `chk_vinculos_logicos_estado_inicial` CHECK (`estado_inicial` in ('correcto','fallo')),
  CONSTRAINT `chk_vinculos_logicos_inversion` CHECK (`inversion` in (0,1)),
  CONSTRAINT `chk_vinculos_logicos_perdida_fallo` CHECK (`politica_perdida_en_fallo` in ('forzar_fallo','forzar_correcto','conservar')),
  CONSTRAINT `chk_vinculos_logicos_perdida_correcto` CHECK (`politica_perdida_en_correcto` in ('forzar_fallo','forzar_correcto','conservar')),
  CONSTRAINT `chk_vinculos_logicos_retardo_cambio` CHECK (`retardo_cambio_segundos` <= 86400)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_vinculo_logico_federado_insertar
BEFORE INSERT ON vinculos_entradas_federadas_monitores_logicos
FOR EACH ROW
BEGIN
  DECLARE familia_proyeccion VARCHAR(40) DEFAULT NULL;
  IF NEW.monitor_tipo<>'booleano' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una entrada federada solo pertenece a un monitor booleano.';
  END IF;
  SELECT familia INTO familia_proyeccion
    FROM proyecciones_federacion
   WHERE proyeccion_id=NEW.proyeccion_id
   LIMIT 1;
  IF familia_proyeccion IS NULL OR familia_proyeccion<>'monitores' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una entrada federada lógica solo acepta proyecciones de monitores.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_vinculo_logico_federado_actualizar
BEFORE UPDATE ON vinculos_entradas_federadas_monitores_logicos
FOR EACH ROW
BEGIN
  DECLARE familia_proyeccion VARCHAR(40) DEFAULT NULL;
  IF NEW.monitor_tipo<>'booleano' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una entrada federada solo pertenece a un monitor booleano.';
  END IF;
  SELECT familia INTO familia_proyeccion
    FROM proyecciones_federacion
   WHERE proyeccion_id=NEW.proyeccion_id
   LIMIT 1;
  IF familia_proyeccion IS NULL OR familia_proyeccion<>'monitores' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Una entrada federada lógica solo acepta proyecciones de monitores.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vinculos_monitores_telemetria` (
  `monitor_id` bigint(20) unsigned NOT NULL,
  `monitor_tipo` varchar(40) NOT NULL DEFAULT 'telemetria',
  `tenant_id` bigint(20) unsigned NOT NULL,
  `empresa_id` bigint(20) unsigned NOT NULL,
  `sitio_id` bigint(20) unsigned NOT NULL,
  `tipo_fuente` enum('senal_directa','regla_derivacion','senal_federada') NOT NULL,
  `agente_id` bigint(20) unsigned DEFAULT NULL,
  `senal_id` bigint(20) unsigned DEFAULT NULL,
  `regla_id` bigint(20) unsigned DEFAULT NULL,
  `proyeccion_federada_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `fecha_creacion` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_actualizacion` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`monitor_id`),
  KEY `idx_vinculos_monitores_telemetria_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`monitor_id`),
  KEY `idx_vinculos_monitores_telemetria_agente` (`agente_id`,`tipo_fuente`,`monitor_id`),
  KEY `idx_vinculos_monitores_telemetria_senal` (`agente_id`,`senal_id`,`monitor_id`),
  KEY `idx_vinculos_monitores_telemetria_regla` (`regla_id`,`monitor_id`),
  KEY `fk_vinculos_monitores_telemetria_monitor_scope` (`monitor_id`,`monitor_tipo`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_vinculos_monitores_telemetria_proyeccion` (`proyeccion_federada_id`,`monitor_id`),
  KEY `fk_vinculos_monitores_telemetria_agente_scope` (`agente_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `fk_vinculos_monitores_telemetria_senal_agente` (`senal_id`,`agente_id`),
  KEY `fk_vinculos_monitores_telemetria_regla_scope` (`regla_id`,`agente_id`,`tenant_id`,`empresa_id`,`sitio_id`),
  KEY `idx_vinculos_monitores_agente_monitor` (`agente_id`,`monitor_id`),
  CONSTRAINT `fk_vinculos_monitores_telemetria_agente_scope` FOREIGN KEY (`agente_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `agentes_sentinelia` (`id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vinculos_monitores_telemetria_monitor_scope` FOREIGN KEY (`monitor_id`, `monitor_tipo`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `monitores` (`id`, `tipo`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vinculos_monitores_telemetria_proyeccion_federada` FOREIGN KEY (`proyeccion_federada_id`) REFERENCES `proyecciones_federacion` (`proyeccion_id`),
  CONSTRAINT `fk_vinculos_monitores_telemetria_regla_scope` FOREIGN KEY (`regla_id`, `agente_id`, `tenant_id`, `empresa_id`, `sitio_id`) REFERENCES `reglas_derivacion_telemetria` (`id`, `agente_id`, `tenant_id`, `empresa_id`, `sitio_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vinculos_monitores_telemetria_senal_agente` FOREIGN KEY (`senal_id`, `agente_id`) REFERENCES `senales_telemetria_agentes` (`id`, `agente_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_vinculos_monitores_telemetria_tipo_monitor` CHECK (`monitor_tipo` = 'telemetria'),
  CONSTRAINT `chk_vinculos_monitores_telemetria_fuente_exclusiva` CHECK (`tipo_fuente` = 'senal_directa' and `agente_id` is not null and `senal_id` is not null and `regla_id` is null and `proyeccion_federada_id` is null or `tipo_fuente` = 'regla_derivacion' and `agente_id` is not null and `senal_id` is null and `regla_id` is not null and `proyeccion_federada_id` is null or `tipo_fuente` = 'senal_federada' and `agente_id` is null and `senal_id` is null and `regla_id` is null and `proyeccion_federada_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_vinculo_telemetria_federada_insertar
BEFORE INSERT ON vinculos_monitores_telemetria
FOR EACH ROW
BEGIN
  IF NEW.tipo_fuente='senal_federada' AND NOT EXISTS (
    SELECT 1 FROM proyecciones_federacion p
     WHERE p.proyeccion_id=NEW.proyeccion_federada_id
       AND p.familia='telemetria'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fuente federada debe ser una proyección de telemetría.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_vinculo_telemetria_federada_actualizar
BEFORE UPDATE ON vinculos_monitores_telemetria
FOR EACH ROW
BEGIN
  IF NEW.tipo_fuente='senal_federada' AND NOT EXISTS (
    SELECT 1 FROM proyecciones_federacion p
     WHERE p.proyeccion_id=NEW.proyeccion_federada_id
       AND p.familia='telemetria'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La fuente federada debe ser una proyección de telemetría.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `watermarks_elementos_federacion` (
  `relacion_id` char(37) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `flujo_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `generacion_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `installation_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `familia` enum('estructuraOrganizativa','monitores','telemetria','triggersInformativos','auditoria','avisosFederados','contextoOperativoAgentesSesiones') NOT NULL,
  `elemento_origen_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `maxima_secuencia_observada` bigint(20) unsigned NOT NULL,
  `maxima_secuencia_materializada` bigint(20) unsigned DEFAULT NULL,
  `actualizada_en_utc` datetime(3) NOT NULL,
  PRIMARY KEY (`relacion_id`,`flujo_id`,`generacion_id`,`installation_origen_id`,`familia`,`elemento_origen_id`),
  KEY `fk_watermarks_federacion_generacion` (`flujo_id`,`generacion_id`),
  CONSTRAINT `fk_watermarks_federacion_generacion` FOREIGN KEY (`flujo_id`, `generacion_id`) REFERENCES `generaciones_flujos_federacion` (`flujo_id`, `generacion_id`),
  CONSTRAINT `fk_watermarks_federacion_relacion` FOREIGN KEY (`relacion_id`) REFERENCES `relaciones_federacion` (`relacion_id`),
  CONSTRAINT `chk_watermarks_federacion_secuencias` CHECK (`maxima_secuencia_observada` >= 1 and (`maxima_secuencia_materializada` is null or `maxima_secuencia_materializada` <= `maxima_secuencia_observada`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 CREATE*/  /*!50003 TRIGGER trg_watermarks_elementos_federacion_monotonos
BEFORE UPDATE ON watermarks_elementos_federacion
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.relacion_id=OLD.relacion_id
    AND NEW.flujo_id=OLD.flujo_id
    AND NEW.generacion_id=OLD.generacion_id
    AND NEW.installation_origen_id=OLD.installation_origen_id
    AND NEW.familia=OLD.familia
    AND NEW.elemento_origen_id=OLD.elemento_origen_id
    AND NEW.maxima_secuencia_observada>=OLD.maxima_secuencia_observada
    AND (OLD.maxima_secuencia_materializada IS NULL
      OR NEW.maxima_secuencia_materializada>=OLD.maxima_secuencia_materializada)
    AND NEW.actualizada_en_utc>=OLD.actualizada_en_utc
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La identidad y secuencias de un watermark federado no retroceden.';
  END IF;
END */;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonas_dns` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) unsigned DEFAULT NULL,
  `empresa_id` bigint(20) unsigned DEFAULT NULL,
  `sitio_id` bigint(20) unsigned DEFAULT NULL,
  `nombre_zona` varchar(253) NOT NULL,
  `tipo_zona` varchar(24) NOT NULL DEFAULT 'master',
  `categoria_origen` varchar(40) NOT NULL DEFAULT 'normal',
  `publicar_en_bind` tinyint(1) NOT NULL DEFAULT 1,
  `descripcion` varchar(255) DEFAULT NULL,
  `ttl_defecto_segundos` int(10) unsigned NOT NULL DEFAULT 3600,
  `soa_mname` varchar(253) NOT NULL,
  `soa_rname` varchar(253) NOT NULL,
  `soa_serial` bigint(20) unsigned NOT NULL DEFAULT 1,
  `soa_refresh_segundos` int(10) unsigned NOT NULL DEFAULT 3600,
  `soa_retry_segundos` int(10) unsigned NOT NULL DEFAULT 600,
  `soa_expire_segundos` int(10) unsigned NOT NULL DEFAULT 1209600,
  `soa_minimum_segundos` int(10) unsigned NOT NULL DEFAULT 300,
  `version_modelo` bigint(20) unsigned NOT NULL DEFAULT 1,
  `estado_publicacion` varchar(24) NOT NULL DEFAULT 'pendiente',
  `hash_publicacion_vigente` char(64) DEFAULT NULL,
  `fecha_ultima_publicacion_exitosa` datetime DEFAULT NULL,
  `fecha_ultimo_error_publicacion` datetime DEFAULT NULL,
  `detalle_ultimo_error_publicacion` text DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_creacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_actualizacion` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `generacion_aplicada_bind` bigint(20) unsigned DEFAULT NULL,
  `version_aplicada_bind` bigint(20) unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_zonas_dns_nombre_zona` (`nombre_zona`),
  KEY `idx_zonas_dns_scope` (`tenant_id`,`empresa_id`,`sitio_id`,`activo`,`id`),
  KEY `idx_zonas_dns_tipo_zona_activo` (`tipo_zona`,`activo`,`id`),
  KEY `idx_zonas_dns_tenant_activo` (`tenant_id`,`activo`,`id`),
  KEY `idx_zonas_dns_empresa_activo` (`tenant_id`,`empresa_id`,`activo`,`id`),
  KEY `idx_zonas_dns_sitio_activo` (`tenant_id`,`empresa_id`,`sitio_id`,`activo`,`id`),
  KEY `fk_zonas_dns_empresa_tenant` (`empresa_id`,`tenant_id`),
  KEY `fk_zonas_dns_sitio_empresa_tenant` (`sitio_id`,`empresa_id`,`tenant_id`),
  KEY `idx_zonas_dns_publicacion` (`publicar_en_bind`,`categoria_origen`,`activo`,`id`),
  CONSTRAINT `fk_zonas_dns_empresa_tenant` FOREIGN KEY (`empresa_id`, `tenant_id`) REFERENCES `empresas` (`id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_zonas_dns_sitio_empresa_tenant` FOREIGN KEY (`sitio_id`, `empresa_id`, `tenant_id`) REFERENCES `sitios` (`id`, `empresa_id`, `tenant_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_zonas_dns_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_zonas_dns_version_aplicada_bind` CHECK (`generacion_aplicada_bind` is null and `version_aplicada_bind` is null or `version_aplicada_bind` is not null and `version_aplicada_bind` > 0 and (`generacion_aplicada_bind` is null or `generacion_aplicada_bind` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
