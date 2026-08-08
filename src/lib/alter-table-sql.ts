import type { DriverType } from "@/types";
import { quoteIdent } from "./sql-utils";

export type DraftStatus = "existing" | "added" | "modified" | "removed";

export interface DraftColumn {
  _id: string;
  _status: DraftStatus;
  name: string;
  originalName?: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  originalDataType?: string;
  originalNullable?: boolean;
  originalDefault?: string | null;
}

export interface DraftPrimaryKey {
  constraintName: string;
  columns: string[];
  _status: DraftStatus;
  originalColumns?: string[];
}

export interface DraftForeignKey {
  _id: string;
  _status: DraftStatus;
  constraintName: string;
  sourceColumns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface DraftUniqueConstraint {
  _id: string;
  _status: DraftStatus;
  constraintName: string;
  columns: string[];
}

export interface DraftIndex {
  _id: string;
  _status: DraftStatus;
  indexName: string;
  columns: string[];
  isUnique: boolean;
}

export interface StructureEditorState {
  columns: DraftColumn[];
  primaryKey: DraftPrimaryKey | null;
  foreignKeys: DraftForeignKey[];
  uniqueConstraints: DraftUniqueConstraint[];
  indexes: DraftIndex[];
}

export const PG_COMMON_TYPES = [
  "integer",
  "bigint",
  "smallint",
  "serial",
  "bigserial",
  "text",
  "varchar",
  "char",
  "boolean",
  "date",
  "timestamp",
  "timestamptz",
  "time",
  "timetz",
  "interval",
  "numeric",
  "real",
  "double precision",
  "money",
  "uuid",
  "json",
  "jsonb",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "point",
  "line",
  "polygon",
  "box",
  "xml",
  "tsquery",
  "tsvector",
  "int[]",
  "text[]",
  "jsonb[]",
];

export const FK_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

/** MySQL's primary key is unnamed, so dropping it names no constraint. */
function dropPrimaryKey(target: string, constraintName: string, driver: DriverType): string {
  if (driver === "MYSQL") return `ALTER TABLE ${target} DROP PRIMARY KEY;`;
  return `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdent(constraintName, driver)};`;
}

/** The full definition of a column, which MySQL needs to redeclare on change. */
function columnDefinition(col: DraftColumn, driver: DriverType): string {
  let def = `${quoteIdent(col.name, driver)} ${col.dataType}`;
  if (!col.nullable) def += " NOT NULL";
  if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
  return def;
}

export function generateAlterTableSQL(
  schema: string,
  table: string,
  original: StructureEditorState,
  draft: StructureEditorState,
  driver: DriverType = "PGSQL",
): string[] {
  const stmts: string[] = [];
  const mysql = driver === "MYSQL";
  const qi = (n: string) => quoteIdent(n, driver);
  // MySQL qualifies the table but not the objects hanging off it.
  const target = `${qi(schema)}.${qi(table)}`;

  // Order matters: drop dependents (FKs, uniques, indexes, PK) before columns,
  // and drop everything before adding new objects, otherwise PG errors out.
  for (const fk of draft.foreignKeys) {
    if (fk._status === "removed") {
      // MySQL has no DROP CONSTRAINT for foreign keys.
      const clause = mysql ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
      stmts.push(`ALTER TABLE ${target} ${clause} ${qi(fk.constraintName)};`);
    }
  }

  for (const uc of draft.uniqueConstraints) {
    if (uc._status === "removed") {
      // A UNIQUE constraint is an index in MySQL, and is dropped as one.
      const clause = mysql ? "DROP INDEX" : "DROP CONSTRAINT";
      stmts.push(`ALTER TABLE ${target} ${clause} ${qi(uc.constraintName)};`);
    }
  }

  for (const idx of draft.indexes) {
    if (idx._status === "removed") {
      // An index belongs to its table in MySQL, and to the schema in Postgres.
      stmts.push(
        mysql
          ? `DROP INDEX ${qi(idx.indexName)} ON ${target};`
          : `DROP INDEX ${qi(schema)}.${qi(idx.indexName)};`,
      );
    }
  }

  if (original.primaryKey && draft.primaryKey?._status === "removed") {
    stmts.push(dropPrimaryKey(target, original.primaryKey.constraintName, driver));
  } else if (draft.primaryKey?._status === "modified" && original.primaryKey) {
    stmts.push(dropPrimaryKey(target, original.primaryKey.constraintName, driver));
  }

  for (const col of draft.columns) {
    if (col._status === "removed") {
      stmts.push(`ALTER TABLE ${target} DROP COLUMN ${qi(col.name)};`);
    }
  }

  for (const col of draft.columns) {
    if (col._status === "added") {
      stmts.push(`ALTER TABLE ${target} ADD COLUMN ${columnDefinition(col, driver)};`);
    }
  }

  for (const col of draft.columns) {
    if (col._status === "modified") {
      if (col.originalName && col.originalName !== col.name) {
        stmts.push(
          `ALTER TABLE ${target} RENAME COLUMN ${qi(col.originalName)} TO ${qi(col.name)};`,
        );
      }

      const effectiveName = col.name;

      if (mysql) {
        // MODIFY COLUMN restates the whole definition, so type, nullability and
        // default travel together — emitting them separately would reset the
        // ones left out.
        const typeChanged = col.originalDataType && col.originalDataType !== col.dataType;
        const nullChanged =
          col.originalNullable !== undefined && col.originalNullable !== col.nullable;
        const defaultChanged =
          col.originalDefault !== undefined && col.originalDefault !== col.defaultValue;

        if (typeChanged || nullChanged || defaultChanged) {
          stmts.push(
            `ALTER TABLE ${target} MODIFY COLUMN ${columnDefinition({ ...col, name: effectiveName }, driver)};`,
          );
        }
      } else {
        if (col.originalDataType && col.originalDataType !== col.dataType) {
          stmts.push(
            `ALTER TABLE ${target} ALTER COLUMN ${qi(effectiveName)} TYPE ${col.dataType} USING ${qi(effectiveName)}::${col.dataType};`,
          );
        }

        if (col.originalNullable !== undefined && col.originalNullable !== col.nullable) {
          const action = col.nullable ? "DROP NOT NULL" : "SET NOT NULL";
          stmts.push(`ALTER TABLE ${target} ALTER COLUMN ${qi(effectiveName)} ${action};`);
        }

        if (col.originalDefault !== undefined && col.originalDefault !== col.defaultValue) {
          const action = col.defaultValue ? `SET DEFAULT ${col.defaultValue}` : "DROP DEFAULT";
          stmts.push(`ALTER TABLE ${target} ALTER COLUMN ${qi(effectiveName)} ${action};`);
        }
      }
    }
  }

  if (
    draft.primaryKey &&
    (draft.primaryKey._status === "added" || draft.primaryKey._status === "modified")
  ) {
    const pkCols = draft.primaryKey.columns.map((c) => qi(c)).join(", ");
    // MySQL's primary key has no name of its own; naming it is a syntax error.
    stmts.push(
      mysql
        ? `ALTER TABLE ${target} ADD PRIMARY KEY (${pkCols});`
        : `ALTER TABLE ${target} ADD CONSTRAINT ${qi(draft.primaryKey.constraintName)} PRIMARY KEY (${pkCols});`,
    );
  }

  for (const uc of draft.uniqueConstraints) {
    if (uc._status === "added") {
      const ucCols = uc.columns.map((c) => qi(c)).join(", ");
      stmts.push(
        `ALTER TABLE ${target} ADD CONSTRAINT ${qi(uc.constraintName)} UNIQUE (${ucCols});`,
      );
    }
  }

  for (const idx of draft.indexes) {
    if (idx._status === "added") {
      const idxCols = idx.columns.map((c) => qi(c)).join(", ");
      const unique = idx.isUnique ? "UNIQUE " : "";
      stmts.push(`CREATE ${unique}INDEX ${qi(idx.indexName)} ON ${target} (${idxCols});`);
    }
  }

  for (const fk of draft.foreignKeys) {
    if (fk._status === "added") {
      const srcCols = fk.sourceColumns.map((c) => qi(c)).join(", ");
      const tgtCols = fk.targetColumns.map((c) => qi(c)).join(", ");
      const tgtTable = `${qi(fk.targetSchema)}.${qi(fk.targetTable)}`;
      stmts.push(
        `ALTER TABLE ${target} ADD CONSTRAINT ${qi(fk.constraintName)} ` +
          `FOREIGN KEY (${srcCols}) REFERENCES ${tgtTable} (${tgtCols}) ` +
          `ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete};`,
      );
    }
  }

  return stmts;
}

export function countChanges(state: StructureEditorState): number {
  let count = 0;
  for (const col of state.columns) {
    if (col._status !== "existing") count++;
  }
  if (state.primaryKey && state.primaryKey._status !== "existing") count++;
  for (const fk of state.foreignKeys) {
    if (fk._status !== "existing") count++;
  }
  for (const uc of state.uniqueConstraints) {
    if (uc._status !== "existing") count++;
  }
  for (const idx of state.indexes) {
    if (idx._status !== "existing") count++;
  }
  return count;
}
