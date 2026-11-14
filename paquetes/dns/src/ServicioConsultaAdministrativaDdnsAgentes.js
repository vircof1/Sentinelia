import { bytesAUuidV7Auditoria, uuidV7AuditoriaABytes }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { ResolutorScopeUsuario } from '../../contexto-usuario/src/ResolutorScopeUsuario.js';
import { RepositorioUsuarios } from '../../usuarios/src/RepositorioUsuarios.js';
import { evaluarElegibilidadConcesionDdnsAgentes }
  from './PoliticaElegibilidadDdnsAgentes.js';

const PRESUPUESTO_PUBLICACION = 3;

export class ServicioConsultaAdministrativaDdnsAgentes {
  constructor({
    clienteSql,
    repositorioUsuarios = new RepositorioUsuarios(clienteSql),
    resolutorScopeUsuario = new ResolutorScopeUsuario()
  } = {}) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new TypeError('La consulta administrativa DDNS requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.repositorioUsuarios = repositorioUsuarios;
    this.resolutorScopeUsuario = resolutorScopeUsuario;
  }

  obtenerDesdeAgente({ contextoUsuarioActual, concesionId, agenteId } = {}) {
    return this.#obtener({
      contextoUsuarioActual,
      concesionId,
      extremo: 'agente',
      extremoId: idPositivo(agenteId, 'agenteId')
    });
  }

  obtenerDesdeRegistro({ contextoUsuarioActual, concesionId, registroDnsId } = {}) {
    return this.#obtener({
      contextoUsuarioActual,
      concesionId,
      extremo: 'registro',
      extremoId: idPositivo(registroDnsId, 'registroDnsId')
    });
  }

  async listarPorAgente({ contextoUsuarioActual, agenteId } = {}) {
    const id = idPositivo(agenteId, 'agenteId');
    const [agente] = await this.clienteSql.consultar(
      `SELECT id,tenant_id AS agente_tenant_id,
              empresa_id AS agente_empresa_id,sitio_id AS agente_sitio_id
         FROM agentes_sentinelia WHERE id=? LIMIT 1`,
      [id]
    );
    if (!agente || !autorizaAgente(contextoUsuarioActual, agente)) {
      fallarAutoridad();
    }
    const filas = await this.clienteSql.consultar(
      consultaColeccion('c.agente_id'),
      [id]
    );
    return Object.freeze(filas.map((fila) => proyectarDetalle(fila, {
      agenteVisible: true,
      registroVisible: autorizaRegistro(contextoUsuarioActual, fila)
    })));
  }

  async listarPorRegistro({ contextoUsuarioActual, registroDnsId } = {}) {
    const id = idPositivo(registroDnsId, 'registroDnsId');
    const [registro] = await this.clienteSql.consultar(
      `SELECT id,tenant_id AS registro_tenant_id,
              empresa_id AS registro_empresa_id,sitio_id AS registro_sitio_id
         FROM registros_dns WHERE id=? LIMIT 1`,
      [id]
    );
    if (!registro || !autorizaRegistro(contextoUsuarioActual, registro)) {
      fallarAutoridad();
    }
    const filas = await this.clienteSql.consultar(
      consultaColeccion('c.registro_dns_id'),
      [id]
    );
    return Object.freeze(filas.map((fila) => proyectarDetalle(fila, {
      agenteVisible: autorizaAgente(contextoUsuarioActual, fila),
      registroVisible: true
    })));
  }

  async listarCandidatosParaAgente({ contextoUsuarioActual, agenteId } = {}) {
    if (typeof this.clienteSql?.obtenerConexion !== 'function' ||
        typeof this.repositorioUsuarios?.buscarPorIdEnTransaccion !== 'function') {
      throw new TypeError('El selector DDNS requiere una frontera SQL completa.');
    }
    const agenteObjetivoId = idPositivo(agenteId, 'agenteId');
    const actorRealId = idPositivo(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuarioReal'
    );
    const actorEfectivoId = idPositivo(
      contextoUsuarioActual?.idUsuario,
      'contextoUsuarioActual.idUsuario'
    );
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const autoridades = [];
      for (const id of [...new Set([actorRealId, actorEfectivoId])].sort(compararIds)) {
        const usuario = await this.repositorioUsuarios.buscarPorIdEnTransaccion(
          id,
          { conexion, forUpdate: false }
        );
        autoridades.push(contextoDurable(usuario, this.resolutorScopeUsuario));
      }
      const [[agente]] = await conexion.execute(
        `SELECT id,tenant_id,empresa_id,sitio_id
           FROM agentes_sentinelia WHERE id=? LIMIT 1`,
        [agenteObjetivoId]
      );
      if (!agente || !autoridades.every((autoridad) =>
        autorizaCrearConcesion(autoridad, {
          tenantId: agente.tenant_id,
          empresaId: agente.empresa_id,
          sitioId: agente.sitio_id
        }))) fallarAutoridad();
      const [filas] = await conexion.execute(consultaCandidatos());
      const candidatos = filas.filter((fila) => {
        if (!autoridades.every((autoridad) => alcanza(autoridad, {
          tenantId: fila.tenant_id,
          empresaId: fila.empresa_id,
          sitioId: fila.sitio_id
        }))) return false;
        return evaluarElegibilidadConcesionDdnsAgentes({
          registro: fila,
          zona: {
            tipo_zona: fila.zona_tipo,
            publicar_en_bind: fila.zona_publicar,
            activo: fila.zona_activa
          },
          existeConcesionVigente: fila.concesion_vigente !== null
        }).elegible;
      }).map(proyectarCandidato);
      await conexion.commit();
      return Object.freeze(candidatos);
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async #obtener({ contextoUsuarioActual, concesionId, extremo, extremoId }) {
    const [fila] = await this.clienteSql.consultar(consultaDetalle(), [
      uuidV7AuditoriaABytes(concesionId, 'concesionId')
    ]);
    if (!fila || !autorizaExtremo(contextoUsuarioActual, fila, extremo, extremoId)) {
      return null;
    }
    const agenteVisible = autorizaAgente(contextoUsuarioActual, fila);
    const registroVisible = autorizaRegistro(contextoUsuarioActual, fila);
    return proyectarDetalle(fila, { agenteVisible, registroVisible });
  }
}

function consultaDetalle() {
  return `${consultaBase()} WHERE c.concesion_id=? LIMIT 1`;
}

function consultaColeccion(columna) {
  return `${consultaBase()} WHERE ${columna}=? ORDER BY c.creada_en_utc,c.id`;
}

function consultaBase() {
  return `SELECT c.concesion_id,c.estado,c.causa_cierre,
          CAST(c.version_ddns AS CHAR) AS version_ddns,c.decision,c.modo,
          c.condicion_operativa,c.contenido_deseado_canonico,
          c.contenido_publicado_canonico,c.creada_en_utc,c.cerrada_en_utc,
          c.agente_id,c.registro_dns_id,c.registro_dns_id_fotografia,
          c.registro_scope_tenant_id,c.registro_scope_empresa_id,c.registro_scope_sitio_id,
          a.nombre AS agente_nombre,a.estado_administrativo,
          a.tenant_id AS agente_tenant_id,a.empresa_id AS agente_empresa_id,
          a.sitio_id AS agente_sitio_id,
          r.host_relativo,r.tipo_registro,r.activo AS registro_activo,
          r.publicar_en_bind,r.categoria_origen,
          r.tenant_id AS registro_tenant_id,r.empresa_id AS registro_empresa_id,
          r.sitio_id AS registro_sitio_id,z.nombre_zona,
          i.intencion_id,i.hito,i.terminal,i.aceptada_en_utc,
          i.persistida_en_utc,i.publicada_en_utc,
          i.terminada_en_utc AS intencion_terminada_en_utc,
          p.numero_intento,p.estado AS intento_estado,p.atribucion,
          p.codigo_diagnostico,p.mensaje_diagnostico,p.generacion_dns,
          p.actualizada_en_utc AS intento_actualizado_en_utc,
          (SELECT COUNT(*) FROM intentos_publicacion_ddns pc
            WHERE pc.intencion_interna_id=c.intencion_gobernante_id
              AND pc.estado='rechazo_atribuible') AS intentos_consumidos
     FROM concesiones_ddns_agentes c
     LEFT JOIN agentes_sentinelia a ON a.id=c.agente_id
     LEFT JOIN registros_dns r ON r.id=c.registro_dns_id
     LEFT JOIN zonas_dns z ON z.id=r.zona_id
     LEFT JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
     LEFT JOIN intentos_publicacion_ddns p ON p.id=(
       SELECT pi.id FROM intentos_publicacion_ddns pi
        WHERE pi.intencion_interna_id=c.intencion_gobernante_id
        ORDER BY pi.numero_intento DESC,pi.id DESC LIMIT 1
     )
    `;
}

function autorizaExtremo(contexto, fila, extremo, extremoId) {
  if (extremo === 'agente') {
    return String(fila.agente_id ?? '') === extremoId && autorizaAgente(contexto, fila);
  }
  return String(fila.registro_dns_id ?? '') === extremoId && autorizaRegistro(contexto, fila);
}

function autorizaAgente(contexto, fila) {
  return Boolean(contexto?.permisos?.verAgentes) && alcanza(contexto, {
    tenantId: fila.agente_tenant_id,
    empresaId: fila.agente_empresa_id,
    sitioId: fila.agente_sitio_id
  });
}

function autorizaRegistro(contexto, fila) {
  const historico = fila.registro_dns_id == null && fila.registro_dns_id_fotografia != null;
  return Boolean(contexto?.permisos?.verDns) && alcanza(contexto, {
    tenantId: historico ? fila.registro_scope_tenant_id : fila.registro_tenant_id,
    empresaId: historico ? fila.registro_scope_empresa_id : fila.registro_empresa_id,
    sitioId: historico ? fila.registro_scope_sitio_id : fila.registro_sitio_id
  });
}

function alcanza(contexto, scope) {
  if (contexto?.nivelScope === 'portal') return true;
  if (scope.tenantId == null || String(scope.tenantId) !== String(contexto?.tenantId)) {
    return false;
  }
  if (contexto?.nivelScope === 'tenant') return true;
  if (scope.empresaId == null || String(scope.empresaId) !== String(contexto?.empresaId)) {
    return false;
  }
  if (contexto?.nivelScope === 'empresa') return true;
  return contexto?.nivelScope === 'sitio' && scope.sitioId != null &&
    String(scope.sitioId) === String(contexto?.sitioId);
}

function proyectarDetalle(fila, visibilidad = {}) {
  const agenteVisible = visibilidad.agenteVisible === true;
  const registroVisible = visibilidad.registroVisible === true;
  return Object.freeze({
    concesionId: bytesAUuidV7Auditoria(fila.concesion_id, 'concesionId'),
    estado: fila.estado,
    causaCierre: fila.causa_cierre,
    version: String(fila.version_ddns),
    decision: fila.decision,
    modo: fila.modo,
    condicion: fila.condicion_operativa,
    agente: agenteVisible ? proyectarAgente(fila) : restringido('agente'),
    registro: registroVisible ? proyectarRegistro(fila) : restringido('registro_dns'),
    operacion: registroVisible ? proyectarOperacion(fila) : restringido('registro_dns'),
    timestamps: Object.freeze({
      creadaEnUtc: fechaIso(fila.creada_en_utc),
      cerradaEnUtc: fechaIso(fila.cerrada_en_utc),
      intencionAceptadaEnUtc: fechaIso(fila.aceptada_en_utc),
      contenidoPersistidoEnUtc: fechaIso(fila.persistida_en_utc),
      contenidoPublicadoEnUtc: fechaIso(fila.publicada_en_utc),
      terminadaEnUtc: fechaIso(fila.intencion_terminada_en_utc)
    })
  });
}

function consultaCandidatos() {
  return `SELECT r.id,r.zona_id,r.tenant_id,r.empresa_id,r.sitio_id,
          r.host_relativo,r.tipo_registro,r.valor_principal,r.prioridad,
          r.activo,r.publicar_en_bind,r.categoria_origen,r.datos_auxiliares,
          z.nombre_zona,z.tipo_zona AS zona_tipo,
          z.activo AS zona_activa,z.publicar_en_bind AS zona_publicar,
          c.id AS concesion_vigente
     FROM registros_dns r
     INNER JOIN zonas_dns z ON z.id=r.zona_id
     LEFT JOIN concesiones_ddns_agentes c
       ON c.registro_dns_id=r.id AND c.estado='vigente'
    WHERE r.categoria_origen='ddns'
      AND r.tipo_registro IN ('A','AAAA','CNAME','MX')
    ORDER BY z.nombre_zona,r.host_relativo,r.tipo_registro,r.id`;
}

function proyectarCandidato(fila) {
  const nombre = fila.host_relativo === '@'
    ? fila.nombre_zona
    : `${fila.host_relativo}.${fila.nombre_zona}`;
  const activo = Boolean(fila.activo);
  return Object.freeze({
    registroDnsId: String(fila.id),
    zonaDnsId: String(fila.zona_id),
    nombre,
    tipoRegistro: fila.tipo_registro,
    valorPrincipal: fila.valor_principal,
    prioridad: fila.prioridad === null ? null : Number(fila.prioridad),
    activo,
    operable: activo,
    scope: Object.freeze({
      tenantId: fila.tenant_id === null ? null : String(fila.tenant_id),
      empresaId: fila.empresa_id === null ? null : String(fila.empresa_id),
      sitioId: fila.sitio_id === null ? null : String(fila.sitio_id)
    })
  });
}

function contextoDurable(usuario, resolutorScopeUsuario) {
  if (!usuario?.activo) fallarAutoridad();
  const nivelScope = resolutorScopeUsuario.resolverNivelScope(usuario);
  if (!['portal', 'tenant', 'empresa', 'sitio'].includes(nivelScope)) {
    fallarAutoridad();
  }
  return Object.freeze({
    idUsuario: String(usuario.id),
    nivelScope,
    esOperadorSistema: nivelScope === 'portal',
    tenantId: usuario.tenantId,
    empresaId: usuario.empresaId,
    sitioId: usuario.sitioId,
    permisos: usuario.permisos
  });
}

function autorizaCrearConcesion(contexto, scopeAgente) {
  return Boolean(
    contexto?.permisos?.modificarAgentes &&
    contexto?.permisos?.administrarDnsAvanzado &&
    alcanza(contexto, scopeAgente)
  );
}

function fallarAutoridad() {
  throw Object.assign(
    new Error('La autoridad actual no permite consultar esta superficie DDNS.'),
    { codigo: 'autoridad_insuficiente', statusCode: 403 }
  );
}

function compararIds(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a.localeCompare(b);
}

function proyectarAgente(fila) {
  return Object.freeze({
    restringido: false,
    id: String(fila.agente_id),
    nombre: String(fila.agente_nombre),
    activo: fila.estado_administrativo === 'activo'
  });
}

function proyectarRegistro(fila) {
  const eliminado = fila.registro_dns_id == null;
  const nombre = eliminado ? 'Registro eliminado' : fila.host_relativo === '@'
    ? fila.nombre_zona
    : `${fila.host_relativo}.${fila.nombre_zona}`;
  return Object.freeze({
    restringido: false,
    eliminado,
    id: String(fila.registro_dns_id ?? fila.registro_dns_id_fotografia),
    nombre,
    tipo: fila.tipo_registro,
    activo: Boolean(fila.registro_activo),
    publicarEnBind: Boolean(fila.publicar_en_bind),
    categoriaOrigen: fila.categoria_origen,
    estadoDeseado: json(fila.contenido_deseado_canonico),
    estadoPublicado: json(fila.contenido_publicado_canonico)
  });
}

function proyectarOperacion(fila) {
  return Object.freeze({
    restringido: false,
    intencionId: fila.intencion_id
      ? bytesAUuidV7Auditoria(fila.intencion_id, 'intencionId')
      : null,
    hito: fila.hito,
    terminal: fila.terminal,
    intentos: Object.freeze({
      consumidos: Math.min(PRESUPUESTO_PUBLICACION, Number(fila.intentos_consumidos || 0)),
      restantes: Math.max(
        0,
        PRESUPUESTO_PUBLICACION - Number(fila.intentos_consumidos || 0)
      )
    }),
    ultimoIntento: fila.numero_intento == null ? null : Object.freeze({
      numero: Number(fila.numero_intento),
      estado: fila.intento_estado,
      atribucion: fila.atribucion,
      generacionDns: fila.generacion_dns == null ? null : String(fila.generacion_dns),
      codigoDiagnostico: fila.codigo_diagnostico,
      mensajeDiagnostico: fila.mensaje_diagnostico,
      actualizadoEnUtc: fechaIso(fila.intento_actualizado_en_utc)
    })
  });
}

function restringido(tipo) {
  return Object.freeze({ restringido: true, tipo });
}

function json(valor) {
  if (valor === null) return null;
  if (typeof valor === 'string') return Object.freeze(JSON.parse(valor));
  if (Buffer.isBuffer(valor)) return Object.freeze(JSON.parse(valor.toString('utf8')));
  return Object.freeze(valor);
}

function fechaIso(valor) {
  if (!valor) return null;
  const fecha = valor instanceof Date ? valor : new Date(String(valor).replace(' ', 'T') + 'Z');
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function idPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${nombre} no es válido.`);
  return texto;
}
