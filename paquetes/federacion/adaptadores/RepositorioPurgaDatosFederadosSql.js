import { createHash } from 'node:crypto';

import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { FAMILIAS_FEDERACION } from '../src/CatalogosFederacion.js';

const FAMILIAS_PURGABLES = Object.freeze({
  estructuraOrganizativa: null,
  contextoOperativoAgentesSesiones: null,
  telemetria: Object.freeze({
    tabla: 'registros_telemetria_remotos',
    tipos: Object.freeze(['observacion', 'eventoDerivado'])
  }),
  monitores: Object.freeze({
    tabla: 'registros_monitores_remotos',
    tipos: Object.freeze(['evento', 'tramoHistorico']),
    condicionAdicional: Object.freeze({
      tipo: 'alerta',
      columna: 'estado_operativo',
      valor: 'cerrada'
    })
  }),
  triggersInformativos: Object.freeze({
    tabla: 'registros_triggers_informativos_remotos',
    tipos: Object.freeze(['ejecucionTerminada'])
  }),
  auditoria: null,
  avisosFederados: Object.freeze({
    tabla: 'registros_avisos_federados',
    tipos: Object.freeze(['transicion'])
  })
});

const DOMINIO_ANCLA_RETENCION_AUDITORIA = Buffer.from(
  'sentinelia-auditoria-federada-ancla-retencion-receptor-v1\0',
  'utf8'
);

export class ErrorPurgaDatosFederadosSql extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPurgaDatosFederadosSql';
    this.codigo = codigo;
  }
}

export class RepositorioPurgaDatosFederadosSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La purga federada requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async obtenerFechaSqlUtc() {
    const [fila] = await this.clienteSql.consultar(
      "SELECT DATE_FORMAT(UTC_DATE(),'%Y-%m-%d') AS fecha_utc"
    );
    return fila.fecha_utc;
  }

  async purgarLote({ relacionId, familia, limite = 250 } = {}) {
    const relacion = identidadRelacion(relacionId);
    const nombreFamilia = FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
    const cantidad = enteroAcotado(limite, 'limite', 1, 1000);
    const contrato = FAMILIAS_PURGABLES[nombreFamilia];
    return this.frontera.ejecutar(async (conexion) => {
      const politica = await obtenerPoliticaBloqueada(
        conexion,
        relacion,
        nombreFamilia
      );
      if (!politica) {
        fallar(
          'politica_retencion_inexistente',
          'La familia receptora no posee una política de retención materializada.'
        );
      }
      const fechaCorteUtc = fechaIso(politica.fecha_corte_utc);
      if (nombreFamilia === 'auditoria') {
        return recortarAuditoriaRemota({
          conexion,
          relacionId: relacion,
          politica,
          fechaCorteUtc,
          limite: cantidad
        });
      }
      if (!contrato) {
        return resultado({
          relacionId: relacion,
          familia: nombreFamilia,
          versionPolitica: politica.version_politica,
          fechaCorteUtc,
          eliminados: 0,
          hayMas: false,
          motivo: 'familia_sin_historico_purgable_17b'
        });
      }
      const candidatos = await seleccionarCandidatos({
        conexion,
        relacionId: relacion,
        familia: nombreFamilia,
        contrato,
        retencionEfectivaDias: politica.retencion_efectiva_dias,
        limite: cantidad
      });
      if (candidatos.length > 0) {
        await eliminarCandidatos(conexion, contrato.tabla, candidatos);
      }
      return resultado({
        relacionId: relacion,
        familia: nombreFamilia,
        versionPolitica: politica.version_politica,
        fechaCorteUtc,
        eliminados: candidatos.length,
        hayMas: candidatos.length === cantidad,
        motivo: candidatos.length === 0 ? 'sin_candidatos' : null
      });
    });
  }

  async purgarContenidoSensibleLote({ limite = 250 } = {}) {
    const cantidad = enteroAcotado(limite, 'limite', 1, 1000);
    return this.frontera.ejecutar(async (conexion) => {
      let restante = cantidad;
      const declaraciones = await seleccionarDeclaracionesSensiblesRetiradas(
        conexion,
        restante
      );
      if (declaraciones.length > 0) {
        await purgarDeclaracionesSensibles(conexion, declaraciones);
        restante -= declaraciones.length;
      }

      const inbox = restante > 0
        ? await seleccionarSobresInboxRetirados(conexion, restante)
        : [];
      let declaracionesPorRetiradaElemento = 0;
      if (inbox.length > 0) {
        declaracionesPorRetiradaElemento = await purgarSobresInbox(conexion, inbox);
        restante -= inbox.length;
      }

      const emision = restante > 0
        ? await seleccionarSobresEmisionRetirados(conexion, restante)
        : [];
      if (emision.length > 0) {
        await purgarSobresEmision(conexion, emision);
      }

      const unidadesConsumidas = declaraciones.length + inbox.length + emision.length;
      const totalDeclaraciones = declaraciones.length + declaracionesPorRetiradaElemento;
      const total = totalDeclaraciones + inbox.length + emision.length;
      return Object.freeze({
        declaracionesPurgadas: totalDeclaraciones,
        sobresInboxPurgados: inbox.length,
        sobresEmisionPurgados: emision.length,
        totalPurgados: total,
        hayMas: unidadesConsumidas === cantidad
      });
    });
  }
}

async function recortarAuditoriaRemota({
  conexion,
  relacionId,
  politica,
  fechaCorteUtc,
  limite
}) {
  const cadena = await seleccionarCadenaAuditoriaVencida(
    conexion,
    relacionId,
    politica.retencion_efectiva_dias
  );
  if (!cadena) {
    const noVerificables = await seleccionarAuditoriaNoVerificableVencida(
      conexion,
      relacionId,
      politica.retencion_efectiva_dias,
      limite
    );
    if (noVerificables.length > 0) {
      await purgarCustodiaAuditoria(conexion, noVerificables);
      await eliminarCandidatos(
        conexion,
        'registros_auditoria_remota',
        noVerificables
      );
    }
    return resultado({
      relacionId,
      familia: 'auditoria',
      versionPolitica: politica.version_politica,
      fechaCorteUtc,
      eliminados: noVerificables.length,
      hayMas: noVerificables.length === limite,
      motivo: noVerificables.length === 0
        ? 'sin_prefijo_auditoria_vencido'
        : 'eventos_no_verificables_retenidos'
    });
  }

  const filas = await leerCadenaAuditoriaBloqueada(
    conexion,
    cadena,
    politica.retencion_efectiva_dias,
    limite + 1
  );
  const retiradas = [];
  for (const fila of filas) {
    if (retiradas.length === limite || !Boolean(fila.vencida)) {
      break;
    }
    retiradas.push(fila);
  }
  if (retiradas.length === 0) {
    return resultado({
      relacionId,
      familia: 'auditoria',
      versionPolitica: politica.version_politica,
      fechaCorteUtc,
      eliminados: 0,
      hayMas: false,
      motivo: 'sin_prefijo_auditoria_vencido'
    });
  }

  const ultima = retiradas.at(-1);
  const anterior = await leerAnclaAuditoriaBloqueada(conexion, cadena);
  validarPrefijoAuditoria(retiradas, anterior);
  const conservadas = await leerSufijoAuditoria(conexion, cadena, ultima);
  const primeraConservada = conservadas[0] || null;
  const continuidad = evaluarContinuidadConservada(ultima, conservadas);
  const hashAnclaLocal = calcularAnclaRetencion({ anterior, cadena, retiradas });

  await purgarCustodiaAuditoria(conexion, retiradas);
  await eliminarCandidatos(conexion, 'registros_auditoria_remota', retiradas);
  await guardarAnclaAuditoria(conexion, {
    cadena,
    ultima,
    primeraConservada,
    continuidad,
    hashAnclaLocal,
    anterior,
    retiradas,
    politica
  });
  return resultado({
    relacionId,
    familia: 'auditoria',
    versionPolitica: politica.version_politica,
    fechaCorteUtc,
    eliminados: retiradas.length,
    hayMas: retiradas.length === limite,
    motivo: continuidad.estado
  });
}

async function seleccionarCadenaAuditoriaVencida(
  conexion,
  relacionId,
  retencionEfectivaDias
) {
  const [filas] = await conexion.execute(
    `SELECT r.generacion_id,p.installation_origen_id,r.clave_cadena_origen
       FROM registros_auditoria_remota r
       JOIN proyecciones_federacion p ON p.proyeccion_id=r.proyeccion_id
       JOIN generaciones_flujos_federacion g ON g.generacion_id=r.generacion_id
       JOIN fronteras_generaciones_federacion b ON b.generacion_id=g.generacion_id
       JOIN flujos_federacion f ON f.flujo_id=g.flujo_id
      WHERE f.relacion_id=? AND f.direccion='recepcion' AND f.familia='auditoria'
        AND r.clave_cadena_origen IS NOT NULL
        AND COALESCE(r.efectivo_en_origen_utc,r.registrado_en_origen_utc)
              <TIMESTAMPADD(DAY,-?,UTC_TIMESTAMP(3))
        AND g.estado IN ('completa','degradada','cancelada','sustituida')
        AND b.sincronizando=FALSE AND b.historicamente_completa=TRUE
        AND NOT EXISTS (
          SELECT 1
            FROM registros_auditoria_remota menor
            JOIN proyecciones_federacion pm
              ON pm.proyeccion_id=menor.proyeccion_id
           WHERE menor.generacion_id=r.generacion_id
             AND pm.installation_origen_id=p.installation_origen_id
             AND menor.clave_cadena_origen=r.clave_cadena_origen
             AND menor.secuencia_cadena_origen<r.secuencia_cadena_origen
        )
      ORDER BY COALESCE(r.efectivo_en_origen_utc,r.registrado_en_origen_utc),
               r.generacion_id,r.clave_cadena_origen
      LIMIT 1
      FOR UPDATE`,
    [relacionId, String(retencionEfectivaDias)]
  );
  return filas[0] || null;
}

async function leerCadenaAuditoriaBloqueada(
  conexion,
  cadena,
  retencionEfectivaDias,
  limite
) {
  const [filas] = await conexion.execute(
    `SELECT r.proyeccion_id,r.generacion_id,r.secuencia_elemento,
            r.inbox_ocurrencia_id,r.evento_origen_id,r.secuencia_cadena_origen,
            r.resultado_validacion_receptor,r.hash_anterior_origen,
            r.hash_actual_origen,r.hash_ancla_receptor,
            COALESCE(r.efectivo_en_origen_utc,r.registrado_en_origen_utc)
              <TIMESTAMPADD(DAY,-?,UTC_TIMESTAMP(3)) AS vencida
       FROM registros_auditoria_remota r
       JOIN proyecciones_federacion p ON p.proyeccion_id=r.proyeccion_id
      WHERE r.generacion_id=? AND p.installation_origen_id=?
        AND r.clave_cadena_origen=?
      ORDER BY r.secuencia_cadena_origen,r.evento_origen_id
      LIMIT ${limite}
      FOR UPDATE`,
    [String(retencionEfectivaDias),cadena.generacion_id,
      cadena.installation_origen_id,cadena.clave_cadena_origen]
  );
  return filas;
}

async function leerSufijoAuditoria(conexion, cadena, ultima) {
  const [filas] = await conexion.execute(
    `SELECT r.evento_origen_id,r.secuencia_cadena_origen,
            r.resultado_validacion_receptor,r.hash_anterior_origen,
            r.hash_actual_origen
       FROM registros_auditoria_remota r
       JOIN proyecciones_federacion p ON p.proyeccion_id=r.proyeccion_id
      WHERE r.generacion_id=? AND p.installation_origen_id=?
        AND r.clave_cadena_origen=? AND r.secuencia_cadena_origen>?
      ORDER BY r.secuencia_cadena_origen,r.evento_origen_id
      FOR UPDATE`,
    [cadena.generacion_id,cadena.installation_origen_id,
      cadena.clave_cadena_origen,String(ultima.secuencia_cadena_origen)]
  );
  return filas;
}

async function seleccionarAuditoriaNoVerificableVencida(
  conexion,
  relacionId,
  retencionEfectivaDias,
  limite
) {
  const [filas] = await conexion.execute(
    `SELECT r.proyeccion_id,r.generacion_id,r.secuencia_elemento,
            r.inbox_ocurrencia_id
       FROM registros_auditoria_remota r
       JOIN generaciones_flujos_federacion g ON g.generacion_id=r.generacion_id
       JOIN fronteras_generaciones_federacion b ON b.generacion_id=g.generacion_id
       JOIN flujos_federacion f ON f.flujo_id=g.flujo_id
      WHERE f.relacion_id=? AND f.direccion='recepcion' AND f.familia='auditoria'
        AND r.estado_verificabilidad_origen='noVerificable'
        AND COALESCE(r.efectivo_en_origen_utc,r.registrado_en_origen_utc)
              <TIMESTAMPADD(DAY,-?,UTC_TIMESTAMP(3))
        AND g.estado IN ('completa','degradada','cancelada','sustituida')
        AND b.sincronizando=FALSE AND b.historicamente_completa=TRUE
      ORDER BY COALESCE(r.efectivo_en_origen_utc,r.registrado_en_origen_utc),
               r.proyeccion_id,r.generacion_id,r.secuencia_elemento
      LIMIT ${limite}
      FOR UPDATE`,
    [relacionId,String(retencionEfectivaDias)]
  );
  return filas;
}

function evaluarContinuidadConservada(ultimaRetirada, conservadas) {
  if (conservadas.length === 0) {
    return { estado: 'sinContenidoConservado', causa: 'prefijoRetenidoSinSufijo' };
  }
  const secuenciaEsperada = BigInt(ultimaRetirada.secuencia_cadena_origen) + 1n;
  let hashAnterior = Buffer.from(ultimaRetirada.hash_actual_origen);
  let esperada = secuenciaEsperada;
  for (const fila of conservadas) {
    if (fila.resultado_validacion_receptor === 'invalida') {
      return { estado: 'invalida', causa: 'evidenciaOrigenInvalidaConservada' };
    }
    if (
      fila.resultado_validacion_receptor !== 'verificada' ||
      BigInt(fila.secuencia_cadena_origen) !== esperada ||
      !Buffer.from(fila.hash_anterior_origen).equals(hashAnterior)
    ) {
      return { estado: 'noVerificable', causa: 'continuidadConservadaIncompleta' };
    }
    esperada += 1n;
    hashAnterior = Buffer.from(fila.hash_actual_origen);
  }
  return { estado: 'verificadaDesdeAncla', causa: 'retencionReceptora' };
}

async function leerAnclaAuditoriaBloqueada(conexion, cadena) {
  const [filas] = await conexion.execute(
    `SELECT hash_ancla_local,hash_actual_ultimo_retirado,
            eventos_retirados_acumulados,ultima_secuencia_retirada
       FROM anclajes_retencion_auditoria_remota
      WHERE generacion_id=? AND installation_origen_id=?
        AND clave_cadena_origen=?
      FOR UPDATE`,
    [cadena.generacion_id,cadena.installation_origen_id,cadena.clave_cadena_origen]
  );
  return filas[0] || null;
}

function calcularAnclaRetencion({ anterior, cadena, retiradas }) {
  const hash = createHash('sha256')
    .update(DOMINIO_ANCLA_RETENCION_AUDITORIA)
    .update(cadena.generacion_id, 'ascii').update('\0')
    .update(cadena.installation_origen_id, 'ascii').update('\0')
    .update(cadena.clave_cadena_origen, 'ascii').update('\0')
    .update(anterior ? Buffer.from(anterior.hash_ancla_local) : Buffer.alloc(32));
  for (const fila of retiradas) {
    hash.update(String(fila.secuencia_cadena_origen), 'ascii').update('\0')
      .update(fila.evento_origen_id, 'ascii').update('\0')
      .update(Buffer.from(fila.hash_ancla_receptor));
  }
  return hash.digest();
}

async function guardarAnclaAuditoria(conexion, entrada) {
  const { cadena, ultima, primeraConservada, continuidad, anterior, politica } = entrada;
  await conexion.execute(
    `INSERT INTO anclajes_retencion_auditoria_remota (
       generacion_id,installation_origen_id,clave_cadena_origen,
       ultima_secuencia_retirada,ultimo_evento_retirado_id,
       hash_actual_ultimo_retirado,hash_ancla_local,
       primera_secuencia_conservada,primer_evento_conservado_id,
       estado_continuidad,causa_continuidad,eventos_retirados_acumulados,
       politica_dias,version_politica,aplicado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       ultima_secuencia_retirada=VALUES(ultima_secuencia_retirada),
       ultimo_evento_retirado_id=VALUES(ultimo_evento_retirado_id),
       hash_actual_ultimo_retirado=VALUES(hash_actual_ultimo_retirado),
       hash_ancla_local=VALUES(hash_ancla_local),
       primera_secuencia_conservada=VALUES(primera_secuencia_conservada),
       primer_evento_conservado_id=VALUES(primer_evento_conservado_id),
       estado_continuidad=VALUES(estado_continuidad),
       causa_continuidad=VALUES(causa_continuidad),
       eventos_retirados_acumulados=VALUES(eventos_retirados_acumulados),
       politica_dias=VALUES(politica_dias),
       version_politica=VALUES(version_politica),
       aplicado_en_utc=VALUES(aplicado_en_utc)`,
    [
      cadena.generacion_id,cadena.installation_origen_id,cadena.clave_cadena_origen,
      String(ultima.secuencia_cadena_origen),ultima.evento_origen_id,
      ultima.hash_actual_origen,entrada.hashAnclaLocal,
      primeraConservada ? String(primeraConservada.secuencia_cadena_origen) : null,
      primeraConservada?.evento_origen_id ?? null,
      continuidad.estado,continuidad.causa,
      (BigInt(anterior?.eventos_retirados_acumulados || 0) +
        BigInt(entrada.retiradas?.length || 0)).toString(),
      String(politica.retencion_efectiva_dias),String(politica.version_politica)
    ]
  );
}

async function purgarCustodiaAuditoria(conexion, filas) {
  const ids = [...new Set(filas.map((fila) => String(fila.inbox_ocurrencia_id)))];
  if (ids.length === 0) return;
  const marcas = ids.map(() => '?').join(',');
  await conexion.execute(
    `UPDATE declaraciones_campos_inbox_federacion
        SET perfil_custodia=NULL,keyring_referencia=NULL,key_id=NULL,
            nonce=NULL,ciphertext=NULL,auth_tag=NULL,
            causa_purga='retencionAuditoria',purgada_en_utc=UTC_TIMESTAMP(3)
      WHERE inbox_ocurrencia_id IN (${marcas})
        AND sensibilidad='sensible' AND ciphertext IS NOT NULL`,
    ids
  );
  await conexion.execute(
    `UPDATE conflictos_contenido_inbox_federacion c
       JOIN secretos_conflictos_inbox_federacion sc
         ON sc.conflicto_inbox_id=c.id
        SET c.contenido_observado_sha256=NULL,
            c.contenido_sensible_purgado_en_utc=UTC_TIMESTAMP(3)
     WHERE c.inbox_ocurrencia_id IN (${marcas})
       AND c.contenido_observado_sha256 IS NOT NULL`,
    ids
  );
  await conexion.execute(
    `DELETE sc FROM secretos_conflictos_inbox_federacion sc
      JOIN conflictos_contenido_inbox_federacion c
        ON c.id=sc.conflicto_inbox_id
     WHERE c.inbox_ocurrencia_id IN (${marcas})`,
    ids
  );
  await conexion.execute(
    `DELETE FROM secretos_inbox_federacion
      WHERE inbox_ocurrencia_id IN (${marcas})`,
    ids
  );
}

function validarPrefijoAuditoria(filas, anclaAnterior) {
  if (
    anclaAnterior &&
    (
      BigInt(filas[0].secuencia_cadena_origen) !==
        BigInt(anclaAnterior.ultima_secuencia_retirada) + 1n ||
      !Buffer.from(filas[0].hash_anterior_origen).equals(
        Buffer.from(anclaAnterior.hash_actual_ultimo_retirado)
      )
    )
  ) {
    fallar(
      'frontera_auditoria_remota_inconsistente',
      'La retención se detuvo porque el prefijo no continúa su anclaje local.'
    );
  }
  for (let indice = 1; indice < filas.length; indice += 1) {
    const anterior = filas[indice - 1];
    const actual = filas[indice];
    if (
      BigInt(actual.secuencia_cadena_origen) !==
        BigInt(anterior.secuencia_cadena_origen) + 1n ||
      !Buffer.from(actual.hash_anterior_origen).equals(
        Buffer.from(anterior.hash_actual_origen)
      )
    ) {
      fallar(
        'prefijo_auditoria_remota_inconsistente',
        'La retención se detuvo ante un prefijo remoto no consecutivo.'
      );
    }
  }
}

async function seleccionarDeclaracionesSensiblesRetiradas(conexion, limite) {
  const [filas] = await conexion.execute(
    `SELECT d.id,d.inbox_ocurrencia_id,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM eventos_soporte_campos_federacion er
                 WHERE er.declaracion_campo_id=d.id
                   AND er.tipo='retiradoContribucion'
              ) THEN 'retiradaContribucion'
              ELSE 'retiradaCampo'
            END AS causa_purga
       FROM declaraciones_campos_inbox_federacion d
       JOIN inbox_ocurrencias_federacion i ON i.id=d.inbox_ocurrencia_id
      WHERE d.sensibilidad='sensible' AND d.ciphertext IS NOT NULL
        AND i.familia<>'auditoria'
        AND NOT EXISTS (
          SELECT 1 FROM soportes_campos_contribuciones_federacion s
           WHERE s.declaracion_campo_id=d.id AND s.estado='activo'
        )
        AND EXISTS (
          SELECT 1
            FROM eventos_soporte_campos_federacion ea
           WHERE ea.declaracion_campo_id=d.id
             AND ea.tipo IN ('aportado','actualizado')
        )
        AND NOT EXISTS (
          SELECT 1
            FROM eventos_soporte_campos_federacion ea
           WHERE ea.declaracion_campo_id=d.id
             AND ea.tipo IN ('aportado','actualizado')
             AND NOT EXISTS (
               SELECT 1
                 FROM eventos_soporte_campos_federacion er
                WHERE er.contribucion_id=ea.contribucion_id
                  AND er.generacion_id=ea.generacion_id
                  AND er.nombre_sha256=ea.nombre_sha256
                  AND er.tipo IN ('retiradoCampo','retiradoContribucion')
                  AND er.secuencia_elemento>=ea.secuencia_elemento
             )
        )
      ORDER BY d.id
      LIMIT ${limite}
      FOR UPDATE`,
    []
  );
  return filas;
}

async function purgarDeclaracionesSensibles(conexion, filas) {
  for (const fila of filas) {
    const [resultadoSql] = await conexion.execute(
      `UPDATE declaraciones_campos_inbox_federacion
          SET perfil_custodia=NULL,keyring_referencia=NULL,key_id=NULL,
              nonce=NULL,ciphertext=NULL,auth_tag=NULL,
              causa_purga=?,purgada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND ciphertext IS NOT NULL`,
      [fila.causa_purga, String(fila.id)]
    );
    exigirUnaFila(resultadoSql, 'purga_declaracion_sensible_concurrente');
  }
}

async function seleccionarSobresInboxRetirados(conexion, limite) {
  const [filas] = await conexion.execute(
    `SELECT s.inbox_ocurrencia_id,
            EXISTS (
              SELECT 1 FROM soportes_campos_contribuciones_federacion c
               WHERE c.inbox_ocurrencia_id=i.id AND c.estado='activo'
            ) AS conserva_soporte_activo
       FROM secretos_inbox_federacion s
       JOIN inbox_ocurrencias_federacion i ON i.id=s.inbox_ocurrencia_id
      WHERE i.familia<>'auditoria'
        AND NOT EXISTS (
          SELECT 1 FROM trabajos_materializacion_federacion t
           WHERE t.inbox_ocurrencia_id=i.id
             AND t.estado IN ('pendiente','procesando','fallida')
        )
        AND (
          (
            EXISTS (
              SELECT 1 FROM declaraciones_campos_inbox_federacion d
               WHERE d.inbox_ocurrencia_id=i.id AND d.purgada_en_utc IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1
                FROM declaraciones_campos_inbox_federacion d
                JOIN soportes_campos_contribuciones_federacion c
                  ON c.declaracion_campo_id=d.id AND c.estado='activo'
               WHERE d.inbox_ocurrencia_id=i.id
                 AND d.sensibilidad='sensible' AND d.ciphertext IS NOT NULL
            )
          )
          OR
          (
          EXISTS (
            SELECT 1 FROM trabajos_materializacion_federacion t
             WHERE t.inbox_ocurrencia_id=i.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM trabajos_materializacion_federacion t
             WHERE t.inbox_ocurrencia_id=i.id
               AND NOT EXISTS (
                 SELECT 1
                   FROM tombstones_elementos_federacion x
                   JOIN watermarks_elementos_federacion w
                     ON w.relacion_id=x.relacion_id AND w.flujo_id=x.flujo_id
                    AND w.generacion_id=x.generacion_id
                    AND w.installation_origen_id=x.installation_origen_id
                    AND w.familia=x.familia
                    AND w.elemento_origen_id=x.elemento_origen_id
                  WHERE x.relacion_id=t.relacion_id AND x.flujo_id=t.flujo_id
                    AND x.installation_origen_id=t.installation_origen_id
                    AND x.familia=t.familia
                    AND x.elemento_origen_id=t.elemento_origen_id
                    AND x.secuencia_retirada>=t.secuencia_elemento
                    AND w.maxima_secuencia_materializada>=x.secuencia_retirada
               )
          )
          AND NOT EXISTS (
            SELECT 1 FROM soportes_campos_contribuciones_federacion c
             WHERE c.inbox_ocurrencia_id=i.id AND c.estado='activo'
          )
        )
      )
      ORDER BY s.inbox_ocurrencia_id
      LIMIT ${limite}
      FOR UPDATE`,
    []
  );
  return filas;
}

async function purgarSobresInbox(conexion, filas) {
  const ids = filas.map((fila) => String(fila.inbox_ocurrencia_id));
  const marcas = ids.map(() => '?').join(',');
  const [declaraciones] = await conexion.execute(
    `UPDATE declaraciones_campos_inbox_federacion
        SET perfil_custodia=NULL,keyring_referencia=NULL,key_id=NULL,
            nonce=NULL,ciphertext=NULL,auth_tag=NULL,
            causa_purga='retiradaElemento',purgada_en_utc=UTC_TIMESTAMP(3)
      WHERE inbox_ocurrencia_id IN (${marcas})
        AND sensibilidad='sensible' AND ciphertext IS NOT NULL`,
    ids
  );
  const idsSinSoporte = filas
    .filter((fila) => !Boolean(fila.conserva_soporte_activo))
    .map((fila) => String(fila.inbox_ocurrencia_id));
  if (idsSinSoporte.length > 0) {
    await eliminarRepresentacionesMaterializadasSensibles(
      conexion,
      idsSinSoporte,
      idsSinSoporte.map(() => '?').join(',')
    );
  }
  await conexion.execute(
    `UPDATE conflictos_contenido_inbox_federacion c
       JOIN secretos_conflictos_inbox_federacion sc
         ON sc.conflicto_inbox_id=c.id
        SET c.contenido_observado_sha256=NULL,
            c.contenido_sensible_purgado_en_utc=UTC_TIMESTAMP(3)
     WHERE c.inbox_ocurrencia_id IN (${marcas})
       AND c.contenido_observado_sha256 IS NOT NULL`,
    ids
  );
  await conexion.execute(
    `DELETE sc FROM secretos_conflictos_inbox_federacion sc
      JOIN conflictos_contenido_inbox_federacion c
        ON c.id=sc.conflicto_inbox_id
     WHERE c.inbox_ocurrencia_id IN (${marcas})`,
    ids
  );
  const [resultadoSql] = await conexion.execute(
    `DELETE FROM secretos_inbox_federacion
      WHERE inbox_ocurrencia_id IN (${marcas})`,
    ids
  );
  if (Number(resultadoSql.affectedRows) !== ids.length) {
    fallar(
      'purga_sobres_inbox_concurrente',
      'Los sobres inbox seleccionados dejaron de coincidir durante su purga.'
    );
  }
  return Number(declaraciones.affectedRows);
}

async function eliminarRepresentacionesMaterializadasSensibles(
  conexion,
  ids,
  marcas
) {
  const tablas = [
    'versiones_nodos_organizativos_remotos',
    'versiones_contexto_operativo_agentes_remotos',
    'registros_telemetria_remotos',
    'registros_monitores_remotos',
    'registros_triggers_informativos_remotos',
    'registros_avisos_federados'
  ];
  for (const tabla of tablas) {
    await conexion.execute(
      `DELETE FROM ${tabla} WHERE inbox_ocurrencia_id IN (${marcas})`,
      ids
    );
  }
}

async function seleccionarSobresEmisionRetirados(conexion, limite) {
  const [filas] = await conexion.execute(
    `SELECT s.ocurrencia_id
       FROM secretos_ocurrencias_federacion s
       JOIN ocurrencias_federacion o ON o.id=s.ocurrencia_id
      WHERE EXISTS (
          SELECT 1 FROM posiciones_ocurrencias_flujos_federacion p
           WHERE p.installation_origen_id=o.installation_origen_id
             AND p.familia=o.familia
             AND p.elemento_origen_id=o.elemento_origen_id
             AND p.ocurrencia_origen_id=o.ocurrencia_origen_id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM posiciones_ocurrencias_flujos_federacion p
            LEFT JOIN outbox_federacion b
              ON b.flujo_id=p.flujo_id AND b.generacion_id=p.generacion_id
             AND b.posicion_flujo=p.posicion_flujo
           WHERE p.installation_origen_id=o.installation_origen_id
             AND p.familia=o.familia
             AND p.elemento_origen_id=o.elemento_origen_id
             AND p.ocurrencia_origen_id=o.ocurrencia_origen_id
             AND (
               b.estado IS NULL OR b.estado<>'confirmada'
               OR NOT EXISTS (
                 SELECT 1
                   FROM posiciones_ocurrencias_flujos_federacion pr
                   JOIN ocurrencias_federacion r
                     ON r.installation_origen_id=pr.installation_origen_id
                    AND r.familia=pr.familia
                    AND r.elemento_origen_id=pr.elemento_origen_id
                    AND r.ocurrencia_origen_id=pr.ocurrencia_origen_id
                   JOIN outbox_federacion br
                     ON br.flujo_id=pr.flujo_id
                    AND br.generacion_id=pr.generacion_id
                    AND br.posicion_flujo=pr.posicion_flujo
                  WHERE pr.flujo_id=p.flujo_id
                    AND pr.installation_origen_id=p.installation_origen_id
                    AND pr.familia=p.familia
                    AND pr.elemento_origen_id=p.elemento_origen_id
                    AND r.operacion='retirada'
                    AND r.secuencia_elemento>o.secuencia_elemento
                    AND br.estado='confirmada'
               )
             )
        )
      ORDER BY s.ocurrencia_id
      LIMIT ${limite}
      FOR UPDATE`,
    []
  );
  return filas;
}

async function purgarSobresEmision(conexion, filas) {
  const ids = filas.map((fila) => String(fila.ocurrencia_id));
  const marcas = ids.map(() => '?').join(',');
  const [resultadoSql] = await conexion.execute(
    `DELETE FROM secretos_ocurrencias_federacion
      WHERE ocurrencia_id IN (${marcas})`,
    ids
  );
  if (Number(resultadoSql.affectedRows) !== ids.length) {
    fallar(
      'purga_sobres_emision_concurrente',
      'Los sobres de emisión seleccionados dejaron de coincidir durante su purga.'
    );
  }
}

function exigirUnaFila(resultadoSql, codigo) {
  if (Number(resultadoSql.affectedRows) !== 1) {
    fallar(codigo, 'La custodia sensible cambió durante su purga bloqueada.');
  }
}

async function obtenerPoliticaBloqueada(conexion, relacionId, familia) {
  const [filas] = await conexion.execute(
    `SELECT p.version_politica,p.retencion_efectiva_dias,
            TIMESTAMPADD(
              DAY,-p.retencion_efectiva_dias,UTC_TIMESTAMP(3)
            ) AS fecha_corte_utc
       FROM politicas_retencion_recepciones_federacion p
       JOIN relaciones_federacion r
         ON r.relacion_id=p.relacion_id AND r.direccion='recepcion'
      WHERE p.relacion_id=? AND p.familia=?
      FOR UPDATE`,
    [relacionId, familia]
  );
  return filas[0] || null;
}

async function seleccionarCandidatos({
  conexion,
  relacionId,
  familia,
  contrato,
  retencionEfectivaDias,
  limite
}) {
  const tipos = contrato.tipos.map(() => '?').join(',');
  const condicionTipo = contrato.condicionAdicional
    ? `(d.tipo_registro IN (${tipos}) OR (` +
      `d.tipo_registro=? AND d.${contrato.condicionAdicional.columna}=?))`
    : `d.tipo_registro IN (${tipos})`;
  const parametrosTipo = contrato.condicionAdicional
    ? [
        ...contrato.tipos,
        contrato.condicionAdicional.tipo,
        contrato.condicionAdicional.valor
      ]
    : contrato.tipos;
  const [filas] = await conexion.execute(
    `SELECT d.proyeccion_id,d.generacion_id,d.secuencia_elemento
       FROM ${contrato.tabla} d
       JOIN generaciones_flujos_federacion g
         ON g.generacion_id=d.generacion_id
       JOIN fronteras_generaciones_federacion b
         ON b.generacion_id=g.generacion_id
       JOIN flujos_federacion f
         ON f.flujo_id=g.flujo_id
      WHERE f.relacion_id=? AND f.direccion='recepcion' AND f.familia=?
        AND d.estado_registro='presente'
        AND ${condicionTipo}
        AND d.tiempo_dato_utc IS NOT NULL
        AND d.tiempo_dato_utc<TIMESTAMPADD(DAY,-?,UTC_TIMESTAMP(3))
        AND NOT (f.generacion_activa_id<=>d.generacion_id)
        AND g.estado IN ('completa','degradada','cancelada','sustituida')
        AND b.sincronizando=FALSE AND b.historicamente_completa=TRUE
        AND NOT EXISTS (
          SELECT 1
            FROM versiones_proyecciones_federacion v
           WHERE v.proyeccion_id=d.proyeccion_id
             AND v.generacion_id=d.generacion_id
             AND v.estado_publicacion IN ('preparando','actual')
             AND v.estado_soporte='sostenida'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM soportes_campos_contribuciones_federacion s
           WHERE s.inbox_ocurrencia_id=d.inbox_ocurrencia_id
             AND s.estado='activo'
        )
        AND NOT EXISTS (
          SELECT 1
            FROM campos_versiones_proyecciones_federacion c
            JOIN versiones_proyecciones_federacion v
              ON v.proyeccion_id=c.proyeccion_id
             AND v.generacion_id=c.generacion_id
           WHERE c.inbox_ocurrencia_id=d.inbox_ocurrencia_id
             AND c.total_soportes_activos>=1
             AND v.estado_publicacion IN ('preparando','actual')
        )
      ORDER BY d.tiempo_dato_utc,d.proyeccion_id,
               d.generacion_id,d.secuencia_elemento
      LIMIT ${limite}
      FOR UPDATE`,
    [relacionId, familia, ...parametrosTipo, String(retencionEfectivaDias)]
  );
  return filas;
}

async function eliminarCandidatos(conexion, tabla, candidatos) {
  const predicado = candidatos.map(() =>
    '(proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?)'
  ).join(' OR ');
  const parametros = candidatos.flatMap((fila) => [
    fila.proyeccion_id,
    fila.generacion_id,
    String(fila.secuencia_elemento)
  ]);
  const [resultadoSql] = await conexion.execute(
    `DELETE FROM ${tabla} WHERE ${predicado}`,
    parametros
  );
  if (Number(resultadoSql.affectedRows) !== candidatos.length) {
    fallar(
      'purga_federada_concurrente',
      'La selección bloqueada y la eliminación federada dejaron de coincidir.'
    );
  }
}

function resultado({
  relacionId,
  familia,
  versionPolitica,
  fechaCorteUtc,
  eliminados,
  hayMas,
  motivo
}) {
  return Object.freeze({
    relacionId,
    familia,
    versionPolitica: String(versionPolitica),
    fechaCorteUtc,
    eliminados,
    hayMas,
    motivo
  });
}

function identidadRelacion(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.RELACION,
      valor: String(valor || '')
    }));
  } catch {
    fallar('relacion_invalida', 'relacionId no es una identidad federada válida.');
  }
}

function enteroAcotado(valor, campo, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    fallar('limite_purga_invalido', `${campo} debe estar entre ${minimo} y ${maximo}.`);
  }
  return numero;
}

function fechaIso(valor) {
  return new Date(valor).toISOString();
}

function fallar(codigo, mensaje) {
  throw new ErrorPurgaDatosFederadosSql(codigo, mensaje);
}
