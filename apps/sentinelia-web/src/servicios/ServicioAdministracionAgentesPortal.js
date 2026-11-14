import { readFile } from 'node:fs/promises';
import {
  crearLecturaOperativaAgente
} from '../../../../paquetes/agentes/src/LecturaOperativaAgente.js';

const RUTA_OPENAPI_AGENTES = new URL(
  '../../../../openapi/agentes.v1.yaml',
  import.meta.url
);
const MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS = 120;

export class ServicioAdministracionAgentesPortal {
  constructor({
    servicioProvisionamientoAgentes,
    repositorioAgentes,
    repositorioSitios,
    repositorioSesionesAgentesRedis = null,
    servicioLecturaTelemetriaAgentes = null,
    servicioLecturaAdministrativaDdnsAgentes = null,
    repositorioReglasDerivacionTelemetria = null
  }) {
    this.servicioProvisionamientoAgentes = servicioProvisionamientoAgentes;
    this.repositorioAgentes = repositorioAgentes;
    this.repositorioSitios = repositorioSitios;
    this.repositorioSesionesAgentesRedis = repositorioSesionesAgentesRedis;
    this.servicioLecturaTelemetriaAgentes = servicioLecturaTelemetriaAgentes;
    this.servicioLecturaAdministrativaDdnsAgentes =
      servicioLecturaAdministrativaDdnsAgentes;
    this.repositorioReglasDerivacionTelemetria =
      repositorioReglasDerivacionTelemetria;
  }

  async construirVistaListado(contextoUsuarioActual, filtrosEntrada = {}) {
    const agentes =
      await this.servicioProvisionamientoAgentes
        .listarAgentesVisibles(contextoUsuarioActual);
    const lecturasOperativas = await Promise.all(
      agentes.map((agente) => this.construirLecturaOperativaAgente(agente))
    );
    const perfilesServidor = await this.servicioProvisionamientoAgentes
      .consultarResumenPerfilesServidorAgentes(
        contextoUsuarioActual,
        agentes
      );
    const serializados = lecturasOperativas.map((lectura, indice) => ({
      ...lectura.serializar(),
      perfilServidor: perfilesServidor[indice]
    }));
    const filtros = this.normalizarFiltrosListado(filtrosEntrada);
    const agentesFiltrados = this.aplicarFiltrosListado(serializados, filtros);

    return {
      agentes: agentesFiltrados,
      totalAgentesSinFiltrar: serializados.length,
      resumen: this.construirResumen(agentesFiltrados),
      filtros,
      opcionesFiltros: this.construirOpcionesFiltrosListado(),
      puedeModificarAgentes: Boolean(
        contextoUsuarioActual?.permisos?.modificarAgentes
      ),
      alcanceActual: this.construirDescripcionAlcance(contextoUsuarioActual)
    };
  }

  async construirVistaListadoShell(contextoUsuarioActual, filtrosEntrada = {}) {
    const filtros = this.normalizarFiltrosListadoAjax(filtrosEntrada);

    return {
      resumen: {
        total: 0,
        totalVisibles: 0,
        activos: 0,
        deshabilitados: 0,
        enCuarentena: 0,
        vivos: 0,
        silenciosos: 0,
        nuncaConectados: 0,
        sesionesRedisVivas: 0
      },
      filtros,
      opcionesFiltros: this.construirOpcionesFiltrosListado(),
      puedeModificarAgentes: Boolean(
        contextoUsuarioActual?.permisos?.modificarAgentes
      ),
      alcanceActual: this.construirDescripcionAlcance(contextoUsuarioActual)
    };
  }

  async listarAgentesAdministracion(
    contextoUsuarioActual,
    filtrosEntrada = {}
  ) {
    const filtros = this.normalizarFiltrosListadoAjax(filtrosEntrada);
    const resultado =
      await this.servicioProvisionamientoAgentes.listarAgentesVisiblesPaginado(
        contextoUsuarioActual,
        filtros
      );
    const lecturasOperativas = await Promise.all(
      resultado.agentes.map((agente) => this.construirLecturaOperativaAgente(agente))
    );
    const perfilesServidor = await this.servicioProvisionamientoAgentes
      .consultarResumenPerfilesServidorAgentes(
        contextoUsuarioActual,
        resultado.agentes
      );
    const agentesSerializados = lecturasOperativas.map((lectura, indice) => ({
      ...lectura.serializar(),
      perfilServidor: perfilesServidor[indice]
    }));

    return {
      resumen: {
        total: resultado.resumen.totalAgentesFiltrados,
        totalVisibles: resultado.resumen.totalAgentesVisibles,
        activos: resultado.resumen.activos,
        deshabilitados: resultado.resumen.deshabilitados,
        enCuarentena: resultado.resumen.enCuarentena,
        vivos: resultado.resumen.vivos,
        silenciosos: resultado.resumen.silenciosos,
        nuncaConectados: resultado.resumen.nuncaConectados,
        sesionesRedisVivas: agentesSerializados.filter(
          (agente) => agente.sesionRedis?.viva
        ).length
      },
      filtros: {
        ...filtros,
        pagina: resultado.paginacion.pagina,
        tamanoPagina: resultado.paginacion.tamanoPagina
      },
      opcionesFiltros: this.construirOpcionesFiltrosListado(),
      puedeModificarAgentes: Boolean(
        contextoUsuarioActual?.permisos?.modificarAgentes
      ),
      alcanceActual: this.construirDescripcionAlcance(contextoUsuarioActual),
      agentes: agentesSerializados,
      paginacion: {
        ...resultado.paginacion,
        desde:
          resultado.paginacion.totalFiltrado === 0
            ? 0
            : ((resultado.paginacion.pagina - 1) *
                resultado.paginacion.tamanoPagina) + 1,
        hasta: Math.min(
          resultado.paginacion.totalFiltrado,
          resultado.paginacion.pagina * resultado.paginacion.tamanoPagina
        )
      }
    };
  }

  async construirVistaFormulario(contextoUsuarioActual, { idAgente = null } = {}) {
    const modo = idAgente ? 'editar' : 'crear';
    const agente = idAgente
      ? await this.obtenerAgenteVisible(contextoUsuarioActual, idAgente)
      : null;
    const sitios = await this.repositorioSitios.listarVisibles(contextoUsuarioActual);
    const perfilServidor = agente
      ? await this.servicioProvisionamientoAgentes
          .consultarPerfilServidorAgente(contextoUsuarioActual, agente.id)
      : null;
    const concesionesDdns = agente && this.servicioLecturaAdministrativaDdnsAgentes
      ? await this.servicioLecturaAdministrativaDdnsAgentes.listarPorAgente({
          contextoUsuarioActual,
          agenteId: agente.id
        })
      : [];
    const candidatosDdns = agente && this.servicioLecturaAdministrativaDdnsAgentes &&
        contextoUsuarioActual?.permisos?.modificarAgentes &&
        contextoUsuarioActual?.permisos?.administrarDnsAvanzado
      ? await this.servicioLecturaAdministrativaDdnsAgentes
          .listarCandidatosParaAgente({
            contextoUsuarioActual,
            agenteId: agente.id
          })
      : [];

    return {
      modo,
      agente: agente ? this.serializarAgente(agente) : null,
      perfilServidor,
      concesionesDdns,
      candidatosDdns,
      puedeAdministrarDdns: Boolean(
        contextoUsuarioActual?.permisos?.modificarAgentes &&
        contextoUsuarioActual?.permisos?.administrarDnsAvanzado
      ),
      formulario: this.construirFormularioBase(agente, contextoUsuarioActual),
      opcionesSitios: sitios.map((sitio) => ({
        valor: sitio.id,
        etiqueta: `${sitio.nombre} (#${sitio.id})`,
        detalle: `${sitio.tenantNombre || `Tenant #${sitio.tenantId}`} · ${sitio.empresaNombre || `Empresa #${sitio.empresaId}`}`,
        tenantId: sitio.tenantId,
        empresaId: sitio.empresaId
      })),
      sitioFijadoPorScope:
        !agente && contextoUsuarioActual?.nivelScope === 'sitio',
      alcanceActual: this.construirDescripcionAlcance(contextoUsuarioActual)
    };
  }

  async leerContratoOpenApiYaml() {
    return readFile(RUTA_OPENAPI_AGENTES, 'utf8');
  }

  async construirVistaTelemetria(
    contextoUsuarioActual,
    idAgente,
    filtrosEntrada = {}
  ) {
    if (!this.servicioLecturaTelemetriaAgentes) {
      throw new Error('El servicio de lectura de telemetría no está configurado.');
    }

    const lectura =
      await this.servicioLecturaTelemetriaAgentes.construirLecturaAgente(
        contextoUsuarioActual,
        idAgente,
        filtrosEntrada
      );
    const senalSeleccionada = lectura.catalogoSenales.find((senal) =>
      Number(senal.id) === Number(lectura.filtros.senalId)
    ) || null;
    const contextoPolGrafico =
      await this.construirContextoPolGraficoTelemetria(lectura);
    const senalesActuales = lectura.presentacion?.senalesActuales || [];
    const senalIds = senalesActuales
      .map((senal) => Number(senal.senalId))
      .filter((senalId) => Number.isInteger(senalId) && senalId > 0);
    const conteosInterpretaciones =
      typeof this.repositorioReglasDerivacionTelemetria
        ?.contarPorSenalesDeAgente === 'function'
        ? await this.repositorioReglasDerivacionTelemetria
          .contarPorSenalesDeAgente(lectura.agente.id, senalIds)
        : new Map();

    return {
      ...lectura,
      presentacion: {
        ...lectura.presentacion,
        senalesActuales: senalesActuales.map((senal) => ({
          ...senal,
          totalInterpretaciones: conteosInterpretaciones.get(
            Number(senal.senalId)
          ) || 0
        }))
      },
      grafico: this.construirDatosGraficoTelemetria(
        lectura,
        senalSeleccionada,
        contextoPolGrafico
      ),
      alcanceActual: this.construirDescripcionAlcance(contextoUsuarioActual)
    };
  }

  async consultarHistoricoTelemetria(
    contextoUsuarioActual,
    idAgente,
    filtrosEntrada = {}
  ) {
    const vista = await this.construirVistaTelemetria(
      contextoUsuarioActual,
      idAgente,
      filtrosEntrada
    );
    const senalSeleccionada = vista.catalogoSenales.find((senal) =>
      Number(senal.id) === Number(vista.filtros.senalId)
    ) || null;

    return {
      agente: vista.agente,
      filtros: vista.filtros,
      senal: senalSeleccionada,
      historico: vista.historico,
      presentacion: {
        historico: vista.presentacion?.historico || {
          observaciones: [],
          tieneSerieTemporal: false
        }
      },
      grafico: vista.grafico || this.construirDatosGraficoTelemetria(
        vista,
        senalSeleccionada
      )
    };
  }

  async consultarMiniaturaTelemetria(
    contextoUsuarioActual,
    idAgente,
    { senalId } = {}
  ) {
    const muestra = await this.servicioLecturaTelemetriaAgentes
      .consultarMuestraSenal(contextoUsuarioActual, idAgente, { senalId });
    const observaciones = muestra.observaciones.map((observacion) =>
      this.construirObservacionGraficoTelemetria(observacion)
    );
    const generadoEnUtc = new Date().toISOString();
    const primeraFecha = observaciones[0]?.observadoEnUtc || generadoEnUtc;
    const ultimaFecha = observaciones.at(-1)?.observadoEnUtc || generadoEnUtc;
    const hastaUtc = muestra.senal.tipoDato === 'booleano'
      ? generadoEnUtc
      : ultimaFecha;
    const vistaMuestra = {
      agente: muestra.agente,
      filtros: {
        desdeUtc: primeraFecha,
        hastaUtc
      },
      presentacion: {
        historico: { observaciones }
      }
    };
    const pol = muestra.senal.tipoDato === 'booleano' && observaciones.length > 0
      ? await this.construirContextoPolGraficoTelemetria(vistaMuestra)
      : null;

    return {
      senal: muestra.senal,
      limite: muestra.limite,
      generadoEnUtc,
      rango: {
        desdeUtc: primeraFecha,
        hastaUtc
      },
      observaciones,
      pol
    };
  }

  async construirContextoPolGraficoTelemetria(vista) {
    const generadoEnUtc = new Date().toISOString();
    const rango = this.resolverRangoGraficoTelemetria(vista, generadoEnUtc);

    if (!rango.desdeUtc && !rango.hastaUtc) {
      return {
        rango,
        generadoEnUtc,
        margenCoberturaSegundos: MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS,
        total: 0,
        periodos: []
      };
    }

    const periodos =
      await this.repositorioAgentes.listarPeriodosVidaPolPorAgenteYRango({
        agenteId: vista.agente.id,
        desdeUtc: rango.desdeUtc,
        hastaUtc: rango.hastaUtc,
        limite: 200
      });
    const serializados = periodos.map((periodo) => periodo.serializar());

    return {
      rango,
      generadoEnUtc,
      margenCoberturaSegundos: MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS,
      total: serializados.length,
      periodos: serializados.map((periodo) => {
        const cobertura = this.calcularCoberturaEfectivaPolGrafico({
          periodo,
          agente: vista.agente,
          generadoEnUtc
        });

        return {
          id: periodo.id,
          inicioUtc: periodo.inicioUtc,
          finUtc: periodo.finUtc,
          finEfectivoUtc: cobertura.finEfectivoUtc,
          ultimaEvidenciaVidaUtc: cobertura.ultimaEvidenciaVidaUtc,
          silencioDetectado: cobertura.silencioDetectado,
          abierto: periodo.abierto,
          heartbeatsRecibidos: periodo.heartbeatsRecibidos,
          ultimoHeartbeatUtc: periodo.ultimoHeartbeatUtc,
          ultimoSeq: periodo.ultimoSeq,
          motivoCierre: periodo.motivoCierre,
          sesionIdDiagnostico: periodo.sesionIdDiagnostico,
          bootId: periodo.bootId
        };
      })
    };
  }

  resolverRangoGraficoTelemetria(vista, generadoEnUtc = new Date().toISOString()) {
    const filtros = vista.filtros || {};
    const desdeFiltro = this.normalizarFechaUtcGrafico(filtros.desdeUtc);
    const hastaFiltro = this.normalizarFechaUtcGrafico(filtros.hastaUtc);

    if (desdeFiltro || hastaFiltro) {
      return {
        desdeUtc: desdeFiltro,
        hastaUtc: hastaFiltro
      };
    }

    const observaciones = vista.presentacion?.historico?.observaciones || [];
    const fechas = observaciones
      .map((observacion) => this.normalizarFechaUtcGrafico(
        observacion.observadoEnUtc
      ))
      .filter(Boolean)
      .sort();
    const ultimaActividadPol = this.normalizarFechaUtcGrafico(
      vista.agente?.ultimoHeartbeatUtc || vista.agente?.ultimoLoginUtc
    );
    const generado = this.normalizarFechaUtcGrafico(generadoEnUtc);
    const hastaSinFiltro = fechas.length > 0 && generado
      ? [fechas[fechas.length - 1], generado].sort()[1]
      : fechas[fechas.length - 1] || generado || null;

    return {
      desdeUtc: fechas[0] || ultimaActividadPol || null,
      hastaUtc: hastaSinFiltro
    };
  }

  normalizarFechaUtcGrafico(valor) {
    const texto = String(valor || '').trim();

    if (!texto) {
      return null;
    }

    const fecha = new Date(texto);

    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
  }

  calcularCoberturaEfectivaPolGrafico({
    periodo,
    agente,
    generadoEnUtc
  }) {
    const inicio = this.normalizarFechaUtcGrafico(periodo.inicioUtc);
    const finRegistrado = this.normalizarFechaUtcGrafico(periodo.finUtc);

    if (!inicio) {
      return {
        finEfectivoUtc: finRegistrado,
        ultimaEvidenciaVidaUtc: finRegistrado,
        silencioDetectado: false
      };
    }

    if (finRegistrado) {
      const ultimaEvidenciaRegistrada = this.normalizarFechaUtcGrafico(
        periodo.ultimoHeartbeatUtc
      );

      if (ultimaEvidenciaRegistrada) {
        const finRegistradoMs = new Date(finRegistrado).getTime();
        const ultimaEvidenciaMs = new Date(ultimaEvidenciaRegistrada).getTime();
        const margenMs = MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS * 1000;
        const finEfectivoMs = Math.max(
          new Date(inicio).getTime(),
          Math.min(ultimaEvidenciaMs + margenMs, finRegistradoMs)
        );

        return {
          finEfectivoUtc: new Date(finEfectivoMs).toISOString(),
          ultimaEvidenciaVidaUtc: ultimaEvidenciaRegistrada,
          silencioDetectado: finEfectivoMs < finRegistradoMs
        };
      }

      return {
        finEfectivoUtc: finRegistrado,
        ultimaEvidenciaVidaUtc: finRegistrado,
        silencioDetectado: false
      };
    }

    const generado = this.normalizarFechaUtcGrafico(generadoEnUtc) ||
      new Date().toISOString();
    const sesionCoincide = !periodo.sesionIdDiagnostico ||
      !agente?.ultimaSesionIdDiagnostico ||
      periodo.sesionIdDiagnostico === agente.ultimaSesionIdDiagnostico;
    const evidencias = [inicio];

    if (sesionCoincide) {
      const ultimoHeartbeatPeriodo = this.normalizarFechaUtcGrafico(
        periodo.ultimoHeartbeatUtc
      );
      const ultimoHeartbeatAgente = this.normalizarFechaUtcGrafico(
        agente?.ultimoHeartbeatUtc
      );
      const ultimoLogin = this.normalizarFechaUtcGrafico(agente?.ultimoLoginUtc);
      const ultimoHeartbeat = ultimoHeartbeatPeriodo || ultimoHeartbeatAgente;

      if (ultimoHeartbeat) {
        evidencias.push(ultimoHeartbeat);
      }

      if (ultimoLogin) {
        evidencias.push(ultimoLogin);
      }
    }

    const ultimaEvidenciaMs = Math.max(
      ...evidencias.map((valor) => new Date(valor).getTime())
    );
    const generadoMs = new Date(generado).getTime();
    const margenMs = MARGEN_COBERTURA_POL_GRAFICO_SEGUNDOS * 1000;
    const finEfectivoMs = Math.max(
      new Date(inicio).getTime(),
      Math.min(ultimaEvidenciaMs + margenMs, generadoMs)
    );

    return {
      finEfectivoUtc: new Date(finEfectivoMs).toISOString(),
      ultimaEvidenciaVidaUtc: new Date(ultimaEvidenciaMs).toISOString(),
      silencioDetectado: finEfectivoMs < generadoMs
    };
  }

  construirDatosGraficoTelemetria(
    vista,
    senalSeleccionada,
    contextoPol = null
  ) {
    const historicoPresentado = vista.presentacion?.historico || {
      observaciones: [],
      tieneSerieTemporal: false,
      tipoSerieTemporal: null
    };

    return {
      agente: {
        id: vista.agente.id,
        nombre: vista.agente.nombre
      },
      senal: senalSeleccionada
        ? {
            id: senalSeleccionada.id,
            codigoSenal: senalSeleccionada.codigoSenal,
            nombreHumano:
              senalSeleccionada.nombreHumano || senalSeleccionada.codigoSenal,
            tipoDato: senalSeleccionada.tipoDato,
            unidad: senalSeleccionada.unidad || ''
          }
        : null,
      tieneSerieTemporal: historicoPresentado.tieneSerieTemporal,
      tipoSerieTemporal: historicoPresentado.tipoSerieTemporal ||
        (historicoPresentado.tieneSerieTemporal
          ? senalSeleccionada?.tipoDato || null
          : null),
      comparacion: this.construirDatosComparacionGraficoTelemetria(vista),
      pol: contextoPol || {
        rango: {
          desdeUtc: null,
          hastaUtc: null
        },
        total: 0,
        periodos: []
      },
      observaciones: historicoPresentado.observaciones.map((observacion) => ({
        ...this.construirObservacionGraficoTelemetria(observacion)
      }))
    };
  }

  construirDatosComparacionGraficoTelemetria(vista) {
    const comparacion = vista.comparacion || {
      unidadReferencia: '',
      senalPrincipal: null,
      senalesAceptadas: [],
      senalesRechazadas: [],
      historicos: []
    };

    return {
      habilitada: Boolean(comparacion.habilitada),
      tipoDatoReferencia: comparacion.tipoDatoReferencia || null,
      unidadReferencia: comparacion.unidadReferencia || '',
      senalPrincipal: comparacion.senalPrincipal || null,
      senalesAceptadas: comparacion.senalesAceptadas || [],
      senalesRechazadas: comparacion.senalesRechazadas || [],
      series: (comparacion.historicos || []).map((historico) => ({
        senal: historico.senal,
        paginacion: historico.paginacion,
        observaciones: (historico.observaciones || []).map((observacion) => ({
          ...this.construirObservacionGraficoTelemetria(observacion)
        }))
      }))
    };
  }

  construirObservacionGraficoTelemetria(observacion = {}) {
    const valorPresentado = observacion.valor || {};
    const tipoDato = observacion.tipoDato || valorPresentado.tipoDato || null;
    const valorBruto = valorPresentado.valorBruto ?? null;

    return {
      observadoEnUtc: observacion.observadoEnUtc,
      recibidoEnUtc: observacion.recibidoEnUtc,
      vigenteHastaUtc: observacion.vigenteHastaUtc || null,
      periodoVidaPolId: observacion.periodoVidaPolId || null,
      tipoDato,
      valorNumero: tipoDato === 'numero'
        ? valorBruto ?? observacion.valorNumero ?? null
        : null,
      valorDuracion: tipoDato === 'duracion'
        ? valorBruto ?? observacion.valorDuracion ?? null
        : null,
      valorMomentoUtc: tipoDato === 'momento_utc'
        ? valorBruto ?? observacion.valorMomentoUtc ?? null
        : null,
      valorBooleano: tipoDato === 'booleano'
        ? valorBruto ?? observacion.valorBooleano ?? null
        : null,
      valorTexto: valorPresentado.texto ?? observacion.valorTexto ?? null,
      calidad: observacion.calidad,
      severidadDeclarada: observacion.severidadDeclarada,
      origen: observacion.origen,
      detalleHumano: observacion.detalleHumano,
      metadatos: observacion.metadatos ?? null
    };
  }

  async crearAgente(contextoUsuarioActual, datos) {
    return this.servicioProvisionamientoAgentes.provisionarAgente(
      contextoUsuarioActual,
      {
        sitioId: datos.sitio_id,
        nombre: datos.nombre,
        descripcion: datos.descripcion
      }
    );
  }

  async actualizarAgente(contextoUsuarioActual, idAgente, datos) {
    const resultado =
      await this.servicioProvisionamientoAgentes.editarMetadatosAgente(
        contextoUsuarioActual,
        idAgente,
        {
          nombre: datos.nombre,
          descripcion: datos.descripcion
        }
      );

    return resultado.agente;
  }

  async rotarSecreto(contextoUsuarioActual, idAgente) {
    return this.servicioProvisionamientoAgentes.rotarSecretoAgente(
      contextoUsuarioActual,
      idAgente
    );
  }

  async deshabilitarAgente(contextoUsuarioActual, idAgente) {
    const resultado =
      await this.servicioProvisionamientoAgentes.deshabilitarAgente(
        contextoUsuarioActual,
        idAgente
      );

    return resultado.agente;
  }

  async habilitarAgente(contextoUsuarioActual, idAgente) {
    const resultado =
      await this.servicioProvisionamientoAgentes.habilitarAgente(
        contextoUsuarioActual,
        idAgente
      );

    return resultado.agente;
  }

  async solicitarPerfilServidor(contextoUsuarioActual, idAgente, datos) {
    return this.servicioProvisionamientoAgentes
      .solicitarPerfilServidorAgente(contextoUsuarioActual, idAgente, {
        histeresisSinPolSegundos: datos.histeresis_sin_pol_segundos,
        duracionReinicioRecienteSegundos:
          datos.duracion_reinicio_reciente_segundos
      });
  }

  async actualizarConfiguracionPerfilServidor(
    contextoUsuarioActual,
    idAgente,
    datos
  ) {
    return this.servicioProvisionamientoAgentes
      .actualizarConfiguracionPerfilServidorAgente(
        contextoUsuarioActual,
        idAgente,
        {
          generacion: datos.generacion,
          versionEsperada: datos.version_estado,
          histeresisSinPolSegundos: datos.histeresis_sin_pol_segundos,
          duracionReinicioRecienteSegundos:
            datos.duracion_reinicio_reciente_segundos
        }
      );
  }

  async retirarPerfilServidor(contextoUsuarioActual, idAgente, datos) {
    return this.servicioProvisionamientoAgentes.retirarPerfilServidorAgente(
      contextoUsuarioActual,
      idAgente,
      {
        generacion: datos.generacion,
        versionEsperada: datos.version_estado
      }
    );
  }

  async obtenerAgenteVisible(contextoUsuarioActual, idAgente) {
    const agentes =
      await this.servicioProvisionamientoAgentes
        .listarAgentesVisibles(contextoUsuarioActual);
    const agente = agentes.find(
      (item) => Number(item.id) === Number(idAgente)
    );

    if (!agente) {
      throw new Error('No existe el agente solicitado dentro de tu alcance.');
    }

    return agente;
  }

  construirFormularioBase(agente, contextoUsuarioActual = null) {
    if (!agente) {
      return {
        nombre: '',
        descripcion: '',
        sitioId: contextoUsuarioActual?.nivelScope === 'sitio'
          ? contextoUsuarioActual.sitioId
          : ''
      };
    }

    return {
      nombre: agente.nombre,
      descripcion: agente.descripcion || '',
      sitioId: agente.sitioId
    };
  }

  construirResumen(agentes) {
    return {
      total: agentes.length,
      activos: agentes.filter(
        (agente) => agente.estadoAdministrativo === 'activo'
      ).length,
      deshabilitados: agentes.filter(
        (agente) => agente.estadoAdministrativo === 'deshabilitado'
      ).length,
      enCuarentena: agentes.filter(
        (agente) => agente.estadoAcceso === 'cuarentena'
      ).length,
      vivos: agentes.filter((agente) => agente.estadoVidaPol === 'vivo').length,
      sesionesRedisVivas: agentes.filter((agente) => agente.sesionRedis?.viva)
        .length
    };
  }

  normalizarFiltrosListado(filtrosEntrada = {}) {
    return {
      textoBusqueda: this.normalizarTextoFiltro(
        filtrosEntrada.q ?? filtrosEntrada.textoBusqueda
      ),
      estadoAdministrativo: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_administrativo ?? filtrosEntrada.estadoAdministrativo,
        ['', 'activo', 'deshabilitado']
      ),
      estadoAcceso: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_acceso ?? filtrosEntrada.estadoAcceso,
        ['', 'normal', 'cuarentena']
      ),
      estadoVidaPol: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_vida_pol ?? filtrosEntrada.estadoVidaPol,
        [
          '',
          'nunca_conectado',
          'vivo',
          'silencioso',
          'inconsistente_relogin_requerido'
        ]
      ),
      focoOperativo: this.normalizarOpcionFiltro(
        filtrosEntrada.foco_operativo ?? filtrosEntrada.focoOperativo,
        [
          'todos',
          'cuarentena',
          'sin_heartbeat',
          'sesion_redis_viva',
          'sin_sesion_redis'
        ],
        'todos'
      )
    };
  }

  normalizarFiltrosListadoAjax(filtrosEntrada = {}) {
    return {
      textoBusqueda: this.normalizarTextoFiltro(
        filtrosEntrada.q ?? filtrosEntrada.textoBusqueda
      ),
      tenantId: this.normalizarIdFiltro(
        filtrosEntrada.tenant_id ?? filtrosEntrada.tenantId
      ),
      empresaId: this.normalizarIdFiltro(
        filtrosEntrada.empresa_id ?? filtrosEntrada.empresaId
      ),
      sitioId: this.normalizarIdFiltro(
        filtrosEntrada.sitio_id ?? filtrosEntrada.sitioId
      ),
      estadoAdministrativo: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_administrativo ?? filtrosEntrada.estadoAdministrativo,
        ['', 'activo', 'deshabilitado']
      ),
      estadoAcceso: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_acceso ?? filtrosEntrada.estadoAcceso,
        ['', 'normal', 'cuarentena']
      ),
      estadoVidaPol: this.normalizarOpcionFiltro(
        filtrosEntrada.estado_vida_pol ?? filtrosEntrada.estadoVidaPol,
        [
          '',
          'nunca_conectado',
          'vivo',
          'silencioso',
          'inconsistente_relogin_requerido'
        ]
      ),
      focoOperativo: this.normalizarOpcionFiltro(
        filtrosEntrada.foco_operativo ?? filtrosEntrada.focoOperativo,
        [
          'todos',
          'cuarentena',
          'sin_heartbeat'
        ],
        'todos'
      ),
      pagina: this.normalizarEnteroFiltro(
        filtrosEntrada.page ?? filtrosEntrada.pagina,
        1,
        1,
        1000000
      ),
      tamanoPagina: this.normalizarEnteroFiltro(
        filtrosEntrada.page_size ?? filtrosEntrada.tamanoPagina,
        10,
        1,
        100
      ),
      ordenarPor: this.normalizarOpcionFiltro(
        filtrosEntrada.sort_by ?? filtrosEntrada.ordenarPor,
        [
          'nombre',
          'sitio',
          'empresa',
          'tenant',
          'estado',
          'acceso',
          'login',
          'heartbeat',
          'creado',
          'actualizado'
        ],
        'nombre'
      ),
      direccionOrden: this.normalizarOpcionFiltro(
        filtrosEntrada.sort_dir ?? filtrosEntrada.direccionOrden,
        ['asc', 'desc'],
        'asc'
      )
    };
  }

  construirOpcionesFiltrosListado() {
    return {
      estadosAdministrativos: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'activo', etiqueta: 'Habilitados' },
        { valor: 'deshabilitado', etiqueta: 'Deshabilitados' }
      ],
      estadosAcceso: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'normal', etiqueta: 'Sin restricciones' },
        { valor: 'cuarentena', etiqueta: 'En cuarentena' }
      ],
      estadosVidaPol: [
        { valor: '', etiqueta: 'Todos' },
        { valor: 'vivo', etiqueta: 'En línea' },
        { valor: 'silencioso', etiqueta: 'Sin señal reciente' },
        { valor: 'nunca_conectado', etiqueta: 'Nunca conectados' },
        {
          valor: 'inconsistente_relogin_requerido',
          etiqueta: 'Debe iniciar sesión de nuevo'
        }
      ],
      focosOperativos: [
        { valor: 'todos', etiqueta: 'Todos' },
        { valor: 'cuarentena', etiqueta: 'En cuarentena' },
        { valor: 'sin_heartbeat', etiqueta: 'Sin señal reciente' }
      ]
    };
  }

  aplicarFiltrosListado(agentes, filtros) {
    return agentes.filter((agente) => {
      if (
        filtros.textoBusqueda &&
        !this.agenteCoincideTexto(agente, filtros.textoBusqueda)
      ) {
        return false;
      }

      if (
        filtros.estadoAdministrativo &&
        agente.estadoAdministrativo !== filtros.estadoAdministrativo
      ) {
        return false;
      }

      if (filtros.estadoAcceso && agente.estadoAcceso !== filtros.estadoAcceso) {
        return false;
      }

      if (
        filtros.estadoVidaPol &&
        agente.estadoVidaPol !== filtros.estadoVidaPol
      ) {
        return false;
      }

      return this.agenteCoincideFocoOperativo(agente, filtros.focoOperativo);
    });
  }

  agenteCoincideTexto(agente, textoBusqueda) {
    const texto = textoBusqueda.toLowerCase();
    const campos = [
      agente.id,
      agente.nombre,
      agente.guid,
      agente.descripcion,
      agente.tenantNombre,
      agente.empresaNombre,
      agente.sitioNombre,
      agente.ultimoHostname,
      agente.ultimoBootId,
      agente.ultimaVersionAgente,
      agente.sesionRedis?.sesion?.sessionId
    ];

    return campos.some((campo) =>
      String(campo ?? '').toLowerCase().includes(texto)
    );
  }

  agenteCoincideFocoOperativo(agente, focoOperativo) {
    switch (focoOperativo) {
      case 'cuarentena':
        return agente.estadoAcceso === 'cuarentena';
      case 'sin_heartbeat':
        return ['silencioso', 'nunca_conectado', 'inconsistente_relogin_requerido']
          .includes(agente.estadoVidaPol);
      case 'sesion_redis_viva':
        return Boolean(agente.sesionRedis?.viva);
      case 'sin_sesion_redis':
        return !agente.sesionRedis?.viva;
      case 'todos':
      default:
        return true;
    }
  }

  normalizarTextoFiltro(valor) {
    return String(valor || '').trim().slice(0, 120);
  }

  normalizarOpcionFiltro(valor, permitidos, porDefecto = '') {
    const normalizado = String(valor || porDefecto).trim();

    return permitidos.includes(normalizado) ? normalizado : porDefecto;
  }

  normalizarIdFiltro(valor) {
    const normalizado = Number.parseInt(String(valor ?? '').trim(), 10);

    return Number.isInteger(normalizado) && normalizado > 0
      ? normalizado
      : null;
  }

  normalizarEnteroFiltro(valor, porDefecto, minimo, maximo) {
    const normalizado = Number.parseInt(String(valor ?? '').trim(), 10);

    if (!Number.isInteger(normalizado)) {
      return porDefecto;
    }

    return Math.min(maximo, Math.max(minimo, normalizado));
  }

  construirDescripcionAlcance(contextoUsuarioActual) {
    const nivel = contextoUsuarioActual?.nivelScope || 'desconocido';

    return {
      nivelScope: nivel,
      descripcion: `Alcance ${nivel}`
    };
  }

  serializarAgente(agente) {
    return crearLecturaOperativaAgente({ agente }).serializar();
  }

  async construirLecturaOperativaAgente(agente) {
    const referenciaSesionRedis = this.repositorioSesionesAgentesRedis
      ? await this.repositorioSesionesAgentesRedis.obtenerSesionActualAgente(
        agente.id
      )
      : null;

    return crearLecturaOperativaAgente({ agente, referenciaSesionRedis });
  }
}
