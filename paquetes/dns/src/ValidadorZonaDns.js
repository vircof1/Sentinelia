const TIPOS_ZONA_BASE = ['master'];
const CATEGORIAS_ZONA_BASE = ['normal', 'sistema', 'ddns', 'trigger'];

export class ValidadorZonaDns {
  validarDefinicionBase({
    nombreZona,
    tipoZona = 'master',
    tenantId = null,
    empresaId = null,
    sitioId = null
  }) {
    this.normalizarNombreZona(nombreZona);
    this.normalizarTipoZona(tipoZona);
    this.normalizarScopeZona({ tenantId, empresaId, sitioId });
  }

  normalizarDefinicionBase({
    tenantId = null,
    empresaId = null,
    sitioId = null,
    nombreZona,
    tipoZona = 'master',
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    descripcion = '',
    ttlDefectoSegundos = 3600,
    soaMname,
    soaRname,
    soaSerial = 1,
    soaRefreshSegundos = 3600,
    soaRetrySegundos = 600,
    soaExpireSegundos = 1209600,
    soaMinimumSegundos = 300,
    versionModelo = 1,
    estadoPublicacion = 'pendiente',
    activo = true
  }) {
    const scope = this.normalizarScopeZona({
      tenantId,
      empresaId,
      sitioId
    });

    return {
      tenantId: scope.tenantId,
      empresaId: scope.empresaId,
      sitioId: scope.sitioId,
      nombreZona: this.normalizarNombreZona(nombreZona),
      tipoZona: this.normalizarTipoZona(tipoZona),
      categoriaOrigen: this.normalizarCategoriaOrigen(categoriaOrigen),
      publicarEnBind: this.normalizarBooleano(publicarEnBind),
      descripcion: this.normalizarDescripcion(descripcion),
      ttlDefectoSegundos: this.normalizarEnteroEnRango(
        ttlDefectoSegundos,
        0,
        2147483647,
        'El TTL por defecto de la zona DNS debe estar entre 0 y 2147483647 segundos.',
        3600
      ),
      soaMname: this.normalizarNombreHostAbsoluto(
        soaMname,
        'El SOA mname de la zona DNS es obligatorio y debe ser un host DNS válido.'
      ),
      soaRname: this.normalizarSoaRname(soaRname),
      soaSerial: this.normalizarEnteroEnRango(
        soaSerial,
        1,
        4294967295,
        'El serial SOA de la zona DNS debe estar entre 1 y 4294967295.',
        1
      ),
      soaRefreshSegundos: this.normalizarEnteroEnRango(
        soaRefreshSegundos,
        0,
        2147483647,
        'El SOA refresh de la zona DNS debe estar entre 0 y 2147483647 segundos.',
        3600
      ),
      soaRetrySegundos: this.normalizarEnteroEnRango(
        soaRetrySegundos,
        0,
        2147483647,
        'El SOA retry de la zona DNS debe estar entre 0 y 2147483647 segundos.',
        600
      ),
      soaExpireSegundos: this.normalizarEnteroEnRango(
        soaExpireSegundos,
        0,
        2147483647,
        'El SOA expire de la zona DNS debe estar entre 0 y 2147483647 segundos.',
        1209600
      ),
      soaMinimumSegundos: this.normalizarEnteroEnRango(
        soaMinimumSegundos,
        0,
        2147483647,
        'El SOA minimum de la zona DNS debe estar entre 0 y 2147483647 segundos.',
        300
      ),
      versionModelo: this.normalizarEnteroEnRango(
        versionModelo,
        1,
        2147483647,
        'La versión de modelo de la zona DNS debe ser positiva.',
        1
      ),
      estadoPublicacion: this.normalizarEstadoPublicacion(estadoPublicacion),
      activo: this.normalizarBooleano(activo)
    };
  }

  normalizarScopeZona({ tenantId = null, empresaId = null, sitioId = null }) {
    const tenantNormalizado = this.normalizarIdOpcional(tenantId);
    const empresaNormalizada = this.normalizarIdOpcional(empresaId);
    const sitioNormalizado = this.normalizarIdOpcional(sitioId);
    const nivelPertenencia = this.resolverNivelScopeZona({
      tenantId: tenantNormalizado,
      empresaId: empresaNormalizada,
      sitioId: sitioNormalizado
    });

    if (nivelPertenencia === 'invalido') {
      throw new Error(
        'El scope de la zona DNS debe respetar la jerarquía portal -> tenant -> empresa -> sitio.'
      );
    }

    return {
      tenantId: tenantNormalizado,
      empresaId: empresaNormalizada,
      sitioId: sitioNormalizado,
      nivelPertenencia
    };
  }

  normalizarTipoZona(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();

    if (!TIPOS_ZONA_BASE.includes(normalizado)) {
      throw new Error(
        `El tipo de zona DNS debe ser uno de: ${TIPOS_ZONA_BASE.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarNombreZona(valor) {
    const normalizado = this.normalizarNombreDnsAbsoluto(
      valor,
      'El nombre de la zona DNS es obligatorio y debe ser un dominio válido.'
    );

    if (normalizado.length > 253) {
      throw new Error('El nombre de la zona DNS no puede superar 253 caracteres.');
    }

    return normalizado;
  }

  normalizarCategoriaOrigen(valor) {
    const normalizado = String(valor || 'normal').trim().toLowerCase();

    if (!CATEGORIAS_ZONA_BASE.includes(normalizado)) {
      throw new Error(
        `La categoría de la zona DNS debe ser una de: ${CATEGORIAS_ZONA_BASE.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarNombreHostAbsoluto(valor, mensaje) {
    return this.normalizarNombreDnsAbsoluto(valor, mensaje, {
      permitirWildcard: false,
      permitirAt: false,
      permitirUnderscore: false
    });
  }

  normalizarSoaRname(valor) {
    const normalizado = String(valor || '').trim().toLowerCase().replace(/\.+$/, '');
    const mensaje =
      'El SOA rname de la zona DNS debe representarse como nombre DNS válido. Si el buzón lleva puntos reales, escápalos como \\. Ejemplo: admin\\.dns.empresa.local.';

    if (!normalizado) {
      throw new Error(mensaje);
    }

    const etiquetas = this.separarEtiquetasDnsEscapadas(normalizado);

    if (etiquetas.length < 2 || etiquetas.some((etiqueta) => !etiqueta)) {
      throw new Error(mensaje);
    }

    this.validarEtiquetaSoaRnameLocal(etiquetas[0], mensaje);

    for (const etiqueta of etiquetas.slice(1)) {
      this.validarEtiquetaDns(etiqueta, {}, mensaje);
    }

    return normalizado;
  }

  normalizarDescripcion(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 255) {
      throw new Error('La descripción de la zona DNS no puede superar 255 caracteres.');
    }

    return normalizado || null;
  }

  normalizarEstadoPublicacion(valor) {
    const normalizado = String(valor || 'pendiente').trim().toLowerCase();
    const permitidos = ['pendiente', 'publicado', 'error', 'excluida'];

    if (!permitidos.includes(normalizado)) {
      throw new Error(
        `El estado de publicación DNS debe ser uno de: ${permitidos.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarNombreDnsAbsoluto(
    valor,
    mensaje,
    {
      permitirWildcard = false,
      permitirAt = false,
      permitirUnderscore = false
    } = {}
  ) {
    const normalizado = String(valor || '').trim().toLowerCase().replace(/\.+$/, '');

    if (!normalizado) {
      throw new Error(mensaje);
    }

    if (permitirAt && normalizado === '@') {
      return '@';
    }

    const etiquetas = normalizado.split('.');

    if (etiquetas.some((etiqueta) => !etiqueta)) {
      throw new Error(mensaje);
    }

    etiquetas.forEach((etiqueta, indice) => {
      this.validarEtiquetaDns(etiqueta, {
        permitirWildcard: permitirWildcard && indice === 0,
        permitirUnderscore
      }, mensaje);
    });

    return normalizado;
  }

  validarEtiquetaDns(
    etiqueta,
    { permitirWildcard = false, permitirUnderscore = false } = {},
    mensaje = 'La etiqueta DNS no es válida.'
  ) {
    if (permitirWildcard && etiqueta === '*') {
      return;
    }

    const patron = permitirUnderscore
      ? /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/
      : /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

    if (!patron.test(etiqueta)) {
      throw new Error(mensaje);
    }
  }

  separarEtiquetasDnsEscapadas(valor) {
    const etiquetas = [];
    let buffer = '';
    let escapando = false;

    for (const caracter of String(valor || '')) {
      if (escapando) {
        buffer += caracter;
        escapando = false;
        continue;
      }

      if (caracter === '\\') {
        escapando = true;
        buffer += caracter;
        continue;
      }

      if (caracter === '.') {
        etiquetas.push(buffer);
        buffer = '';
        continue;
      }

      buffer += caracter;
    }

    if (escapando) {
      buffer += '\\';
    }

    etiquetas.push(buffer);
    return etiquetas;
  }

  validarEtiquetaSoaRnameLocal(etiqueta, mensaje) {
    if (!etiqueta || etiqueta.length > 63) {
      throw new Error(mensaje);
    }

    let contenido = '';
    let escapando = false;

    for (const caracter of etiqueta) {
      if (escapando) {
        contenido += caracter;
        escapando = false;
        continue;
      }

      if (caracter === '\\') {
        escapando = true;
        continue;
      }

      contenido += caracter;
    }

    if (escapando || !contenido) {
      throw new Error(mensaje);
    }

    if (!/^[a-z0-9._-]+$/.test(contenido)) {
      throw new Error(mensaje);
    }
  }

  normalizarBooleano(valor) {
    if (typeof valor === 'boolean') {
      return valor;
    }

    return ['1', 'true', 'si', 'yes', 'on'].includes(
      String(valor || '').toLowerCase()
    );
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

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error('Debes indicar identificadores positivos en el scope de la zona DNS.');
    }

    return convertido;
  }

  resolverNivelScopeZona({ tenantId = null, empresaId = null, sitioId = null }) {
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
}
