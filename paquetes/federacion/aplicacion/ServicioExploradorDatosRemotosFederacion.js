import {
  listarContratosFamiliasFederacion,
  obtenerContratoFamiliaFederacion
} from '../src/ContratosFamiliasFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

const ETIQUETAS_FAMILIAS = Object.freeze({
  estructuraOrganizativa: 'Estructura organizativa',
  contextoOperativoAgentesSesiones: 'Contexto operativo de agentes',
  telemetria: 'Telemetría',
  monitores: 'Monitores',
  triggersInformativos: 'Triggers informativos',
  auditoria: 'Auditoría remota',
  avisosFederados: 'Avisos federados'
});

const AUTORIZADORES_FAMILIA = Object.freeze({
  estructuraOrganizativa: 'puedeVer',
  contextoOperativoAgentesSesiones: 'puedeVerAgentes',
  telemetria: 'puedeVerAgentes',
  monitores: 'puedeVerMonitores',
  triggersInformativos: 'puedeVerTriggers',
  auditoria: 'puedeVerAuditoria',
  avisosFederados: 'puedeVerDiagnosticoFederacion'
});

export class ServicioExploradorDatosRemotosFederacion {
  constructor({ repositorio, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listar !== 'function') {
      throw new Error('El explorador remoto requiere un repositorio de lectura.');
    }
    if (typeof servicioAutorizacion?.puedeExplorarDatosRemotosFederacion !== 'function') {
      throw new Error('El explorador remoto requiere autorización por familia.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, filtros = {}) {
    if (!this.autorizacion.puedeExplorarDatosRemotosFederacion(contextoUsuarioActual)) {
      throw prohibido('datos_remotos_no_autorizados', 'No hay datos remotos visibles para el usuario actual.');
    }
    const familias = familiasAutorizadas(this.autorizacion, contextoUsuarioActual);
    const familia = textoOpcional(filtros.familia, 64, 'familia');
    if (familia && !familias.includes(familia)) {
      throw prohibido('familia_remota_no_autorizada', 'La familia remota solicitada no es visible.');
    }
    const installationOrigenTexto = textoOpcional(
      filtros.installationOrigenId,
      64,
      'installationOrigenId'
    );
    const installationOrigenId = validarInstallationId(installationOrigenTexto);
    const proyeccionId = validarProyeccionId(textoOpcional(
      filtros.proyeccionId,
      64,
      'proyeccionId'
    ));
    const resultado = await this.repositorio.listar({
      scope: scopeEfectivo(contextoUsuarioActual),
      familias,
      familia,
      installationOrigenId,
      proyeccionId,
      pagina: enteroFiltro(filtros.pagina, 1),
      limite: enteroFiltro(filtros.limite, 25)
    });
    return Object.freeze({
      familias: Object.freeze(familias.map((nombre) => Object.freeze({
        nombre,
        etiqueta: ETIQUETAS_FAMILIAS[nombre],
        versionContrato: obtenerContratoFamiliaFederacion(nombre).versionFamilia
      }))),
      filtros: Object.freeze({ familia, installationOrigenId, proyeccionId }),
      paginacion: resultado.paginacion,
      elementos: Object.freeze(resultado.elementos.map(presentarElemento))
    });
  }
}

function familiasAutorizadas(autorizacion, contexto) {
  return listarContratosFamiliasFederacion()
    .map((contrato) => contrato.familia)
    .filter((familia) => autorizacion[AUTORIZADORES_FAMILIA[familia]](contexto));
}

function presentarElemento(elemento) {
  const contrato = obtenerContratoFamiliaFederacion(elemento.familia);
  return Object.freeze({
    ...elemento,
    familiaEtiqueta: ETIQUETAS_FAMILIAS[elemento.familia],
    versionContrato: contrato.versionFamilia,
    visibilidadUsuario: Object.freeze({
      estado: contrato.selector.camposSensibles.length > 0
        ? 'vistaSaneada'
        : 'contenidoBaseVisible',
      contenidoNoVisible: contrato.selector.camposSensibles.length > 0,
      motivo: contrato.selector.camposSensibles.length > 0
        ? 'Los complementos sensibles no forman parte de este explorador.'
        : null
    })
  });
}

function scopeEfectivo(contexto) {
  return Object.freeze({
    nivel: contexto?.nivelScope,
    tenantId: contexto?.tenantId ?? null,
    empresaId: contexto?.empresaId ?? null,
    sitioId: contexto?.sitioId ?? null
  });
}

function textoOpcional(valor, maximo, campo) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (Buffer.byteLength(texto, 'utf8') > maximo) {
    const error = new Error(`El filtro ${campo} supera el límite permitido.`);
    error.statusCode = 400;
    throw error;
  }
  return texto;
}

function enteroFiltro(valor, porDefecto) {
  const texto = String(valor ?? '').trim();
  if (!texto) return porDefecto;
  if (!/^[0-9]+$/u.test(texto)) {
    const error = new Error('La paginación solicitada no es válida.');
    error.statusCode = 400;
    throw error;
  }
  return Number(texto);
}

function validarInstallationId(valor) {
  if (valor === null) return null;
  try {
    return String(crearIdentidadFederada({
      valor,
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }));
  } catch {
    const error = new Error('La identidad de instalación filtrada no es válida.');
    error.statusCode = 400;
    throw error;
  }
}

function validarProyeccionId(valor) {
  if (valor === null) return null;
  try {
    return String(crearIdentidadFederada({
      valor,
      tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION
    }));
  } catch {
    const error = new Error('La identidad de proyección filtrada no es válida.');
    error.statusCode = 400;
    throw error;
  }
}

function prohibido(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  error.statusCode = 403;
  return error;
}
