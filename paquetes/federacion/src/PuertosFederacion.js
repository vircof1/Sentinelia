export const VERSION_PUERTOS_FEDERACION = 1;
export const PERFIL_PUERTOS_FEDERACION =
  'sentinelia-federacion-puertos-v1';

export class ErrorPuertoFederacion extends Error {
  constructor(codigo, mensaje, { puerto = null, metodo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorPuertoFederacion';
    this.codigo = codigo;
    this.puerto = puerto;
    this.metodo = metodo;
  }
}

function metodo(
  nombre,
  {
    modo = 'asincrono',
    efecto = 'lectura',
    transaccion = 'ninguna',
    momento = 'duranteOperacion',
    secretos = 'ninguno'
  } = {}
) {
  return { nombre, modo, efecto, transaccion, momento, secretos };
}

function crearContratoPuerto({ nombre, naturaleza, metodos, invariantes }) {
  if (new Set(metodos.map((entrada) => entrada.nombre)).size !== metodos.length) {
    throw new TypeError(`El puerto ${nombre} repite métodos contractuales.`);
  }
  return congelarProfundo({
    nombre,
    version: VERSION_PUERTOS_FEDERACION,
    naturaleza,
    metodos,
    invariantes
  });
}

export const PUERTO_RELOJ_SQL_FEDERACION = crearContratoPuerto({
  nombre: 'relojSql',
  naturaleza: 'tiempo_durable_autoritativo',
  metodos: [
    metodo('obtenerAhoraUtc', { transaccion: 'opcional' }),
    metodo('verificarOperacionUtc')
  ],
  invariantes: [
    'sql_es_fuente_temporal_local',
    'fecha_utc_canonica',
    'no_corrige_tiempo_remoto'
  ]
});

export const PUERTO_IDENTIDADES_FEDERACION = crearContratoPuerto({
  nombre: 'identidades',
  naturaleza: 'generacion_opaca',
  metodos: [metodo('generar', { modo: 'sincrono', efecto: 'calculo' })],
  invariantes: [
    'tipo_explicito',
    'entropia_criptografica_suficiente',
    'identidad_no_es_credencial'
  ]
});

export const PUERTO_KEYRING_FEDERACION = crearContratoPuerto({
  nombre: 'keyring',
  naturaleza: 'custodia_claves',
  metodos: [
    metodo('validarDisponibilidad', { efecto: 'calculo' }),
    metodo('obtenerClaveActiva', { secretos: 'salida_sensible' }),
    metodo('obtenerClavePorId', { secretos: 'salida_sensible' })
  ],
  invariantes: [
    'claves_fuera_de_payload',
    'identificador_no_revela_clave',
    'fallo_estructural_impide_actividad_federada'
  ]
});

export const PUERTO_CIFRADO_FEDERACION = crearContratoPuerto({
  nombre: 'cifrado',
  naturaleza: 'proteccion_contenido',
  metodos: [
    metodo('cifrar', {
      efecto: 'calculo',
      secretos: 'entrada_y_salida_sensibles'
    }),
    metodo('descifrar', {
      efecto: 'calculo',
      secretos: 'entrada_y_salida_sensibles'
    })
  ],
  invariantes: [
    'aad_canonico',
    'sobre_versionado',
    'sin_claves_en_errores_o_logs'
  ]
});

export const PUERTO_AUDITORIA_FEDERACION = crearContratoPuerto({
  nombre: 'auditoria',
  naturaleza: 'testimonio_local',
  metodos: [
    metodo('testimoniarEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    })
  ],
  invariantes: [
    'auditoria_no_es_motor_federacion',
    'auditoria_no_es_outbox_federada',
    'misma_transaccion_cuando_corresponda'
  ]
});

export const PUERTO_CONFIGURACION_FEDERACION = crearContratoPuerto({
  nombre: 'configuracion',
  naturaleza: 'lectura_configuracion_viva',
  metodos: [
    metodo('obtenerActual'),
    metodo('obtenerVersion')
  ],
  invariantes: [
    'verdad_durable_externa_al_nucleo',
    'version_monotona',
    'cambios_sin_reinicio'
  ]
});

export const PUERTO_REPOSITORIO_IDENTIDAD_FEDERACION = crearContratoPuerto({
  nombre: 'repositorioIdentidad',
  naturaleza: 'persistencia_identidad_instalacion',
  metodos: [
    metodo('obtenerIdentidadInstalacion'),
    metodo('registrarArranqueEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    }),
    metodo('listarArranquesConocidos')
  ],
  invariantes: [
    'installation_id_durable',
    'boot_id_compartido_por_arranque_logico',
    'sin_identidad_generada_por_proceso'
  ]
});

export const PUERTO_REPOSITORIO_CONTROL_FEDERACION = crearContratoPuerto({
  nombre: 'repositorioControl',
  naturaleza: 'persistencia_plano_control',
  metodos: [
    metodo('obtenerRelacion'),
    metodo('guardarRelacionEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    }),
    metodo('obtenerConcesionVigente'),
    metodo('guardarRevisionConcesionEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    })
  ],
  invariantes: [
    'relaciones_direccionales_independientes',
    'revisiones_concesion_inmutables',
    'secretos_separados_de_identidad'
  ]
});

export const PUERTO_REPOSITORIO_DATOS_FEDERACION = crearContratoPuerto({
  nombre: 'repositorioDatos',
  naturaleza: 'persistencia_plano_datos',
  metodos: [
    metodo('registrarOcurrenciaEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    }),
    metodo('buscarOcurrenciaPorIdentidad'),
    metodo('listarTrabajoPendiente'),
    metodo('registrarRecepcionEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    }),
    metodo('guardarResultadoEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    })
  ],
  invariantes: [
    'inbox_y_outbox_federadas_separadas',
    'ocurrencias_inmutables',
    'trabajo_recuperable_siempre_durable'
  ]
});

export const PUERTO_REPOSITORIO_PROYECCIONES_FEDERACION = crearContratoPuerto({
  nombre: 'repositorioProyecciones',
  naturaleza: 'persistencia_proyecciones_remotas',
  metodos: [
    metodo('obtenerProyeccion'),
    metodo('guardarMaterializacionEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    }),
    metodo('listarContribuciones')
  ],
  invariantes: [
    'persistencia_remota_separada',
    'materializacion_idempotente_por_proyeccion',
    'retirada_no_resucitable'
  ]
});

export const PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION = crearContratoPuerto({
  nombre: 'capturaTransaccional',
  naturaleza: 'registro_atomico_cambio_federable',
  metodos: [
    metodo('capturarEnTransaccion', {
      efecto: 'escritura',
      transaccion: 'requerida'
    })
  ],
  invariantes: [
    'misma_transaccion_que_mutacion_productora',
    'sin_red_durante_captura',
    'sin_commit_ni_rollback_propios',
    'no_reutiliza_outbox_auditoria'
  ]
});

export const PUERTO_PUBLICACION_EFIMERA_FEDERACION = crearContratoPuerto({
  nombre: 'publicacionEfimera',
  naturaleza: 'invalidacion_y_despertar_no_durable',
  metodos: [
    metodo('publicarInvalidacion', {
      efecto: 'publicacion',
      momento: 'despuesCommit'
    }),
    metodo('publicarDespertar', {
      efecto: 'publicacion',
      momento: 'despuesCommit'
    })
  ],
  invariantes: [
    'solo_referencias_saneadas',
    'nunca_trabajo_recuperable',
    'perdida_del_mensaje_no_pierde_trabajo'
  ]
});

export const PUERTOS_FEDERACION = Object.freeze({
  relojSql: PUERTO_RELOJ_SQL_FEDERACION,
  identidades: PUERTO_IDENTIDADES_FEDERACION,
  keyring: PUERTO_KEYRING_FEDERACION,
  cifrado: PUERTO_CIFRADO_FEDERACION,
  auditoria: PUERTO_AUDITORIA_FEDERACION,
  configuracion: PUERTO_CONFIGURACION_FEDERACION,
  repositorioIdentidad: PUERTO_REPOSITORIO_IDENTIDAD_FEDERACION,
  repositorioControl: PUERTO_REPOSITORIO_CONTROL_FEDERACION,
  repositorioDatos: PUERTO_REPOSITORIO_DATOS_FEDERACION,
  repositorioProyecciones: PUERTO_REPOSITORIO_PROYECCIONES_FEDERACION,
  capturaTransaccional: PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION,
  publicacionEfimera: PUERTO_PUBLICACION_EFIMERA_FEDERACION
});

export function obtenerContratoPuertoFederacion(nombre) {
  if (
    typeof nombre !== 'string' ||
    !Object.prototype.hasOwnProperty.call(PUERTOS_FEDERACION, nombre)
  ) {
    throw new ErrorPuertoFederacion(
      'puerto_desconocido',
      'El puerto solicitado no pertenece al perfil federado vigente.',
      { puerto: nombre }
    );
  }
  return PUERTOS_FEDERACION[nombre];
}

export function exigirImplementacionPuertoFederacion(nombre, implementacion) {
  const contrato = obtenerContratoPuertoFederacion(nombre);
  capturarMetodosPuertoFederacion(contrato, implementacion);
  return implementacion;
}

export function crearFachadaPuertoFederacion(nombre, implementacion) {
  const contrato = obtenerContratoPuertoFederacion(nombre);
  const metodos = capturarMetodosPuertoFederacion(contrato, implementacion);
  return Object.freeze(Object.fromEntries(metodos.map(([metodoPuerto, funcion]) => [
    metodoPuerto,
    (...argumentos) => Reflect.apply(funcion, implementacion, argumentos)
  ])));
}

function capturarMetodosPuertoFederacion(contrato, implementacion) {
  if (
    implementacion === null ||
    (typeof implementacion !== 'object' && typeof implementacion !== 'function')
  ) {
    throw new ErrorPuertoFederacion(
      'implementacion_puerto_invalida',
      `El puerto ${contrato.nombre} necesita una implementación.`,
      { puerto: contrato.nombre }
    );
  }
  const metodos = [];
  for (const entrada of contrato.metodos) {
    const funcion = obtenerMetodoDatos(implementacion, entrada.nombre);
    if (typeof funcion !== 'function') {
      throw new ErrorPuertoFederacion(
        'metodo_puerto_ausente',
        `El puerto ${contrato.nombre} no implementa ${entrada.nombre}.`,
        { puerto: contrato.nombre, metodo: entrada.nombre }
      );
    }
    metodos.push([entrada.nombre, funcion]);
  }
  return metodos;
}

function obtenerMetodoDatos(implementacion, nombre) {
  let propietario = implementacion;
  const visitados = new Set();
  while (propietario !== null) {
    if (visitados.has(propietario)) return undefined;
    visitados.add(propietario);
    const descriptor = Object.getOwnPropertyDescriptor(propietario, nombre);
    if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
    propietario = Object.getPrototypeOf(propietario);
  }
  return undefined;
}

function congelarProfundo(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  for (const descendiente of Object.values(valor)) {
    congelarProfundo(descendiente);
  }
  return Object.freeze(valor);
}
