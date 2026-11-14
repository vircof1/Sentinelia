import { RegistroDns } from './RegistroDns.js';
import { ValidadorRegistroDns } from './ValidadorRegistroDns.js';
import { ValidadorZonaDns } from './ValidadorZonaDns.js';
import { ZonaDns } from './ZonaDns.js';

export class ValidadorCoherenciaBindDns {
  constructor({
    validadorZonaDns = new ValidadorZonaDns(),
    validadorRegistroDns = new ValidadorRegistroDns()
  } = {}) {
    this.validadorZonaDns = validadorZonaDns;
    this.validadorRegistroDns = validadorRegistroDns;
  }

  validarCoherenciaZona({ zona, registros = [] }) {
    const zonaNormalizada = this.normalizarZona(zona);
    const registrosPreparados = this.prepararRegistrosPublicables({
      zona: zonaNormalizada,
      registros
    });

    return {
      zona: zonaNormalizada,
      registrosPublicables: registrosPreparados,
      totalPublicables: registrosPreparados.length
    };
  }

  prepararRegistrosPublicables({ zona, registros = [] }) {
    const zonaNormalizada = this.normalizarZona(zona);
    const registrosNormalizados = (Array.isArray(registros) ? registros : [])
      .map((registro) => this.normalizarRegistro(registro))
      .filter((registro) => registro.estaActivoPublicableEnBind())
      .map((registro) => this.prepararRegistroPublicable(zonaNormalizada, registro));

    this.validarCoherenciaOwners(registrosNormalizados);

    return registrosNormalizados.sort((a, b) => (
      a.ownerBind.localeCompare(b.ownerBind) ||
      a.tipoRegistro.localeCompare(b.tipoRegistro) ||
      a.id - b.id
    ));
  }

  normalizarZona(zona) {
    const zonaInstancia = zona instanceof ZonaDns ? zona : new ZonaDns(zona || {});
    const definicion = this.validadorZonaDns.normalizarDefinicionBase(
      zonaInstancia.serializarPersistencia()
    );

    return new ZonaDns({
      ...zonaInstancia.serializarResumen(),
      id: zonaInstancia.id,
      tenant_id: definicion.tenantId,
      empresa_id: definicion.empresaId,
      sitio_id: definicion.sitioId,
      nombre_zona: definicion.nombreZona,
      tipo_zona: definicion.tipoZona,
      categoria_origen: definicion.categoriaOrigen,
      publicar_en_bind: definicion.publicarEnBind,
      descripcion: definicion.descripcion,
      ttl_defecto_segundos: definicion.ttlDefectoSegundos,
      soa_mname: definicion.soaMname,
      soa_rname: definicion.soaRname,
      soa_serial: definicion.soaSerial,
      soa_refresh_segundos: definicion.soaRefreshSegundos,
      soa_retry_segundos: definicion.soaRetrySegundos,
      soa_expire_segundos: definicion.soaExpireSegundos,
      soa_minimum_segundos: definicion.soaMinimumSegundos,
      version_modelo: definicion.versionModelo,
      estado_publicacion: definicion.estadoPublicacion,
      activo: definicion.activo
    });
  }

  normalizarRegistro(registro) {
    const registroInstancia = registro instanceof RegistroDns
      ? registro
      : new RegistroDns(registro || {});
    const definicion = this.validadorRegistroDns.normalizarDefinicionBase(
      registroInstancia.serializarPersistencia()
    );

    return new RegistroDns({
      ...registroInstancia.serializarResumen(),
      id: registroInstancia.id,
      zona_id: definicion.zonaId,
      tenant_id: registroInstancia.tenantId,
      empresa_id: registroInstancia.empresaId,
      sitio_id: registroInstancia.sitioId,
      nombre_zona: registroInstancia.nombreZona,
      host_relativo: definicion.hostRelativo,
      tipo_registro: definicion.tipoRegistro,
      valor_principal: definicion.valorPrincipal,
      ttl_segundos: definicion.ttlSegundos,
      prioridad: definicion.prioridad,
      peso: definicion.peso,
      puerto: definicion.puerto,
      flags: definicion.flags,
      tag: definicion.tag,
      categoria_origen: definicion.categoriaOrigen,
      publicar_en_bind: definicion.publicarEnBind,
      datos_auxiliares: definicion.datosAuxiliares,
      descripcion: definicion.descripcion,
      activo: definicion.activo
    });
  }

  prepararRegistroPublicable(zona, registro) {
    const ttlEfectivoSegundos = registro.resolverTtlEfectivo(
      zona.ttlDefectoSegundos
    );

    if (!Number.isInteger(ttlEfectivoSegundos) || ttlEfectivoSegundos < 0) {
      throw new Error(
        `El registro DNS ${registro.construirOwnerBind()} no dispone de un TTL efectivo válido.`
      );
    }

    return {
      ...registro.serializarResumen(),
      ownerBind: registro.construirOwnerBind(),
      ttlEfectivoSegundos
    };
  }

  validarCoherenciaOwners(registrosPreparados) {
    const grupos = this.agruparPorOwner(registrosPreparados);

    for (const [ownerBind, registrosOwner] of grupos.entries()) {
      this.validarCoherenciaOwner(ownerBind, registrosOwner);
    }
  }

  validarCoherenciaOwner(ownerBind, registrosOwner) {
    const cnames = registrosOwner.filter(
      (registro) => registro.tipoRegistro === 'CNAME'
    );

    if (cnames.length > 1) {
      throw new Error(
        `El owner ${ownerBind} no puede tener más de un registro CNAME publicable.`
      );
    }

    if (cnames.length === 1 && registrosOwner.length > 1) {
      const tiposCoexistentes = registrosOwner
        .map((registro) => registro.tipoRegistro)
        .filter((tipo) => tipo !== 'CNAME');

      throw new Error(
        `El owner ${ownerBind} no puede mezclar CNAME con otros tipos (${tiposCoexistentes.join(', ')}).`
      );
    }

    for (const registro of registrosOwner) {
      if (registro.tipoRegistro === 'MX' && registro.prioridad == null) {
        throw new Error(
          `El registro MX ${ownerBind} debe indicar prioridad antes de publicarse en BIND.`
        );
      }

      if (
        registro.tipoRegistro === 'SRV' &&
        (
          registro.prioridad == null ||
          registro.peso == null ||
          registro.puerto == null
        )
      ) {
        throw new Error(
          `El registro SRV ${ownerBind} debe indicar prioridad, peso y puerto antes de publicarse en BIND.`
        );
      }
    }
  }

  agruparPorOwner(registrosPreparados) {
    const grupos = new Map();

    for (const registro of registrosPreparados) {
      const clave = String(registro.ownerBind || '').toLowerCase();
      const existentes = grupos.get(clave) || [];
      existentes.push(registro);
      grupos.set(clave, existentes);
    }

    return grupos;
  }
}
