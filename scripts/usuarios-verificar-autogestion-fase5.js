import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioEmailPerfil } from '../paquetes/usuarios/src/ServicioEmailPerfil.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  await verificarValidacionYResultados();
  await verificarConflictosYErrores();
  await verificarPersistenciaSqlReal();

  console.log(
    '[usuarios] Fase 5 de autogestión verificada: email durable y no validado.'
  );
}

async function verificarValidacionYResultados() {
  const repositorio = new RepositorioEmailMemoria({
    email: 'Actual@example.test',
    emailValidado: true
  });
  const servicio = new ServicioEmailPerfil({ repositorioUsuarios: repositorio });

  const sinCambios = await servicio.establecerEmailNoValidado({
    idUsuario: 7,
    email: '  Actual@Example.test  '
  });
  assert.equal(sinCambios.codigo, 'email_sin_cambios');
  assert.equal(sinCambios.datos.modificado, false);
  assert.equal(sinCambios.datos.email_validado, true);
  assert.equal(repositorio.actualizaciones, 0);

  const actualizado = await servicio.establecerEmailNoValidado({
    idUsuario: 7,
    email: '  Nuevo.Email@Example.test  '
  });
  assert.equal(actualizado.codigo, 'email_actualizado_no_validado');
  assert.equal(actualizado.datos.email, 'Nuevo.Email@example.test');
  assert.equal(actualizado.datos.email_validado, false);
  assert.equal(repositorio.usuario.email, 'Nuevo.Email@example.test');
  assert.equal(repositorio.usuario.emailValidado, false);
  assert.equal(repositorio.actualizaciones, 1);

  for (const email of [
    null,
    42,
    '',
    '   ',
    'sin-arroba.example.test',
    '@example.test',
    'usuario@',
    'usuario@example',
    `${'a'.repeat(186)}@b.co`
  ]) {
    await assert.rejects(
      servicio.establecerEmailNoValidado({ idUsuario: 7, email }),
      (error) => {
        assert.equal(error.codigo, 'valor_invalido');
        assert.equal(error.datos.errores[0].campo, 'email');
        return true;
      }
    );
  }
  assert.equal(repositorio.actualizaciones, 1);
}

async function verificarConflictosYErrores() {
  const usuario = crearUsuarioEmail({
    email: 'actual@example.test',
    emailValidado: true
  });
  const servicioConflicto = new ServicioEmailPerfil({
    repositorioUsuarios: {
      async buscarPorId() {
        return usuario;
      },
      async actualizarEmailNoValidado() {
        return { estado: 'conflicto' };
      }
    }
  });

  await assert.rejects(
    servicioConflicto.establecerEmailNoValidado({
      idUsuario: 7,
      email: 'nuevo@example.test'
    }),
    (error) => {
      assert.equal(error.codigo, 'operacion_email_en_conflicto');
      assert.equal(error.estadoHttp, 409);
      return true;
    }
  );

  let intentoSql = false;
  const servicioInactivo = new ServicioEmailPerfil({
    repositorioUsuarios: {
      async buscarPorId() {
        return { ...usuario, activo: false };
      },
      async actualizarEmailNoValidado() {
        intentoSql = true;
      }
    }
  });
  await assert.rejects(
    servicioInactivo.establecerEmailNoValidado({
      idUsuario: 7,
      email: 'nuevo@example.test'
    }),
    (error) => error.codigo === 'sesion_no_vigente'
  );
  assert.equal(intentoSql, false);

  const servicioFalloSql = new ServicioEmailPerfil({
    repositorioUsuarios: {
      async buscarPorId() {
        return usuario;
      },
      async actualizarEmailNoValidado() {
        throw new Error('SQL no disponible');
      }
    }
  });
  await assert.rejects(
    servicioFalloSql.establecerEmailNoValidado({
      idUsuario: 7,
      email: 'nuevo@example.test'
    }),
    /SQL no disponible/
  );
}

async function verificarPersistenciaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorio = new RepositorioUsuarios(clienteSql);
  const servicio = new ServicioEmailPerfil({ repositorioUsuarios: repositorio });
  const sufijo = crypto.randomUUID().replaceAll('-', '');
  const loginOrigen = `fase5_origen_${sufijo}`;
  const loginDuplicado = `fase5_duplicado_${sufijo}`;
  const emailOriginal = `${loginOrigen}@example.test`;
  const emailDuplicado = `${loginDuplicado}@example.test`;
  const ids = [];

  try {
    for (const [usuario, email, emailValidado] of [
      [loginOrigen, emailOriginal, 1],
      [loginDuplicado, emailDuplicado, 0]
    ]) {
      const [insercion] = await clienteSql.ejecutar(
        `
          INSERT INTO usuarios (
            usuario,
            email,
            email_validado,
            hash_password,
            nombre_mostrar,
            nombre_completo,
            version_sesion
          ) VALUES (?, ?, ?, ?, ?, ?, 3)
        `,
        [
          usuario,
          email,
          emailValidado,
          'hash-intacto-fase5',
          'Nombre visible intacto',
          'Nombre completo intacto'
        ]
      );
      ids.push(Number(insercion.insertId));
    }

    const sinCambiosValidado = await servicio.establecerEmailNoValidado({
      idUsuario: ids[0],
      email: emailOriginal
    });
    assert.equal(sinCambiosValidado.codigo, 'email_sin_cambios');
    assert.equal(sinCambiosValidado.datos.email_validado, true);

    const aplicado = await servicio.establecerEmailNoValidado({
      idUsuario: ids[0],
      email: `  ${emailDuplicado}  `
    });
    assert.equal(aplicado.codigo, 'email_actualizado_no_validado');

    const persistido = await repositorio.buscarPorId(ids[0]);
    assert.equal(persistido.email, emailDuplicado);
    assert.equal(persistido.emailValidado, false);
    assert.equal(persistido.hashPassword, 'hash-intacto-fase5');
    assert.equal(persistido.nombreMostrar, 'Nombre visible intacto');
    assert.equal(persistido.nombreCompleto, 'Nombre completo intacto');
    assert.equal(persistido.versionSesion, 3);

    const repetido = await servicio.establecerEmailNoValidado({
      idUsuario: ids[0],
      email: emailDuplicado
    });
    assert.equal(repetido.codigo, 'email_sin_cambios');
    assert.equal(repetido.datos.email_validado, false);

    const emailAdministrativo = `admin_${sufijo}@example.test`;
    await clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET email = ?, email_validado = 1
        WHERE id = ?
      `,
      [emailAdministrativo, ids[0]]
    );
    const conflicto = await repositorio.actualizarEmailNoValidado({
      idUsuario: ids[0],
      emailActual: emailDuplicado,
      emailNuevo: `posterior_${sufijo}@example.test`
    });
    assert.equal(conflicto.estado, 'conflicto');

    const posterior = await repositorio.buscarPorId(ids[0]);
    assert.equal(posterior.email, emailAdministrativo);
    assert.equal(posterior.emailValidado, true);
  } finally {
    for (const [indice, idUsuario] of ids.entries()) {
      await clienteSql.ejecutar(
        'DELETE FROM usuarios WHERE id = ? AND usuario = ?',
        [idUsuario, indice === 0 ? loginOrigen : loginDuplicado]
      );
    }

    await clienteSql.cerrar();
  }
}

class RepositorioEmailMemoria {
  constructor({ email, emailValidado }) {
    this.usuario = crearUsuarioEmail({ email, emailValidado });
    this.actualizaciones = 0;
  }

  async buscarPorId() {
    return this.usuario;
  }

  async actualizarEmailNoValidado({
    idUsuario,
    emailActual,
    emailNuevo
  }) {
    assert.equal(idUsuario, 7);

    if (this.usuario.email !== emailActual) {
      return { estado: 'conflicto' };
    }

    if (this.usuario.email === emailNuevo) {
      return {
        estado: 'sin_cambios',
        emailValidado: this.usuario.emailValidado
      };
    }

    this.actualizaciones += 1;
    this.usuario = crearUsuarioEmail({
      email: emailNuevo,
      emailValidado: false
    });
    return { estado: 'actualizado' };
  }
}

function crearUsuarioEmail({ email, emailValidado }) {
  return {
    id: 7,
    activo: true,
    email,
    emailValidado
  };
}

main().catch((error) => {
  console.error('[usuarios] Falló la verificación de la fase 5 de autogestión.');
  console.error(error);
  process.exit(1);
});
