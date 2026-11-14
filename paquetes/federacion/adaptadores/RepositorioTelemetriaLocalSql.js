import { FuenteEntropiaCriptograficaNode } from './FuenteEntropiaCriptograficaNode.js';
import { asegurarIdentidadesScopeOrganizativoFederacion }
  from './RepositorioEstructuraOrganizativaLocalSql.js';
import { asegurarIdentidadContextoAgenteFederacion }
  from './RepositorioContextoOperativoAgentesSesionesLocalSql.js';
import { crearCampoPresenteFederado } from '../src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
  VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../src/PayloadTelemetriaFederacion.js';
import {
  duracionTelemetriaDesdeSql,
  momentoUtcTelemetriaDesdeSql
} from '../../agentes/src/CodecSqlTelemetriaTemporalAgente.js';

const TIPOS_CAPTURABLES = new Set([
  'fuente', 'senal', 'observacion', 'fotografiaSenal',
  'fotografiaPol', 'reglaDerivacion', 'eventoDerivado'
]);

const TIPOS_TOMBSTONE_RETIRADA_AGENTE = new Set([
  'fuente', 'senal', 'fotografiaSenal', 'fotografiaPol', 'reglaDerivacion'
]);

export class ErrorTelemetriaLocalFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorTelemetriaLocalFederacion';
    this.codigo = codigo;
  }
}

export async function asegurarIdentidadElementoTelemetriaFederacion({
  conexion,
  tipo,
  id,
  agente,
  generador,
  instante
} = {}) {
  await exigirTransaccion(conexion);
  const tipoNormalizado = exigirTipo(tipo);
  const idNormalizado = idPositivo(id, 'id');
  const agenteId = idPositivo(agente?.id, 'agente.id');
  if (agente.tenant_id == null || agente.empresa_id == null || agente.sitio_id == null) {
    fallar(
      'scope_identidad_telemetria_ausente',
      'La identidad opaca de telemetría exige el scope de su agente.'
    );
  }
  if (typeof generador?.generar !== 'function') {
    fallar(
      'generador_identidad_telemetria_ausente',
      'La identidad opaca de telemetría exige un generador.'
    );
  }
  return asegurarIdentidad({
    conexion,
    tipo: tipoNormalizado,
    id: idNormalizado,
    agente: { ...agente, id: agenteId },
    generador,
    instante: fechaIso(instante)
  });
}

export class RepositorioTelemetriaLocalSql {
  constructor(clienteSql, {
    installationLocalId,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    ahora = () => new Date(),
    permitirMomentoUtcRelativo = false
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La telemetría local federable requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.installationLocal = identidad(
      installationLocalId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationLocalId'
    );
    this.generadorIdentidades = generadorIdentidades;
    this.ahora = ahora;
    this.permitirMomentoUtcRelativo = Boolean(permitirMomentoUtcRelativo);
  }

  async prepararCapturaEnTransaccion({ tipoRegistro, idLocal } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const tipo = exigirTipo(tipoRegistro);
    const id = idPositivo(idLocal, 'idLocal');
    const prioridad = ['fotografiaSenal', 'fotografiaPol', 'reglaDerivacion']
      .includes(tipo) ? 'operativaActual' : 'reconstruccion';
    const capturas = await this.#capturarSeleccion(conexion, [{ tipo, id }], prioridad);
    if (capturas.length === 0) {
      fallar('telemetria_federable_inexistente', `No existe ${tipo} local con la identidad indicada.`);
    }
    return capturas[0];
  }

  async prepararCapturasIngestaEnTransaccion({
    agenteId,
    senalIds = [],
    observacionIds = [],
    fotografiaSenalIds = [],
    incluirFuente = false,
    incluirFotografiaPol = true
  } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const agente = idPositivo(agenteId, 'agenteId');
    const seleccion = [
      ...idsUnicos(senalIds, 'senalIds').map((id) => ({ tipo: 'senal', id })),
      ...idsUnicos(observacionIds, 'observacionIds').map((id) => ({ tipo: 'observacion', id })),
      ...idsUnicos(fotografiaSenalIds, 'fotografiaSenalIds')
        .map((id) => ({ tipo: 'fotografiaSenal', id }))
    ];
    if (incluirFuente) {
      seleccion.unshift({ tipo: 'fuente', id: agente });
    }
    if (incluirFotografiaPol) seleccion.push({ tipo: 'fotografiaPol', id: agente });
    const capturas = await this.#capturarSeleccion(
      conexion,
      seleccion,
      ({ tipo }) => ['fotografiaSenal', 'fotografiaPol'].includes(tipo)
        ? 'operativaActual'
        : 'reconstruccion'
    );
    if (capturas.length !== seleccion.length) {
      fallar('captura_ingesta_incompleta', 'Una mutación confirmada no pudo convertirse en captura federada.');
    }
    for (const captura of capturas) {
      if (captura.agenteId !== agente) {
        fallar('captura_ingesta_scope_incoherente', 'La ingesta no puede capturar telemetría de otro agente.');
      }
    }
    return Object.freeze(capturas);
  }

  async listarCapturasEnTransaccion({ flujoId, generacionId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const flujo = await cargarFlujo(conexion, flujoId, generacionId);
    const agentes = await listarAgentesScope(conexion, flujo);
    const capturas = [];
    for (const agente of agentes) {
      capturas.push(await this.#crearCaptura(conexion, 'fuente', agente, 'reconstruccion'));
      const senales = await listarPorAgente(
        conexion, 'senales_telemetria_agentes', agente.id
      );
      const observaciones = await listarPorAgente(
        conexion, 'observaciones_telemetria_agentes', agente.id
      );
      const fotografias = await listarPorAgente(
        conexion, 'estado_actual_telemetria_agentes', agente.id
      );
      const periodosPol = await listarPeriodosPolPorAgente(conexion, agente.id);
      const reglas = await listarPorAgente(
        conexion, 'reglas_derivacion_telemetria', agente.id
      );
      const eventos = await listarPorAgente(
        conexion, 'eventos_derivados_telemetria', agente.id
      );
      for (const fila of senales) {
        capturas.push(await this.#crearCaptura(conexion, 'senal', fila, 'reconstruccion'));
      }
      for (const fila of observaciones) {
        capturas.push(await this.#crearCaptura(conexion, 'observacion', fila, 'reconstruccion'));
      }
      for (const fila of fotografias) {
        capturas.push(await this.#crearCaptura(conexion, 'fotografiaSenal', fila, 'operativaActual'));
      }
      if (periodosPol.length === 0) {
        capturas.push(await this.#crearCaptura(
          conexion, 'fotografiaPol', agente, 'operativaActual'
        ));
      } else {
        for (const periodoPol of periodosPol) {
          capturas.push(await this.#crearCaptura(
            conexion,
            'fotografiaPol',
            agente,
            'operativaActual',
            { periodoPol }
          ));
        }
      }
      for (const fila of reglas) {
        capturas.push(await this.#crearCaptura(conexion, 'reglaDerivacion', fila, 'reconstruccion'));
      }
      for (const fila of eventos) {
        capturas.push(await this.#crearCaptura(conexion, 'eventoDerivado', fila, 'reconstruccion'));
      }
    }
    return Object.freeze(capturas);
  }

  async prepararRetiradaEnTransaccion({ tipoRegistro, idLocal } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const tipo = exigirTipo(tipoRegistro);
    const id = idPositivo(idLocal, 'idLocal');
    const fila = await cargarRegistro(conexion, tipo, id);
    if (!fila) fallar('telemetria_retirada_inexistente', 'El elemento a retirar ya no existe.');
    const agente = await cargarAgenteDeFila(conexion, tipo, fila);
    const instante = fechaIso(this.ahora());
    const elementoOrigenId = await asegurarIdentidad({
      conexion, tipo, id, agente, generador: this.generadorIdentidades, instante
    });
    await conexion.execute(
      `UPDATE identidades_elementos_telemetria_federacion
          SET estado='retirado',retirada_en_utc=?,actualizada_en_utc=?,
              version_registro=version_registro+1
        WHERE tipo_elemento=? AND elemento_origen_id=? AND agente_id_local=?`,
      [instanteSql(instante), instanteSql(instante), tipo, elementoOrigenId,
        String(agente.id)]
    );
    return Object.freeze({
      tipoRegistro: tipo,
      idLocal: id,
      agenteId: String(agente.id),
      elementoOrigenId,
      prioridad: 'operativaActual',
      definicion: this.#definicion({
        agente,
        elementoOrigenId,
        instante,
        operacion: 'retirada',
        campos: {}
      })
    });
  }

  async prepararRetiradaAgenteEnTransaccion({ agenteId } = {}, { conexion } = {}) {
    await exigirTransaccion(conexion);
    const id = idPositivo(agenteId, 'agenteId');
    const agente = await cargarTabla(conexion, 'agentes_sentinelia', id);
    if (!agente) {
      fallar(
        'agente_retirada_telemetria_inexistente',
        'El agente debe existir mientras se prepara su retirada federada.'
      );
    }
    const [identidades] = await conexion.execute(
      `SELECT tipo_elemento,clave_local,elemento_origen_id,
              scope_tenant_id,scope_empresa_id,scope_sitio_id
         FROM identidades_elementos_telemetria_federacion
        WHERE agente_id_local=? AND estado='vigente'
        ORDER BY tipo_elemento,clave_local FOR UPDATE`,
      [id]
    );
    if (identidades.length === 0) {
      return resultadoRetiradaAgente([], 0);
    }
    const identidadOperativaSinRaiz = await buscarIdentidadOperativaSinRaiz(
      conexion,
      id
    );
    if (identidadOperativaSinRaiz) {
      fallar(
        'identidad_telemetria_operativa_sin_raiz',
        `La identidad operativa ${identidadOperativaSinRaiz.tipo_elemento}:` +
          `${identidadOperativaSinRaiz.clave_local} perdió su fila fuente.`
      );
    }
    const instante = fechaIso(this.ahora());
    const capturas = identidades
      .filter(({ tipo_elemento: tipo }) =>
        TIPOS_TOMBSTONE_RETIRADA_AGENTE.has(tipo)
      )
      .map((identidadLocal) => Object.freeze({
        tipoRegistro: identidadLocal.tipo_elemento,
        idLocal: String(identidadLocal.clave_local),
        agenteId: String(agente.id),
        elementoOrigenId: identidadLocal.elemento_origen_id,
        prioridad: 'operativaActual',
        definicion: this.#definicion({
          agente: {
            ...agente,
            tenant_id: identidadLocal.scope_tenant_id,
            empresa_id: identidadLocal.scope_empresa_id,
            sitio_id: identidadLocal.scope_sitio_id
          },
          elementoOrigenId: identidadLocal.elemento_origen_id,
          instante,
          operacion: 'retirada',
          campos: {}
        })
      }));
    await conexion.execute(
      `UPDATE identidades_elementos_telemetria_federacion
          SET estado='retirado',retirada_en_utc=?,actualizada_en_utc=?,
              version_registro=version_registro+1
        WHERE agente_id_local=? AND estado='vigente'`,
      [instanteSql(instante), instanteSql(instante), id]
    );
    return resultadoRetiradaAgente(
      capturas,
      identidades.length - capturas.length
    );
  }

  async #capturarSeleccion(conexion, seleccion, prioridad) {
    const capturas = [];
    for (const entrada of seleccion) {
      const { tipo, id } = entrada;
      const fila = await cargarRegistro(conexion, tipo, id);
      const prioridadEfectiva = typeof prioridad === 'function'
        ? prioridad(entrada)
        : prioridad;
      if (fila) {
        capturas.push(await this.#crearCaptura(
          conexion,
          tipo,
          fila,
          prioridadEfectiva
        ));
      }
    }
    return capturas;
  }

  async #crearCaptura(conexion, tipo, fila, prioridad, { periodoPol } = {}) {
    const agente = await cargarAgenteDeFila(conexion, tipo, fila);
    const instante = fechaIso(this.ahora());
    await asegurarIdentidadContextoAgenteFederacion({
      conexion,
      agente,
      generadorIdentidades: this.generadorIdentidades,
      instante
    });
    await asegurarIdentidadesScopeOrganizativoFederacion({
      conexion,
      tenantId: agente.tenant_id,
      empresaId: agente.empresa_id,
      sitioId: agente.sitio_id,
      generadorIdentidades: this.generadorIdentidades,
      instante
    });
    const elementoOrigenId = await asegurarIdentidad({
      conexion,
      tipo,
      id: claveLocal(tipo, fila),
      agente,
      generador: this.generadorIdentidades,
      instante
    });
    const payload = await construirPayload({
      conexion,
      tipo,
      fila,
      agente,
      generador: this.generadorIdentidades,
      instante,
      periodoPol,
      permitirMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
    return Object.freeze({
      tipoRegistro: tipo,
      idLocal: claveLocal(tipo, fila),
      agenteId: String(agente.id),
      elementoOrigenId,
      payload,
      prioridad,
      definicion: this.#definicion({
        agente,
        elementoOrigenId,
        instante,
        operacion: 'actualizacion',
        campos: { telemetria: crearCampoPresenteFederado({ valor: payload }) }
      })
    });
  }

  #definicion({ agente, elementoOrigenId, instante, operacion, campos }) {
    return Object.freeze({
      familia: 'telemetria',
      familiaVersion: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
      installationOrigenId: this.installationLocal,
      elementoOrigenId: identidad(
        elementoOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        'elementoOrigenId'
      ),
      ocurrenciaOrigenId: this.generadorIdentidades.generar(
        TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
      ),
      operacion,
      tiempoOrigenUtc: instante,
      scopeOrigenDeclarado: {
        nivel: 'sitio',
        tenantId: String(agente.tenant_id),
        empresaId: String(agente.empresa_id),
        sitioId: String(agente.sitio_id)
      },
      vigenciaRestanteMs: null,
      campos,
      evidenciaIntegridad: []
    });
  }
}

async function construirPayload({
  conexion,
  tipo,
  fila,
  agente,
  generador,
  instante,
  periodoPol,
  permitirMomentoUtcRelativo
}) {
  const fuenteOrigenId = tipo === 'fuente'
    ? null
    : await identidadDependencia(
      conexion, 'fuente', agente.id, agente, generador, instante
    );
  let contenido;
  if (tipo === 'fuente') {
    const contexto = await asegurarIdentidadContextoAgenteFederacion({
      conexion,
      agente,
      generadorIdentidades: generador,
      instante
    });
    contenido = {
      agenteContextoOrigenId: contexto,
      guid: agente.guid,
      nombre: agente.nombre,
      scopeOrganizativo: await asegurarIdentidadesScopeOrganizativoFederacion({
        conexion,
        tenantId: agente.tenant_id,
        empresaId: agente.empresa_id,
        sitioId: agente.sitio_id,
        generadorIdentidades: generador,
        instante
      })
    };
  } else if (tipo === 'senal') {
    contenido = payloadSenal(fila, fuenteOrigenId);
  } else if (tipo === 'observacion') {
    contenido = await payloadObservacion(conexion, fila, fuenteOrigenId, agente, generador, instante);
  } else if (tipo === 'fotografiaSenal') {
    contenido = await payloadFotografiaSenal(
      conexion, fila, fuenteOrigenId, agente, generador, instante
    );
  } else if (tipo === 'fotografiaPol') {
    contenido = await payloadFotografiaPol(
      conexion, agente, fuenteOrigenId, generador, instante, periodoPol
    );
  } else if (tipo === 'reglaDerivacion') {
    contenido = await payloadRegla(conexion, fila, fuenteOrigenId, agente, generador, instante);
  } else {
    contenido = await payloadEvento(conexion, fila, fuenteOrigenId, agente, generador, instante);
  }
  return validarPayloadTelemetriaFederacion({
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: tipo,
    ...contenido
  }, { permitirMomentoUtcRelativo });
}

function payloadSenal(fila, fuenteOrigenId) {
  return {
    fuenteOrigenId,
    categoria: fila.categoria,
    clave: fila.clave,
    tag: fila.tag,
    codigoSenal: fila.codigo_senal,
    tipoDato: fila.tipo_dato,
    unidad: fila.unidad,
    nombreHumano: fila.nombre_humano,
    descripcion: fila.descripcion,
    metadatosDescriptivos: jsonOpcional(fila.metadatos_descriptivos),
    consolidadaEnUtc: fechaIso(fila.consolidada_en_utc),
    ultimaDeclaracionUtc: fechaIsoOpcional(fila.ultima_declaracion_utc)
  };
}

async function payloadObservacion(conexion, fila, fuenteOrigenId, agente, generador, instante) {
  return {
    fuenteOrigenId,
    senalOrigenId: await identidadOpcionalDependencia(
      conexion, 'senal', fila.senal_id, agente, generador, instante
    ),
    periodoPolOrigenId: await identidadOpcionalDependencia(
      conexion, 'periodoPol', fila.periodo_vida_pol_id, agente, generador, instante
    ),
    ...cuerpoObservacion(fila)
  };
}

async function payloadFotografiaSenal(conexion, fila, fuenteOrigenId, agente, generador, instante) {
  const observacion = fila.ultima_observacion_id === null
    ? null
    : await cargarTabla(
      conexion, 'observaciones_telemetria_agentes', fila.ultima_observacion_id
    );
  const senalOrigenId = await identidadOpcionalDependencia(
    conexion, 'senal', fila.senal_id, agente, generador, instante
  );
  return {
    senalOrigenId,
    observacionOrigenId: observacion
      ? await identidadDependencia(
        conexion, 'observacion', observacion.id, agente, generador, instante
      )
      : null,
    secuenciaSenal: observacion ? String(observacion.id) : null,
    observacion: await payloadObservacion(
      conexion, observacion || fila, fuenteOrigenId, agente, generador, instante
    )
  };
}

async function payloadFotografiaPol(
  conexion,
  agente,
  fuenteOrigenId,
  generador,
  instante,
  periodoSeleccionado
) {
  let periodo = periodoSeleccionado;
  if (periodo === undefined) {
    const [filas] = await conexion.execute(
      `SELECT * FROM periodos_vida_pol_agentes
        WHERE agente_id=? ORDER BY inicio_utc DESC,id DESC LIMIT 1 FOR UPDATE`,
      [String(agente.id)]
    );
    periodo = filas[0] || null;
  }
  if (!periodo) {
    return {
      fuenteOrigenId,
      periodoPolOrigenId: null,
      estado: 'nuncaObservado',
      bootId: null,
      inicioUtc: null,
      finUtc: null,
      ultimoHeartbeatUtc: null,
      ultimoSeq: null,
      motivoCierre: null
    };
  }
  return {
    fuenteOrigenId,
    periodoPolOrigenId: await identidadDependencia(
      conexion, 'periodoPol', periodo.id, agente, generador, instante
    ),
    estado: periodo.fin_utc === null ? 'abierto' : 'cerrado',
    bootId: periodo.boot_id,
    inicioUtc: fechaIso(periodo.inicio_utc),
    finUtc: fechaIsoOpcional(periodo.fin_utc),
    ultimoHeartbeatUtc: fechaIsoOpcional(periodo.ultimo_heartbeat_utc),
    ultimoSeq: periodo.ultimo_seq === null ? null : String(periodo.ultimo_seq),
    motivoCierre: periodo.motivo_cierre
  };
}

async function payloadRegla(conexion, fila, fuenteOrigenId, agente, generador, instante) {
  const [revisionesFilas] = await conexion.execute(
    `SELECT * FROM revisiones_reglas_derivacion_telemetria
      WHERE regla_id=? ORDER BY numero,id FOR UPDATE`,
    [String(fila.id)]
  );
  const [estados] = await conexion.execute(
    'SELECT * FROM estado_actual_evaluacion_reglas_telemetria WHERE regla_id=? LIMIT 1 FOR UPDATE',
    [String(fila.id)]
  );
  const senalOrigenId = await identidadDependencia(
    conexion, 'senal', fila.senal_id, agente, generador, instante
  );
  const revisiones = [];
  const identidadesRevisiones = new Map();
  for (const revision of revisionesFilas) {
    const revisionOrigenId = await identidadDependencia(
      conexion, 'revisionReglaDerivacion', revision.id, agente, generador, instante
    );
    identidadesRevisiones.set(String(revision.id), revisionOrigenId);
    revisiones.push({
      revisionOrigenId,
      numero: String(revision.numero),
      condicionTipo: revision.condicion_tipo,
      condicionVersion: String(revision.condicion_version),
      condicion: json(revision.condicion_canonica),
      severidadCalculada: revision.severidad_calculada,
      mensajeOperativo: revision.mensaje_operativo,
      nombre: revision.nombre,
      descripcion: revision.descripcion,
      metadatosDescriptivos: jsonOpcional(revision.metadatos_descriptivos),
      vigenteDesdeUtc: fechaIso(revision.vigente_desde_utc),
      vigenteHastaUtc: fechaIsoOpcional(revision.vigente_hasta_utc)
    });
  }
  const revisionVigenteOrigenId = identidadesRevisiones.get(String(fila.revision_vigente_id));
  if (!revisionVigenteOrigenId) {
    fallar('revision_vigente_regla_ausente', 'La regla perdió su revisión vigente.');
  }
  const relativa = revisiones.some(
    ({ condicionTipo }) => condicionTipo === 'momento_utc_relativo'
  );
  return {
    fuenteOrigenId,
    senalOrigenId,
    estado: fila.estado,
    ...(relativa ? { generacionAutoridad: String(fila.generacion_autoridad) } : {}),
    revisionVigenteOrigenId,
    revisiones,
    estadoActual: estados[0]
      ? await payloadEstadoEvaluacion(
        conexion, estados[0], agente, generador, instante
      )
      : null
  };
}

async function payloadEstadoEvaluacion(
  conexion, fila, agente, generador, instante
) {
  const revisionOrigenId = await identidadDependencia(
    conexion, 'revisionReglaDerivacion', fila.regla_revision_id, agente, generador, instante
  );
  const relativa = fila.causalidad_revision === 'autoridad_actual';
  const evaluacion = relativa
    ? await cargarEvaluacionDurable(conexion, fila.evaluacion_id)
    : null;
  return {
    revisionOrigenId,
    observacionOrigenId: await identidadDependencia(
      conexion, 'observacion', fila.observacion_id, agente, generador, instante
    ),
    resultado: fila.resultado,
    codigoMotivo: fila.codigo_motivo,
    explicacion: fila.explicacion,
    valorEvaluado: json(fila.valor_evaluado),
    tipoDato: fila.tipo_dato,
    unidad: fila.unidad,
    calidad: fila.calidad,
    severidadCalculada: fila.severidad_calculada,
    mensajeOperativo: fila.mensaje_operativo,
    evidenciaContextual: jsonOpcional(fila.evidencia_contextual),
    observadoEnUtc: fechaIso(fila.observado_en_utc),
    recibidoEnUtc: fechaIso(fila.recibido_en_utc),
    evaluadoEnUtc: fechaIso(fila.evaluado_en_utc),
    ...(relativa
      ? await payloadCausalidadRelativa(
        conexion, fila, evaluacion, agente, generador, instante
      )
      : {})
  };
}

async function payloadEvento(conexion, fila, fuenteOrigenId, agente, generador, instante) {
  const relativa = fila.causalidad_revision === 'autoridad_actual';
  const evaluacion = relativa
    ? await cargarEvaluacionDurable(conexion, fila.evaluacion_id)
    : null;
  return {
    reglaOrigenId: await identidadDependencia(
      conexion, 'reglaDerivacion', fila.regla_id, agente, generador, instante
    ),
    revisionOrigenId: await identidadDependencia(
      conexion, 'revisionReglaDerivacion', fila.regla_revision_id, agente, generador, instante
    ),
    observacionOrigenId: await identidadDependencia(
      conexion, 'observacion', fila.observacion_id, agente, generador, instante
    ),
    fuenteOrigenId,
    senalOrigenId: await identidadDependencia(
      conexion, 'senal', fila.senal_id, agente, generador, instante
    ),
    evento: 'coincide',
    codigoMotivo: fila.codigo_motivo,
    explicacion: fila.explicacion,
    condicion: json(fila.condicion_canonica),
    valorEvaluado: json(fila.valor_evaluado),
    tipoDato: fila.tipo_dato,
    unidad: fila.unidad,
    calidad: fila.calidad,
    severidadCalculada: fila.severidad_calculada,
    mensajeOperativo: fila.mensaje_operativo,
    evidenciaContextual: jsonOpcional(fila.evidencia_contextual),
    observadoEnUtc: fechaIso(fila.observado_en_utc),
    recibidoEnUtc: fechaIso(fila.recibido_en_utc),
    evaluadoEnUtc: fechaIso(fila.evaluado_en_utc),
    creadoEnUtc: fechaIso(fila.creado_en_utc),
    ...(relativa
      ? await payloadCausalidadRelativa(
        conexion, fila, evaluacion, agente, generador, instante
      )
      : {})
  };
}

async function payloadCausalidadRelativa(
  conexion,
  proyeccion,
  evaluacion,
  agente,
  generador,
  instante
) {
  if (!evaluacion || String(evaluacion.id) !== String(proyeccion.evaluacion_id)) {
    fallar(
      'evaluacion_relativa_local_ausente',
      'La proyección relativa perdió su evaluación durable de origen.'
    );
  }
  return {
    evaluacionOrigenId: await identidadDependencia(
      conexion, 'estadoEvaluacion', evaluacion.id, agente, generador, instante
    ),
    generacionAutoridad: String(evaluacion.generacion_autoridad),
    causalidadRevision: 'autoridad_actual',
    causa: evaluacion.causa,
    ladoAtencion: proyeccion.lado_atencion,
    evidenciaTemporal: {
      momentoUtc: fechaIsoOpcional(evaluacion.momento_utc),
      ahoraUtc: fechaIso(evaluacion.ahora_utc),
      desviacionSegundos: evaluacion.desviacion_segundos == null
        ? null
        : String(evaluacion.desviacion_segundos),
      resultadoAnterior: evaluacion.resultado_anterior,
      ladoAnterior: evaluacion.lado_anterior,
      programadoParaUtc: fechaIsoOpcional(evaluacion.programado_para_utc),
      proximaReevaluacionUtc: fechaIsoOpcional(evaluacion.proxima_reevaluacion_utc),
      correccionReloj: extraerCorreccionReloj(evaluacion)
    }
  };
}

async function cargarEvaluacionDurable(conexion, evaluacionId) {
  if (evaluacionId == null) return null;
  const [filas] = await conexion.execute(
    'SELECT * FROM evaluaciones_reglas_telemetria WHERE id=? LIMIT 1 FOR UPDATE',
    [String(evaluacionId)]
  );
  return filas[0] || null;
}

function extraerCorreccionReloj(evaluacion) {
  if (evaluacion.causa !== 'reconciliacion_reloj') return null;
  const evidencia = jsonOpcional(evaluacion.evidencia_contextual);
  const correccion = evidencia?.temporal?.correccionReloj ??
    evidencia?.correccionReloj ?? null;
  if (!correccion) {
    fallar(
      'evidencia_correccion_reloj_local_ausente',
      'La reconciliación de reloj perdió su evidencia temporal.'
    );
  }
  return correccion;
}

function cuerpoObservacion(fila) {
  return {
    categoria: fila.categoria,
    clave: fila.clave,
    tag: fila.tag,
    codigoSenal: fila.codigo_senal,
    tipoDato: fila.tipo_dato,
    unidad: fila.unidad,
    valor: valorObservacion(fila),
    calidad: fila.calidad,
    severidadDeclarada: fila.severidad_declarada,
    origen: fila.origen,
    vigenteHastaUtc: fechaIsoOpcional(fila.vigente_hasta_utc),
    detalleHumano: fila.detalle_humano,
    metadatosContextuales: jsonOpcional(fila.metadatos_contextuales),
    emitidoEnUtc: fechaIsoOpcional(fila.emitido_en_utc),
    observadoEnUtc: fechaIso(fila.observado_en_utc),
    recibidoEnUtc: fechaIso(fila.recibido_en_utc)
  };
}

function valorObservacion(fila) {
  if (fila.tipo_dato === 'numero') return Number(fila.valor_numero);
  if (fila.tipo_dato === 'booleano') return Boolean(fila.valor_booleano);
  if (fila.tipo_dato === 'texto') return fila.valor_texto;
  if (fila.tipo_dato === 'estado') return fila.valor_estado;
  if (fila.tipo_dato === 'duracion') {
    return duracionTelemetriaDesdeSql(fila.valor_duracion);
  }
  if (fila.tipo_dato === 'momento_utc') {
    return momentoUtcTelemetriaDesdeSql(fila.valor_momento_utc);
  }
  return json(fila.valor_json);
}

async function cargarFlujo(conexion, flujoId, generacionId) {
  const [filas] = await conexion.execute(
    `SELECT f.scope_nivel,f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=?
      WHERE f.flujo_id=? AND f.direccion='emision' AND f.familia='telemetria'
        AND g.estado NOT IN ('cancelada','sustituida')
      LIMIT 1 FOR UPDATE`,
    [generacionId, flujoId]
  );
  if (!filas[0]) fallar('flujo_fotografia_telemetria_invalido', 'La fotografía exige una generación emisora vigente.');
  return filas[0];
}

async function listarAgentesScope(conexion, flujo) {
  const filtros = {
    portal: ['', []],
    tenant: ['WHERE tenant_id=?', [flujo.scope_tenant_id]],
    empresa: ['WHERE tenant_id=? AND empresa_id=?', [flujo.scope_tenant_id, flujo.scope_empresa_id]],
    sitio: ['WHERE tenant_id=? AND empresa_id=? AND sitio_id=?', [
      flujo.scope_tenant_id, flujo.scope_empresa_id, flujo.scope_sitio_id
    ]]
  };
  const [filtro, parametros] = filtros[flujo.scope_nivel];
  const [filas] = await conexion.execute(
    `SELECT * FROM agentes_sentinelia ${filtro} ORDER BY id FOR UPDATE`, parametros
  );
  return filas;
}

async function listarPorAgente(conexion, tabla, agenteId) {
  const permitidas = new Set([
    'senales_telemetria_agentes', 'observaciones_telemetria_agentes',
    'estado_actual_telemetria_agentes', 'reglas_derivacion_telemetria',
    'eventos_derivados_telemetria'
  ]);
  if (!permitidas.has(tabla)) fallar('tabla_telemetria_invalida', 'La tabla solicitada no es federable.');
  const [filas] = await conexion.execute(
    `SELECT * FROM ${tabla} WHERE agente_id=? ORDER BY id FOR UPDATE`, [String(agenteId)]
  );
  return filas;
}

async function listarPeriodosPolPorAgente(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT * FROM periodos_vida_pol_agentes
      WHERE agente_id=? ORDER BY inicio_utc,id FOR UPDATE`,
    [String(agenteId)]
  );
  return filas;
}

async function buscarIdentidadOperativaSinRaiz(conexion, agenteId) {
  const [filas] = await conexion.execute(
    `SELECT i.tipo_elemento,i.clave_local
       FROM identidades_elementos_telemetria_federacion i
       LEFT JOIN senales_telemetria_agentes s
         ON i.tipo_elemento='senal'
        AND i.clave_local REGEXP '^[1-9][0-9]*$'
        AND s.id=CAST(i.clave_local AS UNSIGNED)
        AND s.agente_id=i.agente_id_local
       LEFT JOIN estado_actual_telemetria_agentes e
         ON i.tipo_elemento='fotografiaSenal'
        AND i.clave_local REGEXP '^[1-9][0-9]*(:[1-9][0-9]*)?$'
        AND e.id=CAST(SUBSTRING_INDEX(i.clave_local,':',1) AS UNSIGNED)
        AND e.agente_id=i.agente_id_local
       LEFT JOIN reglas_derivacion_telemetria r
         ON i.tipo_elemento='reglaDerivacion'
        AND i.clave_local REGEXP '^[1-9][0-9]*$'
        AND r.id=CAST(i.clave_local AS UNSIGNED)
        AND r.agente_id=i.agente_id_local
      WHERE i.agente_id_local=? AND i.estado='vigente'
        AND i.tipo_elemento IN (
          'fuente','senal','fotografiaSenal','fotografiaPol','reglaDerivacion'
        )
        AND (
          (i.tipo_elemento IN ('fuente','fotografiaPol')
            AND i.clave_local<>CAST(
              i.agente_id_local AS CHAR CHARACTER SET ascii
            ) COLLATE ascii_bin)
          OR (i.tipo_elemento='senal' AND s.id IS NULL)
          OR (i.tipo_elemento='fotografiaSenal' AND e.id IS NULL)
          OR (i.tipo_elemento='reglaDerivacion' AND r.id IS NULL)
        )
      ORDER BY i.tipo_elemento,i.clave_local
      LIMIT 1`,
    [agenteId]
  );
  return filas[0] || null;
}

async function cargarRegistro(conexion, tipo, id) {
  if (tipo === 'fuente' || tipo === 'fotografiaPol') return cargarTabla(conexion, 'agentes_sentinelia', id);
  const tablas = {
    senal: 'senales_telemetria_agentes',
    observacion: 'observaciones_telemetria_agentes',
    fotografiaSenal: 'estado_actual_telemetria_agentes',
    reglaDerivacion: 'reglas_derivacion_telemetria',
    eventoDerivado: 'eventos_derivados_telemetria'
  };
  return cargarTabla(conexion, tablas[tipo], id);
}

async function cargarTabla(conexion, tabla, id) {
  const permitidas = new Set([
    'agentes_sentinelia', 'senales_telemetria_agentes',
    'observaciones_telemetria_agentes', 'estado_actual_telemetria_agentes',
    'reglas_derivacion_telemetria', 'eventos_derivados_telemetria'
  ]);
  if (!permitidas.has(tabla)) fallar('tabla_telemetria_invalida', 'La tabla solicitada no es federable.');
  const [filas] = await conexion.execute(`SELECT * FROM ${tabla} WHERE id=? LIMIT 1 FOR UPDATE`, [id]);
  return filas[0] || null;
}

async function cargarAgenteDeFila(conexion, tipo, fila) {
  if (tipo === 'fuente' || tipo === 'fotografiaPol') return fila;
  const agente = await cargarTabla(conexion, 'agentes_sentinelia', fila.agente_id);
  if (!agente) fallar('agente_telemetria_inexistente', 'La telemetría perdió su agente de origen.');
  return agente;
}

async function identidadOpcionalDependencia(conexion, tipo, id, agente, generador, instante) {
  return id === null ? null : identidadDependencia(conexion, tipo, id, agente, generador, instante);
}

async function identidadDependencia(conexion, tipo, id, agente, generador, instante) {
  return asegurarIdentidad({
    conexion, tipo, id: String(id), agente, generador, instante
  });
}

async function asegurarIdentidad({ conexion, tipo, id, agente, generador, instante }) {
  const claveBase = String(id);
  const permiteNuevaEncarnacion = tipo === 'fotografiaSenal';
  const [filas] = permiteNuevaEncarnacion
    ? await conexion.execute(
      `SELECT clave_local,elemento_origen_id,estado,
              agente_id_local,scope_tenant_id,scope_empresa_id,scope_sitio_id
         FROM identidades_elementos_telemetria_federacion
        WHERE tipo_elemento=?
          AND (
            clave_local=CONVERT(? USING ascii)
            OR clave_local LIKE CONCAT(CONVERT(? USING ascii),_ascii':%')
          )
        ORDER BY clave_local FOR UPDATE`,
      [tipo, claveBase, claveBase]
    )
    : await conexion.execute(
      `SELECT clave_local,elemento_origen_id,estado,
              agente_id_local,scope_tenant_id,scope_empresa_id,scope_sitio_id
         FROM identidades_elementos_telemetria_federacion
        WHERE tipo_elemento=? AND clave_local=? FOR UPDATE`,
      [tipo, claveBase]
    );
  const vigentes = filas.filter(({ estado }) => estado === 'vigente');
  if (vigentes.length > 1) {
    fallar(
      'identidades_telemetria_vigentes_duplicadas',
      'Una fotografía local no puede tener dos encarnaciones federadas vigentes.'
    );
  }
  const filaVigente = vigentes[0];
  if (filaVigente) {
    if (String(filaVigente.agente_id_local) !== String(agente.id)) {
      fallar(
        'identidad_telemetria_agente_incoherente',
        'Una identidad federada de telemetría no puede cambiar de agente local.'
      );
    }
    if (
      String(filaVigente.scope_tenant_id) === String(agente.tenant_id) &&
      String(filaVigente.scope_empresa_id) === String(agente.empresa_id) &&
      String(filaVigente.scope_sitio_id) === String(agente.sitio_id)
    ) {
      return filaVigente.elemento_origen_id;
    }
    await conexion.execute(
      `UPDATE identidades_elementos_telemetria_federacion
          SET scope_tenant_id=?,scope_empresa_id=?,scope_sitio_id=?,
              actualizada_en_utc=?,version_registro=version_registro+1
        WHERE tipo_elemento=? AND clave_local=?`,
      [agente.tenant_id, agente.empresa_id, agente.sitio_id,
        instanteSql(instante), tipo, filaVigente.clave_local]
    );
    return filaVigente.elemento_origen_id;
  }
  if (filas.length > 0 && !permiteNuevaEncarnacion) {
    fallar('identidad_telemetria_retirada', 'Una identidad retirada no puede resucitar.');
  }
  const claveLocal = permiteNuevaEncarnacion && filas.length > 0
    ? siguienteClaveEncarnacionFotografia(claveBase, filas)
    : claveBase;
  const elementoOrigenId = String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN));
  await conexion.execute(
    `INSERT INTO identidades_elementos_telemetria_federacion (
       tipo_elemento,clave_local,agente_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [tipo, claveLocal, String(agente.id), elementoOrigenId,
      agente.tenant_id, agente.empresa_id,
      agente.sitio_id, instanteSql(instante), instanteSql(instante)]
  );
  return elementoOrigenId;
}

function siguienteClaveEncarnacionFotografia(claveBase, filas) {
  const prefijo = `${claveBase}:`;
  const ultima = filas.reduce((maximo, { clave_local: clave }) => {
    if (clave === claveBase) return Math.max(maximo, 1);
    if (!String(clave).startsWith(prefijo)) return maximo;
    const ordinal = Number(String(clave).slice(prefijo.length));
    return Number.isSafeInteger(ordinal) && ordinal > 1
      ? Math.max(maximo, ordinal)
      : maximo;
  }, 1);
  return `${claveBase}:${ultima + 1}`;
}

function resultadoRetiradaAgente(capturas, identidadesHistoricasCerradas) {
  return Object.freeze({
    capturas: Object.freeze(capturas),
    identidadesRetiradas: capturas.length + identidadesHistoricasCerradas,
    tombstones: capturas.length,
    identidadesHistoricasCerradas
  });
}

function claveLocal(tipo, fila) {
  return String(tipo === 'fotografiaPol' ? fila.id : fila.id);
}

function exigirTipo(valor) {
  if (!TIPOS_CAPTURABLES.has(valor)) fallar('tipo_telemetria_no_capturable', 'El tipo no admite captura local.');
  return valor;
}

function idsUnicos(valores, campo) {
  if (!Array.isArray(valores)) fallar('lista_ids_telemetria_invalida', `${campo} debe ser una lista.`);
  return [...new Set(valores.map((valor) => idPositivo(valor, campo)))];
}

async function exigirTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') fallar('conexion_telemetria_ausente', 'Se requiere conexión compartida.');
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) fallar('transaccion_telemetria_ausente', 'Se requiere transacción activa.');
}

function idPositivo(valor, campo) {
  const texto = String(valor || '');
  if (!/^[1-9]\d*$/u.test(texto)) fallar('id_telemetria_invalido', `${campo} debe ser positivo.`);
  return texto;
}

function identidad(valor, tipo, campo) {
  try { return String(crearIdentidadFederada({ tipo, valor: String(valor || '') })); }
  catch { fallar('identidad_telemetria_local_invalida', `${campo} no es válido.`); }
}

function fechaIso(valor) {
  const texto = String(valor);
  const fecha = valor instanceof Date
    ? valor
    : new Date(texto.includes('T') ? texto : `${texto.replace(' ', 'T')}Z`);
  if (Number.isNaN(fecha.getTime())) fallar('fecha_telemetria_local_invalida', 'La fecha SQL no es válida.');
  return fecha.toISOString();
}

function fechaIsoOpcional(valor) { return valor === null ? null : fechaIso(valor); }
function instanteSql(valor) { return valor.slice(0, 23).replace('T', ' ').replace('Z', ''); }
function json(valor) { return typeof valor === 'string' ? JSON.parse(valor) : valor; }
function jsonOpcional(valor) { return valor === null ? null : json(valor); }

function fallar(codigo, mensaje) {
  throw new ErrorTelemetriaLocalFederacion(codigo, mensaje);
}
