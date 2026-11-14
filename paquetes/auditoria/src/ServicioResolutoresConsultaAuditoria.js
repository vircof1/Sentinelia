import { ACTORES_AUDITORIA, SUJETOS_AUDITORIA } from './CatalogoAuditoria.js';

const TIPOS_SUJETO_RESOLUBLES = Object.freeze({
  usuario: reglaPermiso('administrarUsuarios'),
  agente: reglaPermiso('verAgentes'),
  monitor: reglaPermiso('verMonitores'),
  alerta: reglaPermiso('verMonitores'),
  trigger: reglaPermiso('verTriggers'),
  zona_dns: reglaPermiso('verDns'),
  registro_dns: reglaPermiso('verDns'),
  concesion_ddns: reglaPermiso('verDns'),
  intencion_ddns: reglaPermiso('verDns'),
  tenant: reglaPermiso('administrarTenants', ['portal', 'tenant'], true),
  empresa: reglaPermiso('administrarEmpresas', ['portal', 'tenant', 'empresa'], true),
  sitio: reglaPermiso('administrarSitios', null, true)
});
const TIPOS_ACTOR_RESOLUBLES = Object.freeze({
  usuario: reglaPermiso('administrarUsuarios'),
  agente: reglaPermiso('verAgentes')
});
const ACTORES_TECNICOS = Object.freeze({
  runtime: Object.freeze({ id: 'sentinelia-runtime', etiqueta: 'Sentinelia Runtime' }),
  sistema: Object.freeze({ id: 'sentinelia-system', etiqueta: 'Sentinelia System' })
});
const SUJETOS_TECNICOS = Object.freeze({
  frontera_internet: Object.freeze({ id: 'portal', etiqueta: 'Frontera de Internet' })
});
const PARAMETROS_ADMITIDOS = new Set(['tipo', 'texto', 'pagina', 'limite', 'idExacto']);

export class ErrorResolutorConsultaAuditoria extends Error {
  constructor(mensaje, { codigo = 'RESOLUTOR_AUDITORIA_INVALIDO', campo = null, statusCode = 400 } = {}) {
    super(mensaje);
    this.name = 'ErrorResolutorConsultaAuditoria';
    this.codigo = codigo;
    this.campo = campo;
    this.statusCode = statusCode;
  }
}

export class ServicioResolutoresConsultaAuditoria {
  constructor({ repositorioResolutores } = {}) {
    if (!repositorioResolutores?.buscarOpciones || !repositorioResolutores?.admiteTipo) {
      throw new Error('ServicioResolutoresConsultaAuditoria requiere repositorio de resolutores.');
    }
    this.repositorioResolutores = repositorioResolutores;
  }

  resolverSujetos({ contextoUsuarioActual, consulta = {} } = {}) {
    return this.#resolver({
      contextoUsuarioActual,
      consulta,
      tipos: SUJETOS_AUDITORIA,
      resolubles: TIPOS_SUJETO_RESOLUBLES,
      identidadesTecnicas: SUJETOS_TECNICOS
    });
  }

  resolverActores({ contextoUsuarioActual, consulta = {} } = {}) {
    return this.#resolver({
      contextoUsuarioActual,
      consulta,
      tipos: ACTORES_AUDITORIA,
      resolubles: TIPOS_ACTOR_RESOLUBLES,
      identidadesTecnicas: ACTORES_TECNICOS
    });
  }

  async enriquecerEventos({ contextoUsuarioActual, eventos = [] } = {}) {
    exigirPermisoAuditoria(contextoUsuarioActual);
    const referencias = new Map();
    for (const evento of eventos) {
      for (const identidad of [evento?.actorReal, evento?.actorEfectivo, evento?.sujeto]) {
        if (!identidad?.tipo || identidad.id == null) continue;
        const tipo = String(identidad.tipo);
        const id = String(identidad.id);
        if (!referencias.has(tipo)) referencias.set(tipo, new Set());
        referencias.get(tipo).add(id);
      }
    }

    const nombres = new Map();
    await Promise.all([...referencias].map(async ([tipo, ids]) => {
      const identidadTecnica = ACTORES_TECNICOS[tipo] || SUJETOS_TECNICOS[tipo];
      if (identidadTecnica) {
        nombres.set(`${tipo}:${identidadTecnica.id}`, identidadTecnica.etiqueta);
        return;
      }
      const regla = TIPOS_SUJETO_RESOLUBLES[tipo];
      if (
        !regla ||
        !permisoFuncionalDisponible(contextoUsuarioActual, regla) ||
        !this.repositorioResolutores.admiteTipo(tipo) ||
        typeof this.repositorioResolutores.buscarOpcionesPorIds !== 'function'
      ) return;
      const opciones = await this.repositorioResolutores.buscarOpcionesPorIds({
        tipo,
        ids: [...ids],
        contextoUsuarioActual
      });
      for (const opcion of opciones) nombres.set(`${tipo}:${opcion.id}`, opcion.etiqueta);
    }));

    return eventos.map((evento) => Object.freeze({
      ...evento,
      actorReal: enriquecerIdentidad(evento.actorReal, nombres),
      actorEfectivo: enriquecerIdentidad(evento.actorEfectivo, nombres),
      sujeto: enriquecerIdentidad(evento.sujeto, nombres)
    }));
  }

  async #resolver({ contextoUsuarioActual, consulta, tipos, resolubles, identidadesTecnicas }) {
    exigirPermisoAuditoria(contextoUsuarioActual);
    const normalizada = normalizarConsulta(consulta, tipos);
    const identidadTecnica = identidadesTecnicas[normalizada.tipo];
    if (identidadTecnica) return respuestaTecnica(normalizada, identidadTecnica);
    if (normalizada.idExacto) return respuestaExacta(normalizada);
    const regla = resolubles[normalizada.tipo];
    if (!regla || !this.repositorioResolutores.admiteTipo(normalizada.tipo)) {
      return respuesta([], normalizada, false);
    }
    exigirPermisoFuncional(contextoUsuarioActual, regla);
    const resultado = await this.repositorioResolutores.buscarOpciones({
      tipo: normalizada.tipo,
      texto: normalizada.texto,
      pagina: normalizada.pagina,
      limite: normalizada.limite,
      contextoUsuarioActual
    });
    return respuesta(resultado.opciones, normalizada, resultado.hayMas);
  }
}

function normalizarConsulta(consulta, tipos) {
  if (!consulta || typeof consulta !== 'object' || Array.isArray(consulta)) {
    throw errorCampo('La consulta del resolutor debe ser un objeto plano.');
  }
  for (const campo of Object.keys(consulta)) {
    if (!PARAMETROS_ADMITIDOS.has(campo)) {
      throw errorCampo(`El parámetro ${campo} no está admitido por el resolutor.`, campo);
    }
  }
  const tipo = String(consulta.tipo ?? '');
  if (!tipos.includes(tipo)) throw errorCampo('El tipo del resolutor no es válido.', 'tipo');
  const texto = String(consulta.texto ?? '').trim();
  if (texto.length > 120) throw errorCampo('El texto del resolutor supera 120 caracteres.', 'texto');
  const idExacto = consulta.idExacto == null ? null : String(consulta.idExacto);
  if (idExacto !== null && (!/^[\x21-\x7e]+$/.test(idExacto) || idExacto.length > 191)) {
    throw errorCampo('El idExacto del resolutor no es válido.', 'idExacto');
  }
  if (idExacto && texto) {
    throw errorCampo('idExacto y texto no pueden combinarse.', 'idExacto');
  }
  return Object.freeze({
    tipo,
    texto,
    idExacto,
    pagina: enteroDecimal(consulta.pagina, 1, 10_000, 1, 'pagina'),
    limite: enteroDecimal(consulta.limite, 1, 50, 25, 'limite')
  });
}

function respuestaExacta(consulta) {
  const opciones = consulta.pagina === 1
    ? [Object.freeze({
      id: consulta.idExacto,
      etiqueta: consulta.idExacto,
      contexto: Object.freeze({ resolucion: 'id_exacto' })
    })]
    : [];
  return respuesta(opciones, consulta, false);
}

function respuestaTecnica(consulta, actor) {
  const coincideExacto = !consulta.idExacto || consulta.idExacto === actor.id;
  const coincideTexto = !consulta.texto || `${actor.id} ${actor.etiqueta}`
    .toLocaleLowerCase('es').includes(consulta.texto.toLocaleLowerCase('es'));
  const coincide = coincideExacto && coincideTexto;
  const opciones = coincide && consulta.pagina === 1
    ? [Object.freeze({ ...actor, contexto: Object.freeze({ resolucion: 'identidad_tecnica' }) })]
    : [];
  return respuesta(opciones, consulta, false);
}

function respuesta(opciones, consulta, hayMas) {
  return Object.freeze({
    opciones: Object.freeze(opciones.map((opcion) => Object.freeze({
      tipo: consulta.tipo,
      ...opcion
    }))),
    paginacion: Object.freeze({
      pagina: consulta.pagina,
      limite: consulta.limite,
      hayMas: Boolean(hayMas)
    })
  });
}

function exigirPermisoAuditoria(contexto) {
  if (!contexto?.permisos?.verAuditoria) {
    throw new ErrorResolutorConsultaAuditoria('Se requiere permiso verAuditoria.', {
      codigo: 'PERMISO_VER_AUDITORIA_REQUERIDO',
      statusCode: 403
    });
  }
}

function exigirPermisoFuncional(contexto, regla) {
  const permitido = permisoFuncionalDisponible(contexto, regla);
  if (!permitido) {
    throw new ErrorResolutorConsultaAuditoria('No se dispone del permiso funcional del resolutor.', {
      codigo: 'PERMISO_FUNCIONAL_RESOLUTOR_REQUERIDO',
      campo: 'tipo',
      statusCode: 403
    });
  }
}

function permisoFuncionalDisponible(contexto, regla) {
  return Boolean(
    contexto?.permisos?.[regla.permiso] ||
    (regla.admiteAdministrarOrganizacion && contexto?.permisos?.administrarOrganizacion)
  ) && (!regla.niveles || regla.niveles.includes(contexto?.nivelScope));
}

function enriquecerIdentidad(identidad, nombres) {
  if (!identidad?.tipo || identidad.id == null) return identidad;
  const nombreVisible = nombres.get(`${identidad.tipo}:${identidad.id}`);
  return nombreVisible ? Object.freeze({ ...identidad, nombreVisible }) : identidad;
}

function reglaPermiso(permiso, niveles = null, admiteAdministrarOrganizacion = false) {
  return Object.freeze({
    permiso,
    niveles: niveles ? Object.freeze(niveles) : null,
    admiteAdministrarOrganizacion
  });
}

function enteroDecimal(valor, minimo, maximo, defecto, campo) {
  if (valor == null) return defecto;
  if (typeof valor !== 'string' || !/^[1-9][0-9]*$/.test(valor)) {
    throw errorCampo(`El parámetro ${campo} no es un entero decimal válido.`, campo);
  }
  const numero = Number(valor);
  if (numero < minimo || numero > maximo) {
    throw errorCampo(`El parámetro ${campo} está fuera de rango.`, campo);
  }
  return numero;
}

function errorCampo(mensaje, campo = null) {
  return new ErrorResolutorConsultaAuditoria(mensaje, { campo });
}

export const __testablesServicioResolutoresConsultaAuditoria = Object.freeze({
  ACTORES_TECNICOS,
  SUJETOS_TECNICOS,
  TIPOS_ACTOR_RESOLUBLES,
  TIPOS_SUJETO_RESOLUBLES
});
