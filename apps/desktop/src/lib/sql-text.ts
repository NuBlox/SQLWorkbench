export interface SqlSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

type SqlState = "normal" | "single" | "double" | "backtick" | "line-comment" | "block-comment";

export function splitSqlScript(sql: string): readonly SqlSegment[] {
  const segments: SqlSegment[] = [];
  let state: SqlState = "normal";
  let statementStart = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (state === "line-comment") {
      if (character === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }

    if (state === "single" || state === "double" || state === "backtick") {
      const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (character === "\\" && state !== "backtick") {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (next === quote) {
          index += 1;
          continue;
        }
        state = "normal";
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      state = character === "'" ? "single" : character === '"' ? "double" : "backtick";
      continue;
    }

    if (character === "#") {
      state = "line-comment";
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }

    if (character === ";") {
      pushSegment(sql, statementStart, index, segments);
      statementStart = index + 1;
    }
  }

  pushSegment(sql, statementStart, sql.length, segments);
  return segments;
}

export function statementAtOffset(sql: string, offset: number): SqlSegment | undefined {
  const bounded = Math.max(0, Math.min(sql.length, offset));
  const segments = splitSqlScript(sql);
  if (segments.length === 0) return undefined;

  const containing = segments.find((segment) => bounded >= segment.start && bounded <= segment.end + 1);
  if (containing) return containing;

  const next = segments.find((segment) => segment.start > bounded);
  return next ?? segments[segments.length - 1];
}

function pushSegment(
  source: string,
  rawStart: number,
  rawEnd: number,
  target: SqlSegment[],
): void {
  let start = rawStart;
  let end = rawEnd;

  while (start < end && isWhitespace(source[start]!)) start += 1;
  while (end > start && isWhitespace(source[end - 1]!)) end -= 1;

  if (start >= end) return;
  target.push({ text: source.slice(start, end), start, end });
}

function isWhitespace(value: string): boolean {
  return /\s/u.test(value);
}
