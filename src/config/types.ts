export const AUTH_TYPES = ["basic", "bearer", "browser"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const DEPLOYMENTS = ["cloud", "server"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];

export type ApiVersion = 2 | 3;

/**
 * Loosely-typed instance definition as it arrives from a config file,
 * environment variables, CLI flags or the `jira_add_instance` tool.
 */
export interface InstanceInput {
  name?: string;
  url?: string;
  baseUrl?: string;
  email?: string;
  token?: string;
  /** Name of an environment variable holding the token (keeps secrets out of config files). */
  tokenEnv?: string;
  auth?: string;
  deployment?: string;
  apiVersion?: string | number;
  projects?: string | string[];
  defaultProject?: string;
  loginUrl?: string;
  description?: string;
  readOnly?: string | boolean;
}

/** Fully validated instance definition. */
export interface InstanceConfig {
  name: string;
  baseUrl: string;
  auth: AuthType;
  email?: string;
  token?: string;
  deployment: Deployment;
  apiVersion: ApiVersion;
  /** Project keys that live on this instance; used to auto-route issue keys. */
  projectKeys: string[];
  defaultProject?: string;
  loginUrl?: string;
  description?: string;
  readOnly: boolean;
}

export interface AppConfig {
  instances: InstanceConfig[];
  defaultInstance?: string;
  homeDir: string;
  readOnly: boolean;
  loginTimeoutSeconds: number;
  browserChannel?: string;
  keepAliveSeconds: number;
  maxAttachmentBytes: number;
  configFile?: string;
}

/** Shape of the optional JSON config file. */
export interface ConfigFile {
  defaultInstance?: string;
  readOnly?: boolean;
  loginTimeoutSeconds?: number;
  browserChannel?: string;
  keepAliveSeconds?: number;
  maxAttachmentBytes?: number;
  instances?: InstanceInput[] | Record<string, InstanceInput>;
}
