import { CheckboxField, Field } from "../ui/field";
import { Input } from "../ui/input";

interface SshConfigProps {
  enabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshPassword: string;
  sshKeyPath: string;
  onEnabledChange: (enabled: boolean) => void;
  onSshHostChange: (value: string) => void;
  onSshPortChange: (value: string) => void;
  onSshUserChange: (value: string) => void;
  onSshPasswordChange: (value: string) => void;
  onSshKeyPathChange: (value: string) => void;
}

export function SshConfig({
  enabled,
  sshHost,
  sshPort,
  sshUser,
  sshPassword,
  sshKeyPath,
  onEnabledChange,
  onSshHostChange,
  onSshPortChange,
  onSshUserChange,
  onSshPasswordChange,
  onSshKeyPathChange,
}: SshConfigProps) {
  return (
    <div className="space-y-2 pt-2">
      <CheckboxField
        id="sshEnabled"
        label="SSH Tunnel"
        checked={enabled}
        onChange={onEnabledChange}
      />
      {enabled && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SSH Host" htmlFor="sshHost">
              <Input
                id="sshHost"
                value={sshHost}
                onChange={(e) => onSshHostChange(e.target.value)}
                placeholder="bastion.example.com"
              />
            </Field>
            <Field label="SSH Port" htmlFor="sshPort">
              <Input
                id="sshPort"
                value={sshPort}
                onChange={(e) => onSshPortChange(e.target.value)}
                placeholder="22"
              />
            </Field>
          </div>
          <Field label="SSH User" htmlFor="sshUser">
            <Input
              id="sshUser"
              value={sshUser}
              onChange={(e) => onSshUserChange(e.target.value)}
              placeholder="ubuntu"
            />
          </Field>
          <Field label="SSH Password" htmlFor="sshPassword">
            <Input
              id="sshPassword"
              type="password"
              value={sshPassword}
              onChange={(e) => onSshPasswordChange(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label="Private Key Path" htmlFor="sshKeyPath">
            <Input
              id="sshKeyPath"
              value={sshKeyPath}
              onChange={(e) => onSshKeyPathChange(e.target.value)}
              placeholder="~/.ssh/id_rsa"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
