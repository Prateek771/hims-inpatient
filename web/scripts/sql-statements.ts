/**
 * Splits a MariaDB script into single statements, honouring `DELIMITER x` directives (the client-side
 * command the .sql files use around triggers and functions), quotes and comments.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let delimiter = ";";
  let buffer = "";
  let i = 0;
  const flush = () => {
    const text = buffer.trim();
    if (text) statements.push(text);
    buffer = "";
  };
  while (i < script.length) {
    const rest = script.slice(i);
    const atLineStart = i === 0 || script[i - 1] === "\n";
    const directive = atLineStart && buffer.trim() === "" ? /^delimiter[ \t]+(\S+)[ \t]*(?:\r?\n|$)/i.exec(rest) : null;
    if (directive) {
      delimiter = directive[1];
      i += directive[0].length;
      continue;
    }
    const c = script[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < script.length && script[j] !== c) j += script[j] === "\\" && c !== "`" ? 2 : 1;
      buffer += script.slice(i, j + 1);
      i = j + 1;
    } else if (rest.startsWith("--") && /^--(\s|$)/.test(rest)) {
      const end = script.indexOf("\n", i);
      const stop = end === -1 ? script.length : end;
      // Comment text is kept out of the statement; the newline still separates tokens.
      i = stop;
    } else if (c === "#") {
      const end = script.indexOf("\n", i);
      i = end === -1 ? script.length : end;
    } else if (rest.startsWith("/*")) {
      const end = script.indexOf("*/", i + 2);
      if (end === -1) throw new Error("Unterminated comment in SQL script");
      i = end + 2;
    } else if (rest.startsWith(delimiter)) {
      flush();
      i += delimiter.length;
    } else {
      buffer += c;
      i += 1;
    }
  }
  if (buffer.trim()) flush();
  return statements;
}
