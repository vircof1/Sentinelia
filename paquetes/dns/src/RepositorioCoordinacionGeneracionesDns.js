import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { sanearDiagnosticoOperacionDurable } from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  CAUSAS_PUBLICACION_DNS,
  ESTADOS_PUBLICACION_DNS
} from './EstadosPublicacionDns.js';
import { ConsolidadorPublicacionDdnsSql } from './ConsolidadorPublicacionDdnsSql.js';
import { construirIntencionAuditoriaDdns } from './EventosAuditoriaDdnsAgentes.js';
import { normalizarFotografiaZonasDns, consolidarPublicacionZonasDns } from './FotografiaPublicacionZonasDns.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;
const PERFIL_PROYECCION = 'sentinelia-bind-proyeccion-v1';

export class RepositorioCoordinacionGeneracionesDns {
  constructor({
    clienteSql,
    registradorObligaciones = null,
    repositorioOutboxAuditoria = registradorObligaciones?.repositorioOutbox ?? null,
    bloquearCatalogoEnTransaccion,
    consolidadorPublicacionDdns = new ConsolidadorPublicacionDdnsSql({
      repositorioOutbox: registradorObligaciones?.repositorioOutbox ?? null
    })
  } = {}) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('La coordinación DNS durable requiere SQL operativo.');
    }
    if (typeof bloquearCatalogoEnTransaccion !== 'function') {
      throw new Error('La coordinación DNS requiere el bloqueo canónico del catálogo.');
    }
    if (typeof consolidadorPublicacionDdns?.consolidarEnTransaccion !== 'function') {
      throw new Error('La coordinación DNS requiere consolidación DDNS transaccional.');
    }
    if (repositorioOutboxAuditoria !== null &&
        typeof repositorioOutboxAuditoria?.encolarEnTransaccion !== 'function') {
      throw new Error('La coordinación DNS requiere una outbox auditable válida.');
    }
    this.clienteSql = clienteSql;
    this.registradorObligaciones = registradorObligaciones;
    this.repositorioOutboxAuditoria = repositorioOutboxAuditoria;
    this.bloquearCatalogoEnTransaccion = bloquearCatalogoEnTransaccion;
    this.consolidadorPublicacionDdns = consolidadorPublicacionDdns;
  }

  async asegurarReconciliacionInicial({ maxIntentos = 3 } = {}) {
    const maximo = entero(maxIntentos, 1, 100, 'maxIntentos');
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      if (reconciliacion) {
        const operaciones = await bloquearOperaciones(conexion);
        await superarPendientesAnteriores(
          conexion,
          operaciones,
          cabecera.ultimaGeneracionDns
        );
        return Object.freeze({
          creada: false,
          reconciliacion,
          operacion: await buscarOperacion(conexion, reconciliacion.generacionObjetivo)
        });
      }
      const operaciones = await bloquearOperaciones(conexion);
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await superarPendientesAnteriores(conexion, operaciones, generacion);
      await insertarOperacion(conexion, {
        generacionDns: generacion,
        causa: CAUSAS_PUBLICACION_DNS.RECONCILIACION_INICIAL,
        generacionRaizRecuperacion: generacion
      });
      await conexion.execute(
        `INSERT INTO reconciliacion_inicial_dns (
           id, estado, generacion_objetivo, intentos, max_intentos,
           proximo_intento_utc, creada_en_utc, actualizada_en_utc
         ) VALUES (1, 'activa', ?, 0, ?, UTC_TIMESTAMP(3),
           UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [generacion, maximo]
      );
      return Object.freeze({
        creada: true,
        reconciliacion: await bloquearReconciliacion(conexion),
        operacion: await buscarOperacion(conexion, generacion)
      });
    });
  }

  async crearGeneracionPorMutacionEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    await this.#bloquearCatalogo(conexion);
    const cabecera = await bloquearCabecera(conexion);
    const reconciliacion = await bloquearReconciliacion(conexion);
    const operaciones = await bloquearOperaciones(conexion);
    const generacion = await avanzarGeneracion(conexion, cabecera);
    await superarPendientesAnteriores(conexion, operaciones, generacion);
    await insertarOperacion(conexion, {
      generacionDns: generacion,
      causa: CAUSAS_PUBLICACION_DNS.MUTACION_CATALOGO,
      generacionRaizRecuperacion: generacion
    });
    await trasladarReconciliacion(conexion, reconciliacion, generacion);
    return buscarOperacion(conexion, generacion);
  }

  async crearGeneracionPorMutacionAtomica() {
    return this.#enTransaccion((conexion) =>
      this.crearGeneracionPorMutacionEnTransaccion({ conexion })
    );
  }

  // Reparación idempotente de catálogos publicados antes de disponer de esta
  // lectura. Se vuelve a confirmar mediante el publicador normal; no se marca
  // como publicada una zona basándose solamente en su intención SQL.
  async asegurarLecturaPublicacionZonas() {
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      const [zonas] = await conexion.execute(
        'SELECT id FROM zonas_dns WHERE generacion_aplicada_bind IS NULL LIMIT 1'
      );
      if (!zonas.length || operaciones.some((op) =>
        ['pendiente', 'efecto_iniciado', 'recarga_confirmada', 'recuperacion_pendiente'].includes(op.estado)
      )) return null;
      // Un fallo operativo no debe generar reintentos ilimitados al reiniciar.
      const actual = operaciones.find((op) => op.generacionDns === cabecera.ultimaGeneracionDns);
      if (actual && !['consolidada', 'sin_cambios'].includes(actual.estado)) return null;
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await insertarOperacion(conexion, {
        generacionDns: generacion, causa: CAUSAS_PUBLICACION_DNS.RECONCILIACION_INICIAL,
        generacionRaizRecuperacion: generacion
      });
      await trasladarReconciliacion(conexion, reconciliacion, generacion);
      return buscarOperacion(conexion, generacion);
    });
  }

  async registrarRechazoAtribuibleDdnsConLease(datos = {}) {
    const lease = normalizarLease(datos);
    const entrada = normalizarEntradaAtribuida(datos.entrada);
    const diagnostico = sanearDiagnosticoOperacionDurable(datos.diagnostico);
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      const operacion = operaciones.find(
        ({ generacionDns }) => generacionDns === lease.generacionDns
      );
      if (!autoridadCoincide(cabecera, lease) || !leaseCoincide(operacion, lease) ||
          operacion?.estado !== ESTADOS_PUBLICACION_DNS.EFECTO_INICIADO ||
          operacion.generacionLeida !== operacion.generacionDns) {
        return Object.freeze({ atribuido: false, motivo: 'lease_sin_autoridad' });
      }

      const [intentos] = await conexion.execute(
        `SELECT p.id,p.concesion_interna_id,p.intencion_interna_id,
                CAST(p.version_ddns AS CHAR) AS version_ddns,
                p.numero_intento,p.estado,c.concesion_id,
                c.registro_dns_id_fotografia,c.intencion_gobernante_id,
                c.agente_id_fotografia,c.registro_scope_tenant_id,
                c.registro_scope_empresa_id,c.registro_scope_sitio_id,
                c.condicion_operativa,
                CAST(c.version_ddns AS CHAR) AS version_gobernante,
                i.intencion_id,i.origen,i.modo,i.estado_deseado_canonico,
                i.terminal,i.estado_deseado_sha256
           FROM intentos_publicacion_ddns p
           INNER JOIN concesiones_ddns_agentes c ON c.id=p.concesion_interna_id
           INNER JOIN intenciones_ddns_agentes i ON i.id=p.intencion_interna_id
          WHERE p.generacion_dns=? FOR UPDATE`,
        [operacion.generacionDns]
      );
      if (intentos.length !== 1) {
        return Object.freeze({ atribuido: false, motivo: 'generacion_ambigua' });
      }
      const intento = intentos[0];
      const coincide = bytesAUuidV7Auditoria(intento.concesion_id) === entrada.concesionId &&
        String(intento.registro_dns_id_fotografia) === entrada.registroDnsId &&
        String(intento.version_ddns) === entrada.versionDdns &&
        ['pendiente', 'procesando', 'bloqueada'].includes(intento.estado) &&
        intento.terminal === null;
      if (!coincide) {
        return Object.freeze({ atribuido: false, motivo: 'manifiesto_no_corresponde' });
      }

      await conexion.execute(
        `UPDATE intentos_publicacion_ddns
            SET estado='rechazo_atribuible',atribucion='registro',
                disponible_en_utc=NULL,instancia_id=NULL,lease_token=NULL,
                lease_expira_utc=NULL,codigo_diagnostico=?,mensaje_diagnostico=?,
                terminada_en_utc=UTC_TIMESTAMP(3)
          WHERE id=? AND estado IN ('pendiente','procesando','bloqueada')`,
        [diagnostico.codigo, diagnostico.mensaje, intento.id]
      );

      const numero = Number(intento.numero_intento);
      if (numero >= 3) {
        await cerrarPresupuestoDdns(conexion, intento, diagnostico);
        await bloquearOperacionAgotada(conexion, operacion, diagnostico);
        await this.#encolarResultadosDdns({
          conexion,
          intento,
          generacionDns: operacion.generacionDns,
          tipos: [
            ['ddns.publicacion_fallida', 'fallida'],
            ['ddns.intencion_terminada', 'publicacion_fallida']
          ],
          causa: diagnostico.codigo
        });
        return Object.freeze({
          atribuido: true,
          agotado: true,
          numeroIntento: numero,
          siguienteIntento: null,
          operacion: await buscarOperacion(conexion, operacion.generacionDns)
        });
      }

      const demoraSegundos = numero === 1 ? 5 : 30;
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await terminarComoSuperadaPorDdns(conexion, operacion, generacion, diagnostico);
      await insertarOperacion(conexion, {
        generacionDns: generacion,
        causa: CAUSAS_PUBLICACION_DNS.REINTENTO_DDNS,
        generacionPredecesora: operacion.generacionDns,
        generacionRaizRecuperacion: operacion.generacionRaizRecuperacion,
        demoraSegundos
      });
      await conexion.execute(
        `INSERT INTO intentos_publicacion_ddns (
           concesion_interna_id,intencion_interna_id,version_ddns,
           numero_intento,generacion_dns,estado,disponible_en_utc
         ) VALUES (?,?,?,?,?,'pendiente',
           TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)))`,
        [intento.concesion_interna_id, intento.intencion_interna_id,
          intento.version_ddns, numero + 1, generacion, demoraSegundos]
      );
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === operacion.generacionDns) {
        await conexion.execute(
          `UPDATE reconciliacion_inicial_dns
              SET generacion_objetivo=?,actualizada_en_utc=UTC_TIMESTAMP(3)
            WHERE id=1`,
          [generacion]
        );
      }
      return Object.freeze({
        atribuido: true,
        agotado: false,
        numeroIntento: numero,
        siguienteIntento: numero + 1,
        demoraSegundos,
        operacion: await buscarOperacion(conexion, generacion)
      });
    });
  }

  async registrarBloqueoGlobalDdnsConLease(datos = {}) {
    const lease = normalizarLease(datos);
    const diagnostico = sanearDiagnosticoOperacionDurable(datos.diagnostico);
    const efectoIncierto = Boolean(datos.efectoIncierto);
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const operacion = await bloquearLease(conexion, lease);
      if (!autoridadCoincide(cabecera, lease) || !operacion) {
        return Object.freeze({ bloqueado: false, motivo: 'lease_sin_autoridad' });
      }
      const demoraSegundos = calcularDemoraBloqueo(operacion.intentos);
      const [intentos] = await conexion.execute(
        `SELECT p.id,p.concesion_interna_id,p.intencion_interna_id,
                CAST(p.version_ddns AS CHAR) AS version_ddns,
                c.concesion_id,c.agente_id_fotografia,c.registro_dns_id_fotografia,
                c.registro_scope_tenant_id,c.registro_scope_empresa_id,
                c.registro_scope_sitio_id,c.condicion_operativa,
                i.intencion_id,i.origen,i.modo,
                i.estado_deseado_canonico
           FROM intentos_publicacion_ddns p
           INNER JOIN concesiones_ddns_agentes c ON c.id=p.concesion_interna_id
           INNER JOIN intenciones_ddns_agentes i ON i.id=p.intencion_interna_id
          WHERE p.generacion_dns=? AND p.estado IN ('pendiente','procesando','bloqueada')
          FOR UPDATE`,
        [operacion.generacionDns]
      );
      for (const intento of intentos) {
        await conexion.execute(
          `UPDATE intentos_publicacion_ddns
              SET estado='bloqueada',atribucion='global',
                  disponible_en_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                  instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
                  codigo_diagnostico=?,mensaje_diagnostico=?
            WHERE id=?`,
          [demoraSegundos, diagnostico.codigo, diagnostico.mensaje, intento.id]
        );
        await conexion.execute(
          `UPDATE concesiones_ddns_agentes
              SET condicion_operativa='publicacion_bloqueada'
            WHERE id=? AND intencion_gobernante_id=? AND version_ddns=?
              AND estado='vigente'`,
          [intento.concesion_interna_id, intento.intencion_interna_id,
            intento.version_ddns]
        );
        if (intento.condicion_operativa !== 'publicacion_bloqueada') {
          await this.#encolarResultadosDdns({
            conexion,
            intento,
            generacionDns: operacion.generacionDns,
            tipos: [['ddns.publicacion_bloqueada', 'bloqueada']],
            causa: diagnostico.codigo
          });
        }
      }
      const estado = efectoIncierto
        ? ESTADOS_PUBLICACION_DNS.RECUPERACION_PENDIENTE
        : operacion.estado;
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado=?,proximo_intento_utc=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),
                instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
                ultimo_codigo_error=?,ultimo_mensaje_error=?,
                actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE generacion_dns=?`,
        [estado, demoraSegundos, diagnostico.codigo, diagnostico.mensaje,
          operacion.generacionDns]
      );
      return Object.freeze({
        bloqueado: true,
        demoraSegundos,
        intentosDdns: intentos.length,
        operacion: await buscarOperacion(conexion, operacion.generacionDns)
      });
    });
  }

  async crearReintentoReconciliacion() {
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      if (!reconciliacion || reconciliacion.estado !== 'activa') {
        return Object.freeze({ creada: false, motivo: 'reconciliacion_no_activa' });
      }
      if (!reconciliacion.elegibleAhora) {
        return Object.freeze({ creada: false, motivo: 'backoff_vigente' });
      }
      const fallida = operaciones.find(
        ({ generacionDns }) => generacionDns === reconciliacion.generacionObjetivo
      );
      if (!fallida || fallida.estado !== ESTADOS_PUBLICACION_DNS.FALLIDA) {
        return Object.freeze({ creada: false, motivo: 'objetivo_no_fallido' });
      }
      const existente = operaciones.find(
        ({ generacionPredecesoraFallida }) =>
          generacionPredecesoraFallida === fallida.generacionDns
      );
      if (existente) return Object.freeze({ creada: false, operacion: existente, motivo: 'existente' });
      if (cabecera.ultimaGeneracionDns !== fallida.generacionDns) {
        return Object.freeze({ creada: false, motivo: 'generacion_posterior_elegible' });
      }
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await insertarOperacion(conexion, {
        generacionDns: generacion,
        causa: CAUSAS_PUBLICACION_DNS.REINTENTO_RECONCILIACION,
        generacionPredecesora: fallida.generacionDns,
        generacionPredecesoraFallida: fallida.generacionDns,
        generacionRaizRecuperacion: fallida.generacionRaizRecuperacion
      });
      await conexion.execute(
        `UPDATE reconciliacion_inicial_dns
            SET generacion_objetivo = ?, ultimo_intento_generacion_dns = ?,
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE id = 1`,
        [generacion, fallida.generacionDns]
      );
      return Object.freeze({
        creada: true,
        operacion: await buscarOperacion(conexion, generacion)
      });
    });
  }

  async crearSucesoraPorDivergencia(
    generacionPredecesora,
    diagnostico = {},
    { lease: datosLease = null } = {}
  ) {
    const predecesoraId = decimalPositivo(generacionPredecesora, 'generacionPredecesora');
    const diagnosticoSeguro = sanearDiagnosticoOperacionDurable(diagnostico);
    const lease = datosLease === null ? null : normalizarLease(datosLease);
    if (lease && lease.generacionDns !== predecesoraId) {
      throw new Error('El lease de divergencia no corresponde a la predecesora.');
    }
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      const predecesora = operaciones.find(({ generacionDns }) => generacionDns === predecesoraId);
      if (lease && (!autoridadCoincide(cabecera, lease) || !leaseCoincide(predecesora, lease))) {
        throw new Error('El lease DNS perdió autoridad antes de derivar la sucesora.');
      }
      if (!predecesora || !predecesora.efectoPosible || predecesora.recargaConfirmadaEnUtc) {
        throw new Error('La divergencia exige una predecesora con efecto posible sin recarga confirmada.');
      }
      if (predecesora.raizSucesionAutomatica !== null) {
        await bloquearRecuperacion(conexion, predecesora, diagnosticoSeguro);
        return Object.freeze({ creada: false, bloqueada: true, operacion: await buscarOperacion(conexion, predecesoraId) });
      }
      const existente = operaciones.find(
        ({ raizSucesionAutomatica }) =>
          raizSucesionAutomatica === predecesora.generacionRaizRecuperacion
      );
      if (existente) {
        return Object.freeze({ creada: false, bloqueada: false, operacion: existente });
      }
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await dejarRecuperacionPendiente(conexion, predecesora, diagnosticoSeguro);
      await insertarOperacion(conexion, {
        generacionDns: generacion,
        causa: CAUSAS_PUBLICACION_DNS.DIVERGENCIA_RECUPERACION,
        generacionPredecesora: predecesora.generacionDns,
        generacionRaizRecuperacion: predecesora.generacionRaizRecuperacion,
        raizSucesionAutomatica: predecesora.generacionRaizRecuperacion
      });
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === predecesora.generacionDns) {
        await conexion.execute(
          `UPDATE reconciliacion_inicial_dns
              SET generacion_objetivo = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = 1`,
          [generacion]
        );
      }
      return Object.freeze({
        creada: true,
        bloqueada: false,
        operacion: await buscarOperacion(conexion, generacion)
      });
    });
  }

  async crearSucesoraManual(generacionPredecesora) {
    const predecesoraId = decimalPositivo(generacionPredecesora, 'generacionPredecesora');
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      const predecesora = operaciones.find(({ generacionDns }) => generacionDns === predecesoraId);
      const existente = operaciones.find(({ causa, generacionPredecesora }) =>
        causa === CAUSAS_PUBLICACION_DNS.REACTIVACION_MANUAL &&
        generacionPredecesora === predecesoraId
      );
      if (existente) return existente;
      if (!predecesora || !['recuperacion_bloqueada', 'recuperacion_pendiente'].includes(predecesora.estado)) {
        throw new Error('La sucesora manual exige una recuperación pendiente o bloqueada.');
      }
      const generacion = await avanzarGeneracion(conexion, cabecera);
      await insertarOperacion(conexion, {
        generacionDns: generacion,
        causa: CAUSAS_PUBLICACION_DNS.REACTIVACION_MANUAL,
        generacionPredecesora: predecesora.generacionDns,
        generacionRaizRecuperacion: generacion
      });
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === predecesora.generacionDns) {
        await conexion.execute(
          `UPDATE reconciliacion_inicial_dns
              SET generacion_objetivo = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = 1`,
          [generacion]
        );
      }
      return buscarOperacion(conexion, generacion);
    });
  }

  async reactivarReconciliacion({ demoraSegundos = 0 } = {}) {
    const demora = entero(demoraSegundos, 0, 86_400, 'demoraSegundos');
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      await bloquearOperaciones(conexion);
      if (!reconciliacion || reconciliacion.estado !== 'bloqueada') {
        return Object.freeze({ reactivada: false, reconciliacion });
      }
      await conexion.execute(
        `UPDATE reconciliacion_inicial_dns
            SET estado = 'activa', intentos = 0,
                proximo_intento_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
                ultimo_codigo_error = NULL, ultimo_mensaje_error = NULL,
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE id = 1`,
        [demora]
      );
      return Object.freeze({ reactivada: true, reconciliacion: await bloquearReconciliacion(conexion) });
    });
  }

  async reclamarSiguienteConLease({ instanciaId, leaseToken, ttlSegundos = 30 } = {}) {
    const instancia = ascii(instanciaId, 128, 'instanciaId');
    const token = bufferExacto(leaseToken, 32, 'leaseToken');
    const ttl = entero(ttlSegundos, 1, 300, 'ttlSegundos');
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const [candidatas] = await conexion.execute(
        `SELECT generacion_dns
           FROM operaciones_publicacion_dns
          WHERE estado IN (
            'pendiente', 'efecto_iniciado', 'recarga_confirmada', 'recuperacion_pendiente'
          )
            AND generacion_dns = (
              SELECT MAX(op2.generacion_dns)
                FROM operaciones_publicacion_dns op2
               WHERE op2.estado IN (
                 'pendiente', 'efecto_iniciado', 'recarga_confirmada', 'recuperacion_pendiente'
               )
            )
            AND proximo_intento_utc <= UTC_TIMESTAMP(3)
            AND (lease_expira_utc IS NULL OR lease_expira_utc <= UTC_TIMESTAMP(3))
          ORDER BY generacion_dns DESC LIMIT 1 FOR UPDATE SKIP LOCKED`
      );
      if (!candidatas[0]) return null;
      const fencingToken = await avanzarFencing(conexion, cabecera);
      const [resultado] = await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET instancia_id = ?, lease_token = ?, fencing_token = ?,
                lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
                intentos = intentos + 1, actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [instancia, token, fencingToken, ttl, candidatas[0].generacion_dns]
      );
      if (resultado.affectedRows !== 1) return null;
      return buscarOperacion(conexion, String(candidatas[0].generacion_dns));
    });
  }

  async renovarLease(datos = {}, { ttlSegundos = 30 } = {}) {
    const lease = normalizarLease(datos);
    const ttl = entero(ttlSegundos, 1, 300, 'ttlSegundos');
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE operaciones_publicacion_dns
          SET lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
              actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE generacion_dns = ? AND instancia_id = ? AND lease_token = ?
          AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
          AND operaciones_publicacion_dns.fencing_token = (
            SELECT fencing_token FROM cabecera_generacion_dns WHERE id = 1
          )
          AND estado IN (
            'pendiente', 'efecto_iniciado', 'recarga_confirmada', 'recuperacion_pendiente'
          )`,
      [ttl, lease.generacionDns, lease.instanciaId, lease.leaseToken, lease.fencingToken]
    );
    return Number(resultado.affectedRows) === 1;
  }

  async verificarAutoridadConLease(datos = {}) {
    const lease = normalizarLease(datos);
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const operacion = await bloquearLease(conexion, lease);
      return Boolean(autoridadCoincide(cabecera, lease) && operacion);
    });
  }

  async iniciarEfectoConLease(datos = {}, proyeccion = {}) {
    const lease = normalizarLease(datos);
    const generacionLeida = decimalPositivo(proyeccion.generacionLeida, 'generacionLeida');
    if (generacionLeida !== lease.generacionDns) {
      throw new Error('La fotografía DNS no corresponde a la generación reclamada.');
    }
    const perfil = asciiExacto(proyeccion.perfilProyeccion, 64, 'perfilProyeccion');
    if (perfil !== PERFIL_PROYECCION) throw new Error('El perfil de proyección DNS no está soportado.');
    const hash = hashSha256(proyeccion.hashProyeccion);
    const fotografiaZonas = normalizarFotografiaZonasDns(proyeccion.fotografiaZonas);
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const operacion = await bloquearLease(conexion, lease);
      if (!autoridadCoincide(cabecera, lease) || !operacion ||
          operacion.estado !== ESTADOS_PUBLICACION_DNS.PENDIENTE) return null;
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado = 'efecto_iniciado', efecto_posible = TRUE,
                generacion_leida = ?, perfil_proyeccion = ?, hash_proyeccion = ?,
                fotografia_zonas = ?,
                efecto_iniciado_en_utc = UTC_TIMESTAMP(3),
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [generacionLeida, perfil, hash,
          fotografiaZonas == null ? null : JSON.stringify(fotografiaZonas), lease.generacionDns]
      );
      return buscarOperacion(conexion, lease.generacionDns);
    });
  }

  async terminarSinCambiosConLease(datos = {}) {
    const lease = normalizarLease(datos);
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      await bloquearOperaciones(conexion);
      const operacion = await bloquearLease(conexion, lease, { yaBloqueada: true });
      if (!autoridadCoincide(cabecera, lease) || !operacion ||
          operacion.estado !== ESTADOS_PUBLICACION_DNS.PENDIENTE) return null;
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === operacion.generacionDns) {
        throw new Error('La reconciliación inicial exige una recarga y no admite sin_cambios.');
      }
      await terminarTecnica(conexion, operacion.generacionDns, 'sin_cambios');
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async marcarRecuperacionPendienteConLease(datos = {}, diagnostico = {}) {
    const lease = normalizarLease(datos);
    const seguro = sanearDiagnosticoOperacionDurable(diagnostico);
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const operacion = await bloquearLease(conexion, lease);
      if (!autoridadCoincide(cabecera, lease) || !operacion ||
          !['efecto_iniciado', 'recuperacion_pendiente'].includes(operacion.estado)) return null;
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado = 'recuperacion_pendiente', instancia_id = NULL,
                lease_token = NULL, lease_expira_utc = NULL,
                proximo_intento_utc = UTC_TIMESTAMP(3),
                ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [seguro.codigo, seguro.mensaje, operacion.generacionDns]
      );
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async confirmarRecargaConLease(datos = {}, resultado = {}) {
    const lease = normalizarLease(datos);
    const resumen = normalizarResultadoPublicacion(resultado);
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      const operaciones = await bloquearOperaciones(conexion);
      const operacion = operaciones.find(({ generacionDns }) => generacionDns === lease.generacionDns);
      if (!autoridadCoincide(cabecera, lease) || !leaseCoincide(operacion, lease) ||
          !['efecto_iniciado', 'recuperacion_pendiente'].includes(operacion.estado)) return null;
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado = 'recarga_confirmada', generacion_observada = generacion_dns,
                recarga_confirmada_en_utc = UTC_TIMESTAMP(3),
                resumen_recarga_zonas = ?, resumen_recarga_artefactos = ?,
                resumen_recarga_cambios = ?,
                manifiesto_diagnostico = ?,
                proximo_intento_utc = UTC_TIMESTAMP(3),
                ultimo_codigo_error = NULL, ultimo_mensaje_error = NULL,
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [resumen.zonas, resumen.artefactos, resumen.cambios,
          resumen.diagnosticoCanonico, operacion.generacionDns]
      );
      if (cabecera.generacionObservada === null ||
          BigInt(cabecera.generacionObservada) < BigInt(operacion.generacionDns)) {
        await conexion.execute(
          `UPDATE cabecera_generacion_dns
              SET generacion_observada = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = 1`,
          [operacion.generacionDns]
        );
      }
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === operacion.generacionDns &&
          cabecera.ultimaGeneracionDns === operacion.generacionDns) {
        await conexion.execute(
          `UPDATE reconciliacion_inicial_dns
              SET estado = 'satisfecha', proximo_intento_utc = NULL,
                  satisfecha_en_utc = UTC_TIMESTAMP(3),
                  actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = 1`
        );
      }
      for (const anterior of operaciones) {
        if (BigInt(anterior.generacionDns) >= BigInt(operacion.generacionDns) ||
            !anterior.efectoPosible || anterior.recargaConfirmadaEnUtc ||
            !['efecto_iniciado', 'recuperacion_pendiente', 'recuperacion_bloqueada'].includes(anterior.estado)) {
          continue;
        }
        await conexion.execute(
          `UPDATE operaciones_publicacion_dns
              SET estado = 'superada_tras_recuperacion', generacion_convergente = ?,
                  proximo_intento_utc = NULL, instancia_id = NULL,
                  lease_token = NULL, lease_expira_utc = NULL,
                  terminada_en_utc = UTC_TIMESTAMP(3), actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE generacion_dns = ?`,
          [operacion.generacionDns, anterior.generacionDns]
        );
      }
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async consolidarResultadoConLease(datos = {}, resultado = {}) {
    const lease = normalizarLease(datos);
    const resumen = normalizarResultadoPublicacion(resultado);
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      await bloquearReconciliacion(conexion);
      await bloquearOperaciones(conexion);
      const operacion = await bloquearLease(conexion, lease, { yaBloqueada: true });
      if (!autoridadCoincide(cabecera, lease) || !operacion ||
          operacion.estado !== ESTADOS_PUBLICACION_DNS.RECARGA_CONFIRMADA) return null;
      await consolidarPublicacionZonasDns({ conexion, operacion });
      await this.consolidadorPublicacionDdns.consolidarEnTransaccion({
        conexion,
        generacionDns: operacion.generacionDns,
        diagnostico: resumen.diagnostico
      });
      const obligacionId = await this.#registrarObligacion(
        { tipo: 'aplicada', operacion, resumen },
        conexion
      );
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado = 'consolidada', proximo_intento_utc = NULL,
                instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
                resultado_zonas = ?, resultado_artefactos = ?, resultado_cambios = ?,
                obligacion_outbox_id = ?, terminada_en_utc = UTC_TIMESTAMP(3),
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [resumen.zonas, resumen.artefactos, resumen.cambios, obligacionId, operacion.generacionDns]
      );
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async fallarEstableConLease(datos = {}, { diagnostico, resumen, demoraReintentoSegundos = 5 } = {}) {
    const lease = normalizarLease(datos);
    const seguro = sanearDiagnosticoOperacionDurable(diagnostico);
    const resultado = normalizarResumen(resumen);
    const demora = entero(demoraReintentoSegundos, 1, 86_400, 'demoraReintentoSegundos');
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const cabecera = await bloquearCabecera(conexion);
      const reconciliacion = await bloquearReconciliacion(conexion);
      await bloquearOperaciones(conexion);
      const operacion = await bloquearLease(conexion, lease, { yaBloqueada: true });
      if (!autoridadCoincide(cabecera, lease) || !operacion ||
          operacion.estado !== ESTADOS_PUBLICACION_DNS.PENDIENTE) return null;
      const obligacionId = await this.#registrarObligacion(
        { tipo: 'fallida', operacion, resumen: resultado, diagnostico: seguro },
        conexion
      );
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET estado = 'fallida', proximo_intento_utc = NULL,
                instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
                ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
                resultado_zonas = ?, resultado_artefactos = ?, resultado_cambios = ?,
                obligacion_outbox_id = ?, terminada_en_utc = UTC_TIMESTAMP(3),
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [seguro.codigo, seguro.mensaje, resultado.zonas, resultado.artefactos,
          resultado.cambios, obligacionId, operacion.generacionDns]
      );
      if (reconciliacion?.estado !== 'satisfecha' &&
          reconciliacion?.generacionObjetivo === operacion.generacionDns) {
        const intentos = reconciliacion.intentos + 1;
        const bloqueada = intentos >= reconciliacion.maxIntentos;
        await conexion.execute(
          `UPDATE reconciliacion_inicial_dns
              SET estado = ?, intentos = ?,
                  proximo_intento_utc = ${bloqueada ? 'NULL' : 'TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))'},
                  ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
                  actualizada_en_utc = UTC_TIMESTAMP(3)
            WHERE id = 1`,
          bloqueada
            ? ['bloqueada', intentos, seguro.codigo, seguro.mensaje]
            : ['activa', intentos, demora, seguro.codigo, seguro.mensaje]
        );
      }
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async reprogramarConLease(datos = {}, { diagnostico, demoraSegundos = 5 } = {}) {
    const lease = normalizarLease(datos);
    const seguro = sanearDiagnosticoOperacionDurable(diagnostico);
    const demora = entero(demoraSegundos, 1, 86_400, 'demoraSegundos');
    return this.#enTransaccion(async (conexion) => {
      const cabecera = await bloquearCabecera(conexion);
      const operacion = await bloquearLease(conexion, lease);
      if (!autoridadCoincide(cabecera, lease) || !operacion) return null;
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
                proximo_intento_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
                ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
                actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [demora, seguro.codigo, seguro.mensaje, operacion.generacionDns]
      );
      return buscarOperacion(conexion, operacion.generacionDns);
    });
  }

  async incorporarEventoResultado(generacionDns, eventoId) {
    const generacion = decimalPositivo(generacionDns, 'generacionDns');
    const evento = uuidV7AuditoriaABytes(eventoId, 'eventoId');
    return this.#enTransaccion(async (conexion) => {
      await this.#bloquearCatalogo(conexion);
      const operacion = await buscarOperacion(conexion, generacion, true);
      if (!operacion || !['consolidada', 'fallida'].includes(operacion.estado)) {
        throw new Error('Solo un resultado DNS terminal admite incorporar su evento.');
      }
      if (operacion.eventoResultadoId) {
        if (operacion.eventoResultadoId !== eventoId) throw new Error('El evento de resultado DNS es inmutable.');
        return operacion;
      }
      await conexion.execute(
        `UPDATE operaciones_publicacion_dns
            SET evento_resultado_id = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
          WHERE generacion_dns = ?`,
        [evento, generacion]
      );
      return buscarOperacion(conexion, generacion);
    });
  }

  async limpiarTerminales({ graciaSegundos = 3600, lote = 100 } = {}) {
    const gracia = entero(graciaSegundos, 0, 31_536_000, 'graciaSegundos');
    const limite = entero(lote, 1, 1000, 'lote');
    return this.#enTransaccion(async (conexion) => {
      const [filas] = await conexion.execute(
        `SELECT generacion_dns
           FROM operaciones_publicacion_dns
          WHERE estado IN (
            'consolidada', 'sin_cambios', 'superada',
            'superada_tras_recuperacion', 'fallida'
          )
            AND terminada_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3))
            AND (estado NOT IN ('consolidada', 'fallida') OR evento_resultado_id IS NOT NULL)
            AND NOT EXISTS (
              SELECT 1 FROM reconciliacion_inicial_dns r
               WHERE r.id = 1 AND r.estado <> 'satisfecha'
                 AND r.generacion_objetivo = operaciones_publicacion_dns.generacion_dns
            )
          ORDER BY generacion_dns LIMIT ? FOR UPDATE SKIP LOCKED`,
        [gracia, limite]
      );
      for (const fila of filas) {
        await conexion.execute(
          'DELETE FROM operaciones_publicacion_dns WHERE generacion_dns = ?',
          [fila.generacion_dns]
        );
      }
      return Object.freeze({ eliminadas: filas.length });
    });
  }

  async obtenerOperacion(generacionDns) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return await buscarOperacion(conexion, decimalPositivo(generacionDns, 'generacionDns'));
    } finally {
      conexion.release();
    }
  }

  async obtenerReconciliacion() {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      return await bloquearReconciliacion(conexion, false);
    } finally {
      conexion.release();
    }
  }

  async #encolarResultadosDdns({
    conexion,
    intento,
    generacionDns,
    tipos,
    causa
  }) {
    if (!this.repositorioOutboxAuditoria || tipos.length === 0) return;
    const concesionId = bytesAUuidV7Auditoria(intento.concesion_id, 'concesionId');
    const intencionId = bytesAUuidV7Auditoria(intento.intencion_id, 'intencionId');
    const estado = jsonCanonico(intento.estado_deseado_canonico);
    const comunes = {
      actorReal: { tipo: 'runtime', id: 'sentinelia-runtime' },
      sujetoId: intencionId,
      scope: {
        tenantId: nullable(intento.registro_scope_tenant_id),
        empresaId: nullable(intento.registro_scope_empresa_id),
        sitioId: nullable(intento.registro_scope_sitio_id)
      },
      correlacionId: intencionId,
      causalidadIntencionId: intencionId,
      productor: 'runtime_dns',
      rolEvento: 'resultado'
    };
    const intenciones = tipos.map(([tipo, resultado]) =>
      construirIntencionAuditoriaDdns({
        ...comunes,
        eventoId: generarUuidV7Auditoria(),
        tipo,
        claveOperacion: `ddns:${tipo}:${concesionId}:${intento.version_ddns}`,
        payload: {
          resultado,
          tipoRegistro: estado.tipo,
          modo: intento.modo,
          estadoPosterior: estado,
          versionDdns: String(intento.version_ddns),
          origenIntencion: intento.origen,
          generacionDns: String(generacionDns),
          causa,
          agenteId: String(intento.agente_id_fotografia),
          registroDnsId: String(intento.registro_dns_id_fotografia)
        }
      })
    );
    await this.repositorioOutboxAuditoria.encolarEnTransaccion(
      intenciones,
      { conexion }
    );
  }

  async #registrarObligacion(datos, conexion) {
    if (typeof this.registradorObligaciones?.registrarEnTransaccion !== 'function') {
      throw new Error('El resultado DNS estable requiere una obligación outbox transaccional.');
    }
    const registrada = await this.registradorObligaciones.registrarEnTransaccion(datos, { conexion });
    const id = registrada?.obligacionId ?? registrada?.id ?? registrada;
    return decimalPositivo(id, 'obligacionOutboxId');
  }

  #bloquearCatalogo(conexion) {
    return this.bloquearCatalogoEnTransaccion({ conexion });
  }

  async #enTransaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function jsonCanonico(valor) {
  if (typeof valor === 'string') return JSON.parse(valor);
  if (Buffer.isBuffer(valor)) return JSON.parse(valor.toString('utf8'));
  return valor;
}

async function bloquearCabecera(conexion) {
  const [filas] = await conexion.execute(
    `SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima_generacion_dns,
            CAST(generacion_observada AS CHAR) AS generacion_observada,
            CAST(fencing_token AS CHAR) AS fencing_token
       FROM cabecera_generacion_dns WHERE id = 1 FOR UPDATE`
  );
  if (!filas[0]) throw new Error('Falta la cabecera global de generación DNS.');
  return Object.freeze({
    ultimaGeneracionDns: String(filas[0].ultima_generacion_dns),
    generacionObservada: filas[0].generacion_observada === null
      ? null
      : String(filas[0].generacion_observada),
    fencingToken: String(filas[0].fencing_token)
  });
}

async function bloquearReconciliacion(conexion, bloquear = true) {
  const [filas] = await conexion.execute(
    `SELECT estado, CAST(generacion_objetivo AS CHAR) AS generacion_objetivo,
            CAST(ultimo_intento_generacion_dns AS CHAR) AS ultimo_intento_generacion_dns,
            intentos, max_intentos, ultimo_codigo_error, ultimo_mensaje_error,
            proximo_intento_utc,
            (proximo_intento_utc IS NOT NULL AND proximo_intento_utc <= UTC_TIMESTAMP(3)) AS elegible_ahora
       FROM reconciliacion_inicial_dns WHERE id = 1 ${bloquear ? 'FOR UPDATE' : ''}`
  );
  if (!filas[0]) return null;
  return Object.freeze({
    estado: filas[0].estado,
    generacionObjetivo: String(filas[0].generacion_objetivo),
    ultimoIntentoGeneracionDns: filas[0].ultimo_intento_generacion_dns === null
      ? null
      : String(filas[0].ultimo_intento_generacion_dns),
    intentos: Number(filas[0].intentos),
    maxIntentos: Number(filas[0].max_intentos),
    elegibleAhora: Boolean(filas[0].elegible_ahora),
    ultimoCodigoError: filas[0].ultimo_codigo_error || null,
    ultimoMensajeError: filas[0].ultimo_mensaje_error || null
  });
}

async function bloquearOperaciones(conexion) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasOperacion()}
       FROM operaciones_publicacion_dns
      ORDER BY generacion_dns FOR UPDATE`
  );
  return filas.map(serializarOperacion);
}

async function buscarOperacion(conexion, generacionDns, bloquear = false) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasOperacion()}
       FROM operaciones_publicacion_dns WHERE generacion_dns = ?
       ${bloquear ? 'FOR UPDATE' : ''}`,
    [generacionDns]
  );
  return filas[0] ? serializarOperacion(filas[0]) : null;
}

async function bloquearLease(conexion, lease, { yaBloqueada = false } = {}) {
  const operacion = await buscarOperacion(conexion, lease.generacionDns, !yaBloqueada);
  return leaseCoincide(operacion, lease) ? operacion : null;
}

function leaseCoincide(operacion, lease) {
  return Boolean(
    operacion && operacion.instanciaId === lease.instanciaId &&
    operacion.leaseToken === lease.leaseToken.toString('hex') &&
    operacion.fencingToken === lease.fencingToken && operacion.leaseVigente
  );
}

function autoridadCoincide(cabecera, lease) {
  return cabecera?.fencingToken === lease.fencingToken;
}

async function avanzarGeneracion(conexion, cabecera) {
  const actual = BigInt(cabecera.ultimaGeneracionDns);
  if (actual >= MAX_BIGINT_UNSIGNED) throw new Error('generacionDns agotó BIGINT UNSIGNED.');
  const siguiente = String(actual + 1n);
  const [resultado] = await conexion.execute(
    `UPDATE cabecera_generacion_dns
        SET ultima_generacion_dns = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE id = 1 AND ultima_generacion_dns = ?`,
    [siguiente, cabecera.ultimaGeneracionDns]
  );
  if (resultado.affectedRows !== 1) throw new Error('La generación DNS perdió su cabecera bloqueada.');
  return siguiente;
}

async function avanzarFencing(conexion, cabecera) {
  const actual = BigInt(cabecera.fencingToken);
  if (actual >= MAX_BIGINT_UNSIGNED) throw new Error('fencingToken DNS agotó BIGINT UNSIGNED.');
  const siguiente = String(actual + 1n);
  const [resultado] = await conexion.execute(
    `UPDATE cabecera_generacion_dns
        SET fencing_token = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE id = 1 AND fencing_token = ?`,
    [siguiente, cabecera.fencingToken]
  );
  if (resultado.affectedRows !== 1) throw new Error('El fencing DNS perdió su cabecera bloqueada.');
  return siguiente;
}

async function insertarOperacion(conexion, datos) {
  await conexion.execute(
    `INSERT INTO operaciones_publicacion_dns (
       generacion_dns, causa, generacion_predecesora,
       generacion_predecesora_fallida, generacion_raiz_recuperacion,
       raiz_sucesion_automatica, estado, proximo_intento_utc,
       creada_en_utc, actualizada_en_utc
     ) VALUES (?, ?, ?, ?, ?, ?, 'pendiente',
       TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      datos.generacionDns,
      datos.causa,
      datos.generacionPredecesora ?? null,
      datos.generacionPredecesoraFallida ?? null,
      datos.generacionRaizRecuperacion,
      datos.raizSucesionAutomatica ?? null,
      datos.demoraSegundos ?? 0
    ]
  );
}

async function terminarComoSuperadaPorDdns(conexion, operacion, sucesora, diagnostico) {
  await conexion.execute(
    `UPDATE operaciones_publicacion_dns
        SET estado='superada_tras_recuperacion',generacion_convergente=?,
            proximo_intento_utc=NULL,instancia_id=NULL,lease_token=NULL,
            lease_expira_utc=NULL,ultimo_codigo_error=?,ultimo_mensaje_error=?,
            terminada_en_utc=UTC_TIMESTAMP(3),actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_dns=?`,
    [sucesora, diagnostico.codigo, diagnostico.mensaje, operacion.generacionDns]
  );
}

async function bloquearOperacionAgotada(conexion, operacion, diagnostico) {
  await conexion.execute(
    `UPDATE operaciones_publicacion_dns
        SET estado='recuperacion_bloqueada',proximo_intento_utc=NULL,
            instancia_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
            ultimo_codigo_error=?,ultimo_mensaje_error=?,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_dns=?`,
    [diagnostico.codigo, diagnostico.mensaje, operacion.generacionDns]
  );
}

async function cerrarPresupuestoDdns(conexion, intento, diagnostico) {
  await conexion.execute(
    `UPDATE intenciones_ddns_agentes
        SET terminal='publicacion_fallida',terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE id=? AND terminal IS NULL`,
    [intento.intencion_interna_id]
  );
  await conexion.execute(
    `UPDATE concesiones_ddns_agentes
        SET condicion_operativa='publicacion_fallida'
      WHERE id=? AND intencion_gobernante_id=? AND version_ddns=?`,
    [intento.concesion_interna_id, intento.intencion_interna_id,
      intento.version_ddns]
  );
  await conexion.execute(
    `UPDATE zonas_dns z
        INNER JOIN registros_dns r ON r.zona_id=z.id
        INNER JOIN concesiones_ddns_agentes c ON c.registro_dns_id=r.id
        SET z.estado_publicacion='error',
            z.fecha_ultimo_error_publicacion=UTC_TIMESTAMP(3),
            z.detalle_ultimo_error_publicacion=?
      WHERE c.id=?`,
    [diagnostico.mensaje, intento.concesion_interna_id]
  );
}

async function superarPendientesAnteriores(conexion, operaciones, generacionNueva) {
  for (const operacion of operaciones) {
    if (BigInt(operacion.generacionDns) >= BigInt(generacionNueva) ||
        operacion.estado !== ESTADOS_PUBLICACION_DNS.PENDIENTE) continue;
    await terminarTecnica(conexion, operacion.generacionDns, 'superada');
  }
}

async function trasladarReconciliacion(conexion, reconciliacion, generacion) {
  if (!reconciliacion || reconciliacion.estado === 'satisfecha') return;
  await conexion.execute(
    `UPDATE reconciliacion_inicial_dns
        SET generacion_objetivo = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE id = 1`,
    [generacion]
  );
}

async function dejarRecuperacionPendiente(conexion, operacion, diagnostico) {
  if (operacion.estado === 'recuperacion_pendiente') return;
  await conexion.execute(
    `UPDATE operaciones_publicacion_dns
        SET estado = 'recuperacion_pendiente', proximo_intento_utc = UTC_TIMESTAMP(3),
            instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
            ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
            actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE generacion_dns = ?`,
    [diagnostico.codigo, diagnostico.mensaje, operacion.generacionDns]
  );
}

async function bloquearRecuperacion(conexion, operacion, diagnostico) {
  await conexion.execute(
    `UPDATE operaciones_publicacion_dns
        SET estado = 'recuperacion_bloqueada', proximo_intento_utc = NULL,
            instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
            ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
            actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE generacion_dns = ?`,
    [diagnostico.codigo, diagnostico.mensaje, operacion.generacionDns]
  );
}

async function terminarTecnica(conexion, generacionDns, estado) {
  await conexion.execute(
    `UPDATE operaciones_publicacion_dns
        SET estado = ?, proximo_intento_utc = NULL, instancia_id = NULL,
            lease_token = NULL, lease_expira_utc = NULL,
            terminada_en_utc = UTC_TIMESTAMP(3), actualizada_en_utc = UTC_TIMESTAMP(3)
      WHERE generacion_dns = ?`,
    [estado, generacionDns]
  );
}

function columnasOperacion() {
  return `CAST(generacion_dns AS CHAR) AS generacion_dns, causa,
    CAST(generacion_predecesora AS CHAR) AS generacion_predecesora,
    CAST(generacion_predecesora_fallida AS CHAR) AS generacion_predecesora_fallida,
    CAST(generacion_raiz_recuperacion AS CHAR) AS generacion_raiz_recuperacion,
    CAST(raiz_sucesion_automatica AS CHAR) AS raiz_sucesion_automatica,
    estado, efecto_posible, CAST(generacion_leida AS CHAR) AS generacion_leida,
    perfil_proyeccion, hash_proyeccion,
    CAST(generacion_observada AS CHAR) AS generacion_observada,
    CAST(generacion_convergente AS CHAR) AS generacion_convergente,
    intentos, instancia_id, lease_token,
    (lease_expira_utc IS NOT NULL AND lease_expira_utc > UTC_TIMESTAMP(3)) AS lease_vigente,
    CAST(fencing_token AS CHAR) AS fencing_token,
    ultimo_codigo_error, ultimo_mensaje_error,
    CAST(resultado_zonas AS CHAR) AS resultado_zonas,
    CAST(resultado_artefactos AS CHAR) AS resultado_artefactos,
    CAST(resultado_cambios AS CHAR) AS resultado_cambios,
    CAST(resumen_recarga_zonas AS CHAR) AS resumen_recarga_zonas,
    CAST(resumen_recarga_artefactos AS CHAR) AS resumen_recarga_artefactos,
    CAST(resumen_recarga_cambios AS CHAR) AS resumen_recarga_cambios,
    manifiesto_diagnostico, fotografia_zonas,
    CAST(obligacion_outbox_id AS CHAR) AS obligacion_outbox_id,
    evento_resultado_id, recarga_confirmada_en_utc, terminada_en_utc`;
}

function serializarOperacion(fila) {
  return Object.freeze({
    generacionDns: String(fila.generacion_dns),
    causa: fila.causa,
    generacionPredecesora: nullable(fila.generacion_predecesora),
    generacionPredecesoraFallida: nullable(fila.generacion_predecesora_fallida),
    generacionRaizRecuperacion: String(fila.generacion_raiz_recuperacion),
    raizSucesionAutomatica: nullable(fila.raiz_sucesion_automatica),
    estado: fila.estado,
    efectoPosible: Boolean(fila.efecto_posible),
    fotografiaZonas: jsonNullable(fila.fotografia_zonas),
    generacionLeida: nullable(fila.generacion_leida),
    perfilProyeccion: fila.perfil_proyeccion || null,
    hashProyeccion: fila.hash_proyeccion ? Buffer.from(fila.hash_proyeccion).toString('hex') : null,
    generacionObservada: nullable(fila.generacion_observada),
    generacionConvergente: nullable(fila.generacion_convergente),
    intentos: Number(fila.intentos),
    instanciaId: fila.instancia_id || null,
    leaseToken: fila.lease_token ? Buffer.from(fila.lease_token).toString('hex') : null,
    leaseVigente: Boolean(fila.lease_vigente),
    fencingToken: String(fila.fencing_token),
    ultimoCodigoError: fila.ultimo_codigo_error || null,
    ultimoMensajeError: fila.ultimo_mensaje_error || null,
    resultado: fila.resultado_zonas === null && fila.resumen_recarga_zonas === null
      ? null
      : Object.freeze({
          zonas: String(fila.resultado_zonas ?? fila.resumen_recarga_zonas),
          artefactos: String(
            fila.resultado_artefactos ?? fila.resumen_recarga_artefactos
          ),
          cambios: String(fila.resultado_cambios ?? fila.resumen_recarga_cambios),
          diagnostico: jsonNullable(fila.manifiesto_diagnostico)
        }),
    obligacionOutboxId: nullable(fila.obligacion_outbox_id),
    eventoResultadoId: fila.evento_resultado_id
      ? bytesAUuidV7Auditoria(fila.evento_resultado_id)
      : null,
    recargaConfirmadaEnUtc: fila.recarga_confirmada_en_utc || null,
    terminadaEnUtc: fila.terminada_en_utc || null
  });
}

function normalizarLease(datos) {
  return Object.freeze({
    generacionDns: decimalPositivo(datos.generacionDns ?? datos.operacionId, 'generacionDns'),
    instanciaId: ascii(datos.instanciaId, 128, 'instanciaId'),
    leaseToken: bufferExacto(datos.leaseToken, 32, 'leaseToken'),
    fencingToken: decimalPositivo(datos.fencingToken, 'fencingToken')
  });
}

function normalizarEntradaAtribuida(entrada = {}) {
  return Object.freeze({
    concesionId: bytesAUuidV7Auditoria(
      uuidV7AuditoriaABytes(entrada.concesionId, 'entrada.concesionId')
    ),
    registroDnsId: decimalPositivo(entrada.registroDnsId, 'entrada.registroDnsId'),
    versionDdns: decimalPositivo(entrada.versionDdns, 'entrada.versionDdns')
  });
}

function calcularDemoraBloqueo(intentos) {
  const exponente = Math.max(0, Math.min(6, Number(intentos || 1) - 1));
  return Math.min(300, 5 * (2 ** exponente));
}

function normalizarResumen(resultado = {}) {
  return Object.freeze({
    zonas: decimalNoNegativo(resultado.zonas ?? 0, 'resultado.zonas'),
    artefactos: decimalNoNegativo(resultado.artefactos ?? 0, 'resultado.artefactos'),
    cambios: decimalNoNegativo(resultado.cambios ?? 0, 'resultado.cambios')
  });
}

function normalizarResultadoPublicacion(resultado = {}) {
  const resumen = normalizarResumen(resultado);
  if (resultado.diagnostico === null || resultado.diagnostico === undefined) {
    return Object.freeze({ ...resumen, diagnostico: null, diagnosticoCanonico: null });
  }
  const diagnostico = resultado.diagnostico;
  if (diagnostico?.perfil !== 'sentinelia-bind-diagnostico-v1' ||
      !Array.isArray(diagnostico?.entradas)) {
    throw new Error('El resultado DNS no contiene un manifiesto diagnóstico válido.');
  }
  const concesiones = new Set();
  const entradas = diagnostico.entradas.map((entrada) => {
    const normalizada = {
      zonaDnsId: decimalPositivo(entrada.zonaDnsId, 'diagnostico.zonaDnsId'),
      rutaZona: asciiExacto(entrada.rutaZona, 1024, 'diagnostico.rutaZona'),
      linea: entero(Number(entrada.linea), 1, Number.MAX_SAFE_INTEGER, 'diagnostico.linea'),
      registroDnsId: decimalPositivo(
        entrada.registroDnsId,
        'diagnostico.registroDnsId'
      ),
      concesionId: entrada.concesionId === null
        ? null
        : bytesAUuidV7Auditoria(
            uuidV7AuditoriaABytes(entrada.concesionId, 'diagnostico.concesionId')
          ),
      versionDdns: entrada.versionDdns === null
        ? null
        : decimalNoNegativo(entrada.versionDdns, 'diagnostico.versionDdns')
    };
    if ((normalizada.concesionId === null) !== (normalizada.versionDdns === null)) {
      throw new Error('Concesión y versión DDNS deben aparecer conjuntamente.');
    }
    if (normalizada.concesionId) {
      if (concesiones.has(normalizada.concesionId)) {
        throw new Error('Una concesión DDNS no puede ocupar varias líneas del manifiesto.');
      }
      concesiones.add(normalizada.concesionId);
    }
    return Object.freeze(normalizada);
  });
  const copia = Object.freeze({
    perfil: diagnostico.perfil,
    entradas: Object.freeze(entradas)
  });
  return Object.freeze({
    ...resumen,
    diagnostico: copia,
    diagnosticoCanonico: canonicalizarRfc8785(copia)
  });
}

function jsonNullable(valor) {
  if (valor === null || valor === undefined) return null;
  return typeof valor === 'string' ? JSON.parse(valor) : JSON.parse(JSON.stringify(valor));
}

function hashSha256(valor) {
  const bytes = Buffer.isBuffer(valor) ? Buffer.from(valor) : Buffer.from(String(valor || ''), 'hex');
  if (bytes.length !== 32 || !/^[0-9a-f]{64}$/.test(bytes.toString('hex'))) {
    throw new Error('hashProyeccion debe contener SHA-256 binario o hexadecimal.');
  }
  return bytes;
}

function bufferExacto(valor, longitud, nombre) {
  const buffer = Buffer.isBuffer(valor)
    ? Buffer.from(valor)
    : Buffer.from(String(valor || ''), 'hex');
  if (buffer.length !== longitud || !/^[0-9a-f]+$/.test(buffer.toString('hex'))) {
    throw new Error(`${nombre} debe contener ${longitud} bytes.`);
  }
  return buffer;
}

function decimalPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${nombre} debe ser decimal canónico positivo.`);
  }
  return texto;
}

function decimalNoNegativo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${nombre} debe ser decimal canónico no negativo.`);
  }
  return texto;
}

function entero(valor, minimo, maximo, nombre) {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nombre} queda fuera de rango.`);
  }
  return valor;
}

function ascii(valor, maximo, nombre) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/.test(texto)) {
    throw new Error(`${nombre} no es ASCII válido.`);
  }
  return texto;
}

function asciiExacto(valor, maximo, nombre) {
  if (typeof valor !== 'string' || !valor || valor.length > maximo ||
      !/^[\x20-\x7e]+$/.test(valor)) {
    throw new Error(`${nombre} no es ASCII exacto válido.`);
  }
  return valor;
}

function nullable(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function exigirConexion(conexion) {
  if (!conexion?.execute) throw new Error('La operación DNS exige una conexión SQL explícita.');
}
