const TIPOS_TOKEN = Object.freeze({
  VARIABLE: 'variable',
  OPERADOR: 'operador',
  PARENTESIS_ABRE: 'parentesis_abre',
  PARENTESIS_CIERRA: 'parentesis_cierra',
  FIN: 'fin'
});

const OPERADORES_BINARIOS = new Set(['AND', 'OR']);

export function analizarExpresionMonitorLogico(expresion, variablesDisponibles = []) {
  const tokens = tokenizarExpresion(expresion);
  const parser = new ParserExpresionMonitorLogico(tokens);
  const ast = parser.parsear();
  const variablesUsadas = [...new Set(extraerVariablesAst(ast))].sort();
  const variablesPermitidas = normalizarVariablesDisponibles(variablesDisponibles);
  const variablesNoDefinidas = variablesUsadas.filter(
    (variable) => !variablesPermitidas.has(variable)
  );

  if (variablesNoDefinidas.length > 0) {
    throw new Error(
      `Variable no definida en la expresión lógica: ${variablesNoDefinidas.join(', ')}.`
    );
  }

  return {
    ast,
    variablesUsadas,
    expresionNormalizada: serializarAst(ast)
  };
}

export function evaluarExpresionMonitorLogico(expresion, valoresVariables = {}) {
  const variablesDisponibles = Object.keys(
    valoresVariables && typeof valoresVariables === 'object'
      ? valoresVariables
      : {}
  );
  const analisis = analizarExpresionMonitorLogico(expresion, variablesDisponibles);

  return evaluarAst(analisis.ast, valoresVariables);
}

export function tokenizarExpresion(expresion) {
  const texto = String(expresion || '').trim();

  if (!texto) {
    throw new Error('La expresión lógica no puede estar vacía.');
  }

  const tokens = [];
  let indice = 0;

  while (indice < texto.length) {
    const caracter = texto[indice];

    if (/\s/.test(caracter)) {
      indice += 1;
      continue;
    }

    if (caracter === '(') {
      tokens.push({ tipo: TIPOS_TOKEN.PARENTESIS_ABRE, valor: '(' });
      indice += 1;
      continue;
    }

    if (caracter === ')') {
      tokens.push({ tipo: TIPOS_TOKEN.PARENTESIS_CIERRA, valor: ')' });
      indice += 1;
      continue;
    }

    if (caracter === '!') {
      tokens.push({ tipo: TIPOS_TOKEN.OPERADOR, valor: 'NOT' });
      indice += 1;
      continue;
    }

    if (caracter === '+') {
      tokens.push({ tipo: TIPOS_TOKEN.OPERADOR, valor: 'OR' });
      indice += 1;
      continue;
    }

    if (caracter === '*') {
      tokens.push({ tipo: TIPOS_TOKEN.OPERADOR, valor: 'AND' });
      indice += 1;
      continue;
    }

    if (/[a-zA-Z_]/.test(caracter)) {
      const inicio = indice;
      indice += 1;

      while (indice < texto.length && /[a-zA-Z0-9_]/.test(texto[indice])) {
        indice += 1;
      }

      const valorOriginal = texto.slice(inicio, indice);
      const valorNormalizado = valorOriginal.toUpperCase();

      if (['AND', 'OR', 'NOT'].includes(valorNormalizado)) {
        tokens.push({ tipo: TIPOS_TOKEN.OPERADOR, valor: valorNormalizado });
      } else {
        tokens.push({ tipo: TIPOS_TOKEN.VARIABLE, valor: valorNormalizado });
      }

      continue;
    }

    throw new Error(
      `Carácter no permitido en la expresión lógica: "${caracter}".`
    );
  }

  tokens.push({ tipo: TIPOS_TOKEN.FIN, valor: '' });
  return tokens;
}

class ParserExpresionMonitorLogico {
  constructor(tokens) {
    this.tokens = tokens;
    this.indice = 0;
  }

  parsear() {
    const ast = this.parsearOr();

    if (this.tokenActual().tipo !== TIPOS_TOKEN.FIN) {
      if (this.tokenActual().tipo === TIPOS_TOKEN.PARENTESIS_CIERRA) {
        throw new Error('Sobra un paréntesis de cierre en la expresión lógica.');
      }

      throw new Error('La expresión lógica contiene tokens inesperados.');
    }

    return ast;
  }

  parsearOr() {
    let nodo = this.parsearAnd();

    while (this.esOperadorActual('OR')) {
      this.consumir();
      nodo = {
        tipo: 'operador',
        operador: 'OR',
        izquierda: nodo,
        derecha: this.parsearAnd()
      };
    }

    return nodo;
  }

  parsearAnd() {
    let nodo = this.parsearNot();

    while (this.esOperadorActual('AND')) {
      this.consumir();
      nodo = {
        tipo: 'operador',
        operador: 'AND',
        izquierda: nodo,
        derecha: this.parsearNot()
      };
    }

    return nodo;
  }

  parsearNot() {
    if (this.esOperadorActual('NOT')) {
      this.consumir();
      return {
        tipo: 'negacion',
        valor: this.parsearNot()
      };
    }

    return this.parsearPrimario();
  }

  parsearPrimario() {
    const token = this.tokenActual();

    if (token.tipo === TIPOS_TOKEN.VARIABLE) {
      this.consumir();
      return {
        tipo: 'variable',
        nombre: token.valor
      };
    }

    if (token.tipo === TIPOS_TOKEN.PARENTESIS_ABRE) {
      this.consumir();
      const nodo = this.parsearOr();

      if (this.tokenActual().tipo !== TIPOS_TOKEN.PARENTESIS_CIERRA) {
        throw new Error('Falta cerrar un paréntesis en la expresión lógica.');
      }

      this.consumir();
      return nodo;
    }

    if (token.tipo === TIPOS_TOKEN.OPERADOR) {
      const operador = token.valor;
      if (OPERADORES_BINARIOS.has(operador)) {
        throw new Error(`Operador duplicado o sin variable antes de ${operador}.`);
      }
    }

    if (token.tipo === TIPOS_TOKEN.FIN) {
      throw new Error('La expresión lógica termina de forma incompleta.');
    }

    throw new Error('Se esperaba una variable o un paréntesis en la expresión lógica.');
  }

  esOperadorActual(operador) {
    const token = this.tokenActual();
    return token.tipo === TIPOS_TOKEN.OPERADOR && token.valor === operador;
  }

  tokenActual() {
    return this.tokens[this.indice];
  }

  consumir() {
    this.indice += 1;
  }
}

function normalizarVariablesDisponibles(variablesDisponibles) {
  return new Set(
    (Array.isArray(variablesDisponibles) ? variablesDisponibles : [])
      .map((variable) => {
        if (typeof variable === 'string') {
          return variable;
        }

        return variable?.nombre || variable?.variable || variable?.clave || '';
      })
      .map((variable) => String(variable || '').trim().toUpperCase())
      .filter(Boolean)
  );
}

function extraerVariablesAst(ast) {
  if (!ast) {
    return [];
  }

  if (ast.tipo === 'variable') {
    return [ast.nombre];
  }

  if (ast.tipo === 'negacion') {
    return extraerVariablesAst(ast.valor);
  }

  return [
    ...extraerVariablesAst(ast.izquierda),
    ...extraerVariablesAst(ast.derecha)
  ];
}

function serializarAst(ast) {
  return serializarAstConPrecedencia(ast, 0);
}

function serializarAstConPrecedencia(ast, precedenciaPadre) {
  if (ast.tipo === 'variable') {
    return ast.nombre;
  }

  if (ast.tipo === 'negacion') {
    const valor = serializarAstConPrecedencia(ast.valor, 0);
    return ast.valor?.tipo === 'variable' ? `NOT ${valor}` : `NOT (${valor})`;
  }

  const precedencia = ast.operador === 'AND' ? 2 : 1;
  const izquierda = serializarAstConPrecedencia(ast.izquierda, precedencia);
  const derecha = serializarAstConPrecedencia(ast.derecha, precedencia + 1);
  const expresion = `${izquierda} ${ast.operador} ${derecha}`;

  return precedencia < precedenciaPadre ? `(${expresion})` : expresion;
}

function evaluarAst(ast, valoresVariables) {
  if (ast.tipo === 'variable') {
    return Boolean(valoresVariables[ast.nombre]);
  }

  if (ast.tipo === 'negacion') {
    return !evaluarAst(ast.valor, valoresVariables);
  }

  if (ast.operador === 'AND') {
    return evaluarAst(ast.izquierda, valoresVariables) &&
      evaluarAst(ast.derecha, valoresVariables);
  }

  return evaluarAst(ast.izquierda, valoresVariables) ||
    evaluarAst(ast.derecha, valoresVariables);
}
