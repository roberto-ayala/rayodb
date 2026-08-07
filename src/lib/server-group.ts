import type { ProjectDetails, ProjectMap } from "@/types";

/**
 * Connections that share host, port, user and SSH hop are the same server, and
 * the sidebar folds them into a single group.
 */
export function serverFingerprint(d: ProjectDetails): string {
  const hop = d.sshEnabled === "true" ? `${d.sshHost}:${d.sshPort}` : "";
  return `${d.host}\0${d.port}\0${d.username}\0${hop}`;
}

/**
 * The name a server goes by: the first connection configured against it, which
 * is also the one its group actions (connect, edit, add database) target.
 */
export function serverName(projects: ProjectMap, projectId: string): string {
  const d = projects[projectId];
  if (!d) return projectId;

  const fp = serverFingerprint(d);
  for (const [id, other] of Object.entries(projects)) {
    if (serverFingerprint(other) === fp) return id;
  }
  return projectId;
}
