import net from 'node:net';

const TIPOS_REGISTRO_BASE = ['A', 'AAAA', 'CNAME', 'NS', 'TXT', 'MX', 'SRV', 'CAA', 'PTR'];
const CATEGORIAS_REGISTRO_BASE = ['normal', 'sistema', 'ddns', 'trigger'];
const GOBERNANZAS_AUTOMATICAS = ['trigger', 'ddns'];
const MODOS_CONTROL_GOBERNANZA = ['valor_y_activo'];
const CRITERIOS_ACTUALIZACION_DDNS = ['direccion_agente', 'valor_declarado'];
const POLITICAS_SOBRESCRITURA_DDNS = ['solo_si_cambia', 'siempre'];
const VALIDACIONES_ORIGEN_DDNS = ['agente_autenticado', 'agente_autenticado_y_scope'];

export class ValidadorRegistroDns {
  validarDefinicionBase({
    zonaId,
    hostRelativo,
    tipoRegistro
  }) {
    this.normalizarId(zonaId, 'La zona DNS del registro es obligatoria.');
    this.normalizarHostRelativo(hostRelativo);
    this.normalizarTipoRegistro(tipoRegistro);
  }

  normalizarDefinicionBase({
    zonaId,
    hostRelativo,
    tipoRegistro,
    valorPrincipal = null,
    ttlSegundos = null,
    prioridad = null,
    peso = null,
    puerto = null,
    flags = null,
    tag = null,
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    datosAuxiliares = null,
    descripcion = null,
    activo = true
  }) {
    const tipoNormalizado = this.normalizarTipoRegistro(tipoRegistro);
    const prioridadNormalizada = this.normalizarPrioridadPorTipo(
      tipoNormalizado,
      prioridad
    );
    const categoriaOrigenNormalizada =
      this.normalizarCategoriaOrigen(categoriaOrigen);
    const datosAuxiliaresNormalizados =
      this.normalizarDatosAuxiliares(
        datosAuxiliares,
        categoriaOrigenNormalizada
      );

    return {
      zonaId: this.normalizarId(
        zonaId,
        'La zona DNS del registro es obligatoria.'
      ),
      hostRelativo: this.normalizarHostRelativo(hostRelativo),
      tipoRegistro: tipoNormalizado,
      valorPrincipal: this.normalizarValorPrincipalConPrioridad(
        tipoNormalizado, valorPrincipal, prioridadNormalizada
      ),
      ttlSegundos: this.normalizarTtlOpcional(ttlSegundos),
      prioridad: prioridadNormalizada,
      peso: this.normalizarPesoPorTipo(tipoNormalizado, peso),
      puerto: this.normalizarPuertoPorTipo(tipoNormalizado, puerto),
      flags: this.normalizarFlagsPorTipo(tipoNormalizado, flags),
      tag: this.normalizarTagPorTipo(tipoNormalizado, tag),
      categoriaOrigen: categoriaOrigenNormalizada,
      publicarEnBind: this.normalizarBooleano(publicarEnBind),
      datosAuxiliares: datosAuxiliaresNormalizados,
      descripcion: this.normalizarDescripcion(descripcion),
      activo: this.normalizarBooleano(activo)
    };
  }

  normalizarValorPrincipalConPrioridad(tipoRegistro, valor, prioridad) {
    if (tipoRegistro === 'MX' && String(valor ?? '').trim() === '.') {
      if (prioridad !== 0) {
        throw new Error('Null MX exige prioridad 0 y destino raíz.');
      }
      return '.';
    }
    return this.normalizarValorPrincipalPorTipo(tipoRegistro, valor);
  }

  normalizarTipoRegistro(valor) {
    const normalizado = String(valor || '').trim().toUpperCase();

    if (!TIPOS_REGISTRO_BASE.includes(normalizado)) {
      throw new Error(
        `El tipo de registro DNS debe ser uno de: ${TIPOS_REGISTRO_BASE.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarHostRelativo(valor) {
    const normalizado = String(valor || '').trim().toLowerCase().replace(/\.+$/, '');

    if (!normalizado) {
      throw new Error('El host relativo del registro DNS es obligatorio.');
    }

    if (normalizado === '@') {
      return '@';
    }

    if (normalizado.length > 253) {
      throw new Error('El host relativo del registro DNS no puede superar 253 caracteres.');
    }

    const etiquetas = normalizado.split('.');

    if (etiquetas.some((etiqueta) => !etiqueta)) {
      throw new Error('El host relativo del registro DNS no es válido.');
    }

    etiquetas.forEach((etiqueta, indice) => {
      this.validarEtiquetaDns(
        etiqueta,
        {
          permitirWildcard: indice === 0,
          permitirUnderscore: true
        },
        'El host relativo del registro DNS no es válido.'
      );
    });

    return normalizado;
  }

  normalizarValorPrincipalPorTipo(tipoRegistro, valor) {
    if (tipoRegistro === 'A') {
      return this.normalizarIpv4(valor);
    }

    if (tipoRegistro === 'AAAA') {
      return this.normalizarIpv6(valor);
    }

    if (['CNAME', 'NS', 'PTR'].includes(tipoRegistro)) {
      return this.normalizarNombreDnsObjetivo(
        valor,
        `El valor principal del registro ${tipoRegistro} debe ser un nombre DNS válido.`
      );
    }

    if (tipoRegistro === 'TXT') {
      return this.normalizarTextoRegistro(
        valor,
        'El valor principal del registro TXT es obligatorio.',
        1024
      );
    }

    if (tipoRegistro === 'MX') {
      return this.normalizarNombreDnsObjetivo(
        valor,
        'El valor principal del registro MX debe ser un host DNS válido.'
      );
    }

    if (tipoRegistro === 'SRV') {
      return this.normalizarNombreDnsObjetivo(
        valor,
        'El valor principal del registro SRV debe ser un host DNS válido.'
      );
    }

    if (tipoRegistro === 'CAA') {
      return this.normalizarTextoRegistro(
        valor,
        'El valor principal del registro CAA es obligatorio.',
        1024
      );
    }

    throw new Error(
      `El tipo de registro DNS debe ser uno de: ${TIPOS_REGISTRO_BASE.join(', ')}.`
    );
  }

  normalizarPrioridadPorTipo(tipoRegistro, valor) {
    if (['MX', 'SRV'].includes(tipoRegistro)) {
      return this.normalizarEnteroEnRango(
        valor,
        0,
        65535,
        `La prioridad del registro ${tipoRegistro} debe estar entre 0 y 65535.`,
        0
      );
    }

    return null;
  }

  normalizarPesoPorTipo(tipoRegistro, valor) {
    if (tipoRegistro === 'SRV') {
      return this.normalizarEnteroEnRango(
        valor,
        0,
        65535,
        'El peso del registro SRV debe estar entre 0 y 65535.',
        0
      );
    }

    return null;
  }

  normalizarPuertoPorTipo(tipoRegistro, valor) {
    if (tipoRegistro === 'SRV') {
      return this.normalizarEnteroEnRango(
        valor,
        1,
        65535,
        'El puerto del registro SRV debe estar entre 1 y 65535.',
        null
      );
    }

    return null;
  }

  normalizarFlagsPorTipo(tipoRegistro, valor) {
    if (tipoRegistro === 'CAA') {
      return String(
        this.normalizarEnteroEnRango(
          valor,
          0,
          255,
          'Los flags del registro CAA deben estar entre 0 y 255.',
          0
        )
      );
    }

    return null;
  }

  normalizarTagPorTipo(tipoRegistro, valor) {
    if (tipoRegistro !== 'CAA') {
      return null;
    }

    const normalizado = String(valor || '').trim().toLowerCase();

    if (!normalizado) {
      throw new Error('El tag del registro CAA es obligatorio.');
    }

    if (!/^[a-z0-9-]{1,255}$/.test(normalizado)) {
      throw new Error('El tag del registro CAA no es válido.');
    }

    return normalizado;
  }

  normalizarCategoriaOrigen(valor) {
    const normalizado = String(valor || 'normal').trim().toLowerCase();

    if (!CATEGORIAS_REGISTRO_BASE.includes(normalizado)) {
      throw new Error(
        `La categoría de origen del registro DNS debe ser una de: ${CATEGORIAS_REGISTRO_BASE.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarDatosAuxiliares(valor, categoriaOrigen = 'normal') {
    const categoriaNormalizada = this.normalizarCategoriaOrigen(categoriaOrigen);

    if (valor == null || valor === '') {
      return this.construirDatosAuxiliaresPorDefecto(categoriaNormalizada);
    }

    if (typeof valor === 'string') {
      try {
        valor = JSON.parse(valor);
      } catch (_error) {
        throw new Error('Los datos auxiliares del registro DNS deben ser JSON válido.');
      }
    }

    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
      throw new Error('Los datos auxiliares del registro DNS deben ser un objeto JSON.');
    }

    const clonado = JSON.parse(JSON.stringify(valor));
    const gobernadoPorEntrada = String(clonado.gobernadoPor || '')
      .trim()
      .toLowerCase();

    if (GOBERNANZAS_AUTOMATICAS.includes(categoriaNormalizada)) {
      const gobernadoPor = gobernadoPorEntrada || categoriaNormalizada;

      if (gobernadoPor !== categoriaNormalizada) {
        throw new Error(
          `Los datos auxiliares del registro DNS deben declarar gobernadoPor = ${categoriaNormalizada}.`
        );
      }

      clonado.gobernadoPor = gobernadoPor;
      clonado.modoControl = this.normalizarModoControlGobernanza(
        clonado.modoControl,
        'valor_y_activo'
      );
      clonado.rolAsignado = this.normalizarRolAsignadoGobernanza(
        clonado.rolAsignado
      );

      if (clonado.rolAsignado == null) {
        delete clonado.rolAsignado;
      }

      if (categoriaNormalizada === 'ddns') {
        const ttlSugerido = this.normalizarTtlSugeridoGobernanza(
          clonado.ttlSugerido
        );

        if (ttlSugerido != null) {
          clonado.ttlSugerido = ttlSugerido;
        } else {
          delete clonado.ttlSugerido;
        }

        clonado.propietario = this.normalizarPropietarioDdns(
          clonado.propietario
        );
        clonado.criterioActualizacion = this.normalizarCriterioActualizacionDdns(
          clonado.criterioActualizacion
        );
        clonado.politicaSobrescritura = this.normalizarPoliticaSobrescrituraDdns(
          clonado.politicaSobrescritura
        );
        clonado.validacionOrigen = this.normalizarValidacionOrigenDdns(
          clonado.validacionOrigen
        );
      } else {
        delete clonado.ttlSugerido;
        delete clonado.propietario;
        delete clonado.criterioActualizacion;
        delete clonado.politicaSobrescritura;
        delete clonado.validacionOrigen;
      }

      return clonado;
    }

    if (gobernadoPorEntrada) {
      throw new Error(
        'Solo los registros DNS de tipo trigger o ddns pueden declararse gobernados por automatización.'
      );
    }

    return clonado;
  }

  normalizarDescripcion(valor) {
    const normalizado = String(valor || '').trim();

    if (normalizado.length > 255) {
      throw new Error('La descripción del registro DNS no puede superar 255 caracteres.');
    }

    return normalizado || null;
  }

  normalizarTtlOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    return this.normalizarEnteroEnRango(
      valor,
      0,
      2147483647,
      'El TTL del registro DNS debe estar entre 0 y 2147483647 segundos.',
      null
    );
  }

  normalizarIpv4(valor) {
    const normalizado = String(valor || '').trim();

    if (net.isIP(normalizado) !== 4) {
      throw new Error('El valor principal del registro A debe ser una IPv4 válida.');
    }

    return normalizado;
  }

  normalizarIpv6(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();

    if (net.isIP(normalizado) !== 6) {
      throw new Error('El valor principal del registro AAAA debe ser una IPv6 válida.');
    }

    return normalizado;
  }

  normalizarNombreDnsObjetivo(valor, mensaje) {
    const normalizado = String(valor || '').trim().toLowerCase().replace(/\.+$/, '');

    if (!normalizado) {
      throw new Error(mensaje);
    }

    if (normalizado.length > 253) {
      throw new Error(mensaje);
    }

    const etiquetas = normalizado.split('.');

    if (etiquetas.some((etiqueta) => !etiqueta)) {
      throw new Error(mensaje);
    }

    etiquetas.forEach((etiqueta) => {
      this.validarEtiquetaDns(
        etiqueta,
        {
          permitirWildcard: false,
          permitirUnderscore: true
        },
        mensaje
      );
    });

    return normalizado;
  }

  normalizarTextoRegistro(valor, mensaje, maxLongitud = 1024) {
    const normalizado = String(valor ?? '').trim();

    if (!normalizado) {
      throw new Error(mensaje);
    }

    if (normalizado.length > maxLongitud) {
      throw new Error(`El valor del registro DNS no puede superar ${maxLongitud} caracteres.`);
    }

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

  normalizarId(valor, mensaje) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido <= 0) {
      throw new Error(mensaje);
    }

    return convertido;
  }

  construirDatosAuxiliaresPorDefecto(categoriaOrigen) {
    if (!GOBERNANZAS_AUTOMATICAS.includes(categoriaOrigen)) {
      return null;
    }

    const base = {
      gobernadoPor: categoriaOrigen,
      modoControl: 'valor_y_activo'
    };

    if (categoriaOrigen === 'ddns') {
      base.ttlSugerido = 300;
      base.propietario = 'agente';
      base.criterioActualizacion = 'direccion_agente';
      base.politicaSobrescritura = 'solo_si_cambia';
      base.validacionOrigen = 'agente_autenticado_y_scope';
    }

    return base;
  }

  normalizarModoControlGobernanza(valor, porDefecto = 'valor_y_activo') {
    const normalizado = String(valor || porDefecto).trim().toLowerCase();

    if (!MODOS_CONTROL_GOBERNANZA.includes(normalizado)) {
      throw new Error(
        `El modo de control del registro DNS debe ser uno de: ${MODOS_CONTROL_GOBERNANZA.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarRolAsignadoGobernanza(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const normalizado = String(valor).trim();

    if (normalizado.length > 120) {
      throw new Error(
        'El rol asignado de gobernanza DNS no puede superar 120 caracteres.'
      );
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(normalizado)) {
      throw new Error(
        'El rol asignado de gobernanza DNS solo puede usar letras, números, punto, guion, guion bajo y dos puntos.'
      );
    }

    return normalizado;
  }

  normalizarTtlSugeridoGobernanza(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    return this.normalizarEnteroEnRango(
      valor,
      0,
      2147483647,
      'El TTL sugerido de gobernanza DNS debe estar entre 0 y 2147483647 segundos.',
      null
    );
  }

  normalizarPropietarioDdns(valor) {
    const normalizado = String(valor || 'agente').trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_.:-]{0,119}$/.test(normalizado)) {
      throw new Error(
        'El propietario DDNS debe usar letras minúsculas, números, punto, guion, guion bajo o dos puntos.'
      );
    }

    return normalizado;
  }

  normalizarCriterioActualizacionDdns(valor) {
    const normalizado = String(valor || 'direccion_agente').trim().toLowerCase();

    if (!CRITERIOS_ACTUALIZACION_DDNS.includes(normalizado)) {
      throw new Error(
        `El criterio de actualización DDNS debe ser uno de: ${CRITERIOS_ACTUALIZACION_DDNS.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarPoliticaSobrescrituraDdns(valor) {
    const normalizado = String(valor || 'solo_si_cambia').trim().toLowerCase();

    if (!POLITICAS_SOBRESCRITURA_DDNS.includes(normalizado)) {
      throw new Error(
        `La política de sobrescritura DDNS debe ser una de: ${POLITICAS_SOBRESCRITURA_DDNS.join(', ')}.`
      );
    }

    return normalizado;
  }

  normalizarValidacionOrigenDdns(valor) {
    const normalizado =
      String(valor || 'agente_autenticado_y_scope').trim().toLowerCase();

    if (!VALIDACIONES_ORIGEN_DDNS.includes(normalizado)) {
      throw new Error(
        `La validación de origen DDNS debe ser una de: ${VALIDACIONES_ORIGEN_DDNS.join(', ')}.`
      );
    }

    return normalizado;
  }
}
