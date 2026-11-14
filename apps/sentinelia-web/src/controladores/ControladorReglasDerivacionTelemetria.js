import { normalizarRetornoGestionAgente } from './normalizarRetornoGestionAgente.js';
import { presentarCondicionReglaTelemetria } from '../servicios/presentarCondicionReglaTelemetria.js';

export class ControladorReglasDerivacionTelemetria {
  constructor({ servicioAdministracionReglas, servicioMonitores = null }) {
    if (!servicioAdministracionReglas) {
      throw new Error('El servicio administrativo de reglas es obligatorio.');
    }
    this.servicioAdministracionReglas = servicioAdministracionReglas;
    this.servicioMonitores = servicioMonitores;
  }

  async mostrarListado(requisicion, respuesta, next) {
    try {
      const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
      const agenteIdConsulta = normalizarIdConsultaOpcional(
        requisicion.query.agente_id,
        'El agente indicado en el contexto no es válido.'
      );
      if (agenteIdConsulta !== null && agenteIdConsulta !== agenteId) {
        throw new Error('El agente indicado en el contexto no coincide con la ruta.');
      }
      const senalId = normalizarIdConsultaOpcional(
        requisicion.query.senal_id,
        'La señal indicada en el contexto no es válida.'
      );
      const [vista, catalogo] = await Promise.all([
        this.servicioAdministracionReglas.construirVistaOperativaReglasAgente(
          requisicion.contextoUsuarioActual,
          agenteId,
          { senalId }
        ),
        this.servicioAdministracionReglas.listarSenalesCatalogadas(
          requisicion.contextoUsuarioActual,
          agenteId
        )
      ]);
      const puedeVerMonitores = Boolean(
        requisicion.contextoUsuarioActual?.permisos?.verMonitores
      );
      const monitoresPorRegla = puedeVerMonitores && this.servicioMonitores
        ? await Promise.all(vista.reglas.map(async (regla) => ({
            reglaId: regla.id,
            total: await this.servicioMonitores.contarMonitoresVisiblesPorRegla(
              requisicion.contextoUsuarioActual,
              { agenteId, senalId: regla.senal.id, reglaId: regla.id }
            )
          })))
        : null;
      const retornoReglas = normalizarRetornoReglas(
        requisicion.query.return_to,
        agenteId
      );

      respuesta.render('portal/agente-reglas', {
        titulo: `Reglas de interpretación · ${vista.agente.nombre}`,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashReglasTelemetria: consumirFlash(requisicion),
        retornoGestionAgente: normalizarRetornoGestionAgente(
          requisicion.query.return_to,
          agenteId
        ),
        catalogoSenales: catalogo.senales,
        monitoresPorRegla,
        retornoReglas,
        retornoListadoReglas: construirRetornoListadoReglas(
          agenteId,
          senalId,
          retornoReglas
        ),
        ...vista,
        reglas: vista.reglas.map((regla) => ({
          ...regla,
          condicionLegible: presentarCondicionReglaTelemetria(
            regla.revisionVigente?.condicion
          )
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarDetalle(requisicion, respuesta, next) {
    try {
      const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
      const reglaId = normalizarId(requisicion.params.reglaId, 'La regla no es válida.');
      const vista = await this.servicioAdministracionReglas
        .construirDetalleOperativo(
          requisicion.contextoUsuarioActual,
          reglaId
      );
      asegurarAgenteDeRegla(vista.regla, agenteId);
      const puedeVerMonitores = Boolean(
        requisicion.contextoUsuarioActual?.permisos?.verMonitores
      );
      const totalMonitoresVisibles = puedeVerMonitores && this.servicioMonitores
        ? await this.servicioMonitores.contarMonitoresVisiblesPorRegla(
            requisicion.contextoUsuarioActual,
            {
              agenteId,
              senalId: vista.regla.senal.id,
              reglaId
            }
          )
        : 0;

      respuesta.render('portal/agente-regla-detalle', {
        titulo: `Regla de interpretación #${vista.regla.id} · ${vista.agente.nombre}`,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashReglasTelemetria: consumirFlash(requisicion),
        puedeVerMonitores,
        totalMonitoresVisibles,
        condicionLegible: presentarCondicionReglaTelemetria(
          vista.regla.revisionVigente?.condicion
        ),
        retornoListadoReglas: normalizarRetornoListadoReglas(
          requisicion.query?.return_to,
          agenteId
        ),
        ...vista,
        revisiones: vista.revisiones.map((revision) => ({
          ...revision,
          condicionLegible: presentarCondicionReglaTelemetria(revision.condicion)
        }))
      });
    } catch (error) {
      next(error);
    }
  }

  async previsualizarCondicion(requisicion, respuesta) {
    try {
      const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
      const resultado = await this.servicioAdministracionReglas
        .previsualizarCondicion(requisicion.contextoUsuarioActual, {
          agenteId,
          senalId: normalizarId(requisicion.body.senal_id, 'La señal no es válida.'),
          condicion: construirCondicion(requisicion.body),
          muestraTexto: construirMuestraTexto(requisicion.body)
        });

      respuesta.json({ ok: true, ...resultado });
    } catch (error) {
      respuesta.status(400).json({ ok: false, mensaje: error.message });
    }
  }

  async crearRegla(requisicion, respuesta) {
    const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
    try {
      const regla = await this.servicioAdministracionReglas.crearRegla(
        requisicion.contextoUsuarioActual,
        {
          agenteId,
          senalId: normalizarId(requisicion.body.senal_id, 'La señal no es válida.'),
          revision: construirRevision(requisicion.body)
        }
      );
      guardarFlash(
        requisicion,
        'exito',
        `Regla de interpretación #${regla.id} creada y activada.`
      );
      respuesta.redirect(`/agentes/${agenteId}/reglas/${regla.id}`);
    } catch (error) {
      guardarFlash(requisicion, 'error', error.message);
      respuesta.redirect(`/agentes/${agenteId}/reglas#crear-interpretacion`);
    }
  }

  async crearRevision(requisicion, respuesta) {
    const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
    const reglaId = normalizarId(requisicion.params.reglaId, 'La regla no es válida.');
    try {
      await this.servicioAdministracionReglas
        .asegurarReglaPerteneceAgenteParaModificar(
          requisicion.contextoUsuarioActual,
          reglaId,
          agenteId
        );
      const resultado = await this.servicioAdministracionReglas.crearNuevaRevision(
        requisicion.contextoUsuarioActual,
        { reglaId, revision: construirRevision(requisicion.body) }
      );
      guardarFlash(
        requisicion,
        'exito',
        `Versión ${resultado.revision.numero} guardada. Las evaluaciones anteriores no han cambiado.`
      );
    } catch (error) {
      guardarFlash(requisicion, 'error', error.message);
    }
    respuesta.redirect(`/agentes/${agenteId}/reglas/${reglaId}`);
  }

  async activarRegla(requisicion, respuesta) {
    await this.cambiarEstado(requisicion, respuesta, 'activarRegla', 'activada');
  }

  async desactivarRegla(requisicion, respuesta) {
    await this.cambiarEstado(
      requisicion,
      respuesta,
      'desactivarRegla',
      'desactivada'
    );
  }

  async cambiarEstado(requisicion, respuesta, metodo, participio) {
    const agenteId = normalizarId(requisicion.params.id, 'El agente no es válido.');
    const reglaId = normalizarId(requisicion.params.reglaId, 'La regla no es válida.');
    try {
      await this.servicioAdministracionReglas
        .asegurarReglaPerteneceAgenteParaModificar(
          requisicion.contextoUsuarioActual,
          reglaId,
          agenteId
        );
      await this.servicioAdministracionReglas[metodo](
        requisicion.contextoUsuarioActual,
        reglaId
      );
      guardarFlash(requisicion, 'exito', `Regla #${reglaId} ${participio}.`);
    } catch (error) {
      guardarFlash(requisicion, 'error', error.message);
    }
    respuesta.redirect(`/agentes/${agenteId}/reglas/${reglaId}`);
  }
}

function normalizarRetornoReglas(valor, agenteId) {
  const retornoGestion = normalizarRetornoGestionAgente(valor, agenteId);
  if (retornoGestion !== '/agentes' || typeof valor !== 'string') {
    return retornoGestion;
  }
  const retorno = valor.trim();
  if (!retorno.startsWith('/') || retorno.startsWith('//') || /[\\\r\n]/u.test(retorno)) {
    return '/agentes';
  }
  const url = new URL(retorno, 'http://sentinelia.local');
  return url.origin === 'http://sentinelia.local'
    && url.pathname === `/agentes/${encodeURIComponent(String(agenteId))}/telemetria`
    ? `${url.pathname}${url.search}${url.hash}`
    : '/agentes';
}

function construirRetornoListadoReglas(agenteId, senalId, retornoReglas) {
  const ruta = `/agentes/${agenteId}/reglas`;
  const parametros = new URLSearchParams();
  if (senalId !== null) parametros.set('senal_id', String(senalId));
  if (retornoReglas !== '/agentes') parametros.set('return_to', retornoReglas);
  return parametros.size ? `${ruta}?${parametros}` : ruta;
}

function normalizarRetornoListadoReglas(valor, agenteId) {
  const ruta = `/agentes/${agenteId}/reglas`;
  if (typeof valor !== 'string') return ruta;
  const retorno = valor.trim();
  if (!retorno.startsWith('/') || retorno.startsWith('//') || /[\\\r\n]/u.test(retorno)) {
    return ruta;
  }
  const url = new URL(retorno, 'http://sentinelia.local');
  if (url.origin !== 'http://sentinelia.local' || url.pathname !== ruta) return ruta;
  let senalId;
  try {
    senalId = normalizarIdConsultaOpcional(url.searchParams.get('senal_id'), '');
  } catch (_error) {
    return ruta;
  }
  const retornoReglas = normalizarRetornoReglas(
    url.searchParams.get('return_to'),
    agenteId
  );
  return construirRetornoListadoReglas(agenteId, senalId, retornoReglas);
}

function construirRevision(cuerpo = {}) {
  return {
    nombre: texto(cuerpo.nombre),
    descripcion: texto(cuerpo.descripcion) || null,
    severidadCalculada: texto(cuerpo.severidad_calculada),
    mensajeOperativo: texto(cuerpo.mensaje_operativo),
    metadatos: null,
    condicion: construirCondicion(cuerpo)
  };
}

function construirCondicion(cuerpo = {}) {
  const tipo = texto(cuerpo.condicion_tipo);
  const base = {
    tipo,
    version: 1,
    operador: texto(cuerpo.operador)
  };

  if (tipo === 'numero' || tipo === 'duracion') {
    const umbral = texto(cuerpo.umbral);
    if (umbral === '') {
      throw new Error(tipo === 'duracion'
        ? 'El umbral de duración en segundos es obligatorio.'
        : 'El umbral numérico es obligatorio.');
    }
    return { ...base, umbral: Number(umbral) };
  }
  if (tipo === 'momento_utc') {
    const umbralUtc = texto(cuerpo.umbral_utc);
    if (umbralUtc === '') {
      throw new Error('El momento límite UTC es obligatorio.');
    }
    return { ...base, umbralUtc };
  }
  if (tipo === 'momento_utc_relativo') {
    const forma = texto(cuerpo.relativo_forma) || 'limite_inferior';
    if (forma === 'fuera_intervalo') {
      return {
        tipo,
        version: 1,
        configuracion: {
          forma,
          limiteInferior: construirDesplazamientoRelativo(cuerpo, 'inferior'),
          limiteSuperior: construirDesplazamientoRelativo(cuerpo, 'superior'),
          histeresisInferiorSegundos: convertirDuracionRelativaASegundos(
            cuerpo.relativo_histeresis_inferior,
            cuerpo.relativo_histeresis_inferior_unidad,
            'La histéresis inferior'
          ),
          histeresisSuperiorSegundos: convertirDuracionRelativaASegundos(
            cuerpo.relativo_histeresis_superior,
            cuerpo.relativo_histeresis_superior_unidad,
            'La histéresis superior'
          )
        }
      };
    }
    if (!['limite_inferior', 'limite_superior'].includes(forma)) {
      throw new Error('La forma de comparación respecto a ahora no es válida.');
    }
    return {
      tipo,
      version: 1,
      configuracion: {
        forma,
        limite: construirDesplazamientoRelativo(cuerpo, 'limite'),
        histeresisSegundos: convertirDuracionRelativaASegundos(
          cuerpo.relativo_histeresis,
          cuerpo.relativo_histeresis_unidad,
          'La histéresis'
        )
      }
    };
  }
  if (tipo === 'texto_regex') {
    const opcionesCrudas = cuerpo.regex_opciones;
    const opciones = opcionesCrudas == null
      ? []
      : (Array.isArray(opcionesCrudas) ? opcionesCrudas : [opcionesCrudas])
        .map((opcion) => texto(opcion));
    const modo = texto(cuerpo.regex_modo) || 'existe';
    const condicion = {
      ...base,
      modo,
      patron: typeof cuerpo.regex_patron === 'string'
        ? cuerpo.regex_patron
        : '',
      opciones
    };
    if (modo === 'existe') {
      return { ...condicion, operador: null, umbral: null };
    }
    const umbral = texto(cuerpo.regex_umbral);
    if (umbral === '') {
      throw new Error('El umbral entero del conteo regex es obligatorio.');
    }
    return { ...condicion, umbral: Number(umbral) };
  }
  if (tipo === 'calidad') {
    return { ...base, calidadEsperada: texto(cuerpo.calidad_esperada) };
  }
  if (tipo === 'booleano') {
    const valor = texto(cuerpo.valor_esperado);
    if (!['true', 'false'].includes(valor)) {
      throw new Error('El valor booleano debe ser true o false.');
    }
    return { ...base, valorEsperado: valor === 'true' };
  }
  return { ...base, valorEsperado: texto(cuerpo.valor_esperado) };
}

function construirDesplazamientoRelativo(cuerpo, nombre) {
  const direccion = texto(cuerpo[`relativo_${nombre}_direccion`]);
  if (!['pasado', 'ahora', 'futuro'].includes(direccion)) {
    throw new Error('La dirección del límite respecto a ahora no es válida.');
  }
  const segundos = direccion === 'ahora'
    ? '0'
    : convertirDuracionRelativaASegundos(
      cuerpo[`relativo_${nombre}_magnitud`],
      cuerpo[`relativo_${nombre}_unidad`],
      'La magnitud del límite'
    );
  return { direccion, segundos };
}

function convertirDuracionRelativaASegundos(valor, unidad, nombre) {
  const magnitud = texto(valor);
  if (!/^(?:0|[1-9]\d*)$/u.test(magnitud)) {
    throw new Error(`${nombre} debe ser un entero no negativo.`);
  }
  const factores = {
    segundos: 1n,
    minutos: 60n,
    horas: 3600n,
    dias: 86400n,
    semanas: 604800n
  };
  const factor = factores[texto(unidad) || 'segundos'];
  if (!factor) throw new Error(`${nombre} utiliza una unidad no válida.`);
  const segundos = BigInt(magnitud) * factor;
  if (segundos > ((1n << 64n) - 1n)) {
    throw new Error(`${nombre} supera el máximo representable.`);
  }
  return segundos.toString();
}

function construirMuestraTexto(cuerpo = {}) {
  if (texto(cuerpo.condicion_tipo) !== 'texto_regex') return null;
  return typeof cuerpo.regex_muestra === 'string' ? cuerpo.regex_muestra : '';
}

function normalizarId(valor, mensaje) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(mensaje);
  }
  return id;
}

function normalizarIdConsultaOpcional(valor, mensaje) {
  if (valor == null || valor === '') {
    return null;
  }
  return normalizarId(valor, mensaje);
}

function asegurarAgenteDeRegla(regla, agenteId) {
  if (Number(regla.agenteId) !== Number(agenteId)) {
    throw new Error('La regla no pertenece al agente indicado.');
  }
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function guardarFlash(requisicion, tipo, mensaje) {
  requisicion.session.flashReglasTelemetria = { tipo, mensaje };
}

function consumirFlash(requisicion) {
  const flash = requisicion.session?.flashReglasTelemetria ?? null;
  if (requisicion.session?.flashReglasTelemetria) {
    delete requisicion.session.flashReglasTelemetria;
  }
  return flash;
}
