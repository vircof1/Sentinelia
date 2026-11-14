import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const TIPOS = Object.freeze({
  tenant: Object.freeze({ sujeto: 'tenant', creado: 'organizacion.tenant_creado', actualizado: 'organizacion.tenant_actualizado' }),
  empresa: Object.freeze({ sujeto: 'empresa', creado: 'organizacion.empresa_creada', actualizado: 'organizacion.empresa_actualizada' }),
  sitio: Object.freeze({ sujeto: 'sitio', creado: 'organizacion.sitio_creado', actualizado: 'organizacion.sitio_actualizado' })
});

const CAMPOS_ENTRADA = Object.freeze({
  tenant: Object.freeze({
    crear: Object.freeze(['nombre', 'alias', 'descripcion', 'estado']),
    actualizar: Object.freeze(['nombre', 'alias', 'descripcion', 'estado'])
  }),
  empresa: Object.freeze({
    crear: Object.freeze(['tenantId', 'nombre', 'alias', 'cif', 'descripcion', 'estado']),
    actualizar: Object.freeze(['nombre', 'alias', 'cif', 'descripcion', 'estado'])
  }),
  sitio: Object.freeze({
    crear: Object.freeze([
      'tenantId', 'empresaId', 'nombre', 'alias', 'timezone', 'descripcion', 'estado'
    ]),
    actualizar: Object.freeze(['nombre', 'alias', 'timezone', 'descripcion', 'estado'])
  })
});

export class ServicioCrudOrganizacionAuditable {
  constructor({
    fronteraTransaccional,
    repositorioCrud,
    servicioAuditoria,
    servicioAutoridadMutacionesEstructurales = null,
    capturadorFederacion = null,
    ahora = () => new Date()
  } = {}) {
    if (!fronteraTransaccional?.ejecutar ||
        !repositorioCrud?.crearEnTransaccion ||
        !repositorioCrud?.actualizarEnTransaccion ||
        !repositorioCrud?.buscarBloqueadoEnTransaccion ||
        !servicioAuditoria?.registrarEnTransaccion || typeof ahora !== 'function') {
      throw new Error('El CRUD organizativo auditable requiere todos sus puertos transaccionales.');
    }
    validarCapturador(capturadorFederacion);
    Object.assign(this, {
      fronteraTransaccional, repositorioCrud, servicioAuditoria,
      servicioAutoridadMutacionesEstructurales, capturadorFederacion, ahora
    });
  }

  async crear({ entidad, datos, contextoUsuarioActual } = {}) {
    exigirEntidad(entidad);
    exigirPerfilEntrada(entidad, 'crear', datos);
    if (entidad !== 'tenant' &&
        typeof this.servicioAutoridadMutacionesEstructurales
          ?.serializarAltaEnTransaccion !== 'function') {
      throw new Error('El alta organizativa exige autoridad jerárquica.');
    }
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const scopePadre = scopePadreAlta(entidad, datos);
      if (scopePadre) {
        await this.servicioAutoridadMutacionesEstructurales
          .serializarAltaEnTransaccion({ scopePadre }, { conexion });
      }
      const identidadOperacion = crearIdentidadOperacion();
      const creada = await this.repositorioCrud.crearEnTransaccion(
        entidad, datos, { conexion }
      );
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: this.#crearIntencion({
          entidad,
          recurso: creada,
          contextoUsuarioActual,
          tipo: TIPOS[entidad].creado,
          identidadOperacion,
          payload: { resultado: 'creado', antes: null, despues: fotografiar(entidad, creada) }
        })
      }, { conexion });
      await this.#capturar(entidad, creada.id, conexion);
      return creada;
    });
  }

  async actualizar({
    entidad,
    id,
    datos,
    contextoUsuarioActual,
    autorizar = () => true
  } = {}) {
    exigirEntidad(entidad);
    exigirPerfilEntrada(entidad, 'actualizar', datos);
    if (typeof autorizar !== 'function') throw new Error('La reautorización organizativa no es invocable.');
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const actual = await this.repositorioCrud.buscarBloqueadoEnTransaccion(
        entidad, id, { conexion }
      );
      if (!actual) throw new Error(`El ${entidad} ya no existe.`);
      if (await autorizar(actual) !== true) {
        throw new Error(`El scope actual ya no autoriza modificar ${entidad}.`);
      }
      const antesCompleto = fotografiar(entidad, actual);
      const despuesCompleto = fotografiar(entidad, combinar(entidad, actual, datos));
      const camposCambiados = Object.keys(antesCompleto)
        .filter((campo) => antesCompleto[campo] !== despuesCompleto[campo])
        .sort(compararUtf8);
      if (camposCambiados.length === 0) return actual;
      const identidadOperacion = crearIdentidadOperacion();
      const actualizado = await this.repositorioCrud.actualizarEnTransaccion(
        entidad, id, datos, { conexion }
      );
      const antes = seleccionar(antesCompleto, camposCambiados);
      const despues = seleccionar(fotografiar(entidad, actualizado), camposCambiados);
      await this.servicioAuditoria.registrarEnTransaccion({
        cambioEfectivo: true,
        intencion: this.#crearIntencion({
          entidad,
          recurso: actualizado,
          contextoUsuarioActual,
          tipo: TIPOS[entidad].actualizado,
          identidadOperacion,
          payload: { resultado: 'actualizado', camposCambiados, antes, despues }
        })
      }, { conexion });
      await this.#capturar(entidad, actualizado.id, conexion);
      return actualizado;
    });
  }

  #capturar(entidad, id, conexion) {
    if (!this.capturadorFederacion) return null;
    return this.capturadorFederacion.capturarEnTransaccion({
      familia: 'estructuraOrganizativa',
      prepararCapturas: ({ interfazCaptura }) =>
        interfazCaptura.prepararCapturaEnTransaccion({ entidad, id }, { conexion })
    }, { conexion });
  }

  #crearIntencion({
    entidad,
    recurso,
    contextoUsuarioActual,
    tipo,
    identidadOperacion,
    payload
  }) {
    const actorRealId = idDecimal(contextoUsuarioActual?.idUsuarioReal, 'actor real');
    const efectivoId = idDecimal(contextoUsuarioActual?.idUsuario, 'actor efectivo');
    const impersonado = actorRealId !== efectivoId;
    const scope = scopeDe(entidad, recurso);
    const fecha = normalizarFecha(this.ahora());
    return {
      eventoId: identidadOperacion.eventoId,
      tipo,
      versionContrato: 1,
      flujo: 'organizacion',
      claveCadena: `organizacion:tenant:${scope.tenantId}`,
      actorReal: { tipo: 'usuario', id: actorRealId },
      actorEfectivo: impersonado ? { tipo: 'usuario', id: efectivoId } : null,
      modoActuacion: impersonado ? 'impersonado' : 'directo',
      sujeto: { tipo: TIPOS[entidad].sujeto, id: idDecimal(recurso.id, 'sujeto') },
      origen: 'web',
      scope,
      correlacionId: identidadOperacion.correlacionId,
      causalidad: null,
      productor: 'portal_web',
      claveOperacion: identidadOperacion.claveOperacion,
      rolEvento: 'principal',
      efectivoEnUtc: fecha,
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
      payload
    };
  }
}

function scopePadreAlta(entidad, datos) {
  if (entidad === 'empresa') {
    return { tenantId: datos.tenantId, empresaId: null, sitioId: null };
  }
  if (entidad === 'sitio') {
    return {
      tenantId: datos.tenantId,
      empresaId: datos.empresaId,
      sitioId: null
    };
  }
  return null;
}

function validarCapturador(capturador) {
  if (capturador !== null && typeof capturador?.capturarEnTransaccion !== 'function') {
    throw new Error('El capturador federado organizativo no es transaccional.');
  }
}

function crearIdentidadOperacion() {
  return Object.freeze({
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria(),
    claveOperacion: generarUuidV7Auditoria()
  });
}

function fotografiar(entidad, recurso) {
  const base = {
    nombre: recurso.nombre,
    alias: recurso.alias,
    descripcion: recurso.descripcion ?? null,
    activo: recurso.estado === 'activo'
  };
  if (entidad === 'empresa') return {
    tenantId: String(recurso.tenantId), ...base, cif: recurso.cif ?? null
  };
  if (entidad === 'sitio') return {
    tenantId: String(recurso.tenantId),
    empresaId: String(recurso.empresaId),
    ...base,
    timezone: recurso.timezone
  };
  return base;
}

function combinar(entidad, actual, datos) {
  const comun = { ...actual, ...datos };
  if (entidad === 'empresa') comun.tenantId = actual.tenantId;
  if (entidad === 'sitio') {
    comun.tenantId = actual.tenantId;
    comun.empresaId = actual.empresaId;
  }
  return comun;
}

function scopeDe(entidad, recurso) {
  const tenantId = entidad === 'tenant' ? recurso.id : recurso.tenantId;
  return {
    tenantId: idDecimal(tenantId, 'tenantId'),
    empresaId: entidad === 'empresa' ? idDecimal(recurso.id, 'empresaId')
      : entidad === 'sitio' ? idDecimal(recurso.empresaId, 'empresaId') : null,
    sitioId: entidad === 'sitio' ? idDecimal(recurso.id, 'sitioId') : null
  };
}

function seleccionar(origen, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, origen[campo]]));
}

function exigirEntidad(entidad) {
  if (!Object.hasOwn(TIPOS, entidad)) throw new Error('Entidad organizativa no auditable.');
}

function exigirPerfilEntrada(entidad, operacion, datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos) ||
      Object.getPrototypeOf(datos) !== Object.prototype) {
    throw new Error('Los datos organizativos deben ser un objeto plano.');
  }
  const esperados = CAMPOS_ENTRADA[entidad][operacion];
  const recibidos = Object.keys(datos).sort(compararUtf8);
  const normalizados = [...esperados].sort(compararUtf8);
  if (recibidos.length !== normalizados.length ||
      recibidos.some((campo, indice) => campo !== normalizados[indice])) {
    throw new Error(
      `Perfil ${operacion} de ${entidad} inválido; solo admite ${esperados.join(', ')}.`
    );
  }
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser un id decimal positivo.`);
  return texto;
}

function normalizarFecha(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new Error('El reloj efectivo no produjo una fecha válida.');
  return fecha.toISOString();
}

function compararUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
