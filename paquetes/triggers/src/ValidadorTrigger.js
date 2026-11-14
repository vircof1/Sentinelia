import { ConfiguracionTriggerApi } from './ConfiguracionTriggerApi.js';
import { ConfiguracionTriggerDns } from './ConfiguracionTriggerDns.js';
import {
  ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
  ConfiguracionTriggerCorreo,
  TOKENS_ASUNTO_TRIGGER_CORREO,
  VERSION_CONFIGURACION_TRIGGER_CORREO
} from './ConfiguracionTriggerCorreo.js';
import {
  admiteConfiguracionOverrideTrigger,
  normalizarTipoTrigger,
  TIPOS_TRIGGER
} from './CatalogoTiposTrigger.js';
import { normalizarEventosDisparoTrigger } from './eventosDisparoTrigger.js';

const OPERACIONES_DNS_TRIGGER = [
  'editar_valor',
  'activar',
  'desactivar',
  'seguir_estado_monitor'
];
const CONFIGURACION_POR_TIPO = {
  api: {
    metodo: 'POST',
    timeoutMs: 5000,
    reintentos: 0,
    permiteTlsInseguro: false,
    cabeceras: {},
    plantillaCuerpo: null,
    parametroOpcional: null
  },
  dns: {
    operacion: 'editar_valor'
  },
  correo: {
    version: VERSION_CONFIGURACION_TRIGGER_CORREO,
    asuntoPlantilla: ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
    textoIntroduccion: null,
    textoCierre: null
  }
};

export class ValidadorTrigger {
  validarDefinicionBase({ nombre, tipo }) {
    this.normalizarNombre(nombre);
    this.normalizarTipo(tipo);
  }

  validarAsignacionMonitorTrigger({ monitorId, triggerId, eventosDisparo }) {
    this.normalizarId(monitorId, 'El monitor asociado al trigger es obligatorio.');
    this.normalizarId(triggerId, 'El trigger asociado al monitor es obligatorio.');
    this.normalizarEventosDisparo(eventosDisparo);
  }

  normalizarDefinicionBase({
    nombre,
    tipo,
    descripcion = '',
    activo = true,
    tenantId = null,
    empresaId = null,
    sitioId = null,
    configuracion = null,
    url = null,
    metodo = null,
    timeoutMs = null,
    reintentos = null,
    permiteTlsInseguro = null,
    cabeceras = null,
    plantillaCuerpo = null,
    parametroOpcional = null,
    zonaId = null,
    registroId = null,
    operacion = null,
    valorPrincipal = null,
    rolGobernanza = null,
    versionCorreo = null,
    asuntoPlantilla = null,
    textoIntroduccion = null,
    textoCierre = null
  }) {
    const tipoNormalizado = this.normalizarTipo(tipo);
    const configuracionBase = this.normalizarConfiguracionBase(configuracion);
    if (tipoNormalizado === 'correo') {
      this.exigirFormaConfiguracionCorreo(configuracionBase);
    }
    const scope = this.normalizarScopeTrigger({
      tenantId,
      empresaId,
      sitioId
    });

    return {
      tenantId: scope.tenantId,
      empresaId: scope.empresaId,
      sitioId: scope.sitioId,
      nombre: this.normalizarNombre(nombre),
      tipo: tipoNormalizado,
      descripcion: this.normalizarDescripcion(descripcion),
      activo: this.normalizarBooleano(activo),
      configuracion: this.normalizarConfiguracionTecnica(tipoNormalizado, {
        ...configuracionBase,
        url,
        metodo,
        timeoutMs,
        reintentos,
        permiteTlsInseguro,
        cabeceras,
        plantillaCuerpo,
        parametroOpcional,
        zonaId,
        registroId,
        operacion,
        valorPrincipal,
        rolGobernanza,
        version: versionCorreo ?? configuracionBase.version,
        asuntoPlantilla: asuntoPlantilla ?? configuracionBase.asuntoPlantilla,
        textoIntroduccion: textoIntroduccion ?? configuracionBase.textoIntroduccion,
        textoCierre: textoCierre ?? configuracionBase.textoCierre
      })
    };
  }

  normalizarScopeTrigger({ tenantId, empresaId, sitioId }) {
    const tenantNormalizado = this.normalizarIdOpcional(tenantId);
    const empresaNormalizada = this.normalizarIdOpcional(empresaId);
    const sitioNormalizado = this.normalizarIdOpcional(sitioId);
    const nivelPertenencia = this.resolverNivelScopeTrigger({
      tenantId: tenantNormalizado,
      empresaId: empresaNormalizada,
      sitioId: sitioNormalizado
    });

    if (nivelPertenencia === 'invalido') {
      throw new Error(
        'El scope del trigger debe respetar la jerarquía portal -> tenant -> empresa -> sitio.'
      );
    }

    return {
      tenantId: tenantNormalizado,
      empresaId: empresaNormalizada,
      sitioId: sitioNormalizado,
      nivelPertenencia
    };
  }

  normalizarAsignacionMonitorTrigger({
    monitorId,
    triggerId,
    activo = true,
    ordenEjecucion = 100,
    eventosDisparo = ['apertura_alerta'],
    configuracionOverride = null
  }) {
    return {
      monitorId: this.normalizarId(
        monitorId,
        'El monitor asociado al trigger es obligatorio.'
      ),
      triggerId: this.normalizarId(
        triggerId,
        'El trigger asociado al monitor es obligatorio.'
      ),
      activo: this.normalizarBooleano(activo),
      ordenEjecucion: this.normalizarEnteroEnRango(
        ordenEjecucion,
        0,
        65535,
        'El orden de ejecución del binding monitor-trigger debe estar entre 0 y 65535.',
        100
      ),
      eventosDisparo: this.normalizarEventosDisparo(eventosDisparo),
      configuracionOverride: this.normalizarConfiguracionOverride(
        configuracionOverride
      )
    };
  }

  normalizarTipo(valor) {
    return normalizarTipoTrigger(valor);
  }

  normalizarNombre(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length < 3 || normalizado.length > 160) {
      throw new Error('El nombre del trigger debe tener entre 3 y 160 caracteres.');
    }

    return normalizado;
  }

  normalizarDescripcion(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 255) {
      throw new Error('La descripción del trigger no puede superar 255 caracteres.');
    }

    return normalizado || null;
  }

  normalizarConfiguracionBase(valor) {
    if (valor == null || valor === '') {
      return {};
    }

    if (typeof valor === 'object') {
      return valor;
    }

    try {
      return JSON.parse(String(valor));
    } catch (_error) {
      throw new Error('La configuración base del trigger debe ser JSON válido.');
    }
  }

  normalizarConfiguracionTecnica(tipo, datos) {
    if (tipo === 'api') {
      const cabeceras = this.normalizarCabeceras(datos.cabeceras);

      return new ConfiguracionTriggerApi({
        url: this.normalizarUrl(
          datos.url,
          'La URL del trigger API es obligatoria.'
        ),
        metodo: this.normalizarMetodo(
          datos.metodo,
          CONFIGURACION_POR_TIPO.api.metodo
        ),
        timeoutMs: this.normalizarEnteroEnRango(
          datos.timeoutMs,
          250,
          120000,
          'El timeout del trigger API debe estar entre 250 y 120000 ms.',
          CONFIGURACION_POR_TIPO.api.timeoutMs
        ),
        reintentos: this.normalizarEnteroEnRango(
          datos.reintentos,
          0,
          10,
          'Los reintentos del trigger API deben estar entre 0 y 10.',
          CONFIGURACION_POR_TIPO.api.reintentos
        ),
        permiteTlsInseguro: this.normalizarBooleanoEstricto(
          datos.permiteTlsInseguro,
          CONFIGURACION_POR_TIPO.api.permiteTlsInseguro,
          'El flag TLS del trigger API no es válido.'
        ),
        cabeceras,
        plantillaCuerpo: this.normalizarPlantillaCuerpo(datos.plantillaCuerpo),
        parametroOpcional: this.normalizarParametroOpcional(
          datos.parametroOpcional
        )
      }).serializar();
    }

    if (tipo === 'dns') {
      const operacion = this.normalizarOperacionDns(
        datos.operacion,
        CONFIGURACION_POR_TIPO.dns.operacion
      );

      return new ConfiguracionTriggerDns({
        zonaId: this.normalizarId(
          datos.zonaId,
          'La zona DNS objetivo del trigger es obligatoria.'
        ),
        registroId: this.normalizarId(
          datos.registroId,
          'El registro DNS objetivo del trigger es obligatorio.'
        ),
        operacion,
        valorPrincipal: operacion === 'editar_valor'
          ? this.normalizarValorPrincipalDns(datos.valorPrincipal)
          : null,
        rolGobernanza: this.normalizarRolGobernanzaDns(datos.rolGobernanza)
      }).serializar();
    }

    if (tipo === 'correo') {
      return new ConfiguracionTriggerCorreo({
        version: this.normalizarVersionConfiguracionCorreo(datos.version),
        asuntoPlantilla: this.normalizarAsuntoPlantillaCorreo(
          datos.asuntoPlantilla
        ),
        textoIntroduccion: this.normalizarTextoCorreoOpcional(
          datos.textoIntroduccion,
          'La introducción del correo no puede superar 2000 caracteres.'
        ),
        textoCierre: this.normalizarTextoCorreoOpcional(
          datos.textoCierre,
          'El cierre del correo no puede superar 2000 caracteres.'
        )
      }).serializar();
    }

    throw new Error(
      `El tipo de trigger debe ser uno de: ${TIPOS_TRIGGER.join(', ')}.`
    );
  }

  normalizarOperacionDns(valor, porDefecto = 'editar_valor') {
    const normalizado = String(valor || porDefecto).trim().toLowerCase();

    if (!OPERACIONES_DNS_TRIGGER.includes(normalizado)) {
      throw new Error(
        `La operación DNS del trigger debe ser una de: ${OPERACIONES_DNS_TRIGGER.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarRolGobernanzaDns(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const normalizado = String(valor).trim();

    if (normalizado.length > 120) {
      throw new Error(
        'El rol de gobernanza DNS del trigger no puede superar 120 caracteres.'
      );
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(normalizado)) {
      throw new Error(
        'El rol de gobernanza DNS del trigger solo puede usar letras, números, punto, guion, guion bajo y dos puntos.'
      );
    }

    return normalizado;
  }

  normalizarValorPrincipalDns(valor) {
    const normalizado = String(valor ?? '').trim();

    if (!normalizado) {
      throw new Error(
        'El nuevo valor principal del registro DNS es obligatorio para editar valor.'
      );
    }

    if (normalizado.length > 1024) {
      throw new Error(
        'El nuevo valor principal del registro DNS no puede superar 1024 caracteres.'
      );
    }

    return normalizado;
  }

  construirConfiguracionEfectiva({
    tipo,
    configuracionBase = null,
    configuracionOverride = null
  }) {
    const tipoNormalizado = this.normalizarTipo(tipo);
    const baseNormalizada = this.normalizarConfiguracionBase(configuracionBase);
    const overrideNormalizado =
      this.normalizarConfiguracionOverride(configuracionOverride) || {};

    if (!admiteConfiguracionOverrideTrigger(tipoNormalizado) &&
        Object.keys(overrideNormalizado).length > 0) {
      throw new Error(
        `Los triggers ${tipoNormalizado} no admiten configuración override en el binding monitor-trigger.`
      );
    }

    return this.normalizarConfiguracionTecnica(
      tipoNormalizado,
      this.fusionarObjetos(baseNormalizada, overrideNormalizado)
    );
  }

  normalizarUrl(valor, mensaje) {
    const normalizado = String(valor || '').trim();

    if (!normalizado) {
      throw new Error(mensaje);
    }

    try {
      const url = new URL(normalizado);

      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('invalid_protocol');
      }

      return url.toString();
    } catch (_error) {
      throw new Error('La URL del trigger API debe ser HTTP o HTTPS válida.');
    }
  }

  normalizarMetodo(valor, porDefecto) {
    const normalizado = String(valor || porDefecto).trim().toUpperCase();
    const permitidos = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    if (!permitidos.includes(normalizado)) {
      throw new Error(
        `El método HTTP del trigger API debe ser uno de: ${permitidos.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarCabeceras(valor) {
    if (valor == null || valor === '') {
      return {};
    }

    let cabeceras = valor;

    if (typeof valor === 'string') {
      try {
        cabeceras = JSON.parse(valor);
      } catch (_error) {
        throw new Error('Las cabeceras del trigger API deben ser JSON válido.');
      }
    }

    if (!cabeceras || typeof cabeceras !== 'object' || Array.isArray(cabeceras)) {
      throw new Error('Las cabeceras del trigger API deben ser un objeto clave-valor.');
    }

    const normalizadas = {};

    for (const [clave, valorCabecera] of Object.entries(cabeceras)) {
      const claveNormalizada = String(clave || '').trim();

      if (!claveNormalizada) {
        throw new Error('No se permiten cabeceras vacías en el trigger API.');
      }

      normalizadas[claveNormalizada] = String(valorCabecera ?? '').trim();
    }

    return normalizadas;
  }

  normalizarEventosDisparo(valor) {
    return normalizarEventosDisparoTrigger(valor, {
      porDefecto: ['apertura_alerta']
    });
  }

  normalizarConfiguracionOverride(valor) {
    if (valor == null || valor === '') {
      return null;
    }

    if (typeof valor === 'string') {
      try {
        valor = JSON.parse(valor);
      } catch (_error) {
        throw new Error(
          'La configuración override del binding monitor-trigger debe ser JSON válido.'
        );
      }
    }

    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
      throw new Error(
        'La configuración override del binding monitor-trigger debe ser un objeto JSON.'
      );
    }

    return JSON.parse(JSON.stringify(valor));
  }

  normalizarPlantillaCuerpo(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const normalizado = String(valor);

    if (normalizado.length > 20000) {
      throw new Error('La plantilla de cuerpo del trigger API no puede superar 20000 caracteres.');
    }

    return normalizado;
  }

  exigirFormaConfiguracionCorreo(configuracion) {
    const permitidas = [
      'version',
      'asuntoPlantilla',
      'textoIntroduccion',
      'textoCierre'
    ];
    const recibidas = Object.keys(configuracion).sort();
    if (recibidas.some((clave) => !permitidas.includes(clave))) {
      throw new Error('La configuración del trigger correo contiene propiedades desconocidas.');
    }
  }

  normalizarVersionConfiguracionCorreo(valor) {
    const version = valor == null || String(valor).trim() === ''
      ? VERSION_CONFIGURACION_TRIGGER_CORREO
      : Number(valor);
    if (version !== VERSION_CONFIGURACION_TRIGGER_CORREO) {
      throw new Error('La versión de configuración del trigger correo debe ser 1.');
    }
    return version;
  }

  normalizarAsuntoPlantillaCorreo(valor) {
    const asunto = valor == null || String(valor) === ''
      ? ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO
      : String(valor);
    if (!asunto.trim() || Array.from(asunto).length > 255 || /[\p{Cc}\p{Cf}]/u.test(asunto)) {
      throw new Error('El asunto del trigger correo debe contener texto visible y hasta 255 caracteres.');
    }
    const resto = asunto.replace(/\{\{([^{}]+)\}\}/gu, (tokenCompleto, token) => {
      if (!TOKENS_ASUNTO_TRIGGER_CORREO.includes(token)) {
        throw new Error(`El token ${tokenCompleto} no está permitido en el asunto del correo.`);
      }
      return '';
    });
    if (resto.includes('{{') || resto.includes('}}')) {
      throw new Error('El asunto del trigger correo contiene una expresión de plantilla inválida.');
    }
    return asunto;
  }

  normalizarTextoCorreoOpcional(valor, mensajeLongitud) {
    if (valor == null || String(valor).trim() === '') return null;
    const texto = String(valor);
    if (Array.from(texto).length > 2000) throw new Error(mensajeLongitud);
    if (/\r|\0|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Cf}/u.test(texto)) {
      throw new Error('El texto del trigger correo contiene controles invisibles no permitidos.');
    }
    return texto;
  }

  normalizarParametroOpcional(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const normalizado = String(valor).trim();

    if (normalizado.length > 255) {
      throw new Error(
        'El parámetro opcional del trigger API no puede superar 255 caracteres.'
      );
    }

    return normalizado;
  }

  normalizarBooleano(valor) {
    if (typeof valor === 'boolean') {
      return valor;
    }

    return ['1', 'true', 'si', 'yes', 'on'].includes(
      String(valor || '').toLowerCase()
    );
  }

  normalizarBooleanoEstricto(valor, porDefecto, mensaje) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return porDefecto;
    }

    if (typeof valor === 'boolean') {
      return valor;
    }

    const normalizado = String(valor).trim().toLowerCase();

    if (['1', 'true', 'si', 'yes', 'on'].includes(normalizado)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalizado)) {
      return false;
    }

    throw new Error(mensaje);
  }

  normalizarEnteroEnRango(valor, minimo, maximo, mensaje, porDefecto) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return porDefecto;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido < minimo || convertido > maximo) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  normalizarId(valor, mensaje) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error('Debes indicar identificadores positivos en el scope del trigger.');
    }

    return convertido;
  }

  resolverNivelScopeTrigger({ tenantId = null, empresaId = null, sitioId = null }) {
    if (tenantId == null && empresaId == null && sitioId == null) {
      return 'portal';
    }

    if (tenantId != null && empresaId == null && sitioId == null) {
      return 'tenant';
    }

    if (tenantId != null && empresaId != null && sitioId == null) {
      return 'empresa';
    }

    if (tenantId != null && empresaId != null && sitioId != null) {
      return 'sitio';
    }

    return 'invalido';
  }

  fusionarObjetos(base, override) {
    const origenBase =
      base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    const origenOverride =
      override && typeof override === 'object' && !Array.isArray(override)
        ? override
        : {};
    const resultado = { ...origenBase };

    for (const [clave, valor] of Object.entries(origenOverride)) {
      if (
        valor &&
        typeof valor === 'object' &&
        !Array.isArray(valor) &&
        origenBase[clave] &&
        typeof origenBase[clave] === 'object' &&
        !Array.isArray(origenBase[clave])
      ) {
        resultado[clave] = this.fusionarObjetos(origenBase[clave], valor);
        continue;
      }

      resultado[clave] = valor;
    }

    return resultado;
  }
}
