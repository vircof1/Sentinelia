import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';

const CAUSAS_CIERRE = new Set([
  'revocada_desde_agente', 'revocada_desde_registro',
  'agente_eliminado', 'registro_eliminado', 'objetivo_incompatible'
]);

export class ErrorConcesionDdnsAgentes extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorConcesionDdnsAgentes';
    this.codigo = codigo;
  }
}

export class RepositorioConcesionesDdnsAgentes {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new TypeError('El repositorio DDNS requiere un cliente SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async crearConcesion(datos) {
    return this.frontera.ejecutar((conexion) =>
      this.crearConcesionEnTransaccion(datos, { conexion })
    );
  }

  async crearConcesionEnTransaccion(
    {
      concesionId,
      agenteId,
      registroDnsId,
      contenidoDeseadoCanonico = null,
      contenidoDeseadoSha256 = null,
      contenidoPublicadoCanonico = null,
      contenidoPublicadoSha256 = null,
      generacionDnsPublicada = null,
      condicionOperativa = 'pendiente_decision_agente'
    },
    { conexion }
  ) {
    validarConexion(conexion);
    const agente = exigirId(agenteId, 'agenteId');
    const registro = exigirId(registroDnsId, 'registroDnsId');
    const idPublico = uuidV7AuditoriaABytes(concesionId, 'concesionId');
    const deseado = normalizarContenido(
      contenidoDeseadoCanonico,
      contenidoDeseadoSha256,
      'contenido deseado'
    );
    const publicado = normalizarContenidoPublicado({
      contenidoPublicadoCanonico,
      contenidoPublicadoSha256,
      generacionDnsPublicada
    });
    const condicion = exigirCondicionOperativa(condicionOperativa);
    try {
      const [resultado] = await conexion.execute(
        `INSERT INTO concesiones_ddns_agentes (
           concesion_id,agente_id,registro_dns_id,
           agente_id_fotografia,registro_dns_id_fotografia,
           agente_scope_tenant_id,agente_scope_empresa_id,
           agente_scope_sitio_id,registro_scope_tenant_id,
           registro_scope_empresa_id,registro_scope_sitio_id,
           contenido_deseado_canonico,contenido_deseado_sha256,
           contenido_publicado_canonico,contenido_publicado_sha256,
           generacion_dns_publicada,condicion_operativa
         )
         SELECT ?,a.id,r.id,a.id,r.id,a.tenant_id,a.empresa_id,a.sitio_id,
                r.tenant_id,r.empresa_id,r.sitio_id,?,?,?,?,?,?
           FROM agentes_sentinelia a
           JOIN registros_dns r ON r.id=?
          WHERE a.id=?`,
        [
          idPublico,
          deseado.canonico,
          deseado.huella,
          publicado.canonico,
          publicado.huella,
          publicado.generacion,
          condicion,
          registro,
          agente
        ]
      );
      if (resultado.affectedRows !== 1) {
        throw new ErrorConcesionDdnsAgentes(
          'No existen ambos extremos de la concesión DDNS.',
          'extremo_no_encontrado'
        );
      }
      return this.buscarPorIdInternoEnTransaccion(resultado.insertId, conexion);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' &&
          /uk_concesiones_ddns_registro_vigente/u.test(error.message)) {
        throw new ErrorConcesionDdnsAgentes(
          'El registro ya posee una concesión DDNS vigente.',
          'registro_ya_concedido'
        );
      }
      if (error?.code === 'ER_DUP_ENTRY' &&
          /uk_concesiones_ddns_id_publico/u.test(error.message)) {
        throw new ErrorConcesionDdnsAgentes(
          'La identidad pública de concesión DDNS ya existe.',
          'concesion_duplicada'
        );
      }
      throw error;
    }
  }

  async buscarPorConcesionId(concesionId) {
    const filas = await this.clienteSql.consultar(
      `${consultaBase()} WHERE c.concesion_id=?`,
      [uuidV7AuditoriaABytes(concesionId, 'concesionId')]
    );
    return filas[0] ? mapear(filas[0]) : null;
  }

  async listarObservadasAptasPorAgente(agenteId) {
    const agente = exigirId(agenteId, 'agenteId');
    const filas = await this.clienteSql.consultar(
      `SELECT c.id,c.concesion_id,c.registro_dns_id,
              c.version_ddns,c.intencion_gobernante_id,
              r.tipo_registro,r.valor_principal,r.zona_id
         FROM concesiones_ddns_agentes c
         JOIN registros_dns r ON r.id=c.registro_dns_id
         JOIN zonas_dns z ON z.id=r.zona_id
        WHERE c.agente_id=? AND c.estado='vigente'
          AND c.decision='operativa' AND c.modo='observada'
          AND r.categoria_origen='ddns' AND r.tipo_registro IN ('A','AAAA')
          AND r.activo=TRUE AND r.publicar_en_bind=TRUE
          AND z.activo=TRUE AND z.publicar_en_bind=TRUE AND z.tipo_zona='master'
        ORDER BY c.id`,
      [agente]
    );
    return Object.freeze(filas.map((fila) => Object.freeze({
      idInterno: String(fila.id),
      concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
      registroDnsId: String(fila.registro_dns_id),
      zonaDnsId: String(fila.zona_id),
      version: String(fila.version_ddns),
      intencionGobernanteId: nullable(fila.intencion_gobernante_id),
      tipoRegistro: fila.tipo_registro,
      valorPrincipal: fila.valor_principal
    })));
  }

  async buscarPorConcesionIdEnTransaccion(
    concesionId,
    { conexion, forUpdate = false } = {}
  ) {
    validarConexion(conexion);
    const [filas] = await conexion.execute(
      `${consultaBase()} WHERE c.concesion_id=?${forUpdate ? ' FOR UPDATE' : ''}`,
      [uuidV7AuditoriaABytes(concesionId, 'concesionId')]
    );
    return filas[0] ? mapear(filas[0]) : null;
  }

  async buscarVigentePorRegistroIdEnTransaccion(
    registroDnsId,
    { conexion, forUpdate = false } = {}
  ) {
    validarConexion(conexion);
    const registro = exigirId(registroDnsId, 'registroDnsId');
    const [filas] = await conexion.execute(
      `${consultaBase()} WHERE c.registro_dns_id=? AND c.estado='vigente'${
        forUpdate ? ' FOR UPDATE' : ''
      }`,
      [registro]
    );
    return filas[0] ? mapear(filas[0]) : null;
  }

  async actualizarScopeVigentePorAgenteEnTransaccion(
    { agenteId, scope },
    { conexion } = {}
  ) {
    return this.#actualizarScopeVigenteEnTransaccion({
      extremo: 'agente',
      identidad: exigirId(agenteId, 'agenteId'),
      scope: normalizarScopeFotografia(scope, { exigeSitio: true })
    }, conexion);
  }

  async actualizarScopeVigentePorZonaEnTransaccion(
    { zonaId, scope },
    { conexion } = {}
  ) {
    return this.#actualizarScopeVigenteEnTransaccion({
      extremo: 'registro',
      identidad: exigirId(zonaId, 'zonaId'),
      scope: normalizarScopeFotografia(scope)
    }, conexion);
  }

  async listarVigentesPorZonaEnTransaccion(zonaId, { conexion } = {}) {
    validarConexion(conexion);
    const zona = exigirId(zonaId, 'zonaId');
    const [filas] = await conexion.execute(
      `${consultaBase()} WHERE c.estado='vigente' AND EXISTS (
          SELECT 1 FROM registros_dns r
           WHERE r.id=c.registro_dns_id AND r.zona_id=?
        ) ORDER BY c.id FOR UPDATE`,
      [zona]
    );
    return Object.freeze(filas.map(mapear));
  }

  async cerrarConcesion({ concesionId, causa }) {
    return this.frontera.ejecutar((conexion) =>
      this.cerrarConcesionEnTransaccion({ concesionId, causa }, { conexion })
    );
  }

  async cerrarConcesionEnTransaccion(
    { concesionId, causa },
    { conexion } = {}
  ) {
    validarConexion(conexion);
    exigirCausa(causa);
    const concesion = await this.buscarPorConcesionIdEnTransaccion(
      concesionId,
      { conexion, forUpdate: true }
    );
    if (!concesion || concesion.estado === 'revocada') return concesion;
    await conexion.execute(
      `UPDATE concesiones_ddns_agentes
          SET estado='revocada',causa_cierre=?,cerrada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND estado='vigente'`,
      [causa, concesion.idInterno]
    );
    return this.buscarPorIdInternoEnTransaccion(concesion.idInterno, conexion);
  }

  async desacoplarExtremoCerrado(
    { concesionId, extremo },
    { conexion = null } = {}
  ) {
    if (!['agente', 'registro'].includes(extremo)) {
      throw new TypeError('El extremo DDNS debe ser agente o registro.');
    }
    const ejecutar = async (contexto) => {
      const columna = extremo === 'agente' ? 'agente_id' : 'registro_dns_id';
      const [resultado] = await contexto.execute(
        `UPDATE concesiones_ddns_agentes SET ${columna}=NULL
          WHERE concesion_id=? AND estado='revocada'`,
        [uuidV7AuditoriaABytes(concesionId, 'concesionId')]
      );
      return resultado.affectedRows > 0;
    };
    if (conexion) return ejecutar(conexion);
    return this.frontera.ejecutar(ejecutar);
  }

  async desacoplarRegistrosCerradosPorObjetivoEnTransaccion({
    registroDnsId = null,
    zonaId = null
  } = {}, { conexion } = {}) {
    validarConexion(conexion);
    const porRegistro = registroDnsId !== null;
    if (porRegistro === (zonaId !== null)) {
      throw new TypeError('El desacople DDNS exige exactamente un registro o una zona.');
    }
    const identidad = exigirId(
      porRegistro ? registroDnsId : zonaId,
      porRegistro ? 'registroDnsId' : 'zonaId'
    );
    const [resultado] = porRegistro
      ? await conexion.execute(
          `UPDATE concesiones_ddns_agentes
              SET registro_dns_id=NULL
            WHERE registro_dns_id=? AND estado='revocada'`,
          [identidad]
        )
      : await conexion.execute(
          `UPDATE concesiones_ddns_agentes c
             JOIN registros_dns r ON r.id=c.registro_dns_id
              SET c.registro_dns_id=NULL
            WHERE r.zona_id=? AND c.estado='revocada'`,
          [identidad]
        );
    return Number(resultado.affectedRows || 0);
  }

  async #actualizarScopeVigenteEnTransaccion(
    { extremo, identidad, scope },
    conexion
  ) {
    validarConexion(conexion);
    const filtro = extremo === 'agente'
      ? 'c.agente_id=?'
      : `EXISTS (
          SELECT 1 FROM registros_dns r
           WHERE r.id=c.registro_dns_id AND r.zona_id=?
        )`;
    const [filas] = await conexion.execute(
      `${consultaBase()} WHERE c.estado='vigente' AND ${filtro}
        ORDER BY c.id FOR UPDATE`,
      [identidad]
    );
    const anteriores = filas.map(mapear);
    if (anteriores.length === 0) return Object.freeze([]);

    const ids = anteriores.map(({ idInterno }) => idInterno);
    const columnas = extremo === 'agente'
      ? [
          'agente_scope_tenant_id',
          'agente_scope_empresa_id',
          'agente_scope_sitio_id'
        ]
      : [
          'registro_scope_tenant_id',
          'registro_scope_empresa_id',
          'registro_scope_sitio_id'
        ];
    await conexion.execute(
      `UPDATE concesiones_ddns_agentes
          SET ${columnas[0]}=?,${columnas[1]}=?,${columnas[2]}=?
        WHERE id IN (${ids.map(() => '?').join(',')}) AND estado='vigente'`,
      [scope.tenantId, scope.empresaId, scope.sitioId, ...ids]
    );
    const [posteriores] = await conexion.execute(
      `${consultaBase()} WHERE c.id IN (${ids.map(() => '?').join(',')})
        ORDER BY c.id`,
      ids
    );
    const despuesPorId = new Map(
      posteriores.map((fila) => {
        const concesion = mapear(fila);
        return [concesion.idInterno, concesion];
      })
    );
    return Object.freeze(anteriores.map((antes) => Object.freeze({
      antes,
      despues: despuesPorId.get(antes.idInterno)
    })));
  }

  async buscarPorIdInternoEnTransaccion(id, conexion) {
    const [filas] = await conexion.execute(
      `${consultaBase()} WHERE c.id=?`,
      [id]
    );
    return filas[0] ? mapear(filas[0]) : null;
  }
}

function consultaBase() {
  return `SELECT c.id,c.concesion_id,c.agente_id,c.registro_dns_id,
    c.agente_id_fotografia,c.registro_dns_id_fotografia,c.estado,
    c.causa_cierre,c.version_ddns,c.decision,c.modo,c.intencion_gobernante_id,
    c.condicion_operativa,
    c.agente_scope_tenant_id,c.agente_scope_empresa_id,c.agente_scope_sitio_id,
    c.registro_scope_tenant_id,c.registro_scope_empresa_id,
    c.registro_scope_sitio_id,c.contenido_deseado_canonico,
    c.contenido_deseado_sha256,c.contenido_publicado_canonico,
    c.contenido_publicado_sha256,c.generacion_dns_publicada,
    c.creada_en_utc,c.cerrada_en_utc
    FROM concesiones_ddns_agentes c`;
}

function mapear(fila) {
  return Object.freeze({
    idInterno: String(fila.id),
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    agenteId: fila.agente_id === null ? null : String(fila.agente_id),
    registroDnsId: fila.registro_dns_id === null ? null : String(fila.registro_dns_id),
    agenteIdFotografia: String(fila.agente_id_fotografia),
    registroDnsIdFotografia: String(fila.registro_dns_id_fotografia),
    estado: fila.estado,
    causaCierre: fila.causa_cierre,
    version: String(fila.version_ddns),
    decision: fila.decision,
    modo: fila.modo,
    intencionGobernanteId: nullable(fila.intencion_gobernante_id),
    condicion: fila.condicion_operativa,
    contenidoDeseado: json(fila.contenido_deseado_canonico),
    contenidoDeseadoSha256: copiarBuffer(fila.contenido_deseado_sha256),
    contenidoPublicado: json(fila.contenido_publicado_canonico),
    contenidoPublicadoSha256: copiarBuffer(fila.contenido_publicado_sha256),
    generacionDnsPublicada: nullable(fila.generacion_dns_publicada),
    scopeAgente: scope(fila, 'agente'),
    scopeRegistro: scope(fila, 'registro'),
    creadaEnUtc: fila.creada_en_utc,
    cerradaEnUtc: fila.cerrada_en_utc
  });
}

function scope(fila, prefijo) {
  return Object.freeze({
    tenantId: nullable(fila[`${prefijo}_scope_tenant_id`]),
    empresaId: nullable(fila[`${prefijo}_scope_empresa_id`]),
    sitioId: nullable(fila[`${prefijo}_scope_sitio_id`])
  });
}

function nullable(valor) {
  return valor === null ? null : String(valor);
}

function exigirId(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${nombre} no es válido.`);
  return texto;
}

function exigirCausa(causa) {
  if (!CAUSAS_CIERRE.has(causa)) throw new TypeError('La causa de cierre DDNS no es válida.');
}

function normalizarScopeFotografia(scopeEntrada, { exigeSitio = false } = {}) {
  const resultado = Object.freeze({
    tenantId: nullableId(scopeEntrada?.tenantId, 'scope.tenantId'),
    empresaId: nullableId(scopeEntrada?.empresaId, 'scope.empresaId'),
    sitioId: nullableId(scopeEntrada?.sitioId, 'scope.sitioId')
  });
  if (resultado.tenantId === null &&
      (resultado.empresaId !== null || resultado.sitioId !== null)) {
    throw new TypeError('Un scope portal no admite empresa ni sitio.');
  }
  if (resultado.empresaId === null && resultado.sitioId !== null) {
    throw new TypeError('Un scope de sitio exige empresa.');
  }
  if (exigeSitio && Object.values(resultado).some((valor) => valor === null)) {
    throw new TypeError('El scope de un agente debe identificar tenant, empresa y sitio.');
  }
  return resultado;
}

function nullableId(valor, nombre) {
  return valor === null || valor === undefined ? null : exigirId(valor, nombre);
}

function normalizarContenido(canonico, huella, nombre) {
  if (canonico === null && huella === null) {
    return Object.freeze({ canonico: null, huella: null });
  }
  if (typeof canonico !== 'string' || canonico.length === 0) {
    throw new TypeError(`${nombre} debe ser JSON canónico no vacío.`);
  }
  try {
    JSON.parse(canonico);
  } catch {
    throw new TypeError(`${nombre} no contiene JSON válido.`);
  }
  if (!Buffer.isBuffer(huella) || huella.length !== 32) {
    throw new TypeError(`La huella de ${nombre} debe contener 32 bytes.`);
  }
  return Object.freeze({ canonico, huella: Buffer.from(huella) });
}

function normalizarContenidoPublicado({
  contenidoPublicadoCanonico,
  contenidoPublicadoSha256,
  generacionDnsPublicada
}) {
  const ausente = contenidoPublicadoCanonico === null &&
    contenidoPublicadoSha256 === null && generacionDnsPublicada === null;
  if (ausente) {
    return Object.freeze({ canonico: null, huella: null, generacion: null });
  }
  const contenido = normalizarContenido(
    contenidoPublicadoCanonico,
    contenidoPublicadoSha256,
    'contenido publicado'
  );
  return Object.freeze({
    ...contenido,
    generacion: exigirId(generacionDnsPublicada, 'generacionDnsPublicada')
  });
}

function exigirCondicionOperativa(valor) {
  if (!['pendiente_decision_agente', 'publicacion_previa_desconocida'].includes(valor)) {
    throw new TypeError('La condición inicial de concesión DDNS no es válida.');
  }
  return valor;
}

function json(valor) {
  if (valor === null) return null;
  const contenido = typeof valor === 'object' && !Buffer.isBuffer(valor)
    ? structuredClone(valor)
    : JSON.parse(String(valor));
  return Object.freeze(contenido);
}

function copiarBuffer(valor) {
  return valor === null ? null : Buffer.from(valor);
}

function validarConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new TypeError('La operación DDNS exige una conexión prestada.');
  }
}
