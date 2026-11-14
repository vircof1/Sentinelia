import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import {
  ErrorFlujoFederacion,
  crearDefinicionGeneracionFederacion,
  crearPropietarioEmisorFederacion,
  exigirTransicionGeneracionFederacion
} from '../src/FlujoFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

const ESTRATEGIAS = new Set([
  'esperar',
  'ampliarCompatible',
  'sustituir',
  'coexistir'
]);
const ESTADOS_TERMINALES = new Set(['cancelada', 'sustituida']);
const ESTADOS_ACTIVOS_ADMITIDOS = new Set([
  'fronteraOperativaValidada',
  'completa',
  'degradada'
]);
const MAX_BIGINT_UNSIGNED = '18446744073709551615';

export class RepositorioGeneracionesCandidatasFederacionSql {
  constructor(clienteSql, {
    installationLocalId,
    adaptadorAuditoriaReconstrucciones = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Las generaciones candidatas requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
    this.installationLocalId = identidad(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    if (adaptadorAuditoriaReconstrucciones !== null &&
        typeof adaptadorAuditoriaReconstrucciones?.registrarEnTransaccion !== 'function') {
      throw new Error('El adaptador de auditoría de reconstrucciones no es válido.');
    }
    this.adaptadorAuditoriaReconstrucciones = adaptadorAuditoriaReconstrucciones;
  }

  async resolver({
    flujoId,
    generacion,
    propietario,
    estrategia = 'coexistir',
    generacionObjetivoId = null,
    resincronizacionAutomatica = null,
    decisionManual = null
  } = {}) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const estrategiaNormalizada = normalizarEstrategia(estrategia);
    const definicion = generacion == null
      ? null
      : crearDefinicionGeneracionFederacion(generacion);
    const token = crearPropietarioEmisorFederacion(
      propietario ?? definicion?.propietario
    );
    return this.frontera.ejecutar(async (conexion) => {
      const contexto = await obtenerContextoBloqueado(conexion, flujo);
      exigirPropietario(contexto, token);
      const candidatas = await listarCandidatas(conexion, flujo, true);

      if (candidatas.length > 0 && estrategiaNormalizada === 'esperar') {
        await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
          accion: 'esperarCandidata',
          estrategia: estrategiaNormalizada,
          generacionId: null,
          generacionActivaResultanteId: contexto.generacion_activa_id
        });
        return resultadoResolucion('espera', null, candidatas);
      }
      if (estrategiaNormalizada === 'esperar') {
        throw new ErrorFlujoFederacion(
          'candidata_espera_inexistente',
          'No existe ninguna candidata cuya evolución pueda esperarse.'
        );
      }
      if (estrategiaNormalizada === 'ampliarCompatible') {
        const objetivoId = identidad(
          generacionObjetivoId,
          TIPOS_IDENTIDAD_FEDERADA.GENERACION,
          'generacionObjetivoId'
        );
        const objetivo = candidatas.find(
          ({ generacion_id: generacionId }) => generacionId === objetivoId
        );
        if (!objetivo) {
          throw new ErrorFlujoFederacion(
            'candidata_compatible_inexistente',
            'La ampliación compatible exige una candidata no terminal explícita.'
          );
        }
        await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
          accion: 'ampliarCandidata',
          estrategia: estrategiaNormalizada,
          generacionId: objetivo.generacion_id,
          generacionActivaResultanteId: contexto.generacion_activa_id
        });
        return resultadoResolucion('ampliacionCompatible', objetivo, candidatas);
      }
      if (!definicion) {
        throw new ErrorFlujoFederacion(
          'definicion_candidata_ausente',
          'Crear o sustituir una candidata exige su definición completa.'
        );
      }
      exigirDefinicionCandidata(definicion, contexto);
      const automatica = normalizarResincronizacionAutomatica(
        resincronizacionAutomatica,
        definicion
      );
      if (definicion.propietario.installationId !== token.installationId ||
          definicion.propietario.bootId !== token.bootId ||
          definicion.propietario.version !== token.version) {
        throw new ErrorFlujoFederacion(
          'propietario_candidata_divergente',
          'La candidata y la decisión deben declarar el mismo propietario vigente.'
        );
      }
      if (candidatas.length > 0 && estrategiaNormalizada === 'sustituir') {
        const ahora = await ahoraSql(conexion);
        for (const candidata of candidatas) {
          await cancelarCandidataEnTransaccion(
            conexion,
            contexto,
            candidata,
            ahora,
            'cancelada'
          );
        }
      }

      const ordinal = await siguienteOrdinal(conexion, flujo);
      const ahora = await ahoraSql(conexion);
      await conexion.execute(
        `INSERT INTO generaciones_flujos_federacion (
           generacion_id,flujo_id,ordinal,clase,estado,rol_generacion,
           generacion_predecesora_id,estrategia_candidata,
           installation_propietaria_id,boot_propietario_id,
           version_propietario,version_estado,version_registro,
           creada_en_utc,actualizada_en_utc,finalizada_en_utc
         ) VALUES (?,?,?,?,'preparada','candidata',?,?,?, ?,?,1,1,?,?,NULL)`,
        [
          definicion.generacionId,
          flujo,
          ordinal,
          definicion.clase,
          contexto.generacion_activa_id,
          estrategiaNormalizada,
          definicion.propietario.installationId,
          definicion.propietario.bootId,
          definicion.propietario.version,
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
         ) VALUES (?,0,NULL,NULL,TRUE,FALSE,FALSE,FALSE,FALSE,1,?)`,
        [definicion.generacionId, ahora]
      );
      await conexion.execute(
        `INSERT INTO cortes_iniciales_generaciones_federacion (
           flujo_id,generacion_id,estado,frontera_inicial,version_corte,
           preparado_en_utc,cerrado_en_utc,cancelado_en_utc,actualizado_en_utc
         ) VALUES (?,?,'pendiente',NULL,1,?,NULL,NULL,?)`,
        [flujo, definicion.generacionId, ahora, ahora]
      );
      if (automatica) {
        await conexion.execute(
          `INSERT INTO resincronizaciones_automaticas_federacion (
             generacion_id,flujo_id,generacion_predecesora_id,causa,
             detalle_canonico,estado,intentos_solicitud,
             solicitada_en_utc,actualizada_en_utc,finalizada_en_utc
           ) VALUES (?,?,?,?,?,'preparada',1,?,?,NULL)`,
          [
            definicion.generacionId,
            flujo,
            contexto.generacion_activa_id,
            automatica.causa,
            automatica.detalle === null
              ? null
              : JSON.stringify(automatica.detalle),
            ahora,
            ahora
          ]
        );
      }
      const primera = candidatas.length === 0;
      const [cambioFlujo] = await conexion.execute(
        `UPDATE flujos_federacion
            SET estado_previo_resincronizacion=IF(?,estado,estado_previo_resincronizacion),
                estado='resincronizando',version_estado=version_estado+1,
                version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND version_registro=?`,
        [primera, ahora, flujo, contexto.version_registro]
      );
      if (cambioFlujo.affectedRows !== 1) throw concurrente();
      const actualizadas = await listarCandidatas(conexion, flujo, true);
      const creada = actualizadas.find(
        ({ generacion_id: generacionId }) => generacionId === definicion.generacionId
      );
      await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
        accion: estrategiaNormalizada === 'sustituir'
          ? 'sustituirCandidatas'
          : 'iniciarReconstruccion',
        estrategia: estrategiaNormalizada,
        generacionId: definicion.generacionId,
        generacionActivaResultanteId: contexto.generacion_activa_id
      });
      return resultadoResolucion('creada', creada, actualizadas);
    });
  }

  async avanzar({
    flujoId,
    generacionId,
    propietario,
    versionEstadoEsperada,
    versionFronteraEsperada,
    estadoGeneracion,
    frontera
  } = {}) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const candidataId = identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    );
    const token = crearPropietarioEmisorFederacion(propietario);
    const versionEstado = enteroPositivo(versionEstadoEsperada, 'versionEstadoEsperada');
    const versionFrontera = enteroPositivo(
      versionFronteraEsperada,
      'versionFronteraEsperada'
    );
    return this.frontera.ejecutar(async (conexion) => {
      const contexto = await obtenerContextoBloqueado(conexion, flujo);
      exigirPropietario(contexto, token);
      const candidata = await obtenerCandidataBloqueada(conexion, flujo, candidataId);
      if (Number(candidata.version_estado) !== versionEstado ||
          Number(candidata.version_frontera) !== versionFrontera) {
        throw concurrente();
      }
      exigirTransicionGeneracionFederacion(candidata.estado, estadoGeneracion);
      if (ESTADOS_TERMINALES.has(estadoGeneracion)) {
        throw new ErrorFlujoFederacion(
          'finalizacion_candidata_exige_operacion',
          'Cancelar o promover una candidata exige su operación atómica dedicada.'
        );
      }
      const siguiente = normalizarFrontera({
        ...frontera,
        posicionInicial: candidata.posicion_inicial_comprometida
      });
      validarEstadoCandidata(estadoGeneracion, siguiente);
      const ahora = await ahoraSql(conexion);
      const [cambioGeneracion] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET estado=?,version_estado=version_estado+1,
                version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND generacion_id=? AND rol_generacion='candidata'
            AND version_estado=?`,
        [estadoGeneracion, ahora, flujo, candidataId, versionEstado]
      );
      const [cambioFrontera] = await conexion.execute(
        `UPDATE fronteras_generaciones_federacion SET
            posicion_operativa_validada=?,posicion_historica_validada=?,
            sincronizando=?,operativamente_completa=?,
            historicamente_completa=?,parcial_por_scope=?,degradada=?,
            version_frontera=version_frontera+1,actualizada_en_utc=?
          WHERE generacion_id=? AND version_frontera=?`,
        [
          siguiente.posicionOperativa,
          siguiente.posicionHistorica,
          siguiente.sincronizando,
          siguiente.operativamenteCompleta,
          siguiente.historicamenteCompleta,
          siguiente.parcialPorScope,
          siguiente.degradada,
          ahora,
          candidataId,
          versionFrontera
        ]
      );
      if (cambioGeneracion.affectedRows !== 1 || cambioFrontera.affectedRows !== 1) {
        throw concurrente();
      }
      await sincronizarEstadoAutomatico(
        conexion,
        candidataId,
        estadoGeneracion,
        ahora
      );
      return hidratarCandidata(
        await obtenerCandidataBloqueada(conexion, flujo, candidataId)
      );
    });
  }

  async cancelar({
    flujoId,
    generacionId,
    propietario,
    resultadoAutomatico = 'cancelada',
    decisionManual = null
  } = {}) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const candidataId = identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    );
    const token = crearPropietarioEmisorFederacion(propietario);
    return this.frontera.ejecutar(async (conexion) => {
      const contexto = await obtenerContextoBloqueado(conexion, flujo);
      exigirPropietario(contexto, token);
      const candidata = await obtenerCandidataBloqueada(conexion, flujo, candidataId);
      const ahora = await ahoraSql(conexion);
      await cancelarCandidataEnTransaccion(
        conexion,
        contexto,
        candidata,
        ahora,
        normalizarResultadoAutomatico(resultadoAutomatico)
      );
      const restantes = await listarCandidatas(conexion, flujo, true);
      if (restantes.length === 0) {
        await restaurarEstadoFlujo(conexion, contexto, ahora);
      }
      await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
        accion: 'cancelarCandidata',
        estrategia: candidata.estrategia_candidata,
        generacionId: candidataId,
        generacionActivaResultanteId: contexto.generacion_activa_id,
        efectivoEnUtc: ahora
      });
      return Object.freeze({
        resultado: 'cancelada',
        generacionId: candidataId,
        candidatasRestantes: Object.freeze(restantes.map(hidratarCandidata))
      });
    });
  }

  async revalidar({
    flujoId,
    generacionId,
    propietario,
    decisionManual = null
  } = {}) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const candidataId = identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    );
    const token = crearPropietarioEmisorFederacion(propietario);
    return this.frontera.ejecutar(async (conexion) => {
      const contexto = await obtenerContextoBloqueado(conexion, flujo);
      exigirPropietario(contexto, token);
      const candidata = await obtenerCandidataBloqueada(conexion, flujo, candidataId);
      if (!Boolean(candidata.requiere_revalidacion)) return hidratarCandidata(candidata);
      if (!Boolean(candidata.operativamente_completa)) {
        throw new ErrorFlujoFederacion(
          'candidata_no_revalidable',
          'La candidata debe volver a completar su frontera operativa antes de revalidarse.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const [resultado] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET generacion_predecesora_id=?,requiere_revalidacion=FALSE,
                version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND generacion_id=? AND rol_generacion='candidata'
            AND requiere_revalidacion=TRUE`,
        [contexto.generacion_activa_id, ahora, flujo, candidataId]
      );
      if (resultado.affectedRows !== 1) throw concurrente();
      await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
        accion: 'revalidarCandidata',
        estrategia: candidata.estrategia_candidata,
        generacionId: candidataId,
        generacionActivaResultanteId: contexto.generacion_activa_id,
        efectivoEnUtc: ahora
      });
      return hidratarCandidata(
        await obtenerCandidataBloqueada(conexion, flujo, candidataId)
      );
    });
  }

  async promover({
    flujoId,
    generacionId,
    propietario,
    decisionManual = null
  } = {}) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const candidataId = identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    );
    const token = crearPropietarioEmisorFederacion(propietario);
    return this.frontera.ejecutar(async (conexion) => {
      const contexto = await obtenerContextoBloqueado(conexion, flujo);
      exigirPropietario(contexto, token);
      const candidata = await obtenerCandidataBloqueada(conexion, flujo, candidataId);
      if (Boolean(candidata.requiere_revalidacion)) {
        throw new ErrorFlujoFederacion(
          'candidata_requiere_revalidacion',
          'La candidata fue validada contra una activa anterior y debe revalidarse.'
        );
      }
      if (!['fronteraOperativaValidada', 'completa'].includes(candidata.estado) ||
          !Boolean(candidata.operativamente_completa)) {
        throw new ErrorFlujoFederacion(
          'candidata_no_promovible',
          'La candidata debe acreditar una frontera operativa completa antes de gobernar.'
        );
      }
      if (candidata.estado_corte !== 'cerrado') {
        throw new ErrorFlujoFederacion(
          'corte_candidata_no_cerrado',
          'La candidata no puede promoverse con su fotografía abierta o cancelada.'
        );
      }
      const ahora = await ahoraSql(conexion);
      const siguienteVersion = Number(contexto.version_propietario) + 1;
      const [retiradaActiva] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET estado='sustituida',rol_generacion='historica',
                version_estado=version_estado+1,
                version_registro=version_registro+1,
                actualizada_en_utc=?,finalizada_en_utc=?
          WHERE flujo_id=? AND generacion_id=? AND rol_generacion='activa'`,
        [ahora, ahora, flujo, contexto.generacion_activa_id]
      );
      if (retiradaActiva.affectedRows !== 1) throw concurrente();
      await suprimirTrabajosMaterializacionGeneracion(
        conexion,
        flujo,
        contexto.generacion_activa_id,
        ahora
      );
      await cancelarOutboxGeneracion(
        conexion,
        flujo,
        contexto.generacion_activa_id,
        ahora
      );
      const [promocion] = await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET rol_generacion='activa',requiere_revalidacion=FALSE,
                version_propietario=?,
                version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND generacion_id=? AND rol_generacion='candidata'`,
        [siguienteVersion, ahora, flujo, candidataId]
      );
      if (promocion.affectedRows !== 1) throw concurrente();
      await conexion.execute(
        `UPDATE fronteras_generaciones_federacion b
          JOIN generaciones_flujos_federacion g
            ON g.generacion_id=b.generacion_id
           SET b.sincronizando=TRUE,b.operativamente_completa=FALSE,
               b.historicamente_completa=FALSE,b.degradada=TRUE,
               b.version_frontera=b.version_frontera+1,b.actualizada_en_utc=?
         WHERE g.flujo_id=? AND g.rol_generacion='candidata'
           AND b.operativamente_completa=TRUE`,
        [ahora, flujo]
      );
      await conexion.execute(
        `UPDATE generaciones_flujos_federacion
            SET estado=IF(
                  estado IN ('fronteraOperativaValidada','completa'),
                  'degradada',estado
                ),
                requiere_revalidacion=TRUE,
                installation_propietaria_id=?,boot_propietario_id=?,
                version_propietario=?,version_registro=version_registro+1,
                version_estado=version_estado+1,
                actualizada_en_utc=?
          WHERE flujo_id=? AND rol_generacion='candidata'`,
        [
          token.installationId,
          token.bootId,
          siguienteVersion,
          ahora,
          flujo
        ]
      );
      const propietarioVigente = await obtenerPropietarioBloqueado(conexion, flujo);
      const [cercado] = await conexion.execute(
        `UPDATE propietarios_emision_flujos_federacion
            SET estado='sustituido',instancia_lease_id=NULL,lease_token=NULL,
                lease_expira_utc=NULL,generacion_trabajo_id=NULL,
                finalizado_en_utc=?
          WHERE id=? AND estado='vigente'`,
        [ahora, propietarioVigente.id]
      );
      if (cercado.affectedRows !== 1) throw concurrente();
      await conexion.execute(
        `INSERT INTO propietarios_emision_flujos_federacion (
           flujo_id,generacion_id,generacion_trabajo_id,version_propietario,
           installation_propietaria_id,boot_propietario_id,estado,
           instancia_lease_id,lease_token,lease_expira_utc,
           fencing_token,intentos_lease,adquirido_en_utc,finalizado_en_utc
         ) VALUES (?,?,NULL,?,?,?,'vigente',NULL,NULL,NULL,?,0,?,NULL)`,
        [
          flujo,
          candidataId,
          siguienteVersion,
          token.installationId,
          token.bootId,
          String(propietarioVigente.fencing_token),
          ahora
        ]
      );
      const estadoFlujo = estadoFlujoPromovido(candidata);
      const [resumenCandidatas] = await conexion.execute(
        `SELECT COUNT(*) AS total FROM generaciones_flujos_federacion
          WHERE flujo_id=? AND rol_generacion='candidata'`,
        [flujo]
      );
      const quedanCandidatas = Number(resumenCandidatas[0].total) > 0;
      const estadoVisibleFlujo = quedanCandidatas ? 'resincronizando' : estadoFlujo;
      const [cambioFlujo] = await conexion.execute(
        `UPDATE flujos_federacion
            SET generacion_activa_id=?,estado=?,
                estado_previo_resincronizacion=?,
                version_propietario=?,version_estado=version_estado+1,
                version_registro=version_registro+1,actualizada_en_utc=?
          WHERE flujo_id=? AND generacion_activa_id=?
            AND version_propietario=?`,
        [
          candidataId,
          estadoVisibleFlujo,
          quedanCandidatas ? estadoFlujo : null,
          siguienteVersion,
          ahora,
          flujo,
          contexto.generacion_activa_id,
          token.version
        ]
      );
      if (cambioFlujo.affectedRows !== 1) throw concurrente();
      await finalizarEstadoAutomatico(conexion, candidataId, 'promovida', ahora);
      await testimoniarDecisionManual(this, conexion, contexto, decisionManual, {
        accion: 'promoverCandidata',
        estrategia: candidata.estrategia_candidata,
        generacionId: candidataId,
        generacionActivaResultanteId: candidataId,
        efectivoEnUtc: ahora
      });
      return Object.freeze({
        resultado: 'promovida',
        generacionActivaAnteriorId: contexto.generacion_activa_id,
        generacionActivaId: candidataId,
        versionPropietario: siguienteVersion,
        estadoFlujo: estadoVisibleFlujo,
        estadoOperativoActivo: estadoFlujo,
        candidatasRestantes: Object.freeze(
          (await listarCandidatas(conexion, flujo, true)).map(hidratarCandidata)
        )
      });
    });
  }

  async listar(flujoId) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return Object.freeze(
        (await listarCandidatas(conexion, flujo, false)).map(hidratarCandidata)
      );
    } finally {
      conexion.release();
    }
  }

  async obtenerResincronizacionAutomaticaActiva(flujoId) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const filas = await this.clienteSql.consultar(
      `SELECT r.generacion_id,r.flujo_id,r.generacion_predecesora_id,
              r.causa,r.detalle_canonico,r.estado AS estado_automatico,
              r.intentos_solicitud,r.solicitada_en_utc,r.actualizada_en_utc,
              g.ordinal,g.clase,g.estado AS estado_generacion,g.rol_generacion,
              g.estrategia_candidata,g.requiere_revalidacion,
              g.version_estado,g.version_registro,
              g.installation_propietaria_id,g.boot_propietario_id,
              g.version_propietario,
              b.posicion_inicial_comprometida,b.posicion_operativa_validada,
              b.posicion_historica_validada,b.sincronizando,
              b.operativamente_completa,b.historicamente_completa,
              b.parcial_por_scope,b.degradada,b.version_frontera,
              c.estado AS estado_corte
         FROM resincronizaciones_automaticas_federacion r
         JOIN generaciones_flujos_federacion g
           ON g.flujo_id=r.flujo_id AND g.generacion_id=r.generacion_id
         JOIN fronteras_generaciones_federacion b
           ON b.generacion_id=r.generacion_id
         LEFT JOIN cortes_iniciales_generaciones_federacion c
           ON c.flujo_id=r.flujo_id AND c.generacion_id=r.generacion_id
        WHERE r.flujo_id=? AND r.activa_unica=1 LIMIT 1`,
      [flujo]
    );
    return filas[0] ? hidratarAutomatica(filas[0]) : null;
  }

  async registrarReintentoResincronizacionAutomatica(flujoId) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE resincronizaciones_automaticas_federacion
          SET intentos_solicitud=intentos_solicitud+1,
              actualizada_en_utc=UTC_TIMESTAMP(3)
        WHERE flujo_id=? AND activa_unica=1`,
      [flujo]
    );
    return Number(resultado.affectedRows) === 1;
  }

  async resumirEntregaResincronizacionAutomatica(flujoId) {
    const flujo = identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId');
    const filas = await this.clienteSql.consultar(
      `SELECT r.generacion_id,c.estado AS estado_corte,
              b.posicion_inicial_comprometida,
              COUNT(o.id) AS total,
              COALESCE(SUM(o.prioridad='operativaActual'),0) AS operativas,
              COALESCE(SUM(
                o.prioridad='operativaActual'
                AND o.estado='confirmada'
              ),0) AS operativas_terminales,
              COALESCE(SUM(o.prioridad='operativaActual'
                AND o.estado='bloqueada'),0) AS operativas_bloqueadas,
              COALESCE(SUM(o.estado='confirmada'),0) AS terminales,
              COALESCE(SUM(o.estado='bloqueada'),0) AS bloqueadas
         FROM resincronizaciones_automaticas_federacion r
         JOIN fronteras_generaciones_federacion b
           ON b.generacion_id=r.generacion_id
         LEFT JOIN cortes_iniciales_generaciones_federacion c
           ON c.flujo_id=r.flujo_id AND c.generacion_id=r.generacion_id
         LEFT JOIN outbox_federacion o
           ON o.flujo_id=r.flujo_id AND o.generacion_id=r.generacion_id
        WHERE r.flujo_id=? AND r.activa_unica=1
        GROUP BY r.generacion_id,c.estado,b.posicion_inicial_comprometida`,
      [flujo]
    );
    if (!filas[0]) return null;
    const fila = filas[0];
    const total = Number(fila.total);
    const operativas = Number(fila.operativas);
    const operativasTerminales = Number(fila.operativas_terminales);
    const operativasBloqueadas = Number(fila.operativas_bloqueadas);
    const terminales = Number(fila.terminales);
    const bloqueadas = Number(fila.bloqueadas);
    return Object.freeze({
      generacionId: fila.generacion_id,
      estadoCorte: fila.estado_corte,
      fronteraInicial: String(fila.posicion_inicial_comprometida),
      total,
      operativas,
      operativasTerminales,
      operativasBloqueadas,
      terminales,
      bloqueadas,
      operativaCompleta: fila.estado_corte === 'cerrado' &&
        operativasBloqueadas === 0 && operativasTerminales === operativas,
      historicaCompleta: fila.estado_corte === 'cerrado' &&
        bloqueadas === 0 && terminales === total
    });
  }
}

async function obtenerContextoBloqueado(conexion, flujoId) {
  const [filas] = await conexion.execute(
    `SELECT f.*,g.estado AS estado_generacion_activa,
            g.installation_propietaria_id,g.boot_propietario_id,
            g.version_propietario AS generacion_version_propietario
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=f.generacion_activa_id
      WHERE f.flujo_id=? FOR UPDATE`,
    [flujoId]
  );
  if (!filas[0]) {
    throw new ErrorFlujoFederacion('flujo_inexistente', 'El flujo no existe.');
  }
  if (!ESTADOS_ACTIVOS_ADMITIDOS.has(filas[0].estado_generacion_activa)) {
    throw new ErrorFlujoFederacion(
      'generacion_activa_no_sustituible',
      'La generación activa todavía no ofrece una frontera utilizable que conservar.'
    );
  }
  await obtenerPropietarioBloqueado(conexion, flujoId);
  return filas[0];
}

async function obtenerPropietarioBloqueado(conexion, flujoId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM propietarios_emision_flujos_federacion
      WHERE flujo_id=? AND estado='vigente' FOR UPDATE`,
    [flujoId]
  );
  if (filas.length !== 1) throw concurrente();
  return filas[0];
}

function exigirPropietario(contexto, entrada) {
  const propietario = entrada?.installationId
    ? crearPropietarioEmisorFederacion(entrada)
    : entrada;
  if (!propietario ||
      propietario.installationId !== contexto.installation_propietaria_id ||
      propietario.bootId !== contexto.boot_propietario_id ||
      propietario.version !== Number(contexto.version_propietario) ||
      propietario.version !== Number(contexto.generacion_version_propietario)) {
    throw new ErrorFlujoFederacion(
      'propietario_sustituido',
      'El escritor ya no gobierna el flujo y sus generaciones candidatas.'
    );
  }
}

function exigirDefinicionCandidata(definicion, contexto) {
  if (definicion.clase === 'inicial' || definicion.fronteraInicial !== '0') {
    throw new ErrorFlujoFederacion(
      'definicion_candidata_invalida',
      'Una candidata debe ser una resincronización o reconstrucción con frontera inicial cero.'
    );
  }
  exigirPropietario(contexto, definicion.propietario);
}

async function listarCandidatas(conexion, flujoId, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT g.*,b.posicion_inicial_comprometida,
            b.posicion_operativa_validada,b.posicion_historica_validada,
            b.sincronizando,b.operativamente_completa,
            b.historicamente_completa,b.parcial_por_scope,b.degradada,
            b.version_frontera,c.estado AS estado_corte
       FROM generaciones_flujos_federacion g
       JOIN fronteras_generaciones_federacion b
         ON b.generacion_id=g.generacion_id
       LEFT JOIN cortes_iniciales_generaciones_federacion c
         ON c.flujo_id=g.flujo_id AND c.generacion_id=g.generacion_id
      WHERE g.flujo_id=? AND g.rol_generacion='candidata'
      ORDER BY g.ordinal${bloquear ? ' FOR UPDATE' : ''}`,
    [flujoId]
  );
  return filas;
}

async function obtenerCandidataBloqueada(conexion, flujoId, generacionId) {
  const candidatas = await listarCandidatas(conexion, flujoId, true);
  const candidata = candidatas.find(
    ({ generacion_id: identidadCandidata }) => identidadCandidata === generacionId
  );
  if (!candidata) {
    throw new ErrorFlujoFederacion(
      'candidata_inexistente',
      'La generación no es una candidata vigente de este flujo.'
    );
  }
  return candidata;
}

async function siguienteOrdinal(conexion, flujoId) {
  const [filas] = await conexion.execute(
    `SELECT COALESCE(MAX(ordinal),0)+1 AS siguiente
       FROM generaciones_flujos_federacion WHERE flujo_id=?`,
    [flujoId]
  );
  return String(filas[0].siguiente);
}

async function cancelarCandidataEnTransaccion(
  conexion,
  contexto,
  candidata,
  ahora,
  resultadoAutomatico = 'cancelada'
) {
  exigirTransicionGeneracionFederacion(candidata.estado, 'cancelada');
  const [cancelada] = await conexion.execute(
    `UPDATE generaciones_flujos_federacion
        SET estado='cancelada',rol_generacion='historica',
            version_estado=version_estado+1,version_registro=version_registro+1,
            actualizada_en_utc=?,finalizada_en_utc=?
      WHERE flujo_id=? AND generacion_id=? AND rol_generacion='candidata'`,
    [ahora, ahora, contexto.flujo_id, candidata.generacion_id]
  );
  if (cancelada.affectedRows !== 1) throw concurrente();
  if (candidata.estado_corte === 'pendiente') {
    await conexion.execute(
      `UPDATE cortes_iniciales_generaciones_federacion
          SET estado='cancelado',version_corte=version_corte+1,
              cancelado_en_utc=?,actualizado_en_utc=?
        WHERE flujo_id=? AND generacion_id=? AND estado='pendiente'`,
      [ahora, ahora, contexto.flujo_id, candidata.generacion_id]
    );
    await conexion.execute(
      `UPDATE cambios_pendientes_corte_federacion
          SET estado='descartada',descartada_en_utc=?
        WHERE flujo_id=? AND generacion_id=? AND estado='pendiente'`,
      [ahora, contexto.flujo_id, candidata.generacion_id]
    );
  }
  await cancelarOutboxGeneracion(
    conexion,
    contexto.flujo_id,
    candidata.generacion_id,
    ahora
  );
  await suprimirTrabajosMaterializacionGeneracion(
    conexion,
    contexto.flujo_id,
    candidata.generacion_id,
    ahora
  );
  await conexion.execute(
    `UPDATE propietarios_emision_flujos_federacion
        SET instancia_lease_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
            generacion_trabajo_id=NULL,fencing_token=fencing_token+1
      WHERE flujo_id=? AND estado='vigente' AND generacion_trabajo_id=?`,
    [contexto.flujo_id, candidata.generacion_id]
  );
  await finalizarEstadoAutomatico(
    conexion,
    candidata.generacion_id,
    resultadoAutomatico,
    ahora
  );
}

async function cancelarOutboxGeneracion(conexion, flujoId, generacionId, ahora) {
  await conexion.execute(
    `UPDATE outbox_federacion
        SET estado='canceladaGeneracion',actualizada_en_utc=?,finalizada_en_utc=?
      WHERE flujo_id=? AND generacion_id=?
        AND estado IN ('pendiente','procesando','reintentable')`,
    [ahora, ahora, flujoId, generacionId]
  );
}

async function suprimirTrabajosMaterializacionGeneracion(
  conexion,
  flujoId,
  generacionId,
  ahora
) {
  const [agotados] = await conexion.execute(
    `SELECT entrega_id FROM trabajos_materializacion_federacion
      WHERE flujo_id=? AND generacion_id=? AND estado='procesando'
        AND fencing_token=? LIMIT 1 FOR UPDATE`,
    [flujoId, generacionId, MAX_BIGINT_UNSIGNED]
  );
  if (agotados[0]) {
    throw new ErrorFlujoFederacion(
      'fencing_materializacion_agotado',
      'La generación no puede cerrarse con un trabajo cuyo fencing se agotó.'
    );
  }
  await conexion.execute(
    `UPDATE trabajos_materializacion_federacion
        SET fencing_token=IF(estado='procesando',fencing_token+1,fencing_token),
            estado='suprimida',causa_supresion='generacionSustituida',
            propietario_lease=NULL,lease_hasta_utc=NULL,
            ultimo_error_codigo=NULL,actualizado_en_utc=?
      WHERE flujo_id=? AND generacion_id=?
        AND estado IN ('pendiente','fallida','procesando')`,
    [ahora, flujoId, generacionId]
  );
}

async function restaurarEstadoFlujo(conexion, contexto, ahora) {
  const estado = contexto.estado_previo_resincronizacion;
  if (!estado || estado === 'resincronizando') {
    throw new ErrorFlujoFederacion(
      'estado_previo_resincronizacion_ausente',
      'El flujo perdió el estado que debía recuperar al cancelar sus candidatas.'
    );
  }
  const [resultado] = await conexion.execute(
    `UPDATE flujos_federacion
        SET estado=?,estado_previo_resincronizacion=NULL,
            version_estado=version_estado+1,version_registro=version_registro+1,
            actualizada_en_utc=?
      WHERE flujo_id=? AND estado='resincronizando'`,
    [estado, ahora, contexto.flujo_id]
  );
  if (resultado.affectedRows !== 1) throw concurrente();
}

function resultadoResolucion(resultado, candidata, candidatas) {
  return Object.freeze({
    resultado,
    candidata: candidata ? hidratarCandidata(candidata) : null,
    candidatas: Object.freeze(candidatas.map(hidratarCandidata))
  });
}

function hidratarCandidata(fila) {
  return Object.freeze({
    generacionId: fila.generacion_id,
    flujoId: fila.flujo_id,
    ordinal: String(fila.ordinal),
    clase: fila.clase,
    estado: fila.estado,
    rol: fila.rol_generacion,
    generacionPredecesoraId: fila.generacion_predecesora_id,
    estrategia: fila.estrategia_candidata,
    requiereRevalidacion: Boolean(fila.requiere_revalidacion),
    versionEstado: String(fila.version_estado),
    versionRegistro: String(fila.version_registro),
    estadoCorte: fila.estado_corte,
    propietario: Object.freeze({
      installationId: fila.installation_propietaria_id,
      bootId: fila.boot_propietario_id,
      version: Number(fila.version_propietario)
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
  });
}

const CAUSAS_RESINCRONIZACION_AUTOMATICA = new Set([
  'timeout',
  'apagado',
  'confirmacionPerdida',
  'huecoRecuperable',
  'interrupcionRecuperable',
  'incoherenciaRecuperable'
]);

const RESULTADOS_DECISION_MANUAL = Object.freeze({
  iniciarReconstruccion: 'creada',
  esperarCandidata: 'espera',
  ampliarCandidata: 'ampliada',
  sustituirCandidatas: 'sustituida',
  cancelarCandidata: 'cancelada',
  promoverCandidata: 'promovida',
  revalidarCandidata: 'revalidada'
});

async function testimoniarDecisionManual(
  repositorio,
  conexion,
  contexto,
  entrada,
  operacion
) {
  if (entrada === null || entrada === undefined) return null;
  if (!repositorio.adaptadorAuditoriaReconstrucciones) {
    throw new ErrorFlujoFederacion(
      'auditoria_reconstruccion_ausente',
      'Una decisión humana de reconstrucción exige auditoría transaccional.'
    );
  }
  const decision = normalizarDecisionManual(entrada);
  const actorUsuarioId = decision.actor.real.id;
  const [usuarios] = await conexion.execute(
    `SELECT activo,tenant_id,empresa_id,sitio_id,
            permiso_configurar_emisiones_federacion,
            permiso_configurar_recepciones_federacion
       FROM usuarios WHERE id=? FOR UPDATE`,
    [actorUsuarioId]
  );
  const usuario = usuarios[0];
  const permiso = contexto.direccion === 'emision'
    ? usuario?.permiso_configurar_emisiones_federacion
    : usuario?.permiso_configurar_recepciones_federacion;
  if (!usuario || !Boolean(usuario.activo) || !Boolean(permiso) ||
      !scopeUsuarioCubreFlujo(usuario, contexto)) {
    throw new ErrorFlujoFederacion(
      'autoridad_reconstruccion_insuficiente',
      'El usuario actual ya no posee permiso y scope sobre el flujo.'
    );
  }
  const [relaciones] = await conexion.execute(
    `SELECT estado_ciclo,estado_autoridad,estado_identidad,
            estado_compatibilidad
       FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE`,
    [contexto.relacion_id]
  );
  const relacion = relaciones[0];
  if (!relacion || relacion.estado_ciclo !== 'vinculada' ||
      relacion.estado_autoridad !== 'autorizada' ||
      relacion.estado_identidad !== 'valida' ||
      !['compatible', 'compatibleParcial'].includes(relacion.estado_compatibilidad)) {
    throw new ErrorFlujoFederacion(
      'relacion_reconstruccion_no_operativa',
      'La relación dejó de autorizar decisiones de reconstrucción.'
    );
  }
  const scope = Object.freeze({
    tenantId: decimal(contexto.scope_tenant_id),
    empresaId: decimal(contexto.scope_empresa_id),
    sitioId: decimal(contexto.scope_sitio_id)
  });
  const efectivoEnUtc = operacion.efectivoEnUtc ?? await ahoraSql(conexion);
  await repositorio.adaptadorAuditoriaReconstrucciones.registrarEnTransaccion({
    ...decision,
    ...operacion,
    flujoId: contexto.flujo_id,
    scope,
    efectivoEnUtc
  }, { conexion });
  await conexion.execute(
    `INSERT INTO decisiones_reconstrucciones_federacion (
       evento_auditoria_id,correlacion_id,flujo_id,generacion_id,
       generacion_activa_anterior_id,generacion_activa_resultante_id,
       accion,estrategia,resultado,actor_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,motivo,decidida_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuidV7AuditoriaABytes(decision.eventoId),
      uuidV7AuditoriaABytes(decision.correlacionId),
      contexto.flujo_id,
      operacion.generacionId,
      contexto.generacion_activa_id,
      operacion.generacionActivaResultanteId,
      operacion.accion,
      operacion.estrategia,
      RESULTADOS_DECISION_MANUAL[operacion.accion],
      actorUsuarioId,
      scope.tenantId,
      scope.empresaId,
      scope.sitioId,
      decision.motivo,
      efectivoEnUtc
    ]
  );
  return true;
}

function normalizarDecisionManual(entrada) {
  if (entrada.actor?.modo !== 'directo' ||
      entrada.actor?.efectivo !== null ||
      entrada.actor?.real?.tipo !== 'usuario' ||
      !/^[1-9][0-9]*$/u.test(String(entrada.actor?.real?.id || ''))) {
    throw new ErrorFlujoFederacion(
      'actor_reconstruccion_invalido',
      'La reconstrucción exige una sesión humana directa identificable.'
    );
  }
  const motivo = entrada.motivo == null ? null : String(entrada.motivo).trim();
  if (motivo !== null && (motivo.length < 3 || motivo.length > 500)) {
    throw new ErrorFlujoFederacion(
      'motivo_reconstruccion_invalido',
      'El motivo debe contener entre 3 y 500 caracteres.'
    );
  }
  return Object.freeze({
    eventoId: String(entrada.eventoId || ''),
    correlacionId: String(entrada.correlacionId || ''),
    actor: Object.freeze({
      real: Object.freeze({ tipo: 'usuario', id: String(entrada.actor.real.id) }),
      efectivo: null,
      modo: 'directo'
    }),
    motivo
  });
}

function scopeUsuarioCubreFlujo(usuario, flujo) {
  const tenantUsuario = decimal(usuario.tenant_id);
  const empresaUsuario = decimal(usuario.empresa_id);
  const sitioUsuario = decimal(usuario.sitio_id);
  const tenantFlujo = decimal(flujo.scope_tenant_id);
  const empresaFlujo = decimal(flujo.scope_empresa_id);
  const sitioFlujo = decimal(flujo.scope_sitio_id);
  if (tenantUsuario === null) return empresaUsuario === null && sitioUsuario === null;
  if (tenantUsuario !== tenantFlujo) return false;
  if (empresaUsuario === null) return sitioUsuario === null;
  if (empresaUsuario !== empresaFlujo) return false;
  if (sitioUsuario === null) return true;
  return sitioUsuario === sitioFlujo;
}

function normalizarResincronizacionAutomatica(entrada, definicion) {
  if (entrada === null || entrada === undefined) return null;
  if (definicion.clase !== 'resincronizacion') {
    throw new ErrorFlujoFederacion(
      'clase_resincronizacion_automatica_invalida',
      'Una solicitud automática solo puede crear una resincronización.'
    );
  }
  const causa = String(entrada.causa || '');
  if (!CAUSAS_RESINCRONIZACION_AUTOMATICA.has(causa)) {
    throw new ErrorFlujoFederacion(
      'causa_resincronizacion_automatica_invalida',
      'La causa automática no pertenece al catálogo cerrado.'
    );
  }
  const detalle = entrada.detalle ?? null;
  let detalleSerializado = null;
  try {
    detalleSerializado = detalle === null ? null : JSON.stringify(detalle);
  } catch {
    detalleSerializado = null;
  }
  if (detalle !== null && (
    typeof detalle !== 'object' || Array.isArray(detalle) ||
    detalleSerializado === null || detalleSerializado.length > 4096
  )) {
    throw new ErrorFlujoFederacion(
      'detalle_resincronizacion_automatica_invalido',
      'El detalle automático debe ser un objeto JSON acotado y serializable.'
    );
  }
  return Object.freeze({ causa, detalle });
}

function normalizarResultadoAutomatico(valor) {
  if (!['cancelada', 'fallida'].includes(valor)) {
    throw new ErrorFlujoFederacion(
      'resultado_resincronizacion_automatica_invalido',
      'La finalización automática debe ser cancelada o fallida.'
    );
  }
  return valor;
}

async function sincronizarEstadoAutomatico(conexion, generacionId, estado, ahora) {
  if (!['transfiriendo', 'fronteraOperativaValidada', 'completa'].includes(estado)) {
    return;
  }
  await conexion.execute(
    `UPDATE resincronizaciones_automaticas_federacion
        SET estado=?,actualizada_en_utc=?
      WHERE generacion_id=? AND activa_unica=1`,
    [estado, ahora, generacionId]
  );
}

async function finalizarEstadoAutomatico(conexion, generacionId, estado, ahora) {
  await conexion.execute(
    `UPDATE resincronizaciones_automaticas_federacion
        SET estado=?,actualizada_en_utc=?,finalizada_en_utc=?
      WHERE generacion_id=? AND activa_unica=1`,
    [estado, ahora, ahora, generacionId]
  );
}

function hidratarAutomatica(fila) {
  const detalle = fila.detalle_canonico === null
    ? null
    : typeof fila.detalle_canonico === 'string'
      ? JSON.parse(fila.detalle_canonico)
      : fila.detalle_canonico;
  return Object.freeze({
    generacionId: fila.generacion_id,
    flujoId: fila.flujo_id,
    generacionPredecesoraId: fila.generacion_predecesora_id,
    causa: fila.causa,
    detalle: detalle === null ? null : Object.freeze(detalle),
    estado: fila.estado_automatico,
    intentosSolicitud: Number(fila.intentos_solicitud),
    candidata: hidratarCandidata({
      ...fila,
      estado: fila.estado_generacion
    })
  });
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
      'Una frontera candidata no puede superar su corte inicial comprometido.'
    );
  }
  return Object.freeze({
    posicionInicial: String(entrada.posicionInicial),
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

function validarEstadoCandidata(estado, frontera) {
  if (frontera.operativamenteCompleta && frontera.posicionOperativa === null) {
    throw new ErrorFlujoFederacion(
      'frontera_operativa_incompleta',
      'La completitud operativa candidata exige una posición validada.'
    );
  }
  if (frontera.historicamenteCompleta &&
      (!frontera.operativamenteCompleta || frontera.sincronizando ||
       frontera.posicionHistorica !== String(frontera.posicionInicial))) {
    throw new ErrorFlujoFederacion(
      'frontera_historica_incoherente',
      'La completitud histórica candidata exige todo el corte y fin de sincronización.'
    );
  }
  if (estado === 'fronteraOperativaValidada' && !frontera.operativamenteCompleta) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'La candidata aún no validó su frontera operativa.'
    );
  }
  if (estado === 'completa' && !frontera.historicamenteCompleta) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'La candidata completa debe acreditar su frontera histórica.'
    );
  }
  if (estado === 'degradada' && !frontera.degradada) {
    throw new ErrorFlujoFederacion(
      'estado_generacion_incoherente',
      'La candidata degradada debe declarar esa dimensión.'
    );
  }
}

function estadoFlujoPromovido(candidata) {
  if (Boolean(candidata.historicamente_completa) &&
      !Boolean(candidata.parcial_por_scope)) return 'operativoCompleto';
  return 'operativoParcial';
}

function normalizarEstrategia(valor) {
  const estrategia = String(valor || '');
  if (!ESTRATEGIAS.has(estrategia)) {
    throw new ErrorFlujoFederacion(
      'estrategia_candidata_invalida',
      'La decisión debe ser esperar, ampliarCompatible, sustituir o coexistir.'
    );
  }
  return estrategia;
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorFlujoFederacion(
      'identidad_invalida',
      `${campo} no es una identidad federada canónica: ${error.message}`
    );
  }
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

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function concurrente() {
  return new ErrorFlujoFederacion(
    'version_concurrente',
    'Otra operación modificó el flujo o la candidata concurrentemente.'
  );
}
