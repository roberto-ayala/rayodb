import type { DriverInfo } from "@/lib/database-driver/capabilities";
import type { DriverType } from "@/types";
import { CheckboxField, Field } from "../ui/field";
import { Input } from "../ui/input";

interface ConnStringFieldProps {
  value: string;
  onChange: (value: string) => void;
  error: boolean;
  driver: DriverType;
}

/** The URL shape each engine accepts, shown as the placeholder. */
const CONN_STRING_EXAMPLE: Record<DriverType, string> = {
  PGSQL: "postgresql://user:password@host:5432/database",
  MYSQL: "mysql://user:password@host:3306/database",
  SQLITE: "/path/to/database.sqlite",
};

export function ConnStringField({ value, onChange, error, driver }: ConnStringFieldProps) {
  const isFile = driver === "SQLITE";

  return (
    <div className="space-y-4">
      <Field
        label={isFile ? "Database File" : "Connection URL"}
        htmlFor="connString"
        error={error ? "Not a connection URL this app recognises" : undefined}
      >
        <Input
          id="connString"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={CONN_STRING_EXAMPLE[driver]}
          className={error ? "border-destructive" : undefined}
        />
      </Field>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-3xs">
          <span className="bg-card px-2 text-muted-foreground">or fill in manually</span>
        </div>
      </div>
    </div>
  );
}

interface DriverPickerProps {
  driver: DriverType;
  drivers: DriverInfo[];
  onChange: (driver: DriverType) => void;
}

/**
 * A picker only once there is a choice to make: with a single engine
 * installed, a dropdown of one is noise, so it stays a read-only field.
 */
export function DriverPicker({ driver, drivers, onChange }: DriverPickerProps) {
  const label = drivers.find((d) => d.id === driver)?.name ?? driver;

  if (drivers.length < 2) {
    return (
      <Field label="Database Type" htmlFor="driver">
        <div
          id="driver"
          className="flex h-8 w-full items-center rounded-md border border-border bg-input px-3 text-xs text-foreground"
        >
          {label}
        </div>
      </Field>
    );
  }

  return (
    <Field label="Database Type" htmlFor="driver">
      <select
        id="driver"
        value={driver}
        onChange={(e) => onChange(e.target.value as DriverType)}
        className="h-8 w-full rounded-md border border-border bg-input px-3 text-xs text-foreground"
      >
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface FilePathFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** For file-based engines, which have a path where a server has a host. */
export function FilePathField({ value, onChange }: FilePathFieldProps) {
  return (
    <Field label="Database File" htmlFor="filePath">
      <Input
        id="filePath"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/path/to/database.sqlite"
        required
      />
    </Field>
  );
}

interface NameFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function NameField({ value, onChange, error }: NameFieldProps) {
  return (
    <Field label="Connection Name" htmlFor="name" error={error}>
      <Input
        id="name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="production-db"
        required
        className={error ? "border-destructive" : undefined}
      />
    </Field>
  );
}

interface HostPortFieldsProps {
  host: string;
  port: string;
  onHostChange: (value: string) => void;
  onPortChange: (value: string) => void;
}

export function HostPortFields({ host, port, onHostChange, onPortChange }: HostPortFieldsProps) {
  return (
    <div className="grid grid-cols-[1fr_8rem] gap-4">
      <Field label="Host" htmlFor="host">
        <Input
          id="host"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          placeholder="localhost"
          required
        />
      </Field>
      <Field label="Port" htmlFor="port">
        <Input
          id="port"
          value={port}
          onChange={(e) => onPortChange(e.target.value)}
          placeholder="5432"
          required
        />
      </Field>
    </div>
  );
}

interface DatabaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The engine can open the server without one. */
  optional?: boolean;
  driver: DriverType;
}

/** Blank means different things per engine, so say which. */
const BLANK_DATABASE_MEANS: Partial<Record<DriverType, string>> = {
  MYSQL: "Leave blank to browse every database on the server",
  PGSQL: "Leave blank to use the database named after the user",
};

export function DatabaseField({ value, onChange, optional = false, driver }: DatabaseFieldProps) {
  return (
    <Field
      label={optional ? "Database (optional)" : "Database"}
      htmlFor="database"
      hint={optional ? BLANK_DATABASE_MEANS[driver] : undefined}
    >
      <Input
        id="database"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={optional ? "all databases" : "mydb"}
        required={!optional}
      />
    </Field>
  );
}

interface UsernameFieldProps {
  value: string;
  onChange: (value: string) => void;
  driver: DriverType;
}

/** Each engine has its own conventional superuser, so the hint follows it. */
const DEFAULT_USER: Partial<Record<DriverType, string>> = {
  PGSQL: "postgres",
  MYSQL: "root",
};

export function UsernameField({ value, onChange, driver }: UsernameFieldProps) {
  return (
    <Field label="Username" htmlFor="username">
      <Input
        id="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={DEFAULT_USER[driver] ?? ""}
        required
      />
    </Field>
  );
}

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function PasswordField({ value, onChange }: PasswordFieldProps) {
  return (
    <Field label="Password" htmlFor="password">
      <Input
        id="password"
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••"
      />
    </Field>
  );
}

interface SslCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function SslCheckbox({ checked, onChange }: SslCheckboxProps) {
  return <CheckboxField id="ssl" label="Use SSL" checked={checked} onChange={onChange} />;
}

interface AutoConnectCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function AutoConnectCheckbox({ checked, onChange }: AutoConnectCheckboxProps) {
  return (
    <CheckboxField
      id="auto-connect"
      label="Connect on startup"
      checked={checked}
      onChange={onChange}
    />
  );
}
