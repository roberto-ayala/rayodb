import { DRIVER_CONFIGS } from "@/lib/database-driver";
import type { DriverType } from "@/types";
import { CheckboxField, Field } from "../ui/field";
import { Input } from "../ui/input";

interface ConnStringFieldProps {
  value: string;
  onChange: (value: string) => void;
  error: boolean;
}

export function ConnStringField({ value, onChange, error }: ConnStringFieldProps) {
  return (
    <div className="space-y-4">
      <Field
        label="Connection URL"
        htmlFor="connString"
        error={error ? "Invalid connection URL format" : undefined}
      >
        <Input
          id="connString"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="postgresql://user:password@host:5432/database"
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

interface DriverDisplayProps {
  driver: DriverType;
}

export function DriverDisplay({ driver }: DriverDisplayProps) {
  return (
    <Field label="Database Type" htmlFor="driver">
      {/* Only one driver ships today, so this reads as a field but is static */}
      <div
        id="driver"
        className="flex h-8 w-full items-center rounded-md border border-border bg-input px-3 text-xs text-foreground"
      >
        {DRIVER_CONFIGS[driver].name}
      </div>
    </Field>
  );
}

interface NameFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export function NameField({ value, onChange, disabled }: NameFieldProps) {
  return (
    <Field label="Connection Name" htmlFor="name">
      <Input
        id="name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="production-db"
        required
        disabled={disabled}
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
}

export function DatabaseField({ value, onChange }: DatabaseFieldProps) {
  return (
    <Field label="Database" htmlFor="database">
      <Input
        id="database"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="mydb"
        required
      />
    </Field>
  );
}

interface UsernameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function UsernameField({ value, onChange }: UsernameFieldProps) {
  return (
    <Field label="Username" htmlFor="username">
      <Input
        id="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="postgres"
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
