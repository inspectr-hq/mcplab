export type ConfigFilePathSource = {
  relativePath?: string;
  sourcePath?: string;
};

export function getConfigDisplayPath(config: ConfigFilePathSource): string | undefined {
  return config.relativePath?.trim() || config.sourcePath?.trim() || undefined;
}
