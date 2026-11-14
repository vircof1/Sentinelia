import assert from 'node:assert/strict';

import {
  ENUMS_CERRADOS_POR_TIPO
} from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import {
  validarEventoAuditableV1
} from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import {
  construirIntencionAuditoriaReinicioPasswordAdministrativo
} from '../paquetes/usuarios/src/EventosAuditoriaReinicioPasswordAdministrativo.js';

const EVENTO_ID = '018f5f3c-7b21-7c22-8f11-111111111111';
const REINICIO_ID = '018f5f3c-7b21-7c22-8f11-222222222222';
const FECHA = '2026-09-08T18:00:00.000Z';

verificarCompatibilidadCatalogo();
verificarActuacionDirecta();
verificarImpersonacion();
verificarMinimizacionEstrica();

console.log(
  '[usuarios] OK 5.30a.2a: credencial_v1=compatible ' +
  'causas=manual_correo actores=real_efectivo scope=historico ' +
  'correlacion=reinicio_id secretos=ausentes'
);

function verificarCompatibilidadCatalogo() {
  assert.deepEqual(
    ENUMS_CERRADOS_POR_TIPO['usuario.password_reiniciado'].causa,
    [
      'administrador',
      'administrador_via_correo',
      'administrador_via_manual'
    ]
  );
  for (const causa of ENUMS_CERRADOS_POR_TIPO['usuario.password_reiniciado'].causa) {
    assert.doesNotThrow(() => validarEventoAuditableV1({
      tipo: 'usuario.password_reiniciado',
      versionContrato: 1,
      actor: 'usuario',
      origen: 'web',
      sujeto: { tipo: 'usuario', id: '31' },
      flujo: 'usuarios',
      productor: 'portal_web',
      rolEvento: 'principal',
      payload: { operacion: 'reinicio', resultado: 'reiniciada', causa }
    }));
  }
}

function verificarActuacionDirecta() {
  const intencion = construir('manual', {
    idUsuario: 7,
    idUsuarioReal: null,
    impersonacionActiva: false
  });
  assert.deepEqual(intencion.actorReal, { tipo: 'usuario', id: '7' });
  assert.equal(intencion.actorEfectivo, null);
  assert.equal(intencion.modoActuacion, 'directo');
  assert.equal(intencion.payload.causa, 'administrador_via_manual');
  assert.equal(intencion.correlacionId, REINICIO_ID);
  assert.deepEqual(intencion.scope, {
    tenantId: '4',
    empresaId: '8',
    sitioId: null
  });
  assert.equal(Object.isFrozen(intencion), true);
  assert.equal(Object.isFrozen(intencion.payload), true);
}

function verificarImpersonacion() {
  const intencion = construir('correo', {
    idUsuario: 9,
    idUsuarioReal: 3,
    impersonacionActiva: true
  });
  assert.deepEqual(intencion.actorReal, { tipo: 'usuario', id: '3' });
  assert.deepEqual(intencion.actorEfectivo, { tipo: 'usuario', id: '9' });
  assert.equal(intencion.modoActuacion, 'impersonado');
  assert.equal(intencion.payload.causa, 'administrador_via_correo');
  assert.equal(intencion.sujeto.id, '31');
}

function verificarMinimizacionEstrica() {
  for (const campo of ['password', 'hashPassword', 'email', 'cuerpo']) {
    assert.throws(
      () => construirIntencionAuditoriaReinicioPasswordAdministrativo({
        ...entrada('manual', {
          idUsuario: 7,
          idUsuarioReal: null,
          impersonacionActiva: false
        }),
        [campo]: 'secreto@example.test'
      }),
      /exige exactamente/iu
    );
  }
  const serializada = JSON.stringify(construir('correo', {
    idUsuario: 7,
    idUsuarioReal: null,
    impersonacionActiva: false
  }).payload);
  for (const marca of ['password', 'hashPassword', 'email', 'cuerpo']) {
    assert.equal(serializada.includes(marca), false);
  }
}

function construir(via, contextoUsuarioActual) {
  return construirIntencionAuditoriaReinicioPasswordAdministrativo(
    entrada(via, contextoUsuarioActual)
  );
}

function entrada(via, contextoUsuarioActual) {
  return {
    contextoUsuarioActual,
    efectivoEnUtc: FECHA,
    eventoId: EVENTO_ID,
    reinicioId: REINICIO_ID,
    scope: { tenantId: 4, empresaId: 8, sitioId: null },
    usuarioId: 31,
    via
  };
}
