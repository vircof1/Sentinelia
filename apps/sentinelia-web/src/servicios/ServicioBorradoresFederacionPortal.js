export class ServicioBorradoresFederacionPortal {
  constructor({ servicioBorradores } = {}) {
    if (typeof servicioBorradores?.crearMonitorLogicoDesdeMonitorRemoto !== 'function' ||
        typeof servicioBorradores?.crearTriggerLocalDesdeTriggerRemoto !== 'function') {
      throw new Error('Los borradores federados requieren el servicio de conversión cerrado.');
    }
    this.servicioBorradores = servicioBorradores;
  }

  async crearFormularioMonitor(contextoUsuarioActual, proyeccionId) {
    const borrador = await this.servicioBorradores.crearMonitorLogicoDesdeMonitorRemoto({
      contextoUsuarioActual,
      proyeccionId
    });
    return Object.freeze({
      formulario: Object.freeze({
        tipo: 'booleano',
        nombre: borrador.nombre,
        descripcion: borrador.descripcion || '',
        descripcion_fallo: borrador.descripcionFallo || '',
        posible_solucion: borrador.posibleSolucion || '',
        activo: '0',
        expresion_logica: borrador.configuracion.expresion,
        mensaje_fallo_logico: borrador.configuracion.mensajeFallo,
        estado_inicial_logico: borrador.configuracion.estadoInicial,
        retardo_senal_segundos_logico: String(
          borrador.configuracion.retardoSenalSegundos
        ),
        dependencias_logicas: JSON.stringify(borrador.configuracion.dependencias),
        layout_visual_logico: JSON.stringify(borrador.configuracion.layoutVisual || {}),
        return_to: '/federacion/datos-remotos'
      }),
      procedenciaFederada: borrador.procedenciaFederada
    });
  }

  async crearFormularioTrigger(contextoUsuarioActual, proyeccionId) {
    const borrador = await this.servicioBorradores.crearTriggerLocalDesdeTriggerRemoto({
      contextoUsuarioActual,
      proyeccionId
    });
    const configuracion = borrador.configuracion || {};
    return Object.freeze({
      formulario: Object.freeze({
        tipo: borrador.tipo,
        nombre: borrador.nombre,
        descripcion: borrador.descripcion || '',
        activo: '0',
        ...configuracionFormularioTrigger(borrador.tipo, configuracion)
      }),
      requiereCredencialLocal: Boolean(borrador.requiereCredencialLocal),
      procedenciaFederada: borrador.procedenciaFederada
    });
  }
}

function configuracionFormularioTrigger(tipo, configuracion) {
  if (tipo === 'api') {
    return {
      url: configuracion.url || '',
      metodo: configuracion.metodo || 'POST',
      timeoutMs: String(configuracion.timeoutMs ?? 5000),
      reintentos: String(configuracion.reintentos ?? 0),
      permiteTlsInseguro: false,
      cabeceras: JSON.stringify(configuracion.cabeceras || {}),
      plantillaCuerpo: configuracion.plantillaCuerpo || '',
      parametroOpcional: configuracion.parametroOpcional || ''
    };
  }
  if (tipo === 'dns') {
    return {
      zonaId: '',
      registroId: '',
      operacion: configuracion.operacion || 'editar_valor',
      valorPrincipal: configuracion.valorPrincipal || '',
      rolGobernanza: configuracion.rolGobernanza || ''
    };
  }
  if (tipo === 'correo') {
    return {
      versionCorreo: String(configuracion.version ?? 1),
      asuntoPlantilla: configuracion.asuntoPlantilla || '',
      textoIntroduccion: configuracion.textoIntroduccion || '',
      textoCierre: configuracion.textoCierre || ''
    };
  }
  throw new Error('El tipo de trigger remoto no dispone de editor local compatible.');
}
