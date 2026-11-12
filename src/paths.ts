import path from "node:path";

export function instanceDir(homeDir: string, instanceName: string): string {
  return path.join(homeDir, "instances", instanceName);
}

export function cookieFile(homeDir: string, instanceName: string): string {
  return path.join(instanceDir(homeDir, instanceName), "session.json");
}

export function browserProfileDir(homeDir: string, instanceName: string): string {
  return path.join(instanceDir(homeDir, instanceName), "browser-profile");
}
