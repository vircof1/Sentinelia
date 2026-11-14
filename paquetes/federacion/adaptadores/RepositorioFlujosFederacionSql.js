import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import {
  ErrorFlujoFederacion,
  crearDefinicionFlujoFederacion,
  crearDefinicionGeneracionFederacion,
  crearPropietarioEmisorFederacion,
  exigirEstadoFlujoFederacion,
  exigirTransicionGeneracionFederacion
} from '../src/FlujoFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import { crearScopeFederacion } from '../src/ScopeFederacion.js';

const MAX_BIGINT_UNSIGNED = '18446744073709551615';

export class RepositorioFlujosFederacionSql {
  constructor(clienteSql, { installationLocalId } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Los flujos federados requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
    this.installationLocalId = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(installationLocalId || '')
    }));
  }

  async crearFlujoInicial({
    flujo,
    generacion,
    corteInicialPendiente = false
  } = {}) {
    const definicionFlujo = crearDefinicionFlujoFederacion(flujo);
    const definicionGeneracion = crearDefinicionGeneracionFederacion(generacion);
    if (typeof corteInicialPendiente !== 'boolean') {
      throw new ErrorFlujoFederacion(
        'corte_inicial_invalido',
        'La preparación del corte inicial debe declararse como booleano.'
      );
    }
    if (definicionGeneracion.clase !== 'inicial') {
      throw new ErrorFlujoFederacion(
        'clase_generacion_inicial_invalida',
        'La creación del flujo exige una generación inicial.'
      );
    }
    if (definicionGeneracion.propietario.version !== 1) {
      throw new ErrorFlujoFederacion(
        'version_propietario_inicial_invalida',
        'El primer propietario emisor debe comenzar en la versión 1.'
      );
    }
    if (corteInicialPendiente && definicionGeneracion.fronteraInicial !== '0') {
      throw new ErrorFlujoFederacion(
        'frontera_inicial_prematura',
        'Una generación preparada para fotografía debe comenzar con frontera cero.'
      );
    }
    return this.frontera.ejecutar(async (conexion) => {
      const relacion = await obtenerRelacionBloqueada(
        conexion,
        definicionFlujo.relacionId
      );
      exigirRelacionOperativa({
        relacion,
        flujo: definicionFlujo,
        propietario: definicionGeneracion.propietario,
        installationLocalId: this.installationLocalId
      });
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO flujos_federacion (
           flujo_id,relacion_id,direccion,familia,version_familia,
           scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
           estado,generacion_activa_id,version_estado,version_propietario,
           version_registro,creada_en_utc,actualizada_en_utc
         ) VALUES (?,?,?,?,?,?,?,?,?,'sinSincronizar',NULL,1,1,1,?,?)`,
        [
          definicionFlujo.flujoId,
          definicionFlujo.relacionId,
          definicionFlujo.direccion,
          definicionFlujo.familia,
          definicionFlujo.versionFamilia,
          definicionFlujo.contexto.nivel,
          definicionFlujo.contexto.tenantId,
          definicionFlujo.contexto.empresaId,
          definicionFlujo.contexto.sitioId,
          ahora,
          ahora
        ]
      );
      await conexion.execute(
        `INSERT INTO generaciones_flujos_federacion (
           generacion_id,flujo_id,ordinal,clase,estado,
           installation_propietaria_id,boot_propietario_id,
           version_propietario,version_estado,version_registro,
           creada_en_utc,actualizada_en_utc,finalizada_en_utc
         ) VALUES (?, ?, 1, ?, 'preparada', ?, ?, 1, 1, 1, ?, ?, NULL)`,
        [
          definicionGeneracion.generacionId,
          definicionFlujo.flujoId,
          definicionGeneracion.clase,
          definicionGeneracion.propietario.installationId,
          definicionGeneracion.propietario.bootId,
          ahora,
          ahora
        ]
      );
      await conexion.execute(
        `INSERT INTO fronteras_generaciones_federacion (
           generacion_id,posicion_inicial_comprometida,
           posicion_operativa_validada,posicion_historica_validada,
           sincronizando,operativamente_completa,historicamente_completa,
           parcial_por_scope,degradada,version_frontera,actualizada_en_utc
         ) VALUES (?, ?, NULL, NULL, TRUE, FALSE, FALSE, FALSE, FALSE, 1, ?)`,
        [
          definicionGeneracion.generacionId,
          definicionGeneracion.fronteraInicial,
          ahora
        ]
      );
      if (corteInicialPendiente) {
        await conexion.execute(
          `INSERT INTO cortes_iniciales_generaciones_federacion (
             flujo_id,generacion_id,estado,frontera_inicial,version_corte,
             preparado_en_utc,cerrado_en_utc,actualizado_en_utc
           ) VALUES (?,?,'pendiente',NULL,1,?,NULL,?)`,
          [
            definicionFlujo.flujoId,
            definicionGeneracion.generacionId,
            ahora,
            ahora
          ]
        );
      }
      await conexion.execute(
        `INSERT INTO propietarios_emision_flujos_federacion (
           flujo_id,generacion_id,version_propietario,
           installation_propietaria_id,boot_propietario_id,estado,
           adquirido_en_utc,finalizado_en_utc
         ) VALUES (?, ?, 1, ?, ?, 'vigente', ?, NULL)`,
        [
          definicionFlujo.flujoId,
          definicionGeneracion.generacionId,
          definicionGeneracion.propietario.installationId,
          definicionGeneracion.propietario.bootId,
          ahora
        ]
      );
      await conexion.execute(
        `UPDATE flujos_federacion
            SET generacion_activa_id=?,actualizada_en_utc=?
          WHERE flujo_id=?`,
        [definicionGeneracion.generacionId, ahora, definicionFlujo.flujoId]
      );
      return hidratarAgregado(
        await obtenerAgregadoBloqueado(conexion, definicionFlujo.flujoId)
      );
    });
  }

  async reemplazarPropietario({ flujoId, propietarioEsperado, nuevoPropietario } = {}) {
    const esperado = crearPropietarioEmisorFederacion(propietarioEsperado);
    const nuevo = crearPropietarioEmisorFederacion(nuevoPropietario);
    if (nuevo.version !== esperado.version + 1) {
      throw new ErrorFlujoFederacion(
        'salto_version_propietario_invalido',
        'El reemplazo debe incrementar exactamente una versión de propietario.'
      );
    }
    if (nuevo.installationId !== esperado.installationId) {
      throw new ErrorFlujoFederacion(
        'installation_propietaria_inmutable',
        'Reemplazar el proceso propietario no puede cambiar la instalación emisora.'
      );
    }
    return this.frontera.ejecutar(async (conexion) => {
      const agregado = await obtenerAgregadoBloqueado(conexion, String(flujoId));
      exigirPropietario(agregado, esperado);
      const [propietarios] = await conexion.execute(
        `SELECT fencing_token
           FROM propietarios_emision_flujos_federacion
          WHERE flujo_id=? AND version_propietario=? AND estado='vigente'
          FOR UPDATE`,
        [agregado.flujo_id, esperado.version]
      );
      if (propietarios.length !== 1) throw errorConcurrente();
      const ahora = await ahoraSql(conexion);
      const [finalizado] = await conexion.execute(
        `UPDATE propietarios_emision_flujos_federacion
            SET estado='sustituido',finalizado_en_utc=?,
                instancia_lease_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
                generacion_trabajo_id=NULL
          WHERE flujo_id=? AND version_propietario=? AND estado='vigente'`,
        [ahora, agregado.flujo_id, esperado.version]
      );
      if (finalizado.affectedRows !== 1) throw errorConcurrente();
      await conexion.execute(
         `INSERT INTO propietarios_emision_flujos_federacion (
           flujo_id,generacion_id,version_propietario,
           installation_propietaria_id,boot_propietario_id,estado,
           fencing_token,adquirido_en_utc,finalizado_en_utc
         ) VALUES (?, ?, ?, ?, ?, 'vigente', ?, ?, NULL)`,
        [
          agregado.flujo_id,
          agregado.generacion_id,
          nuevo.version,
          nuevo.installationId,
          nuevo.bootId,
          String(propietarios[0].fencing_token),
          ahora
        ]
      );
      const [flujoActualizado] = await conexion.execute(
        `UPDATE flujos_federacion SET version_propietario=?,
             version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND version_propietario=?`,
        [nuevo.version, ahora, agregado.flujo_id, esperado.version]
      );
      const [generacionActualizada] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET installation_propietaria_id=?,boot_propietario_id=?,
                version_propietario=?,version_registro=version_registro+1,
                actualizada_en_utc=?
          WHERE generacion_id=? AND version_propietario=?`,
        [
          nuevo.installationId,
          nuevo.bootId,
          nuevo.version,
          ahora,
          agregado.generacion_id,
          esperado.version
        ]
      );
      await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET installation_propietaria_id=?,boot_propietario_id=?,
                version_propietario=?,version_registro=version_registro+1,
                actualizada_en_utc=?
          WHERE flujo_id=? AND rol_generacion='candidata'
            AND version_propietario=?`,
        [
          nuevo.installationId,
          nuevo.bootId,
          nuevo.version,
          ahora,
          agregado.flujo_id,
          esperado.version
        ]
      );
      if (flujoActualizado.affectedRows !== 1 || generacionActualizada.affectedRows !== 1) {
        throw errorConcurrente();
      }
      return hidratarAgregado(
        await obtenerAgregadoBloqueado(conexion, agregado.flujo_id)
      );
    });
  }

  async avanzarGeneracion({
    flujoId,
    propietario,
    versionEstadoEsperada,
    versionFronteraEsperada,
    estadoGeneracion,
    estadoFlujo,
    frontera
  } = {}) {
    const token = crearPropietarioEmisorFederacion(propietario);
    exigirEstadoFlujoFederacion(estadoFlujo);
    const versionEstado = enteroPositivo(versionEstadoEsperada, 'versionEstadoEsperada');
    const versionFrontera = enteroPositivo(
      versionFronteraEsperada,
      'versionFronteraEsperada'
    );
    return this.frontera.ejecutar(async (conexion) => {
      const agregado = await obtenerAgregadoBloqueado(conexion, String(flujoId));
      exigirPropietario(agregado, token);
      if (Number(agregado.generacion_version_estado) !== versionEstado ||
          Number(agregado.version_frontera) !== versionFrontera) {
        throw errorConcurrente();
      }
      exigirTransicionGeneracionFederacion(agregado.generacion_estado, estadoGeneracion);
      const siguienteFrontera = normalizarFrontera({
        ...frontera,
        posicionInicial: agregado.posicion_inicial_comprometida
      });
      validarCoherenciaEstado({
        estadoGeneracion,
        estadoFlujo,
        frontera: siguienteFrontera
      });
      if (['cancelada', 'sustituida'].includes(estadoGeneracion)) {
        throw new ErrorFlujoFederacion(
          'sustitucion_generacion_no_disponible',
          'Finalizar la generación activa exige instalar o promover su sustituta.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const [cambioGeneracion] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET estado=?,version_estado=version_estado+1,
                version_registro=version_registro+1,actualizada_en_utc=?,
                finalizada_en_utc=?
          WHERE generacion_id=? AND version_estado=?
            AND version_propietario=?`,
        [
          estadoGeneracion,
          ahora,
          null,
          agregado.generacion_id,
          versionEstado,
          token.version
        ]
      );
      const [cambioFrontera] = await conexion.execute(
        `UPDATE fronteras_generaciones_federacion SET
            posicion_operativa_validada=?,posicion_historica_validada=?,
            sincronizando=?,operativamente_completa=?,
            historicamente_completa=?,parcial_por_scope=?,degradada=?,
            version_frontera=version_frontera+1,actualizada_en_utc=?
          WHERE generacion_id=? AND version_frontera=?`,
        [
          siguienteFrontera.posicionOperativa,
          siguienteFrontera.posicionHistorica,
          siguienteFrontera.sincronizando,
          siguienteFrontera.operativamenteCompleta,
          siguienteFrontera.historicamenteCompleta,
          siguienteFrontera.parcialPorScope,
          siguienteFrontera.degradada,
          ahora,
          agregado.generacion_id,
          versionFrontera
        ]
      );
      const [cambioFlujo] = await conexion.execute(
        `UPDATE flujos_federacion SET estado=?,version_estado=version_estado+1,
             version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND version_propietario=?`,
        [estadoFlujo, ahora, agregado.flujo_id, token.version]
      );
      if (cambioGeneracion.affectedRows !== 1 || cambioFrontera.affectedRows !== 1 ||
          cambioFlujo.affectedRows !== 1) {
        throw errorConcurrente();
      }
      return hidratarAgregado(
        await obtenerAgregadoBloqueado(conexion, agregado.flujo_id)
      );
    });
  }

  async prepararGeneracionConcesion({
    flujoId,
    generacionId,
    installationPropietariaId,
    bootPropietarioId,
    contexto,
    corteInicialPendiente = false
  } = {}) {
    const flujo = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.FLUJO, valor: String(flujoId || '')
    }));
    const generacion = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.GENERACION, valor: String(generacionId || '')
    }));
    const installation = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: String(installationPropietariaId || '')
    }));
    const boot = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.ARRANQUE, valor: String(bootPropietarioId || '')
    }));
    const contextoNormalizado = crearScopeFederacion(contexto).toJSON();
    return this.frontera.ejecutar(async (conexion) => {
      const [flujos] = await conexion.execute(
        'SELECT * FROM flujos_federacion WHERE flujo_id=? FOR UPDATE', [flujo]
      );
      const flujoPersistido = flujos[0];
      if (!flujoPersistido) {
        throw new ErrorFlujoFederacion('flujo_inexistente', 'El flujo no existe.');
      }
      const actual = flujoPersistido.generacion_activa_id
        ? await obtenerAgregadoBloqueado(conexion, flujo)
        : null;
      if (actual?.generacion_id === generacion) return hidratarAgregado(actual);
      const [predecesoras] = await conexion.execute(
        `SELECT generacion_id FROM generaciones_flujos_federacion
          WHERE flujo_id=? ORDER BY ordinal DESC LIMIT 1 FOR UPDATE`,
        [flujo]
      );
      const predecesoraId = actual?.generacion_id || predecesoras[0]?.generacion_id;
      if (!predecesoraId) {
        throw new ErrorFlujoFederacion(
          'predecesora_concesion_ausente',
          'Un flujo existente debe conservar la generación a la que sucede la revisión.'
        );
      }
      const relacion = await obtenerRelacionBloqueada(
        conexion, flujoPersistido.relacion_id
      );
      exigirRelacionOperativa({
        relacion,
        flujo: { direccion: flujoPersistido.direccion },
        propietario: { installationId: installation },
        installationLocalId: this.installationLocalId
      });
      const [repetida] = await conexion.execute(
        'SELECT generacion_id FROM generaciones_flujos_federacion WHERE generacion_id=? FOR UPDATE',
        [generacion]
      );
      if (repetida[0]) {
        throw new ErrorFlujoFederacion(
          'generacion_concesion_existente_no_activa',
          'La generación de la revisión ya existe, pero no gobierna el flujo.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const [propietarios] = await conexion.execute(
        `SELECT * FROM propietarios_emision_flujos_federacion
          WHERE flujo_id=? AND estado='vigente' FOR UPDATE`,
        [flujo]
      );
      const versionPropietario = Number(flujoPersistido.version_propietario) + 1;
      if (propietarios[0]) {
        await conexion.execute(
          `UPDATE propietarios_emision_flujos_federacion SET
             estado='sustituido',instancia_lease_id=NULL,lease_token=NULL,
             lease_expira_utc=NULL,generacion_trabajo_id=NULL,
             finalizado_en_utc=? WHERE id=?`,
          [ahora, propietarios[0].id]
        );
      }
      await conexion.execute(
        `UPDATE cortes_iniciales_generaciones_federacion SET
           estado='cancelado',version_corte=version_corte+1,
           cancelado_en_utc=?,actualizado_en_utc=?
         WHERE flujo_id=? AND generacion_id=? AND estado='pendiente'`,
        [ahora, ahora, flujo, predecesoraId]
      );
      await conexion.execute(
        `UPDATE cambios_pendientes_corte_federacion SET
           estado='descartada',descartada_en_utc=?
         WHERE flujo_id=? AND generacion_id=? AND estado='pendiente'`,
        [ahora, flujo, predecesoraId]
      );
      await conexion.execute(
        `UPDATE outbox_federacion SET estado='canceladaGeneracion',
           actualizada_en_utc=?,finalizada_en_utc=?
         WHERE flujo_id=? AND generacion_id=?
           AND estado IN ('pendiente','procesando','reintentable')`,
        [ahora, ahora, flujo, predecesoraId]
      );
      const [fencingAgotado] = await conexion.execute(
        `SELECT entrega_id FROM trabajos_materializacion_federacion
          WHERE flujo_id=? AND generacion_id=? AND estado='procesando'
            AND fencing_token=? LIMIT 1 FOR UPDATE`,
        [flujo, predecesoraId, MAX_BIGINT_UNSIGNED]
      );
      if (fencingAgotado[0]) {
        throw new ErrorFlujoFederacion(
          'fencing_materializacion_agotado',
          'La revisión no puede sustituir un trabajo cuyo fencing se agotó.'
        );
      }
      await conexion.execute(
        `UPDATE trabajos_materializacion_federacion SET
           fencing_token=IF(estado='procesando',fencing_token+1,fencing_token),
           estado='suprimida',causa_supresion='generacionSustituida',
           propietario_lease=NULL,lease_hasta_utc=NULL,
           ultimo_error_codigo=NULL,actualizado_en_utc=?
         WHERE flujo_id=? AND generacion_id=?
           AND estado IN ('pendiente','fallida','procesando')`,
        [ahora, flujo, predecesoraId]
      );
      await conexion.execute(
        `UPDATE generaciones_flujos_federacion SET estado='cancelada',
           rol_generacion='historica',version_estado=version_estado+1,
           version_registro=version_registro+1,actualizada_en_utc=?,
           finalizada_en_utc=? WHERE flujo_id=? AND generacion_id=?
           AND rol_generacion='activa'`,
        [ahora, ahora, flujo, predecesoraId]
      );
      const [ordinales] = await conexion.execute(
        'SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM generaciones_flujos_federacion WHERE flujo_id=?',
        [flujo]
      );
      await conexion.execute(
        `INSERT INTO generaciones_flujos_federacion (
           generacion_id,flujo_id,ordinal,clase,estado,rol_generacion,
           generacion_predecesora_id,estrategia_candidata,requiere_revalidacion,
           installation_propietaria_id,boot_propietario_id,version_propietario,
           version_estado,version_registro,creada_en_utc,actualizada_en_utc,
           finalizada_en_utc
         ) VALUES (?, ?, ?, 'resincronizacion','preparada','activa',
           ?,'sustituir',FALSE,?,?,?,1,1,?,?,NULL)`,
        [generacion, flujo, String(ordinales[0].ordinal), predecesoraId,
          installation, boot, versionPropietario, ahora, ahora]
      );
      await conexion.execute(
        `INSERT INTO fronteras_generaciones_federacion (
           generacion_id,posicion_inicial_comprometida,
           posicion_operativa_validada,posicion_historica_validada,
           sincronizando,operativamente_completa,historicamente_completa,
           parcial_por_scope,degradada,version_frontera,actualizada_en_utc
         ) VALUES (?,0,NULL,NULL,TRUE,FALSE,FALSE,FALSE,FALSE,1,?)`,
        [generacion, ahora]
      );
      if (corteInicialPendiente) {
        await conexion.execute(
          `INSERT INTO cortes_iniciales_generaciones_federacion (
             flujo_id,generacion_id,estado,frontera_inicial,version_corte,
             preparado_en_utc,cerrado_en_utc,cancelado_en_utc,actualizado_en_utc
           ) VALUES (?,?,'pendiente',NULL,1,?,NULL,NULL,?)`,
          [flujo, generacion, ahora, ahora]
        );
      }
      await conexion.execute(
        `INSERT INTO propietarios_emision_flujos_federacion (
           flujo_id,generacion_id,version_propietario,
           installation_propietaria_id,boot_propietario_id,estado,
           adquirido_en_utc,finalizado_en_utc
         ) VALUES (?,?,?,?,?,'vigente',?,NULL)`,
        [flujo, generacion, versionPropietario, installation, boot, ahora]
      );
      await conexion.execute(
        `UPDATE flujos_federacion SET generacion_activa_id=?,
           estado='sinSincronizar',estado_previo_resincronizacion=NULL,
           scope_nivel=?,scope_tenant_id=?,scope_empresa_id=?,scope_sitio_id=?,
           version_estado=version_estado+1,version_propietario=?,
           version_registro=version_registro+1,actualizada_en_utc=?
         WHERE flujo_id=?`,
        [generacion, contextoNormalizado.nivel, contextoNormalizado.tenantId,
          contextoNormalizado.empresaId, contextoNormalizado.sitioId,
          versionPropietario, ahora, flujo]
      );
      return hidratarAgregado(await obtenerAgregadoBloqueado(conexion, flujo));
    });
  }

  async obtener(flujoId) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const agregado = await obtenerAgregado(conexion, String(flujoId), false);
      return agregado ? hidratarAgregado(agregado) : null;
    } finally {
      conexion.release();
    }
  }
}

async function obtenerRelacionBloqueada(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT relacion_id,direccion,estado_ciclo,estado_autoridad,
            estado_identidad,estado_compatibilidad,installation_remota_id
       FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE`,
    [relacionId]
  );
  if (!filas[0]) {
    throw new ErrorFlujoFederacion('relacion_inexistente', 'La relación no existe.');
  }
  return filas[0];
}

function exigirRelacionOperativa({ relacion, flujo, propietario, installationLocalId }) {
  if (relacion.direccion !== flujo.direccion) {
    throw new ErrorFlujoFederacion(
      'direccion_incompatible',
      'El flujo no puede cambiar la dirección de su relación.'
    );
  }
  if (relacion.estado_ciclo !== 'vinculada' ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida' ||
      !['compatible', 'compatibleParcial'].includes(relacion.estado_compatibilidad)) {
    throw new ErrorFlujoFederacion(
      'relacion_no_operativa',
      'La relación todavía no autoriza crear trabajo durable de datos.'
    );
  }
  const installationEsperada = flujo.direccion === 'emision'
    ? installationLocalId
    : relacion.installation_remota_id;
  if (propietario.installationId !== installationEsperada) {
    throw new ErrorFlujoFederacion(
      'propietario_incompatible',
      'El propietario emisor no coincide con la dirección y contraparte de la relación.'
    );
  }
}

async function obtenerAgregadoBloqueado(conexion, flujoId) {
  const agregado = await obtenerAgregado(conexion, flujoId, true);
  if (!agregado) {
    throw new ErrorFlujoFederacion('flujo_inexistente', 'El flujo no existe.');
  }
  return agregado;
}

async function obtenerAgregado(conexion, flujoId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT f.*,g.generacion_id,g.ordinal AS generacion_ordinal,
            g.clase AS generacion_clase,g.estado AS generacion_estado,
            g.installation_propietaria_id,g.boot_propietario_id,
            g.version_propietario AS generacion_version_propietario,
            g.version_estado AS generacion_version_estado,
            b.posicion_inicial_comprometida,b.posicion_operativa_validada,
            b.posicion_historica_validada,b.sincronizando,
            b.operativamente_completa,b.historicamente_completa,
            b.parcial_por_scope,b.degradada,b.version_frontera
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=f.generacion_activa_id AND g.flujo_id=f.flujo_id
       JOIN fronteras_generaciones_federacion b
         ON b.generacion_id=g.generacion_id
      WHERE f.flujo_id=?${bloquear ? ' FOR UPDATE' : ''}`,
    [flujoId]
  );
  return filas[0] || null;
}

function exigirPropietario(agregado, propietario) {
  if (Number(agregado.version_propietario) !== propietario.version ||
      agregado.installation_propietaria_id !== propietario.installationId ||
      agregado.boot_propietario_id !== propietario.bootId ||
      Number(agregado.generacion_version_propietario) !== propietario.version) {
    throw new ErrorFlujoFederacion(
      'propietario_sustituido',
      'El escritor ya no es el propietario emisor efectivo de este flujo y generación.'
    );
  }
}

function normalizarFrontera(entrada = {}) {
  const posicionInicial = BigInt(entrada.posicionInicial);
  const posicionOperativa = posicionNullable(
    entrada.posicionOperativa,
    'frontera.posicionOperativa'
  );
  const posicionHistorica = posicionNullable(
    entrada.posicionHistorica,
    'frontera.posicionHistorica'
  );
  if ((posicionOperativa !== null && BigInt(posicionOperativa) > posicionInicial) ||
      (posicionHistorica !== null && BigInt(posicionHistorica) > posicionInicial)) {
    throw new ErrorFlujoFederacion(
      'frontera_fuera_del_corte',
      'Una frontera validada no puede superar el corte inicial comprometido.'
    );
  }
  return Object.freeze({
    posicionOperativa,
    posicionHistorica,
    sincronizando: booleano(entrada.sincronizando, 'frontera.sincronizando'),
    operativamenteCompleta: booleano(
      entrada.operativamenteCompleta,
      'frontera.operativamenteCompleta'
    ),
    historicamenteCompleta: booleano(
      entrada.historicamenteCompleta,
      'frontera.historicamenteCompleta'
    ),
    parcialPorScope: booleano(entrada.parcialPorScope, 'frontera.parcialPorScope'),
    degradada: booleano(entrada.degradada, 'frontera.degradada')
  });
}

function validarCoherenciaEstado({ estadoGeneracion, estadoFlujo, frontera }) {
  if (frontera.operativamenteCompleta && frontera.posicionOperativa === null) {
    throw new ErrorFlujoFederacion(
      'frontera_operativa_incompleta',
      'La completitud operativa exige una posición validada.'
    );
  }
  if (frontera.historicamenteCompleta &&
      (!frontera.operativamenteCompleta || frontera.sincronizando)) {
    throw new ErrorFlujoFederacion(
      'frontera_historica_incoherente',
      'La completitud histórica exige completitud operativa y fin de sincronización.'
    );
  }
  if (estadoGeneracion === 'fronteraOperativaValidada' &&
      !frontera.operativamenteCompleta) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'La generación declara una frontera operativa que todavía no validó.'
    );
  }
  if (estadoGeneracion === 'completa' && !frontera.historicamenteCompleta) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'Una generación completa debe haber completado su frontera histórica.'
    );
  }
  if (estadoFlujo === 'operativoCompleto' && !frontera.historicamenteCompleta) {
    throw new ErrorFlujoFederacion(
      'estado_flujo_incoherente',
      'Un flujo operativo completo debe alcanzar la frontera comprometida.'
    );
  }
  if (estadoFlujo === 'sincronizando' && !frontera.sincronizando) {
    throw new ErrorFlujoFederacion(
      'estado_flujo_incoherente',
      'Un flujo sincronizando debe conservar la condición de sincronización.'
    );
  }
  if (estadoFlujo === 'operativoParcial' &&
      (!frontera.operativamenteCompleta ||
        (frontera.historicamenteCompleta && !frontera.parcialPorScope))) {
    throw new ErrorFlujoFederacion(
      'estado_flujo_incoherente',
      'Un flujo operativo parcial necesita una frontera operativa con trabajo o contexto pendiente.'
    );
  }
  if (estadoFlujo === 'degradado' && !frontera.degradada) {
    throw new ErrorFlujoFederacion(
      'estado_flujo_incoherente',
      'Un flujo degradado debe declarar la dimensión degradada de su frontera.'
    );
  }
  if (estadoGeneracion === 'degradada' && !frontera.degradada) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'Una generación degradada debe declarar su condición degradada.'
    );
  }
}

function hidratarAgregado(fila) {
  return Object.freeze({
    flujoId: fila.flujo_id,
    relacionId: fila.relacion_id,
    direccion: fila.direccion,
    familia: fila.familia,
    versionFamilia: Number(fila.version_familia),
    contexto: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: decimal(fila.scope_tenant_id),
      empresaId: decimal(fila.scope_empresa_id),
      sitioId: decimal(fila.scope_sitio_id)
    }),
    estado: fila.estado,
    versionEstado: String(fila.version_estado),
    versionRegistro: String(fila.version_registro),
    generacion: Object.freeze({
      generacionId: fila.generacion_id,
      ordinal: String(fila.generacion_ordinal),
      clase: fila.generacion_clase,
      estado: fila.generacion_estado,
      versionEstado: String(fila.generacion_version_estado),
      propietario: Object.freeze({
        installationId: fila.installation_propietaria_id,
        bootId: fila.boot_propietario_id,
        version: Number(fila.generacion_version_propietario)
      }),
      frontera: Object.freeze({
        posicionInicial: String(fila.posicion_inicial_comprometida),
        posicionOperativa: decimal(fila.posicion_operativa_validada),
        posicionHistorica: decimal(fila.posicion_historica_validada),
        sincronizando: Boolean(fila.sincronizando),
        operativamenteCompleta: Boolean(fila.operativamente_completa),
        historicamenteCompleta: Boolean(fila.historicamente_completa),
        parcialPorScope: Boolean(fila.parcial_por_scope),
        degradada: Boolean(fila.degradada),
        version: String(fila.version_frontera)
      })
    })
  });
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function enteroPositivo(valor, campo) {
  if (!Number.isSafeInteger(Number(valor)) || Number(valor) < 1) {
    throw new ErrorFlujoFederacion('version_invalida', `${campo} no es válida.`);
  }
  return Number(valor);
}

function posicionNullable(valor, campo) {
  if (valor === null || valor === undefined) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(String(valor))) {
    throw new ErrorFlujoFederacion('posicion_invalida', `${campo} no es válida.`);
  }
  return String(valor);
}

function booleano(valor, campo) {
  if (typeof valor !== 'boolean') {
    throw new ErrorFlujoFederacion('condicion_invalida', `${campo} debe ser booleana.`);
  }
  return valor;
}

function decimal(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function errorConcurrente() {
  return new ErrorFlujoFederacion(
    'version_concurrente',
    'Otra operación modificó el flujo antes de completar esta transición.'
  );
}
